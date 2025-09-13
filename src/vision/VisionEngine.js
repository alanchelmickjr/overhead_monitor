/**
 * Vision Engine - Interfaces with SmolVLM API for frame analysis
 */

const axios = require('axios');
const EventEmitter = require('events');
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.simple(),
  transports: [new winston.transports.Console()]
});

// Prompt templates for different detection scenarios
const PROMPT_TEMPLATES = {
  general: "Describe what you see in this robot pen monitoring image. Focus on robot positions, orientations, and any unusual conditions.",
  
  robot_status: "List all visible robots and describe their current status. Are they upright, moving, or in any abnormal position?",
  
  robot_tipped: "Examine each robot carefully. Are any robots tipped over, fallen, lying on their side, or upside down? Answer with details about which robots and their condition.",
  
  robot_stuck: "Compare robot positions. Are any robots stationary or stuck in the same position? Describe their locations.",
  
  collision: "Check for robot collisions. Are any robots touching each other or obstacles? Are they too close together?",
  
  task_completion: "Observe the robots' activities. Has any robot completed picking up or placing an object? Describe what tasks are being performed.",
  
  zone_check: "Look at the marked zones in the image. Which robots are in which zones? Are any robots outside their designated areas?",
  
  safety: "Identify any safety concerns. Are there any hazards, blocked exits, or dangerous situations visible?",
  
  performance: "Evaluate robot movement efficiency. Are robots moving smoothly and coordinately? Any erratic behavior?",
  
  count: "Count the total number of robots visible in the frame. Provide the exact count.",
  
  confidence_check: "On a scale of 0-100, rate your confidence in your observations about the robots' conditions."
};

class VisionEngine extends EventEmitter {
  constructor(config = {}) {
    super();
    this.baseUrl = config.base_url || config.baseUrl || 'http://localhost:8080';
    this.apiPath = config.api_path || '/v1/chat/completions';
    this.model = config.model || 'smolvlm-instruct';
    this.maxTokens = config.max_tokens || 150;
    this.temperature = config.temperature || 0.7;
    this.timeout = config.timeout || 30000;
    this.maxRetries = config.max_retries || 3;
    this.retryDelay = config.retry_delay || 1000;
    
    // Cache for recent analyses
    this.cache = new Map();
    this.cacheTimeout = config.cache_timeout || 5000;
    
    // Request queue
    this.requestQueue = [];
    this.processing = false;
    this.maxConcurrent = config.max_concurrent || 3;
    this.activeRequests = 0;
    
    this.status = 'initialized';
    logger.info('Vision Engine initialized');
  }

  /**
   * Analyze a frame with a specific prompt
   */
  async analyzeFrame(frameData, promptType = 'general') {
    const prompt = PROMPT_TEMPLATES[promptType] || promptType;
    
    // Check cache
    const cacheKey = this.getCacheKey(frameData.cameraId, promptType);
    const cached = this.getFromCache(cacheKey);
    if (cached) {
      logger.debug(`Using cached analysis for ${frameData.cameraId}`);
      return cached;
    }
    
    // Add to queue
    return new Promise((resolve, reject) => {
      this.requestQueue.push({
        frameData,
        prompt,
        promptType,
        resolve,
        reject,
        retries: 0
      });
      
      this.processQueue();
    });
  }

  /**
   * Analyze frame with multiple prompts
   */
  async analyzeMultiple(frameData, promptTypes) {
    const analyses = {};
    
    for (const promptType of promptTypes) {
      try {
        analyses[promptType] = await this.analyzeFrame(frameData, promptType);
      } catch (error) {
        logger.error(`Failed to analyze ${promptType}:`, error);
        analyses[promptType] = { error: error.message };
      }
    }
    
    return this.combineAnalyses(analyses);
  }

