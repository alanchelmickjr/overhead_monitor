/**
 * Camera Manager - Handles IP camera connections and frame capture
 */

const EventEmitter = require('events');
const Stream = require('node-rtsp-stream');
const axios = require('axios');
const sharp = require('sharp');
const winston = require('winston');
const FrameCaptureService = require('./FrameCaptureService');
const FrameBufferManager = require('./FrameBufferManager');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.simple(),
  transports: [new winston.transports.Console()]
});

class CameraManager extends EventEmitter {
  constructor(cameraConfigs = [], config = {}) {
    super();
    this.cameras = new Map();
    this.streams = new Map();
    this.captureIntervals = new Map();
    this.cameraConfigs = cameraConfigs;
    this.isInitialized = false;
    
    // Initialize frame capture service and buffer manager
    this.frameCaptureService = new FrameCaptureService();
    this.frameBufferManager = new FrameBufferManager({
      defaultBufferSize: config.maxMemoryFrames || 100,
      maxBufferMemory: 100 * 1024 * 1024 // 100MB
    });
    
    // Set up frame capture event handlers
    this.frameCaptureService.on('frame', (frame) => this.handleCapturedFrame(frame));
    this.frameCaptureService.on('error', (error) => this.handleCaptureError(error));
    this.frameCaptureService.on('capture-ended', (info) => this.handleCaptureEnded(info));
    
    // Storage service reference (to be injected)
    this.storageService = null;
    this.frameStorageEnabled = config.frameStorageEnabled || false;
  }

  async initialize(storageService = null) {
    logger.info('Initializing Camera Manager...');
    
    // Set storage service if provided
    if (storageService) {
      this.storageService = storageService;
      logger.info('Storage service configured for frame persistence');
    }
    
    // Check FFmpeg availability
    const ffmpegAvailable = await FrameCaptureService.checkFFmpegAvailable();
    if (!ffmpegAvailable) {
      logger.error('FFmpeg not available - frame capture will not work properly');
    }
    
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
    
    // Initialize frame buffer for this camera
    this.frameBufferManager.initializeBuffer(camera.id, {
      bufferSize: camera.bufferSize || 100
    });
    
    // Start frame capture service
    await this.frameCaptureService.startCapture({
      cameraId: camera.id,
      url: streamUrl,
      ffmpegOptions: {
        fps: camera.fps || 30,
        resolution: `${camera.resolution.width}x${camera.resolution.height}`,
        quality: 5
      },
      metadata: {
        cameraName: camera.name,
        protocol: 'rtsp'
      }
    });
    
    this.streams.set(camera.id, { type: 'rtsp', capturing: true });
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
      
      // Initialize frame buffer for this camera
      this.frameBufferManager.initializeBuffer(camera.id, {
        bufferSize: camera.bufferSize || 50 // Smaller buffer for snapshot cameras
      });
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

    // Initialize intelligent throttling settings
    camera.throttling = {
      baseInterval: options.interval || 500,
      currentInterval: options.interval || 500,
      minInterval: 50,     // Fastest capture rate for critical events
      maxInterval: 10000,  // Slowest rate to save resources (10 seconds)
      activityLevel: 'normal',
      lastActivityTime: Date.now(),
      consecutiveNoActivity: 0,
      resourceSaving: true,
      throttleSteps: [100, 250, 500, 1000, 2000, 5000, 10000] // Gradual throttling
    };
    
    // Clear existing interval if any
    if (this.captureIntervals.has(cameraId)) {
      clearInterval(this.captureIntervals.get(cameraId));
    }

    // Start with intelligent capture scheduling
    this.scheduleThrottledCapture(cameraId);
    
    logger.info(`Started throttled stream for camera ${cameraId} - Base: ${camera.throttling.baseInterval}ms`);
  }

