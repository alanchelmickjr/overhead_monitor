/**
 * Alert Manager - Handles notifications and response actions for detected events
 */

const EventEmitter = require('events');
const nodemailer = require('nodemailer');
const axios = require('axios');
const winston = require('winston');
const { v4: uuidv4 } = require('uuid');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.simple(),
  transports: [new winston.transports.Console()]
});

// Alert channels
const ALERT_CHANNELS = {
  DASHBOARD: 'dashboard',
  EMAIL: 'email',
  SMS: 'sms',
  WEBHOOK: 'webhook',
  LOG: 'log'
};

// Alert states
const ALERT_STATES = {
  PENDING: 'pending',
  SENT: 'sent',
  ACKNOWLEDGED: 'acknowledged',
  RESOLVED: 'resolved',
  FAILED: 'failed'
};

class AlertManager extends EventEmitter {
  constructor(config = {}) {
    super();
    
    // Alert configuration
    this.rules = config.rules || [];
    this.channels = config.channels || {};
    this.defaultChannels = config.default_channels || ['dashboard', 'log'];
    
    // Alert throttling
    this.throttleWindows = new Map();
    this.throttleConfig = config.throttle || {
      window: 60000, // 1 minute
      maxAlerts: 5
    };
    
    // Alert history
    this.alerts = new Map();
    this.alertHistory = [];
    this.maxHistorySize = config.max_history || 1000;
    
    // Escalation policies
    this.escalationPolicies = config.escalation_policies || [];
    this.escalationTimers = new Map();
    
    // Statistics
    this.stats = {
      alertsSent: 0,
      alertsAcknowledged: 0,
      alertsFailed: 0,
      alertsByChannel: {},
      alertsByPriority: {}
    };
    
    // Initialize channels
    this.initializeChannels();
    
    logger.info('Alert Manager initialized with ' + this.rules.length + ' rules');
  }

  /**
   * Initialize alert channels
   */
  initializeChannels() {
    // Email channel setup
    if (this.channels.email) {
      this.emailTransporter = nodemailer.createTransport({
        host: this.channels.email.smtp_host,
        port: this.channels.email.smtp_port,
        secure: this.channels.email.smtp_secure || false,
        auth: {
          user: this.channels.email.smtp_user,
          pass: this.channels.email.smtp_pass
        }
      });
      
      // Verify email configuration
      this.emailTransporter.verify((error) => {
        if (error) {
          logger.error('Email configuration error:', error);
        } else {
          logger.info('Email channel ready');
        }
      });
    }
    
    // SMS channel setup (using example service)
    if (this.channels.sms) {
      this.smsConfig = {
        apiUrl: this.channels.sms.api_url,
        apiKey: this.channels.sms.api_key,
        from: this.channels.sms.from_number
      };
    }
    
    // Webhook channel setup
    if (this.channels.webhook) {
      this.webhookConfig = {
        urls: this.channels.webhook.urls || [],
        secret: this.channels.webhook.secret
      };
    }
  }

  /**
   * Handle event from event detector
   */
  async handleEvent(event) {
    logger.debug(`Handling event: ${event.type}`, event);
    
    // Find matching rules
    const matchingRules = this.findMatchingRules(event);
    
    if (matchingRules.length === 0) {
      // Use default alert for unmatched events
      const defaultAlert = this.createDefaultAlert(event);
      await this.processAlert(defaultAlert);
    } else {
      // Process each matching rule
      for (const rule of matchingRules) {
        const alert = this.createAlertFromRule(event, rule);
        await this.processAlert(alert);
      }
    }
  }

