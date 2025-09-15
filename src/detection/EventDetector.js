/**
 * Event Detector - Analyzes vision engine outputs to detect robot events
 */

const EventEmitter = require('events');
const winston = require('winston');
const { v4: uuidv4 } = require('uuid');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.simple(),
  transports: [new winston.transports.Console()]
});

// Event types
const EVENT_TYPES = {
  ROBOT_TIPPED: 'robot_tipped',
  ROBOT_STUCK: 'robot_stuck',
  COLLISION_DETECTED: 'collision_detected',
  TASK_COMPLETED: 'task_completed',
  ZONE_VIOLATION: 'zone_violation',
  PERFORMANCE_ANOMALY: 'performance_anomaly',
  SAFETY_CONCERN: 'safety_concern',
  HUMAN_IN_AREA: 'human_in_area',
  HIGH_ACTIVITY: 'high_activity',
  LOW_ACTIVITY: 'low_activity'
};

// Event priorities
const EVENT_PRIORITIES = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
  INFO: 'info'
};

class EventDetector extends EventEmitter {
  constructor(config = {}) {
    super();
    
    // Configuration
    this.confidenceThresholds = config.confidence_thresholds || {
      robot_tipped: 0.85,
      robot_stuck: 0.75,
      collision_detected: 0.80,
      task_completed: 0.70,
      zone_violation: 0.75,
      performance_anomaly: 0.65,
      safety_concern: 0.90,
      human_in_area: 0.80,
      high_activity: 0.70,
      low_activity: 0.70
    };
    
    this.confirmationFrames = config.confirmation_frames || {
      robot_tipped: 3,
      robot_stuck: 5,
      collision_detected: 2,
      task_completed: 1,
      zone_violation: 2,
      performance_anomaly: 4,
      safety_concern: 1,
      human_in_area: 1,
      high_activity: 1,
      low_activity: 3
    };
    
    // State tracking
    this.robotStates = new Map();
    this.pendingEvents = new Map();
    this.confirmedEvents = new Map();
    this.eventHistory = [];
    this.recentEventCounts = new Map(); // For deduplication
    this.activityLevel = 'normal';
    this.lastActivityCheck = Date.now();
    
    // Zone definitions
    this.zones = config.zones || [];
    
    // Performance baselines
    this.performanceBaselines = new Map();
    
    // Statistics
    this.stats = {
      eventsDetected: 0,
      falsePositives: 0,
      eventsConfirmed: 0,
      eventsByType: {}
    };
    
    logger.info('Event Detector initialized');
  }

  /**
   * Process analysis from vision engine
   */
  async processAnalysis(analysis, frameData) {
    const events = [];
    
    // Extract detections from analysis
    const detections = analysis.detections || [];
    
    // Check activity level
    const activityEvent = this.checkActivityLevel(detections, analysis);
    if (activityEvent) {
      events.push(activityEvent);
    }
    
    for (const detection of detections) {
      const event = await this.evaluateDetection(detection, analysis, frameData);
      if (event) {
        // Check for duplicate events
        if (!this.isDuplicateEvent(event)) {
          events.push(event);
        }
      }
    }
    
    // Check for zone violations
    const zoneEvents = await this.checkZoneViolations(analysis, frameData);
    events.push(...zoneEvents);
    
    // Check for stuck robots
    const stuckEvents = await this.checkStuckRobots(frameData);
    events.push(...stuckEvents);
    
    // Check for performance anomalies
    const anomalyEvents = await this.checkPerformanceAnomalies(analysis, frameData);
    events.push(...anomalyEvents);
    
    // Process and emit confirmed events
    for (const event of events) {
      const confirmed = await this.confirmEvent(event);
      if (confirmed) {
        this.emitEvent(confirmed);
      }
    }
    
    return events;
  }

