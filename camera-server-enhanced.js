#!/usr/bin/env node

const express = require('express');
const path = require('path');
const { spawn } = require('child_process');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

// Storage options
const GunStorage = require('./src/storage/GunStorage');
const InMemoryStorage = require('./src/storage/InMemoryStorage');

const app = express();
const PORT = 3000;

// Initialize storage (Gun for decentralized, InMemory for testing)
const storage = new GunStorage({
  peers: [
    'https://gun-manhattan.herokuapp.com/gun',
    'https://gun-us.herokuapp.com/gun'
  ]
});

// Middleware
app.use(express.json());
app.use(express.static('.'));
app.use(session({
  secret: 'robot-monitor-secret-' + uuidv4(),
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));

// Default admin user (LeKiwi)
const defaultUsers = {
  'LeKiwi': {
    id: 'admin-001',
    username: 'LeKiwi',
    passwordHash: bcrypt.hashSync('LeKiwi995', 10),
    role: 'admin',
    permissions: ['view', 'control', 'configure', 'manage_users']
  }
};

// Activity logger middleware
const logActivity = async (req, res, next) => {
  const activity = {
    id: uuidv4(),
    timestamp: new Date().toISOString(),
    userId: req.session.userId || 'anonymous',
    username: req.session.username || 'anonymous',
    action: req.method + ' ' + req.path,
    ip: req.ip,
    userAgent: req.get('user-agent')
  };
  
  // Store activity
  await storage.saveEvent({
    type: 'user_activity',
    ...activity
  });
  
  next();
};

// Auth check middleware
const requireAuth = (req, res, next) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
};

