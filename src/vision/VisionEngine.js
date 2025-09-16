/**
 * Vision Engine - Multi-model vision system with support for SmolVLM, LLaVA, and custom models
 */

const axios = require('axios');
const EventEmitter = require('events');
const winston = require('winston');
const fs = require('fs').promises;
const path = require('path');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.simple(),
  transports: [new winston.transports.Console()]
});

class VisionEngine extends EventEmitter {
  constructor(config = {}) {
    super();
    this.baseUrl = config.base_url || config.baseUrl || 'http://localhost:8080';
    // Use /completion for llama.cpp, /v1/chat/completions for OpenAI-compatible
    this.apiPath = config.api_path || '/completion';
    this.timeout = config.timeout || 30000;
    this.maxRetries = config.max_retries || 3;
    this.retryDelay = config.retry_delay || 1000;
    
    // Multi-model configuration
    this.models = {};
    this.currentModel = config.model || 'smolvlm-500m';
    this.hardwareProfile = config.hardware_profile || this.detectHardware();
    
    // Model-specific settings (will be loaded from models.json)
    this.model = this.currentModel;
    this.maxTokens = config.max_tokens || 150;
    this.temperature = config.temperature || 0.7;
    
    // Cache for recent analyses
    this.cache = new Map();
    this.cacheTimeout = config.cache_timeout || 5000;
    
    // Request queue
    this.requestQueue = [];
    this.processing = false;
    this.maxConcurrent = config.max_concurrent || 3;
    this.activeRequests = 0;
    
    // Performance tracking
    this.performance = new Map();
    
    // Prompt templates (will be model-specific)
    this.promptTemplates = {};
    
    this.status = 'initialized';
    
    // Load model configurations
    this.loadModelConfigurations().then(() => {
      logger.info(`Vision Engine initialized with model: ${this.currentModel} on ${this.hardwareProfile}`);
    });
  }

  /**
   * Load model configurations from file
   */
  async loadModelConfigurations() {
    try {
      const configPath = path.join(process.cwd(), 'config', 'models.json');
      const configData = await fs.readFile(configPath, 'utf8');
      const config = JSON.parse(configData);
      
      this.models = config.models;
      this.hardwareProfiles = config.hardware_profiles;
      
      // Initialize prompt templates for each model
      this.initializePromptTemplates();
      
      // Set current model parameters
      this.updateModelParameters(this.currentModel);
      
    } catch (error) {
      logger.error('Failed to load model configurations:', error);
      // Use default configuration
      this.useDefaultConfiguration();
    }
  }

  /**
   * Initialize model-specific prompt templates
   */
  initializePromptTemplates() {
    // Base templates
    const baseTemplates = {
      general: "Analyze this overhead robot pen image. Report: 1) Total number of robots visible. 2) Any robots that are tipped over, fallen, or lying on their side. 3) Any humans in the frame. 4) Any robots that appear stuck or not moving. 5) Any collisions or safety issues.",
      
      robot_status: "Examine each robot in the image carefully. For each robot: 1) Is it upright or fallen/tipped? 2) Is it moving or stationary? 3) What is its orientation?",
      
      robot_tipped: "CRITICAL: Look for any robots that are NOT upright. Check for robots that are: 1) Tipped over 2) Lying on their side 3) Upside down 4) Fallen in any way. Answer YES or NO first, then describe each fallen robot's position and location.",
      
      robot_stuck: "Identify robots that appear stuck or immobile. Look for: 1) Robots against walls 2) Robots in corners 3) Robots that seem unable to move 4) Robots in the same position as before.",
      
      human_detection: "IMPORTANT: Are there any humans visible in this image? Look for: 1) People standing or walking 2) Human body parts (legs, arms, torso) 3) Human shadows or reflections. Answer YES or NO first, then describe the location and what the person is doing.",
      
      collision: "Check for robot collisions or near-collisions. Look for: 1) Robots touching each other 2) Robots very close together 3) Robots hitting walls or obstacles.",
      
      task_completion: "Observe robot activities. Are any robots: 1) Carrying objects 2) Completing pick/place tasks 3) Moving with purpose?",
      
      zone_check: "Analyze robot positions relative to any marked zones. Report: 1) Which robots are in which zones 2) Any robots outside designated areas 3) Zone violations.",
      
      safety: "SAFETY CHECK: Identify all safety concerns including: 1) Fallen robots 2) Humans in danger zones 3) Collision risks 4) Blocked exits 5) Any hazardous conditions.",
      
      performance: "Evaluate robot fleet performance. Look for: 1) Smooth coordinated movement 2) Erratic behavior 3) Efficiency issues 4) Traffic jams.",
      
      count: "Count EXACTLY how many robots are visible in this image. Double-check your count. Provide the number only.",
      
      activity_level: "Rate the activity level in this image: 1) HIGH - Multiple robots moving, tasks in progress 2) MEDIUM - Some movement 3) LOW - Little to no movement."
    };
    
    // Create model-specific versions
    this.promptTemplates = {};
    
    for (const [modelId, modelConfig] of Object.entries(this.models)) {
      this.promptTemplates[modelId] = {};
      const style = modelConfig.prompts?.style || 'detailed';
      const prefix = modelConfig.prompts?.prefix || '';
      
      for (const [promptType, basePrompt] of Object.entries(baseTemplates)) {
        let finalPrompt = prefix + basePrompt;
        
        // Adjust based on model style
        if (style === 'concise') {
          finalPrompt = finalPrompt.replace(/\. /g, ', ').slice(0, -1) + '.';
        } else if (style === 'comprehensive') {
          finalPrompt += ' Be thorough and detailed in your analysis.';
        } else if (style === 'robot-focused') {
          finalPrompt = finalPrompt.replace(/humans?|people/gi, 'non-robot objects');
        }
        
        this.promptTemplates[modelId][promptType] = finalPrompt;
      }
    }
  }

