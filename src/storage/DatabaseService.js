/**
 * Database Service - Handles data persistence for events, metrics, and configuration
 */

const { Pool } = require('pg');
const winston = require('winston');
const fs = require('fs').promises;
const path = require('path');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.simple(),
  transports: [new winston.transports.Console()]
});

class DatabaseService {
  constructor(config = {}) {
    this.config = config;
    this.pool = null;
    this.isConnected = false;
    
    // Table definitions
    this.tables = {
      events: 'events',
      alerts: 'alerts',
      metrics: 'metrics',
      robot_states: 'robot_states',
      zones: 'zones',
      configurations: 'configurations',
      frames: 'frames'
    };
    
    // Statistics
    this.stats = {
      eventsStored: 0,
      alertsStored: 0,
      metricsStored: 0,
      framesStored: 0,
      queriesExecuted: 0,
      errors: 0
    };
  }

  /**
   * Connect to database
   */
  async connect() {
    try {
      // PostgreSQL connection
      this.pool = new Pool({
        host: this.config.host || 'localhost',
        port: this.config.port || 5432,
        database: this.config.database || 'robot_monitor',
        user: this.config.username || 'robot_monitor',
        password: this.config.password,
        ssl: this.config.ssl || false,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000
      });
      
      // Test connection
      await this.pool.query('SELECT NOW()');
      
      // Initialize tables
      await this.initializeTables();
      
      this.isConnected = true;
      logger.info('Database connected successfully');
      
    } catch (error) {
      logger.error('Database connection failed:', error);
      throw error;
    }
  }

