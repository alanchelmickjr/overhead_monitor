/**
 * In-Memory Storage Service - Simple alternative to PostgreSQL for testing
 */

const EventEmitter = require('events');
const winston = require('winston');
const { v4: uuidv4 } = require('uuid');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.simple(),
  transports: [new winston.transports.Console()]
});

class InMemoryStorage extends EventEmitter {
  constructor() {
    super();
    
    // In-memory data stores
    this.events = new Map();
    this.alerts = new Map();
    this.metrics = [];
    this.robotStates = new Map();
    this.zones = new Map();
    this.configurations = new Map();
    this.frames = new Map(); // Frame storage by camera ID
    this.frameIndex = new Map(); // Frame index by ID
    
    // Statistics
    this.stats = {
      eventsStored: 0,
      alertsStored: 0,
      metricsStored: 0,
      framesStored: 0,
      queriesExecuted: 0,
      errors: 0
    };
    
    // Frame buffer configuration
    this.maxMemoryFrames = 100; // Default max frames per camera
    this.frameIdCounter = 0;
    
    this.isConnected = true;
    logger.info('In-memory storage initialized');
  }

  /**
   * Connect (no-op for in-memory)
   */
  async connect() {
    this.isConnected = true;
    logger.info('In-memory storage connected');
  }

  /**
   * Save event
   */
  async saveEvent(event) {
    try {
      if (!event.id) {
        event.id = uuidv4();
      }
      
      event.timestamp = event.timestamp || new Date();
      event.createdAt = new Date();
      
      this.events.set(event.id, event);
      this.stats.eventsStored++;
      
      this.emit('event-saved', event);
      return event;
    } catch (error) {
      logger.error('Failed to save event:', error);
      this.stats.errors++;
      throw error;
    }
  }

  /**
   * Save alert
   */
  async saveAlert(alert) {
    try {
      if (!alert.id) {
        alert.id = uuidv4();
      }
      
      alert.createdAt = new Date();
      
      this.alerts.set(alert.id, alert);
      this.stats.alertsStored++;
      
      this.emit('alert-saved', alert);
      return alert;
    } catch (error) {
      logger.error('Failed to save alert:', error);
      this.stats.errors++;
      throw error;
    }
  }

  /**
   * Save metric
   */
  async saveMetric(metric) {
    try {
      metric.id = this.metrics.length + 1;
      metric.timestamp = metric.timestamp || new Date();
      metric.createdAt = new Date();
      
      this.metrics.push(metric);
      this.stats.metricsStored++;
      
      // Keep metrics array size manageable
      if (this.metrics.length > 10000) {
        this.metrics = this.metrics.slice(-5000);
      }
      
      this.emit('metric-saved', metric);
      return metric;
    } catch (error) {
      logger.error('Failed to save metric:', error);
      this.stats.errors++;
      throw error;
    }
  }

  /**
   * Save frame to memory with circular buffer
   */
  async saveFrame(frameData) {
    try {
      const frame = {
        id: ++this.frameIdCounter,
        cameraId: frameData.cameraId,
        timestamp: frameData.timestamp || new Date(),
        format: frameData.format || 'jpeg',
        width: frameData.width,
        height: frameData.height,
        sizeBytes: frameData.sizeBytes || Buffer.byteLength(frameData.data),
        metadata: frameData.metadata || {},
        data: frameData.data, // Store actual data in memory
        createdAt: new Date()
      };
      
      // Get or create camera frame buffer
      if (!this.frames.has(frame.cameraId)) {
        this.frames.set(frame.cameraId, []);
      }
      
      const cameraFrames = this.frames.get(frame.cameraId);
      
      // Add frame to buffer
      cameraFrames.push(frame);
      
      // Maintain circular buffer - remove oldest frames if over limit
      if (cameraFrames.length > this.maxMemoryFrames) {
        const removedFrames = cameraFrames.splice(0, cameraFrames.length - this.maxMemoryFrames);
        // Remove from index
        removedFrames.forEach(f => this.frameIndex.delete(f.id));
      }
      
      // Add to index
      this.frameIndex.set(frame.id, frame);
      
      this.stats.framesStored++;
      
      // Return frame info without data to match DatabaseService interface
      const { data, ...frameInfo } = frame;
      return frameInfo;
    } catch (error) {
      logger.error('Failed to save frame:', error);
      this.stats.errors++;
      throw error;
    }
  }

