/**
 * WebSocket Handler - Manages real-time communication with clients
 */

const winston = require('winston');
const jwt = require('jsonwebtoken');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.simple(),
  transports: [new winston.transports.Console()]
});

class WebSocketHandler {
  constructor(io, services = {}) {
    this.io = io;
    this.services = services;
    
    // Connected clients
    this.clients = new Map();
    this.rooms = new Map();
    
    // Statistics
    this.stats = {
      connectionsTotal: 0,
      connectionsActive: 0,
      messagesReceived: 0,
      messagesSent: 0,
      broadcastsSent: 0,
      errors: 0
    };
    
    // Initialize handlers
    this.setupHandlers();
    
    logger.info('WebSocket Handler initialized');
  }

  /**
   * Set up socket handlers
   */
  setupHandlers() {
    this.io.on('connection', (socket) => {
      this.handleConnection(socket);
    });
    
    // Authentication middleware (optional)
    this.io.use((socket, next) => {
      const token = socket.handshake.auth.token;
      
      if (token) {
        try {
          // Verify JWT token if authentication is enabled
          const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
          socket.userId = decoded.userId;
          socket.role = decoded.role;
        } catch (error) {
          logger.warn('Invalid auth token:', error.message);
          // Allow connection anyway for now
        }
      }
      
      next();
    });
  }

  /**
   * Handle new client connection
   */
  handleConnection(socket) {
    this.stats.connectionsTotal++;
    this.stats.connectionsActive++;
    
    const clientInfo = {
      id: socket.id,
      userId: socket.userId,
      role: socket.role,
      connectedAt: new Date(),
      address: socket.handshake.address,
      userAgent: socket.handshake.headers['user-agent']
    };
    
    this.clients.set(socket.id, clientInfo);
    
    logger.info(`Client connected: ${socket.id} from ${clientInfo.address}`);
    
    // Send initial status
    this.sendInitialStatus(socket);
    
    // Set up event handlers
    this.setupSocketHandlers(socket);
    
    // Handle disconnection
    socket.on('disconnect', (reason) => {
      this.handleDisconnection(socket, reason);
    });
  }

  /**
   * Set up socket event handlers
   */
  setupSocketHandlers(socket) {
    // Subscribe to live feed
    socket.on('subscribe', (data) => {
      this.handleSubscribe(socket, data);
    });
    
    // Unsubscribe from feed
    socket.on('unsubscribe', (data) => {
      this.handleUnsubscribe(socket, data);
    });
    
    // Start monitoring
    socket.on('start_monitoring', (data) => {
      this.handleStartMonitoring(socket, data);
    });
    
    // Stop monitoring
    socket.on('stop_monitoring', (data) => {
      this.handleStopMonitoring(socket, data);
    });
    
    // Request frame analysis
    socket.on('analyze_frame', (data) => {
      this.handleAnalyzeFrame(socket, data);
    });
    
    // Update configuration
    socket.on('update_config', (data) => {
      this.handleUpdateConfig(socket, data);
    });
    
    // Acknowledge alert
    socket.on('acknowledge_alert', (data) => {
      this.handleAcknowledgeAlert(socket, data);
    });
    
    // Request snapshot
    socket.on('request_snapshot', (data) => {
      this.handleRequestSnapshot(socket, data);
    });
    
    // Emergency stop
    socket.on('emergency_stop', (data) => {
      this.handleEmergencyStop(socket, data);
    });
    
    // Get status
    socket.on('get_status', (data) => {
      this.handleGetStatus(socket, data);
    });
    
    // Get events
    socket.on('get_events', (data) => {
      this.handleGetEvents(socket, data);
    });
    
    // Get metrics
    socket.on('get_metrics', (data) => {
      this.handleGetMetrics(socket, data);
    });
    
    // Error handler for socket
    socket.on('error', (error) => {
      logger.error(`Socket error for ${socket.id}:`, error);
      this.stats.errors++;
    });
  }

  /**
   * Send initial status to newly connected client
   */
  async sendInitialStatus(socket) {
    const status = {
      timestamp: new Date().toISOString(),
      services: {}
    };
    
    // Get status from each service
    if (this.services.cameraManager) {
      status.services.camera = this.services.cameraManager.getStatus();
      status.cameras = this.services.cameraManager.getAllCameras();
    }
    
    if (this.services.visionEngine) {
      status.services.vision = this.services.visionEngine.getStatus();
    }
    
    if (this.services.database) {
      status.services.database = this.services.database.getStatus();
    }
    
    if (this.services.alertManager) {
      status.services.alerts = this.services.alertManager.getStatus();
      status.activeAlerts = this.services.alertManager.getAlerts({ 
        state: 'pending' 
      });
    }
    
    socket.emit('initial_status', status);
    this.stats.messagesSent++;
  }