  /**
   * Process the request queue
   */
  async processQueue() {
    if (this.processing || this.requestQueue.length === 0) {
      return;
    }
    
    this.processing = true;
    
    while (this.requestQueue.length > 0 && this.activeRequests < this.maxConcurrent) {
      const request = this.requestQueue.shift();
      this.activeRequests++;
      
      this.processRequest(request)
        .then(result => {
          request.resolve(result);
        })
        .catch(error => {
          request.reject(error);
        })
        .finally(() => {
          this.activeRequests--;
          this.processQueue();
        });
    }
    
    this.processing = false;
  }

  /**
   * Process a single request
   */
  async processRequest(request) {
    const { frameData, prompt, promptType, retries } = request;
    
    try {
      const imageBase64 = frameData.image.startsWith('data:') 
        ? frameData.image 
        : `data:image/jpeg;base64,${frameData.image}`;
      
      const requestBody = {
        model: this.model,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: prompt
              },
              {
                type: 'image_url',
                image_url: {
                  url: imageBase64
                }
              }
            ]
          }
        ],
        max_tokens: this.maxTokens,
        temperature: this.temperature
      };
      
      const startTime = Date.now();
      
      const response = await axios.post(
        `${this.baseUrl}${this.apiPath}`,
        requestBody,
        {
          timeout: this.timeout,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
      
      const processingTime = Date.now() - startTime;
      
      if (!response.data || !response.data.choices || !response.data.choices[0]) {
        throw new Error('Invalid API response structure');
      }
      
      const content = response.data.choices[0].message.content;
      
      const analysis = {
        promptType,
        content,
        timestamp: frameData.timestamp,
        cameraId: frameData.cameraId,
        processingTime,
        confidence: this.extractConfidence(content),
        detections: this.extractDetections(content, promptType),
        summary: this.generateSummary(content, promptType)
      };
      
      // Cache the result
      const cacheKey = this.getCacheKey(frameData.cameraId, promptType);
      this.addToCache(cacheKey, analysis);
      
      this.status = 'online';
      
      return analysis;
      
    } catch (error) {
      logger.error(`Vision API error (attempt ${retries + 1}):`, error.message);
      
      // Retry logic
      if (retries < this.maxRetries) {
        await this.delay(this.retryDelay * Math.pow(2, retries));
        request.retries = retries + 1;
        return this.processRequest(request);
      }
      
      this.status = 'error';
      throw error;
    }
  }

  /**
   * Extract confidence score from response
   */
  extractConfidence(content) {
    // Look for confidence indicators in the response
    const confidenceMatch = content.match(/(\d+)%?\s*(confident|confidence|certain)/i);
    if (confidenceMatch) {
      return parseInt(confidenceMatch[1]) / 100;
    }
    
    // Check for confidence keywords
    const highConfidence = /very\s+(certain|confident|sure)|definitely|clearly/i;
    const mediumConfidence = /probably|likely|appears\s+to|seems/i;
    const lowConfidence = /possibly|might|unclear|uncertain/i;
    
    if (highConfidence.test(content)) return 0.9;
    if (lowConfidence.test(content)) return 0.5;
    if (mediumConfidence.test(content)) return 0.7;
    
    return 0.75; // Default confidence
  }

  /**
   * Extract specific detections from content
   */
  extractDetections(content, promptType) {
    const detections = [];
    const contentLower = content.toLowerCase();
    
    // Robot tipped detection
    if (promptType === 'robot_tipped' || promptType === 'general') {
      const tippedKeywords = ['tipped', 'fallen', 'fall', 'lying', 'sideways', 'upside down', 'not upright'];
      const hasTipped = tippedKeywords.some(keyword => contentLower.includes(keyword));
      
      if (hasTipped) {
        detections.push({
          type: 'robot_tipped',
          detected: true,
          confidence: this.extractConfidence(content)
        });
      }
    }
    
    // Collision detection
    if (promptType === 'collision' || promptType === 'general') {
      const collisionKeywords = ['collision', 'collided', 'crashed', 'hit', 'touching', 'contact'];
      const hasCollision = collisionKeywords.some(keyword => contentLower.includes(keyword));
      
      if (hasCollision) {
        detections.push({
          type: 'collision',
          detected: true,
          confidence: this.extractConfidence(content)
        });
      }
    }
    
    // Stuck robot detection
    if (promptType === 'robot_stuck') {
      const stuckKeywords = ['stuck', 'stationary', 'not moving', 'immobile', 'frozen'];
      const isStuck = stuckKeywords.some(keyword => contentLower.includes(keyword));
      
      if (isStuck) {
        detections.push({
          type: 'robot_stuck',
          detected: true,
          confidence: this.extractConfidence(content)
        });
      }
    }
    
    // Task completion detection
    if (promptType === 'task_completion') {
      const completionKeywords = ['completed', 'finished', 'picked up', 'placed', 'delivered'];
      const hasCompletion = completionKeywords.some(keyword => contentLower.includes(keyword));
      
      if (hasCompletion) {
        detections.push({
          type: 'task_completed',
          detected: true,
          confidence: this.extractConfidence(content)
        });
      }
    }
    
    // Extract robot count if mentioned
    const countMatch = content.match(/(\d+)\s*robots?\s*(visible|in\s+view|can\s+be\s+seen)/i);
    if (countMatch) {
      detections.push({
        type: 'robot_count',
        count: parseInt(countMatch[1])
      });
    }
    
    return detections;
  }

  /**
   * Generate a summary of the analysis
   */
  generateSummary(content, promptType) {
    // Extract first sentence or key information
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);
    
    if (sentences.length > 0) {
      // For specific prompt types, extract relevant info
      if (promptType === 'robot_tipped') {
        const tippedInfo = sentences.find(s => 
          /tipped|fallen|lying|sideways|upside/i.test(s)
        );
        return tippedInfo ? tippedInfo.trim() : sentences[0].trim();
      }
      
      if (promptType === 'count') {
        const countInfo = sentences.find(s => /\d+\s*robot/i.test(s));
        return countInfo ? countInfo.trim() : sentences[0].trim();
      }
      
      // Default: return first sentence
      return sentences[0].trim();
    }
    
    return content.substring(0, 100) + '...';
  }

  /**
   * Combine multiple analyses into a single result
   */
  combineAnalyses(analyses) {
    const combined = {
      timestamp: new Date().toISOString(),
      analyses: analyses,
      overallConfidence: 0,
      allDetections: [],
      summary: ''
    };
    
    let confidenceSum = 0;
    let confidenceCount = 0;
    const summaries = [];
    
    for (const [type, analysis] of Object.entries(analyses)) {
      if (analysis.error) continue;
      
      if (analysis.confidence) {
        confidenceSum += analysis.confidence;
        confidenceCount++;
      }
      
      if (analysis.detections) {
        combined.allDetections.push(...analysis.detections);
      }
      
      if (analysis.summary) {
        summaries.push(`${type}: ${analysis.summary}`);
      }
    }
    
    combined.overallConfidence = confidenceCount > 0 
      ? confidenceSum / confidenceCount 
      : 0;
    
    combined.summary = summaries.join('; ');
    
    // Deduplicate detections
    combined.allDetections = this.deduplicateDetections(combined.allDetections);
    
    return combined;
  }

  /**
   * Deduplicate detection results
   */
  deduplicateDetections(detections) {
    const seen = new Set();
    return detections.filter(detection => {
      const key = `${detection.type}-${detection.detected}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  /**
   * Cache management
   */
  getCacheKey(cameraId, promptType) {
    return `${cameraId}-${promptType}`;
  }

  getFromCache(key) {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }
    return null;
  }

  addToCache(key, data) {
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
    
    // Clean old cache entries
    this.cleanCache();
  }

  cleanCache() {
    const now = Date.now();
    for (const [key, value] of this.cache.entries()) {
      if (now - value.timestamp > this.cacheTimeout * 2) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Utility functions
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getStatus() {
    return this.status;
  }

  getStatistics() {
    return {
      queueLength: this.requestQueue.length,
      activeRequests: this.activeRequests,
      cacheSize: this.cache.size,
      status: this.status
    };
  }
}

module.exports = VisionEngine;