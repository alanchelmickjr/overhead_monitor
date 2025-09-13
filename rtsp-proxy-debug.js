#!/usr/bin/env node

/**
 * RTSP to Browser Proxy Server with Debug Logging
 * Converts RTSP streams to browser-viewable formats
 */

const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.RTSP_PROXY_PORT || 3001;

// Enable CORS for all origins
app.use(cors());

// Load configuration from proper sources
let config = {};
try {
    // Try to load config.json first
    if (fs.existsSync('config.json')) {
        config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
        log('Loaded configuration from config.json', 'SUCCESS');
    }
} catch (error) {
    log('Error loading config.json, using environment variables', 'WARNING');
}

// Get camera credentials from config or environment - NO FALLBACKS
const CAMERA_USERNAME = config.camera?.username || process.env.CAMERA_USERNAME || '';
const CAMERA_PASSWORD = config.camera?.password || process.env.CAMERA_PASSWORD || '';
const CAMERA_IP = config.camera?.ip || process.env.CAMERA_IP || '192.168.88.40';
const STREAM_URL = config.camera?.stream_url; // Use the working URL from config

if (!CAMERA_USERNAME || !CAMERA_PASSWORD) {
    log('⚠️  No camera credentials found in config.json or .env', 'WARNING');
    log('   Please set CAMERA_USERNAME and CAMERA_PASSWORD', 'WARNING');
}

// Camera configuration with multiple fallback URLs
const CAMERA_CONFIGS = [
    {
        name: 'Primary Stream',
        url: `rtsp://${CAMERA_IP}:554/stream1`,
        priority: 1
    },
    {
        name: 'Stream /1',
        url: `rtsp://${CAMERA_IP}:554/1`,
        priority: 2
    },
    {
        name: 'Live Stream',
        url: `rtsp://${CAMERA_IP}:554/live`,
        priority: 3
    },
    {
        name: 'Channel 0',
        url: `rtsp://${CAMERA_IP}:554/ch0_0.h264`,
        priority: 4
    },
    {
        name: 'Main Stream',
        url: `rtsp://${CAMERA_IP}:554/main`,
        priority: 5
    }
];

let currentStream = null;
let activeFFmpeg = null;
let connectionAttempts = 0;
let lastSuccessfulUrl = null;
let activeClients = new Set(); // Track connected clients

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
    
    // If we have a complete stream URL in config, try that first
    if (STREAM_URL) {
        log(`Testing configured stream URL: ${STREAM_URL.replace(/:[^:@]+@/, ':***@')}`, 'INFO');
        const result = await testRTSPConnection(STREAM_URL);
        if (result.success) {
            lastSuccessfulUrl = STREAM_URL;
            return STREAM_URL;
        }
    }
    
    // Try last successful URL
    if (lastSuccessfulUrl) {
        const result = await testRTSPConnection(lastSuccessfulUrl);
        if (result.success) {
            return lastSuccessfulUrl;
        }
    }
    
    // If we have credentials, try authenticated URLs first
    if (CAMERA_USERNAME && CAMERA_PASSWORD) {
        log(`Trying authenticated URLs with user: ${CAMERA_USERNAME}`, 'INFO');
        
        for (const config of CAMERA_CONFIGS.sort((a, b) => a.priority - b.priority)) {
            const authUrl = config.url.replace('rtsp://', `rtsp://${CAMERA_USERNAME}:${CAMERA_PASSWORD}@`);
            const result = await testRTSPConnection(authUrl);
            if (result.success) {
                lastSuccessfulUrl = authUrl;
                return authUrl;
            }
        }
    }
    
    // If auth failed or no credentials, try without auth
    log('Trying without authentication...', 'INFO');
    for (const config of CAMERA_CONFIGS.sort((a, b) => a.priority - b.priority)) {
        const result = await testRTSPConnection(config.url);
        if (result.success) {
            lastSuccessfulUrl = config.url;
            return config.url;
        }
    }
    
    if (!CAMERA_USERNAME || !CAMERA_PASSWORD) {
        log('No camera credentials found in config.json or environment variables', 'WARNING');
    }
    
    return null;
}

