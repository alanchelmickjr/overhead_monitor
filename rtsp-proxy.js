#!/usr/bin/env node

/**
 * Multi-Client RTSP to Browser Proxy Server
 * Actually supports multiple simultaneous viewers (novel concept!)
 */

const express = require('express');
const { spawn } = require('child_process');
const cors = require('cors');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.RTSP_PROXY_PORT || 3001;

// Enable CORS for all origins
app.use(cors());

// Load configuration
let config = {};
try {
    if (fs.existsSync('config.json')) {
        config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
        log('Loaded configuration from config.json', 'SUCCESS');
    }
} catch (error) {
    log('Error loading config.json', 'WARNING');
}

// Stream management
let ffmpegProcess = null;
let clients = new Set();
let frameBuffer = [];
const MAX_BUFFER_SIZE = 30; // Keep last 30 frames for late joiners

// Logging with timestamps
function log(message, level = 'INFO') {
    const timestamp = new Date().toISOString();
    const color = {
        'ERROR': '\x1b[31m',
        'WARNING': '\x1b[33m',
        'SUCCESS': '\x1b[32m',
        'INFO': '\x1b[36m',
        'DEBUG': '\x1b[37m'
    }[level] || '\x1b[37m';
    
    console.log(`${color}[${timestamp}] [${level}] ${message}\x1b[0m`);
}

// Start FFmpeg process (shared by all clients)
function startFFmpeg() {
    if (ffmpegProcess) {
        log('FFmpeg already running', 'DEBUG');
        return;
    }
    
    const rtspUrl = 'rtsp://LeKiwi:LeKiwi995@192.168.88.40:554/stream1';
    log(`🎥 Starting shared FFmpeg stream from: ${rtspUrl}`, 'SUCCESS');
    
    const ffmpegArgs = [
        '-rtsp_transport', 'tcp',
        '-i', rtspUrl,
        '-f', 'mjpeg',
        '-q:v', '5',
        '-r', '15',
        '-s', '1280x720',
        'pipe:1'
    ];
    
    ffmpegProcess = spawn('ffmpeg', ffmpegArgs);
    
    let tempBuffer = Buffer.alloc(0);
    let frameCount = 0;
    
    ffmpegProcess.stdout.on('data', (chunk) => {
        tempBuffer = Buffer.concat([tempBuffer, chunk]);
        
        // Look for JPEG frames
        let startIndex = tempBuffer.indexOf(Buffer.from([0xFF, 0xD8]));
        let endIndex = tempBuffer.indexOf(Buffer.from([0xFF, 0xD9]));
        
        while (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
            const frame = tempBuffer.slice(startIndex, endIndex + 2);
            
            // Buffer frame for late joiners
            frameBuffer.push(frame);
            if (frameBuffer.length > MAX_BUFFER_SIZE) {
                frameBuffer.shift();
            }
            
            // Send to all connected clients
            const boundary = Buffer.from(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`);
            const frameData = Buffer.concat([boundary, frame, Buffer.from('\r\n')]);
            
            // Send to all connected clients with proper cleanup
            const clientsToRemove = new Set();
            for (const client of clients) {
                try {
                    if (client.destroyed || client.finished || !client.writable) {
                        clientsToRemove.add(client);
                        continue;
                    }
                    client.write(frameData);
                } catch (err) {
                    log(`Client write error: ${err.message}`, 'DEBUG');
                    clientsToRemove.add(client);
                }
            }
            
            // Clean up dead clients
            for (const deadClient of clientsToRemove) {
                clients.delete(deadClient);
                try {
                    if (!deadClient.destroyed) {
                        deadClient.destroy();
                    }
                } catch (err) {
                    // Already destroyed
                }
            }
            
            if (clientsToRemove.size > 0) {
                log(`Cleaned up ${clientsToRemove.size} dead clients (Remaining: ${clients.size})`, 'DEBUG');
            }
            
            frameCount++;
            if (frameCount % 100 === 0) {
                log(`Streamed ${frameCount} frames to ${clients.size} clients`, 'DEBUG');
            }
            
            tempBuffer = tempBuffer.slice(endIndex + 2);
            startIndex = tempBuffer.indexOf(Buffer.from([0xFF, 0xD8]));
            endIndex = tempBuffer.indexOf(Buffer.from([0xFF, 0xD9]));
        }
    });
    
    ffmpegProcess.stderr.on('data', (data) => {
        const message = data.toString();
        if (message.includes('error') || message.includes('Error')) {
            log(`FFmpeg error: ${message}`, 'ERROR');
        }
    });
    
    ffmpegProcess.on('close', (code) => {
        log(`FFmpeg process ended with code ${code}`, code === 0 ? 'INFO' : 'ERROR');
        ffmpegProcess = null;
        frameBuffer = [];
        
        // Restart if clients still connected
        if (clients.size > 0) {
            log('Restarting FFmpeg for connected clients...', 'INFO');
            setTimeout(startFFmpeg, 1000);
        }
    });
}

// Stop FFmpeg if no clients (with cleanup)
function stopFFmpegIfNoClients() {
    // Clean up any remaining dead clients first
    const deadClients = [];
    for (const client of clients) {
        if (client.destroyed || client.finished || !client.writable) {
            deadClients.push(client);
        }
    }
    
    for (const deadClient of deadClients) {
        clients.delete(deadClient);
    }
    
    if (deadClients.length > 0) {
        log(`Cleaned up ${deadClients.length} dead clients during FFmpeg check`, 'DEBUG');
    }
    
    if (clients.size === 0 && ffmpegProcess) {
        log('No clients connected, stopping FFmpeg', 'INFO');
        try {
            ffmpegProcess.kill('SIGTERM');
            setTimeout(() => {
                if (ffmpegProcess && !ffmpegProcess.killed) {
                    ffmpegProcess.kill('SIGKILL');
                }
            }, 5000);
        } catch (err) {
            log(`Error stopping FFmpeg: ${err.message}`, 'ERROR');
        }
        ffmpegProcess = null;
        frameBuffer = [];
    }
}

// MJPEG streaming endpoint
app.get('/stream.mjpeg', (req, res) => {
    const clientId = `${req.ip}-${Date.now()}`;
    log(`📹 New client connected: ${clientId} (Total: ${clients.size + 1})`, 'INFO');
    
    res.writeHead(200, {
        'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Pragma': 'no-cache'
    });
    
    // Add client to set
    clients.add(res);
    
    // Send buffered frames to new client
    if (frameBuffer.length > 0) {
        log(`Sending ${frameBuffer.length} buffered frames to new client`, 'DEBUG');
        for (const frame of frameBuffer) {
            const boundary = Buffer.from(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`);
            const frameData = Buffer.concat([boundary, frame, Buffer.from('\r\n')]);
            res.write(frameData);
        }
    }
    
    // Start FFmpeg if needed
    if (!ffmpegProcess) {
        startFFmpeg();
    }
    
    // Handle all possible disconnect scenarios
    const cleanupClient = () => {
        if (clients.has(res)) {
            clients.delete(res);
            log(`Client disconnected: ${clientId} (Remaining: ${clients.size})`, 'INFO');
            
            // Ensure response is properly closed
            try {
                if (!res.destroyed && !res.finished) {
                    res.end();
                }
            } catch (err) {
                // Already closed
            }
            
            // Delay stopping FFmpeg to handle quick reconnects
            setTimeout(stopFFmpegIfNoClients, 5000);
        }
    };
    
    // Multiple disconnect event handlers
    req.on('close', cleanupClient);
    req.on('aborted', cleanupClient);
    res.on('close', cleanupClient);
    res.on('error', (err) => {
        log(`Client response error: ${err.message}`, 'DEBUG');
        cleanupClient();
    });
    res.on('finish', cleanupClient);
});

