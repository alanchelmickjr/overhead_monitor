/**
 * Gun.js Storage Service - Decentralized storage for robot monitoring
 */

const Gun = require('gun');
const winston = require('winston');
const { v4: uuidv4 } = require('uuid');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.simple(),
  transports: [new winston.transports.Console()]
});

class GunStorage {
  constructor(config = {}) {
    this.config = config;
    
    // Initialize Gun with peers for decentralized sync
    const peers = config.peers || [
      'https://gun-manhattan.herokuapp.com/gun',
      'https://gun-us.herokuapp.com/gun'
    ];
    
    this.gun = Gun({
      peers: peers,
      localStorage: false, // Server-side, no localStorage
      radisk: true, // Use radisk for server storage
      ...config.gunOptions
    });
    
    // Create namespaces
    this.db = {
      events: this.gun.get('robot-monitor').get('events'),
      alerts: this.gun.get('robot-monitor').get('alerts'),
      metrics: this.gun.get('robot-monitor').get('metrics'),
      robotStates: this.gun.get('robot-monitor').get('robots'),
      zones: this.gun.get('robot-monitor').get('zones'),
      configurations: this.gun.get('robot-monitor').get('config')
    };
    
    // Statistics
    this.stats = {
      eventsStored: 0,
      alertsStored: 0,
      metricsStored: 0,
      queriesExecuted: 0,
      errors: 0
    };
    
    this.isConnected = true;
    logger.info('Gun.js storage initialized');
  }

  /**
   * Connect to Gun network (no-op for Gun, always connected)
   */
  async connect() {
    // Gun automatically connects to peers
    this.isConnected = true;
    logger.info('Gun.js storage ready');
    return Promise.resolve();
  }

  /**
   * Save event to Gun
   */
  async saveEvent(event) {
    try {
      const eventId = event.id || uuidv4();
      const eventData = {
        ...event,
        id: eventId,
        timestamp: event.timestamp || new Date().toISOString(),
        _created: Date.now()
      };
      
      // Store in Gun
      this.db.events.get(eventId).put(eventData);
      
      // Also index by timestamp for time-based queries
      const dateKey = new Date(eventData.timestamp).toISOString().split('T')[0];
      this.db.events.get('by-date').get(dateKey).get(eventId).put(true);
      
      // Index by type
      if (event.type) {
        this.db.events.get('by-type').get(event.type).get(eventId).put(true);
      }
      
      // Index by robot
      if (event.robotId) {
        this.db.events.get('by-robot').get(event.robotId).get(eventId).put(true);
      }
      
      this.stats.eventsStored++;
      return eventData;
    } catch (error) {
      logger.error('Failed to save event:', error);
      this.stats.errors++;
      throw error;
    }
  }

  /**
   * Save alert to Gun
   */
  async saveAlert(alert) {
    try {
      const alertId = alert.id || uuidv4();
      const alertData = {
        ...alert,
        id: alertId,
        _created: Date.now()
      };
      
      // Store in Gun
      this.db.alerts.get(alertId).put(alertData);
      
      // Index by state
      if (alert.state) {
        this.db.alerts.get('by-state').get(alert.state).get(alertId).put(true);
      }
      
      // Index by priority
      if (alert.priority) {
        this.db.alerts.get('by-priority').get(alert.priority).get(alertId).put(true);
      }
      
      this.stats.alertsStored++;
      return alertData;
    } catch (error) {
      logger.error('Failed to save alert:', error);
      this.stats.errors++;
      throw error;
    }
  }

  /**
   * Save metric to Gun
   */
  async saveMetric(metric) {
    try {
      const metricId = uuidv4();
      const metricData = {
        ...metric,
        id: metricId,
        timestamp: metric.timestamp || new Date().toISOString(),
        _created: Date.now()
      };
      
      // Store in Gun
      this.db.metrics.get(metricId).put(metricData);
      
      // Index by robot and type for efficient queries
      const key = `${metric.robotId || 'global'}-${metric.type}`;
      this.db.metrics.get('by-robot-type').get(key).get(metricId).put(true);
      
      // Index by date
      const dateKey = new Date(metricData.timestamp).toISOString().split('T')[0];
      this.db.metrics.get('by-date').get(dateKey).get(metricId).put(true);
      
      this.stats.metricsStored++;
      return metricData;
    } catch (error) {
      logger.error('Failed to save metric:', error);
      this.stats.errors++;
      throw error;
    }
  }

