const EventEmitter = require('events');
const logger = require('../utils/logger');

/**
 * ModelSelector - Manages model selection and switching for the vision system
 */
class ModelSelector extends EventEmitter {
  constructor(visionEngine) {
    super();
    this.visionEngine = visionEngine;
    this.currentModel = visionEngine.getCurrentModel();
    this.availableModels = [];
    this.benchmarkResults = new Map();
    this.isBenchmarking = false;
    
    // Initialize available models
    this.refreshAvailableModels();
    
    // Listen for model switches
    visionEngine.on('model-switched', (data) => {
      this.currentModel = visionEngine.getCurrentModel();
      this.emit('model-changed', data);
    });
  }

  /**
   * Refresh the list of available models
   */
  refreshAvailableModels() {
    this.availableModels = this.visionEngine.getAvailableModels();
    return this.availableModels;
  }

  /**
   * Get current model information
   */
  getCurrentModel() {
    return this.currentModel;
  }

  /**
   * Get all available models
   */
  getAvailableModels() {
    return this.availableModels;
  }

  /**
   * Switch to a different model
   */
  async switchModel(modelId) {
    try {
      logger.info(`Switching to model: ${modelId}`);
      const result = await this.visionEngine.switchModel(modelId);
      this.currentModel = this.visionEngine.getCurrentModel();
      
      this.emit('model-switched', {
        modelId,
        model: result,
        success: true
      });
      
      return { success: true, model: result };
    } catch (error) {
      logger.error(`Failed to switch model: ${error.message}`);
      this.emit('model-switch-failed', {
        modelId,
        error: error.message
      });
      
      return { success: false, error: error.message };
    }
  }

  /**
   * Benchmark a single model
   */
  async benchmarkModel(modelId, testFrame) {
    const results = {
      modelId,
      timestamp: new Date().toISOString(),
      tests: {}
    };
    
    const testPrompts = [
      'general',
      'robot_tipped', 
      'human_detection',
      'count',
      'activity_level'
    ];
    
    for (const promptType of testPrompts) {
      try {
        const startTime = Date.now();
        const analysis = await this.visionEngine.analyzeFrame(
          testFrame, 
          promptType, 
          { model: modelId }
        );
        
        results.tests[promptType] = {
          success: true,
          processingTime: Date.now() - startTime,
          confidence: analysis.confidence,
          resultLength: analysis.content.length
        };
      } catch (error) {
        results.tests[promptType] = {
          success: false,
          error: error.message
        };
      }
    }
    
    // Calculate average metrics
    const successfulTests = Object.values(results.tests).filter(t => t.success);
    results.avgProcessingTime = successfulTests.length > 0
      ? successfulTests.reduce((sum, t) => sum + t.processingTime, 0) / successfulTests.length
      : 0;
    results.avgConfidence = successfulTests.length > 0
      ? successfulTests.reduce((sum, t) => sum + (t.confidence || 0), 0) / successfulTests.length
      : 0;
    results.successRate = successfulTests.length / testPrompts.length;
    
    this.benchmarkResults.set(modelId, results);
    return results;
  }

  /**
   * Benchmark all available models
   */
  async benchmarkAllModels(testFrame) {
    if (this.isBenchmarking) {
      throw new Error('Benchmark already in progress');
    }
    
    this.isBenchmarking = true;
    this.emit('benchmark-started');
    
    const results = {};
    
    try {
      for (const model of this.availableModels) {
        logger.info(`Benchmarking model: ${model.id}`);
        this.emit('benchmark-progress', {
          current: model.id,
          total: this.availableModels.length
        });
        
        const benchmarkResult = await this.benchmarkModel(model.id, testFrame);
        results[model.id] = benchmarkResult;
      }
      
      // Find best performing model
      let bestModel = null;
      let bestScore = -1;
      
      for (const [modelId, result] of Object.entries(results)) {
        // Score based on speed, accuracy, and success rate
        const score = (result.successRate * 0.4) + 
                     ((1000 / result.avgProcessingTime) * 0.3) +
                     (result.avgConfidence * 0.3);
        
        if (score > bestScore) {
          bestScore = score;
          bestModel = modelId;
        }
      }
      
      this.emit('benchmark-completed', {
        results,
        bestModel,
        bestScore
      });
      
      return {
        results,
        bestModel,
        recommendation: `${bestModel} performed best with score: ${bestScore.toFixed(3)}`
      };
      
    } finally {
      this.isBenchmarking = false;
    }
  }

  /**
   * Get benchmark results for a model
   */
  getBenchmarkResults(modelId = null) {
    if (modelId) {
      return this.benchmarkResults.get(modelId);
    }
    
    // Return all results
    const allResults = {};
    for (const [id, results] of this.benchmarkResults) {
      allResults[id] = results;
    }
    return allResults;
  }

