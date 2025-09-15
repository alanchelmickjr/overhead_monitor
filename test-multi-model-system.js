#!/usr/bin/env node

/**
 * Test script for the multi-model robot monitoring system
 * Demonstrates model switching, benchmarking, and comparison
 */

const VisionEngine = require('./src/vision/VisionEngine');
const ModelSelector = require('./src/vision/ModelSelector');
const fs = require('fs').promises;
const path = require('path');

// Initialize components
const visionEngine = new VisionEngine({
    base_url: process.env.VISION_API_URL || 'http://localhost:8080',
    api_path: '/v1/chat/completions'
});

const modelSelector = new ModelSelector(visionEngine);

// Test data
const TEST_PROMPTS = {
    robot_detection: 'general',
    fallen_robot: 'robot_tipped',
    human_safety: 'human_detection',
    performance: 'activity_level'
};

// Logging with colors
function log(message, type = 'info') {
    const colors = {
        info: '\x1b[36m',
        success: '\x1b[32m',
        warning: '\x1b[33m',
        error: '\x1b[31m',
        header: '\x1b[35m'
    };
    console.log(`${colors[type]}${message}\x1b[0m`);
}

// Create test frame data
async function createTestFrame() {
    // In real scenario, this would be camera data
    // For testing, we'll create a mock frame
    const mockImageData = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAg...'; // Truncated for brevity
    
    return {
        timestamp: new Date().toISOString(),
        cameraId: 'test-camera-01',
        data: mockImageData
    };
}

// Test 1: Display available models
async function testAvailableModels() {
    log('\n=== TEST 1: Available Models ===', 'header');
    
    const models = modelSelector.getAvailableModels();
    const current = modelSelector.getCurrentModel();
    
    log(`Hardware Profile: ${visionEngine.hardwareProfile}`, 'info');
    log(`Current Model: ${current.id}`, 'info');
    
    log('\nAvailable Models:', 'info');
    models.forEach(model => {
        const recommended = model.recommended ? ' ⭐ (Recommended)' : '';
        log(`  - ${model.id}: ${model.name}${recommended}`, 'info');
        if (model.description) {
            log(`    ${model.description}`, 'info');
        }
    });
}

// Test 2: Model switching
async function testModelSwitching() {
    log('\n=== TEST 2: Model Switching ===', 'header');
    
    const models = modelSelector.getAvailableModels();
    const testFrame = await createTestFrame();
    
    for (const model of models.slice(0, 2)) { // Test first 2 models
        log(`\nSwitching to: ${model.id}`, 'info');
        
        const result = await modelSelector.switchModel(model.id);
        if (result.success) {
            log(`✓ Successfully switched to ${model.name}`, 'success');
            
            // Test the model
            const startTime = Date.now();
            try {
                const analysis = await visionEngine.analyzeFrame(testFrame, 'general');
                const processingTime = Date.now() - startTime;
                
                log(`  Processing time: ${processingTime}ms`, 'info');
                log(`  Analysis preview: ${analysis.summary?.substring(0, 100)}...`, 'info');
            } catch (error) {
                log(`  ✗ Analysis failed: ${error.message}`, 'error');
            }
        } else {
            log(`✗ Failed to switch: ${result.error}`, 'error');
        }
    }
}

// Test 3: Benchmark all models
async function testBenchmark() {
    log('\n=== TEST 3: Model Benchmarking ===', 'header');
    
    const testFrame = await createTestFrame();
    
    log('Running benchmark on all models...', 'info');
    log('This may take a few minutes...', 'warning');
    
    try {
        const results = await modelSelector.benchmarkAllModels(testFrame);
        
        log('\n📊 Benchmark Results:', 'success');
        log(`Best Model: ${results.bestModel} 🏆`, 'success');
        log(`Recommendation: ${results.recommendation}`, 'info');
        
        log('\nDetailed Results:', 'info');
        for (const [modelId, result] of Object.entries(results.results)) {
            log(`\n${modelId}:`, 'info');
            log(`  Avg Processing Time: ${result.avgProcessingTime.toFixed(0)}ms`, 'info');
            log(`  Success Rate: ${(result.successRate * 100).toFixed(1)}%`, 'info');
            log(`  Avg Confidence: ${(result.avgConfidence * 100).toFixed(1)}%`, 'info');
            
            // Show test breakdown
            log('  Test Results:', 'info');
            for (const [test, testResult] of Object.entries(result.tests)) {
                if (testResult.success) {
                    log(`    ✓ ${test}: ${testResult.processingTime}ms`, 'success');
                } else {
                    log(`    ✗ ${test}: ${testResult.error}`, 'error');
                }
            }
        }
        
        // Export results
        const csvExport = modelSelector.exportBenchmarkResults('csv');
        await fs.writeFile('benchmark-results.csv', csvExport);
        log('\n📄 Results exported to benchmark-results.csv', 'success');
        
    } catch (error) {
        log(`Benchmark failed: ${error.message}`, 'error');
    }
}

