# External Access Guide for Robot Overhead Monitor

## Overview

This guide provides comprehensive instructions for setting up secure external access to the Robot Overhead Monitor application for small group collaboration. The application runs on port 3000 and includes real-time camera streaming, WebSocket connections, and AI model endpoints.

## Application Architecture Summary

The Robot Overhead Monitor exposes the following services:
- **Web Dashboard**: Port 3000 (HTTP)
- **MJPEG Stream**: `/stream.mjpeg` endpoint
- **WebSocket**: Real-time updates for events and status
- **REST API**: Configuration and control endpoints
- **Snapshot Service**: `/snapshot.jpg` for single frame capture

## Option 1: ngrok (Recommended for Small Groups)

### ngrok Evaluation

#### Pros:
- **Quick Setup**: Operational in minutes with minimal configuration
- **No Infrastructure**: No need for domain names or SSL certificates
- **Built-in HTTPS**: Automatic SSL termination
- **Firewall Friendly**: Works behind NAT and firewalls
- **Free Tier Available**: Suitable for testing and small groups
- **WebSocket Support**: Full support for real-time connections

#### Cons:
- **Random URLs**: Free tier provides random subdomains (changes on restart)
- **Connection Limits**: Free tier limited to 40 connections/minute
- **Bandwidth Limits**: 1GB/mo on free tier (may be insufficient for video streaming)
- **No Custom Domains**: Free tier doesn't support custom domains
- **Session Limits**: 8-hour maximum session length on free tier

#### Best For:
- Development and testing
- Small teams (< 10 users)
- Temporary access for demonstrations
- Proof of concept deployments

### ngrok Setup Instructions

#### 1. Install ngrok

```bash
# macOS (Homebrew)
brew install ngrok/ngrok/ngrok

# Linux
curl -s https://ngrok-agent.s3.amazonaws.com/ngrok.asc | sudo tee /etc/apt/trusted.gpg.d/ngrok.asc >/dev/null && \
echo "deb https://ngrok-agent.s3.amazonaws.com buster main" | sudo tee /etc/apt/sources.list.d/ngrok.list && \
sudo apt update && sudo apt install ngrok

# Or download directly
wget https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-amd64.tgz
tar xvzf ngrok-v3-stable-linux-amd64.tgz
```

#### 2. Configure ngrok Authentication

```bash
# Sign up at https://ngrok.com and get your authtoken
ngrok config add-authtoken YOUR_AUTH_TOKEN
```

#### 3. Create ngrok Configuration

Create `ngrok.yml` in your project directory:

```yaml
version: "2"
authtoken: YOUR_AUTH_TOKEN

tunnels:
  robot-monitor:
    proto: http
    addr: 3000
    inspect: true
    bind_tls: true
    schemes:
      - https
    metadata:
      service: robot-overhead-monitor
    # Uncomment for paid plans
    # subdomain: robot-monitor
    # basic_auth:
    #   - "user:password"
```

#### 4. Start ngrok Tunnel

```bash
# Using configuration file
ngrok start --config ngrok.yml robot-monitor

# Or simple command
ngrok http 3000
```

### ngrok Integration Script

Create `setup-ngrok.sh`:

