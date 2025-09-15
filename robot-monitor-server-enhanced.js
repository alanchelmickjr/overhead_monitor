#!/usr/bin/env node

const express = require('express');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');
const fetch = require('node-fetch');

// Import frame capture components
const FrameCaptureService = require('./src/camera/FrameCaptureService');
const FrameBufferManager = require('./src/camera/FrameBufferManager');

// Import our vision components
const VisionEngine = require('./src/vision/VisionEngine');
const ModelSelector = require('./src/vision/ModelSelector');

const app = express();
const PORT = 3001;

// Enable CORS and body parsing
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(express.static('public'));

// Initialize frame capture components
const frameCaptureService = new FrameCaptureService();
const frameBufferManager = new FrameBufferManager({
    defaultBufferSize: 100, // Keep last 100 frames for analysis
    maxBufferMemory: 200 * 1024 * 1024 // 200MB for AI processing
});

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
const CAMERA_ID = 'robot-overhead-enhanced';
let cameraActive = false;
let activeClients = new Map(); // Track active client subscriptions

// Frame storage for analysis
const analysisFrameStore = new Map(); // Store frames temporarily for AI analysis

// Start frame capture
async function startFrameCapture() {
    if (cameraActive) {
        log('Frame capture already running', 'DEBUG');
        return;
    }
    
    log(`🎥 Starting enhanced frame capture from: ${CAMERA_URL}`, 'SUCCESS');
    
    // Initialize buffer for camera
    frameBufferManager.initializeBuffer(CAMERA_ID, {
        bufferSize: 100 // Larger buffer for AI analysis
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
                source: 'robot-monitor-enhanced',
                visionEnabled: true,
                models: modelSelector.getAvailableModels().map(m => m.id)
            }
        });
        
        cameraActive = true;
        log('Enhanced frame capture started successfully', 'SUCCESS');
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
            hardware: visionEngine.hardwareProfile,
            frameBuffering: {
                enabled: true,
                bufferSize: frameBufferManager.getBufferStats(CAMERA_ID)?.bufferSize || 0,
                currentFrames: frameBufferManager.getBufferStats(CAMERA_ID)?.currentFrames || 0
            }
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