  /**
   * Handle subscribe request
   */
  handleSubscribe(socket, data) {
    const { feed, cameraId } = data;
    
    logger.debug(`Client ${socket.id} subscribing to ${feed}`);
    
    // Join room based on feed type
    if (feed === 'live' && cameraId) {
      socket.join(`camera:${cameraId}`);
      socket.emit('subscribed', { feed, cameraId });
    } else if (feed === 'events') {
      socket.join('events');
      socket.emit('subscribed', { feed: 'events' });
    } else if (feed === 'alerts') {
      socket.join('alerts');
      socket.emit('subscribed', { feed: 'alerts' });
    } else if (feed === 'metrics') {
      socket.join('metrics');
      socket.emit('subscribed', { feed: 'metrics' });
    } else {
      socket.emit('error', { 
        message: 'Invalid feed type',
        code: 'INVALID_FEED'
      });
    }
    
    this.stats.messagesReceived++;
  }

  /**
   * Handle unsubscribe request
   */
  handleUnsubscribe(socket, data) {
    const { feed, cameraId } = data;
    
    if (feed === 'live' && cameraId) {
      socket.leave(`camera:${cameraId}`);
    } else if (feed) {
      socket.leave(feed);
    }
    
    socket.emit('unsubscribed', { feed, cameraId });
    this.stats.messagesReceived++;
  }

  /**
   * Handle start monitoring request
   */
  async handleStartMonitoring(socket, data) {
    const { cameraId, interval } = data;
    
    try {
      if (!this.services.cameraManager) {
        throw new Error('Camera manager not available');
      }
      
      await this.services.cameraManager.startStream(cameraId, { interval });
      
      socket.emit('monitoring_started', { cameraId, interval });
      
      // Broadcast to all clients in the camera room
      this.io.to(`camera:${cameraId}`).emit('camera_status', {
        cameraId,
        status: 'streaming',
        interval
      });
      
    } catch (error) {
      socket.emit('error', {
        message: `Failed to start monitoring: ${error.message}`,
        code: 'MONITORING_START_FAILED'
      });
    }
    
    this.stats.messagesReceived++;
  }

  /**
   * Handle stop monitoring request
   */
  async handleStopMonitoring(socket, data) {
    const { cameraId } = data;
    
    try {
      if (!this.services.cameraManager) {
        throw new Error('Camera manager not available');
      }
      
      await this.services.cameraManager.stopStream(cameraId);
      
      socket.emit('monitoring_stopped', { cameraId });
      
      // Broadcast to all clients in the camera room
      this.io.to(`camera:${cameraId}`).emit('camera_status', {
        cameraId,
        status: 'stopped'
      });
      
    } catch (error) {
      socket.emit('error', {
        message: `Failed to stop monitoring: ${error.message}`,
        code: 'MONITORING_STOP_FAILED'
      });
    }
    
    this.stats.messagesReceived++;
  }

  /**
   * Handle frame analysis request
   */
  async handleAnalyzeFrame(socket, data) {
    const { cameraId, prompt } = data;
    
    try {
      if (!this.services.visionEngine) {
        throw new Error('Vision engine not available');
      }
      
      // Get latest frame from camera
      const camera = this.services.cameraManager.getCameraInfo(cameraId);
      if (!camera || !camera.lastFrame) {
        throw new Error('No frame available from camera');
      }
      
      const frameData = {
        cameraId,
        timestamp: new Date().toISOString(),
        image: camera.lastFrame.toString('base64')
      };
      
      // Analyze frame
      const analysis = await this.services.visionEngine.analyzeFrame(frameData, prompt);
      
      socket.emit('frame_analyzed', {
        cameraId,
        analysis
      });
      
    } catch (error) {
      socket.emit('error', {
        message: `Analysis failed: ${error.message}`,
        code: 'ANALYSIS_FAILED'
      });
    }
    
    this.stats.messagesReceived++;
  }

  /**
   * Handle configuration update
   */
  async handleUpdateConfig(socket, data) {
    const { type, value } = data;
    
    // Check permissions (optional)
    if (socket.role !== 'admin') {
      socket.emit('error', {
        message: 'Insufficient permissions',
        code: 'UNAUTHORIZED'
      });
      return;
    }
    
    try {
      // Update configuration based on type
      switch (type) {
        case 'capture_interval':
          // Update capture interval for all cameras
          for (const camera of this.services.cameraManager.getAllCameras()) {
            await this.services.cameraManager.startStream(camera.id, {
              interval: value
            });
          }
          break;
        
        case 'alert_rules':
          this.services.alertManager.updateRules(value);
          break;
        
        case 'zones':
          this.services.eventDetector.setZones(value);
          break;
        
        default:
          throw new Error(`Unknown config type: ${type}`);
      }
      
      socket.emit('config_updated', { type, value });
      
      // Broadcast to all clients
      this.io.emit('configuration_change', { type, value });
      
    } catch (error) {
      socket.emit('error', {
        message: `Config update failed: ${error.message}`,
        code: 'CONFIG_UPDATE_FAILED'
      });
    }
    
    this.stats.messagesReceived++;
  }

