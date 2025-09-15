#!/usr/bin/env node

/**
 * Multi-Client RTSP to Browser Proxy Server
 * Enhanced with frame capture and buffering for AI analysis and multi-operator support
 */

const express = require('express');
const cors = require('cors');
const fs = require('fs');
require('dotenv').config();

// Import frame capture components
const FrameCaptureService = require('./src/camera/FrameCaptureService');
const FrameBufferManager = require('./src/camera/FrameBufferManager');

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

// Initialize frame capture components
const frameCaptureService = new FrameCaptureService();
const frameBufferManager = new FrameBufferManager({
    defaultBufferSize: 100, // Keep last 100 frames per camera
    maxBufferMemory: 200 * 1024 * 1024 // 200MB max memory
});

// Client management
let clients = new Map(); // Map of clientId -> response object
let cameraActive = false;
const CAMERA_ID = 'main-camera';
const RTSP_URL = 'rtsp://LeKiwi:LeKiwi995@192.168.88.40:554/stream1';

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

// Start frame capture (shared by all clients)
async function startFrameCapture() {
    if (cameraActive) {
        log('Frame capture already running', 'DEBUG');
        return;
    }
    
    log(`🎥 Starting frame capture from: ${RTSP_URL}`, 'SUCCESS');
    
    // Initialize buffer for camera
    frameBufferManager.initializeBuffer(CAMERA_ID, {
        bufferSize: 100
    });
    
    // Start capturing frames
    try {
        await frameCaptureService.startCapture({
            cameraId: CAMERA_ID,
            url: RTSP_URL,
            ffmpegOptions: {
                fps: 15,
                resolution: '1280x720',
                quality: 5
            },
            metadata: {
                source: 'rtsp-proxy',
                location: 'overhead'
            }
        });
        
        cameraActive = true;
        log('Frame capture started successfully', 'SUCCESS');
    } catch (error) {
        log(`Failed to start frame capture: ${error.message}`, 'ERROR');
        cameraActive = false;
        throw error;
    }
}

// Stop frame capture if no clients
async function stopFrameCaptureIfNoClients() {
    // Clean up disconnected clients
    for (const [clientId, res] of clients) {
        if (res.destroyed || res.finished || !res.writable) {
            clients.delete(clientId);
            frameBufferManager.unsubscribe(clientId);
        }
    }
    
    if (clients.size === 0 && cameraActive) {
        log('No clients connected, stopping frame capture', 'INFO');
        await frameCaptureService.stopCapture(CAMERA_ID);
        frameBufferManager.clearBuffer(CAMERA_ID);
        cameraActive = false;
    }
}

// MJPEG streaming endpoint
app.get('/stream.mjpeg', (req, res) => {
    const clientId = `client-${req.ip}-${Date.now()}`;
    log(`📹 New client connected: ${clientId} (Total: ${clients.size + 1})`, 'INFO');
    
    res.writeHead(200, {
        'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Pragma': 'no-cache'
    });
    
    // Add client to map
    clients.set(clientId, res);
    
    // Subscribe to frame buffer
    const subscription = frameBufferManager.subscribe({
        subscriberId: clientId,
        cameraIds: [CAMERA_ID],
        mode: 'both', // Get both live and buffered frames
        bufferReplayCount: 30, // Send last 30 frames to new client
        callback: (frame) => {
            try {
                if (!res.writable || res.destroyed || res.finished) {
                    return;
                }
                
                const boundary = `--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.data.length}\r\n\r\n`;
                res.write(Buffer.from(boundary));
                res.write(frame.data);
                res.write(Buffer.from('\r\n'));
            } catch (error) {
                log(`Error writing frame to client ${clientId}: ${error.message}`, 'DEBUG');
            }
        }
    });
    
    // Start frame capture if needed
    if (!cameraActive) {
        startFrameCapture().catch(error => {
            log(`Failed to start capture: ${error.message}`, 'ERROR');
            res.status(500).send('Failed to start camera');
        });
    }
    
    // Handle client disconnect
    const cleanup = () => {
        if (clients.has(clientId)) {
            clients.delete(clientId);
            frameBufferManager.unsubscribe(clientId);
            log(`Client disconnected: ${clientId} (Remaining: ${clients.size})`, 'INFO');
            
            // Try to end response properly
            try {
                if (!res.destroyed && !res.finished) {
                    res.end();
                }
            } catch (err) {
                // Already closed
            }
            
            // Delay stopping frame capture to handle quick reconnects
            setTimeout(stopFrameCaptureIfNoClients, 5000);
        }
    };
    
    // Multiple disconnect handlers for reliability
    req.on('close', cleanup);
    req.on('aborted', cleanup);
    res.on('close', cleanup);
    res.on('error', (err) => {
        log(`Client response error: ${err.message}`, 'DEBUG');
        cleanup();
    });
    res.on('finish', cleanup);
});