// Benchmark models using buffered frames
app.post('/models/benchmark', async (req, res) => {
    try {
        let { testFrame } = req.body;
        
        // If no test frame provided, use latest from buffer
        if (!testFrame) {
            const latestFrame = frameBufferManager.getLatestFrame(CAMERA_ID);
            if (latestFrame && latestFrame.data) {
                testFrame = `data:image/jpeg;base64,${latestFrame.data.toString('base64')}`;
                log('Using latest buffered frame for benchmark', 'INFO');
            } else {
                return res.status(400).json({ error: 'No test frame provided and no buffered frames available' });
            }
        }
        
        log('Starting model benchmark...', 'INFO');
        
        // Convert base64 to frame data
        const frameData = {
            timestamp: new Date().toISOString(),
            cameraId: 'benchmark',
            image: testFrame
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
        let { model1, model2, testFrame } = req.body;
        if (!model1 || !model2) {
            return res.status(400).json({ error: 'Two model IDs required' });
        }
        
        // If no test frame provided, use latest from buffer
        if (!testFrame) {
            const latestFrame = frameBufferManager.getLatestFrame(CAMERA_ID);
            if (latestFrame && latestFrame.data) {
                testFrame = `data:image/jpeg;base64,${latestFrame.data.toString('base64')}`;
                log('Using latest buffered frame for comparison', 'INFO');
            } else {
                return res.status(400).json({ error: 'No test frame provided and no buffered frames available' });
            }
        }
        
        log(`Comparing models: ${model1} vs ${model2}`, 'INFO');
        
        // Convert base64 to frame data
        const frameData = {
            timestamp: new Date().toISOString(),
            cameraId: 'compare',
            image: testFrame
        };
        
        const comparison = await modelSelector.compareModels(model1, model2, frameData);
        
        log(`Comparison complete. Winner: ${comparison.winner}`, 'SUCCESS');
        res.json(comparison);
        
    } catch (error) {
        log(`Error comparing models: ${error.message}`, 'ERROR');
        res.status(500).json({ error: error.message });
    }
});

// Vision Analysis Endpoint - Enhanced with frame buffering
app.post('/analyze', async (req, res) => {
    try {
        let { image, prompt, apiUrl, model, useBufferedFrame } = req.body;
        
        // Option to use latest buffered frame instead of provided image
        if (useBufferedFrame && !image) {
            const latestFrame = frameBufferManager.getLatestFrame(CAMERA_ID);
            if (latestFrame && latestFrame.data) {
                image = `data:image/jpeg;base64,${latestFrame.data.toString('base64')}`;
                log('Using latest buffered frame for analysis', 'INFO');
            } else {
                return res.status(400).json({ error: 'No buffered frames available' });
            }
        }
        
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
            image: image
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

// Analyze buffered frames endpoint
app.post('/analyze-buffer', async (req, res) => {
    try {
        const { count = 5, prompt, model } = req.body;
        
        if (!prompt) {
            return res.status(400).json({ error: 'Prompt required' });
        }
        
        // Get multiple frames from buffer
        const frames = frameBufferManager.getFrames(CAMERA_ID, count, true);
        
        if (frames.length === 0) {
            return res.status(400).json({ error: 'No buffered frames available' });
        }
        
        log(`Analyzing ${frames.length} buffered frames`, 'INFO');
        
        const analyses = [];
        
        for (const frame of frames) {
            const frameData = {
                timestamp: frame.timestamp,
                cameraId: frame.cameraId,
                image: `data:image/jpeg;base64,${frame.data.toString('base64')}`
            };
            
            const analysis = await visionEngine.analyzeFrame(frameData, prompt, { model });
            analyses.push({
                frameId: frame.id,
                timestamp: frame.timestamp,
                sequenceNumber: frame.sequenceNumber,
                analysis: analysis
            });
        }
        
        res.json({
            frameCount: analyses.length,
            analyses: analyses
        });
        
    } catch (error) {
        log(`Error analyzing buffer: ${error.message}`, 'ERROR');
        res.status(500).json({ error: error.message });
    }
});

// MJPEG streaming endpoint - Enhanced with frame capture
app.get('/stream.mjpeg', async (req, res) => {
    const clientId = `client-${req.ip}-${Date.now()}`;
    log(`📹 Enhanced MJPEG stream requested by ${clientId}`, 'INFO');
    
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
        bufferReplayCount: 15, // Send last 15 frames to new client
        callback: (frame) => {
            try {
                if (!res.writable || res.destroyed || res.finished) {
                    return;
                }
                
                res.write(`--frame\r\n`);
                res.write(`Content-Type: image/jpeg\r\n`);
                res.write(`Content-Length: ${frame.data.length}\r\n`);
                res.write(`X-Frame-ID: ${frame.id}\r\n`);
                res.write(`X-Frame-Timestamp: ${frame.timestamp}\r\n\r\n`);
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
        setTimeout(stopFrameCaptureIfNoClients, 5000);
    };
    
    req.on('close', cleanup);
    req.on('aborted', cleanup);
    res.on('close', cleanup);
    res.on('error', cleanup);
});

// Snapshot endpoint - Enhanced with metadata
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
            'X-Frame-ID': latestFrame.id,
            'X-Frame-Timestamp': latestFrame.timestamp,
            'X-Frame-Sequence': latestFrame.sequenceNumber,
            'X-Frame-Metadata': JSON.stringify(latestFrame.metadata)
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
            metadata: f.metadata,
            base64: req.query.includeData ? f.data.toString('base64') : undefined
        }))
    });
});

