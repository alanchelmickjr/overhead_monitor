/**
 * Frame Buffer Manager
 * Maintains circular buffers of frames for each camera
 * Supports subscription-based distribution of frames
 */

const EventEmitter = require('events');
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.simple(),
  transports: [new winston.transports.Console()]
});

class FrameBufferManager extends EventEmitter {
  constructor(options = {}) {
    super();
    
    // Configuration
    this.defaultBufferSize = options.defaultBufferSize || 100;
    this.maxBufferMemory = options.maxBufferMemory || 100 * 1024 * 1024; // 100MB default
    
    // Storage
    this.buffers = new Map();        // Map of cameraId -> circular buffer array
    this.bufferMetadata = new Map(); // Map of cameraId -> buffer metadata
    this.subscribers = new Map();     // Map of subscriberId -> subscription info
    
    // Statistics
    this.stats = {
      totalFramesBuffered: 0,
      totalFramesDistributed: 0,
      totalMemoryUsage: 0,
      droppedFrames: 0
    };
    
    logger.info(`Frame Buffer Manager initialized with default buffer size: ${this.defaultBufferSize}`);
  }

  /**
   * Initialize buffer for a camera
   * @param {string} cameraId - Camera identifier
   * @param {Object} options - Buffer options
   * @param {number} options.bufferSize - Size of circular buffer
   */
  initializeBuffer(cameraId, options = {}) {
    const bufferSize = options.bufferSize || this.defaultBufferSize;
    
    if (this.buffers.has(cameraId)) {
      logger.warn(`Buffer already exists for camera ${cameraId}`);
      return;
    }
    
    this.buffers.set(cameraId, []);
    this.bufferMetadata.set(cameraId, {
      bufferSize,
      currentIndex: 0,
      totalFrames: 0,
      memoryUsage: 0,
      oldestFrameIndex: 0,
      newestFrameIndex: -1,
      created: new Date().toISOString()
    });
    
    logger.info(`Initialized buffer for camera ${cameraId} with size ${bufferSize}`);
    
    this.emit('buffer-initialized', { cameraId, bufferSize });
  }

  /**
   * Add frame to buffer
   * @param {Object} frame - Frame object with required properties
   */
  addFrame(frame) {
    const { cameraId } = frame;
    
    if (!this.buffers.has(cameraId)) {
      this.initializeBuffer(cameraId);
    }
    
    const buffer = this.buffers.get(cameraId);
    const metadata = this.bufferMetadata.get(cameraId);
    
    // Calculate frame memory usage
    const frameMemory = frame.data.length;
    
    // Check memory constraints
    if (this.stats.totalMemoryUsage + frameMemory > this.maxBufferMemory) {
      logger.warn(`Memory limit reached, dropping frame for camera ${cameraId}`);
      this.stats.droppedFrames++;
      this.emit('frame-dropped', { cameraId, reason: 'memory-limit' });
      return;
    }
    
    // Add frame to circular buffer
    if (buffer.length < metadata.bufferSize) {
      // Buffer not full yet
      buffer.push(frame);
      metadata.newestFrameIndex = buffer.length - 1;
    } else {
      // Circular buffer - overwrite oldest
      const oldFrame = buffer[metadata.currentIndex];
      if (oldFrame) {
        this.stats.totalMemoryUsage -= oldFrame.data.length;
        metadata.memoryUsage -= oldFrame.data.length;
      }
      
      buffer[metadata.currentIndex] = frame;
      metadata.newestFrameIndex = metadata.currentIndex;
      metadata.oldestFrameIndex = (metadata.currentIndex + 1) % metadata.bufferSize;
    }
    
    // Update metadata
    metadata.currentIndex = (metadata.currentIndex + 1) % metadata.bufferSize;
    metadata.totalFrames++;
    metadata.memoryUsage += frameMemory;
    this.stats.totalMemoryUsage += frameMemory;
    this.stats.totalFramesBuffered++;
    
    // Distribute frame to subscribers
    this._distributeFrame(frame);
    
    // Emit buffer update event
    this.emit('frame-buffered', {
      cameraId,
      frameId: frame.id,
      bufferSize: buffer.length,
      memoryUsage: metadata.memoryUsage
    });
  }