  /**
   * Evaluate a single detection
   */
  async evaluateDetection(detection, analysis, frameData) {
    const { type, confidence, detected } = detection;
    
    if (!detected) return null;
    
    // Check confidence threshold
    const threshold = this.confidenceThresholds[type];
    if (confidence < threshold) {
      logger.debug(`Detection ${type} below threshold: ${confidence} < ${threshold}`);
      return null;
    }
    
    // Create event object
    const event = {
      id: uuidv4(),
      type: this.mapDetectionToEventType(type),
      timestamp: frameData.timestamp,
      cameraId: frameData.cameraId,
      confidence: confidence,
      priority: this.determineEventPriority(type, confidence),
      description: this.generateEventDescription(type, analysis),
      metadata: {
        detection: detection,
        analysisContent: analysis.content,
        frameResolution: frameData.resolution
      },
      status: 'pending'
    };
    
    // Add robot ID if identifiable
    const robotId = this.extractRobotId(analysis.content);
    if (robotId) {
      event.robotId = robotId;
    }
    
    // Add zone information
    const zone = this.identifyZone(frameData, analysis);
    if (zone) {
      event.zoneId = zone.id;
      event.metadata.zone = zone;
    }
    
    return event;
  }

  /**
   * Check for zone violations
   */
  async checkZoneViolations(analysis, frameData) {
    const events = [];
    
    if (this.zones.length === 0) return events;
    
    for (const zone of this.zones) {
      const violation = this.detectZoneViolation(zone, analysis, frameData);
      
      if (violation) {
        events.push({
          id: uuidv4(),
          type: EVENT_TYPES.ZONE_VIOLATION,
          timestamp: frameData.timestamp,
          cameraId: frameData.cameraId,
          zoneId: zone.id,
          confidence: violation.confidence,
          priority: zone.priority || EVENT_PRIORITIES.MEDIUM,
          description: `Zone violation detected in ${zone.name}`,
          metadata: {
            zone: zone,
            violationType: violation.type,
            robotsInZone: violation.robotsInZone
          },
          status: 'pending'
        });
      }
    }
    
    return events;
  }

  /**
   * Check for stuck robots
   */
  async checkStuckRobots(frameData) {
    const events = [];
    const currentTime = Date.now();
    
    // Get or create state for this camera
    const cameraState = this.robotStates.get(frameData.cameraId) || {
      robots: new Map(),
      lastUpdate: currentTime
    };
    
    // Update robot positions from current frame
    // This would need more sophisticated tracking in production
    const robotPositions = this.extractRobotPositions(frameData);
    
    for (const [robotId, position] of robotPositions) {
      const robotState = cameraState.robots.get(robotId) || {
        positions: [],
        lastMovement: currentTime
      };
      
      // Add current position
      robotState.positions.push({
        position,
        timestamp: currentTime
      });
      
      // Keep only recent positions (last 30 seconds)
      robotState.positions = robotState.positions.filter(
        p => currentTime - p.timestamp < 30000
      );
      
      // Check if robot is stuck
      if (robotState.positions.length >= 5) {
        const movements = this.calculateMovements(robotState.positions);
        const maxMovement = Math.max(...movements);
        
        if (maxMovement < 5) { // Less than 5 pixels movement
          const stuckDuration = currentTime - robotState.lastMovement;
          
          if (stuckDuration > 15000) { // Stuck for more than 15 seconds
            events.push({
              id: uuidv4(),
              type: EVENT_TYPES.ROBOT_STUCK,
              timestamp: frameData.timestamp,
              cameraId: frameData.cameraId,
              robotId: robotId,
              confidence: 0.8,
              priority: EVENT_PRIORITIES.HIGH,
              description: `Robot ${robotId} appears to be stuck`,
              metadata: {
                stuckDuration: stuckDuration,
                lastPosition: position,
                movementHistory: movements
              },
              status: 'pending'
            });
          }
        } else {
          robotState.lastMovement = currentTime;
        }
      }
      
      cameraState.robots.set(robotId, robotState);
    }
    
    this.robotStates.set(frameData.cameraId, cameraState);
    
    return events;
  }