  /**
   * Get frames by time range
   */
  async getFramesByTimeRange(cameraId, startTime, endTime, options = {}) {
    try {
      const cameraFrames = this.frames.get(cameraId) || [];
      
      let frames = cameraFrames.filter(frame => 
        frame.timestamp >= startTime && frame.timestamp <= endTime
      );
      
      // Sort by timestamp
      frames.sort((a, b) => 
        options.order === 'ASC' 
          ? a.timestamp - b.timestamp 
          : b.timestamp - a.timestamp
      );
      
      // Apply limit and offset
      if (options.offset) {
        frames = frames.slice(options.offset);
      }
      if (options.limit) {
        frames = frames.slice(0, options.limit);
      }
      
      this.stats.queriesExecuted++;
      
      // Return frames with or without data based on options
      return frames.map(frame => {
        if (options.includeData) {
          return frame;
        } else {
          const { data, ...frameInfo } = frame;
          return frameInfo;
        }
      });
    } catch (error) {
      logger.error('Failed to get frames by time range:', error);
      this.stats.errors++;
      throw error;
    }
  }

  /**
   * Get frame by ID
   */
  async getFrameById(frameId, includeData = false) {
    try {
      const frame = this.frameIndex.get(frameId);
      
      if (!frame) {
        return null;
      }
      
      this.stats.queriesExecuted++;
      
      if (includeData) {
        return frame;
      } else {
        const { data, ...frameInfo } = frame;
        return frameInfo;
      }
    } catch (error) {
      logger.error('Failed to get frame:', error);
      this.stats.errors++;
      throw error;
    }
  }

  /**
   * Get latest frame for camera
   */
  async getLatestFrame(cameraId, includeData = false) {
    try {
      const cameraFrames = this.frames.get(cameraId) || [];
      
      if (cameraFrames.length === 0) {
        return null;
      }
      
      const latestFrame = cameraFrames[cameraFrames.length - 1];
      this.stats.queriesExecuted++;
      
      if (includeData) {
        return latestFrame;
      } else {
        const { data, ...frameInfo } = latestFrame;
        return frameInfo;
      }
    } catch (error) {
      logger.error('Failed to get latest frame:', error);
      this.stats.errors++;
      throw error;
    }
  }

  /**
   * Clean up old frames
   */
  async cleanupOldFrames(retentionHours = 24) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setHours(cutoffDate.getHours() - retentionHours);
      
      let framesDeleted = 0;
      let bytesFreed = 0;
      const framesByCamera = {};
      
      for (const [cameraId, cameraFrames] of this.frames.entries()) {
        const initialLength = cameraFrames.length;
        
        // Filter out old frames
        const remainingFrames = cameraFrames.filter(frame => {
          if (frame.timestamp < cutoffDate) {
            framesDeleted++;
            bytesFreed += frame.sizeBytes;
            framesByCamera[cameraId] = (framesByCamera[cameraId] || 0) + 1;
            this.frameIndex.delete(frame.id);
            return false;
          }
          return true;
        });
        
        // Update the camera frames array
        this.frames.set(cameraId, remainingFrames);
      }
      
      logger.info(`Cleaned up ${framesDeleted} old frames, freed ${bytesFreed} bytes`);
      
