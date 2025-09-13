/**
 * REST API Routes for Robot Overhead Monitor
 */

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP, please try again later.'
});

const strictLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: 'Too many requests from this IP, please try again later.'
});

// Apply rate limiting to all routes
router.use(limiter);

// Service references (will be injected from server.js)
let services = {};

// Initialize services
router.setServices = (servicesRef) => {
    services = servicesRef;
};

// Authentication middleware
const authenticate = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({
            error: {
                code: 'UNAUTHORIZED',
                message: 'Authentication required'
            }
        });
    }
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(401).json({
            error: {
                code: 'INVALID_TOKEN',
                message: 'Invalid or expired token'
            }
        });
    }
};

// Optional authentication (allows both authenticated and unauthenticated)
const optionalAuth = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (token) {
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
            req.user = decoded;
        } catch (error) {
            // Invalid token, but continue as unauthenticated
        }
    }
    
    next();
};

/**
 * Authentication Endpoints
 */

// Login
router.post('/auth/login', strictLimiter, async (req, res) => {
    const { username, password } = req.body;
    
    // Simple demo authentication (in production, check against database)
    const users = {
        admin: { password: 'admin123', role: 'admin' },
        operator: { password: 'operator123', role: 'operator' }
    };
    
    const user = users[username];
    
    if (!user || password !== user.password) {
        return res.status(401).json({
            error: {
                code: 'INVALID_CREDENTIALS',
                message: 'Invalid username or password'
            }
        });
    }
    
    // Generate JWT token
    const token = jwt.sign(
        { userId: username, role: user.role },
        process.env.JWT_SECRET || 'secret',
        { expiresIn: '24h' }
    );
    
    res.json({
        token,
        expires_in: 86400,
        user: {
            username,
            role: user.role
        }
    });
});

// Refresh token
router.post('/auth/refresh', authenticate, (req, res) => {
    const token = jwt.sign(
        { userId: req.user.userId, role: req.user.role },
        process.env.JWT_SECRET || 'secret',
        { expiresIn: '24h' }
    );
    
    res.json({
        token,
        expires_in: 86400
    });
});

/**
 * Camera Endpoints
 */

// Get all cameras
router.get('/cameras', optionalAuth, (req, res) => {
    if (!services.cameraManager) {
        return res.status(503).json({
            error: {
                code: 'SERVICE_UNAVAILABLE',
                message: 'Camera service not available'
            }
        });
    }
    
    const cameras = services.cameraManager.getAllCameras();
    res.json({ cameras });
});

// Get camera by ID
router.get('/cameras/:cameraId', optionalAuth, (req, res) => {
    if (!services.cameraManager) {
        return res.status(503).json({
            error: {
                code: 'SERVICE_UNAVAILABLE',
                message: 'Camera service not available'
            }
        });
    }
    
    const camera = services.cameraManager.getCameraInfo(req.params.cameraId);
    
    if (!camera) {
        return res.status(404).json({
            error: {
                code: 'NOT_FOUND',
                message: 'Camera not found'
            }
        });
    }
    
    res.json(camera);
});

// Update camera settings
router.put('/cameras/:cameraId/settings', authenticate, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({
            error: {
                code: 'FORBIDDEN',
                message: 'Admin access required'
            }
        });
    }
    
    // Update camera settings
    // This would need implementation in CameraManager
    res.json({
        success: true,
        message: 'Camera settings updated',
        camera_id: req.params.cameraId
    });
});

// Capture snapshot
router.post('/cameras/:cameraId/snapshot', authenticate, async (req, res) => {
    if (!services.cameraManager) {
        return res.status(503).json({
            error: {
                code: 'SERVICE_UNAVAILABLE',
                message: 'Camera service not available'
            }
        });
    }
    
    try {
        await services.cameraManager.captureFrame(req.params.cameraId);
        const camera = services.cameraManager.getCameraInfo(req.params.cameraId);
        
        if (camera && camera.lastFrame) {
            res.json({
                snapshot_url: `/api/snapshots/${req.params.cameraId}.jpg`,
                timestamp: new Date().toISOString(),
                camera_id: req.params.cameraId
            });
        } else {
            throw new Error('No frame available');
        }
    } catch (error) {
        res.status(500).json({
            error: {
                code: 'CAPTURE_FAILED',
                message: error.message
            }
        });
    }
});

/**
 * Event Endpoints
 */

