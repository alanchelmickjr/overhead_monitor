#!/usr/bin/env node

/**
 * Test script for frame buffer controls in the Nanny Cam interface
 * Tests Direct Stream, WebSocket, and Buffered modes
 */

const puppeteer = require('puppeteer');
const chalk = require('chalk');

const TEST_URL = 'http://localhost:3000';
const WAIT_TIME = 3000;

// Test results
const results = {
    direct: { passed: false, message: '' },
    websocket: { passed: false, message: '' },
    buffered: { passed: false, message: '' },
    adaptive: { passed: false, message: '' },
    replay: { passed: false, message: '' }
};

async function log(message, type = 'info') {
    const timestamp = new Date().toISOString();
    const color = {
        'error': chalk.red,
        'success': chalk.green,
        'warning': chalk.yellow,
        'info': chalk.cyan
    }[type] || chalk.white;
    
    console.log(color(`[${timestamp}] ${message}`));
}

async function testFrameBufferControls() {
    let browser;
    
    try {
        log('🚀 Starting Frame Buffer Controls Test', 'info');
        
        // Launch browser
        browser = await puppeteer.launch({
            headless: false, // Set to true for CI/CD
            defaultViewport: { width: 1920, height: 1080 }
        });
        
        const page = await browser.newPage();
        
        // Enable console logging
        page.on('console', msg => {
            if (msg.type() === 'error') {
                log(`Browser Error: ${msg.text()}`, 'error');
            }
        });
        
        // Navigate to the Nanny Cam interface
        log(`Navigating to ${TEST_URL}`, 'info');
        await page.goto(TEST_URL, { waitUntil: 'networkidle2' });
        
        // Wait for page to fully load
        await page.waitForSelector('#stream', { timeout: 10000 });
        log('✅ Page loaded successfully', 'success');
        
        // Test 1: Direct Stream Mode
        log('\nTest 1: Testing Direct Stream Mode', 'info');
        await page.click('[data-mode="direct"]');
        await page.waitForTimeout(WAIT_TIME);
        
        // Check if stream is visible
        const streamVisible = await page.evaluate(() => {
            const stream = document.getElementById('stream');
            return stream && stream.src && stream.src.includes('stream.mjpeg');
        });
        
        if (streamVisible) {
            results.direct.passed = true;
            results.direct.message = 'Direct stream mode working correctly';
            log('✅ Direct stream mode: PASSED', 'success');
        } else {
            results.direct.message = 'Stream not visible in direct mode';
            log('❌ Direct stream mode: FAILED', 'error');
        }
        
        // Test 2: WebSocket Mode
        log('\nTest 2: Testing WebSocket Mode', 'info');
        await page.click('[data-mode="websocket"]');
        await page.waitForTimeout(WAIT_TIME);
        
        // Check WebSocket connection
        const wsConnected = await page.evaluate(() => {
            return window.websocket && window.websocket.readyState === WebSocket.OPEN;
        });
        
        // Check if buffer info is displayed
        const bufferInfoVisible = await page.evaluate(() => {
            const bufferInfo = document.getElementById('bufferInfo');
            return bufferInfo && bufferInfo.style.display !== 'none';
        });
        
        if (wsConnected && bufferInfoVisible) {
            results.websocket.passed = true;
            results.websocket.message = 'WebSocket mode connected and buffer info visible';
            log('✅ WebSocket mode: PASSED', 'success');
        } else {
            results.websocket.message = `WebSocket: ${wsConnected}, Buffer Info: ${bufferInfoVisible}`;
            log('❌ WebSocket mode: FAILED', 'error');
        }
        
        // Test 3: Buffered Mode
        log('\nTest 3: Testing Buffered Mode', 'info');
        await page.click('[data-mode="buffered"]');
        await page.waitForTimeout(WAIT_TIME);
        
        // Check if buffer controls are visible
        const bufferControlsVisible = await page.evaluate(() => {
            const bufferActions = document.getElementById('bufferActions');
            return bufferActions && bufferActions.style.display !== 'none';
        });
        
        // Get buffer stats
        const bufferStats = await page.evaluate(() => {
            const sizeElement = document.getElementById('bufferSize');
            const fpsElement = document.getElementById('bufferFPS');
            return {
                size: sizeElement ? sizeElement.textContent : 'N/A',
                fps: fpsElement ? fpsElement.textContent : 'N/A'
            };
        });
        
        if (bufferControlsVisible && bufferStats.size !== 'N/A') {
            results.buffered.passed = true;
            results.buffered.message = `Buffered mode active - Size: ${bufferStats.size}, FPS: ${bufferStats.fps}`;
            log(`✅ Buffered mode: PASSED (${bufferStats.size}, ${bufferStats.fps})`, 'success');
        } else {
            results.buffered.message = 'Buffer controls not visible or stats unavailable';
            log('❌ Buffered mode: FAILED', 'error');
        }
        
        // Test 4: Adaptive Streaming
        log('\nTest 4: Testing Adaptive Streaming Toggle', 'info');
        const adaptiveCheckbox = await page.$('#adaptiveMode');
        if (adaptiveCheckbox) {
            const isChecked = await page.evaluate(() => {
                return document.getElementById('adaptiveMode').checked;
            });
            
            // Toggle adaptive mode
            await page.click('#adaptiveMode');
            await page.waitForTimeout(1000);
            
            const newState = await page.evaluate(() => {
                return document.getElementById('adaptiveMode').checked;
            });
            
            if (isChecked !== newState) {
                results.adaptive.passed = true;
                results.adaptive.message = 'Adaptive streaming toggle working';
                log('✅ Adaptive streaming toggle: PASSED', 'success');
            } else {
                results.adaptive.message = 'Toggle state did not change';
                log('❌ Adaptive streaming toggle: FAILED', 'error');
            }
        } else {
            results.adaptive.message = 'Adaptive mode checkbox not found';
            log('⚠️ Adaptive streaming: NOT FOUND', 'warning');
        }
        
        // Test 5: Replay Frames (if in buffered mode)
        log('\nTest 5: Testing Frame Replay', 'info');
        if (bufferControlsVisible) {
            try {
                // Click replay 10 frames button
                await page.evaluate(() => {
                    const buttons = Array.from(document.querySelectorAll('button'));
                    const replayBtn = buttons.find(btn => btn.textContent.includes('Replay 10'));
                    if (replayBtn) replayBtn.click();
                });
                
                await page.waitForTimeout(2000);
                
                // Check for any errors or success indicators
                const replaySuccess = await page.evaluate(() => {
                    // Check if any error alerts appeared
                    const alerts = Array.from(document.querySelectorAll('.status.error'));
                    return alerts.length === 0;
                });
                
                if (replaySuccess) {
                    results.replay.passed = true;
                    results.replay.message = 'Frame replay functionality working';
                    log('✅ Frame replay: PASSED', 'success');
                } else {
                    results.replay.message = 'Replay triggered errors';
                    log('❌ Frame replay: FAILED', 'error');
                }
            } catch (error) {
                results.replay.message = `Error during replay test: ${error.message}`;
                log(`❌ Frame replay: ERROR - ${error.message}`, 'error');
            }
        } else {
            results.replay.message = 'Replay not available (not in buffered mode)';
            log('⚠️ Frame replay: SKIPPED', 'warning');
        }
        
        // Generate summary report
        log('\n' + '='.repeat(60), 'info');
        log('📊 TEST RESULTS SUMMARY', 'info');
        log('='.repeat(60), 'info');
        
        let totalPassed = 0;
        let totalTests = 0;
        
        for (const [test, result] of Object.entries(results)) {
            totalTests++;
            if (result.passed) totalPassed++;
            
            const status = result.passed ? '✅ PASSED' : '❌ FAILED';
            const color = result.passed ? 'success' : 'error';
            log(`${test.toUpperCase()}: ${status} - ${result.message}`, color);
        }
        
        log('='.repeat(60), 'info');
        log(`Overall: ${totalPassed}/${totalTests} tests passed`, 
            totalPassed === totalTests ? 'success' : 'warning');
        
        // Test monitoring functionality
        log('\n📹 Testing Monitoring Features...', 'info');
        
        // Start monitoring
        const startBtn = await page.$('#startMonitoring');
        if (startBtn) {
            await page.click('#startMonitoring');
            log('✅ Started monitoring', 'success');
            
            // Wait for initial capture
            await page.waitForTimeout(5000);
            
            // Check if frames are being analyzed
            const frameCount = await page.evaluate(() => {
                const element = document.getElementById('frameCount');
                return element ? parseInt(element.textContent) : 0;
            });
            
            if (frameCount > 0) {
                log(`✅ Monitoring active - ${frameCount} frames analyzed`, 'success');
            } else {
                log('⚠️ No frames analyzed yet', 'warning');
            }
            
            // Stop monitoring
            await page.click('#stopMonitoring');
            log('✅ Stopped monitoring', 'success');
        }
        
    } catch (error) {
        log(`Test failed with error: ${error.message}`, 'error');
        console.error(error);
    } finally {
        if (browser) {
            log('\nClosing browser...', 'info');
            await browser.close();
        }
        
        // Exit with appropriate code
        const allPassed = Object.values(results).every(r => r.passed);
        process.exit(allPassed ? 0 : 1);
    }
}