  /**
   * Check for performance anomalies
   */
  async checkPerformanceAnomalies(analysis, frameData) {
    const events = [];
    
    // Extract performance metrics from analysis
    const metrics = this.extractPerformanceMetrics(analysis);
    
    for (const [robotId, currentMetrics] of metrics) {
      const baseline = this.performanceBaselines.get(robotId);
      
      if (baseline) {
        const anomalies = this.detectAnomalies(currentMetrics, baseline);
        
        for (const anomaly of anomalies) {
          events.push({
            id: uuidv4(),
            type: EVENT_TYPES.PERFORMANCE_ANOMALY,
            timestamp: frameData.timestamp,
            cameraId: frameData.cameraId,
            robotId: robotId,
            confidence: anomaly.confidence,
            priority: EVENT_PRIORITIES.MEDIUM,
            description: `Performance anomaly detected: ${anomaly.type}`,
            metadata: {
              anomalyType: anomaly.type,
              currentValue: anomaly.currentValue,
              expectedValue: anomaly.expectedValue,
              deviation: anomaly.deviation
            },
            status: 'pending'
          });
        }
      } else {
        // Initialize baseline for new robot
        this.performanceBaselines.set(robotId, currentMetrics);
      }
    }
    
    return events;
  }

  /**
   * Confirm event with multiple frames
   */
  async confirmEvent(event) {
    const key = `${event.type}-${event.robotId || event.cameraId}`;
    
    // Get pending confirmations for this event type
    let pending = this.pendingEvents.get(key);
    
    if (!pending) {
      pending = {
        events: [],
        firstSeen: Date.now()
      };
      this.pendingEvents.set(key, pending);
    }
    
    pending.events.push(event);
    
    // Check if we have enough confirmations
    const requiredFrames = this.confirmationFrames[event.type] || 1;
    
    if (pending.events.length >= requiredFrames) {
      // Calculate average confidence
      const avgConfidence = pending.events.reduce((sum, e) => sum + e.confidence, 0) / pending.events.length;
      
      // Create confirmed event
      const confirmedEvent = {
        ...event,
        id: uuidv4(),
        confidence: avgConfidence,
        status: 'confirmed',
        confirmations: pending.events.length,
        metadata: {
          ...event.metadata,
          firstSeen: pending.firstSeen,
          confirmationTime: Date.now() - pending.firstSeen
        }
      };
      
      // Clear pending events
      this.pendingEvents.delete(key);
      
      // Store in confirmed events
      this.confirmedEvents.set(confirmedEvent.id, confirmedEvent);
      
      // Update statistics
      this.updateStatistics(confirmedEvent);
      
      return confirmedEvent;
    }
    
    // Clean up old pending events (older than 10 seconds)
    if (Date.now() - pending.firstSeen > 10000) {
      this.pendingEvents.delete(key);
      this.stats.falsePositives++;
    }
    
    return null;
  }

  /**
   * Emit confirmed event
   */
  emitEvent(event) {
    logger.info(`Event confirmed: ${event.type}`, {
      id: event.id,
      confidence: event.confidence,
      robotId: event.robotId
    });
    
    // Add to history
    this.eventHistory.push(event);
    
    // Keep only recent history (last 1000 events)
    if (this.eventHistory.length > 1000) {
      this.eventHistory.shift();
    }
    
    // Emit event
    this.emit('event', event);
  }

  /**
   * Helper functions
   */
  
  mapDetectionToEventType(detectionType) {
    const mapping = {
      'robot_tipped': EVENT_TYPES.ROBOT_TIPPED,
      'collision': EVENT_TYPES.COLLISION_DETECTED,
      'robot_stuck': EVENT_TYPES.ROBOT_STUCK,
      'task_completed': EVENT_TYPES.TASK_COMPLETED,
      'safety': EVENT_TYPES.SAFETY_CONCERN,
      'human_in_area': EVENT_TYPES.HUMAN_IN_AREA,
      'high_activity': EVENT_TYPES.HIGH_ACTIVITY,
      'low_activity': EVENT_TYPES.LOW_ACTIVITY
    };
    
    return mapping[detectionType] || detectionType;
  }
  
  determineEventPriority(type, confidence) {
    if (type === 'robot_tipped' || type === 'collision') {
      return EVENT_PRIORITIES.CRITICAL;
    }
    
    if (type === 'robot_stuck') {
      return EVENT_PRIORITIES.HIGH;
    }
    
    if (type === 'safety') {
      return confidence > 0.9 ? EVENT_PRIORITIES.CRITICAL : EVENT_PRIORITIES.HIGH;
    }
    
    if (type === 'zone_violation') {
      return EVENT_PRIORITIES.MEDIUM;
    }
    
    return EVENT_PRIORITIES.LOW;
  }
  
