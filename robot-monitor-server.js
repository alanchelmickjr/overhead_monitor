#!/usr/bin/env node

const express = require('express');
const path = require('path');
const { spawn } = require('child_process');
const cors = require('cors');

const app = express();
const PORT = 3000;

// Enable CORS
app.use(cors());
app.use(express.static('.'));

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
let activeFFmpeg = null;

// Main page - serve the camera viewer directly
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'camera-viewer-debug.html'));
});

// MJPEG streaming endpoint - integrated into same server
app.get('/stream.mjpeg', async (req, res) => {
    log('📹 MJPEG stream requested', 'INFO');
    
    if (activeFFmpeg) {
        log('Killing existing FFmpeg process', 'DEBUG');
        activeFFmpeg.kill();
        activeFFmpeg = null;
    }
    
    log(`🎥 Using authenticated RTSP URL`, 'SUCCESS');
    
    res.writeHead(200, {
        'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Pragma': 'no-cache'
    });
    
    const ffmpegArgs = [
        '-rtsp_transport', 'tcp',
        '-i', CAMERA_URL,
        '-f', 'mjpeg',
        '-q:v', '5',
        '-r', '15',
        '-s', '1280x720',
        'pipe:1'
    ];
    
    log(`Starting FFmpeg with authenticated stream`, 'DEBUG');
    
    activeFFmpeg = spawn('ffmpeg', ffmpegArgs);
    
    let frameBuffer = Buffer.alloc(0);
    let frameCount = 0;
    
    activeFFmpeg.stdout.on('data', (chunk) => {
        frameBuffer = Buffer.concat([frameBuffer, chunk]);
        
        // Look for JPEG start and end markers
        let startIndex = frameBuffer.indexOf(Buffer.from([0xFF, 0xD8]));
        let endIndex = frameBuffer.indexOf(Buffer.from([0xFF, 0xD9]));
        
        while (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
            const frame = frameBuffer.slice(startIndex, endIndex + 2);
            
            res.write(`--frame\r\n`);
            res.write(`Content-Type: image/jpeg\r\n`);
            res.write(`Content-Length: ${frame.length}\r\n\r\n`);
            res.write(frame);
            res.write('\r\n');
            
            frameCount++;
            if (frameCount % 30 === 0) {
                log(`Streamed ${frameCount} frames`, 'DEBUG');
            }
            
            frameBuffer = frameBuffer.slice(endIndex + 2);
            startIndex = frameBuffer.indexOf(Buffer.from([0xFF, 0xD8]));
            endIndex = frameBuffer.indexOf(Buffer.from([0xFF, 0xD9]));
        }
    });
    
    activeFFmpeg.stderr.on('data', (data) => {
        const message = data.toString();
        if (message.includes('error') || message.includes('Error')) {
            log(`FFmpeg error: ${message}`, 'ERROR');
        }
    });
    
    activeFFmpeg.on('close', (code) => {
        log(`FFmpeg process ended with code ${code}`, code === 0 ? 'INFO' : 'ERROR');
        if (!res.headersSent) {
            res.status(500).send('Stream ended');
        }
        activeFFmpeg = null;
    });
    
    req.on('close', () => {
        log('Client disconnected from MJPEG stream', 'INFO');
        if (activeFFmpeg) {
            activeFFmpeg.kill();
            activeFFmpeg = null;
        }
    });
});

// Snapshot endpoint
app.get('/snapshot.jpg', async (req, res) => {
    log('📸 Snapshot requested', 'INFO');
    
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
            log('✅ Snapshot delivered successfully', 'SUCCESS');
        } else {
            log('❌ Failed to capture snapshot', 'ERROR');
            res.status(500).send('Failed to capture snapshot');
        }
    });
    
    setTimeout(() => {
        ffmpeg.kill();
    }, 5000);
});

// Status endpoint
app.get('/status', (req, res) => {
    res.json({
        running: true,
        ffmpegActive: activeFFmpeg !== null,
        cameraUrl: 'rtsp://192.168.88.40:554/stream1',
        authenticated: true
    });
});

// Proxy endpoints for compatibility
app.get('/proxy-status', (req, res) => {
    res.json({
        proxyRunning: true,
        integrated: true,
        port: PORT
    });
});

// Start server
app.listen(PORT, () => {
    console.log('\n🚀 Robot Overhead Monitor - All-in-One Server');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`📹 Camera Interface: http://localhost:${PORT}`);
    console.log(`🔄 MJPEG Stream: http://localhost:${PORT}/stream.mjpeg`);
    console.log(`📸 Snapshot: http://localhost:${PORT}/snapshot.jpg`);
    console.log('═══════════════════════════════════════════════════════');
    console.log('\n🔐 Camera Credentials:');
    console.log('  Username: LeKiwi');
    console.log('  Password: LeKiwi995');
    console.log('  RTSP URL: rtsp://192.168.88.40:554/stream1');
    console.log('\n✅ Camera feed authenticated and ready!');
    console.log(`✅ Open http://localhost:${PORT} in your browser\n`);
});