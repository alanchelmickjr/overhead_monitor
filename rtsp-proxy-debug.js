#!/usr/bin/env node

/**
 * RTSP to Browser Proxy Server with Debug Logging
 * Converts RTSP streams to browser-viewable formats
 */

const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;

// Enable CORS for all origins
app.use(cors());

// Camera configuration with multiple fallback URLs
const CAMERA_CONFIGS = [
    {
        name: 'Primary Stream (with auth)',
        url: 'rtsp://LeKiwi:LeKiwi995@192.168.88.40:554/stream1',
        priority: 1
    },
    {
        name: 'Primary Stream (no auth)',
        url: 'rtsp://192.168.88.40:554/stream1',
        priority: 2
    },
    {
        name: 'Stream /1',
        url: 'rtsp://192.168.88.40:554/1',
        priority: 3
    },
    {
        name: 'Live Stream',
        url: 'rtsp://192.168.88.40:554/live',
        priority: 4
    },
    {
        name: 'Channel 0',
        url: 'rtsp://192.168.88.40:554/ch0_0.h264',
        priority: 5
    },
    {
        name: 'Main Stream',
        url: 'rtsp://192.168.88.40:554/main',
        priority: 6
    }
];

let currentStream = null;
let activeFFmpeg = null;
let connectionAttempts = 0;
let lastSuccessfulUrl = null;

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

// Test RTSP connection
async function testRTSPConnection(url) {
    return new Promise((resolve) => {
        log(`Testing RTSP URL: ${url}`, 'DEBUG');
        
        const ffprobe = spawn('ffprobe', [
            '-v', 'error',
            '-show_entries', 'stream=width,height,codec_name',
            '-of', 'json',
            '-rtsp_transport', 'tcp',
            '-timeout', '5000000', // 5 seconds
            url
        ]);
        
        let output = '';
        let errorOutput = '';
        
        ffprobe.stdout.on('data', (data) => {
            output += data.toString();
        });
        
        ffprobe.stderr.on('data', (data) => {
            errorOutput += data.toString();
        });
        
        ffprobe.on('close', (code) => {
            if (code === 0) {
                try {
                    const info = JSON.parse(output);
                    log(`✅ Successfully connected to: ${url}`, 'SUCCESS');
                    log(`Stream info: ${JSON.stringify(info.streams[0] || {})}`, 'DEBUG');
                    resolve({ success: true, url, info });
                } catch (e) {
                    resolve({ success: true, url }); // Connected but couldn't parse info
                }
            } else {
                log(`❌ Failed to connect to: ${url}`, 'ERROR');
                if (errorOutput) log(`Error details: ${errorOutput}`, 'DEBUG');
                resolve({ success: false, url, error: errorOutput });
            }
        });
        
        // Timeout after 10 seconds
        setTimeout(() => {
            ffprobe.kill();
            resolve({ success: false, url, error: 'Timeout' });
        }, 10000);
    });
}

// Find working RTSP URL
async function findWorkingStream() {
    log('🔍 Searching for working RTSP stream...', 'INFO');
    
    // Try last successful URL first
    if (lastSuccessfulUrl) {
        const result = await testRTSPConnection(lastSuccessfulUrl);
        if (result.success) {
            return lastSuccessfulUrl;
        }
    }
    
    // Try all configurations
    for (const config of CAMERA_CONFIGS.sort((a, b) => a.priority - b.priority)) {
        const result = await testRTSPConnection(config.url);
        if (result.success) {
            lastSuccessfulUrl = config.url;
            return config.url;
        }
    }
    
    // Try with authentication
    log('Trying with authentication credentials...', 'INFO');
    const credentials = [
        { user: 'LeKiwi', pass: 'LeKiwi995' },  // Primary credentials
        { user: 'admin', pass: 'admin' },
        { user: 'admin', pass: '' },
        { user: 'root', pass: 'admin' },
        { user: 'admin', pass: '12345' }
    ];
    
    for (const cred of credentials) {
        for (const config of CAMERA_CONFIGS) {
            const authUrl = config.url.replace('rtsp://', `rtsp://${cred.user}:${cred.pass}@`);
            const result = await testRTSPConnection(authUrl);
            if (result.success) {
                lastSuccessfulUrl = authUrl;
                return authUrl;
            }
        }
    }
    
    return null;
}