  /**
   * Find rules matching the event
   */
  findMatchingRules(event) {
    return this.rules.filter(rule => {
      // Check event type match
      if (rule.event_type && rule.event_type !== event.type) {
        return false;
      }
      
      // Check priority match
      if (rule.min_priority) {
        const priorityLevels = ['info', 'low', 'medium', 'high', 'critical'];
        const eventLevel = priorityLevels.indexOf(event.priority);
        const ruleLevel = priorityLevels.indexOf(rule.min_priority);
        if (eventLevel < ruleLevel) {
          return false;
        }
      }
      
      // Check confidence threshold
      if (rule.min_confidence && event.confidence < rule.min_confidence) {
        return false;
      }
      
      // Check zone match
      if (rule.zones && rule.zones.length > 0) {
        if (!event.zoneId || !rule.zones.includes(event.zoneId)) {
          return false;
        }
      }
      
      // Check robot match
      if (rule.robots && rule.robots.length > 0) {
        if (!event.robotId || !rule.robots.includes(event.robotId)) {
          return false;
        }
      }
      
      // Check if rule is enabled
      if (rule.enabled === false) {
        return false;
      }
      
      return true;
    });
  }

  /**
   * Create alert from rule
   */
  createAlertFromRule(event, rule) {
    return {
      id: uuidv4(),
      eventId: event.id,
      eventType: event.type,
      priority: rule.priority || event.priority,
      title: this.formatTitle(rule.title || event.type, event),
      message: this.formatMessage(rule.message || event.description, event),
      channels: rule.channels || this.defaultChannels,
      recipients: rule.recipients || [],
      metadata: {
        event: event,
        rule: rule,
        timestamp: new Date().toISOString()
      },
      state: ALERT_STATES.PENDING,
      attempts: 0,
      maxAttempts: rule.max_attempts || 3,
      cooldown: rule.cooldown || 60,
      actions: rule.actions || []
    };
  }

  /**
   * Create default alert for unmatched events
   */
  createDefaultAlert(event) {
    return {
      id: uuidv4(),
      eventId: event.id,
      eventType: event.type,
      priority: event.priority,
      title: `${event.type.replace(/_/g, ' ').toUpperCase()} Detected`,
      message: event.description,
      channels: this.defaultChannels,
      recipients: [],
      metadata: {
        event: event,
        timestamp: new Date().toISOString()
      },
      state: ALERT_STATES.PENDING,
      attempts: 0,
      maxAttempts: 3,
      cooldown: 60,
      actions: []
    };
  }

  /**
   * Process alert
   */
  async processAlert(alert) {
    // Check throttling
    if (this.isThrottled(alert)) {
      logger.debug(`Alert throttled: ${alert.eventType}`);
      return;
    }
    
    // Store alert
    this.alerts.set(alert.id, alert);
    this.addToHistory(alert);
    
    // Send to channels
    const results = await this.sendToChannels(alert);
    
    // Update alert state
    const allSuccess = results.every(r => r.success);
    alert.state = allSuccess ? ALERT_STATES.SENT : ALERT_STATES.FAILED;
    alert.sendResults = results;
    
    // Execute actions
    if (alert.actions && alert.actions.length > 0) {
      await this.executeActions(alert);
    }
    
    // Set up escalation if needed
    if (alert.priority === 'critical' || alert.priority === 'high') {
      this.setupEscalation(alert);
    }
    
    // Emit alert event
    this.emit('alert', alert);
    
    // Update statistics
    this.updateStatistics(alert);
    
    return alert;
  }

  /**
   * Send alert to configured channels
   */
  async sendToChannels(alert) {
    const results = [];
    
    for (const channel of alert.channels) {
      try {
        let result;
        
        switch (channel) {
          case ALERT_CHANNELS.DASHBOARD:
            result = await this.sendToDashboard(alert);
            break;
          
          case ALERT_CHANNELS.EMAIL:
            result = await this.sendEmail(alert);
            break;
          
          case ALERT_CHANNELS.SMS:
            result = await this.sendSMS(alert);
            break;
          
          case ALERT_CHANNELS.WEBHOOK:
            result = await this.sendWebhook(alert);
            break;
          
          case ALERT_CHANNELS.LOG:
            result = await this.logAlert(alert);
            break;
          
          default:
            result = { success: false, error: 'Unknown channel: ' + channel };
        }
        
        results.push({ channel, ...result });
        
      } catch (error) {
        logger.error(`Failed to send alert to ${channel}:`, error);
        results.push({ 
          channel, 
          success: false, 
          error: error.message 
        });
      }
    }
    
    return results;
  }