      return {
        framesDeleted,
        bytesFreed,
        framesByCamera
      };
    } catch (error) {
      logger.error('Failed to cleanup old frames:', error);
      this.stats.errors++;
      throw error;
    }
  }

  /**
   * Get frame statistics
   */
  async getFrameStats(cameraId = null, periodHours = 24) {
    try {
      const sinceDate = new Date();
      sinceDate.setHours(sinceDate.getHours() - periodHours);
      
      const stats = [];
      
      const camerasToProcess = cameraId 
        ? [cameraId] 
        : Array.from(this.frames.keys());
      
      for (const camId of camerasToProcess) {
        const cameraFrames = this.frames.get(camId) || [];
        const recentFrames = cameraFrames.filter(f => f.timestamp >= sinceDate);
        
        if (recentFrames.length > 0) {
          const totalSize = recentFrames.reduce((sum, f) => sum + f.sizeBytes, 0);
          const timestamps = recentFrames.map(f => f.timestamp);
          
          stats.push({
            camera_id: camId,
            frame_count: recentFrames.length,
            total_size: totalSize,
            avg_size: Math.round(totalSize / recentFrames.length),
            earliest_frame: new Date(Math.min(...timestamps)),
            latest_frame: new Date(Math.max(...timestamps))
          });
        }
      }
      
      this.stats.queriesExecuted++;
      return stats;
    } catch (error) {
      logger.error('Failed to get frame stats:', error);
      this.stats.errors++;
      throw error;
    }
  }

  /**
   * Update robot state
   */
  async updateRobotState(robotId, state) {
    try {
      state.robotId = robotId;
      state.lastSeen = state.lastSeen || new Date();
      state.updatedAt = new Date();
      
      this.robotStates.set(robotId, state);
      
      this.emit('robot-state-updated', state);
      return state;
    } catch (error) {
      logger.error('Failed to update robot state:', error);
      this.stats.errors++;
      throw error;
    }
  }

  /**
   * Get events with filters
   */
  async getEvents(filters = {}) {
    try {
      let events = Array.from(this.events.values());
      
      // Apply filters
      if (filters.startDate) {
        events = events.filter(e => e.timestamp >= filters.startDate);
      }
      if (filters.endDate) {
        events = events.filter(e => e.timestamp <= filters.endDate);
      }
      if (filters.type) {
        events = events.filter(e => e.type === filters.type);
      }
      if (filters.robotId) {
        events = events.filter(e => e.robotId === filters.robotId);
      }
      if (filters.zoneId) {
        events = events.filter(e => e.zoneId === filters.zoneId);
      }
      if (filters.priority) {
        events = events.filter(e => e.priority === filters.priority);
      }
      
      // Sort by timestamp descending
      events.sort((a, b) => b.timestamp - a.timestamp);
      
      // Apply pagination
      if (filters.offset) {
        events = events.slice(filters.offset);
      }
      if (filters.limit) {
        events = events.slice(0, filters.limit);
      }
      
      this.stats.queriesExecuted++;
      return events;
    } catch (error) {
      logger.error('Failed to get events:', error);
      this.stats.errors++;
      throw error;
    }
  }

  /**
   * Get event by ID
   */
  async getEventById(eventId) {
    this.stats.queriesExecuted++;
    return this.events.get(eventId) || null;
  }

  /**
   * Get alerts with filters
   */
  async getAlerts(filters = {}) {
    try {
      let alerts = Array.from(this.alerts.values());
      
      // Apply filters
      if (filters.state) {
        alerts = alerts.filter(a => a.state === filters.state);
      }
      if (filters.priority) {
        alerts = alerts.filter(a => a.priority === filters.priority);
      }
      if (filters.eventType) {
        alerts = alerts.filter(a => a.eventType === filters.eventType);
      }
      
      // Sort by creation time descending
      alerts.sort((a, b) => b.createdAt - a.createdAt);
      
      // Apply limit
      if (filters.limit) {
        alerts = alerts.slice(0, filters.limit);
      }
      
      this.stats.queriesExecuted++;
      return alerts;
    } catch (error) {
      logger.error('Failed to get alerts:', error);
      this.stats.errors++;
      throw error;
    }
  }

  /**
   * Acknowledge alert
   */
  async acknowledgeAlert(alertId, userId, notes) {
    try {
      const alert = this.alerts.get(alertId);
      if (!alert) {
        throw new Error('Alert not found');
      }
      
      alert.state = 'acknowledged';
      alert.acknowledgedBy = userId;
      alert.acknowledgedAt = new Date();
      alert.metadata = {
        ...alert.metadata,
        acknowledgment_notes: notes
      };
      
      this.emit('alert-acknowledged', alert);
      return alert;
    } catch (error) {
      logger.error('Failed to acknowledge alert:', error);
      this.stats.errors++;
      throw error;
    }
  }

  /**
   * Get metrics with aggregation
   */
  async getMetrics(filters = {}) {
    try {
      let metrics = [...this.metrics];
      
      // Apply filters
      if (filters.startDate) {
        metrics = metrics.filter(m => m.timestamp >= filters.startDate);
      }
      if (filters.endDate) {
        metrics = metrics.filter(m => m.timestamp <= filters.endDate);
      }
      if (filters.robotId) {
        metrics = metrics.filter(m => m.robotId === filters.robotId);
      }
      if (filters.metricType) {
        metrics = metrics.filter(m => m.type === filters.metricType);
      }
      
      if (filters.aggregate) {
        // Simple aggregation by period
        const aggregated = new Map();
        
        metrics.forEach(metric => {
          const period = this.truncateDate(metric.timestamp, filters.period || 'hour');
          const key = `${period}-${metric.robotId || 'all'}-${metric.type}`;
          
          if (!aggregated.has(key)) {
            aggregated.set(key, {
              period,
              robot_id: metric.robotId,
              metric_type: metric.type,
              values: []
            });
          }
          
          aggregated.get(key).values.push(metric.value);
        });
        
        const results = Array.from(aggregated.values()).map(agg => ({
          period: agg.period,
          robot_id: agg.robot_id,
          metric_type: agg.metric_type,
          avg_value: agg.values.reduce((a, b) => a + b, 0) / agg.values.length,
          min_value: Math.min(...agg.values),
          max_value: Math.max(...agg.values),
          count: agg.values.length
        }));
        
        results.sort((a, b) => b.period - a.period);
        
        this.stats.queriesExecuted++;
        return results;
      } else {
        // Sort by timestamp descending
        metrics.sort((a, b) => b.timestamp - a.timestamp);
        
        // Apply limit
        if (filters.limit) {
          metrics = metrics.slice(0, filters.limit);
        }
        
        this.stats.queriesExecuted++;
        return metrics;
      }
    } catch (error) {
      logger.error('Failed to get metrics:', error);
      this.stats.errors++;
      throw error;
    }
  }

  /**
   * Get robot states
   */
  async getRobotStates() {
    this.stats.queriesExecuted++;
    return Array.from(this.robotStates.values());
  }

  /**
   * Save zone
   */
  async saveZone(zone) {
    try {
      zone.createdAt = zone.createdAt || new Date();
      zone.updatedAt = new Date();
      
      this.zones.set(zone.id, zone);
      
      this.emit('zone-saved', zone);
      return zone;
    } catch (error) {
      logger.error('Failed to save zone:', error);
      this.stats.errors++;
      throw error;
    }
  }

  /**
   * Get zones
   */
  async getZones(activeOnly = true) {
    let zones = Array.from(this.zones.values());
    
    if (activeOnly) {
      zones = zones.filter(z => z.active !== false);
    }
    
    zones.sort((a, b) => a.name.localeCompare(b.name));
    
    this.stats.queriesExecuted++;
    return zones;
  }

  /**
   * Save configuration
   */
  async saveConfiguration(section, config) {
    try {
      const configEntry = {
        section,
        config,
        version: (this.configurations.get(section)?.version || 0) + 1,
        createdAt: this.configurations.get(section)?.createdAt || new Date(),
        updatedAt: new Date()
      };
      
      this.configurations.set(section, configEntry);
      
      this.emit('configuration-saved', configEntry);
      return configEntry;
    } catch (error) {
      logger.error('Failed to save configuration:', error);
      this.stats.errors++;
      throw error;
    }
  }

  /**
   * Get configuration
   */
  async getConfiguration(section) {
    this.stats.queriesExecuted++;
    return this.configurations.get(section) || null;
  }

  /**
   * Clean up old data
   */
  async cleanupOldData(retentionDays = 30) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
    
    const results = {
      events: 0,
      alerts: 0,
      metrics: 0,
      frames: 0
    };
    
    // Clean events
    for (const [id, event] of this.events.entries()) {
      if (event.createdAt < cutoffDate) {
        this.events.delete(id);
        results.events++;
      }
    }
    
    // Clean alerts
    for (const [id, alert] of this.alerts.entries()) {
      if (alert.createdAt < cutoffDate && 
          ['resolved', 'acknowledged'].includes(alert.state)) {
        this.alerts.delete(id);
        results.alerts++;
      }
    }
    
    // Clean metrics
    const oldMetricsCount = this.metrics.length;
    this.metrics = this.metrics.filter(m => m.createdAt >= cutoffDate);
    results.metrics = oldMetricsCount - this.metrics.length;
    
    // Clean frames (24 hour retention by default)
    const frameResults = await this.cleanupOldFrames(retentionDays * 24);
    results.frames = frameResults.framesDeleted;
    
    logger.info(`Cleaned up old data:`, results);
    return results;
  }

  /**
   * Get database statistics
   */
  async getDatabaseStats() {
    const stats = {
      ...this.stats,
      eventCount: this.events.size,
      alertCount: this.alerts.size,
      metricCount: this.metrics.length,
      robotCount: this.robotStates.size,
      zoneCount: this.zones.size,
      frameCount: Array.from(this.frames.values()).reduce((sum, frames) => sum + frames.length, 0),
      recentEvents: Array.from(this.events.values())
        .filter(e => e.createdAt > new Date(Date.now() - 3600000)).length,
      recentFrames: Array.from(this.frames.values())
        .flat()
        .filter(f => f.createdAt > new Date(Date.now() - 3600000)).length,
      databaseSize: this.estimateMemoryUsage()
    };
    
    return stats;
  }

  /**
   * Execute raw query (no-op for in-memory)
   */
  async executeQuery(query, values = []) {
    logger.warn('executeQuery not supported in in-memory storage');
    return { rows: [], rowCount: 0 };
  }

  /**
   * Get connection status
   */
  getStatus() {
    return this.isConnected ? 'online' : 'offline';
  }

  /**
   * Disconnect (no-op for in-memory)
   */
  async disconnect() {
    this.isConnected = false;
    logger.info('In-memory storage disconnected');
  }

  /**
   * Set maximum memory frames per camera
   */
  setMaxMemoryFrames(maxFrames) {
    this.maxMemoryFrames = maxFrames;
    logger.info(`Max memory frames set to ${maxFrames} per camera`);
    
    // Trim existing buffers if needed
    for (const [cameraId, frames] of this.frames.entries()) {
      if (frames.length > maxFrames) {
        const removedFrames = frames.splice(0, frames.length - maxFrames);
        removedFrames.forEach(f => this.frameIndex.delete(f.id));
      }
    }
  }

  /**
   * Helper: Truncate date to period
   */
  truncateDate(date, period) {
    const d = new Date(date);
    
    switch (period) {
      case 'minute':
        d.setSeconds(0, 0);
        break;
      case 'hour':
        d.setMinutes(0, 0, 0);
        break;
      case 'day':
        d.setHours(0, 0, 0, 0);
        break;
      default:
        d.setMinutes(0, 0, 0);
    }
    
    return d;
  }

  /**
   * Estimate memory usage
   */
  estimateMemoryUsage() {
    let bytes = 0;
    
    // Rough estimates
    bytes += this.events.size * 500; // ~500 bytes per event
    bytes += this.alerts.size * 400; // ~400 bytes per alert
    bytes += this.metrics.length * 100; // ~100 bytes per metric
    bytes += this.robotStates.size * 200; // ~200 bytes per state
    bytes += this.zones.size * 300; // ~300 bytes per zone
    
    // Frame data is the largest consumer
    for (const frames of this.frames.values()) {
      bytes += frames.reduce((sum, f) => sum + f.sizeBytes, 0);
    }
    
    return bytes;
  }
}

module.exports = InMemoryStorage;
