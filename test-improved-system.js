#!/usr/bin/env node

/**
 * Test Script for Improved Overhead Monitoring System
 * Validates all enhancements and optimizations
 */

const axios = require('axios');
const io = require('socket.io-client');
const fs = require('fs');
const path = require('path');

// Configuration
const API_BASE = process.env.API_BASE || 'http://localhost:3000';
const WS_URL = process.env.WS_URL || 'http://localhost:3000';
const SMOLVLM_URL = process.env.SMOLVLM_URL || 'http://localhost:8080/v1/chat/completions';

// Test results
const testResults = {
  passed: 0,
  failed: 0,
  tests: []
};

// Colors for output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

// Logger
function log(message, type = 'info') {
  const timestamp = new Date().toISOString();
  const color = {
    success: colors.green,
    error: colors.red,
    warning: colors.yellow,
    info: colors.blue
  }[type] || colors.reset;
  
  console.log(`${color}[${timestamp}] ${message}${colors.reset}`);
}

// Test helper
async function runTest(name, testFn) {
  log(`Running test: ${name}`, 'info');
  
  try {
    await testFn();
    testResults.passed++;
    testResults.tests.push({ name, status: 'passed' });
    log(`✓ ${name} passed`, 'success');
  } catch (error) {
    testResults.failed++;
    testResults.tests.push({ name, status: 'failed', error: error.message });
    log(`✗ ${name} failed: ${error.message}`, 'error');
  }
}

// Test 1: Verify SmolVLM is configured (not LLaVA)
async function testSmolVLMConfiguration() {
  const response = await axios.get(`${API_BASE}/api/config/vision`);
  const config = response.data;
  
  if (config.model !== 'smolvlm-instruct') {
    throw new Error(`Expected model 'smolvlm-instruct', got '${config.model}'`);
  }
  
  // Test actual SmolVLM API
  const testImage = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/2wBDAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA8A/9k=';
  
  const visionResponse = await axios.post(SMOLVLM_URL, {
    model: 'smolvlm-instruct',
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'What do you see?' },
        { type: 'image_url', image_url: { url: testImage } }
      ]
    }],
    max_tokens: 50
  });
  
  if (!visionResponse.data.choices) {
    throw new Error('SmolVLM API not responding correctly');
  }
}

// Test 2: WebSocket real-time response
async function testRealtimeResponse() {
  return new Promise((resolve, reject) => {
    const socket = io(WS_URL);
    let startTime;
    
    socket.on('connect', () => {
      log('WebSocket connected', 'info');
      socket.emit('subscribe', { feed: 'events' });
      startTime = Date.now();
    });
    
    socket.on('event_detected', (data) => {
      const responseTime = Date.now() - startTime;
      log(`Event received in ${responseTime}ms`, 'info');
      
      if (responseTime > 1000) {
        reject(new Error(`Response time ${responseTime}ms exceeds 1000ms threshold`));
      } else {
        resolve();
      }
      
      socket.disconnect();
    });
    
    socket.on('error', (error) => {
      reject(error);
    });
    
    // Timeout after 5 seconds
    setTimeout(() => {
      socket.disconnect();
      reject(new Error('WebSocket test timed out'));
    }, 5000);
  });
}

// Test 3: Activity-based throttling
async function testActivityThrottling() {
  return new Promise((resolve, reject) => {
    const socket = io(WS_URL);
    const intervals = [];
    let lastFrameTime = null;
    
    socket.on('connect', () => {
      socket.emit('subscribe', { feed: 'live', cameraId: 'cam-001' });
      
      // Get activity status
      socket.emit('get_activity_status');
    });
    
    socket.on('activity_status', (data) => {
      log(`Activity status: ${JSON.stringify(data.status[0]?.throttlingInfo)}`, 'info');
      
      if (!data.status[0]?.throttlingInfo) {
        reject(new Error('No throttling info available'));
      }
    });
    
    socket.on('frame', (data) => {
      if (lastFrameTime) {
        const interval = Date.now() - lastFrameTime;
        intervals.push(interval);
        
        log(`Frame interval: ${interval}ms (Activity: ${data.stats?.activityLevel})`, 'info');
        
        if (intervals.length >= 5) {
          socket.disconnect();
          
          // Check if intervals vary based on activity
          const uniqueIntervals = [...new Set(intervals.map(i => Math.round(i / 100) * 100))];
          
          if (uniqueIntervals.length > 1) {
            resolve();
          } else {
            reject(new Error('Throttling not working - all intervals are the same'));
          }
        }
      }
      
      lastFrameTime = Date.now();
    });
    
    setTimeout(() => {
      socket.disconnect();
      reject(new Error('Throttling test timed out'));
    }, 30000);
  });
}

// Test 4: Alert deduplication
async function testAlertDeduplication() {
  return new Promise((resolve, reject) => {
    const socket = io(WS_URL);
    const alerts = [];
    
    socket.on('connect', () => {
      socket.emit('subscribe', { feed: 'alerts' });
      
      // Simulate multiple similar events
      for (let i = 0; i < 10; i++) {
        socket.emit('event', {
          type: 'robot_tipped',
          robotId: 'robot-001',
          confidence: 0.9
        });
      }
    });
    
    socket.on('alert_notification', (alert) => {
      alerts.push(alert);
      log(`Alert received: ${alert.title} (count: ${alert.occurrenceCount})`, 'info');
      
      if (alert.occurrenceCount && alert.occurrenceCount > 1) {
        socket.disconnect();
        resolve();
      }
    });
    
    setTimeout(() => {
      socket.disconnect();
      if (alerts.length < 10) {
        resolve(); // Deduplication worked
      } else {
        reject(new Error('Alert deduplication not working'));
      }
    }, 5000);
  });
}