  /**
   * Compare two models
   */
  async compareModels(modelId1, modelId2, testFrame) {
    const [result1, result2] = await Promise.all([
      this.benchmarkModel(modelId1, testFrame),
      this.benchmarkModel(modelId2, testFrame)
    ]);
    
    const comparison = {
      models: {
        [modelId1]: result1,
        [modelId2]: result2
      },
      winner: null,
      analysis: {}
    };
    
    // Compare metrics
    const metrics = ['avgProcessingTime', 'avgConfidence', 'successRate'];
    
    for (const metric of metrics) {
      const val1 = result1[metric];
      const val2 = result2[metric];
      
      let winner = null;
      let improvement = 0;
      
      if (metric === 'avgProcessingTime') {
        // Lower is better for processing time
        winner = val1 < val2 ? modelId1 : modelId2;
        improvement = Math.abs((val1 - val2) / Math.max(val1, val2) * 100);
      } else {
        // Higher is better for confidence and success rate
        winner = val1 > val2 ? modelId1 : modelId2;
        improvement = Math.abs((val1 - val2) / Math.max(val1, val2) * 100);
      }
      
      comparison.analysis[metric] = {
        [modelId1]: val1,
        [modelId2]: val2,
        winner,
        improvement: `${improvement.toFixed(1)}%`
      };
    }
    
    // Determine overall winner
    const winCounts = {};
    for (const analysis of Object.values(comparison.analysis)) {
      winCounts[analysis.winner] = (winCounts[analysis.winner] || 0) + 1;
    }
    
    comparison.winner = Object.entries(winCounts)
      .sort((a, b) => b[1] - a[1])[0][0];
    
    return comparison;
  }

  /**
   * Get model performance history
   */
  getPerformanceHistory(modelId) {
    return this.visionEngine.getModelPerformance(modelId);
  }

  /**
   * Auto-select best model based on requirements
   */
  async autoSelectModel(requirements = {}) {
    const { 
      maxLatency = 1000,
      minAccuracy = 0.7,
      preferredSize = 'medium'
    } = requirements;
    
    let bestModel = null;
    let bestScore = -1;
    
    for (const model of this.availableModels) {
      const perf = this.visionEngine.getModelPerformance(model.id);
      
      // Skip if doesn't meet requirements
      if (perf.avgProcessingTime > maxLatency) continue;
      if (perf.avgAccuracy < minAccuracy) continue;
      
      // Calculate score
      let score = 0;
      
      // Latency score (lower is better)
      score += (maxLatency - perf.avgProcessingTime) / maxLatency * 0.3;
      
      // Accuracy score
      score += perf.avgAccuracy * 0.4;
      
      // Size preference score
      if (model.performance?.size === preferredSize) {
        score += 0.3;
      } else if (
        (preferredSize === 'small' && model.performance?.size === 'medium') ||
        (preferredSize === 'large' && model.performance?.size === 'medium')
      ) {
        score += 0.15;
      }
      
      if (score > bestScore) {
        bestScore = score;
        bestModel = model.id;
      }
    }
    
    if (bestModel) {
      await this.switchModel(bestModel);
      return {
        selected: bestModel,
        score: bestScore,
        reason: `Best match for requirements: max ${maxLatency}ms latency, min ${minAccuracy} accuracy`
      };
    }
    
    return {
      selected: null,
      reason: 'No model meets the specified requirements'
    };
  }

  /**
   * Export benchmark results
   */
  exportBenchmarkResults(format = 'json') {
    const results = this.getBenchmarkResults();
    
    if (format === 'json') {
      return JSON.stringify(results, null, 2);
    } else if (format === 'csv') {
      // Convert to CSV format
      const headers = ['Model', 'Avg Processing Time', 'Avg Confidence', 'Success Rate'];
      const rows = [headers];
      
      for (const [modelId, result] of Object.entries(results)) {
        rows.push([
          modelId,
          result.avgProcessingTime.toFixed(2),
          result.avgConfidence.toFixed(3),
          result.successRate.toFixed(3)
        ]);
      }
      
      return rows.map(row => row.join(',')).join('\n');
    }
    
    throw new Error(`Unsupported export format: ${format}`);
  }

  /**
   * Get model recommendations based on hardware
   */
  getRecommendations() {
    const hardware = this.visionEngine.hardwareProfile;
    const recommendations = [];
    
    for (const model of this.availableModels) {
      if (model.recommended) {
        recommendations.push({
          modelId: model.id,
          reason: `Optimized for ${hardware} hardware`,
          priority: 'high'
        });
      }
    }
    
    // Add performance-based recommendations
    const perfData = this.getBenchmarkResults();
    if (Object.keys(perfData).length > 0) {
      // Find fastest model
      let fastestModel = null;
      let fastestTime = Infinity;
      
      for (const [modelId, result] of Object.entries(perfData)) {
        if (result.avgProcessingTime < fastestTime) {
          fastestTime = result.avgProcessingTime;
          fastestModel = modelId;
        }
      }
      
      if (fastestModel) {
        recommendations.push({
          modelId: fastestModel,
          reason: `Fastest processing time: ${fastestTime.toFixed(0)}ms`,
          priority: 'medium'
        });
      }
    }
    
    return recommendations;
  }
}

module.exports = ModelSelector;