  /**
   * Use default configuration if models.json not found
   */
  useDefaultConfiguration() {
    this.models = {
      'smolvlm-500m': {
        id: 'smolvlm-500m',
        name: 'SmolVLM 500M',
        parameters: {
          max_tokens: 150,
          temperature: 0.7,
          ctx_size: 2048
        }
      }
    };
    
    this.promptTemplates = {
      'smolvlm-500m': {
        general: "Analyze this overhead robot pen image. Report: 1) Total number of robots visible. 2) Any robots that are tipped over, fallen, or lying on their side. 3) Any humans in the frame. 4) Any robots that appear stuck or not moving. 5) Any collisions or safety issues. Be specific and detailed."
      }
    };
  }

  /**
   * Detect hardware profile
   */
  detectHardware() {
    const platform = process.platform;
    const arch = process.arch;
    
    if (platform === 'darwin' && arch === 'arm64') {
      return 'm4'; // Apple Silicon
    } else if (platform === 'linux' && arch === 'arm64') {
      // Check for Xavier
      try {
        const tegra = require('fs').readFileSync('/etc/nv_tegra_release', 'utf8');
        if (tegra.includes('Xavier')) {
          return 'xavier';
        }
      } catch (e) {
        // Not Xavier
      }
    }
    
    return 'cpu'; // Default
  }

  /**
   * Switch to a different model
   */
  async switchModel(modelId) {
    if (!this.models[modelId]) {
      throw new Error(`Model ${modelId} not found`);
    }
    
    const oldModel = this.currentModel;
    this.currentModel = modelId;
    this.updateModelParameters(modelId);
    
    logger.info(`Switched from ${oldModel} to ${modelId}`);
    this.emit('model-switched', { from: oldModel, to: modelId });
    
    return this.models[modelId];
  }

  /**
   * Update model parameters
   */
  updateModelParameters(modelId) {
    const modelConfig = this.models[modelId];
    if (!modelConfig) return;
    
    this.model = modelConfig.endpoints?.api?.model || modelId;
    this.maxTokens = modelConfig.parameters?.max_tokens || 150;
    this.temperature = modelConfig.parameters?.temperature || 0.7;
    
    // Update hardware-specific settings
    const hwProfile = this.hardwareProfiles?.[this.hardwareProfile];
    if (hwProfile) {
      this.maxConcurrent = hwProfile.batch_size ? Math.floor(hwProfile.batch_size / 100) : 3;
    }
  }

  /**
   * Get current model info
   */
  getCurrentModel() {
    return {
      id: this.currentModel,
      config: this.models[this.currentModel],
      performance: this.getModelPerformance(this.currentModel)
    };
  }

  /**
   * Get model performance metrics
   */
  getModelPerformance(modelId = null) {
    const id = modelId || this.currentModel;
    const perf = this.performance.get(id) || {
      totalRequests: 0,
      avgProcessingTime: 0,
      avgAccuracy: 0,
      errors: 0
    };
    return perf;
  }

