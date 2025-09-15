/**
 * Configuration Manager - Handles system configuration loading and management
 */

const fs = require('fs').promises;
const path = require('path');
const EventEmitter = require('events');
const winston = require('winston');
const Joi = require('joi');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.simple(),
  transports: [new winston.transports.Console()]
});

// Configuration schema for validation
const configSchema = Joi.object({
  server: Joi.object({
    port: Joi.number().port().default(3000),
    host: Joi.string().default('0.0.0.0'),
    cors_origin: Joi.string().default('*')
  }),
  
  cameras: Joi.array().items(Joi.object({
    id: Joi.string().required(),
    name: Joi.string().required(),
    protocol: Joi.string().valid('rtsp', 'http', 'mjpeg').required(),
    url: Joi.string().uri().required(),
    username: Joi.string().allow(''),
    password: Joi.string().allow(''),
    resolution: Joi.object({
      width: Joi.number().positive(),
      height: Joi.number().positive()
    }),
    fps: Joi.number().positive().max(60)
  })),
  
  api: Joi.object({
    base_url: Joi.string().uri().default('http://localhost:8080'),
    api_path: Joi.string().default('/v1/chat/completions'),
    model: Joi.string().default('smolvlm-instruct'),
    max_tokens: Joi.number().positive().default(150),
    temperature: Joi.number().min(0).max(2).default(0.7),
    timeout: Joi.number().positive().default(30000),
    max_retries: Joi.number().positive().default(3),
    cache_timeout: Joi.number().positive().default(5000)
  }),
  
  detection: Joi.object({
    confidence_thresholds: Joi.object({
      robot_tipped: Joi.number().min(0).max(1).default(0.85),
      robot_stuck: Joi.number().min(0).max(1).default(0.75),
      collision_detected: Joi.number().min(0).max(1).default(0.80),
      task_completed: Joi.number().min(0).max(1).default(0.70),
      zone_violation: Joi.number().min(0).max(1).default(0.75),
      performance_anomaly: Joi.number().min(0).max(1).default(0.65),
      safety_concern: Joi.number().min(0).max(1).default(0.90)
    }),
    confirmation_frames: Joi.object({
      robot_tipped: Joi.number().positive().default(3),
      robot_stuck: Joi.number().positive().default(5),
      collision_detected: Joi.number().positive().default(2),
      task_completed: Joi.number().positive().default(1),
      zone_violation: Joi.number().positive().default(2),
      performance_anomaly: Joi.number().positive().default(4),
      safety_concern: Joi.number().positive().default(1)
    }),
    zones: Joi.array().items(Joi.object({
      id: Joi.string().required(),
      name: Joi.string().required(),
      type: Joi.string().valid('rectangle', 'circle', 'polygon').required(),
      coordinates: Joi.alternatives().try(
        Joi.object({
          x: Joi.number(),
          y: Joi.number(),
          width: Joi.number(),
          height: Joi.number()
        }),
        Joi.object({
          cx: Joi.number(),
          cy: Joi.number(),
          radius: Joi.number()
        }),
        Joi.array().items(Joi.object({
          x: Joi.number(),
          y: Joi.number()
        }))
      ),
      color: Joi.string().default('#00ff00'),
      priority: Joi.string().valid('low', 'medium', 'high').default('medium')
    }))
  }),
  
  alerts: Joi.object({
    rules: Joi.array().items(Joi.object({
      id: Joi.string().required(),
      name: Joi.string().required(),
      event_type: Joi.string(),
      min_priority: Joi.string().valid('info', 'low', 'medium', 'high', 'critical'),
      min_confidence: Joi.number().min(0).max(1),
      zones: Joi.array().items(Joi.string()),
      robots: Joi.array().items(Joi.string()),
      channels: Joi.array().items(Joi.string()),
      recipients: Joi.array().items(Joi.string()),
      title: Joi.string(),
      message: Joi.string(),
      cooldown: Joi.number().positive(),
      enabled: Joi.boolean().default(true),
      actions: Joi.array().items(Joi.object({
        type: Joi.string(),
        params: Joi.object()
      }))
    })),
    channels: Joi.object({
      email: Joi.object({
        smtp_host: Joi.string(),
        smtp_port: Joi.number().port(),
        smtp_secure: Joi.boolean(),
        smtp_user: Joi.string(),
        smtp_pass: Joi.string(),
        from: Joi.string().email()
      }),
      sms: Joi.object({
        api_url: Joi.string().uri(),
        api_key: Joi.string(),
        from_number: Joi.string()
      }),
      webhook: Joi.object({
        urls: Joi.array().items(Joi.string().uri()),
        secret: Joi.string()
      })
    }),
    default_channels: Joi.array().items(Joi.string()).default(['dashboard', 'log']),
    throttle: Joi.object({
      window: Joi.number().positive().default(60000),
      maxAlerts: Joi.number().positive().default(5)
    }),
    escalation_policies: Joi.array().items(Joi.object({
      priority: Joi.string(),
      event_type: Joi.string(),
      steps: Joi.array().items(Joi.object({
        delay: Joi.number().positive(),
        channels: Joi.array().items(Joi.string()),
        additional_recipients: Joi.array().items(Joi.string())
      }))
    }))
  }),
  
  monitoring: Joi.object({
    captureInterval: Joi.number().positive().default(500),
    frameQuality: Joi.number().min(0).max(1).default(0.8),
    maxFrameWidth: Joi.number().positive().default(1920),
    maxFrameHeight: Joi.number().positive().default(1080)
  }),
  
  frameBuffer: Joi.object({
    enabled: Joi.boolean().default(true),
    maxMemoryFrames: Joi.number().positive().default(100),
    diskStorage: Joi.object({
      enabled: Joi.boolean().default(true),
      path: Joi.string().default('./data/frames'),
      maxSizeMB: Joi.number().positive().default(1024),
      retentionHours: Joi.number().positive().default(24)
    }),
    captureMetadata: Joi.boolean().default(true)
  }),
  
  database: Joi.object({
    type: Joi.string().valid('postgresql', 'mysql', 'sqlite').default('postgresql'),
    host: Joi.string().default('localhost'),
    port: Joi.number().port().default(5432),
    database: Joi.string().default('robot_monitor'),
    username: Joi.string().default('robot_monitor'),
    password: Joi.string(),
    ssl: Joi.boolean().default(false)
  }),
  
  storage: Joi.object({
    screenshots: Joi.object({
      enabled: Joi.boolean().default(true),
      path: Joi.string().default('./data/screenshots'),
      retention_days: Joi.number().positive().default(30)
    }),
    events: Joi.object({
      retention_days: Joi.number().positive().default(90),
      max_events: Joi.number().positive().default(100000)
    }),
    logs: Joi.object({
      path: Joi.string().default('./logs'),
      level: Joi.string().valid('error', 'warn', 'info', 'debug').default('info'),
      retention_days: Joi.number().positive().default(7)
    })
  }),
  
  performance: Joi.object({
    cache: Joi.object({
      enabled: Joi.boolean().default(true),
      ttl: Joi.number().positive().default(5000),
      max_size: Joi.number().positive().default(100)
    }),
    optimization: Joi.object({
      adaptive_sampling: Joi.boolean().default(true),
      roi_processing: Joi.boolean().default(false),
      batch_processing: Joi.boolean().default(true),
      max_concurrent_requests: Joi.number().positive().default(3)
    })
  })
});