  /**
   * Update robot state in Gun
   */
  async updateRobotState(robotId, state) {
    try {
      const stateData = {
        ...state,
        robotId,
        lastSeen: state.lastSeen || new Date().toISOString(),
        _updated: Date.now()
      };
      
      // Store/update in Gun
      this.db.robotStates.get(robotId).put(stateData);
      
      return stateData;
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
    return new Promise((resolve, reject) => {
      const events = [];
      const limit = filters.limit || 100;
      let processed = 0;
      
      const processEvent = (data, id) => {
        if (!data || typeof data !== 'object') return;
        
        // Apply filters
        if (filters.type && data.type !== filters.type) return;
        if (filters.robotId && data.robotId !== filters.robotId) return;
        if (filters.zoneId && data.zoneId !== filters.zoneId) return;
        if (filters.priority && data.priority !== filters.priority) return;
        
        // Date filters
        if (filters.startDate && new Date(data.timestamp) < new Date(filters.startDate)) return;
        if (filters.endDate && new Date(data.timestamp) > new Date(filters.endDate)) return;
        
        events.push({ ...data, id });
        processed++;
        
        if (processed >= limit) {
          // Sort by timestamp descending
          events.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
          resolve(events);
        }
      };
      
      // Use index if filtering by type
      if (filters.type) {
        this.db.events.get('by-type').get(filters.type).map().once((val, id) => {
          if (val) {
            this.db.events.get(id).once((data) => processEvent(data, id));
          }
        });
      } else {
        // Scan all events
        this.db.events.map().once((data, id) => {
          if (id && !id.includes('by-')) {
            processEvent(data, id);
          }
        });
      }
      
      // Timeout and return what we have
      setTimeout(() => {
        events.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        resolve(events.slice(0, limit));
      }, 2000);
      
      this.stats.queriesExecuted++;
    });
  }

  /**
   * Get event by ID
   */
  async getEventById(eventId) {
    return new Promise((resolve) => {
      this.db.events.get(eventId).once((data) => {
        this.stats.queriesExecuted++;
        resolve(data ? { ...data, id: eventId } : null);
      });
    });
  }

  /**
   * Get alerts with filters
   */
  async getAlerts(filters = {}) {
    return new Promise((resolve) => {
      const alerts = [];
      const limit = filters.limit || 50;
      
      const processAlert = (data, id) => {
        if (!data || typeof data !== 'object') return;
        
        // Apply filters
        if (filters.state && data.state !== filters.state) return;
        if (filters.priority && data.priority !== filters.priority) return;
        if (filters.eventType && data.eventType !== filters.eventType) return;
        
        alerts.push({ ...data, id });
        
        if (alerts.length >= limit) {
          alerts.sort((a, b) => b._created - a._created);
          resolve(alerts);
        }
      };
      
      // Use index if filtering by state
      if (filters.state) {
        this.db.alerts.get('by-state').get(filters.state).map().once((val, id) => {
          if (val) {
            this.db.alerts.get(id).once((data) => processAlert(data, id));
          }
        });
      } else {
        // Scan all alerts
        this.db.alerts.map().once((data, id) => {
          if (id && !id.includes('by-')) {
            processAlert(data, id);
          }
        });
      }
      
      // Timeout
      setTimeout(() => {
        alerts.sort((a, b) => b._created - a._created);
        resolve(alerts.slice(0, limit));
      }, 2000);
      
      this.stats.queriesExecuted++;
    });
  }

  /**
   * Acknowledge alert
   */
  async acknowledgeAlert(alertId, userId, notes) {
    return new Promise((resolve) => {
      const alertRef = this.db.alerts.get(alertId);
      
      alertRef.once((data) => {
        if (data) {
          const updated = {
            ...data,
            state: 'acknowledged',
            acknowledgedBy: userId,
            acknowledgedAt: new Date().toISOString(),
            acknowledgmentNotes: notes
          };
          
          alertRef.put(updated);
          
          // Update state index
          this.db.alerts.get('by-state').get('pending').get(alertId).put(null);
          this.db.alerts.get('by-state').get('acknowledged').get(alertId).put(true);
          
          resolve(updated);
        } else {
          resolve(null);
        }
      });
    });
  }

  /**
   * Get metrics with optional aggregation
   */
  async getMetrics(filters = {}) {
    return new Promise((resolve) => {
      const metrics = [];
      const limit = filters.limit || 1000;
      
      const processMetric = (data, id) => {
        if (!data || typeof data !== 'object') return;
        
        // Apply filters
        if (filters.robotId && data.robotId !== filters.robotId) return;
        if (filters.metricType && data.type !== filters.metricType) return;
        
        // Date filters
        if (filters.startDate && new Date(data.timestamp) < new Date(filters.startDate)) return;
        if (filters.endDate && new Date(data.timestamp) > new Date(filters.endDate)) return;
        
        metrics.push({ ...data, id });
      };
      
      // Scan metrics
      this.db.metrics.map().once((data, id) => {
        if (id && !id.includes('by-')) {
          processMetric(data, id);
        }
      });
      
      // Timeout and process
      setTimeout(() => {
        metrics.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        
        if (filters.aggregate) {
          // Simple aggregation
          const aggregated = this.aggregateMetrics(metrics, filters.period || 'hour');
          resolve(aggregated);
        } else {
          resolve(metrics.slice(0, limit));
        }
      }, 2000);
      
      this.stats.queriesExecuted++;
    });
  }

  /**
   * Simple metric aggregation
   */
  aggregateMetrics(metrics, period) {
    const groups = {};
    
    metrics.forEach(metric => {
      const date = new Date(metric.timestamp);
      let key;
      
      switch (period) {
        case 'hour':
          key = `${date.toISOString().slice(0, 13)}:00:00`;
          break;
        case 'day':
          key = date.toISOString().slice(0, 10);
          break;
        default:
          key = date.toISOString();
      }
      
      const groupKey = `${key}-${metric.robotId || 'global'}-${metric.type}`;
      
      if (!groups[groupKey]) {
        groups[groupKey] = {
          period: key,
          robotId: metric.robotId,
          metricType: metric.type,
          values: [],
          count: 0
        };
      }
      
      groups[groupKey].values.push(metric.value);
      groups[groupKey].count++;
    });
    
    // Calculate aggregates
    return Object.values(groups).map(group => ({
      ...group,
      avgValue: group.values.reduce((a, b) => a + b, 0) / group.values.length,
      minValue: Math.min(...group.values),
      maxValue: Math.max(...group.values)
    }));
  }

  /**
   * Get robot states
   */
  async getRobotStates() {
    return new Promise((resolve) => {
      const states = [];
      
      this.db.robotStates.map().once((data, robotId) => {
        if (data && typeof data === 'object') {
          states.push({ ...data, robotId });
        }
      });
      
      setTimeout(() => {
        resolve(states);
      }, 1000);
      
      this.stats.queriesExecuted++;
    });
  }

  /**
   * Save zone configuration
   */
  async saveZone(zone) {
    try {
      const zoneData = {
        ...zone,
        active: zone.active !== false,
        _updated: Date.now()
      };
      
      this.db.zones.get(zone.id).put(zoneData);
      return zoneData;
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
    return new Promise((resolve) => {
      const zones = [];
      
      this.db.zones.map().once((data, id) => {
        if (data && typeof data === 'object') {
          if (!activeOnly || data.active !== false) {
            zones.push({ ...data, id });
          }
        }
      });
      
      setTimeout(() => {
        zones.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        resolve(zones);
      }, 1000);
      
      this.stats.queriesExecuted++;
    });
  }

  /**
   * Save configuration section
   */
  async saveConfiguration(section, config) {
    try {
      const configData = {
        section,
        config,
        version: Date.now(),
        _updated: Date.now()
      };
      
      this.db.configurations.get(section).put(configData);
      return configData;
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
    return new Promise((resolve) => {
      this.db.configurations.get(section).once((data) => {
        this.stats.queriesExecuted++;
        resolve(data);
      });
    });
  }

  /**
   * Clean up old data (Gun handles this automatically with proper configuration)
   */
  async cleanupOldData(retentionDays = 30) {
    logger.info(`Gun.js handles data cleanup automatically based on peer storage limits`);
    return { message: 'Gun.js manages cleanup automatically' };
  }

  /**
   * Get database statistics
   */
  async getDatabaseStats() {
    const stats = { ...this.stats };
    
    // Count records (approximate, Gun is eventually consistent)
    const counts = await Promise.all([
      this.countRecords(this.db.events),
      this.countRecords(this.db.alerts),
      this.countRecords(this.db.metrics),
      this.countRecords(this.db.robotStates),
      this.countRecords(this.db.zones)
    ]);
    
    stats.eventCount = counts[0];
    stats.alertCount = counts[1];
    stats.metricCount = counts[2];
    stats.robotCount = counts[3];
    stats.zoneCount = counts[4];
    
    return stats;
  }

  /**
   * Count records in a Gun node
   */
  countRecords(node) {
    return new Promise((resolve) => {
      let count = 0;
      
      node.map().once((data, id) => {
        if (data && typeof data === 'object' && !id.includes('by-')) {
          count++;
        }
      });
      
      setTimeout(() => resolve(count), 1000);
    });
  }

  /**
   * Execute raw query (not applicable for Gun)
   */
  async executeQuery(query, values = []) {
    throw new Error('Raw queries not supported in Gun.js - use Gun chain methods instead');
  }

  /**
   * Get connection status
   */
  getStatus() {
    return this.isConnected ? 'online' : 'offline';
  }

  /**
   * Initialize tables (no-op for Gun)
   */
  async initializeTables() {
    logger.info('Gun.js storage initialized - no table creation needed');
    return Promise.resolve();
  }

  /**
   * Disconnect from database (no-op for Gun)
   */
  async disconnect() {
    this.isConnected = false;
    logger.info('Gun.js storage disconnected');
    return Promise.resolve();
  }
}

module.exports = GunStorage;