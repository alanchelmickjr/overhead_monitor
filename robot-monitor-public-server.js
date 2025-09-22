#!/usr/bin/env node

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = 4040;
const MAIN_SERVER = 'http://localhost:3000';  // Stream from internal server
const STREAM_SERVER = 'http://localhost:3000'; // Stream from internal server

// Enable CORS
app.use(cors());
app.use(express.json());

// Track connected chat clients properly
const chatClients = new Map(); // Better tracking with Map
let clientIdCounter = 0;

// Heartbeat configuration for connection health (increased intervals)
const HEARTBEAT_INTERVAL = 300000; // 5 minutes instead of 30 seconds
const HEARTBEAT_TIMEOUT = 600000;  // 10 minutes timeout instead of 60 seconds

// Check if debug mode is enabled
const DEBUG_MODE = process.env.DEBUG === 'true';

// Simple logging
function log(message, level = 'INFO') {
    // Skip DEBUG level logs if not in debug mode
    if (level === 'DEBUG' && !DEBUG_MODE) {
        return;
    }
    
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${level}] ${message}`);
}

// Serve the public robot monitor page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'robot-monitor.html'));
});

// Proxy the video stream from main server
app.get('/stream.mjpeg', (req, res) => {
    log('Proxying video stream request', 'DEBUG');
    
    // Proxy the stream from stream server (port 3000)
    fetch(`${STREAM_SERVER}/stream.mjpeg`)
        .then(response => {
            // Forward headers
            res.writeHead(200, {
                'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'Pragma': 'no-cache'
            });
            
            // Pipe the stream
            response.body.pipe(res);
        })
        .catch(error => {
            log(`Stream proxy error: ${error.message}`, 'ERROR');
            res.status(500).send('Stream unavailable');
        });
});

// Proxy snapshot endpoint
app.get('/snapshot.jpg', async (req, res) => {
    try {
        const response = await fetch(`${MAIN_SERVER}/snapshot.jpg`);
        const buffer = await response.buffer();
        
        res.writeHead(200, {
            'Content-Type': 'image/jpeg',
            'Content-Length': buffer.length,
            'Cache-Control': 'no-cache'
        });
        res.end(buffer);
    } catch (error) {
        log(`Snapshot proxy error: ${error.message}`, 'ERROR');
        res.status(500).send('Snapshot unavailable');
    }
});

// Store recent events
let recentEvents = [];
const MAX_EVENTS = 50;

// Get events from main server (read-only)
app.get('/events', async (req, res) => {
    try {
        res.json({
            events: recentEvents
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Endpoint to receive events from internal monitor
app.post('/events', cors(), express.json(), (req, res) => {
    try {
        const { type, message, conditions, timestamp } = req.body;
        
        const event = {
            timestamp: timestamp || new Date().toISOString(),
            type: type || 'detection',
            message: message || 'Detection event',
            conditions: conditions || []
        };
        
        // Store event
        recentEvents.unshift(event);
        if (recentEvents.length > MAX_EVENTS) {
            recentEvents = recentEvents.slice(0, MAX_EVENTS);
        }
        
        // Broadcast to all connected WebSocket clients
        const eventMessage = JSON.stringify({
            type: 'event',
            event: event
        });
        
        chatClients.forEach((client) => {
            if (client.ws.readyState === WebSocket.OPEN) {
                try {
                    client.ws.send(eventMessage);
                } catch (error) {
                    log(`Failed to send event to client #${client.id}: ${error.message}`, 'ERROR');
                }
            }
        });
        
        log(`Event broadcasted: ${message}`, 'INFO');
        res.json({ success: true });
    } catch (error) {
        log(`Error processing event: ${error.message}`, 'ERROR');
        res.status(500).json({ error: error.message });
    }
});

