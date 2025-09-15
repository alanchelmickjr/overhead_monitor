/**
 * Frame Handler - Client-side frame management for both MJPEG and WebSocket streaming
 * Handles frame display, buffering, rate adaptation, and smooth transitions
 */

class FrameHandler {
  constructor(options = {}) {
    // Configuration
    this.displayElement = options.displayElement || null;
    this.canvasElement = options.canvasElement || null;
    this.mode = options.mode || 'auto'; // 'mjpeg', 'websocket', 'auto'
    this.maxBufferSize = options.maxBufferSize || 30;
    this.targetFPS = options.targetFPS || 30;
    this.smoothTransitions = options.smoothTransitions !== false;
    
    // State
    this.isActive = false;
    this.currentMode = null;
    this.frameBuffer = [];
    this.displayTimer = null;
    this.lastFrameTime = 0;
    this.frameCount = 0;
    this.frameDrops = 0;
    
    // Performance monitoring
    this.performance = {
      fps: 0,
      avgFrameTime: 0,
      bufferSize: 0,
      networkLatency: 0,
      frameDropRate: 0
    };
    
    // Callbacks
    this.onFrameDisplayed = options.onFrameDisplayed || null;
    this.onPerformanceUpdate = options.onPerformanceUpdate || null;
    this.onModeChange = options.onModeChange || null;
    
    // Bind methods
    this.displayNextFrame = this.displayNextFrame.bind(this);
    this.updatePerformanceMetrics = this.updatePerformanceMetrics.bind(this);
    
    // Initialize
    this._initialize();
  }
  
  /**
   * Initialize frame handler
   */
  _initialize() {
    // Set up canvas if provided
    if (this.canvasElement) {
      this.ctx = this.canvasElement.getContext('2d');
      this.canvasElement.style.imageRendering = this.smoothTransitions ? 'auto' : 'pixelated';
    }
    
    // Start performance monitoring
    setInterval(this.updatePerformanceMetrics, 1000);
  }
  
  /**
   * Start frame handling
   * @param {string} streamUrl - MJPEG stream URL (optional)
   */
  start(streamUrl) {
    if (this.isActive) {
      console.warn('FrameHandler already active');
      return;
    }
    
    this.isActive = true;
    this.frameCount = 0;
    this.frameDrops = 0;
    
    // Determine mode
    if (this.mode === 'mjpeg' || (this.mode === 'auto' && streamUrl)) {
      this._startMJPEGMode(streamUrl);
    } else if (this.mode === 'websocket' || (this.mode === 'auto' && !streamUrl)) {
      this._startWebSocketMode();
    }
    
    // Start display loop
    this._startDisplayLoop();
  }
  
  /**
   * Stop frame handling
   */
  stop() {
    this.isActive = false;
    
    // Stop display loop
    if (this.displayTimer) {
      cancelAnimationFrame(this.displayTimer);
      this.displayTimer = null;
    }
    
    // Clear buffer
    this.frameBuffer = [];
    
    // Clear display
    if (this.canvasElement && this.ctx) {
      this.ctx.clearRect(0, 0, this.canvasElement.width, this.canvasElement.height);
    }
    
    console.log('FrameHandler stopped');
  }
  
  /**
   * Add frame from WebSocket
   * @param {Object} frameData - Frame data object
   */
  addWebSocketFrame(frameData) {
    if (!this.isActive || this.currentMode !== 'websocket') {
      return;
    }
    
    // Add timestamp if not present
    if (!frameData.receivedAt) {
      frameData.receivedAt = Date.now();
    }
    
    // Add to buffer
    this.frameBuffer.push(frameData);
    
    // Maintain buffer size
    while (this.frameBuffer.length > this.maxBufferSize) {
      const dropped = this.frameBuffer.shift();
      this.frameDrops++;
      console.debug('Frame dropped from buffer', dropped.timestamp);
    }
  }
  
  /**
   * Switch streaming mode
   * @param {string} mode - 'mjpeg', 'websocket', or 'auto'
   */
  switchMode(mode) {
    const wasActive = this.isActive;
    
    if (wasActive) {
      this.stop();
    }
    
    this.mode = mode;
    
    if (wasActive) {
      this.start();
    }
    
    if (this.onModeChange) {
      this.onModeChange(mode);
    }
  }
  
  /**
   * Adjust frame rate based on performance
   * @param {number} targetFPS - Target frames per second
   */
  setTargetFPS(targetFPS) {
    this.targetFPS = Math.max(1, Math.min(60, targetFPS));
    console.log(`Target FPS set to ${this.targetFPS}`);
  }
  
  /**
   * Enable/disable smooth transitions
   * @param {boolean} enabled
   */
  setSmoothTransitions(enabled) {
    this.smoothTransitions = enabled;
    if (this.canvasElement) {
      this.canvasElement.style.imageRendering = enabled ? 'auto' : 'pixelated';
    }
  }
  
  /**
   * Get current performance metrics
   * @returns {Object} Performance metrics
   */
  getPerformanceMetrics() {
    return { ...this.performance };
  }
  
  /**
   * Start MJPEG mode
   * @private
   */
  _startMJPEGMode(streamUrl) {
    this.currentMode = 'mjpeg';
    
    if (this.displayElement && this.displayElement.tagName === 'IMG') {
      this.displayElement.src = streamUrl;
      this.displayElement.style.display = 'block';
      
      // Hide canvas if using img element
      if (this.canvasElement) {
        this.canvasElement.style.display = 'none';
      }
    }
    
    console.log('Started MJPEG mode');
  }
  