  /**
   * Channel implementations
   */
  
  async sendToDashboard(alert) {
    // Dashboard alerts are handled via WebSocket
    // This will be implemented in WebSocketHandler
    logger.info(`Dashboard alert: ${alert.title}`);
    return { success: true };
  }
  
  async sendEmail(alert) {
    if (!this.emailTransporter) {
      return { success: false, error: 'Email not configured' };
    }
    
    const recipients = alert.recipients.filter(r => r.includes('@'));
    if (recipients.length === 0) {
      return { success: false, error: 'No email recipients' };
    }
    
    const mailOptions = {
      from: this.channels.email.from || 'robot-monitor@example.com',
      to: recipients.join(','),
      subject: `[${alert.priority.toUpperCase()}] ${alert.title}`,
      html: this.generateEmailHTML(alert),
      text: this.generateEmailText(alert)
    };
    
    const info = await this.emailTransporter.sendMail(mailOptions);
    logger.info(`Email sent: ${info.messageId}`);
    
    return { success: true, messageId: info.messageId };
  }
  
  async sendSMS(alert) {
    if (!this.smsConfig) {
      return { success: false, error: 'SMS not configured' };
    }
    
    const phoneNumbers = alert.recipients.filter(r => /^\+?[\d\s-]+$/.test(r));
    if (phoneNumbers.length === 0) {
      return { success: false, error: 'No phone recipients' };
    }
    
    const message = `${alert.title}\n${alert.message}`.substring(0, 160);
    
    const results = [];
    for (const number of phoneNumbers) {
      try {
        const response = await axios.post(this.smsConfig.apiUrl, {
          to: number,
          from: this.smsConfig.from,
          message: message
        }, {
          headers: {
            'Authorization': `Bearer ${this.smsConfig.apiKey}`
          }
        });
        
        results.push({ number, success: true, id: response.data.id });
      } catch (error) {
        results.push({ number, success: false, error: error.message });
      }
    }
    
    return { success: results.some(r => r.success), results };
  }
  
  async sendWebhook(alert) {
    if (!this.webhookConfig || this.webhookConfig.urls.length === 0) {
      return { success: false, error: 'Webhook not configured' };
    }
    
    const payload = {
      id: alert.id,
      timestamp: alert.metadata.timestamp,
      event: alert.metadata.event,
      alert: {
        title: alert.title,
        message: alert.message,
        priority: alert.priority
      }
    };
    
    // Add signature if secret is configured
    if (this.webhookConfig.secret) {
      const crypto = require('crypto');
      const signature = crypto
        .createHmac('sha256', this.webhookConfig.secret)
        .update(JSON.stringify(payload))
        .digest('hex');
      payload.signature = `sha256=${signature}`;
    }
    
    const results = [];
    for (const url of this.webhookConfig.urls) {
      try {
        const response = await axios.post(url, payload, {
          timeout: 5000
        });
        results.push({ url, success: true, status: response.status });
      } catch (error) {
        results.push({ url, success: false, error: error.message });
      }
    }
    
    return { success: results.some(r => r.success), results };
  }
  
  async logAlert(alert) {
    logger.warn(`ALERT [${alert.priority}]: ${alert.title} - ${alert.message}`);
    return { success: true };
  }

  /**
   * Execute alert actions
   */
  async executeActions(alert) {
    for (const action of alert.actions) {
      try {
        switch (action.type) {
          case 'capture_screenshot':
            logger.info('Action: Capturing screenshot for alert');
            // This would trigger screenshot capture via camera manager
            break;
          
          case 'emergency_stop':
            logger.warn('Action: Emergency stop triggered');
            // This would send stop command to robots
            break;
          
          case 'sound_alarm':
            logger.info('Action: Sounding alarm');
            // This would trigger audible alarm
            break;
          
          case 'record_video':
            logger.info('Action: Starting video recording');
            // This would start video recording
            break;
          
          default:
            logger.warn(`Unknown action type: ${action.type}`);
        }
      } catch (error) {
        logger.error(`Failed to execute action ${action.type}:`, error);
      }
    }
  }