  /**
   * Intelligent capture scheduling with resource optimization
   */
  scheduleThrottledCapture(cameraId) {
    const camera = this.cameras.get(cameraId);
    if (!camera || camera.status !== 'connected') {
      return;
    }

    const throttle = camera.throttling;
    
    const captureAndReschedule = async () => {
      try {
        const startTime = Date.now();
        await this.captureFrame(cameraId);
        const captureTime = Date.now() - startTime;
        
        // Adjust interval based on capture performance
        if (captureTime > throttle.currentInterval * 0.8) {
          // If capture takes too long, increase interval to prevent backlog
          this.adjustThrottleUp(cameraId);
        }
        
        // Schedule next capture
        const timeoutId = setTimeout(() => {
          this.scheduleThrottledCapture(cameraId);
        }, throttle.currentInterval);
        
        this.captureIntervals.set(cameraId, timeoutId);
        
      } catch (error) {
        logger.error(`Capture error for ${cameraId}:`, error.message);
        // On error, throttle up to reduce load
        this.adjustThrottleUp(cameraId);
        
        const timeoutId = setTimeout(() => {
          this.scheduleThrottledCapture(cameraId);
        }, throttle.currentInterval);
        this.captureIntervals.set(cameraId, timeoutId);
      }
    };

    captureAndReschedule();
  }

  /**
   * Adjust throttling based on activity detection
   */
  updateActivityThrottle(cameraId, hasActivity, eventTypes = []) {
    const camera = this.cameras.get(cameraId);
    if (!camera || !camera.throttling) {
      return;
    }

    const throttle = camera.throttling;
    const now = Date.now();
    
    // Critical events need immediate response
    const criticalEvents = ['human_in_area', 'robot_tipped', 'collision_detected'];
    const hasCritical = eventTypes.some(type => criticalEvents.includes(type));
    
    if (hasCritical) {
      // CRITICAL: Capture as fast as possible
      throttle.currentInterval = throttle.minInterval;
      throttle.activityLevel = 'critical';
      throttle.lastActivityTime = now;
      throttle.consecutiveNoActivity = 0;
      logger.warn(`Camera ${cameraId}: CRITICAL event - interval -> ${throttle.minInterval}ms`);
      
    } else if (hasActivity) {
      // Activity detected - speed up gradually
      throttle.lastActivityTime = now;
      throttle.consecutiveNoActivity = 0;
      
      if (throttle.activityLevel !== 'high') {
        throttle.activityLevel = 'high';
        this.adjustThrottleDown(cameraId);
      }
      
    } else {
      // No activity - gradually slow down to save resources
      throttle.consecutiveNoActivity++;
      
      if (throttle.consecutiveNoActivity > 5) {
        throttle.activityLevel = 'low';
        this.adjustThrottleUp(cameraId);
      }
    }
  }

  /**
   * Gradually decrease capture interval (speed up)
   */
  adjustThrottleDown(cameraId) {
    const camera = this.cameras.get(cameraId);
    if (!camera || !camera.throttling) return;
    
    const throttle = camera.throttling;
    const currentIndex = throttle.throttleSteps.findIndex(step => step >= throttle.currentInterval);
    
    if (currentIndex > 0) {
      throttle.currentInterval = throttle.throttleSteps[currentIndex - 1];
      logger.info(`Camera ${cameraId}: Speeding up -> ${throttle.currentInterval}ms (saving resources: false)`);
    }
  }

  /**
   * Gradually increase capture interval (slow down)
   */
  adjustThrottleUp(cameraId) {
    const camera = this.cameras.get(cameraId);
    if (!camera || !camera.throttling) return;
    
    const throttle = camera.throttling;
    const currentIndex = throttle.throttleSteps.findIndex(step => step >= throttle.currentInterval);
    
    if (currentIndex < throttle.throttleSteps.length - 1 && currentIndex !== -1) {
      throttle.currentInterval = throttle.throttleSteps[currentIndex + 1];
      const resourceSaving = throttle.currentInterval >= 1000;
      throttle.resourceSaving = resourceSaving;
      logger.info(`Camera ${cameraId}: Slowing down -> ${throttle.currentInterval}ms (saving resources: ${resourceSaving})`);
    }
  }