// Test 5: Human detection
async function testHumanDetection() {
  const testCases = [
    {
      prompt: 'Is there a human visible in this image?',
      expectedKeywords: ['human', 'person', 'yes', 'no']
    },
    {
      prompt: 'IMPORTANT: Are there any humans visible in this image? Look for: 1) People standing or walking 2) Human body parts (legs, arms, torso) 3) Human shadows or reflections. Answer YES or NO first.',
      expectedKeywords: ['yes', 'no']
    }
  ];
  
  for (const testCase of testCases) {
    const response = await axios.post(`${API_BASE}/api/analyze`, {
      cameraId: 'cam-001',
      prompt: testCase.prompt
    });
    
    const content = response.data.analysis?.content?.toLowerCase() || '';
    const hasExpectedKeyword = testCase.expectedKeywords.some(keyword => 
      content.includes(keyword)
    );
    
    if (!hasExpectedKeyword) {
      throw new Error(`Human detection prompt not working correctly. Response: ${content}`);
    }
  }
}

// Test 6: Critical event immediate response
async function testCriticalEventResponse() {
  return new Promise((resolve, reject) => {
    const socket = io(WS_URL);
    let criticalReceived = false;
    
    socket.on('connect', () => {
      // Simulate a human detection event
      socket.emit('event', {
        type: 'human_in_area',
        priority: 'critical',
        confidence: 0.9
      });
    });
    
    socket.on('critical_alert', (data) => {
      criticalReceived = true;
      log('Critical alert received immediately', 'success');
      socket.disconnect();
      resolve();
    });
    
    setTimeout(() => {
      socket.disconnect();
      if (!criticalReceived) {
        reject(new Error('Critical event immediate response not working'));
      }
    }, 2000);
  });
}

// Test 7: System health check
async function testSystemHealth() {
  const response = await axios.get(`${API_BASE}/health`);
  
  if (response.status !== 200) {
    throw new Error(`Health check failed with status ${response.status}`);
  }
  
  const health = response.data;
  const services = ['camera', 'vision', 'database', 'alerts'];
  
  for (const service of services) {
    if (health.services[service] !== 'online') {
      throw new Error(`Service ${service} is not online: ${health.services[service]}`);
    }
  }
}

// Test 8: Performance metrics
async function testPerformanceMetrics() {
  return new Promise((resolve, reject) => {
    const socket = io(WS_URL);
    
    socket.on('connect', () => {
      socket.emit('subscribe', { feed: 'metrics' });
    });
    
    socket.on('realtime_metrics', (data) => {
      log(`Performance metrics: ${JSON.stringify(data.metrics)}`, 'info');
      
      if (data.metrics.avgProcessingTime < 1000) {
        socket.disconnect();
        resolve();
      } else {
        reject(new Error(`Processing time too high: ${data.metrics.avgProcessingTime}ms`));
      }
    });
    
    setTimeout(() => {
      socket.disconnect();
      reject(new Error('Performance metrics test timed out'));
    }, 10000);
  });
}

// Main test runner
async function runAllTests() {
  console.log('\n🧪 Starting Overhead Monitor System Tests\n');
  
  const tests = [
    { name: 'SmolVLM Configuration', fn: testSmolVLMConfiguration },
    { name: 'Real-time WebSocket Response', fn: testRealtimeResponse },
    { name: 'Activity-based Throttling', fn: testActivityThrottling },
    { name: 'Alert Deduplication', fn: testAlertDeduplication },
    { name: 'Human Detection Prompts', fn: testHumanDetection },
    { name: 'Critical Event Response', fn: testCriticalEventResponse },
    { name: 'System Health Check', fn: testSystemHealth },
    { name: 'Performance Metrics', fn: testPerformanceMetrics }
  ];
  
  for (const test of tests) {
    await runTest(test.name, test.fn);
    console.log(''); // Empty line between tests
  }
  
  // Summary
  console.log('\n📊 Test Summary\n');
  console.log(`Total Tests: ${testResults.passed + testResults.failed}`);
  console.log(`${colors.green}Passed: ${testResults.passed}${colors.reset}`);
  console.log(`${colors.red}Failed: ${testResults.failed}${colors.reset}`);
  
  if (testResults.failed > 0) {
    console.log('\nFailed Tests:');
    testResults.tests
      .filter(t => t.status === 'failed')
      .forEach(t => {
        console.log(`${colors.red}  - ${t.name}: ${t.error}${colors.reset}`);
      });
  }
  
  // Save results
  fs.writeFileSync(
    'test-results.json',
    JSON.stringify(testResults, null, 2)
  );
  
  process.exit(testResults.failed > 0 ? 1 : 0);
}

// Check if services are running
async function checkServices() {
  log('Checking required services...', 'info');
  
  try {
    // Check main server
    await axios.get(`${API_BASE}/health`);
    log('✓ Main server is running', 'success');
  } catch (error) {
    log('✗ Main server not running at ' + API_BASE, 'error');
    log('Please run: npm start', 'warning');
    process.exit(1);
  }
  
  try {
    // Check SmolVLM
    await axios.post(SMOLVLM_URL, {
      model: 'smolvlm-instruct',
      messages: [{ role: 'user', content: 'test' }]
    });
    log('✓ SmolVLM server is running', 'success');
  } catch (error) {
    log('✗ SmolVLM server not running at ' + SMOLVLM_URL, 'error');
    log('Please run: ./start-llama-server.sh', 'warning');
    process.exit(1);
  }
}

// Run tests
(async () => {
  await checkServices();
  await runAllTests();
})().catch(error => {
  log(`Unexpected error: ${error.message}`, 'error');
  process.exit(1);
});