  /**
   * Subscribe to frames from specific cameras
   * @param {Object} options - Subscription options
   * @param {string} options.subscriberId - Unique subscriber identifier
   * @param {Array<string>} options.cameraIds - Camera IDs to subscribe to (empty = all)
   * @param {string} options.mode - Subscription mode: 'live', 'buffered', 'both'
   * @param {Function} options.callback - Callback function for frames
   * @param {number} options.bufferReplayCount - Number of buffered frames to replay
   */
  subscribe(options) {
    const {
      subscriberId,
      cameraIds = [],
      mode = 'live',
      callback,
      bufferReplayCount = 0
    } = options;
    
    if (!subscriberId || !callback) {
      throw new Error('subscriberId and callback are required');
    }
    
    const subscription = {
      subscriberId,
      cameraIds: new Set(cameraIds),
      mode,
      callback,
      subscribed: new Date().toISOString(),
      framesReceived: 0
    };
    
    this.subscribers.set(subscriberId, subscription);
    
    logger.info(`New subscription: ${subscriberId} for ${cameraIds.length || 'all'} cameras in ${mode} mode`);
    
    // Send buffered frames if requested
    if ((mode === 'buffered' || mode === 'both') && bufferReplayCount > 0) {
      this._sendBufferedFrames(subscriberId, bufferReplayCount);
    }
    
    this.emit('subscription-added', { subscriberId, cameraIds, mode });
    
    return {
      subscriberId,
      unsubscribe: () => this.unsubscribe(subscriberId)
    };
  }

  /**
   * Unsubscribe from frame updates
   * @param {string} subscriberId - Subscriber identifier
   */
  unsubscribe(subscriberId) {
    if (!this.subscribers.has(subscriberId)) {
      logger.warn(`Subscriber ${subscriberId} not found`);
      return false;
    }
    
    this.subscribers.delete(subscriberId);
    logger.info(`Unsubscribed: ${subscriberId}`);
    
    this.emit('subscription-removed', { subscriberId });
    return true;
  }

  /**
   * Get latest frame from camera buffer
   * @param {string} cameraId - Camera identifier
   */
  getLatestFrame(cameraId) {
    const buffer = this.buffers.get(cameraId);
    const metadata = this.bufferMetadata.get(cameraId);
    
    if (!buffer || buffer.length === 0) {
      return null;
    }
    
    return buffer[metadata.newestFrameIndex];
  }

  /**
   * Get multiple frames from buffer
   * @param {string} cameraId - Camera identifier
   * @param {number} count - Number of frames to retrieve
   * @param {boolean} newest - Get newest frames (true) or oldest (false)
   */
  getFrames(cameraId, count = 10, newest = true) {
    const buffer = this.buffers.get(cameraId);
    const metadata = this.bufferMetadata.get(cameraId);
    
    if (!buffer || buffer.length === 0) {
      return [];
    }
    
    const frames = [];
    const bufferLength = buffer.length;
    const requestedCount = Math.min(count, bufferLength);
    
    if (newest) {
      // Get newest frames
      let index = metadata.newestFrameIndex;
      for (let i = 0; i < requestedCount; i++) {
        if (buffer[index]) {
          frames.unshift(buffer[index]);
        }
        index = (index - 1 + bufferLength) % bufferLength;
        
        // Stop if we've wrapped around to oldest frame
        if (bufferLength === metadata.bufferSize && index === metadata.newestFrameIndex) {
          break;
        }
      }
    } else {
      // Get oldest frames
      let index = metadata.oldestFrameIndex;
      for (let i = 0; i < requestedCount; i++) {
        if (buffer[index]) {
          frames.push(buffer[index]);
        }
        index = (index + 1) % bufferLength;
        
        // Stop if we've caught up to newest frame
        if (index === metadata.currentIndex) {
          break;
        }
      }
    }
    
    return frames;
  }

  /**
   * Clear buffer for a camera
   * @param {string} cameraId - Camera identifier
   */
  clearBuffer(cameraId) {
    const buffer = this.buffers.get(cameraId);
    const metadata = this.bufferMetadata.get(cameraId);
    
    if (!buffer) {
      logger.warn(`No buffer found for camera ${cameraId}`);
      return;
    }
    
    // Update memory usage
    this.stats.totalMemoryUsage -= metadata.memoryUsage;
    
    // Clear buffer
    buffer.length = 0;
    
    // Reset metadata
    metadata.currentIndex = 0;
    metadata.oldestFrameIndex = 0;
    metadata.newestFrameIndex = -1;
    metadata.memoryUsage = 0;
    metadata.totalFrames = 0;
    
    logger.info(`Cleared buffer for camera ${cameraId}`);
    
    this.emit('buffer-cleared', { cameraId });
  }

  /**
   * Clear all buffers
   */
  clearAllBuffers() {
    const cameraIds = Array.from(this.buffers.keys());
    
    for (const cameraId of cameraIds) {
      this.clearBuffer(cameraId);
    }
    
    this.stats.totalMemoryUsage = 0;
    logger.info('Cleared all buffers');
  }

