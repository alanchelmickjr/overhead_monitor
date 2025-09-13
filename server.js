/**
 * Robot Overhead Monitor - Main Server
 * Real-time robot monitoring system using IP cameras and SmolVLM
 */

require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');
const winston = require('winston');

// Import modules
const CameraManager = require('./src/camera/CameraManager');
const VisionEngine = require('./src/vision/VisionEngine');
const EventDetector = require('./src/detection/EventDetector');
const AlertManager = require('./src/alerts/AlertManager');
const ConfigManager = require('./src/config/ConfigManager');
const DatabaseService = require('./src/storage/DatabaseService');
const WebSocketHandler = require('./src/websocket/WebSocketHandler');

// Import API routes
const apiRoutes = require('./src/api/routes');

// Set up API routes with services
apiRoutes.setServices = function(services) {
  this.services = services;
};

// Logger configuration
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { service: 'robot-monitor' },
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

// Express app setup
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST']
  }
});

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'", 'ws:', 'wss:'],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"]
    }
  }
}));
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Static files (dashboard)
app.use(express.static(path.join(__dirname, 'public')));

// API routes (will be configured after services are initialized)

// Initialize core services
let cameraManager, visionEngine, eventDetector, alertManager, configManager, database, wsHandler;

async function initializeServices() {
  try {
    logger.info('Initializing Robot Overhead Monitor services...');

    // Load configuration
    configManager = new ConfigManager();
    await configManager.load();
    
    // Initialize database
    database = new DatabaseService(configManager.get('database'));
    await database.connect();
    
    // Initialize camera manager
    cameraManager = new CameraManager(configManager.get('cameras'));
    await cameraManager.initialize();
    
    // Initialize vision engine
    visionEngine = new VisionEngine(configManager.get('api'));
    
    // Initialize event detector
    eventDetector = new EventDetector(configManager.get('detection'));
    
    // Initialize alert manager
    alertManager = new AlertManager(configManager.get('alerts'));
    
    // Initialize WebSocket handler
    wsHandler = new WebSocketHandler(io, {
      cameraManager,
      visionEngine,
      eventDetector,
      alertManager,
      database
    });
    
    // Set up service dependencies
    setupServiceConnections();
    
    // Configure API routes with services
    apiRoutes.setServices({
      cameraManager,
      visionEngine,
      eventDetector,
      alertManager,
      configManager,
      database,
      wsHandler
    });
    
    // Mount API routes
    app.use('/api', apiRoutes);
    
    logger.info('All services initialized successfully');
    
    // Start monitoring
    startMonitoring();
    
  } catch (error) {
    logger.error('Failed to initialize services:', error);
    process.exit(1);
  }
}

function setupServiceConnections() {
  // Connect event detector to alert manager
  eventDetector.on('event', (event) => {
    logger.info(`Event detected: ${event.type}`, event);
    alertManager.handleEvent(event);
    database.saveEvent(event);
    wsHandler.broadcastEvent(event);
  });
  
  // Connect alert manager to WebSocket
  alertManager.on('alert', (alert) => {
    logger.warn(`Alert triggered: ${alert.priority}`, alert);
    wsHandler.broadcastAlert(alert);
  });
  
  // Camera frame processing pipeline
  cameraManager.on('frame', async (frameData) => {
    try {
      const analysis = await visionEngine.analyzeFrame(frameData);
      const events = await eventDetector.processAnalysis(analysis, frameData);
      
      // Broadcast frame and analysis
      wsHandler.broadcastFrame({
        ...frameData,
        analysis: analysis.summary
      });
      
    } catch (error) {
      logger.error('Frame processing error:', error);
    }
  });
}

async function startMonitoring() {
  const monitoringConfig = configManager.get('monitoring');
  
  // Start camera streams
  for (const camera of configManager.get('cameras')) {
    try {
      await cameraManager.startStream(camera.id, {
        interval: monitoringConfig.captureInterval || 500
      });
      logger.info(`Started monitoring camera: ${camera.id}`);
    } catch (error) {
      logger.error(`Failed to start camera ${camera.id}:`, error);
    }
  }
}

// Health check endpoint
app.get('/health', (req, res) => {
  const health = {
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    services: {
      camera: cameraManager?.getStatus() || 'offline',
      vision: visionEngine?.getStatus() || 'offline',
      database: database?.getStatus() || 'offline',
      alerts: alertManager?.getStatus() || 'offline'
    }
  };
  
  const overallStatus = Object.values(health.services).every(s => s === 'online') 
    ? 200 : 503;
  
  res.status(overallStatus).json(health);
});

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Express error:', err);
  res.status(err.status || 500).json({
    error: {
      message: err.message || 'Internal server error',
      code: err.code || 'INTERNAL_ERROR'
    }
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: {
      message: 'Not found',
      code: 'NOT_FOUND'
    }
  });
});

// Graceful shutdown
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

async function gracefulShutdown() {
  logger.info('Shutting down gracefully...');
  
  // Stop camera streams
  if (cameraManager) {
    await cameraManager.stopAll();
  }
  
  // Close database connection
  if (database) {
    await database.disconnect();
  }
  
  // Close server
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
  
  // Force shutdown after 10 seconds
  setTimeout(() => {
    logger.error('Forced shutdown');
    process.exit(1);
  }, 10000);
}

// Start server
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  logger.info(`Robot Overhead Monitor server running on port ${PORT}`);
  logger.info(`Dashboard available at http://localhost:${PORT}`);
  initializeServices();
});

module.exports = { app, server, io };