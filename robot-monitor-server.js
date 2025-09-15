#!/usr/bin/env node

const express = require('express');
const path = require('path');
const cors = require('cors');

// Import frame capture components
const FrameCaptureService = require('./src/camera/FrameCaptureService');
const FrameBufferManager = require('./src/camera/FrameBufferManager');

const app = express();
const PORT = 3000;

// Enable CORS
app.use(cors());
app.use(express.static('.'));

// Initialize frame capture components
const frameCaptureService = new FrameCaptureService();
const frameBufferManager = new FrameBufferManager({
    defaultBufferSize: 50, // Keep last 50 frames
    maxBufferMemory: 100 * 1024 * 1024 // 100MB max memory
});

// Logging
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

// Camera configuration with auth
const CAMERA_URL = 'rtsp://LeKiwi:LeKiwi995@192.168.88.40:554/stream1';
const CAMERA_ID = 'robot-overhead';
let cameraActive = false;
let activeClients = new Map(); // Track active client subscriptions

// Start frame capture
async function startFrameCapture() {
    if (cameraActive) {
        log('Frame capture already running', 'DEBUG');
        return;
    }
    
    log(`🎥 Starting frame capture from authenticated stream`, 'SUCCESS');
    
    // Initialize buffer for camera
    frameBufferManager.initializeBuffer(CAMERA_ID, {
        bufferSize: 50
    });
    
    try {
        await frameCaptureService.startCapture({
            cameraId: CAMERA_ID,
            url: CAMERA_URL,
            ffmpegOptions: {
                fps: 15,
                resolution: '1280x720',
                quality: 5
            },
            metadata: {
                source: 'robot-monitor',
                authenticated: true
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
    if (activeClients.size === 0 && cameraActive) {
        log('No clients connected, stopping frame capture', 'INFO');
        await frameCaptureService.stopCapture(CAMERA_ID);
        frameBufferManager.clearBuffer(CAMERA_ID);
        cameraActive = false;
    }
}

// Main page - serve the camera viewer directly
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'camera-viewer-debug.html'));
});

// MJPEG streaming endpoint - integrated into same server
app.get('/stream.mjpeg', async (req, res) => {
    const clientId = `client-${req.ip}-${Date.now()}`;
    log(`📹 MJPEG stream requested by ${clientId}`, 'INFO');
    
    res.writeHead(200, {
        'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Pragma': 'no-cache'
    });
    
    // Start frame capture if needed
    if (!cameraActive) {
        try {
            await startFrameCapture();
        } catch (error) {
            log(`Failed to start capture: ${error.message}`, 'ERROR');
            res.status(500).send('Failed to start camera');
            return;
        }
    }
    
    let frameCount = 0;
    
    // Subscribe to frame buffer
    const subscription = frameBufferManager.subscribe({
        subscriberId: clientId,
        cameraIds: [CAMERA_ID],
        mode: 'both', // Get both live and buffered frames
        bufferReplayCount: 10, // Send last 10 frames to new client
        callback: (frame) => {
            try {
                if (!res.writable || res.destroyed || res.finished) {
                    return;
                }
                
                res.write(`--frame\r\n`);
                res.write(`Content-Type: image/jpeg\r\n`);
                res.write(`Content-Length: ${frame.data.length}\r\n\r\n`);
                res.write(frame.data);
                res.write('\r\n');
                
                frameCount++;
                if (frameCount % 30 === 0) {
                    log(`Streamed ${frameCount} frames to ${clientId}`, 'DEBUG');
                }
            } catch (error) {
                log(`Error writing frame to client ${clientId}: ${error.message}`, 'DEBUG');
            }
        }
    });
    
    // Track active client
    activeClients.set(clientId, subscription);
    
    // Handle client disconnect
    const cleanup = () => {
        log(`Client disconnected: ${clientId}`, 'INFO');
        
        // Unsubscribe from frame buffer
        frameBufferManager.unsubscribe(clientId);
        activeClients.delete(clientId);
        
        // Try to end response properly
        try {
            if (!res.destroyed && !res.finished && !res.headersSent) {
                res.status(500).send('Stream ended');
            }
        } catch (err) {
            // Already closed
        }
        
        // Delay stopping frame capture to handle quick reconnects
        setTimeout(stopFrameCaptureIfNoClients, 3000);
    };
    
    req.on('close', cleanup);
    req.on('aborted', cleanup);
    res.on('close', cleanup);
    res.on('error', cleanup);
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
            '-i', CAMERA_URL,
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
                log('✅ Fresh snapshot delivered successfully', 'SUCCESS');
            } else {
                log('❌ Failed to capture snapshot', 'ERROR');
                res.status(500).send('Failed to capture snapshot');
            }
        });
        
        setTimeout(() => {
            ffmpeg.kill();
        }, 5000);
    }
});