  /**
   * Initialize database tables
   */
  async initializeTables() {
    const queries = [
      // Events table
      `CREATE TABLE IF NOT EXISTS ${this.tables.events} (
        id UUID PRIMARY KEY,
        type VARCHAR(50) NOT NULL,
        timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
        camera_id VARCHAR(50) NOT NULL,
        robot_id VARCHAR(50),
        zone_id VARCHAR(50),
        confidence DECIMAL(3,2),
        priority VARCHAR(20),
        description TEXT,
        metadata JSONB,
        status VARCHAR(20),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_events_timestamp (timestamp),
        INDEX idx_events_type (type),
        INDEX idx_events_robot (robot_id)
      )`,
      
      // Alerts table
      `CREATE TABLE IF NOT EXISTS ${this.tables.alerts} (
        id UUID PRIMARY KEY,
        event_id UUID REFERENCES ${this.tables.events}(id),
        event_type VARCHAR(50) NOT NULL,
        priority VARCHAR(20) NOT NULL,
        title VARCHAR(255) NOT NULL,
        message TEXT,
        channels TEXT[],
        recipients TEXT[],
        state VARCHAR(20) NOT NULL,
        metadata JSONB,
        acknowledged_by VARCHAR(100),
        acknowledged_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_alerts_state (state),
        INDEX idx_alerts_priority (priority)
      )`,
      
      // Metrics table
      `CREATE TABLE IF NOT EXISTS ${this.tables.metrics} (
        id SERIAL PRIMARY KEY,
        timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
        robot_id VARCHAR(50),
        metric_type VARCHAR(50) NOT NULL,
        value DECIMAL(10,2) NOT NULL,
        unit VARCHAR(20),
        metadata JSONB,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_metrics_timestamp (timestamp),
        INDEX idx_metrics_robot (robot_id),
        INDEX idx_metrics_type (metric_type)
      )`,
      
      // Robot states table
      `CREATE TABLE IF NOT EXISTS ${this.tables.robot_states} (
        robot_id VARCHAR(50) PRIMARY KEY,
        status VARCHAR(20) NOT NULL,
        position JSONB,
        orientation DECIMAL(5,2),
        speed DECIMAL(5,2),
        battery_level INTEGER,
        current_task VARCHAR(100),
        last_seen TIMESTAMP WITH TIME ZONE NOT NULL,
        metadata JSONB,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )`,
      
      // Zones table
      `CREATE TABLE IF NOT EXISTS ${this.tables.zones} (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        type VARCHAR(20) NOT NULL,
        coordinates JSONB NOT NULL,
        color VARCHAR(7),
        priority VARCHAR(20),
        active BOOLEAN DEFAULT true,
        metadata JSONB,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )`,
      
      // Configurations table
      `CREATE TABLE IF NOT EXISTS ${this.tables.configurations} (
        id SERIAL PRIMARY KEY,
        section VARCHAR(50) NOT NULL,
        config JSONB NOT NULL,
        version INTEGER DEFAULT 1,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(section)
      )`,
      
      // Frames table
      `CREATE TABLE IF NOT EXISTS ${this.tables.frames} (
        id SERIAL PRIMARY KEY,
        camera_id VARCHAR(50) NOT NULL,
        timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
        frame_data BYTEA NOT NULL,
        format VARCHAR(20) NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        size_bytes INTEGER NOT NULL,
        metadata JSONB,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_frames_camera (camera_id),
        INDEX idx_frames_timestamp (timestamp),
        INDEX idx_frames_camera_timestamp (camera_id, timestamp)
      )`
    ];
    
    // PostgreSQL specific syntax adjustments
    const pgQueries = queries.map(q => 
      q.replace(/INDEX /g, '')
       .replace(/idx_[a-z_]+ \([a-z_]+\)/g, '')
    );
    
    // Create indexes separately for PostgreSQL
    const indexQueries = [
      `CREATE INDEX IF NOT EXISTS idx_events_timestamp ON ${this.tables.events} (timestamp)`,
      `CREATE INDEX IF NOT EXISTS idx_events_type ON ${this.tables.events} (type)`,
      `CREATE INDEX IF NOT EXISTS idx_events_robot ON ${this.tables.events} (robot_id)`,
      `CREATE INDEX IF NOT EXISTS idx_alerts_state ON ${this.tables.alerts} (state)`,
      `CREATE INDEX IF NOT EXISTS idx_alerts_priority ON ${this.tables.alerts} (priority)`,
      `CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON ${this.tables.metrics} (timestamp)`,
      `CREATE INDEX IF NOT EXISTS idx_metrics_robot ON ${this.tables.metrics} (robot_id)`,
      `CREATE INDEX IF NOT EXISTS idx_metrics_type ON ${this.tables.metrics} (metric_type)`,
      `CREATE INDEX IF NOT EXISTS idx_frames_camera ON ${this.tables.frames} (camera_id)`,
      `CREATE INDEX IF NOT EXISTS idx_frames_timestamp ON ${this.tables.frames} (timestamp)`,
      `CREATE INDEX IF NOT EXISTS idx_frames_camera_timestamp ON ${this.tables.frames} (camera_id, timestamp)`
    ];
    
    for (const query of pgQueries) {
      try {
        await this.pool.query(query);
      } catch (error) {
        logger.error('Table creation error:', error.message);
      }
    }
    
    for (const query of indexQueries) {
      try {
        await this.pool.query(query);
      } catch (error) {
        logger.error('Index creation error:', error.message);
      }
    }
    
    logger.info('Database tables initialized');
  }

  /**
   * Save event to database
   */
  async saveEvent(event) {
    const query = `
      INSERT INTO ${this.tables.events} 
      (id, type, timestamp, camera_id, robot_id, zone_id, confidence, 
       priority, description, metadata, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        metadata = EXCLUDED.metadata
      RETURNING *
    `;
    
    const values = [
      event.id,
      event.type,
      event.timestamp,
      event.cameraId,
      event.robotId || null,
      event.zoneId || null,
      event.confidence || null,
      event.priority,
      event.description,
      JSON.stringify(event.metadata || {}),
      event.status || 'confirmed'
    ];
    
    try {
      const result = await this.pool.query(query, values);
      this.stats.eventsStored++;
      return result.rows[0];
    } catch (error) {
      logger.error('Failed to save event:', error);
      this.stats.errors++;
      throw error;
    }
  }

  /**
   * Save alert to database
   */
  async saveAlert(alert) {
    const query = `
      INSERT INTO ${this.tables.alerts}
      (id, event_id, event_type, priority, title, message, channels, 
       recipients, state, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (id) DO UPDATE SET
        state = EXCLUDED.state,
        metadata = EXCLUDED.metadata
      RETURNING *
    `;
    
    const values = [
      alert.id,
      alert.eventId,
      alert.eventType,
      alert.priority,
      alert.title,
      alert.message,
      alert.channels,
      alert.recipients,
      alert.state,
      JSON.stringify(alert.metadata || {})
    ];
    
    try {
      const result = await this.pool.query(query, values);
      this.stats.alertsStored++;
      return result.rows[0];
    } catch (error) {
      logger.error('Failed to save alert:', error);
      this.stats.errors++;
      throw error;
    }
  }