  /**
   * Get buffer statistics for a camera
   * @param {string} cameraId - Camera identifier
   */
  getBufferStats(cameraId) {
    const buffer = this.buffers.get(cameraId);
    const metadata = this.bufferMetadata.get(cameraId);
    
    if (!buffer) {
      return null;
    }
    
    return {
      cameraId,
      bufferSize: metadata.bufferSize,
      currentFrames: buffer.length,
      totalFrames: metadata.totalFrames,
      memoryUsage: metadata.memoryUsage,
      oldestFrameIndex: metadata.oldestFrameIndex,
      newestFrameIndex: metadata.newestFrameIndex,
      created: metadata.created
    };
  }

  /**
   * Get overall statistics
   */
  getStatistics() {
    const cameraStats = {};
    
    for (const [cameraId] of this.buffers) {
      cameraStats[cameraId] = this.getBufferStats(cameraId);
    }
    
    return {
      ...this.stats,
      subscriberCount: this.subscribers.size,
      cameraCount: this.buffers.size,
      cameras: cameraStats
    };
  }

  /**
   * Distribute frame to subscribers
   * @private
   */
  _distributeFrame(frame) {
    const { cameraId } = frame;
    let distributedCount = 0;
    
    for (const [subscriberId, subscription] of this.subscribers) {
      // Check if subscriber wants this camera
      if (subscription.cameraIds.size > 0 && !subscription.cameraIds.has(cameraId)) {
        continue;
      }
      
      // Check subscription mode
      if (subscription.mode === 'buffered') {
        continue; // Skip live distribution for buffered-only mode
      }
      
      try {
        subscription.callback(frame);
        subscription.framesReceived++;
        distributedCount++;
      } catch (error) {
        logger.error(`Error distributing frame to subscriber ${subscriberId}:`, error);
        this.emit('distribution-error', { subscriberId, error });
      }
    }
    
    this.stats.totalFramesDistributed += distributedCount;
  }

  /**
   * Send buffered frames to a subscriber
   * @private
   */
  _sendBufferedFrames(subscriberId, count) {
    const subscription = this.subscribers.get(subscriberId);
    if (!subscription) return;
    
    const cameraIds = subscription.cameraIds.size > 0 
      ? Array.from(subscription.cameraIds) 
      : Array.from(this.buffers.keys());
    
    for (const cameraId of cameraIds) {
      const frames = this.getFrames(cameraId, count, true);
      
      for (const frame of frames) {
        try {
          subscription.callback(frame);
          subscription.framesReceived++;
          this.stats.totalFramesDistributed++;
        } catch (error) {
          logger.error(`Error sending buffered frame to subscriber ${subscriberId}:`, error);
        }
      }
    }
  }

  /**
   * Remove old frames to free memory
   * @param {number} targetMemory - Target memory usage in bytes
   */
  pruneFrames(targetMemory) {
    if (this.stats.totalMemoryUsage <= targetMemory) {
      return 0;
    }
    
    let prunedCount = 0;
    const memoryToFree = this.stats.totalMemoryUsage - targetMemory;
    let freedMemory = 0;
    
    for (const [cameraId, buffer] of this.buffers) {
      const metadata = this.bufferMetadata.get(cameraId);
      
      while (buffer.length > 0 && freedMemory < memoryToFree) {
        const oldestIndex = metadata.oldestFrameIndex;
        const frame = buffer[oldestIndex];
        
        if (frame) {
          freedMemory += frame.data.length;
          this.stats.totalMemoryUsage -= frame.data.length;
          metadata.memoryUsage -= frame.data.length;
          buffer.splice(oldestIndex, 1);
          prunedCount++;
          
          // Update indices
          if (buffer.length > 0) {
            metadata.oldestFrameIndex = (oldestIndex + 1) % buffer.length;
            metadata.newestFrameIndex = buffer.length - 1;
          } else {
            metadata.oldestFrameIndex = 0;
            metadata.newestFrameIndex = -1;
          }
        }
        
        if (freedMemory >= memoryToFree) break;
      }
      
      if (freedMemory >= memoryToFree) break;
    }
    
    logger.info(`Pruned ${prunedCount} frames to free ${freedMemory} bytes`);
    return prunedCount;
  }

  /**
   * Destroy manager and clean up resources
   */
  destroy() {
    logger.info('Destroying Frame Buffer Manager');
    
    // Clear all subscriptions
    this.subscribers.clear();
    
    // Clear all buffers
    this.clearAllBuffers();
    
    // Remove all listeners
    this.removeAllListeners();
    
    logger.info('Frame Buffer Manager destroyed');
  }
}

module.exports = FrameBufferManager;