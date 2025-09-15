/**
 * Test script for FrameCaptureService and FrameBufferManager integration
 * Demonstrates how these components work together in the overhead monitor system
 */

const FrameCaptureService = require('./FrameCaptureService');
const FrameBufferManager = require('./FrameBufferManager');
const winston = require('winston');

// Configure logger for testing
const logger = winston.createLogger({
  level: 'debug',
  format: winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `${timestamp} [${level}]: ${message}`;
    })
  ),
  transports: [new winston.transports.Console()]
});

class FrameComponentsTest {
  constructor() {
    this.captureService = new FrameCaptureService();
    this.bufferManager = new FrameBufferManager({
      defaultBufferSize: 50,
      maxBufferMemory: 50 * 1024 * 1024 // 50MB
    });
    
    this.testCameraId = 'test-camera-1';
    this.frameCount = 0;
    this.setupEventHandlers();
  }

  setupEventHandlers() {
    // FrameCaptureService events
    this.captureService.on('capture-started', (data) => {
      logger.info(`Capture started for camera ${data.cameraId}`);
    });

    this.captureService.on('capture-ended', (data) => {
      logger.info(`Capture ended for camera ${data.cameraId} with code ${data.code}`);
    });

    this.captureService.on('error', (data) => {
      logger.error(`Capture error for camera ${data.cameraId}: ${data.error.message}`);
    });

    // Forward frames from capture service to buffer manager
    this.captureService.on('frame', (frame) => {
      this.frameCount++;
      this.bufferManager.addFrame(frame);
      
      if (this.frameCount % 30 === 0) {
        logger.info(`Processed ${this.frameCount} frames for camera ${frame.cameraId}`);
      }
    });

    // FrameBufferManager events
    this.bufferManager.on('buffer-initialized', (data) => {
      logger.info(`Buffer initialized for camera ${data.cameraId} with size ${data.bufferSize}`);
    });

    this.bufferManager.on('frame-buffered', (data) => {
      if (this.frameCount % 100 === 0) {
        logger.debug(`Frame buffered: ${data.frameId} (Buffer size: ${data.bufferSize}, Memory: ${data.memoryUsage} bytes)`);
      }
    });

    this.bufferManager.on('frame-dropped', (data) => {
      logger.warn(`Frame dropped for camera ${data.cameraId}: ${data.reason}`);
    });
  }

  async runIntegrationTest() {
    logger.info('=== Starting Frame Components Integration Test ===');
    
    try {
      // Test 1: Check FFmpeg availability
      logger.info('\nTest 1: Checking FFmpeg availability...');
      const ffmpegAvailable = await FrameCaptureService.checkFFmpegAvailable();
      if (!ffmpegAvailable) {
        logger.error('FFmpeg is not available. Please install FFmpeg to continue.');
        return;
      }
      logger.info('✓ FFmpeg is available');

      // Test 2: Start capture with test URL (using local file for testing)
      logger.info('\nTest 2: Starting frame capture...');
      await this.captureService.startCapture({
        cameraId: this.testCameraId,
        url: 'rtsp://localhost:554/test', // This will fail but demonstrates the API
        ffmpegOptions: {
          resolution: '640x480',
          fps: 10,
          quality: 3
        },
        metadata: {
          location: 'test-location',
          cameraType: 'overhead'
        }
      });

      // Test 3: Set up subscriptions
      logger.info('\nTest 3: Setting up frame subscriptions...');
      
      // Live subscription
      const liveSub = this.bufferManager.subscribe({
        subscriberId: 'live-monitor-1',
        cameraIds: [this.testCameraId],
        mode: 'live',
        callback: (frame) => {
          if (this.frameCount % 50 === 0) {
            logger.info(`Live subscriber received frame ${frame.sequenceNumber} from ${frame.cameraId}`);
          }
        }
      });

      // Buffered subscription
      const bufferedSub = this.bufferManager.subscribe({
        subscriberId: 'analysis-worker-1',
        cameraIds: [],  // Subscribe to all cameras
        mode: 'both',
        bufferReplayCount: 10,
        callback: (frame) => {
          logger.debug(`Buffered subscriber received frame ${frame.sequenceNumber}`);
        }
      });

      // Test 4: Monitor for 5 seconds
      logger.info('\nTest 4: Monitoring frames for 5 seconds...');
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Test 5: Get buffer statistics
      logger.info('\nTest 5: Checking buffer statistics...');
      const stats = this.bufferManager.getStatistics();
      logger.info(`Total frames buffered: ${stats.totalFramesBuffered}`);
      logger.info(`Total frames distributed: ${stats.totalFramesDistributed}`);
      logger.info(`Memory usage: ${(stats.totalMemoryUsage / 1024 / 1024).toFixed(2)} MB`);
      logger.info(`Dropped frames: ${stats.droppedFrames}`);

      // Test 6: Get latest frames
      logger.info('\nTest 6: Retrieving latest frames from buffer...');
      const latestFrames = this.bufferManager.getFrames(this.testCameraId, 5, true);
      logger.info(`Retrieved ${latestFrames.length} latest frames from buffer`);

      // Test 7: Test memory pruning
      logger.info('\nTest 7: Testing memory pruning...');
      const prunedCount = this.bufferManager.pruneFrames(10 * 1024 * 1024); // Prune to 10MB
      logger.info(`Pruned ${prunedCount} frames to reduce memory usage`);

      // Test 8: Clean up
      logger.info('\nTest 8: Cleaning up...');
      liveSub.unsubscribe();
      bufferedSub.unsubscribe();
      await this.captureService.stopCapture(this.testCameraId);
      this.bufferManager.clearBuffer(this.testCameraId);

      logger.info('\n=== Integration Test Completed Successfully ===');
      
    } catch (error) {
      logger.error(`Integration test failed: ${error.message}`);
      logger.error(error.stack);
    } finally {
      // Final cleanup
      await this.captureService.stopAll();
      this.bufferManager.destroy();
    }
  }