  /**
   * Escalation handling
   */
  setupEscalation(alert) {
    const policy = this.escalationPolicies.find(p => 
      p.priority === alert.priority || p.event_type === alert.eventType
    );
    
    if (!policy) return;
    
    const escalationSteps = policy.steps || [];
    let currentStep = 0;
    
    const escalate = () => {
      if (currentStep >= escalationSteps.length) {
        return;
      }
      
      const step = escalationSteps[currentStep];
      
      // Create escalated alert
      const escalatedAlert = {
        ...alert,
        id: uuidv4(),
        channels: step.channels || alert.channels,
        recipients: [...alert.recipients, ...(step.additional_recipients || [])],
        title: `[ESCALATED] ${alert.title}`,
        escalationLevel: currentStep + 1
      };
      
      this.processAlert(escalatedAlert);
      
      currentStep++;
      
      // Schedule next escalation
      if (currentStep < escalationSteps.length) {
        const nextStep = escalationSteps[currentStep];
        const timer = setTimeout(escalate, (nextStep.delay || 300) * 1000);
        this.escalationTimers.set(alert.id, timer);
      }
    };
    
    // Start escalation timer
    const firstStep = escalationSteps[0];
    if (firstStep) {
      const timer = setTimeout(escalate, (firstStep.delay || 120) * 1000);
      this.escalationTimers.set(alert.id, timer);
    }
  }

  /**
   * Alert acknowledgment
   */
  acknowledgeAlert(alertId, userId, notes) {
    const alert = this.alerts.get(alertId);
    
    if (!alert) {
      throw new Error(`Alert ${alertId} not found`);
    }
    
    alert.state = ALERT_STATES.ACKNOWLEDGED;
    alert.acknowledgedBy = userId;
    alert.acknowledgedAt = new Date().toISOString();
    alert.acknowledgmentNotes = notes;
    
    // Cancel escalation if active
    if (this.escalationTimers.has(alertId)) {
      clearTimeout(this.escalationTimers.get(alertId));
      this.escalationTimers.delete(alertId);
    }
    
    this.stats.alertsAcknowledged++;
    
    logger.info(`Alert ${alertId} acknowledged by ${userId}`);
    
    return alert;
  }

  /**
   * Throttling
   */
  isThrottled(alert) {
    const key = `${alert.eventType}-${alert.metadata.event.robotId || 'all'}`;
    const now = Date.now();
    
    let window = this.throttleWindows.get(key);
    
    if (!window) {
      window = {
        startTime: now,
        count: 0
      };
      this.throttleWindows.set(key, window);
    }
    
    // Reset window if expired
    if (now - window.startTime > this.throttleConfig.window) {
      window.startTime = now;
      window.count = 0;
    }
    
    // Check if throttled
    if (window.count >= this.throttleConfig.maxAlerts) {
      return true;
    }
    
    window.count++;
    return false;
  }

  /**
   * Helper functions
   */
  
  formatTitle(template, event) {
    return template
      .replace('{type}', event.type)
      .replace('{robot}', event.robotId || 'Unknown')
      .replace('{zone}', event.zoneId || 'Unknown')
      .replace('{priority}', event.priority);
  }
  
  formatMessage(template, event) {
    return template
      .replace('{description}', event.description)
      .replace('{confidence}', (event.confidence * 100).toFixed(0) + '%')
      .replace('{timestamp}', event.timestamp)
      .replace('{camera}', event.cameraId);
  }
  