// Check if required dependencies are installed
async function checkDependencies() {
    try {
        require('puppeteer');
        require('chalk');
        return true;
    } catch (error) {
        log('Missing dependencies. Installing...', 'warning');
        const { execSync } = require('child_process');
        try {
            execSync('npm install puppeteer chalk', { stdio: 'inherit' });
            return true;
        } catch (installError) {
            log('Failed to install dependencies. Please run: npm install puppeteer chalk', 'error');
            return false;
        }
    }
}

// Main execution
async function main() {
    log('🔧 Frame Buffer Controls Test Suite', 'info');
    log('Testing the LeKiwi Pen Nanny Cam interface', 'info');
    log('='.repeat(60), 'info');
    
    // Check server is running
    const http = require('http');
    const serverCheck = new Promise((resolve) => {
        http.get('http://localhost:3000/status', (res) => {
            resolve(res.statusCode === 200);
        }).on('error', () => {
            resolve(false);
        });
    });
    
    const serverRunning = await serverCheck;
    if (!serverRunning) {
        log('❌ Server not running on port 3000', 'error');
        log('Please start the server with: npm start', 'warning');
        process.exit(1);
    }
    
    log('✅ Server is running', 'success');
    
    // Check dependencies
    if (!await checkDependencies()) {
        process.exit(1);
    }
    
    // Run tests
    await testFrameBufferControls();
}

// Run the test suite
main().catch(error => {
    log(`Fatal error: ${error.message}`, 'error');
    console.error(error);
    process.exit(1);
});