  /**
   * Start WebSocket mode
   * @private
   */
  _startWebSocketMode() {
    this.currentMode = 'websocket';
    
    // Hide img element if present
    if (this.displayElement && this.displayElement.tagName === 'IMG') {
      this.displayElement.style.display = 'none';
    }
    
    // Show canvas
    if (this.canvasElement) {
      this.canvasElement.style.display = 'block';
    }
    
    console.log('Started WebSocket mode');
  }
  
  /**
   * Start display loop
   * @private
   */
  _startDisplayLoop() {
    const targetInterval = 1000 / this.targetFPS;
    let lastTime = performance.now();
    
    const loop = (currentTime) => {
      if (!this.isActive) return;
      
      const deltaTime = currentTime - lastTime;
      
      if (deltaTime >= targetInterval) {
        this.displayNextFrame();
        lastTime = currentTime - (deltaTime % targetInterval);
      }
      
      this.displayTimer = requestAnimationFrame(loop);
    };
    
    this.displayTimer = requestAnimationFrame(loop);
  }
  
  /**
   * Display next frame from buffer
   */
  displayNextFrame() {
    if (this.currentMode !== 'websocket' || this.frameBuffer.length === 0) {
      return;
    }
    
    const frame = this.frameBuffer.shift();
    const now = Date.now();
    
    // Check frame age
    const frameAge = now - frame.receivedAt;
    if (frameAge > 1000) {
      console.debug('Skipping old frame', frameAge + 'ms old');
      this.frameDrops++;
      return;
    }
    
    // Display frame
    this._displayFrame(frame);
    
    // Update metrics
    this.frameCount++;
    this.lastFrameTime = now;
    
    // Callback
    if (this.onFrameDisplayed) {
      this.onFrameDisplayed(frame);
    }
  }
  
  /**
   * Display a frame on canvas
   * @private
   */
  _displayFrame(frameData) {
    if (!this.canvasElement || !this.ctx) return;
    
    const img = new Image();
    img.onload = () => {
      // Set canvas size if needed
      if (this.canvasElement.width !== img.width || this.canvasElement.height !== img.height) {
        this.canvasElement.width = img.width;
        this.canvasElement.height = img.height;
      }
      
      // Apply smooth transition if enabled
      if (this.smoothTransitions && this.lastFrameTime > 0) {
        this.ctx.globalAlpha = 0.9;
      } else {
        this.ctx.globalAlpha = 1.0;
      }
      
      // Draw image
      this.ctx.drawImage(img, 0, 0);
      
      // Reset alpha
      this.ctx.globalAlpha = 1.0;
    };
    
    // Load image from base64
    img.src = `data:image/${frameData.format || 'jpeg'};base64,${frameData.image}`;
  }
  
  /**
   * Update performance metrics
   */
  updatePerformanceMetrics() {
    if (!this.isActive) return;
    
    const now = Date.now();
    const elapsed = now - this.lastFrameTime;
    
    // Calculate FPS
    this.performance.fps = this.frameCount;
    this.frameCount = 0;
    
    // Calculate average frame time
    if (this.performance.fps > 0) {
      this.performance.avgFrameTime = Math.round(1000 / this.performance.fps);
    }
    
    // Buffer size
    this.performance.bufferSize = this.frameBuffer.length;
    
    // Frame drop rate
    this.performance.frameDropRate = this.frameDrops;
    this.frameDrops = 0;
    
    // Network latency (WebSocket mode)
    if (this.currentMode === 'websocket' && this.frameBuffer.length > 0) {
      const latestFrame = this.frameBuffer[this.frameBuffer.length - 1];
      if (latestFrame.timestamp) {
        this.performance.networkLatency = Date.now() - new Date(latestFrame.timestamp).getTime();
      }
    }
    
    // Callback
    if (this.onPerformanceUpdate) {
      this.onPerformanceUpdate(this.performance);
    }
    
    // Auto-adjust frame rate based on performance
    this._autoAdjustFrameRate();
  }
  
  /**
   * Auto-adjust frame rate based on performance
   * @private
   */
  _autoAdjustFrameRate() {
    if (!this.isActive || this.currentMode !== 'websocket') return;
    
    // If buffer is consistently full, reduce frame rate
    if (this.performance.bufferSize >= this.maxBufferSize * 0.8) {
      this.setTargetFPS(Math.max(10, this.targetFPS - 5));
    }
    // If buffer is empty and FPS is low, increase frame rate
    else if (this.performance.bufferSize < 5 && this.performance.fps < this.targetFPS * 0.8) {
      this.setTargetFPS(Math.min(30, this.targetFPS + 5));
    }
  }
  
  /**
   * Get buffer status
   * @returns {Object} Buffer status
   */
  getBufferStatus() {
    return {
      size: this.frameBuffer.length,
      maxSize: this.maxBufferSize,
      utilization: (this.frameBuffer.length / this.maxBufferSize) * 100,
      oldestFrame: this.frameBuffer[0]?.timestamp || null,
      newestFrame: this.frameBuffer[this.frameBuffer.length - 1]?.timestamp || null
    };
  }
  
  /**
   * Clear frame buffer
   */
  clearBuffer() {
    const cleared = this.frameBuffer.length;
    this.frameBuffer = [];
    console.log(`Cleared ${cleared} frames from buffer`);
  }
  
  /**
   * Destroy handler and clean up
   */
  destroy() {
    this.stop();
    this.frameBuffer = [];
    this.displayElement = null;
    this.canvasElement = null;
    this.ctx = null;
    console.log('FrameHandler destroyed');
  }
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = FrameHandler;
}