  generateEventDescription(type, analysis) {
    const summary = analysis.summary || analysis.content;
    
    const descriptions = {
      'robot_tipped': `Robot tipped over detected. ${summary}`,
      'collision': `Collision detected between robots. ${summary}`,
      'robot_stuck': `Robot appears to be stuck. ${summary}`,
      'task_completed': `Task completion detected. ${summary}`,
      'safety': `Safety concern identified. ${summary}`
    };
    
    return descriptions[type] || summary;
  }
  
  extractRobotId(content) {
    // Try to extract robot ID from analysis content
    const match = content.match(/robot[- ]?(\d+|[A-Z]+)/i);
    if (match) {
      return `robot-${match[1]}`;
    }
    return null;
  }
  
  identifyZone(frameData, analysis) {
    // This would need actual position mapping in production
    // For now, return first zone if mentioned
    for (const zone of this.zones) {
      if (analysis.content.toLowerCase().includes(zone.name.toLowerCase())) {
        return zone;
      }
    }
    return null;
  }
  
  detectZoneViolation(zone, analysis, frameData) {
    // Check if robots are violating zone rules
    const content = analysis.content.toLowerCase();
    const zoneName = zone.name.toLowerCase();
    
    if (zone.type === 'restricted' && content.includes(zoneName)) {
      if (content.includes('robot') && (content.includes('in') || content.includes('enter'))) {
        return {
          type: 'restricted_entry',
          confidence: 0.8,
          robotsInZone: 1
        };
      }
    }
    
    return null;
  }
  
  extractRobotPositions(frameData) {
    // This would need actual computer vision in production
    // Mock implementation for demonstration
    const positions = new Map();
    
    // For now, generate mock positions
    positions.set('robot-001', { x: 100, y: 200 });
    positions.set('robot-002', { x: 300, y: 400 });
    
    return positions;
  }
  
  calculateMovements(positions) {
    const movements = [];
    
    for (let i = 1; i < positions.length; i++) {
      const prev = positions[i - 1].position;
      const curr = positions[i].position;
      
      const distance = Math.sqrt(
        Math.pow(curr.x - prev.x, 2) + 
        Math.pow(curr.y - prev.y, 2)
      );
      
      movements.push(distance);
    }
    
    return movements;
  }
  
  extractPerformanceMetrics(analysis) {
    // Extract performance metrics from analysis
    const metrics = new Map();
    
    // Mock implementation - would need actual parsing
    metrics.set('robot-001', {
      speed: 0.5,
      efficiency: 0.85,
      taskTime: 120
    });
    
    return metrics;
  }
  
  detectAnomalies(current, baseline) {
    const anomalies = [];
    
    // Check speed anomaly
    if (Math.abs(current.speed - baseline.speed) > baseline.speed * 0.3) {
      anomalies.push({
        type: 'speed_anomaly',
        currentValue: current.speed,
        expectedValue: baseline.speed,
        deviation: (current.speed - baseline.speed) / baseline.speed,
        confidence: 0.75
      });
    }
    
    // Check efficiency drop
    if (current.efficiency < baseline.efficiency * 0.8) {
      anomalies.push({
        type: 'efficiency_drop',
        currentValue: current.efficiency,
        expectedValue: baseline.efficiency,
        deviation: (baseline.efficiency - current.efficiency) / baseline.efficiency,
        confidence: 0.7
      });
    }
    
    return anomalies;
  }
  
  updateStatistics(event) {
    this.stats.eventsDetected++;
    this.stats.eventsConfirmed++;
    
    if (!this.stats.eventsByType[event.type]) {
      this.stats.eventsByType[event.type] = 0;
    }
    this.stats.eventsByType[event.type]++;
  }
  
  /**
   * Public methods
   */
  
  setZones(zones) {
    this.zones = zones;
    logger.info(`Updated zones: ${zones.length} zones configured`);
  }
  