  /**
   * Update performance metrics
   */
  updatePerformance(modelId, metrics) {
    const perf = this.performance.get(modelId) || {
      totalRequests: 0,
      totalProcessingTime: 0,
      avgProcessingTime: 0,
      avgAccuracy: 0,
      errors: 0
    };
    
    perf.totalRequests++;
    if (metrics.processingTime) {
      perf.totalProcessingTime += metrics.processingTime;
      perf.avgProcessingTime = perf.totalProcessingTime / perf.totalRequests;
    }
    if (metrics.error) {
      perf.errors++;
    }
    if (metrics.accuracy !== undefined) {
      perf.avgAccuracy = ((perf.avgAccuracy * (perf.totalRequests - 1)) + metrics.accuracy) / perf.totalRequests;
    }
    
    this.performance.set(modelId, perf);
  }

  /**
   * Analyze a frame with a specific prompt
   */
  async analyzeFrame(frameData, promptType = 'general', options = {}) {
    // Allow model override for testing
    const modelId = options.model || this.currentModel;
    const prompts = this.promptTemplates[modelId] || this.promptTemplates[this.currentModel];
    const prompt = prompts[promptType] || promptType;
    
    // Check cache (include model in cache key)
    const cacheKey = this.getCacheKey(frameData.cameraId, promptType, modelId);
    const cached = this.getFromCache(cacheKey);
    if (cached) {
      logger.debug(`Using cached analysis for ${frameData.cameraId} with ${modelId}`);
      return cached;
    }
    
    // Add to queue
    return new Promise((resolve, reject) => {
      this.requestQueue.push({
        frameData,
        prompt,
        promptType,
        modelId,
        resolve,
        reject,
        retries: 0
      });
      
      this.processQueue();
    });
  }

  /**
   * Compare multiple models on the same frame
   */
  async compareModels(frameData, promptType = 'general', modelIds = null) {
    const modelsToTest = modelIds || Object.keys(this.models);
    const results = {};
    
    for (const modelId of modelsToTest) {
      try {
        logger.info(`Testing model: ${modelId}`);
        const startTime = Date.now();
        
        const analysis = await this.analyzeFrame(frameData, promptType, { model: modelId });
        
        results[modelId] = {
          analysis,
          processingTime: Date.now() - startTime,
          success: true
        };
      } catch (error) {
        results[modelId] = {
          error: error.message,
          success: false
        };
      }
    }
    
    return results;
  }

