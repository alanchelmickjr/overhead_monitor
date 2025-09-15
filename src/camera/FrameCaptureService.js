/**
 * Frame Capture Service
 * Captures frames from FFmpeg processes and emits them as events
 * Uses JPEG frame markers (0xFF 0xD8 start, 0xFF 0xD9 end) for extraction
 */

const EventEmitter = require('events');
const { spawn } = require('child_process');
const winston = require('winston');
const { v4: uuidv4 } = require('uuid');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.simple(),
  transports: [new winston.transports.Console()]
});

class FrameCaptureService extends EventEmitter {
  constructor() {
    super();
    this.ffmpegProcesses = new Map(); // Map of cameraId -> FFmpeg process
    this.frameBuffers = new Map();    // Map of cameraId -> temporary buffer
    this.sequenceNumbers = new Map(); // Map of cameraId -> sequence number
    this.isRunning = false;
  }

  /**
   * Start capturing frames from a camera
   * @param {Object} options - Capture options
   * @param {string} options.cameraId - Unique camera identifier
   * @param {string} options.url - RTSP/HTTP URL of the camera
   * @param {Object} options.ffmpegOptions - FFmpeg options
   * @param {Object} options.metadata - Additional metadata for frames
   */
  async startCapture(options) {
    const { 
      cameraId, 
      url, 
      ffmpegOptions = {}, 
      metadata = {} 
    } = options;

    if (this.ffmpegProcesses.has(cameraId)) {
      logger.warn(`Capture already running for camera ${cameraId}`);
      return;
    }

    logger.info(`Starting frame capture for camera ${cameraId}`);

    // Initialize buffers and counters
    this.frameBuffers.set(cameraId, Buffer.alloc(0));
    this.sequenceNumbers.set(cameraId, 0);

    // Default FFmpeg arguments
    const defaultArgs = [
      '-rtsp_transport', 'tcp',
      '-i', url,
      '-f', 'mjpeg',
      '-q:v', '5',
      '-r', '15',
      '-s', '1280x720',
      'pipe:1'
    ];

    // Merge with custom options
    const ffmpegArgs = this._buildFFmpegArgs(defaultArgs, ffmpegOptions);

    try {
      const ffmpegProcess = spawn('ffmpeg', ffmpegArgs);
      this.ffmpegProcesses.set(cameraId, ffmpegProcess);

      // Handle stdout data (frames)
      ffmpegProcess.stdout.on('data', (chunk) => {
        this._handleFrameData(cameraId, chunk, metadata);
      });

      // Handle stderr (FFmpeg logs)
      ffmpegProcess.stderr.on('data', (data) => {
        const message = data.toString();
        if (message.includes('error') || message.includes('Error')) {
          logger.error(`FFmpeg error for camera ${cameraId}: ${message}`);
          this.emit('error', {
            cameraId,
            error: new Error(message),
            timestamp: new Date().toISOString()
          });
        }
      });

      // Handle process exit
      ffmpegProcess.on('close', (code) => {
        logger.info(`FFmpeg process for camera ${cameraId} ended with code ${code}`);
        this._cleanupCamera(cameraId);
        
        this.emit('capture-ended', {
          cameraId,
          code,
          timestamp: new Date().toISOString()
        });

        // Auto-restart on unexpected exit
        if (code !== 0 && this.isRunning) {
          logger.info(`Attempting to restart capture for camera ${cameraId}`);
          setTimeout(() => {
            if (!this.ffmpegProcesses.has(cameraId)) {
              this.startCapture(options);
            }
          }, 5000);
        }
      });

      this.emit('capture-started', {
        cameraId,
        url,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error(`Failed to start capture for camera ${cameraId}:`, error);
      this._cleanupCamera(cameraId);
      throw error;
    }
  }

  /**
   * Stop capturing frames from a camera
   * @param {string} cameraId - Camera identifier
   */
  async stopCapture(cameraId) {
    const ffmpegProcess = this.ffmpegProcesses.get(cameraId);
    
    if (!ffmpegProcess) {
      logger.warn(`No capture process found for camera ${cameraId}`);
      return;
    }

    logger.info(`Stopping frame capture for camera ${cameraId}`);

    try {
      ffmpegProcess.kill('SIGTERM');
      
      // Force kill after timeout
      setTimeout(() => {
        if (this.ffmpegProcesses.has(cameraId)) {
          const proc = this.ffmpegProcesses.get(cameraId);
          if (proc && !proc.killed) {
            proc.kill('SIGKILL');
          }
        }
      }, 5000);

    } catch (error) {
      logger.error(`Error stopping capture for camera ${cameraId}:`, error);
    }
  }

  /**
   * Stop all captures
   */
  async stopAll() {
    logger.info('Stopping all frame captures');
    
    const cameraIds = Array.from(this.ffmpegProcesses.keys());
    
    for (const cameraId of cameraIds) {
      await this.stopCapture(cameraId);
    }
    
    this.isRunning = false;
  }

  /**
   * Handle incoming frame data from FFmpeg
   * @private
   */
  _handleFrameData(cameraId, chunk, metadata) {
    let buffer = this.frameBuffers.get(cameraId) || Buffer.alloc(0);
    buffer = Buffer.concat([buffer, chunk]);
    
    // JPEG frame markers
    const JPEG_START = Buffer.from([0xFF, 0xD8]);
    const JPEG_END = Buffer.from([0xFF, 0xD9]);
    
    let startIndex = buffer.indexOf(JPEG_START);
    let endIndex = buffer.indexOf(JPEG_END);
    
    while (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
      // Extract complete JPEG frame
      const frameData = buffer.slice(startIndex, endIndex + 2);
      
      // Get and increment sequence number
      const sequenceNumber = this.sequenceNumbers.get(cameraId) || 0;
      this.sequenceNumbers.set(cameraId, sequenceNumber + 1);
      
      // Create frame object
      const frame = {
        id: uuidv4(),
        cameraId,
        timestamp: new Date().toISOString(),
        sequenceNumber,
        data: frameData,
        metadata: {
          ...metadata,
          size: frameData.length,
          format: 'jpeg'
        }
      };
      
      // Emit frame event
      this.emit('frame', frame);
      
      // Update buffer to remove processed frame
      buffer = buffer.slice(endIndex + 2);
      
      // Look for next frame
      startIndex = buffer.indexOf(JPEG_START);
      endIndex = buffer.indexOf(JPEG_END);
    }
    
    // Save remaining buffer
    this.frameBuffers.set(cameraId, buffer);
  }

  /**
   * Build FFmpeg arguments from defaults and options
   * @private
   */
  _buildFFmpegArgs(defaultArgs, options) {
    const args = [...defaultArgs];
    
    // Override or add FFmpeg options
    if (options.resolution) {
      const sIndex = args.indexOf('-s');
      if (sIndex !== -1) {
        args[sIndex + 1] = options.resolution;
      }
    }
    
    if (options.fps) {
      const rIndex = args.indexOf('-r');
      if (rIndex !== -1) {
        args[rIndex + 1] = options.fps.toString();
      }
    }
    
    if (options.quality) {
      const qIndex = args.indexOf('-q:v');
      if (qIndex !== -1) {
        args[qIndex + 1] = options.quality.toString();
      }
    }
    
    // Add any additional custom arguments
    if (options.customArgs && Array.isArray(options.customArgs)) {
      args.push(...options.customArgs);
    }
    
    return args;
  }

  /**
   * Cleanup resources for a camera
   * @private
   */
  _cleanupCamera(cameraId) {
    this.ffmpegProcesses.delete(cameraId);
    this.frameBuffers.delete(cameraId);
    this.sequenceNumbers.delete(cameraId);
  }

  /**
   * Get capture status for a camera
   * @param {string} cameraId - Camera identifier
   */
  getCaptureStatus(cameraId) {
    const process = this.ffmpegProcesses.get(cameraId);
    const sequenceNumber = this.sequenceNumbers.get(cameraId) || 0;
    
    return {
      cameraId,
      isCapturing: !!process && !process.killed,
      framesProcessed: sequenceNumber,
      bufferSize: this.frameBuffers.get(cameraId)?.length || 0
    };
  }

  /**
   * Get status for all cameras
   */
  getAllStatus() {
    const status = {};
    
    for (const cameraId of this.ffmpegProcesses.keys()) {
      status[cameraId] = this.getCaptureStatus(cameraId);
    }
    
    return status;
  }

  /**
   * Check if FFmpeg is available
   */
  static async checkFFmpegAvailable() {
    return new Promise((resolve) => {
      const check = spawn('ffmpeg', ['-version']);
      
      check.on('error', () => {
        logger.error('FFmpeg not found! Please install FFmpeg');
        resolve(false);
      });
      
      check.on('close', (code) => {
        resolve(code === 0);
      });
    });
  }
}

module.exports = FrameCaptureService;