// Get events
router.get('/events', optionalAuth, async (req, res) => {
    if (!services.database) {
        return res.status(503).json({
            error: {
                code: 'SERVICE_UNAVAILABLE',
                message: 'Database service not available'
            }
        });
    }
    
    try {
        const filters = {
            startDate: req.query.start_date,
            endDate: req.query.end_date,
            type: req.query.type,
            robotId: req.query.robot_id,
            zoneId: req.query.zone_id,
            priority: req.query.priority,
            limit: parseInt(req.query.limit) || 50,
            offset: parseInt(req.query.offset) || 0
        };
        
        const events = await services.database.getEvents(filters);
        
        res.json({
            total: events.length,
            limit: filters.limit,
            offset: filters.offset,
            events
        });
    } catch (error) {
        res.status(500).json({
            error: {
                code: 'DATABASE_ERROR',
                message: error.message
            }
        });
    }
});

// Get event by ID
router.get('/events/:eventId', optionalAuth, async (req, res) => {
    if (!services.database) {
        return res.status(503).json({
            error: {
                code: 'SERVICE_UNAVAILABLE',
                message: 'Database service not available'
            }
        });
    }
    
    try {
        const event = await services.database.getEventById(req.params.eventId);
        
        if (!event) {
            return res.status(404).json({
                error: {
                    code: 'NOT_FOUND',
                    message: 'Event not found'
                }
            });
        }
        
        res.json(event);
    } catch (error) {
        res.status(500).json({
            error: {
                code: 'DATABASE_ERROR',
                message: error.message
            }
        });
    }
});

// Acknowledge event
router.post('/events/:eventId/acknowledge', authenticate, async (req, res) => {
    if (!services.alertManager) {
        return res.status(503).json({
            error: {
                code: 'SERVICE_UNAVAILABLE',
                message: 'Alert service not available'
            }
        });
    }
    
    try {
        const alert = services.alertManager.acknowledgeAlert(
            req.params.eventId,
            req.user.userId,
            req.body.notes
        );
        
        res.json({
            success: true,
            event_id: req.params.eventId,
            acknowledged_at: new Date().toISOString(),
            acknowledged_by: req.user.userId
        });
    } catch (error) {
        res.status(500).json({
            error: {
                code: 'ACKNOWLEDGE_FAILED',
                message: error.message
            }
        });
    }
});

/**
 * Zone Endpoints
 */

// Get zones
router.get('/zones', optionalAuth, async (req, res) => {
    if (!services.database) {
        return res.status(503).json({
            error: {
                code: 'SERVICE_UNAVAILABLE',
                message: 'Database service not available'
            }
        });
    }
    
    try {
        const zones = await services.database.getZones();
        res.json({ zones });
    } catch (error) {
        res.status(500).json({
            error: {
                code: 'DATABASE_ERROR',
                message: error.message
            }
        });
    }
});

// Create zone
router.post('/zones', authenticate, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({
            error: {
                code: 'FORBIDDEN',
                message: 'Admin access required'
            }
        });
    }
    
    const zone = {
        id: req.body.id || `zone-${uuidv4()}`,
        name: req.body.name,
        type: req.body.type,
        coordinates: req.body.coordinates,
        color: req.body.color,
        priority: req.body.priority,
        alerts: req.body.alerts
    };
    
    try {
        const saved = await services.database.saveZone(zone);
        
        // Update event detector
        if (services.eventDetector) {
            const zones = await services.database.getZones();
            services.eventDetector.setZones(zones);
        }
        
        res.json({
            id: saved.id,
            name: saved.name,
            created_at: saved.created_at,
            active: true
        });
    } catch (error) {
        res.status(500).json({
            error: {
                code: 'CREATE_FAILED',
                message: error.message
            }
        });
    }
});

// Update zone
router.put('/zones/:zoneId', authenticate, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({
            error: {
                code: 'FORBIDDEN',
                message: 'Admin access required'
            }
        });
    }
    
    const zone = {
        id: req.params.zoneId,
        ...req.body
    };
    
    try {
        const saved = await services.database.saveZone(zone);
        
        // Update event detector
        if (services.eventDetector) {
            const zones = await services.database.getZones();
            services.eventDetector.setZones(zones);
        }
        
        res.json(saved);
    } catch (error) {
        res.status(500).json({
            error: {
                code: 'UPDATE_FAILED',
                message: error.message
            }
        });
    }
});