class ConfigManager extends EventEmitter {
  constructor(configPath = null) {
    super();
    
    this.configPath = configPath || this.findConfigFile();
    this.config = {};
    this.defaults = {};
    this.isLoaded = false;
    this.watchers = new Map();
    
    logger.info(`Config Manager initialized with path: ${this.configPath}`);
  }

  /**
   * Find configuration file
   */
  findConfigFile() {
    const possiblePaths = [
      path.join(process.cwd(), 'config.json'),
      path.join(process.cwd(), 'config.yaml'),
      path.join(process.cwd(), 'config', 'config.json'),
      path.join(process.cwd(), '.config', 'robot-monitor.json'),
      process.env.CONFIG_PATH
    ].filter(Boolean);
    
    for (const configPath of possiblePaths) {
      try {
        if (require('fs').existsSync(configPath)) {
          return configPath;
        }
      } catch (error) {
        // Continue checking other paths
      }
    }
    
    // Return default path if no config found
    return path.join(process.cwd(), 'config.json');
  }

  /**
   * Load configuration
   */
  async load() {
    try {
      // Load from environment variables first
      this.loadEnvironmentVariables();
      
      // Try to load from file
      if (await this.fileExists(this.configPath)) {
        const fileConfig = await this.loadFromFile(this.configPath);
        this.mergeConfig(fileConfig);
      } else {
        logger.warn(`Config file not found at ${this.configPath}, using defaults`);
        await this.createDefaultConfig();
      }
      
      // Validate configuration
      const validation = configSchema.validate(this.config, { 
        abortEarly: false,
        allowUnknown: true 
      });
      
      if (validation.error) {
        logger.error('Configuration validation errors:', validation.error.details);
        throw new Error('Invalid configuration: ' + validation.error.message);
      }
      
      this.config = validation.value;
      this.isLoaded = true;
      
      // Set up file watcher for hot reload
      this.setupWatcher();
      
      this.emit('loaded', this.config);
      logger.info('Configuration loaded successfully');
      
    } catch (error) {
      logger.error('Failed to load configuration:', error);
      throw error;
    }
  }