// WebSocket for chat functionality - PUBLIC PORT 4040 ONLY
wss.on('connection', (ws, req) => {
    const clientId = ++clientIdCounter;
    log(`New chat client connected: #${clientId}`);
    
    // Add client with metadata
    const clientInfo = {
        id: clientId,
        ws: ws,
        isAlive: true,
        lastPing: Date.now(),
        connectedAt: new Date()
    };
    chatClients.set(clientId, clientInfo);
    
    // Set up heartbeat
    ws.isAlive = true;
    ws.on('pong', () => {
        ws.isAlive = true;
        clientInfo.lastPing = Date.now();
    });
    
    // Send welcome message - with retry logic
    const sendWelcome = () => {
        try {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'system',
                    message: 'Connected to Robot Monitor chat',
                    timestamp: new Date().toISOString(),
                    clientId: clientId
                }));
                log(`Welcome message sent to client #${clientId}`, 'DEBUG');
            } else {
                log(`Client #${clientId} not ready for welcome message`, 'WARNING');
            }
        } catch (error) {
            log(`Failed to send welcome to client #${clientId}: ${error.message}`, 'ERROR');
        }
    };
    
    // Send welcome immediately if ready, or wait a bit
    if (ws.readyState === WebSocket.OPEN) {
        sendWelcome();
    } else {
        setTimeout(sendWelcome, 100);
    }
    
    // Handle incoming messages
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data);
            
            if (message.type === 'chat') {
                // Broadcast to all connected clients
                const broadcastMessage = {
                    type: 'chat',
                    message: message.message,
                    timestamp: new Date().toISOString(),
                    from: `User${clientId}`
                };
                
                const messageString = JSON.stringify(broadcastMessage);
                let sentCount = 0;
                
                chatClients.forEach((client, id) => {
                    if (client.ws.readyState === WebSocket.OPEN) {
                        try {
                            client.ws.send(messageString);
                            sentCount++;
                        } catch (error) {
                            log(`Failed to send to client #${id}: ${error.message}`, 'ERROR');
                        }
                    }
                });
                
                log(`Chat message from #${clientId}: "${message.message}" (sent to ${sentCount} clients)`, 'DEBUG');
            } else if (message.type === 'ping') {
                // Handle client ping
                ws.send(JSON.stringify({ type: 'pong' }));
            }
        } catch (error) {
            log(`WebSocket message error from client #${clientId}: ${error.message}`, 'ERROR');
        }
    });
    
    // Handle disconnection
    ws.on('close', () => {
        chatClients.delete(clientId);
        log(`Chat client disconnected: #${clientId}`);
    });
    
    ws.on('error', (error) => {
        log(`WebSocket error for client #${clientId}: ${error.message}`, 'ERROR');
        chatClients.delete(clientId);
    });
});

// Heartbeat interval to detect dead connections
const heartbeatInterval = setInterval(() => {
    chatClients.forEach((client, id) => {
        if (client.ws.isAlive === false) {
            log(`Terminating dead client #${id}`);
            client.ws.terminate();
            chatClients.delete(id);
            return;
        }
        
        client.ws.isAlive = false;
        client.ws.ping();
    });
}, HEARTBEAT_INTERVAL);

// Clean up on server close
wss.on('close', () => {
    clearInterval(heartbeatInterval);
});

// Don't connect to main server for events - keep chat standalone on 4040
// Events can be manually sent if needed via the chat system itself

// Start server
server.listen(PORT, () => {
    console.log('\n🤖 Robot Monitor - Public Viewer');
    console.log('═══════════════════════════════════');
    console.log(`📺 Public Interface: http://localhost:${PORT}`);
    console.log(`💬 Chat WebSocket: ws://localhost:${PORT}`);
    console.log('═══════════════════════════════════');
    console.log('\n✨ Features:');
    console.log('  • Live video stream');
    console.log('  • Simple chat for teleoperators');
    console.log('  • Event notifications');
    console.log('  • Video controls & recording');
    console.log('\n✅ Public server ready!\n');
    
    // Chat runs standalone on port 4040 - no connection to internal server needed
    log('Chat system ready on port 4040 - standalone operation', 'DEBUG');
});

// Graceful shutdown
process.on('SIGINT', () => {
    log('Shutting down public server...');
    
    // Close all WebSocket connections properly
    chatClients.forEach((client, id) => {
        log(`Closing connection for client #${id}`);
        client.ws.close();
    });
    chatClients.clear();
    
    clearInterval(heartbeatInterval);
    
    wss.close(() => {
        server.close(() => {
            process.exit(0);
        });
    });
});