// Snapshot endpoint
app.get('/snapshot.jpg', async (req, res) => {
    log('📸 Snapshot requested', 'INFO');
    
    if (frameBuffer.length > 0) {
        // Use last frame from buffer
        const lastFrame = frameBuffer[frameBuffer.length - 1];
        res.writeHead(200, {
            'Content-Type': 'image/jpeg',
            'Content-Length': lastFrame.length,
            'Cache-Control': 'no-cache'
        });
        res.end(lastFrame);
        log('✅ Snapshot delivered from buffer', 'SUCCESS');
    } else {
        // Capture fresh frame
        const rtspUrl = 'rtsp://LeKiwi:LeKiwi995@192.168.88.40:554/stream1';
        
        const ffmpeg = spawn('ffmpeg', [
            '-rtsp_transport', 'tcp',
            '-i', rtspUrl,
            '-vframes', '1',
            '-f', 'image2',
            '-vcodec', 'mjpeg',
            'pipe:1'
        ]);
        
        let imageData = Buffer.alloc(0);
        ffmpeg.stdout.on('data', (chunk) => {
            imageData = Buffer.concat([imageData, chunk]);
        });
        
        ffmpeg.on('close', (code) => {
            if (code === 0 && imageData.length > 0) {
                res.writeHead(200, {
                    'Content-Type': 'image/jpeg',
                    'Content-Length': imageData.length,
                    'Cache-Control': 'no-cache'
                });
                res.end(imageData);
                log('✅ Fresh snapshot captured', 'SUCCESS');
            } else {
                res.status(500).send('Failed to capture snapshot');
            }
        });
        
        setTimeout(() => ffmpeg.kill(), 5000);
    }
});