  /**
   * Analyze frame with multiple prompts
   */
  async analyzeMultiple(frameData, promptTypes) {
    const analyses = {};
    
    // Always include human detection and safety checks
    const essentialPrompts = ['human_detection', 'robot_tipped', 'safety'];
    const allPrompts = [...new Set([...promptTypes, ...essentialPrompts])];
    
    for (const promptType of allPrompts) {
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
    const { frameData, prompt, promptType, modelId, retries } = request;
    const startTime = Date.now();
    
    try {
      const imageBase64 = frameData.image.startsWith('data:') 
        ? frameData.image 
        : `data:image/jpeg;base64,${frameData.image}`;
      
      // Get model-specific settings
      const modelConfig = this.models[modelId] || this.models[this.currentModel];
      const modelName = modelConfig?.endpoints?.api?.model || modelId;
      const maxTokens = modelConfig?.parameters?.max_tokens || this.maxTokens;
      const temperature = modelConfig?.parameters?.temperature || this.temperature;
      
      // For llama.cpp, use the correct format
      const isLlamaCpp = this.apiPath === '/completion';
      
      let requestBody;
      if (isLlamaCpp) {
        // Extract base64 data without the data URL prefix
        const base64Data = imageBase64.replace(/^data:image\/[a-z]+;base64,/, '');
        
        requestBody = {
          prompt: prompt,
          image_data: [{
            data: base64Data,
            id: 1
          }],
          n_predict: maxTokens,
          temperature: temperature,
          cache_prompt: true,
          slot_id: -1
        };
      } else {
        // OpenAI format
        requestBody = {
          model: modelName,
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
          max_tokens: maxTokens,
          temperature: temperature
        };
      }
      
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
      
      let content;
      if (this.apiPath === '/completion') {
        // llama.cpp format
        if (!response.data || !response.data.content) {
          throw new Error('Invalid llama.cpp response structure');
        }
        content = response.data.content;
      } else {
        // OpenAI format
        if (!response.data || !response.data.choices || !response.data.choices[0]) {
          throw new Error('Invalid API response structure');
        }
        content = response.data.choices[0].message.content;
      }
      
      const analysis = {
        promptType,
        content,
        timestamp: frameData.timestamp,
        cameraId: frameData.cameraId,
        processingTime,
        modelId,
        confidence: this.extractConfidence(content),
        detections: this.extractDetections(content, promptType),
        summary: this.generateSummary(content, promptType)
      };
      
      // Cache the result
      const cacheKey = this.getCacheKey(frameData.cameraId, promptType, modelId);
      this.addToCache(cacheKey, analysis);
      
      // Update performance metrics
      this.updatePerformance(modelId, {
        processingTime,
        accuracy: analysis.confidence
      });
      
      this.status = 'online';
      
      return analysis;
      
    } catch (error) {
      logger.error(`Vision API error for ${modelId} (attempt ${retries + 1}):`, error.message);
      
      // Update performance metrics
      this.updatePerformance(modelId, {
        processingTime: Date.now() - startTime,
        error: true
      });
      
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
      const tippedKeywords = ['tipped', 'fallen', 'fall', 'lying', 'sideways', 'upside down', 'not upright', 'on its side', 'toppled'];
      const negativeKeywords = ['not tipped', 'no robots tipped', 'all upright', 'none fallen'];
      
      const hasNegative = negativeKeywords.some(keyword => contentLower.includes(keyword));
      const hasTipped = !hasNegative && tippedKeywords.some(keyword => contentLower.includes(keyword));
      
      if (hasTipped || contentLower.includes('yes') && promptType === 'robot_tipped') {
        detections.push({
          type: 'robot_tipped',
          detected: true,
          confidence: this.extractConfidence(content),
          details: content
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
    if (promptType === 'robot_stuck' || promptType === 'general') {
      const stuckKeywords = ['stuck', 'stationary', 'not moving', 'immobile', 'frozen', 'motionless', 'idle'];
      const isStuck = stuckKeywords.some(keyword => contentLower.includes(keyword));
      
      if (isStuck) {
        detections.push({
          type: 'robot_stuck',
          detected: true,
          confidence: this.extractConfidence(content),
          details: content
        });
      }
    }
    
    // Human detection
    if (promptType === 'human_detection' || promptType === 'general' || promptType === 'safety') {
      const humanKeywords = ['human', 'person', 'people', 'man', 'woman', 'someone', 'worker', 'operator'];
      const hasHuman = humanKeywords.some(keyword => contentLower.includes(keyword));
      
      if (hasHuman || (contentLower.includes('yes') && promptType === 'human_detection')) {
        detections.push({
          type: 'human_in_area',
          detected: true,
          confidence: this.extractConfidence(content),
          priority: 'high',
          details: content
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
  getCacheKey(cameraId, promptType, modelId = null) {
    const model = modelId || this.currentModel;
    return `${cameraId}-${promptType}-${model}`;
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
    const stats = {
      queueLength: this.requestQueue.length,
      activeRequests: this.activeRequests,
      cacheSize: this.cache.size,
      status: this.status,
      currentModel: this.currentModel,
      hardwareProfile: this.hardwareProfile,
      models: {}
    };
    
    // Add per-model performance stats
    for (const [modelId, perf] of this.performance) {
      stats.models[modelId] = perf;
    }
    
    return stats;
  }

  /**
   * Get available models for current hardware
   */
  getAvailableModels() {
    const available = [];
    const hwProfile = this.hardwareProfiles?.[this.hardwareProfile];
    
    for (const [modelId, modelConfig] of Object.entries(this.models)) {
      // Check if model is compatible with hardware
      if (modelConfig.hardware?.includes(this.hardwareProfile) ||
          modelConfig.hardware?.includes('cpu')) {
        available.push({
          id: modelId,
          name: modelConfig.name,
          description: modelConfig.description,
          performance: modelConfig.performance,
          recommended: hwProfile?.recommended_models?.includes(modelId)
        });
      }
    }
    
    return available;
  }

  /**
   * Optimize settings for current hardware
   */
  optimizeForHardware() {
    const hwProfile = this.hardwareProfiles?.[this.hardwareProfile];
    if (!hwProfile) return;
    
    // Select best model for hardware
    if (hwProfile.recommended_models?.length > 0) {
      const recommendedModel = hwProfile.recommended_models[0];
      if (this.models[recommendedModel]) {
        this.switchModel(recommendedModel);
      }
    }
    
    // Apply hardware optimizations
    if (hwProfile.optimizations) {
      logger.info(`Applying ${this.hardwareProfile} optimizations:`, hwProfile.optimizations);
    }
  }
}

module.exports = VisionEngine;