// Snapshot endpoint
app.get('/snapshot.jpg', async (req, res) => {
    log('📸 Snapshot requested', 'INFO');
    
    // Try to get latest frame from buffer
    const latestFrame = frameBufferManager.getLatestFrame(CAMERA_ID);
    
    if (latestFrame && latestFrame.data) {
        // Use buffered frame
        res.writeHead(200, {
            'Content-Type': 'image/jpeg',
            'Content-Length': latestFrame.data.length,
            'Cache-Control': 'no-cache',
            'X-Frame-Timestamp': latestFrame.timestamp,
            'X-Frame-Sequence': latestFrame.sequenceNumber
        });
        res.end(latestFrame.data);
        log('✅ Snapshot delivered from buffer', 'SUCCESS');
    } else {
        // No buffered frames, capture fresh one
        log('No buffered frames, capturing fresh snapshot', 'INFO');
        
        const { spawn } = require('child_process');
        const ffmpeg = spawn('ffmpeg', [
            '-rtsp_transport', 'tcp',
            '-i', RTSP_URL,
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

// SmolVLM proxy endpoint to avoid CORS
app.use(express.json({ limit: '10mb' }));
app.post('/analyze', async (req, res) => {
    log('🧠 SmolVLM analysis requested', 'INFO');
    
    const { image, prompt, apiUrl } = req.body;
    const url = apiUrl || 'http://localhost:8080/v1/chat/completions';
    
    try {
        // Import axios dynamically
        const axios = require('axios');
        
        const response = await axios.post(url, {
            model: 'smolvlm-instruct',
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
        log('✅ SmolVLM analysis completed', 'SUCCESS');
        
    } catch (error) {
        const errorDetails = error.response?.data || error.message || 'Unknown error';
        log(`❌ SmolVLM error: ${JSON.stringify(errorDetails)}`, 'ERROR');
        
        // Check if it's a connection error
        if (error.code === 'ECONNREFUSED') {
            log('SmolVLM server not running on ' + url, 'ERROR');
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
    const captureStatus = frameCaptureService.getCaptureStatus(CAMERA_ID);
    const bufferStats = frameBufferManager.getBufferStats(CAMERA_ID);
    
    res.json({
        running: true,
        ffmpegActive: cameraActive && captureStatus.isCapturing,
        clientCount: clients.size,
        frameCapture: captureStatus,
        bufferStats: bufferStats,
        memory: frameBufferManager.getStatistics(),
        uptime: process.uptime()
    });
});

// Buffer statistics endpoint
app.get('/buffer-stats', (req, res) => {
    const stats = frameBufferManager.getStatistics();
    res.json(stats);
});

// Frame history endpoint
app.get('/frames/:count?', (req, res) => {
    const count = parseInt(req.params.count) || 10;
    const frames = frameBufferManager.getFrames(CAMERA_ID, count, true);
    
    res.json({
        count: frames.length,
        frames: frames.map(f => ({
            id: f.id,
            timestamp: f.timestamp,
            sequenceNumber: f.sequenceNumber,
            size: f.data.length,
            metadata: f.metadata
        }))
    });
});

// Root endpoint
app.get('/', (req, res) => {
    const stats = frameBufferManager.getStatistics();
    const captureStatus = frameCaptureService.getCaptureStatus(CAMERA_ID);
    
    res.send(`
        <html>
        <head><title>Enhanced Multi-Client RTSP Proxy</title></head>
        <body style="font-family: monospace; padding: 20px; background: #1a1a1a; color: #e0e0e0;">
            <h1>🎥 Enhanced RTSP Proxy with AI Support</h1>
            <p>Port: ${PORT}</p>
            <p style="color: #4a9eff;">Connected Clients: ${clients.size}</p>
            <p style="color: #4a9eff;">Frame Capture: ${captureStatus.isCapturing ? '🟢 Running' : '🔴 Stopped'}</p>
            <p style="color: #4a9eff;">Frames Captured: ${captureStatus.framesProcessed}</p>
            <p style="color: #4a9eff;">Buffer Memory: ${(stats.totalMemoryUsage / 1024 / 1024).toFixed(2)} MB</p>
            
            <h2>Available Endpoints:</h2>
            <ul>
                <li><a href="/stream.mjpeg" style="color: #4a9eff;">MJPEG Stream</a> - /stream.mjpeg</li>
                <li><a href="/snapshot.jpg" style="color: #4a9eff;">Snapshot</a> - /snapshot.jpg</li>
                <li><a href="/status" style="color: #4a9eff;">Status</a> - /status</li>
                <li><a href="/buffer-stats" style="color: #4a9eff;">Buffer Statistics</a> - /buffer-stats</li>
                <li><a href="/frames/30" style="color: #4a9eff;">Frame History</a> - /frames/:count</li>
            </ul>
            
            <h2>Enhanced Features:</h2>
            <ul style="color: #4af542;">
                <li>✅ Advanced frame capture and buffering</li>
                <li>✅ AI-ready frame distribution</li>
                <li>✅ Memory-efficient circular buffers</li>
                <li>✅ Multi-client subscription model</li>
                <li>✅ Frame history and replay</li>
                <li>✅ Performance monitoring</li>
                <li>✅ Automatic resource management</li>
            </ul>
        </body>
        </html>
    `);
});

// Initialize frame capture service event handlers
frameCaptureService.on('frame', (frame) => {
    // Add frame to buffer manager
    frameBufferManager.addFrame(frame);
});

frameCaptureService.on('error', (error) => {
    log(`Frame capture error for ${error.cameraId}: ${error.error.message}`, 'ERROR');
});

frameCaptureService.on('capture-ended', async (event) => {
    log(`Capture ended for ${event.cameraId} with code ${event.code}`, 'WARNING');
    cameraActive = false;
    
    // Try to restart if clients are still connected
    if (clients.size > 0 && event.code !== 0) {
        log('Attempting to restart capture for connected clients...', 'INFO');
        setTimeout(() => {
            startFrameCapture().catch(err => {
                log(`Failed to restart capture: ${err.message}`, 'ERROR');
            });
        }, 3000);
    }
});

// Check for FFmpeg availability
(async () => {
    const ffmpegAvailable = await FrameCaptureService.checkFFmpegAvailable();
    
    if (!ffmpegAvailable) {
        log('❌ FFmpeg not found! Please install FFmpeg', 'ERROR');
        process.exit(1);
    }
    
    log('✅ FFmpeg is installed', 'SUCCESS');
    
    // Start server
    app.listen(PORT, () => {
        log('═══════════════════════════════════════════', 'INFO');
        log(`🚀 Enhanced RTSP Proxy Server on port ${PORT}`, 'SUCCESS');
        log('═══════════════════════════════════════════', 'INFO');
        log('', 'INFO');
        log('✨ Enhanced Features:', 'INFO');
        log('   • AI-ready frame capture and distribution', 'INFO');
        log('   • Advanced frame buffering and management', 'INFO');
        log('   • Multi-operator support with subscriptions', 'INFO');
        log('   • Memory-efficient circular buffers', 'INFO');
        log('   • Frame history and replay capabilities', 'INFO');
        log('   • Performance monitoring and statistics', 'INFO');
        log('', 'INFO');
        log('🌐 Access Points:', 'INFO');
        log(`   Web Interface: http://localhost:${PORT}`, 'INFO');
        log(`   MJPEG Stream:  http://localhost:${PORT}/stream.mjpeg`, 'INFO');
        log(`   Snapshot:      http://localhost:${PORT}/snapshot.jpg`, 'INFO');
        log('', 'INFO');
        log('═══════════════════════════════════════════', 'INFO');
    });
})();

// Graceful shutdown
process.on('SIGINT', async () => {
    log('\nShutting down gracefully...', 'INFO');
    
    // Stop all captures
    await frameCaptureService.stopAll();
    
    // Clear all buffers
    frameBufferManager.destroy();
    
    // Close all client connections
    for (const [clientId, res] of clients) {
        try {
            if (!res.destroyed && !res.finished) {
                res.end();
            }
        } catch (err) {
            // Ignore errors during shutdown
        }
    }
    
    process.exit(0);
});

// Handle uncaught errors
process.on('uncaughtException', (error) => {
    log(`Uncaught exception: ${error.message}`, 'ERROR');
    console.error(error);
});

process.on('unhandledRejection', (reason, promise) => {
    log(`Unhandled rejection at: ${promise}, reason: ${reason}`, 'ERROR');
});