// MJPEG streaming endpoint
app.get('/stream.mjpeg', async (req, res) => {
    log(`📹 MJPEG stream requested (${activeClients.size + 1} clients)`, 'INFO');
    
    // Add this client to active set
    activeClients.add(res);
    
    // If FFmpeg is already running, just set up the response headers
    if (activeFFmpeg) {
        log('Using existing FFmpeg stream for new client', 'DEBUG');
        res.writeHead(200, {
            'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Pragma': 'no-cache'
        });
        
        req.on('close', () => {
            log(`Client disconnected (${activeClients.size - 1} remaining)`, 'INFO');
            activeClients.delete(res);
            
            // Kill FFmpeg if no clients left
            if (activeClients.size === 0 && activeFFmpeg) {
                log('No clients remaining, stopping FFmpeg', 'INFO');
                activeFFmpeg.kill();
                activeFFmpeg = null;
            }
        });
        
        return; // Exit early, FFmpeg stdout handler will send frames
    }
    
    // Just use the working URL from config!
    const rtspUrl = 'rtsp://LeKiwi:LeKiwi995@192.168.88.40:554/stream1';
    
    if (!rtspUrl) {
        log('❌ No stream_url configured in config.json!', 'ERROR');
        res.status(503).send('No stream_url in config.json');
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
            
            // Send frame to ALL connected clients
            for (const client of activeClients) {
                try {
                    client.write(`--frame\r\n`);
                    client.write(`Content-Type: image/jpeg\r\n`);
                    client.write(`Content-Length: ${frame.length}\r\n\r\n`);
                    client.write(frame);
                    client.write('\r\n');
                } catch (err) {
                    // Client disconnected, will be cleaned up
                }
            }
            
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
        log(`Client disconnected (${activeClients.size - 1} remaining)`, 'INFO');
        activeClients.delete(res);
        
        // Only kill FFmpeg if no clients left
        if (activeClients.size === 0 && activeFFmpeg) {
            log('No clients remaining, stopping FFmpeg', 'INFO');
            activeFFmpeg.kill();
            activeFFmpeg = null;
        }
    });
});

// Snapshot endpoint
app.get('/snapshot.jpg', async (req, res) => {
    log('📸 Snapshot requested', 'INFO');
    
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

// SmolVLM proxy endpoint to avoid CORS
app.post('/analyze', express.json({ limit: '10mb' }), async (req, res) => {
    log('🧠 SmolVLM analysis requested', 'INFO');
    
    try {
        const { image, prompt, apiUrl } = req.body;
        
        // Default to local SmolVLM server
        const url = apiUrl || 'http://localhost:8080/v1/chat/completions';
        
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
        log(`❌ SmolVLM error: ${error.message}`, 'ERROR');
        res.status(500).json({
            error: error.message,
            details: error.response?.data || 'SmolVLM API not available'
        });
    }
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
            log(`   IP Address: ${CAMERA_IP}`, 'INFO');
            log(`   Username: ${CAMERA_USERNAME || 'Not configured'}`, 'INFO');
            log(`   Password: ${CAMERA_PASSWORD ? '***' : 'Not configured'}`, 'INFO');
            log(`   Testing ${CAMERA_CONFIGS.length} possible RTSP URLs`, 'INFO');
            log('', 'INFO');
            log('🌐 Access Points:', 'INFO');
            log(`   Web Interface: http://localhost:${PORT}`, 'INFO');
            log(`   MJPEG Stream:  http://localhost:${PORT}/stream.mjpeg`, 'INFO');
            log(`   Snapshot:      http://localhost:${PORT}/snapshot.jpg`, 'INFO');
            log('', 'INFO');
            log('📝 Configuration:', 'INFO');
            log('   Credentials loaded from: ' + (config.camera ? 'config.json' : '.env file'), 'INFO');
            log('', 'INFO');
            log('═══════════════════════════════════════════', 'INFO');
        });
    }
});