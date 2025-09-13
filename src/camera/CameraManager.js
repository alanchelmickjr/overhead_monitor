/**
 * Camera Manager - Handles IP camera connections and frame capture
 */

const EventEmitter = require('events');
const Stream = require('node-rtsp-stream');
const axios = require('axios');
const sharp = require('sharp');
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.simple(),
  transports: [new winston.transports.Console()]
});

class CameraManager extends EventEmitter {
  constructor(cameraConfigs = []) {
    super();
    this.cameras = new Map();
    this.streams = new Map();
    this.captureIntervals = new Map();
    this.cameraConfigs = cameraConfigs;
    this.isInitialized = false;
  }

  async initialize() {
    logger.info('Initializing Camera Manager...');
    
    for (const config of this.cameraConfigs) {
      try {
        await this.addCamera(config);
      } catch (error) {
        logger.error(`Failed to add camera ${config.id}:`, error.message);
      }
    }
    
    this.isInitialized = true;
    logger.info(`Camera Manager initialized with ${this.cameras.size} cameras`);
  }

  async addCamera(config) {
    const camera = {
      id: config.id,
      name: config.name,
      protocol: config.protocol || 'rtsp',
      url: config.url,
      username: config.username,
      password: config.password,
      resolution: config.resolution || { width: 1920, height: 1080 },
      fps: config.fps || 30,
      status: 'disconnected',
      lastFrame: null,
      stats: {
        framesCapured: 0,
        framesProcessed: 0,
        droppedFrames: 0,
        averageLatency: 0
      }
    };

    this.cameras.set(config.id, camera);
    
    // Attempt connection
    await this.connectCamera(config.id);
  }

  async connectCamera(cameraId) {
    const camera = this.cameras.get(cameraId);
    if (!camera) {
      throw new Error(`Camera ${cameraId} not found`);
    }

    try {
      if (camera.protocol === 'rtsp') {
        await this.connectRTSP(camera);
      } else if (camera.protocol === 'http') {
        await this.connectHTTP(camera);
      } else if (camera.protocol === 'mjpeg') {
        await this.connectMJPEG(camera);
      } else {
        throw new Error(`Unsupported protocol: ${camera.protocol}`);
      }
      
      camera.status = 'connected';
      logger.info(`Connected to camera ${cameraId}`);
      
    } catch (error) {
      camera.status = 'error';
      logger.error(`Failed to connect camera ${cameraId}:`, error.message);
      
      // Schedule reconnection
      setTimeout(() => this.reconnectCamera(cameraId), 5000);
      throw error;
    }
  }

  async connectRTSP(camera) {
    const streamUrl = this.buildStreamUrl(camera);
    
    const stream = new Stream({
      name: camera.id,
      streamUrl: streamUrl,
      wsPort: 9999, // WebSocket port for stream
      ffmpegOptions: {
        '-rtsp_transport': 'tcp',
        '-r': camera.fps,
        '-s': `${camera.resolution.width}x${camera.resolution.height}`
      }
    });

    this.streams.set(camera.id, stream);
    
    // Set up frame capture from RTSP stream
    stream.on('data', (data) => {
      this.handleFrameData(camera.id, data);
    });
  }

  async connectHTTP(camera) {
    // For HTTP cameras, we'll poll for snapshots
    const snapshotUrl = camera.url + '/snapshot.jpg';
    
    const testResponse = await axios.get(snapshotUrl, {
      auth: {
        username: camera.username,
        password: camera.password
      },
      responseType: 'arraybuffer',
      timeout: 5000
    });

    if (testResponse.status === 200) {
      this.streams.set(camera.id, { type: 'http', url: snapshotUrl });
    } else {
      throw new Error(`HTTP camera test failed with status ${testResponse.status}`);
    }
  }

  async connectMJPEG(camera) {
    // For MJPEG streams
    const streamUrl = this.buildStreamUrl(camera);
    
    const response = await axios.get(streamUrl, {
      responseType: 'stream',
      timeout: 5000,
      auth: camera.username && camera.password ? {
        username: camera.username,
        password: camera.password
      } : undefined
    });

    this.streams.set(camera.id, { type: 'mjpeg', stream: response.data });
    
    // Parse MJPEG stream for frames
    this.parseMJPEGStream(camera.id, response.data);
  }

  buildStreamUrl(camera) {
    if (camera.username && camera.password) {
      const urlObj = new URL(camera.url);
      urlObj.username = camera.username;
      urlObj.password = camera.password;
      return urlObj.toString();
    }
    return camera.url;
  }