  /**
   * Load configuration from file
   */
  async loadFromFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const content = await fs.readFile(filePath, 'utf8');
    
    if (ext === '.json') {
      return JSON.parse(content);
    } else if (ext === '.yaml' || ext === '.yml') {
      const yaml = require('js-yaml');
      return yaml.load(content);
    } else {
      throw new Error(`Unsupported config file format: ${ext}`);
    }
  }

  /**
   * Load environment variables
   */
  loadEnvironmentVariables() {
    const env = process.env;
    
    this.config = {
      server: {
        port: parseInt(env.PORT) || 3000,
        host: env.HOST || '0.0.0.0',
        cors_origin: env.CORS_ORIGIN || '*'
      },
      api: {
        base_url: env.SMOLVLM_API_URL || env.API_URL || 'http://localhost:8080'
      },
      database: {
        type: env.DB_TYPE || 'postgresql',
        host: env.DB_HOST || 'localhost',
        port: parseInt(env.DB_PORT) || 5432,
        database: env.DB_NAME || 'robot_monitor',
        username: env.DB_USER || 'robot_monitor',
        password: env.DB_PASSWORD
      }
    };
    
    // Parse cameras from environment if provided
    if (env.CAMERA_CONFIG) {
      try {
        this.config.cameras = JSON.parse(env.CAMERA_CONFIG);
      } catch (error) {
        logger.error('Failed to parse CAMERA_CONFIG:', error);
      }
    }
  }

  /**
   * Create default configuration file
   */
  async createDefaultConfig() {
    const defaultConfig = {
      server: {
        port: 3000,
        host: '0.0.0.0'
      },
      cameras: [
        {
          id: 'cam-001',
          name: 'Overhead Main',
          protocol: 'rtsp',
          url: 'rtsp://192.168.1.100:554/stream1',
          username: 'admin',
          password: 'password',
          resolution: { width: 1920, height: 1080 },
          fps: 30
        }
      ],
      api: {
        base_url: 'http://localhost:8080',
        model: 'smolvlm-instruct'
      },
      detection: {
        zones: [
          {
            id: 'zone-1',
            name: 'Work Area',
            type: 'rectangle',
            coordinates: { x: 100, y: 100, width: 800, height: 600 },
            color: '#00ff00'
          }
        ]
      },
      alerts: {
        rules: [
          {
            id: 'rule-001',
            name: 'Robot Tipped Alert',
            event_type: 'robot_tipped',
            channels: ['dashboard', 'email'],
            enabled: true
          }
        ],
        default_channels: ['dashboard', 'log']
      },
      monitoring: {
        captureInterval: 500
      }
    };
    
    this.mergeConfig(defaultConfig);
    
    // Try to save default config
    try {
      await this.save(defaultConfig);
      logger.info(`Created default config file at ${this.configPath}`);
    } catch (error) {
      logger.warn('Could not save default config file:', error.message);
    }
  }

  /**
   * Merge configuration objects
   */
  mergeConfig(source) {
    this.config = this.deepMerge(this.config, source);
  }

  /**
   * Deep merge objects
   */
  deepMerge(target, source) {
    const output = Object.assign({}, target);
    
    if (this.isObject(target) && this.isObject(source)) {
      Object.keys(source).forEach(key => {
        if (this.isObject(source[key])) {
          if (!(key in target)) {
            Object.assign(output, { [key]: source[key] });
          } else {
            output[key] = this.deepMerge(target[key], source[key]);
          }
        } else {
          Object.assign(output, { [key]: source[key] });
        }
      });
    }
    
    return output;
  }

  /**
   * Check if value is an object
   */
  isObject(item) {
    return item && typeof item === 'object' && !Array.isArray(item);
  }

  /**
   * Set up file watcher for hot reload
   */
  setupWatcher() {
    if (!this.configPath || !require('fs').existsSync(this.configPath)) {
      return;
    }
    
    const fs = require('fs');
    
    const watcher = fs.watch(this.configPath, async (eventType) => {
      if (eventType === 'change') {
        logger.info('Configuration file changed, reloading...');
        
        try {
          const newConfig = await this.loadFromFile(this.configPath);
          const validation = configSchema.validate(newConfig, { 
            abortEarly: false,
            allowUnknown: true 
          });
          
          if (validation.error) {
            logger.error('Invalid configuration update:', validation.error.message);
            return;
          }
          
          const oldConfig = this.config;
          this.config = validation.value;
          
          this.emit('updated', this.config, oldConfig);
          logger.info('Configuration reloaded successfully');
          
        } catch (error) {
          logger.error('Failed to reload configuration:', error);
        }
      }
    });
    
    this.watchers.set(this.configPath, watcher);
  }

  /**
   * Save configuration to file
   */
  async save(config = null) {
    const configToSave = config || this.config;
    const ext = path.extname(this.configPath).toLowerCase();
    
    let content;
    if (ext === '.json') {
      content = JSON.stringify(configToSave, null, 2);
    } else if (ext === '.yaml' || ext === '.yml') {
      const yaml = require('js-yaml');
      content = yaml.dump(configToSave);
    } else {
      throw new Error(`Unsupported config file format: ${ext}`);
    }
    
    // Create directory if it doesn't exist
    const dir = path.dirname(this.configPath);
    await fs.mkdir(dir, { recursive: true });
    
    // Write file
    await fs.writeFile(this.configPath, content, 'utf8');
    
    logger.info(`Configuration saved to ${this.configPath}`);
  }

  /**
   * Get configuration value
   */
  get(path = null) {
    if (!path) {
      return this.config;
    }
    
    const keys = path.split('.');
    let value = this.config;
    
    for (const key of keys) {
      if (value && typeof value === 'object' && key in value) {
        value = value[key];
      } else {
        return undefined;
      }
    }
    
    return value;
  }

  /**
   * Set configuration value
   */
  set(path, value) {
    const keys = path.split('.');
    const lastKey = keys.pop();
    
    let target = this.config;
    for (const key of keys) {
      if (!(key in target) || typeof target[key] !== 'object') {
        target[key] = {};
      }
      target = target[key];
    }
    
    const oldValue = target[lastKey];
    target[lastKey] = value;
    
    this.emit('changed', path, value, oldValue);
    
    return this;
  }

  /**
   * Update configuration section
   */
  async update(section, updates) {
    if (!(section in this.config)) {
      throw new Error(`Configuration section '${section}' not found`);
    }
    
    const oldSection = this.config[section];
    this.config[section] = this.deepMerge(oldSection, updates);
    
    // Validate updated configuration
    const validation = configSchema.validate(this.config, { 
      abortEarly: false,
      allowUnknown: true 
    });
    
    if (validation.error) {
      // Revert changes
      this.config[section] = oldSection;
      throw new Error('Invalid configuration update: ' + validation.error.message);
    }
    
    this.config = validation.value;
    
    // Save to file
    await this.save();
    
    this.emit('section-updated', section, this.config[section], oldSection);
    
    return this.config[section];
  }

  /**
   * Check if file exists
   */
  async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Validate configuration
   */
  validate(config = null) {
    const configToValidate = config || this.config;
    const validation = configSchema.validate(configToValidate, { 
      abortEarly: false,
      allowUnknown: true 
    });
    
    return {
      valid: !validation.error,
      errors: validation.error ? validation.error.details : [],
      value: validation.value
    };
  }

  /**
   * Get configuration schema
   */
  getSchema() {
    return configSchema.describe();
  }

  /**
   * Export configuration
   */
  async export(format = 'json') {
    if (format === 'json') {
      return JSON.stringify(this.config, null, 2);
    } else if (format === 'yaml') {
      const yaml = require('js-yaml');
      return yaml.dump(this.config);
    } else {
      throw new Error(`Unsupported export format: ${format}`);
    }
  }

  /**
   * Import configuration
   */
  async import(data, format = 'json') {
    let config;
    
    if (format === 'json') {
      config = typeof data === 'string' ? JSON.parse(data) : data;
    } else if (format === 'yaml') {
      const yaml = require('js-yaml');
      config = yaml.load(data);
    } else {
      throw new Error(`Unsupported import format: ${format}`);
    }
    
    // Validate imported configuration
    const validation = this.validate(config);
    if (!validation.valid) {
      throw new Error('Invalid configuration: ' + JSON.stringify(validation.errors));
    }
    
    this.config = validation.value;
    await this.save();
    
    this.emit('imported', this.config);
    
    return this.config;
  }

  /**
   * Clean up resources
   */
  async cleanup() {
    // Close file watchers
    for (const [path, watcher] of this.watchers) {
      watcher.close();
    }
    this.watchers.clear();
    
    logger.info('Config Manager cleaned up');
  }
}

module.exports = ConfigManager;