  getStatistics() {
    return {
      ...this.stats,
      pendingEvents: this.pendingEvents.size,
      confirmedEvents: this.confirmedEvents.size,
      historySize: this.eventHistory.length
    };
  }
  
  getRecentEvents(limit = 10) {
    return this.eventHistory.slice(-limit);
  }
  
  getEventById(eventId) {
    return this.confirmedEvents.get(eventId);
  }
  
  clearHistory() {
    this.eventHistory = [];
    this.confirmedEvents.clear();
    this.recentEventCounts.clear();
    logger.info('Event history cleared');
  }
  
  /**
   * Check for duplicate events (deduplication)
   */
  isDuplicateEvent(event) {
    const key = `${event.type}-${event.robotId || 'all'}-${event.zoneId || 'none'}`;
    const now = Date.now();
    
    // Get recent events of this type
    const recentCount = this.recentEventCounts.get(key) || { count: 0, lastSeen: 0, firstSeen: 0 };
    
    // If it's been more than 30 seconds, reset the count
    if (now - recentCount.lastSeen > 30000) {
      recentCount.count = 0;
      recentCount.firstSeen = now;
    }
    
    // Increment count
    recentCount.count++;
    recentCount.lastSeen = now;
    
    // Store updated count
    this.recentEventCounts.set(key, recentCount);
    
    // Add count to event metadata
    event.metadata = event.metadata || {};
    event.metadata.occurrenceCount = recentCount.count;
    event.metadata.firstOccurrence = recentCount.firstSeen;
    
    // Only report every 5th occurrence after the first
    if (recentCount.count > 1 && recentCount.count % 5 !== 0) {
      return true; // It's a duplicate, skip it
    }
    
    return false;
  }
  
  /**
   * Check activity level and generate events
   */
  checkActivityLevel(detections, analysis) {
    const now = Date.now();
    
    // Only check every 5 seconds
    if (now - this.lastActivityCheck < 5000) {
      return null;
    }
    
    this.lastActivityCheck = now;
    
    // Count active detections
    const activeDetections = detections.filter(d =>
      d.type === 'robot_stuck' ||
      d.type === 'robot_tipped' ||
      d.type === 'collision' ||
      d.type === 'human_in_area'
    ).length;
    
    // Determine activity level
    let newActivityLevel = 'normal';
    if (activeDetections >= 3 || detections.some(d => d.type === 'human_in_area')) {
      newActivityLevel = 'high';
    } else if (activeDetections === 0 && detections.length < 2) {
      newActivityLevel = 'low';
    }
    
    // Generate event if activity level changed
    if (newActivityLevel !== this.activityLevel) {
      const previousLevel = this.activityLevel;
      this.activityLevel = newActivityLevel;
      
      if (newActivityLevel === 'high') {
        return {
          id: uuidv4(),
          type: EVENT_TYPES.HIGH_ACTIVITY,
          timestamp: new Date().toISOString(),
          priority: EVENT_PRIORITIES.HIGH,
          description: `Activity level increased from ${previousLevel} to HIGH`,
          metadata: {
            previousLevel,
            newLevel: newActivityLevel,
            activeDetections,
            trigger: 'activity_monitor'
          }
        };
      } else if (previousLevel === 'high' && newActivityLevel === 'normal') {
        return {
          id: uuidv4(),
          type: EVENT_TYPES.LOW_ACTIVITY,
          timestamp: new Date().toISOString(),
          priority: EVENT_PRIORITIES.INFO,
          description: `Activity level decreased to normal`,
          metadata: {
            previousLevel,
            newLevel: newActivityLevel,
            activeDetections,
            trigger: 'activity_monitor'
          }
        };
      }
    }
    
    return null;
  }
  
  /**
   * Get current activity level
   */
  getActivityLevel() {
    return this.activityLevel;
  }
  
  /**
   * Get event counts for deduplication display
   */
  getEventCounts() {
    const counts = {};
    for (const [key, data] of this.recentEventCounts) {
      if (Date.now() - data.lastSeen < 30000) { // Only show recent counts
        counts[key] = data.count;
      }
    }
    return counts;
  }
}

module.exports = EventDetector;