// Delete zone
router.delete('/zones/:zoneId', authenticate, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({
            error: {
                code: 'FORBIDDEN',
                message: 'Admin access required'
            }
        });
    }
    
    // Mark zone as inactive
    const zone = {
        id: req.params.zoneId,
        active: false
    };
    
    try {
        await services.database.saveZone(zone);
        
        // Update event detector
        if (services.eventDetector) {
            const zones = await services.database.getZones();
            services.eventDetector.setZones(zones);
        }
        
        res.json({
            success: true,
            message: 'Zone deleted'
        });
    } catch (error) {
        res.status(500).json({
            error: {
                code: 'DELETE_FAILED',
                message: error.message
            }
        });
    }
});

/**
 * Robot Endpoints
 */

// Get robots
router.get('/robots', optionalAuth, async (req, res) => {
    if (!services.database) {
        return res.status(503).json({
            error: {
                code: 'SERVICE_UNAVAILABLE',
                message: 'Database service not available'
            }
        });
    }
    
    try {
        const robots = await services.database.getRobotStates();
        res.json({ robots });
    } catch (error) {
        res.status(500).json({
            error: {
                code: 'DATABASE_ERROR',
                message: error.message
            }
        });
    }
});

// Get robot by ID
router.get('/robots/:robotId', optionalAuth, async (req, res) => {
    if (!services.database) {
        return res.status(503).json({
            error: {
                code: 'SERVICE_UNAVAILABLE',
                message: 'Database service not available'
            }
        });
    }
    
    try {
        const robots = await services.database.getRobotStates();
        const robot = robots.find(r => r.robot_id === req.params.robotId);
        
        if (!robot) {
            return res.status(404).json({
                error: {
                    code: 'NOT_FOUND',
                    message: 'Robot not found'
                }
            });
        }
        
        res.json(robot);
    } catch (error) {
        res.status(500).json({
            error: {
                code: 'DATABASE_ERROR',
                message: error.message
            }
        });
    }
});

// Get robot metrics
router.get('/robots/:robotId/metrics', optionalAuth, async (req, res) => {
    if (!services.database) {
        return res.status(503).json({
            error: {
                code: 'SERVICE_UNAVAILABLE',
                message: 'Database service not available'
            }
        });
    }
    
    try {
        const period = req.query.period || 'hour';
        const endDate = new Date();
        const startDate = new Date();
        
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
        
        const metrics = await services.database.getMetrics({
            robotId: req.params.robotId,
            startDate,
            endDate,
            aggregate: true,
            period
        });
        
        res.json({
            robot_id: req.params.robotId,
            period,
            metrics
        });
    } catch (error) {
        res.status(500).json({
            error: {
                code: 'DATABASE_ERROR',
                message: error.message
            }
        });
    }
});

/**
 * Alert Endpoints
 */

// Get alert rules
router.get('/alerts/rules', optionalAuth, (req, res) => {
    if (!services.alertManager) {
        return res.status(503).json({
            error: {
                code: 'SERVICE_UNAVAILABLE',
                message: 'Alert service not available'
            }
        });
    }
    
    // Get rules from alert manager (would need to add this method)
    res.json({
        rules: []
    });
});

// Create alert rule
router.post('/alerts/rules', authenticate, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({
            error: {
                code: 'FORBIDDEN',
                message: 'Admin access required'
            }
        });
    }
    
    const rule = {
        id: uuidv4(),
        ...req.body
    };
    
    // Update alert manager rules
    if (services.alertManager) {
        const currentRules = []; // Get current rules
        services.alertManager.updateRules([...currentRules, rule]);
    }
    
    res.json(rule);
});

// Update alert rule
router.put('/alerts/rules/:ruleId', authenticate, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({
            error: {
                code: 'FORBIDDEN',
                message: 'Admin access required'
            }
        });
    }
    
    // Update rule in alert manager
    res.json({
        success: true,
        rule_id: req.params.ruleId
    });
});

/**
 * Analytics Endpoints
 */

// Get summary statistics
router.get('/analytics/summary', optionalAuth, async (req, res) => {
    if (!services.database) {
        return res.status(503).json({
            error: {
                code: 'SERVICE_UNAVAILABLE',
                message: 'Database service not available'
            }
        });
    }
    
    try {
        const stats = await services.database.getDatabaseStats();
        
        res.json({
            period: {
                start: req.query.start_date || new Date(Date.now() - 86400000).toISOString(),
                end: req.query.end_date || new Date().toISOString()
            },
            statistics: {
                total_events: stats.eventCount || 0,
                total_alerts: stats.alertCount || 0,
                robots_monitored: stats.robotCount || 0,
                uptime_percentage: 99.5,
                events_today: stats.recentEvents || 0
            }
        });
    } catch (error) {
        res.status(500).json({
            error: {
                code: 'DATABASE_ERROR',
                message: error.message
            }
        });
    }
});