  /**
   * Handle alert acknowledgment
   */
  async handleAcknowledgeAlert(socket, data) {
    const { alertId, notes } = data;
    
    try {
      if (!this.services.alertManager) {
        throw new Error('Alert manager not available');
      }
      
      const userId = socket.userId || socket.id;
      const alert = this.services.alertManager.acknowledgeAlert(alertId, userId, notes);
      
      socket.emit('alert_acknowledged', alert);
      
      // Broadcast to all clients in alerts room
      this.io.to('alerts').emit('alert_update', alert);
      
      // Update database
      if (this.services.database) {
        await this.services.database.acknowledgeAlert(alertId, userId, notes);
      }
      
    } catch (error) {
      socket.emit('error', {
        message: `Failed to acknowledge alert: ${error.message}`,
        code: 'ACKNOWLEDGE_FAILED'
      });
    }
    
    this.stats.messagesReceived++;
  }

  /**
   * Handle snapshot request
   */
  async handleRequestSnapshot(socket, data) {
    const { cameraId } = data;
    
    try {
      if (!this.services.cameraManager) {
        throw new Error('Camera manager not available');
      }
      
      await this.services.cameraManager.captureFrame(cameraId);
      
      const camera = this.services.cameraManager.getCameraInfo(cameraId);
      
      socket.emit('snapshot', {
        cameraId,
        timestamp: new Date().toISOString(),
        image: camera.lastFrame ? camera.lastFrame.toString('base64') : null
      });
      
    } catch (error) {
      socket.emit('error', {
        message: `Snapshot failed: ${error.message}`,
        code: 'SNAPSHOT_FAILED'
      });
    }
    
    this.stats.messagesReceived++;
  }

  /**
   * Handle emergency stop
   */
  async handleEmergencyStop(socket, data) {
    const { confirmation } = data;
    
    if (confirmation !== 'CONFIRM_STOP') {
      socket.emit('error', {
        message: 'Invalid confirmation',
        code: 'INVALID_CONFIRMATION'
      });
      return;
    }
    
    logger.warn(`EMERGENCY STOP triggered by ${socket.id}`);
    
    // Stop all camera streams
    if (this.services.cameraManager) {
      await this.services.cameraManager.stopAll();
    }
    
    // Create critical alert
    if (this.services.alertManager) {
      const alert = {
        id: require('uuid').v4(),
        eventType: 'emergency_stop',
        priority: 'critical',
        title: 'Emergency Stop Activated',
        message: `Emergency stop triggered by user ${socket.userId || socket.id}`,
        channels: ['dashboard', 'email', 'sms'],
        metadata: {
          triggeredBy: socket.id,
          timestamp: new Date().toISOString()
        }
      };
      
      await this.services.alertManager.processAlert(alert);
    }
    
    // Broadcast emergency stop to all clients
    this.io.emit('emergency_stop_activated', {
      triggeredBy: socket.id,
      timestamp: new Date().toISOString()
    });
    
    socket.emit('emergency_stop_confirmed');
    
    this.stats.messagesReceived++;
  }

  /**
   * Handle status request
   */
  async handleGetStatus(socket, data) {
    const status = {
      timestamp: new Date().toISOString(),
      services: {},
      statistics: {}
    };
    
    // Gather status from all services
    if (this.services.cameraManager) {
      status.services.camera = this.services.cameraManager.getStatus();
      status.statistics.cameras = this.services.cameraManager.getStatistics();
    }
    
    if (this.services.visionEngine) {
      status.services.vision = this.services.visionEngine.getStatus();
      status.statistics.vision = this.services.visionEngine.getStatistics();
    }
    
    if (this.services.eventDetector) {
      status.statistics.events = this.services.eventDetector.getStatistics();
    }
    
    if (this.services.alertManager) {
      status.services.alerts = this.services.alertManager.getStatus();
      status.statistics.alerts = this.services.alertManager.getStatistics();
    }
    
    if (this.services.database) {
      status.services.database = this.services.database.getStatus();
      status.statistics.database = await this.services.database.getDatabaseStats();
    }
    
    status.statistics.websocket = this.stats;
    
    socket.emit('status', status);
    this.stats.messagesReceived++;
    this.stats.messagesSent++;
  }