  /**
   * Save metric to database
   */
  async saveMetric(metric) {
    const query = `
      INSERT INTO ${this.tables.metrics}
      (timestamp, robot_id, metric_type, value, unit, metadata)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;
    
    const values = [
      metric.timestamp || new Date(),
      metric.robotId || null,
      metric.type,
      metric.value,
      metric.unit || null,
      JSON.stringify(metric.metadata || {})
    ];
    
    try {
      const result = await this.pool.query(query, values);
      this.stats.metricsStored++;
      return result.rows[0];
    } catch (error) {
      logger.error('Failed to save metric:', error);
      this.stats.errors++;
      throw error;
    }
  }

  /**
   * Update robot state
   */
  async updateRobotState(robotId, state) {
    const query = `
      INSERT INTO ${this.tables.robot_states}
      (robot_id, status, position, orientation, speed, battery_level, 
       current_task, last_seen, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (robot_id) DO UPDATE SET
        status = EXCLUDED.status,
        position = EXCLUDED.position,
        orientation = EXCLUDED.orientation,
        speed = EXCLUDED.speed,
        battery_level = EXCLUDED.battery_level,
        current_task = EXCLUDED.current_task,
        last_seen = EXCLUDED.last_seen,
        metadata = EXCLUDED.metadata,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;
    
    const values = [
      robotId,
      state.status || 'unknown',
      JSON.stringify(state.position || {}),
      state.orientation || null,
      state.speed || null,
      state.batteryLevel || null,
      state.currentTask || null,
      state.lastSeen || new Date(),
      JSON.stringify(state.metadata || {})
    ];
    
    try {
      const result = await this.pool.query(query, values);
      return result.rows[0];
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
    let query = `SELECT * FROM ${this.tables.events} WHERE 1=1`;
    const values = [];
    let paramCount = 0;
    
    if (filters.startDate) {
      paramCount++;
      query += ` AND timestamp >= $${paramCount}`;
      values.push(filters.startDate);
    }
    
    if (filters.endDate) {
      paramCount++;
      query += ` AND timestamp <= $${paramCount}`;
      values.push(filters.endDate);
    }
    
    if (filters.type) {
      paramCount++;
      query += ` AND type = $${paramCount}`;
      values.push(filters.type);
    }
    
    if (filters.robotId) {
      paramCount++;
      query += ` AND robot_id = $${paramCount}`;
      values.push(filters.robotId);
    }
    
    if (filters.zoneId) {
      paramCount++;
      query += ` AND zone_id = $${paramCount}`;
      values.push(filters.zoneId);
    }
    
    if (filters.priority) {
      paramCount++;
      query += ` AND priority = $${paramCount}`;
      values.push(filters.priority);
    }
    
    query += ' ORDER BY timestamp DESC';
    
    if (filters.limit) {
      paramCount++;
      query += ` LIMIT $${paramCount}`;
      values.push(filters.limit);
    }
    
    if (filters.offset) {
      paramCount++;
      query += ` OFFSET $${paramCount}`;
      values.push(filters.offset);
    }
    
    try {
      const result = await this.pool.query(query, values);
      this.stats.queriesExecuted++;
      return result.rows;
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
    const query = `SELECT * FROM ${this.tables.events} WHERE id = $1`;
    
    try {
      const result = await this.pool.query(query, [eventId]);
      this.stats.queriesExecuted++;
      return result.rows[0];
    } catch (error) {
      logger.error('Failed to get event:', error);
      this.stats.errors++;
      throw error;
    }
  }

  /**
   * Get alerts with filters
   */
  async getAlerts(filters = {}) {
    let query = `SELECT * FROM ${this.tables.alerts} WHERE 1=1`;
    const values = [];
    let paramCount = 0;
    
    if (filters.state) {
      paramCount++;
      query += ` AND state = $${paramCount}`;
      values.push(filters.state);
    }
    
    if (filters.priority) {
      paramCount++;
      query += ` AND priority = $${paramCount}`;
      values.push(filters.priority);
    }
    
    if (filters.eventType) {
      paramCount++;
      query += ` AND event_type = $${paramCount}`;
      values.push(filters.eventType);
    }
    
    query += ' ORDER BY created_at DESC';
    
    if (filters.limit) {
      paramCount++;
      query += ` LIMIT $${paramCount}`;
      values.push(filters.limit);
    }
    
    try {
      const result = await this.pool.query(query, values);
      this.stats.queriesExecuted++;
      return result.rows;
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
    const query = `
      UPDATE ${this.tables.alerts}
      SET state = 'acknowledged',
          acknowledged_by = $2,
          acknowledged_at = CURRENT_TIMESTAMP,
          metadata = metadata || $3
      WHERE id = $1
      RETURNING *
    `;
    
    const values = [
      alertId,
      userId,
      JSON.stringify({ acknowledgment_notes: notes })
    ];
    
    try {
      const result = await this.pool.query(query, values);
      return result.rows[0];
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
    let query;
    const values = [];
    let paramCount = 0;
    
    if (filters.aggregate) {
      // Aggregated query
      query = `
        SELECT 
          DATE_TRUNC('${filters.period || 'hour'}', timestamp) as period,
          robot_id,
          metric_type,
          AVG(value) as avg_value,
          MIN(value) as min_value,
          MAX(value) as max_value,
          COUNT(*) as count
        FROM ${this.tables.metrics}
        WHERE 1=1
      `;
    } else {
      // Regular query
      query = `SELECT * FROM ${this.tables.metrics} WHERE 1=1`;
    }
    
    if (filters.startDate) {
      paramCount++;
      query += ` AND timestamp >= $${paramCount}`;
      values.push(filters.startDate);
    }
    
    if (filters.endDate) {
      paramCount++;
      query += ` AND timestamp <= $${paramCount}`;
      values.push(filters.endDate);
    }
    
    if (filters.robotId) {
      paramCount++;
      query += ` AND robot_id = $${paramCount}`;
      values.push(filters.robotId);
    }
    
    if (filters.metricType) {
      paramCount++;
      query += ` AND metric_type = $${paramCount}`;
      values.push(filters.metricType);
    }
    
    if (filters.aggregate) {
      query += ' GROUP BY period, robot_id, metric_type ORDER BY period DESC';
    } else {
      query += ' ORDER BY timestamp DESC';
    }
    
    if (filters.limit) {
      paramCount++;
      query += ` LIMIT $${paramCount}`;
      values.push(filters.limit);
    }
    
    try {
      const result = await this.pool.query(query, values);
      this.stats.queriesExecuted++;
      return result.rows;
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
    const query = `SELECT * FROM ${this.tables.robot_states} ORDER BY robot_id`;
    
    try {
      const result = await this.pool.query(query);
      this.stats.queriesExecuted++;
      return result.rows;
    } catch (error) {
      logger.error('Failed to get robot states:', error);
      this.stats.errors++;
      throw error;
    }
  }

  /**
   * Save zone configuration
   */
  async saveZone(zone) {
    const query = `
      INSERT INTO ${this.tables.zones}
      (id, name, type, coordinates, color, priority, active, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        type = EXCLUDED.type,
        coordinates = EXCLUDED.coordinates,
        color = EXCLUDED.color,
        priority = EXCLUDED.priority,
        active = EXCLUDED.active,
        metadata = EXCLUDED.metadata,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;
    
    const values = [
      zone.id,
      zone.name,
      zone.type,
      JSON.stringify(zone.coordinates),
      zone.color,
      zone.priority,
      zone.active !== false,
      JSON.stringify(zone.metadata || {})
    ];
    
    try {
      const result = await this.pool.query(query, values);
      return result.rows[0];
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
    let query = `SELECT * FROM ${this.tables.zones}`;
    
    if (activeOnly) {
      query += ' WHERE active = true';
    }
    
    query += ' ORDER BY name';
    
    try {
      const result = await this.pool.query(query);
      this.stats.queriesExecuted++;
      return result.rows;
    } catch (error) {
      logger.error('Failed to get zones:', error);
      this.stats.errors++;
      throw error;
    }
  }

  /**
   * Save configuration section
   */
  async saveConfiguration(section, config) {
    const query = `
      INSERT INTO ${this.tables.configurations}
      (section, config, version)
      VALUES ($1, $2, 1)
      ON CONFLICT (section) DO UPDATE SET
        config = EXCLUDED.config,
        version = ${this.tables.configurations}.version + 1,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;
    
    const values = [
      section,
      JSON.stringify(config)
    ];
    
    try {
      const result = await this.pool.query(query, values);
      return result.rows[0];
    } catch (error) {
      logger.error('Failed to save configuration:', error);
      this.stats.errors++;
      throw error;
    }
  }

  /**
   * Get configuration section
   */
  async getConfiguration(section) {
    const query = `
      SELECT * FROM ${this.tables.configurations}
      WHERE section = $1
      ORDER BY version DESC
      LIMIT 1
    `;
    
    try {
      const result = await this.pool.query(query, [section]);
      this.stats.queriesExecuted++;
      return result.rows[0];
    } catch (error) {
      logger.error('Failed to get configuration:', error);
      this.stats.errors++;
      throw error;
    }
  }

  /**
   * Save frame to database
   */
  async saveFrame(frameData) {
    const query = `
      INSERT INTO ${this.tables.frames}
      (camera_id, timestamp, frame_data, format, width, height, size_bytes, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, camera_id, timestamp, format, width, height, size_bytes, metadata, created_at
    `;
    
    const values = [
      frameData.cameraId,
      frameData.timestamp || new Date(),
      frameData.data, // Buffer or binary data
      frameData.format || 'jpeg',
      frameData.width,
      frameData.height,
      frameData.sizeBytes || Buffer.byteLength(frameData.data),
      JSON.stringify(frameData.metadata || {})
    ];
    
    try {
      const result = await this.pool.query(query, values);
      this.stats.framesStored++;
      // Return without the actual frame data to save memory
      return result.rows[0];
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
    let query = `
      SELECT id, camera_id, timestamp, format, width, height, size_bytes, metadata, created_at
      ${options.includeData ? ', frame_data' : ''}
      FROM ${this.tables.frames}
      WHERE camera_id = $1
        AND timestamp >= $2
        AND timestamp <= $3
      ORDER BY timestamp ${options.order || 'DESC'}
    `;
    
    const values = [cameraId, startTime, endTime];
    
    if (options.limit) {
      query += ` LIMIT $4`;
      values.push(options.limit);
      
      if (options.offset) {
        query += ` OFFSET $5`;
        values.push(options.offset);
      }
    }
    
    try {
      const result = await this.pool.query(query, values);
      this.stats.queriesExecuted++;
      return result.rows;
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
    const query = `
      SELECT id, camera_id, timestamp, format, width, height, size_bytes, metadata, created_at
      ${includeData ? ', frame_data' : ''}
      FROM ${this.tables.frames}
      WHERE id = $1
    `;
    
    try {
      const result = await this.pool.query(query, [frameId]);
      this.stats.queriesExecuted++;
      return result.rows[0];
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
    const query = `
      SELECT id, camera_id, timestamp, format, width, height, size_bytes, metadata, created_at
      ${includeData ? ', frame_data' : ''}
      FROM ${this.tables.frames}
      WHERE camera_id = $1
      ORDER BY timestamp DESC
      LIMIT 1
    `;
    
    try {
      const result = await this.pool.query(query, [cameraId]);
      this.stats.queriesExecuted++;
      return result.rows[0];
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
    const cutoffDate = new Date();
    cutoffDate.setHours(cutoffDate.getHours() - retentionHours);
    
    const query = `
      DELETE FROM ${this.tables.frames}
      WHERE timestamp < $1
      RETURNING id, camera_id, size_bytes
    `;
    
    try {
      const result = await this.pool.query(query, [cutoffDate]);
      const deletedFrames = result.rows;
      const totalSizeFreed = deletedFrames.reduce((sum, frame) => sum + frame.size_bytes, 0);
      
      logger.info(`Cleaned up ${deletedFrames.length} old frames, freed ${totalSizeFreed} bytes`);
      
      return {
        framesDeleted: deletedFrames.length,
        bytesFreed: totalSizeFreed,
        framesByCamera: deletedFrames.reduce((acc, frame) => {
          acc[frame.camera_id] = (acc[frame.camera_id] || 0) + 1;
          return acc;
        }, {})
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
    const sinceDate = new Date();
    sinceDate.setHours(sinceDate.getHours() - periodHours);
    
    let query = `
      SELECT
        camera_id,
        COUNT(*) as frame_count,
        SUM(size_bytes) as total_size,
        AVG(size_bytes) as avg_size,
        MIN(timestamp) as earliest_frame,
        MAX(timestamp) as latest_frame
      FROM ${this.tables.frames}
      WHERE timestamp >= $1
    `;
    
    const values = [sinceDate];
    
    if (cameraId) {
      query += ` AND camera_id = $2`;
      values.push(cameraId);
    }
    
    query += ` GROUP BY camera_id`;
    
    try {
      const result = await this.pool.query(query, values);
      this.stats.queriesExecuted++;
      return result.rows;
    } catch (error) {
      logger.error('Failed to get frame stats:', error);
      this.stats.errors++;
      throw error;
    }
  }

  /**
   * Clean up old data
   */
  async cleanupOldData(retentionDays = 30) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
    
    const queries = [
      {
        name: 'events',
        query: `DELETE FROM ${this.tables.events} WHERE created_at < $1`
      },
      {
        name: 'alerts',
        query: `DELETE FROM ${this.tables.alerts} WHERE created_at < $1 AND state IN ('resolved', 'acknowledged')`
      },
      {
        name: 'metrics',
        query: `DELETE FROM ${this.tables.metrics} WHERE created_at < $1`
      },
      {
        name: 'frames',
        query: `DELETE FROM ${this.tables.frames} WHERE created_at < $1`
      }
    ];
    
    const results = {};
    
    for (const { name, query } of queries) {
      try {
        const result = await this.pool.query(query, [cutoffDate]);
        results[name] = result.rowCount;
        logger.info(`Cleaned up ${result.rowCount} old ${name} records`);
      } catch (error) {
        logger.error(`Failed to cleanup ${name}:`, error);
        results[name] = { error: error.message };
      }
    }
    
    return results;
  }

  /**
   * Get database statistics
   */
  async getDatabaseStats() {
    const queries = {
      eventCount: `SELECT COUNT(*) as count FROM ${this.tables.events}`,
      alertCount: `SELECT COUNT(*) as count FROM ${this.tables.alerts}`,
      metricCount: `SELECT COUNT(*) as count FROM ${this.tables.metrics}`,
      robotCount: `SELECT COUNT(*) as count FROM ${this.tables.robot_states}`,
      zoneCount: `SELECT COUNT(*) as count FROM ${this.tables.zones}`,
      frameCount: `SELECT COUNT(*) as count FROM ${this.tables.frames}`,
      recentEvents: `SELECT COUNT(*) as count FROM ${this.tables.events} WHERE created_at > NOW() - INTERVAL '1 hour'`,
      recentFrames: `SELECT COUNT(*) as count FROM ${this.tables.frames} WHERE created_at > NOW() - INTERVAL '1 hour'`
    };
    
    const stats = { ...this.stats };
    
    for (const [key, query] of Object.entries(queries)) {
      try {
        const result = await this.pool.query(query);
        stats[key] = parseInt(result.rows[0].count);
      } catch (error) {
        stats[key] = { error: error.message };
      }
    }
    
    // Database size
    try {
      const sizeQuery = `
        SELECT pg_database_size($1) as size
      `;
      const result = await this.pool.query(sizeQuery, [this.config.database]);
      stats.databaseSize = result.rows[0].size;
    } catch (error) {
      stats.databaseSize = { error: error.message };
    }
    
    return stats;
  }

  /**
   * Execute raw query (for advanced use)
   */
  async executeQuery(query, values = []) {
    try {
      const result = await this.pool.query(query, values);
      this.stats.queriesExecuted++;
      return result;
    } catch (error) {
      logger.error('Query execution failed:', error);
      this.stats.errors++;
      throw error;
    }
  }

  /**
   * Get connection status
   */
  getStatus() {
    return this.isConnected ? 'online' : 'offline';
  }

  /**
   * Disconnect from database
   */
  async disconnect() {
    if (this.pool) {
      await this.pool.end();
      this.isConnected = false;
      logger.info('Database disconnected');
    }
  }
}

module.exports = DatabaseService;