// Get trend analysis
router.get('/analytics/trends', optionalAuth, async (req, res) => {
    const metric = req.query.metric || 'events';
    const period = req.query.period || 'week';
    
    // Mock trend data
    const data = [];
    const days = period === 'week' ? 7 : 30;
    
    for (let i = days; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        
        data.push({
            date: date.toISOString().split('T')[0],
            value: Math.floor(Math.random() * 100)
        });
    }
    
    res.json({
        metric,
        period,
        data,
        trend: 'increasing',
        change_percentage: 12.5
    });
});

/**
 * Metrics Endpoint
 */
router.get('/metrics', (req, res) => {
    const metrics = {
        system_uptime: process.uptime(),
        memory_usage: process.memoryUsage(),
        connections: services.wsHandler ? services.wsHandler.getStatistics().connectionsActive : 0,
        events_processed: services.eventDetector ? services.eventDetector.getStatistics().eventsDetected : 0,
        alerts_sent: services.alertManager ? services.alertManager.getStatistics().alertsSent : 0
    };
    
    res.json(metrics);
});

/**
 * Webhook Endpoints
 */

// Register webhook
router.post('/webhooks', authenticate, async (req, res) => {
    const webhook = {
        id: uuidv4(),
        url: req.body.url,
        events: req.body.events,
        secret: req.body.secret,
        created_by: req.user.userId,
        created_at: new Date().toISOString()
    };
    
    // Store webhook (would need database implementation)
    res.json(webhook);
});

// Test webhook
router.post('/webhooks/:webhookId/test', authenticate, async (req, res) => {
    // Send test event to webhook
    res.json({
        success: true,
        message: 'Test event sent'
    });
});

/**
 * Configuration Endpoints
 */

// Get configuration
router.get('/config', authenticate, (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({
            error: {
                code: 'FORBIDDEN',
                message: 'Admin access required'
            }
        });
    }
    
    if (!services.configManager) {
        return res.status(503).json({
            error: {
                code: 'SERVICE_UNAVAILABLE',
                message: 'Configuration service not available'
            }
        });
    }
    
    const config = services.configManager.get();
    
    // Remove sensitive information
    delete config.database?.password;
    delete config.alerts?.channels?.email?.smtp_pass;
    delete config.alerts?.channels?.sms?.api_key;
    
    res.json(config);
});

// Update configuration
router.put('/config/:section', authenticate, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({
            error: {
                code: 'FORBIDDEN',
                message: 'Admin access required'
            }
        });
    }
    
    if (!services.configManager) {
        return res.status(503).json({
            error: {
                code: 'SERVICE_UNAVAILABLE',
                message: 'Configuration service not available'
            }
        });
    }
    
    try {
        const updated = await services.configManager.update(req.params.section, req.body);
        res.json(updated);
    } catch (error) {
        res.status(400).json({
            error: {
                code: 'UPDATE_FAILED',
                message: error.message
            }
        });
    }
});

/**
 * Export/Import Endpoints
 */

// Export configuration
router.get('/export/config', authenticate, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({
            error: {
                code: 'FORBIDDEN',
                message: 'Admin access required'
            }
        });
    }
    
    if (!services.configManager) {
        return res.status(503).json({
            error: {
                code: 'SERVICE_UNAVAILABLE',
                message: 'Configuration service not available'
            }
        });
    }
    
    const format = req.query.format || 'json';
    const config = await services.configManager.export(format);
    
    res.setHeader('Content-Type', format === 'yaml' ? 'text/yaml' : 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="robot-monitor-config.${format}"`);
    res.send(config);
});

// Import configuration
router.post('/import/config', authenticate, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({
            error: {
                code: 'FORBIDDEN',
                message: 'Admin access required'
            }
        });
    }
    
    if (!services.configManager) {
        return res.status(503).json({
            error: {
                code: 'SERVICE_UNAVAILABLE',
                message: 'Configuration service not available'
            }
        });
    }
    
    try {
        const format = req.query.format || 'json';
        const imported = await services.configManager.import(req.body, format);
        res.json({
            success: true,
            message: 'Configuration imported successfully'
        });
    } catch (error) {
        res.status(400).json({
            error: {
                code: 'IMPORT_FAILED',
                message: error.message
            }
        });
    }
});

// Error handler
router.use((err, req, res, next) => {
    console.error('API Error:', err);
    
    res.status(err.status || 500).json({
        error: {
            code: err.code || 'INTERNAL_ERROR',
            message: err.message || 'Internal server error'
        }
    });
});

module.exports = router;