  /**
   * Handle get events request
   */
  async handleGetEvents(socket, data) {
    const { limit = 10, offset = 0, filters = {} } = data;
    
    try {
      let events = [];
      
      if (this.services.database) {
        events = await this.services.database.getEvents({
          ...filters,
          limit,
          offset
        });
      } else if (this.services.eventDetector) {
        events = this.services.eventDetector.getRecentEvents(limit);
      }
      
      socket.emit('events', events);
      
    } catch (error) {
      socket.emit('error', {
        message: `Failed to get events: ${error.message}`,
        code: 'GET_EVENTS_FAILED'
      });
    }
    
    this.stats.messagesReceived++;
    this.stats.messagesSent++;
  }

  /**
   * Handle get metrics request
   */
  async handleGetMetrics(socket, data) {
    const { robotId, period = 'hour', aggregate = false } = data;
    
    try {
      let metrics = [];
      
      if (this.services.database) {
        const endDate = new Date();
        const startDate = new Date();
        
        // Set start date based on period
        switch (period) {
          case 'hour':
            startDate.setHours(startDate.getHours() - 1);
            break;
          case 'day':
            startDate.setDate(startDate.getDate() - 1);
            break;
          case 'week':
            startDate.setDate(startDate.getDate() - 7);
            break;
          case 'month':
            startDate.setMonth(startDate.getMonth() - 1);
            break;
        }
        
        metrics = await this.services.database.getMetrics({
          robotId,
          startDate,
          endDate,
          aggregate,
          period
        });
      }
      
      socket.emit('metrics', {
        robotId,
        period,
        data: metrics
      });
      
    } catch (error) {
      socket.emit('error', {
        message: `Failed to get metrics: ${error.message}`,
        code: 'GET_METRICS_FAILED'
      });
    }
    
    this.stats.messagesReceived++;
    this.stats.messagesSent++;
  }

  /**
   * Handle client disconnection
   */
  handleDisconnection(socket, reason) {
    this.stats.connectionsActive--;
    
    const clientInfo = this.clients.get(socket.id);
    
    if (clientInfo) {
      const duration = Date.now() - clientInfo.connectedAt.getTime();
      logger.info(`Client disconnected: ${socket.id} after ${duration}ms - Reason: ${reason}`);
    }
    
    this.clients.delete(socket.id);
  }

  /**
   * Broadcast frame to subscribers
   */
  broadcastFrame(frameData) {
    const room = `camera:${frameData.cameraId}`;
    
    this.io.to(room).emit('frame', {
      cameraId: frameData.cameraId,
      timestamp: frameData.timestamp,
      image: frameData.image,
      format: frameData.format || 'jpeg',
      analysis: frameData.analysis
    });
    
    this.stats.broadcastsSent++;
    this.stats.messagesSent += this.io.sockets.adapter.rooms.get(room)?.size || 0;
  }

  /**
   * Broadcast event to subscribers
   */
  broadcastEvent(event) {
    this.io.to('events').emit('event_detected', {
      id: event.id,
      type: event.type,
      timestamp: event.timestamp,
      cameraId: event.cameraId,
      robotId: event.robotId,
      zoneId: event.zoneId,
      confidence: event.confidence,
      priority: event.priority,
      description: event.description
    });
    
    this.stats.broadcastsSent++;
    this.stats.messagesSent += this.io.sockets.adapter.rooms.get('events')?.size || 0;
  }

  /**
   * Broadcast alert to subscribers
   */
  broadcastAlert(alert) {
    // Send to alerts room
    this.io.to('alerts').emit('alert', {
      id: alert.id,
      eventId: alert.eventId,
      eventType: alert.eventType,
      priority: alert.priority,
      title: alert.title,
      message: alert.message,
      timestamp: alert.metadata.timestamp,
      state: alert.state
    });
    
    // Also send to dashboard for immediate display
    this.io.to('dashboard').emit('alert_notification', {
      id: alert.id,
      priority: alert.priority,
      title: alert.title,
      message: alert.message
    });
    
    this.stats.broadcastsSent++;
    this.stats.messagesSent += 
      (this.io.sockets.adapter.rooms.get('alerts')?.size || 0) +
      (this.io.sockets.adapter.rooms.get('dashboard')?.size || 0);
  }

  /**
   * Broadcast robot status update
   */
  broadcastRobotStatus(status) {
    this.io.to('metrics').emit('robot_status', status);
    
    this.stats.broadcastsSent++;
    this.stats.messagesSent += this.io.sockets.adapter.rooms.get('metrics')?.size || 0;
  }

  /**
   * Broadcast system status
   */
  broadcastSystemStatus(status) {
    this.io.emit('system_status', status);
    
    this.stats.broadcastsSent++;
    this.stats.messagesSent += this.clients.size;
  }

  /**
   * Get connected clients
   */
  getConnectedClients() {
    return Array.from(this.clients.values());
  }

  /**
   * Get statistics
   */
  getStatistics() {
    return {
      ...this.stats,
      rooms: Array.from(this.io.sockets.adapter.rooms.keys()),
      clientCount: this.clients.size
    };
  }
}

module.exports = WebSocketHandler;