  generateEmailHTML(alert) {
    return `
      <html>
        <body style="font-family: Arial, sans-serif;">
          <h2 style="color: ${this.getPriorityColor(alert.priority)};">
            ${alert.title}
          </h2>
          <p>${alert.message}</p>
          <hr>
          <p><strong>Event Type:</strong> ${alert.eventType}</p>
          <p><strong>Priority:</strong> ${alert.priority}</p>
          <p><strong>Time:</strong> ${alert.metadata.timestamp}</p>
          <p><strong>Camera:</strong> ${alert.metadata.event.cameraId}</p>
          ${alert.metadata.event.robotId ? 
            `<p><strong>Robot:</strong> ${alert.metadata.event.robotId}</p>` : ''}
          ${alert.metadata.event.zoneId ? 
            `<p><strong>Zone:</strong> ${alert.metadata.event.zoneId}</p>` : ''}
          <p><strong>Confidence:</strong> ${(alert.metadata.event.confidence * 100).toFixed(0)}%</p>
          <hr>
          <p style="color: #666; font-size: 12px;">
            Alert ID: ${alert.id}<br>
            This is an automated alert from the Robot Overhead Monitor system.
          </p>
        </body>
      </html>
    `;
  }
  
  generateEmailText(alert) {
    return `
${alert.title}

${alert.message}

Event Type: ${alert.eventType}
Priority: ${alert.priority}
Time: ${alert.metadata.timestamp}
Camera: ${alert.metadata.event.cameraId}
${alert.metadata.event.robotId ? `Robot: ${alert.metadata.event.robotId}` : ''}
${alert.metadata.event.zoneId ? `Zone: ${alert.metadata.event.zoneId}` : ''}
Confidence: ${(alert.metadata.event.confidence * 100).toFixed(0)}%

Alert ID: ${alert.id}
This is an automated alert from the Robot Overhead Monitor system.
    `.trim();
  }
  
  getPriorityColor(priority) {
    const colors = {
      critical: '#dc3545',
      high: '#fd7e14',
      medium: '#ffc107',
      low: '#28a745',
      info: '#17a2b8'
    };
    return colors[priority] || '#6c757d';
  }
  
  addToHistory(alert) {
    this.alertHistory.push(alert);
    
    // Maintain max history size
    if (this.alertHistory.length > this.maxHistorySize) {
      this.alertHistory.shift();
    }
  }
  
  updateStatistics(alert) {
    this.stats.alertsSent++;
    
    // By priority
    if (!this.stats.alertsByPriority[alert.priority]) {
      this.stats.alertsByPriority[alert.priority] = 0;
    }
    this.stats.alertsByPriority[alert.priority]++;
    
    // By channel
    for (const channel of alert.channels) {
      if (!this.stats.alertsByChannel[channel]) {
        this.stats.alertsByChannel[channel] = 0;
      }
      this.stats.alertsByChannel[channel]++;
    }
  }

  /**
   * Public methods
   */
  
  getAlert(alertId) {
    return this.alerts.get(alertId);
  }
  
  getAlerts(filter = {}) {
    let alerts = Array.from(this.alerts.values());
    
    if (filter.state) {
      alerts = alerts.filter(a => a.state === filter.state);
    }
    
    if (filter.priority) {
      alerts = alerts.filter(a => a.priority === filter.priority);
    }
    
    if (filter.eventType) {
      alerts = alerts.filter(a => a.eventType === filter.eventType);
    }
    
    if (filter.limit) {
      alerts = alerts.slice(-filter.limit);
    }
    
    return alerts;
  }
  
  getStatistics() {
    return {
      ...this.stats,
      activeAlerts: this.alerts.size,
      historySize: this.alertHistory.length,
      throttledKeys: this.throttleWindows.size
    };
  }
  
  getStatus() {
    return this.alerts.size > 0 ? 'active' : 'online';
  }
  
  updateRules(rules) {
    this.rules = rules;
    logger.info(`Updated alert rules: ${rules.length} rules`);
  }
  
  clearHistory() {
    this.alertHistory = [];
    this.alerts.clear();
    logger.info('Alert history cleared');
  }
}

module.exports = AlertManager;