// Status endpoint
app.get('/status', (req, res) => {
    const captureStatus = frameCaptureService.getCaptureStatus(CAMERA_ID);
    const bufferStats = frameBufferManager.getBufferStats(CAMERA_ID);
    
    res.json({
        running: true,
        ffmpegActive: cameraActive && captureStatus.isCapturing,
        cameraUrl: 'rtsp://192.168.88.40:554/stream1',
        authenticated: true,
        activeClients: activeClients.size,
        frameCapture: captureStatus,
        bufferStats: bufferStats
    });
});

// Proxy endpoints for compatibility
app.get('/proxy-status', (req, res) => {
    res.json({
        proxyRunning: true,
        integrated: true,
        port: PORT,
        enhanced: true,
        frameBuffering: true
    });
});

// Buffer statistics endpoint
app.get('/buffer-stats', (req, res) => {
    const stats = frameBufferManager.getStatistics();
    res.json(stats);
});

// Initialize frame capture service event handlers
frameCaptureService.on('frame', (frame) => {
    // Add frame to buffer manager
    frameBufferManager.addFrame(frame);
});

frameCaptureService.on('error', (error) => {
    log(`Frame capture error: ${error.error.message}`, 'ERROR');
});

frameCaptureService.on('capture-ended', async (event) => {
    log(`Capture ended with code ${event.code}`, 'WARNING');
    cameraActive = false;
    
    // Try to restart if clients are still connected
    if (activeClients.size > 0 && event.code !== 0) {
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
        console.error('❌ FFmpeg not found! Please install FFmpeg');
        process.exit(1);
    }
    
    // Start server
    app.listen(PORT, () => {
        console.log('\n🚀 Robot Overhead Monitor - Enhanced All-in-One Server');
        console.log('═══════════════════════════════════════════════════════');
        console.log(`📹 Camera Interface: http://localhost:${PORT}`);
        console.log(`🔄 MJPEG Stream: http://localhost:${PORT}/stream.mjpeg`);
        console.log(`📸 Snapshot: http://localhost:${PORT}/snapshot.jpg`);
        console.log(`📊 Status: http://localhost:${PORT}/status`);
        console.log('═══════════════════════════════════════════════════════');
        console.log('\n✨ Enhanced Features:');
        console.log('  • Frame capture and buffering for AI analysis');
        console.log('  • Multi-client support with subscriptions');
        console.log('  • Automatic reconnection handling');
        console.log('  • Memory-efficient circular buffers');
        console.log('\n🔐 Camera Credentials:');
        console.log('  Username: LeKiwi');
        console.log('  Password: LeKiwi995');
        console.log('  RTSP URL: rtsp://192.168.88.40:554/stream1');
        console.log('\n✅ Enhanced camera feed ready for AI and tele-operators!');
        console.log(`✅ Open http://localhost:${PORT} in your browser\n`);
    });
})();

// Graceful shutdown
process.on('SIGINT', async () => {
    log('\nShutting down gracefully...', 'INFO');
    
    // Stop frame capture
    await frameCaptureService.stopAll();
    
    // Clear buffers
    frameBufferManager.destroy();
    
    // Close all client connections
    for (const [clientId, subscription] of activeClients) {
        frameBufferManager.unsubscribe(clientId);
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