// LLaVA proxy endpoint to avoid CORS
app.use(express.json({ limit: '10mb' }));
app.post('/analyze', async (req, res) => {
    log('🧠 LLaVA analysis requested', 'INFO');
    
    const { image, prompt, apiUrl } = req.body;
    const url = apiUrl || 'http://localhost:8080/v1/chat/completions';
    
    try {
        // Import axios dynamically
        const axios = require('axios');
        
        const response = await axios.post(url, {
            model: 'llava-v1.5-7b-q4-k-m',
            messages: [{
                role: 'user',
                content: [
                    { type: 'text', text: prompt },
                    { type: 'image_url', image_url: { url: image } }
                ]
            }],
            max_tokens: 300,
            temperature: 0.7
        }, {
            timeout: 30000,
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        res.json(response.data);
        log('✅ LLaVA analysis completed', 'SUCCESS');
        
    } catch (error) {
        const errorDetails = error.response?.data || error.message || 'Unknown error';
        log(`❌ LLaVA error: ${JSON.stringify(errorDetails)}`, 'ERROR');
        
        // Check if it's a connection error
        if (error.code === 'ECONNREFUSED') {
            log('LLaVA server not running on ' + url, 'ERROR');
        }
        
        res.status(500).json({
            error: error.message,
            details: errorDetails,
            url: url
        });
    }
});

// Status endpoint
app.get('/status', (req, res) => {
    res.json({
        running: true,
        ffmpegActive: ffmpegProcess !== null,
        clientCount: clients.size,
        bufferedFrames: frameBuffer.length,
        uptime: process.uptime()
    });
});

// Root endpoint
app.get('/', (req, res) => {
    res.send(`
        <html>
        <head><title>Multi-Client RTSP Proxy</title></head>
        <body style="font-family: monospace; padding: 20px; background: #1a1a1a; color: #e0e0e0;">
            <h1>🎥 Multi-Client RTSP Proxy Server</h1>
            <p>Port: ${PORT}</p>
            <p style="color: #4a9eff;">Connected Clients: ${clients.size}</p>
            <p style="color: #4a9eff;">FFmpeg Status: ${ffmpegProcess ? '🟢 Running' : '🔴 Stopped'}</p>
            <h2>Available Endpoints:</h2>
            <ul>
                <li><a href="/stream.mjpeg" style="color: #4a9eff;">MJPEG Stream</a> - /stream.mjpeg</li>
                <li><a href="/snapshot.jpg" style="color: #4a9eff;">Snapshot</a> - /snapshot.jpg</li>
                <li><a href="/status" style="color: #4a9eff;">Status</a> - /status</li>
            </ul>
            <h2>Features:</h2>
            <ul style="color: #4af542;">
                <li>✅ Supports multiple simultaneous clients</li>
                <li>✅ Shared FFmpeg process (efficient)</li>
                <li>✅ Frame buffering for late joiners</li>
                <li>✅ Automatic restart on failure</li>
                <li>✅ Won't die when ngrok gets hammered!</li>
            </ul>
        </body>
        </html>
    `);
});

// Check for FFmpeg
const checkFFmpeg = spawn('ffmpeg', ['-version']);
checkFFmpeg.on('error', () => {
    log('❌ FFmpeg not found! Please install FFmpeg', 'ERROR');
    process.exit(1);
});

checkFFmpeg.on('close', (code) => {
    if (code === 0) {
        log('✅ FFmpeg is installed', 'SUCCESS');
        
        // Start server
        app.listen(PORT, () => {
            log('═══════════════════════════════════════════', 'INFO');
            log(`🚀 Multi-Client RTSP Proxy Server on port ${PORT}`, 'SUCCESS');
            log('═══════════════════════════════════════════', 'INFO');
            log('', 'INFO');
            log('✨ Features:', 'INFO');
            log('   • Supports unlimited simultaneous viewers', 'INFO');
            log('   • Shared FFmpeg process (CPU efficient)', 'INFO');
            log('   • Frame buffering for smooth playback', 'INFO');
            log('   • Auto-restart on failures', 'INFO');
            log('   • Ready for ngrok exposure!', 'INFO');
            log('', 'INFO');
            log('🌐 Access Points:', 'INFO');
            log(`   Web Interface: http://localhost:${PORT}`, 'INFO');
            log(`   MJPEG Stream:  http://localhost:${PORT}/stream.mjpeg`, 'INFO');
            log(`   Snapshot:      http://localhost:${PORT}/snapshot.jpg`, 'INFO');
            log('', 'INFO');
            log('═══════════════════════════════════════════', 'INFO');
        });
    }
});