```bash
#!/bin/bash

# Robot Monitor ngrok Setup Script
# This script starts the application and creates an ngrok tunnel

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}🚀 Robot Monitor External Access Setup${NC}"
echo "======================================"

# Check if ngrok is installed
if ! command -v ngrok &> /dev/null; then
    echo -e "${RED}❌ ngrok is not installed${NC}"
    echo "Please install ngrok first: https://ngrok.com/download"
    exit 1
fi

# Check if robot monitor is running
if ! curl -s http://localhost:3000/status > /dev/null; then
    echo -e "${YELLOW}⚠️  Robot Monitor not running. Starting it now...${NC}"
    npm start &
    SERVER_PID=$!
    
    # Wait for server to start
    echo "Waiting for server to start..."
    sleep 5
    
    if ! curl -s http://localhost:3000/status > /dev/null; then
        echo -e "${RED}❌ Failed to start Robot Monitor${NC}"
        exit 1
    fi
fi

echo -e "${GREEN}✅ Robot Monitor is running${NC}"

# Start ngrok
echo -e "${YELLOW}🔗 Starting ngrok tunnel...${NC}"

# Create a simple ngrok configuration if it doesn't exist
if [ ! -f "ngrok.yml" ]; then
    cat > ngrok.yml << EOF
version: "2"
tunnels:
  robot-monitor:
    proto: http
    addr: 3000
    inspect: true
    bind_tls: true
    schemes:
      - https
EOF
fi

# Start ngrok in background and capture output
ngrok start --config ngrok.yml robot-monitor > ngrok.log 2>&1 &
NGROK_PID=$!

sleep 3

# Get the public URL
NGROK_URL=$(curl -s http://localhost:4040/api/tunnels | grep -o '"public_url":"https://[^"]*' | grep -o 'https://[^"]*' | head -1)

if [ -z "$NGROK_URL" ]; then
    echo -e "${RED}❌ Failed to get ngrok URL${NC}"
    echo "Check ngrok.log for errors"
    exit 1
fi

# Display access information
echo ""
echo -e "${GREEN}✅ External Access Enabled!${NC}"
echo "======================================"
echo -e "🌐 Public URL: ${YELLOW}$NGROK_URL${NC}"
echo -e "📹 Camera Stream: ${YELLOW}$NGROK_URL/stream.mjpeg${NC}"
echo -e "📸 Snapshot: ${YELLOW}$NGROK_URL/snapshot.jpg${NC}"
echo -e "🔍 ngrok Inspector: ${YELLOW}http://localhost:4040${NC}"
echo ""
echo -e "${YELLOW}Share the public URL with your team!${NC}"
echo ""
echo "Press Ctrl+C to stop..."

# Create access info file
cat > access-info.txt << EOF
Robot Monitor External Access
============================
Public URL: $NGROK_URL
Camera Stream: $NGROK_URL/stream.mjpeg
Snapshot: $NGROK_URL/snapshot.jpg
Generated: $(date)
EOF

# Handle cleanup
cleanup() {
    echo -e "\n${YELLOW}Shutting down...${NC}"
    if [ ! -z "$NGROK_PID" ]; then
        kill $NGROK_PID 2>/dev/null || true
    fi
    if [ ! -z "$SERVER_PID" ]; then
        kill $SERVER_PID 2>/dev/null || true
    fi
    rm -f ngrok.log
    echo -e "${GREEN}✅ Cleanup complete${NC}"
    exit 0
}

trap cleanup EXIT INT TERM

# Wait
wait
```

Make it executable:
```bash
chmod +x setup-ngrok.sh
```

## Option 2: Cloudflare Tunnel (Production Ready)

### Cloudflare Tunnel Evaluation

#### Pros:
- **Free Tier**: Generous free tier with no connection limits
- **Custom Domains**: Use your own domain
- **DDoS Protection**: Built-in Cloudflare protection
- **Zero Trust**: Advanced security features
- **Persistent URLs**: URLs don't change on restart
- **No Bandwidth Limits**: Unlimited bandwidth on free tier

#### Cons:
- **Domain Required**: Need to own a domain
- **More Complex**: Initial setup more involved
- **Account Required**: Cloudflare account needed
- **Learning Curve**: More features to understand

#### Best For:
- Production deployments
- Larger teams
- Long-term access needs
- Professional demonstrations

### Cloudflare Tunnel Setup

```bash
# Install cloudflared
brew install cloudflare/cloudflare/cloudflared

# Login to Cloudflare
cloudflared tunnel login

# Create tunnel
cloudflared tunnel create robot-monitor

# Create configuration
cat > ~/.cloudflared/config.yml << EOF
tunnel: robot-monitor
credentials-file: ~/.cloudflared/[TUNNEL_ID].json

ingress:
  - hostname: robot.yourdomain.com
    service: http://localhost:3000
  - service: http_status:404
EOF

# Route traffic
cloudflared tunnel route dns robot-monitor robot.yourdomain.com

# Run tunnel
cloudflared tunnel run robot-monitor
```

## Option 3: Tailscale (Private Network)

### Tailscale Evaluation

#### Pros:
- **Private Network**: Creates encrypted VPN mesh
- **No Public Exposure**: More secure than public tunnels
- **Easy Setup**: Simple installation
- **Cross-Platform**: Works on all devices
- **Free for Personal**: Up to 20 devices free

#### Cons:
- **Client Required**: All users need Tailscale installed
- **Not Public**: Can't share with external users easily
- **Learning Curve**: VPN concepts

#### Best For:
- Internal team access
- High security requirements
- Permanent team members

### Tailscale Setup

```bash
# Install Tailscale
curl -fsSL https://tailscale.com/install.sh | sh

# Start Tailscale
sudo tailscale up

# Get your Tailscale IP
tailscale ip -4

# Access application at http://[TAILSCALE_IP]:3000
```

## Security Considerations

### 1. Authentication
Add basic authentication to your application:

```javascript
// In robot-monitor-server.js
const basicAuth = require('express-basic-auth');

// Add before routes
app.use(basicAuth({
    users: { 
        'admin': 'StrongPassword123!',
        'viewer': 'ViewerPassword456!'
    },
    challenge: true,
    realm: 'Robot Monitor Access'
}));
```

### 2. HTTPS Configuration
ngrok and Cloudflare provide automatic HTTPS. For other solutions:

```javascript
// HTTPS server setup
const https = require('https');
const fs = require('fs');

const httpsOptions = {
    key: fs.readFileSync('private-key.pem'),
    cert: fs.readFileSync('certificate.pem')
};

https.createServer(httpsOptions, app).listen(3443);
```

### 3. CORS Configuration
Update CORS for specific domains:

```javascript
// In robot-monitor-server.js
const corsOptions = {
    origin: [
        'https://your-ngrok-subdomain.ngrok.io',
        'https://robot.yourdomain.com'
    ],
    credentials: true,
    optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
```

### 4. WebSocket Security
Implement WebSocket authentication:

```javascript
// WebSocket authentication
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (isValidToken(token)) {
        next();
    } else {
        next(new Error('Authentication failed'));
    }
});
```

## Handling Common Issues

### 1. WebSocket Connection Issues
For ngrok, WebSocket connections work automatically. For other proxies:

```javascript
// Client-side WebSocket configuration
const socket = io({
    transports: ['websocket'],
    upgrade: false,
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000
});
```

### 2. MJPEG Stream Performance
For bandwidth optimization:

```javascript
// Adjust stream quality based on connection
const ffmpegArgs = [
    '-rtsp_transport', 'tcp',
    '-i', CAMERA_URL,
    '-f', 'mjpeg',
    '-q:v', '10',  // Increase for lower quality/bandwidth
    '-r', '10',     // Reduce framerate for lower bandwidth
    '-s', '640x480', // Reduce resolution
    'pipe:1'
];
```

### 3. Session Persistence
Handle tunnel restarts gracefully:

```javascript
// Auto-reconnect logic
let reconnectInterval;

function connectToTunnel() {
    // Connection logic
}

function handleDisconnect() {
    reconnectInterval = setInterval(() => {
        console.log('Attempting to reconnect...');
        connectToTunnel();
    }, 5000);
}
```

## Recommendations by Use Case

### Development/Testing (1-5 users)
**Recommended: ngrok Free Tier**
- Quick setup
- No infrastructure needed
- Sufficient for testing

### Small Team Collaboration (5-20 users)
**Recommended: ngrok Paid or Cloudflare Tunnel**
- ngrok Pro: $10/month, custom domains, higher limits
- Cloudflare: Free with your domain, unlimited bandwidth

### Production/Customer Access (20+ users)
**Recommended: Cloudflare Tunnel**
- Professional appearance
- Scalable
- Enhanced security

### Internal Team Only
**Recommended: Tailscale**
- Most secure
- No public exposure
- Easy management

## Quick Start Commands

```bash
# Option 1: ngrok (simplest)
ngrok http 3000

# Option 2: Cloudflare (with domain)
cloudflared tunnel --url http://localhost:3000

# Option 3: Tailscale (private)
sudo tailscale up
# Share: http://[your-tailscale-ip]:3000
```

## Monitoring External Access

Create `monitor-access.sh`:

```bash
#!/bin/bash

# Monitor active connections and bandwidth
while true; do
    clear
    echo "=== Robot Monitor Access Stats ==="
    echo "Time: $(date)"
    echo ""
    
    # Check ngrok stats
    if curl -s http://localhost:4040/api/tunnels > /dev/null 2>&1; then
        echo "ngrok Status:"
        curl -s http://localhost:4040/api/metrics | grep -E 'bytes_in|bytes_out|conns'
    fi
    
    # Check application status
    echo ""
    echo "Application Status:"
    curl -s http://localhost:3000/status | jq '.'
    
    # Active connections
    echo ""
    echo "Active Connections:"
    netstat -an | grep :3000 | grep ESTABLISHED | wc -l
    
    sleep 5
done
```

## Conclusion

For small group access to the Robot Overhead Monitor:

1. **ngrok is sufficient** for most small group scenarios (< 10 users)
2. Use the provided `setup-ngrok.sh` script for quick deployment
3. Consider Cloudflare Tunnel for production use
4. Implement basic authentication for security
5. Monitor bandwidth usage for video streaming

The application's existing CORS support and WebSocket implementation make it compatible with all suggested tunneling solutions.