  parseMJPEGStream(cameraId, stream) {
    let buffer = Buffer.alloc(0);
    const boundary = '--myboundary';
    
    stream.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      
      let boundaryIndex;
      while ((boundaryIndex = buffer.indexOf(boundary)) !== -1) {
        if (boundaryIndex > 0) {
          const frame = buffer.slice(0, boundaryIndex);
          const jpegStart = frame.indexOf(Buffer.from([0xFF, 0xD8]));
          const jpegEnd = frame.indexOf(Buffer.from([0xFF, 0xD9]));
          
          if (jpegStart !== -1 && jpegEnd !== -1) {
            const jpeg = frame.slice(jpegStart, jpegEnd + 2);
            this.handleFrameData(cameraId, jpeg);
          }
        }
        
        buffer = buffer.slice(boundaryIndex + boundary.length);
      }
    });
  }

  async startStream(cameraId, options = {}) {
    const camera = this.cameras.get(cameraId);
    if (!camera) {
      throw new Error(`Camera ${cameraId} not found`);
    }

    const interval = options.interval || 500;
    
    // Clear existing interval if any
    if (this.captureIntervals.has(cameraId)) {
      clearInterval(this.captureIntervals.get(cameraId));
    }

    // Set up capture interval
    const captureInterval = setInterval(async () => {
      try {
        await this.captureFrame(cameraId);
      } catch (error) {
        logger.error(`Frame capture error for ${cameraId}:`, error.message);
      }
    }, interval);

    this.captureIntervals.set(cameraId, captureInterval);
    logger.info(`Started stream for camera ${cameraId} with ${interval}ms interval`);
  }

  async captureFrame(cameraId) {
    const camera = this.cameras.get(cameraId);
    if (!camera || camera.status !== 'connected') {
      throw new Error(`Camera ${cameraId} not available`);
    }

    const stream = this.streams.get(cameraId);
    if (!stream) {
      throw new Error(`No stream found for camera ${cameraId}`);
    }

    let frameBuffer;
    
    if (stream.type === 'http') {
      // Capture snapshot from HTTP camera
      const response = await axios.get(stream.url, {
        auth: {
          username: camera.username,
          password: camera.password
        },
        responseType: 'arraybuffer',
        timeout: 5000
      });
      frameBuffer = Buffer.from(response.data);
    } else if (camera.lastFrame) {
      // Use last captured frame from stream
      frameBuffer = camera.lastFrame;
    } else {
      throw new Error('No frame available');
    }

    // Process frame (resize, compress)
    const processedFrame = await this.processFrame(frameBuffer, camera.resolution);
    
    // Update stats
    camera.stats.framesCapured++;
    
    // Emit frame event
    this.emit('frame', {
      cameraId: cameraId,
      timestamp: new Date().toISOString(),
      image: processedFrame.toString('base64'),
      format: 'jpeg',
      resolution: camera.resolution
    });
  }

  async processFrame(frameBuffer, targetResolution) {
    try {
      const processed = await sharp(frameBuffer)
        .resize(targetResolution.width, targetResolution.height, {
          fit: 'inside',
          withoutEnlargement: true
        })
        .jpeg({ quality: 80 })
        .toBuffer();
      
      return processed;
    } catch (error) {
      logger.error('Frame processing error:', error);
      return frameBuffer;
    }
  }

  handleFrameData(cameraId, data) {
    const camera = this.cameras.get(cameraId);
    if (camera) {
      camera.lastFrame = data;
      camera.stats.framesProcessed++;
    }
  }

  async stopStream(cameraId) {
    // Clear capture interval
    if (this.captureIntervals.has(cameraId)) {
      clearInterval(this.captureIntervals.get(cameraId));
      this.captureIntervals.delete(cameraId);
    }

    // Stop stream if needed
    const stream = this.streams.get(cameraId);
    if (stream) {
      if (stream.stop) {
        stream.stop();
      }
      this.streams.delete(cameraId);
    }

    logger.info(`Stopped stream for camera ${cameraId}`);
  }

  async stopAll() {
    const cameraIds = Array.from(this.cameras.keys());
    for (const cameraId of cameraIds) {
      await this.stopStream(cameraId);
    }
    logger.info('All camera streams stopped');
  }

  async reconnectCamera(cameraId) {
    const camera = this.cameras.get(cameraId);
    if (!camera) return;

    if (camera.status === 'error' || camera.status === 'disconnected') {
      logger.info(`Attempting to reconnect camera ${cameraId}...`);
      try {
        await this.connectCamera(cameraId);
      } catch (error) {
        // Schedule another reconnection attempt
        setTimeout(() => this.reconnectCamera(cameraId), 10000);
      }
    }
  }

  getCameraInfo(cameraId) {
    return this.cameras.get(cameraId);
  }

  getAllCameras() {
    return Array.from(this.cameras.values());
  }

  getStatus() {
    const connectedCameras = Array.from(this.cameras.values())
      .filter(cam => cam.status === 'connected').length;
    
    if (connectedCameras === this.cameras.size) {
      return 'online';
    } else if (connectedCameras > 0) {
      return 'partial';
    } else {
      return 'offline';
    }
  }

  getStatistics() {
    const stats = {};
    for (const [id, camera] of this.cameras) {
      stats[id] = camera.stats;
    }
    return stats;
  }
}

module.exports = CameraManager;