  // Demonstrate integration with existing CameraManager
  async demonstrateCompatibility() {
    logger.info('\n=== Demonstrating Compatibility with Existing Architecture ===');
    
    // Show how these components can work with the existing CameraManager
    logger.info('\nExample integration with existing CameraManager:');
    logger.info(`
// In CameraManager.js, you could integrate like this:

class CameraManager extends EventEmitter {
  constructor(cameraConfigs = []) {
    super();
    // ... existing code ...
    
    // Add new frame capture components
    this.frameCaptureService = new FrameCaptureService();
    this.frameBufferManager = new FrameBufferManager();
    
    // Connect frame flow
    this.frameCaptureService.on('frame', (frame) => {
      // Buffer the frame
      this.frameBufferManager.addFrame(frame);
      
      // Also emit for backward compatibility
      this.emit('frame', {
        cameraId: frame.cameraId,
        timestamp: frame.timestamp,
        image: frame.data.toString('base64'),
        format: 'jpeg',
        resolution: frame.metadata.resolution
      });
    });
  }
  
  // New method to start capture using the new service
  async startCaptureV2(cameraId, options = {}) {
    const camera = this.cameras.get(cameraId);
    if (!camera) throw new Error(\`Camera \${cameraId} not found\`);
    
    await this.frameCaptureService.startCapture({
      cameraId,
      url: this.buildStreamUrl(camera),
      ffmpegOptions: {
        resolution: \`\${camera.resolution.width}x\${camera.resolution.height}\`,
        fps: camera.fps,
        quality: 5
      }
    });
  }
  
  // Subscribe to frames
  subscribeToFrames(options) {
    return this.frameBufferManager.subscribe(options);
  }
}
    `);
    
    logger.info('\nKey integration points:');
    logger.info('1. FrameCaptureService handles FFmpeg process management');
    logger.info('2. FrameBufferManager provides efficient circular buffering');
    logger.info('3. EventEmitter pattern ensures compatibility with existing code');
    logger.info('4. Frame structure includes all required metadata');
    logger.info('5. Both components can coexist with existing implementation');
  }
}

// Run the test if this file is executed directly
if (require.main === module) {
  const test = new FrameComponentsTest();
  
  (async () => {
    await test.runIntegrationTest();
    await test.demonstrateCompatibility();
    process.exit(0);
  })().catch(error => {
    logger.error('Test failed:', error);
    process.exit(1);
  });
}

module.exports = FrameComponentsTest;