// Permission check middleware
const requirePermission = (permission) => {
  return (req, res, next) => {
    if (!req.session.permissions || !req.session.permissions.includes(permission)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
};

// Login page
app.get('/login', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Robot Monitor - Login</title>
      <style>
        body {
          background: #0a0a0a;
          color: #e0e0e0;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          display: flex;
          justify-content: center;
          align-items: center;
          height: 100vh;
          margin: 0;
        }
        .login-form {
          background: #1a1a1a;
          padding: 40px;
          border-radius: 10px;
          border: 1px solid #333;
          width: 300px;
        }
        h2 {
          color: #4a9eff;
          text-align: center;
          margin-bottom: 30px;
        }
        input {
          width: 100%;
          padding: 10px;
          margin-bottom: 15px;
          background: #0a0a0a;
          border: 1px solid #333;
          color: #e0e0e0;
          border-radius: 5px;
        }
        button {
          width: 100%;
          padding: 12px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          border: none;
          border-radius: 5px;
          cursor: pointer;
          font-size: 16px;
        }
        button:hover {
          opacity: 0.9;
        }
        .error {
          color: #ef4444;
          text-align: center;
          margin-bottom: 15px;
        }
      </style>
    </head>
    <body>
      <div class="login-form">
        <h2>🤖 Robot Monitor</h2>
        <div id="error" class="error"></div>
        <form id="loginForm">
          <input type="text" id="username" placeholder="Username" value="LeKiwi" required>
          <input type="password" id="password" placeholder="Password" required>
          <button type="submit">Login</button>
        </form>
      </div>
      <script>
        document.getElementById('loginForm').onsubmit = async (e) => {
          e.preventDefault();
          const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              username: document.getElementById('username').value,
              password: document.getElementById('password').value
            })
          });
          
          if (response.ok) {
            window.location.href = '/';
          } else {
            const data = await response.json();
            document.getElementById('error').textContent = data.error || 'Login failed';
          }
        };
      </script>
    </body>
    </html>
  `);
});

// API: Login
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  
  // Check default users (in production, check storage)
  const user = defaultUsers[username];
  
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    await storage.saveEvent({
      type: 'login_failed',
      username,
      ip: req.ip,
      timestamp: new Date().toISOString()
    });
    
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  
  // Set session
  req.session.userId = user.id;
  req.session.username = user.username;
  req.session.role = user.role;
  req.session.permissions = user.permissions;
  
  // Log successful login
  await storage.saveEvent({
    type: 'login_success',
    userId: user.id,
    username: user.username,
    ip: req.ip,
    timestamp: new Date().toISOString()
  });
  
  res.json({ success: true, user: { username: user.username, role: user.role } });
});

// API: Logout
app.post('/api/logout', async (req, res) => {
  if (req.session.userId) {
    await storage.saveEvent({
      type: 'logout',
      userId: req.session.userId,
      username: req.session.username,
      timestamp: new Date().toISOString()
    });
  }
  
  req.session.destroy();
  res.json({ success: true });
});

// API: Get current user
app.get('/api/user', (req, res) => {
  if (req.session.userId) {
    res.json({
      username: req.session.username,
      role: req.session.role,
      permissions: req.session.permissions
    });
  } else {
    res.status(401).json({ error: 'Not authenticated' });
  }
});

// Main camera interface (requires auth)
app.get('/', requireAuth, logActivity, (req, res) => {
  res.sendFile(path.join(__dirname, 'camera-viewer-debug.html'));
});

// API: Camera snapshot (requires auth and logs activity)
app.post('/api/camera/snapshot', requireAuth, requirePermission('view'), logActivity, async (req, res) => {
  const event = {
    type: 'camera_snapshot',
    userId: req.session.userId,
    username: req.session.username,
    timestamp: new Date().toISOString(),
    cameraId: 'main',
    action: 'manual_snapshot'
  };
  
  await storage.saveEvent(event);
  res.json({ success: true, eventId: event.id });
});

// API: Start/stop analysis (requires control permission)
app.post('/api/analysis/:action', requireAuth, requirePermission('control'), logActivity, async (req, res) => {
  const { action } = req.params;
  
  const event = {
    type: 'analysis_control',
    userId: req.session.userId,
    username: req.session.username,
    timestamp: new Date().toISOString(),
    action: action,
    details: req.body
  };
  
  await storage.saveEvent(event);
  res.json({ success: true, eventId: event.id });
});

// API: Get activity logs (requires admin)
app.get('/api/activity', requireAuth, requirePermission('manage_users'), async (req, res) => {
  const { limit = 100, type, userId } = req.query;
  
  const events = await storage.getEvents({
    limit: parseInt(limit),
    type,
    userId
  });
  
  res.json(events);
});

// API: Get system stats
app.get('/api/stats', requireAuth, async (req, res) => {
  const stats = await storage.getDatabaseStats();
  
  // Add current session info
  stats.currentUser = {
    username: req.session.username,
    role: req.session.role,
    loginTime: req.session.cookie._expires
  };
  
  res.json(stats);
});

// Health check for proxy
app.get('/proxy-status', async (req, res) => {
  try {
    const response = await fetch('http://localhost:3001/status');
    const data = await response.json();
    res.json({ proxyRunning: true, ...data });
  } catch (error) {
    res.json({ proxyRunning: false, error: error.message });
  }
});

// Initialize storage and start server
storage.connect().then(() => {
  console.log('✅ Storage connected');
  
  app.listen(PORT, () => {
    console.log('\n🚀 Robot Overhead Monitor - Enhanced Edition');
    console.log('═══════════════════════════════════════════════════');
    console.log(`📹 Camera Interface: http://localhost:${PORT}`);
    console.log(`🔄 RTSP Proxy: http://localhost:3001`);
    console.log('═══════════════════════════════════════════════════');
    console.log('\n🔐 Default Login:');
    console.log('  Username: LeKiwi');
    console.log('  Password: LeKiwi995');
    console.log('\n✨ Features:');
    console.log('  • Decentralized storage with Gun.js');
    console.log('  • User authentication & access control');
    console.log('  • Activity logging & monitoring');
    console.log('  • Real-time robot tracking');
    console.log('\n✅ Open http://localhost:3000 in your browser\n');
  });
  
  // Check if proxy is running
  setTimeout(async () => {
    try {
      const response = await fetch('http://localhost:3001/status');
      if (response.ok) {
        console.log('✅ RTSP Proxy is running on port 3001');
      }
    } catch (error) {
      console.log('⚠️  RTSP Proxy not detected. Run: node rtsp-proxy-debug.js');
    }
  }, 1000);
}).catch(error => {
  console.error('Failed to connect storage:', error);
  process.exit(1);
});