// MJPEG streaming endpoint
app.get('/stream.mjpeg', async (req, res) => {
    log('📹 MJPEG stream requested', 'INFO');
    
    if (activeFFmpeg) {
        log('Killing existing FFmpeg process', 'DEBUG');
        activeFFmpeg.kill();
        activeFFmpeg = null;
    }
    
    // Find working stream
    const rtspUrl = await findWorkingStream();
    
    if (!rtspUrl) {
        log('❌ No working RTSP stream found!', 'ERROR');
        log('Please check:', 'WARNING');
        log('  1. Camera is powered on and connected to network', 'WARNING');
        log('  2. Camera IP is correct: 192.168.88.40', 'WARNING');
        log('  3. RTSP port is open (usually 554)', 'WARNING');
        log('  4. Try testing with VLC: vlc rtsp://192.168.88.40:554/stream1', 'WARNING');
        
        res.status(503).send('No working RTSP stream found');
        return;
    }
    
    log(`🎥 Using RTSP URL: ${rtspUrl}`, 'SUCCESS');
    
    res.writeHead(200, {
        'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Pragma': 'no-cache'
    });
    
    const ffmpegArgs = [
        '-rtsp_transport', 'tcp',
        '-i', rtspUrl,
        '-f', 'mjpeg',
        '-q:v', '5',
        '-r', '15',
        '-s', '1280x720',
        'pipe:1'
    ];
    
    log(`Starting FFmpeg with args: ${ffmpegArgs.join(' ')}`, 'DEBUG');
    
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
        } else if (message.includes('fps=')) {
            // Extract FPS info
            const fpsMatch = message.match(/fps=\s*(\d+)/);
            if (fpsMatch && frameCount % 100 === 0) {
                log(`Current FPS: ${fpsMatch[1]}`, 'DEBUG');
            }
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
    
    const rtspUrl = await findWorkingStream();
    
    if (!rtspUrl) {
        log('❌ No working RTSP stream found for snapshot', 'ERROR');
        res.status(503).send('No working RTSP stream found');
        return;
    }
    
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
            log('✅ Snapshot delivered successfully', 'SUCCESS');
        } else {
            log('❌ Failed to capture snapshot', 'ERROR');
            res.status(500).send('Failed to capture snapshot');
        }
    });
    
    // Timeout after 5 seconds
    setTimeout(() => {
        ffmpeg.kill();
    }, 5000);
});

// Status endpoint
app.get('/status', async (req, res) => {
    log('Status check requested', 'DEBUG');
    
    const workingUrl = await findWorkingStream();
    
    res.json({
        running: true,
        ffmpegActive: activeFFmpeg !== null,
        lastSuccessfulUrl: lastSuccessfulUrl,
        currentWorkingUrl: workingUrl,
        connectionAttempts: connectionAttempts,
        testedUrls: CAMERA_CONFIGS.map(c => c.url)
    });
});

// Root endpoint
app.get('/', (req, res) => {
    res.send(`
        <html>
        <head><title>RTSP Proxy Server</title></head>
        <body style="font-family: monospace; padding: 20px; background: #1a1a1a; color: #e0e0e0;">
            <h1>🎥 RTSP Proxy Server Running</h1>
            <p>Port: ${PORT}</p>
            <h2>Available Endpoints:</h2>
            <ul>
                <li><a href="/stream.mjpeg" style="color: #4a9eff;">MJPEG Stream</a> - /stream.mjpeg</li>
                <li><a href="/snapshot.jpg" style="color: #4a9eff;">Snapshot</a> - /snapshot.jpg</li>
                <li><a href="/status" style="color: #4a9eff;">Status</a> - /status</li>
            </ul>
            <h2>Usage:</h2>
            <pre style="background: #2a2a2a; padding: 10px; border-radius: 4px;">
1. Open camera-viewer-debug.html
2. Select "Via Proxy Server" protocol
3. Click "Connect Camera"
            </pre>
            <h2>Testing Camera:</h2>
            <pre style="background: #2a2a2a; padding: 10px; border-radius: 4px;">
Camera IP: 192.168.88.40
Testing URLs:
${CAMERA_CONFIGS.map(c => `  - ${c.url}`).join('\n')}
            </pre>
        </body>
        </html>
    `);
});

// Check for FFmpeg
const checkFFmpeg = spawn('ffmpeg', ['-version']);
checkFFmpeg.on('error', () => {
    log('❌ FFmpeg not found! Please install FFmpeg:', 'ERROR');
    log('  macOS: brew install ffmpeg', 'ERROR');
    log('  Ubuntu: sudo apt-get install ffmpeg', 'ERROR');
    log('  Windows: Download from https://ffmpeg.org', 'ERROR');
    process.exit(1);
});

checkFFmpeg.on('close', (code) => {
    if (code === 0) {
        log('✅ FFmpeg is installed', 'SUCCESS');
        
        // Start server
        app.listen(PORT, () => {
            log('═══════════════════════════════════════════', 'INFO');
            log(`🚀 RTSP Proxy Server started on port ${PORT}`, 'SUCCESS');
            log('═══════════════════════════════════════════', 'INFO');
            log('', 'INFO');
            log('📹 Camera Configuration:', 'INFO');
            log(`   IP Address: 192.168.88.40`, 'INFO');
            log(`   Testing ${CAMERA_CONFIGS.length} possible RTSP URLs`, 'INFO');
            log('', 'INFO');
            log('🌐 Access Points:', 'INFO');
            log(`   Web Interface: http://localhost:${PORT}`, 'INFO');
            log(`   MJPEG Stream:  http://localhost:${PORT}/stream.mjpeg`, 'INFO');
            log(`   Snapshot:      http://localhost:${PORT}/snapshot.jpg`, 'INFO');
            log('', 'INFO');
            log('📝 OPEN THIS IN YOUR BROWSER:', 'SUCCESS');
            log('', 'INFO');
            log(`   📹 file://${__dirname}/camera-viewer-debug.html`, 'SUCCESS');
            log('', 'INFO');
            log('   Or copy this URL:', 'INFO');
            log(`   file://${__dirname}/camera-viewer-debug.html`, 'INFO');
            log('', 'INFO');
            log('═══════════════════════════════════════════', 'INFO');
        });
    }
});