  /**
   * Force immediate capture for critical events
   */
  async triggerImmediateCapture(cameraId) {
    const camera = this.cameras.get(cameraId);
    if (!camera || camera.status !== 'connected') {
      return;
    }
    
    try {
      logger.info(`Camera ${cameraId}: Triggering immediate capture`);
      await this.captureFrame(cameraId);
      
      // Reset to fast capture after critical event
      if (camera.throttling) {
        camera.throttling.currentInterval = camera.throttling.minInterval;
        camera.throttling.activityLevel = 'critical';
      }
    } catch (error) {
      logger.error(`Immediate capture failed for ${cameraId}:`, error.message);
    }
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
    let frameData;
    
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
      
      // Create frame object and add to buffer
      frameData = {
        id: `${cameraId}-${Date.now()}`,
        cameraId: cameraId,
        timestamp: new Date().toISOString(),
        data: frameBuffer,
        metadata: {
          size: frameBuffer.length,
          format: 'jpeg',
          protocol: 'http'
        }
      };
      
      this.frameBufferManager.addFrame(frameData);
    } else {
      // Get latest frame from buffer for streaming cameras
      const latestFrame = this.frameBufferManager.getLatestFrame(cameraId);
      if (!latestFrame) {
        throw new Error('No frame available in buffer');
      }
      frameBuffer = latestFrame.data;
      frameData = latestFrame;
    }

    // Process frame (resize, compress)
    const processedFrame = await this.processFrame(frameBuffer, camera.resolution);
    
    // Update stats
    camera.stats.framesCapured++;
    