// Test 4: Compare two models
async function testComparison() {
    log('\n=== TEST 4: Model Comparison ===', 'header');
    
    const models = modelSelector.getAvailableModels();
    if (models.length < 2) {
        log('Need at least 2 models for comparison', 'warning');
        return;
    }
    
    const model1 = models[0].id;
    const model2 = models[1].id;
    const testFrame = await createTestFrame();
    
    log(`Comparing ${model1} vs ${model2}...`, 'info');
    
    try {
        const comparison = await modelSelector.compareModels(model1, model2, testFrame);
        
        log(`\n🏆 Winner: ${comparison.winner}`, 'success');
        
        log('\nComparison Analysis:', 'info');
        for (const [metric, analysis] of Object.entries(comparison.analysis)) {
            log(`\n${metric}:`, 'info');
            log(`  ${model1}: ${analysis[model1]}`, 'info');
            log(`  ${model2}: ${analysis[model2]}`, 'info');
            log(`  Winner: ${analysis.winner} (${analysis.improvement} better)`, 'success');
        }
        
    } catch (error) {
        log(`Comparison failed: ${error.message}`, 'error');
    }
}

// Test 5: Hardware optimization
async function testHardwareOptimization() {
    log('\n=== TEST 5: Hardware Optimization ===', 'header');
    
    log(`Current Hardware: ${visionEngine.hardwareProfile}`, 'info');
    
    // Get recommendations
    const recommendations = modelSelector.getRecommendations();
    
    if (recommendations.length > 0) {
        log('\n📋 Recommendations for your hardware:', 'info');
        recommendations.forEach(rec => {
            log(`  ${rec.priority.toUpperCase()}: ${rec.modelId}`, 'info');
            log(`    Reason: ${rec.reason}`, 'info');
        });
        
        // Apply optimizations
        visionEngine.optimizeForHardware();
        log('\n✓ Hardware optimizations applied', 'success');
    } else {
        log('No specific recommendations for your hardware', 'info');
    }
}

// Test 6: Auto-selection based on requirements
async function testAutoSelection() {
    log('\n=== TEST 6: Auto Model Selection ===', 'header');
    
    const requirements = [
        {
            name: 'Fast Processing',
            maxLatency: 500,
            minAccuracy: 0.6,
            preferredSize: 'small'
        },
        {
            name: 'High Accuracy',
            maxLatency: 2000,
            minAccuracy: 0.85,
            preferredSize: 'large'
        },
        {
            name: 'Balanced',
            maxLatency: 1000,
            minAccuracy: 0.75,
            preferredSize: 'medium'
        }
    ];
    
    for (const req of requirements) {
        log(`\nTesting requirement: ${req.name}`, 'info');
        log(`  Max latency: ${req.maxLatency}ms`, 'info');
        log(`  Min accuracy: ${(req.minAccuracy * 100).toFixed(0)}%`, 'info');
        log(`  Preferred size: ${req.preferredSize}`, 'info');
        
        const result = await modelSelector.autoSelectModel(req);
        
        if (result.selected) {
            log(`  ✓ Selected: ${result.selected} (score: ${result.score.toFixed(3)})`, 'success');
            log(`    ${result.reason}`, 'info');
        } else {
            log(`  ✗ ${result.reason}`, 'warning');
        }
    }
}

// Test 7: Performance monitoring
async function testPerformanceMonitoring() {
    log('\n=== TEST 7: Performance Monitoring ===', 'header');
    
    const testFrame = await createTestFrame();
    const iterations = 5;
    
    log(`Running ${iterations} iterations to collect performance data...`, 'info');
    
    for (let i = 0; i < iterations; i++) {
        try {
            await visionEngine.analyzeFrame(testFrame, 'general');
            process.stdout.write('.');
        } catch (error) {
            process.stdout.write('x');
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    log('\n\n📈 Performance Statistics:', 'info');
    const stats = visionEngine.getStatistics();
    
    log(`\nOverall Stats:`, 'info');
    log(`  Status: ${stats.status}`, 'info');
    log(`  Queue Length: ${stats.queueLength}`, 'info');
    log(`  Active Requests: ${stats.activeRequests}`, 'info');
    log(`  Cache Size: ${stats.cacheSize}`, 'info');
    
    if (Object.keys(stats.models).length > 0) {
        log(`\nPer-Model Performance:`, 'info');
        for (const [modelId, perf] of Object.entries(stats.models)) {
            log(`\n  ${modelId}:`, 'info');
            log(`    Total Requests: ${perf.totalRequests}`, 'info');
            log(`    Avg Processing Time: ${perf.avgProcessingTime.toFixed(0)}ms`, 'info');
            log(`    Error Rate: ${((perf.errors / perf.totalRequests) * 100).toFixed(1)}%`, 'info');
        }
    }
}

// Main test runner
async function runTests() {
    log('\n🚀 Multi-Model Robot Monitoring System Test Suite', 'header');
    log('================================================\n', 'header');
    
    // Wait for initialization
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    try {
        await testAvailableModels();
        await testModelSwitching();
        await testBenchmark();
        await testComparison();
        await testHardwareOptimization();
        await testAutoSelection();
        await testPerformanceMonitoring();
        
        log('\n✅ All tests completed!', 'success');
        
        // Save test report
        const report = {
            timestamp: new Date().toISOString(),
            hardware: visionEngine.hardwareProfile,
            models: modelSelector.getAvailableModels(),
            benchmarkResults: modelSelector.getBenchmarkResults(),
            recommendations: modelSelector.getRecommendations()
        };
        
        await fs.writeFile(
            'test-report.json',
            JSON.stringify(report, null, 2)
        );
        
        log('📄 Test report saved to test-report.json', 'success');
        
    } catch (error) {
        log(`\n❌ Test failed: ${error.message}`, 'error');
        console.error(error.stack);
    }
}

// Run if executed directly
if (require.main === module) {
    runTests().then(() => {
        process.exit(0);
    }).catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}

module.exports = { runTests };