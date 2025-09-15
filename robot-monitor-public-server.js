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
const MAIN_SERVER = 'http://localhost:3001';
const STREAM_SERVER = 'http://localhost:3001';

// Enable CORS
app.use(cors());
app.use(express.json());

// Track connected chat clients
const chatClients = new Set();

// Simple logging
function log(message, level = 'INFO') {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${level}] ${message}`);
}

// Serve the public robot monitor page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'robot-monitor.html'));
});

// Proxy the video stream from main server
app.get('/stream.mjpeg', (req, res) => {
    log('Proxying video stream request');
    
    // Proxy the stream from stream server (port 3001)
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

// Get events from main server (read-only)
app.get('/events', async (req, res) => {
    try {
        // In a real implementation, this would fetch recent events from the main server
        // For now, return a mock response
        res.json({
            events: [
                {
                    timestamp: new Date().toISOString(),
                    type: 'robot_status',
                    message: 'All robots operational'
                }
            ]
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// WebSocket for chat functionality
wss.on('connection', (ws, req) => {
    log('New chat client connected');
    chatClients.add(ws);
    
    // Send welcome message
    ws.send(JSON.stringify({
        type: 'system',
        message: 'Connected to Robot Monitor chat',
        timestamp: new Date().toISOString()
    }));
    
    // Handle incoming messages
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data);
            
            if (message.type === 'chat') {
                // Broadcast to all connected clients
                const broadcastMessage = {
                    type: 'chat',
                    message: message.message,
                    timestamp: new Date().toISOString()
                };
                
                const messageString = JSON.stringify(broadcastMessage);
                chatClients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(messageString);
                    }
                });
                
                log(`Chat message: ${message.message}`);
            }
        } catch (error) {
            log(`WebSocket message error: ${error.message}`, 'ERROR');
        }
    });
    
    // Handle disconnection
    ws.on('close', () => {
        chatClients.delete(ws);
        log('Chat client disconnected');
    });
    
    ws.on('error', (error) => {
        log(`WebSocket error: ${error.message}`, 'ERROR');
        chatClients.delete(ws);
    });
});

// Connect to main server's WebSocket for events (read-only)
function connectToMainServer() {
    const mainWs = new WebSocket('ws://localhost:3001');
    
    mainWs.on('open', () => {
        log('Connected to main server for events');
    });
    
    mainWs.on('message', (data) => {
        try {
            const message = JSON.parse(data);
            
            // Forward only event_detected messages to public clients
            if (message.type === 'event_detected') {
                const publicEvent = {
                    type: 'event',
                    event: {
                        type: message.event.type,
                        message: message.event.summary || message.event.type,
                        timestamp: message.timestamp
                    }
                };
                
                const eventString = JSON.stringify(publicEvent);
                chatClients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(eventString);
                    }
                });
            }
        } catch (error) {
            // Ignore parsing errors
        }
    });
    
    mainWs.on('close', () => {
        log('Disconnected from main server, reconnecting...');
        setTimeout(connectToMainServer, 5000);
    });
    
    mainWs.on('error', (error) => {
        log(`Main server connection error: ${error.message}`, 'ERROR');
    });
}

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
    
    // Connect to main server for events
    connectToMainServer();
});

// Graceful shutdown
process.on('SIGINT', () => {
    log('Shutting down public server...');
    
    // Close all WebSocket connections
    chatClients.forEach(client => {
        client.close();
    });
    
    wss.close(() => {
        server.close(() => {
            process.exit(0);
        });
    });
});