
/**
 * RTSP Proxy with Gun.js credential management
 * This is weird and wonderful - credentials stored in a distributed graph!
 */

const express = require('express');
const app = express();
const server = require('http').createServer(app);
const io = require('socket.io')(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});
const Stream = require('node-rtsp-stream');
const cors = require('cors');
const { spawn } = require('child_process');
const Gun = require('gun');
const GunCredentialManager = require('./src/auth/GunCredentialManager');

// Enable CORS
app.use(cors());
app.use(express.static('.'));

// Initialize Gun.js for distributed credential storage
const gun = Gun({
    web: server,
    peers: ['http://localhost:8765/gun']
});

// Initialize credential manager
const credManager = new GunCredentialManager();

// Dynamic camera registry - this is where it gets weird!
const cameraRegistry = gun.get('overhead-monitor-cameras');
let activeCameras = new Map();

// Watch for camera registrations in real-time
cameraRegistry.map().on(async (data, key) => {
    if (data && data.active) {
        console.log(`🎥 Camera registered: ${key}`);
        activeCameras.set(key, data);
        
        // Auto-discover credentials when camera comes online
        const creds = await credManager.getCameraCredentials(key);
        if (creds) {
            data.credentials = creds;
            activeCameras.set(key, data);
        }
    }
});

// Weird feature: Self-healing RTSP URLs
class SmartRTSPUrl {
    constructor(cameraId) {
        this.cameraId = cameraId;
        this.attempts = new Map();
        this.successfulUrls = [];
    }
    
    async buildUrls(credentials) {
        const urls = [];
        const base = `rtsp://${credentials.ip}:554`;
        
        // Build URLs with and without auth
        const paths = credentials.paths || ['/stream1', '/1', '/live'];
        
        paths.forEach(path => {
            // Without auth
            urls.push({
                url: `${base}${path}`,
                auth: false,
                path: path
            });
            
            // With auth
            if (credentials.username && credentials.password) {
                urls.push({
                    url: `rtsp://${credentials.username}:${credentials.password}@${credentials.ip}:554${path}`,
                    auth: true,
                    path: path
                });
            }
        });
        
        return urls;
    }
    
    async findBestUrl(credentials) {
        const urls = await this.buildUrls(credentials);
        
        // Sort by previous success rate
        urls.sort((a, b) => {
            const aSuccess = this.attempts.get(a.url)?.success || 0;
            const bSuccess = this.attempts.get(b.url)?.success || 0;
            return bSuccess - aSuccess;
        });
        
        // Test URLs in parallel with race condition
        const results = await Promise.race([
            this.testUrlsConcurrently(urls.slice(0, 3)),
            new Promise(resolve => setTimeout(() => resolve(null), 5000))
        ]);
        
        return results;
    }
    
    async testUrlsConcurrently(urls) {
        const tests = urls.map(urlObj => this.testRTSPUrl(urlObj));
        const results = await Promise.allSettled(tests);
        
        for (let i = 0; i < results.length; i++) {
            if (results[i].status === 'fulfilled' && results[i].value.success) {
                const url = urls[i];
                this.recordSuccess(url);
                return url;
            }
        }
        
        return null;
    }
    
    async testRTSPUrl(urlObj) {
        return new Promise((resolve) => {
            const ffmpeg = spawn('ffmpeg', [
                '-rtsp_transport', 'tcp',
                '-i', urlObj.url,
                '-t', '0.5',
                '-f', 'null',
                '-'
            ], { timeout: 3000 });
            
            let success = false;
            let stderr = '';
            
            ffmpeg.stderr.on('data', (data) => {
                stderr += data.toString();
            });
            
            ffmpeg.on('exit', (code) => {
                success = code === 0;
                resolve({ ...urlObj, success, stderr });
            });
            
            ffmpeg.on('error', (error) => {
                resolve({ ...urlObj, success: false, error: error.message });
            });
            
            setTimeout(() => {
                ffmpeg.kill();
                resolve({ ...urlObj, success: false, error: 'Timeout' });
            }, 3000);
        });
    }
    
    recordSuccess(url) {
        const record = this.attempts.get(url.url) || { success: 0, fail: 0 };
        record.success++;
        record.lastSuccess = Date.now();
        this.attempts.set(url.url, record);
        
        // Update Gun with successful URL
        credManager.updateCameraStatus(this.cameraId, {
            workingUrl: url.url,
            lastSuccess: Date.now()
        });
    }
    
    recordFailure(url) {
        const record = this.attempts.get(url.url) || { success: 0, fail: 0 };
        record.fail++;
        record.lastFail = Date.now();
        this.attempts.set(url.url, record);
    }
}

// Smart URL managers for each camera
const urlManagers = new Map();

// Get or create URL manager for camera
function getUrlManager(cameraId) {
    if (!urlManagers.has(cameraId)) {
        urlManagers.set(cameraId, new SmartRTSPUrl(cameraId));
    }
    return urlManagers.get(cameraId);
}

// MJPEG stream endpoint with dynamic credential loading
app.get('/stream.mjpeg/:cameraId?', async (req, res) => {
    const cameraId = req.params.cameraId || 'overhead-camera';
    
    // Get credentials from Gun
    const credentials = await credManager.getCameraCredentials(cameraId);
    if (!credentials) {
        return res.status(404).send('Camera not found or no credentials');
    }
    
    // Get smart URL
    const urlManager = getUrlManager(cameraId);
    const bestUrl = await urlManager.findBestUrl(credentials);
    
    if (!bestUrl) {
        return res.status(503).send('No working RTSP URL found');
    }
    
    console.log(`📹 Streaming from: ${bestUrl.path} (auth: ${bestUrl.auth})`);
    
    res.writeHead(200, {
        'Content-Type': 'multipart/x-mixed-replace; boundary=myboundary',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Pragma': 'no-cache'
    });

    const ffmpeg = spawn('ffmpeg', [
        '-rtsp_transport', 'tcp',
        '-i', bestUrl.url,
        '-f', 'mjpeg',
        '-q:v', '5',
