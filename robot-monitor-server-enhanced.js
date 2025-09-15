#!/usr/bin/env node

const express = require('express');
const path = require('path');
const { spawn } = require('child_process');
const cors = require('cors');
const bodyParser = require('body-parser');
const fetch = require('node-fetch');

// Import our vision components
const VisionEngine = require('./src/vision/VisionEngine');
const ModelSelector = require('./src/vision/ModelSelector');

const app = express();
const PORT = 3001;

// Enable CORS and body parsing
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(express.static('public'));

// Initialize Vision Engine and Model Selector
const visionEngine = new VisionEngine({
    base_url: process.env.VISION_API_URL || 'http://localhost:8080',
    api_path: '/v1/chat/completions'
});

const modelSelector = new ModelSelector(visionEngine);

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
const CAMERA_URL = process.env.CAMERA_URL || 'rtsp://LeKiwi:LeKiwi995@192.168.88.40:554/stream1';
let activeFFmpeg = null;

// Main page - serve the enhanced robot monitor
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Model Management Endpoints

// Get available models
app.get('/models', async (req, res) => {
    try {
        const models = modelSelector.getAvailableModels();
        const current = modelSelector.getCurrentModel();
        
        res.json({
            models,
            current,
            hardware: visionEngine.hardwareProfile
        });
    } catch (error) {
        log(`Error getting models: ${error.message}`, 'ERROR');
        res.status(500).json({ error: error.message });
    }
});

// Switch model
app.post('/models/switch', async (req, res) => {
    try {
        const { modelId } = req.body;
        if (!modelId) {
            return res.status(400).json({ error: 'Model ID required' });
        }
        
        log(`Switching to model: ${modelId}`, 'INFO');
        const result = await modelSelector.switchModel(modelId);
        
        if (result.success) {
            res.json(result);
        } else {
            res.status(400).json(result);
        }
    } catch (error) {
        log(`Error switching model: ${error.message}`, 'ERROR');
        res.status(500).json({ error: error.message });
    }
});

// Benchmark models
app.post('/models/benchmark', async (req, res) => {
    try {
        const { testFrame } = req.body;
        if (!testFrame) {
            return res.status(400).json({ error: 'Test frame required' });
        }
        
        log('Starting model benchmark...', 'INFO');
        
        // Convert base64 to frame data
        const frameData = {
            timestamp: new Date().toISOString(),
            cameraId: 'benchmark',
            data: testFrame
        };
        
        const results = await modelSelector.benchmarkAllModels(frameData);
        
        log(`Benchmark complete. Best model: ${results.bestModel}`, 'SUCCESS');
        res.json(results);
        
    } catch (error) {
        log(`Error during benchmark: ${error.message}`, 'ERROR');
        res.status(500).json({ error: error.message });
    }
});

// Compare models
app.post('/models/compare', async (req, res) => {
    try {
        const { model1, model2, testFrame } = req.body;
        if (!model1 || !model2 || !testFrame) {
            return res.status(400).json({ error: 'Two model IDs and test frame required' });
        }
        
        log(`Comparing models: ${model1} vs ${model2}`, 'INFO');
        
        // Convert base64 to frame data
        const frameData = {
            timestamp: new Date().toISOString(),
            cameraId: 'compare',
            data: testFrame
        };
        
        const comparison = await modelSelector.compareModels(model1, model2, frameData);
        
        log(`Comparison complete. Winner: ${comparison.winner}`, 'SUCCESS');
        res.json(comparison);
        
    } catch (error) {
        log(`Error comparing models: ${error.message}`, 'ERROR');
        res.status(500).json({ error: error.message });
    }
});

// Vision Analysis Endpoint
app.post('/analyze', async (req, res) => {
    try {
        const { image, prompt, apiUrl, model } = req.body;
        
        if (!image || !prompt) {
            return res.status(400).json({ error: 'Image and prompt required' });
        }
        
        log(`Analyzing image with model: ${model || 'default'}`, 'INFO');
        
        // Override API URL if provided
        if (apiUrl && apiUrl !== visionEngine.baseUrl) {
            visionEngine.baseUrl = apiUrl;
        }
        
        // Create frame data
        const frameData = {
            timestamp: new Date().toISOString(),
            cameraId: 'manual',
            data: image
        };
        
        // Analyze with specified model
        const analysis = await visionEngine.analyzeFrame(frameData, prompt, { model });
        
        // Format response to match expected structure
        const response = {
            choices: [{
                message: {
                    content: analysis.content
                }
            }],
            model: analysis.modelId,
            usage: {
                processing_time: analysis.processingTime
            }
        };
        
        res.json(response);
        
    } catch (error) {
        log(`Error during analysis: ${error.message}`, 'ERROR');
        res.status(500).json({ 
            error: error.message,
            details: error.stack 
        });
    }
});

// MJPEG streaming endpoint
app.get('/stream.mjpeg', async (req, res) => {
    log('📹 MJPEG stream requested', 'INFO');
    
    if (activeFFmpeg) {
        log('Killing existing FFmpeg process', 'DEBUG');
        activeFFmpeg.kill();
        activeFFmpeg = null;
    }
    
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
        cameraUrl: CAMERA_URL.replace(/:[^:@]+@/, ':****@'), // Hide password
        visionEngine: {
            status: visionEngine.status,
            currentModel: visionEngine.getCurrentModel(),
            statistics: visionEngine.getStatistics()
        }
    });
});

// Model performance endpoint
app.get('/models/performance', (req, res) => {
    const allPerformance = {};
    const models = modelSelector.getAvailableModels();
    
    models.forEach(model => {
        allPerformance[model.id] = modelSelector.getPerformanceHistory(model.id);
    });
    
    res.json(allPerformance);
});

// Export benchmark results
app.get('/models/benchmark/export', (req, res) => {
    try {
        const format = req.query.format || 'json';
        const results = modelSelector.exportBenchmarkResults(format);
        
        if (format === 'csv') {
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename=benchmark-${Date.now()}.csv`);
        } else {
            res.setHeader('Content-Type', 'application/json');
        }
        
        res.send(results);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        vision: {
            engine: visionEngine.status,
            model: visionEngine.getCurrentModel().id
        }
    });
});

// Initialize and start server
async function startServer() {
    try {
        // Wait for vision engine to initialize
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Optimize for hardware
        visionEngine.optimizeForHardware();
        
        app.listen(PORT, () => {
            console.log('\n🚀 Robot Overhead Monitor - Enhanced Multi-Model Server');
            console.log('═══════════════════════════════════════════════════════');
            console.log(`📹 Monitor Interface: http://localhost:${PORT}`);
            console.log(`🔄 MJPEG Stream: http://localhost:${PORT}/stream.mjpeg`);
            console.log(`📸 Snapshot: http://localhost:${PORT}/snapshot.jpg`);
            console.log(`🤖 Vision Models: http://localhost:${PORT}/models`);
            console.log('═══════════════════════════════════════════════════════');
            console.log(`\n✨ Vision Engine Status:`);
            console.log(`  Current Model: ${visionEngine.getCurrentModel().id}`);
            console.log(`  Hardware: ${visionEngine.hardwareProfile}`);
            console.log(`  Available Models: ${modelSelector.getAvailableModels().length}`);
            console.log('\n✅ Enhanced server ready with multi-model support!\n');
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

// Graceful shutdown
process.on('SIGINT', () => {
    log('\nShutting down gracefully...', 'INFO');
    if (activeFFmpeg) {
        activeFFmpeg.kill();
    }
    process.exit(0);
});

// Start the server
startServer();