// Status endpoint - Enhanced with frame capture info
app.get('/status', (req, res) => {
    const captureStatus = frameCaptureService.getCaptureStatus(CAMERA_ID);
    const bufferStats = frameBufferManager.getBufferStats(CAMERA_ID);
    const overallStats = frameBufferManager.getStatistics();
    
    res.json({
        running: true,
        ffmpegActive: cameraActive && captureStatus.isCapturing,
        cameraUrl: CAMERA_URL.replace(/:[^:@]+@/, ':****@'), // Hide password
        activeClients: activeClients.size,
        frameCapture: captureStatus,
        bufferStats: bufferStats,
        memory: {
            totalUsage: overallStats.totalMemoryUsage,
            maxAllowed: overallStats.maxBufferMemory || 200 * 1024 * 1024
        },
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
    const captureStatus = frameCaptureService.getCaptureStatus(CAMERA_ID);
    const bufferStats = frameBufferManager.getBufferStats(CAMERA_ID);
    
    res.json({
        status: 'healthy',
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        frameCapture: {
            active: captureStatus.isCapturing,
            framesProcessed: captureStatus.framesProcessed
        },
        buffer: {
            frames: bufferStats?.currentFrames || 0,
            memory: bufferStats?.memoryUsage || 0
        },
        vision: {
            engine: visionEngine.status,
            model: visionEngine.getCurrentModel().id
        }
    });
});

// Initialize frame capture service event handlers
frameCaptureService.on('frame', (frame) => {
    // Add frame to buffer manager
    frameBufferManager.addFrame(frame);
    
    // Store for potential AI analysis
    analysisFrameStore.set(frame.id, frame);
    
    // Clean up old analysis frames (keep last 50)
    if (analysisFrameStore.size > 50) {
        const firstKey = analysisFrameStore.keys().next().value;
        analysisFrameStore.delete(firstKey);
    }
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

// Initialize and start server
async function startServer() {
    try {
        // Check FFmpeg availability
        const ffmpegAvailable = await FrameCaptureService.checkFFmpegAvailable();
        
        if (!ffmpegAvailable) {
            console.error('❌ FFmpeg not found! Please install FFmpeg');
            process.exit(1);
        }
        
        // Wait for vision engine to initialize
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Optimize for hardware
        visionEngine.optimizeForHardware();
        
        app.listen(PORT, () => {
            console.log('\n🚀 Robot Overhead Monitor - AI-Enhanced Multi-Model Server');
            console.log('═══════════════════════════════════════════════════════');
            console.log(`📹 Monitor Interface: http://localhost:${PORT}`);
            console.log(`🔄 MJPEG Stream: http://localhost:${PORT}/stream.mjpeg`);
            console.log(`📸 Snapshot: http://localhost:${PORT}/snapshot.jpg`);
            console.log(`🤖 Vision Models: http://localhost:${PORT}/models`);
            console.log(`📊 Frame History: http://localhost:${PORT}/frames/30`);
            console.log('═══════════════════════════════════════════════════════');
            console.log(`\n✨ Enhanced Features:`);
            console.log(`  • Advanced frame capture and buffering`);
            console.log(`  • AI-ready frame distribution`);
            console.log(`  • Multi-model vision support`);
            console.log(`  • Frame history and analysis`);
            console.log(`  • Multi-operator support`);
            console.log(`\n🧠 Vision Engine Status:`);
            console.log(`  Current Model: ${visionEngine.getCurrentModel().id}`);
            console.log(`  Hardware: ${visionEngine.hardwareProfile}`);
            console.log(`  Available Models: ${modelSelector.getAvailableModels().length}`);
            console.log('\n✅ AI-Enhanced server ready for robots and tele-operators!\n');
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

// Graceful shutdown
process.on('SIGINT', async () => {
    log('\nShutting down gracefully...', 'INFO');
    
    // Stop frame capture
    await frameCaptureService.stopAll();
    
    // Clear buffers
    frameBufferManager.destroy();
    
    // Clear analysis frame store
    analysisFrameStore.clear();
    
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

// Start the server
startServer();