    // Emit frame event
    this.emit('frame', {
      cameraId: cameraId,
      timestamp: frameData.timestamp,
      image: processedFrame.toString('base64'),
      format: 'jpeg',
      resolution: camera.resolution,
      frameId: frameData.id
    });
  }

  /**
   * Capture snapshot using buffered frames
   */
  async captureSnapshot(cameraId) {
    const camera = this.cameras.get(cameraId);
    if (!camera || camera.status !== 'connected') {
      throw new Error(`Camera ${cameraId} not available`);
    }

    // Get latest frame from buffer
    const latestFrame = this.frameBufferManager.getLatestFrame(cameraId);
    if (!latestFrame) {
      // If no buffered frame, try to capture one
      await this.captureFrame(cameraId);
      const newFrame = this.frameBufferManager.getLatestFrame(cameraId);
      if (!newFrame) {
        throw new Error('Failed to capture snapshot');
      }
      return {
        cameraId,
        timestamp: newFrame.timestamp,
        image: newFrame.data.toString('base64'),
        format: 'jpeg',
        frameId: newFrame.id
      };
    }

    return {
      cameraId,
      timestamp: latestFrame.timestamp,
      image: latestFrame.data.toString('base64'),
      format: 'jpeg',
      frameId: latestFrame.id
    };
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

  /**
   * Handle captured frame from FrameCaptureService
   */
  handleCapturedFrame(frame) {
    const camera = this.cameras.get(frame.cameraId);
    if (!camera) return;
    
    // Update stats
    camera.stats.framesProcessed++;
    
    // Add frame to buffer
    this.frameBufferManager.addFrame(frame);
    
    // Store frame to disk if enabled
    if (this.frameStorageEnabled && this.storageService) {
      this.storeFrameToDisk(frame);
    }
    
    // Update activity throttle based on frame analysis
    // (This would be updated by event detection results)
    this.updateActivityThrottle(frame.cameraId, false);
  }

  /**
   * Store frame to disk using storage service
   */
  async storeFrameToDisk(frame) {
    if (!this.storageService || !this.storageService.saveFrame) {
      return;
    }
    
    try {
      await this.storageService.saveFrame({
        cameraId: frame.cameraId,
        timestamp: frame.timestamp,
        data: frame.data,
        format: 'jpeg',
        width: frame.metadata.width || 1280,
        height: frame.metadata.height || 720,
        metadata: frame.metadata
      });
    } catch (error) {
      logger.error(`Failed to store frame for camera ${frame.cameraId}:`, error);
    }
  }

  /**
   * Handle capture error from FrameCaptureService
   */
  handleCaptureError(error) {
    logger.error('Frame capture error:', error);
    this.emit('capture-error', error);
  }

  /**
   * Handle capture ended event
   */
  handleCaptureEnded(info) {
    const camera = this.cameras.get(info.cameraId);
    if (camera) {
      camera.status = 'disconnected';
    }
    
    // Schedule reconnection if needed
    if (info.code !== 0) {
      setTimeout(() => this.reconnectCamera(info.cameraId), 5000);
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
    // Clear capture interval/timeout
    if (this.captureIntervals.has(cameraId)) {
      const intervalOrTimeout = this.captureIntervals.get(cameraId);
      clearTimeout(intervalOrTimeout); // Works for both interval and timeout
      this.captureIntervals.delete(cameraId);
    }

    // Clear throttling settings
    const camera = this.cameras.get(cameraId);
    if (camera) {
      camera.throttling = null;
    }

    // Stop frame capture service
    await this.frameCaptureService.stopCapture(cameraId);
    
    // Clear frame buffer for this camera
    this.frameBufferManager.clearBuffer(cameraId);

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
    
    // Stop frame capture service
    await this.frameCaptureService.stopAll();
    
    // Clear all frame buffers
    this.frameBufferManager.clearAllBuffers();
    
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
      stats[id] = {
        ...camera.stats,
        currentInterval: camera.throttling?.currentInterval || 'N/A',
        activityLevel: camera.throttling?.activityLevel || 'N/A',
        resourceSaving: camera.throttling?.resourceSaving || false,
        consecutiveNoActivity: camera.throttling?.consecutiveNoActivity || 0
      };
    }
    return stats;
  }

  /**
   * Get throttling info for monitoring
   */
  getThrottlingInfo(cameraId) {
    const camera = this.cameras.get(cameraId);
    if (!camera || !camera.throttling) {
      return null;
    }
    
    return {
      currentInterval: camera.throttling.currentInterval,
      activityLevel: camera.throttling.activityLevel,
      resourceSaving: camera.throttling.resourceSaving,
      timeSinceActivity: Date.now() - camera.throttling.lastActivityTime
    };
  }

  /**
   * Check if camera is in resource saving mode
   */
  isResourceSaving(cameraId) {
    const camera = this.cameras.get(cameraId);
    return camera?.throttling?.resourceSaving || false;
  }

  /**
   * Get buffered frames for a camera
   */
  getBufferedFrames(cameraId, count = 10, newest = true) {
    return this.frameBufferManager.getFrames(cameraId, count, newest);
  }

  /**
   * Subscribe to frame updates
   */
  subscribeToFrames(options) {
    return this.frameBufferManager.subscribe(options);
  }

  /**
   * Get frame buffer statistics
   */
  getFrameBufferStats(cameraId = null) {
    if (cameraId) {
      return this.frameBufferManager.getBufferStats(cameraId);
    }
    return this.frameBufferManager.getStatistics();
  }

  /**
   * Configure frame storage
   */
  configureFrameStorage(enabled, storageService = null) {
    this.frameStorageEnabled = enabled;
    if (storageService) {
      this.storageService = storageService;
    }
    logger.info(`Frame storage ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Clean up resources
   */
  async cleanup() {
    await this.stopAll();
    this.frameBufferManager.destroy();
    logger.info('Camera Manager cleaned up');
  }
}

module.exports = CameraManager;