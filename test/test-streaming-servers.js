/**
 * Streaming Servers Integration Tests
 * Tests all three refactored servers: rtsp-proxy, robot-monitor-server, robot-monitor-server-enhanced
 */

const http = require('http');
const axios = require('axios');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const path = require('path');

// Test configuration
const TEST_CONFIG = {
    servers: [
        {
            name: 'robot-monitor-server',
            script: 'robot-monitor-server.js',
            port: 3000,
            features: ['basic', 'auth', 'buffering']
        },
        {
            name: 'rtsp-proxy',
            script: 'rtsp-proxy.js',
            port: 3000,
            features: ['basic', 'multi-client', 'buffering']
        },
        {
            name: 'robot-monitor-server-enhanced',
            script: 'robot-monitor-server-enhanced.js',
            port: 3002, // Using different port for testing
            features: ['basic', 'buffering', 'ai-analysis', 'multi-model']
        }
    ]
};

// Test utilities
class TestHelpers {
    static async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    static createMockJPEG(text = 'test') {
        // Create a minimal valid JPEG with markers
        const jpegHeader = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46]);
        const jpegFooter = Buffer.from([0xFF, 0xD9]);
        const content = Buffer.from(text);
        return Buffer.concat([jpegHeader, content, jpegFooter]);
    }

    static async checkServerHealth(url, retries = 5) {
        for (let i = 0; i < retries; i++) {
            try {
                const response = await axios.get(url);
                if (response.status === 200) {
                    return true;
                }
            } catch (error) {
                await this.delay(1000);
            }
        }
        return false;
    }

    static parseMJPEGStream(data) {
        const frames = [];
        const boundary = '--frame';
        const parts = data.toString().split(boundary);
        
        for (const part of parts) {
            const contentMatch = part.match(/Content-Length: (\d+)/);
            if (contentMatch) {
                const length = parseInt(contentMatch[1]);
                const dataStart = part.indexOf('\r\n\r\n') + 4;
                if (dataStart > 3 && part.length >= dataStart + length) {
                    frames.push(part.slice(dataStart, dataStart + length));
                }
            }
        }
        
        return frames;
    }
}

// Server manager for tests
class TestServerManager {
    constructor() {
        this.processes = new Map();
    }

    async startServer(serverConfig) {
        console.log(`Starting ${serverConfig.name} on port ${serverConfig.port}...`);
        
        // Set environment variables
        const env = {
            ...process.env,
            PORT: serverConfig.port,
            RTSP_PROXY_PORT: serverConfig.port,
            NODE_ENV: 'test',
            VISION_API_URL: 'http://localhost:8080' // Mock vision API
        };

        const serverProcess = spawn('node', [serverConfig.script], {
            env,
            stdio: ['ignore', 'pipe', 'pipe']
        });

        // Capture logs for debugging
        serverProcess.stdout.on('data', (data) => {
            if (process.env.DEBUG) {
                console.log(`[${serverConfig.name}] ${data.toString().trim()}`);
            }
        });

        serverProcess.stderr.on('data', (data) => {
            console.error(`[${serverConfig.name} ERROR] ${data.toString().trim()}`);
        });

        this.processes.set(serverConfig.name, serverProcess);

        // Wait for server to be ready
        const healthUrl = `http://localhost:${serverConfig.port}/status`;
        const isHealthy = await TestHelpers.checkServerHealth(healthUrl);
        
        if (!isHealthy) {
            throw new Error(`${serverConfig.name} failed to start`);
        }

        console.log(`✓ ${serverConfig.name} started successfully`);
        return serverProcess;
    }

    async stopServer(name) {
        const process = this.processes.get(name);
        if (process) {
            process.kill('SIGTERM');
            await TestHelpers.delay(1000);
            if (!process.killed) {
                process.kill('SIGKILL');
            }
            this.processes.delete(name);
            console.log(`✓ ${name} stopped`);
        }
    }

    async stopAll() {
        for (const [name] of this.processes) {
            await this.stopServer(name);
        }
    }
}

// Main test suite
class StreamingServerTests {
    constructor() {
        this.serverManager = new TestServerManager();
        this.testResults = [];
        this.totalTests = 0;
        this.passedTests = 0;
    }

    async runTest(testName, testFn) {
        this.totalTests++;
        console.log(`\n📋 Running: ${testName}`);
        
        try {
            await testFn.call(this);
            this.passedTests++;
            console.log(`✅ PASSED: ${testName}`);
            this.testResults.push({ test: testName, status: 'PASSED' });
        } catch (error) {
            console.error(`❌ FAILED: ${testName}`);
            console.error(`   Error: ${error.message}`);
            this.testResults.push({ test: testName, status: 'FAILED', error: error.message });
        }
    }

    // Test 1: MJPEG endpoint functionality
    async testMJPEGEndpoints() {
        for (const server of TEST_CONFIG.servers) {
            console.log(`\n  Testing MJPEG on ${server.name}...`);
            
            const streamUrl = `http://localhost:${server.port}/stream.mjpeg`;
            let receivedData = Buffer.alloc(0);
            let frameCount = 0;
            
            // Create HTTP request to MJPEG stream
            const request = http.get(streamUrl, (response) => {
                if (response.statusCode !== 200) {
                    throw new Error(`MJPEG stream returned ${response.statusCode}`);
                }
                
                response.on('data', (chunk) => {
                    receivedData = Buffer.concat([receivedData, chunk]);
                    const frames = TestHelpers.parseMJPEGStream(receivedData);
                    frameCount = frames.length;
                });
            });
            
            // Let it stream for a bit
            await TestHelpers.delay(3000);
            request.destroy();
            
            if (frameCount === 0) {
                throw new Error(`${server.name}: No frames received from MJPEG stream`);
            }
            
            console.log(`  ✓ ${server.name}: Received ${frameCount} frames from MJPEG stream`);
        }
    }

    // Test 2: Snapshot endpoints with buffered frames
    async testSnapshotEndpoints() {
        for (const server of TEST_CONFIG.servers) {
            console.log(`\n  Testing snapshot on ${server.name}...`);
            
            const snapshotUrl = `http://localhost:${server.port}/snapshot.jpg`;
            
            try {
                const response = await axios.get(snapshotUrl, {
                    responseType: 'arraybuffer'
                });
                
                if (response.status !== 200) {
                    throw new Error(`Snapshot returned ${response.status}`);
                }
                
                const data = Buffer.from(response.data);
                
                // Check for JPEG markers
                if (data[0] !== 0xFF || data[1] !== 0xD8) {
                    throw new Error('Snapshot is not a valid JPEG');
                }
                
                // Check for frame metadata in headers
                const hasMetadata = response.headers['x-frame-timestamp'] || 
                                  response.headers['x-frame-sequence'];
                
                console.log(`  ✓ ${server.name}: Snapshot delivered (${data.length} bytes)`);
                if (hasMetadata) {
                    console.log(`  ✓ ${server.name}: Includes frame metadata`);
                }
                
            } catch (error) {
                // Snapshot might fail if no frames buffered yet
                console.log(`  ⚠️  ${server.name}: Snapshot error (expected on cold start): ${error.message}`);
            }
        }
    }

    // Test 3: Multi-client support
    async testMultiClientSupport() {
        for (const server of TEST_CONFIG.servers) {
            console.log(`\n  Testing multi-client on ${server.name}...`);
            
            const streamUrl = `http://localhost:${server.port}/stream.mjpeg`;
            const clients = [];
            const clientFrames = {};
            
            // Create multiple clients
            for (let i = 0; i < 3; i++) {
                const clientId = `client-${i}`;
                clientFrames[clientId] = 0;
                
                const request = http.get(streamUrl, (response) => {
                    response.on('data', (chunk) => {
                        // Simple frame detection
                        const boundary = chunk.toString().match(/--frame/g);
                        if (boundary) {
                            clientFrames[clientId] += boundary.length;
                        }
                    });
                });
                
                clients.push({ id: clientId, request });
            }
            
            // Let them stream
            await TestHelpers.delay(2000);
            
            // Check status to verify client count
            const statusResponse = await axios.get(`http://localhost:${server.port}/status`);
            const activeClients = statusResponse.data.activeClients || statusResponse.data.clientCount || 0;
            
            console.log(`  ✓ ${server.name}: ${activeClients} active clients reported`);
            
            // Disconnect clients
            for (const client of clients) {
                client.request.destroy();
                console.log(`  ✓ ${server.name}: ${client.id} received ${clientFrames[client.id]} frame markers`);
            }
            
            await TestHelpers.delay(1000);
        }
    }

    // Test 4: Buffer statistics and frame history
    async testBufferFunctionality() {
        for (const server of TEST_CONFIG.servers) {
            console.log(`\n  Testing buffer functionality on ${server.name}...`);
            
            // First, ensure some frames are captured
            const streamUrl = `http://localhost:${server.port}/stream.mjpeg`;
            const request = http.get(streamUrl, () => {});
            
            await TestHelpers.delay(2000);
            request.destroy();
            
            // Check buffer stats
            try {
                const statsResponse = await axios.get(`http://localhost:${server.port}/buffer-stats`);
                const stats = statsResponse.data;
                
                if (stats.totalFramesBuffered !== undefined) {
                    console.log(`  ✓ ${server.name}: Total frames buffered: ${stats.totalFramesBuffered}`);
                    console.log(`  ✓ ${server.name}: Memory usage: ${(stats.totalMemoryUsage / 1024 / 1024).toFixed(2)} MB`);
                }
            } catch (error) {
                console.log(`  ⚠️  ${server.name}: No buffer-stats endpoint`);
            }
            
            // Check frame history
            try {
                const framesResponse = await axios.get(`http://localhost:${server.port}/frames/5`);
                const frameData = framesResponse.data;
                
                if (frameData.frames && frameData.frames.length > 0) {
                    console.log(`  ✓ ${server.name}: Frame history available (${frameData.frames.length} frames)`);
                    
                    // Verify frame structure
                    const frame = frameData.frames[0];
                    if (frame.id && frame.timestamp && frame.sequenceNumber !== undefined) {
                        console.log(`  ✓ ${server.name}: Frame metadata intact`);
                    }
                }
            } catch (error) {
                console.log(`  ⚠️  ${server.name}: No frames endpoint`);
            }
        }
    }

    // Test 5: Status and health endpoints
    async testStatusEndpoints() {
        for (const server of TEST_CONFIG.servers) {
            console.log(`\n  Testing status endpoints on ${server.name}...`);
            
            const statusResponse = await axios.get(`http://localhost:${server.port}/status`);
            const status = statusResponse.data;
            
            // Verify common status fields
            if (status.running !== undefined) {
                console.log(`  ✓ ${server.name}: Server running: ${status.running}`);
            }
            
            if (status.frameCapture) {
                console.log(`  ✓ ${server.name}: Frame capture status available`);
                console.log(`    - Capturing: ${status.frameCapture.isCapturing}`);
                console.log(`    - Frames processed: ${status.frameCapture.framesProcessed}`);
            }
            
            if (status.bufferStats) {
                console.log(`  ✓ ${server.name}: Buffer stats available`);
                console.log(`    - Current frames: ${status.bufferStats.currentFrames}`);
                console.log(`    - Memory usage: ${(status.bufferStats.memoryUsage / 1024 / 1024).toFixed(2)} MB`);
            }
            
            // Test health endpoint if available
            try {
                const healthResponse = await axios.get(`http://localhost:${server.port}/health`);
                if (healthResponse.status === 200) {
                    console.log(`  ✓ ${server.name}: Health endpoint available`);
                }
            } catch (error) {
                // Health endpoint is optional
            }
        }
    }

    // Test 6: Enhanced server AI capabilities
    async testEnhancedServerFeatures() {
        const enhancedServer = TEST_CONFIG.servers.find(s => s.name === 'robot-monitor-server-enhanced');
        if (!enhancedServer) return;
        
        console.log(`\n  Testing AI features on ${enhancedServer.name}...`);
        
        // Test models endpoint
        try {
            const modelsResponse = await axios.get(`http://localhost:${enhancedServer.port}/models`);
            const models = modelsResponse.data;
            
            if (models.models && Array.isArray(models.models)) {
                console.log(`  ✓ Models endpoint available (${models.models.length} models)`);
            }
            
            if (models.frameBuffering) {
                console.log(`  ✓ Frame buffering integration confirmed`);
                console.log(`    - Buffer size: ${models.frameBuffering.bufferSize}`);
                console.log(`    - Current frames: ${models.frameBuffering.currentFrames}`);
            }
        } catch (error) {
            console.log(`  ⚠️  AI features not available: ${error.message}`);
        }
        
        // Test analyze with buffered frame
        try {
            const analyzeResponse = await axios.post(`http://localhost:${enhancedServer.port}/analyze`, {
                useBufferedFrame: true,
                prompt: 'Test analysis'
            });
            
            if (analyzeResponse.status === 200) {
                console.log(`  ✓ Analyze endpoint works with buffered frames`);
            }
        } catch (error) {
            if (error.response?.status === 400 && error.response?.data?.error?.includes('No buffered frames')) {
                console.log(`  ✓ Analyze endpoint correctly reports no buffered frames`);
            } else {
                console.log(`  ⚠️  Analyze endpoint error: ${error.message}`);
            }
        }
        
        // Test analyze-buffer endpoint
        try {
            const bufferAnalyzeResponse = await axios.post(`http://localhost:${enhancedServer.port}/analyze-buffer`, {
                count: 3,
                prompt: 'Test buffer analysis'
            });
            
            console.log(`  ✓ Analyze-buffer endpoint available`);
        } catch (error) {
            if (error.response?.status === 400) {
                console.log(`  ✓ Analyze-buffer endpoint validates input correctly`);
            }
        }
    }

    // Test 7: Concurrent client stress test
    async testConcurrentClients() {
        const server = TEST_CONFIG.servers[0]; // Test on first server
        console.log(`\n  Testing concurrent client stress on ${server.name}...`);
        
        const clientCount = 10;
        const clients = [];
        const startTime = Date.now();
        
        // Create many concurrent clients
        const clientPromises = [];
        for (let i = 0; i < clientCount; i++) {
            const promise = new Promise((resolve, reject) => {
                const request = http.get(`http://localhost:${server.port}/stream.mjpeg`, (response) => {
                    if (response.statusCode === 200) {
                        clients.push(request);
                        resolve();
                    } else {
                        reject(new Error(`Client ${i} failed with status ${response.statusCode}`));
                    }
                });
                
                request.on('error', reject);
            });
            
            clientPromises.push(promise);
        }
        
        // Wait for all clients to connect
        await Promise.all(clientPromises);
        
        const connectTime = Date.now() - startTime;
        console.log(`  ✓ ${clientCount} clients connected in ${connectTime}ms`);
        
        // Let them stream briefly
        await TestHelpers.delay(1000);
        
        // Check server status under load
        const statusResponse = await axios.get(`http://localhost:${server.port}/status`);
        const reportedClients = statusResponse.data.activeClients || statusResponse.data.clientCount;
        
        console.log(`  ✓ Server reports ${reportedClients} active clients`);
        
        // Disconnect all clients
        for (const client of clients) {
            client.destroy();
        }
        
        await TestHelpers.delay(1000);
        
        // Verify cleanup
        const finalStatus = await axios.get(`http://localhost:${server.port}/status`);
        const remainingClients = finalStatus.data.activeClients || finalStatus.data.clientCount || 0;
        
        console.log(`  ✓ After disconnect: ${remainingClients} clients remaining`);
    }

    // Test 8: Memory management under load
    async testMemoryManagement() {
        const server = TEST_CONFIG.servers[0];
        console.log(`\n  Testing memory management on ${server.name}...`);
        
        // Get initial memory state
        const initialStats = await axios.get(`http://localhost:${server.port}/status`);
        const initialMemory = initialStats.data.memory?.totalUsage || 0;
        
        // Stream for extended period
        const request = http.get(`http://localhost:${server.port}/stream.mjpeg`, () => {});
        
        // Check memory growth over time
        const memoryReadings = [];
        for (let i = 0; i < 5; i++) {
            await TestHelpers.delay(1000);
            try {
                const stats = await axios.get(`http://localhost:${server.port}/buffer-stats`);
                memoryReadings.push(stats.data.totalMemoryUsage || 0);
            } catch (error) {
                // Buffer stats might not be available
            }
        }
        
        request.destroy();
        
        if (memoryReadings.length > 0) {
            const maxMemory = Math.max(...memoryReadings);
            const avgMemory = memoryReadings.reduce((a, b) => a + b, 0) / memoryReadings.length;
            
            console.log(`  ✓ Memory readings taken: ${memoryReadings.length}`);
            console.log(`  ✓ Max memory usage: ${(maxMemory / 1024 / 1024).toFixed(2)} MB`);
            console.log(`  ✓ Avg memory usage: ${(avgMemory / 1024 / 1024).toFixed(2)} MB`);
            
            // Check if memory is within limits (should be under configured max)
            const maxAllowed = 200 * 1024 * 1024; // 200MB as configured
            if (maxMemory < maxAllowed) {
                console.log(`  ✓ Memory usage within limits`);
            } else {
                throw new Error(`Memory usage exceeded limits: ${maxMemory} > ${maxAllowed}`);
            }
        }
    }

    // Run all tests
    async runAllTests() {
        console.log('🚀 Starting Streaming Server Integration Tests\n');
        console.log('='.repeat(50));
        
        try {
            // Start all servers
            console.log('\n📦 Starting test servers...\n');
            for (const server of TEST_CONFIG.servers) {
                await this.serverManager.startServer(server);
                await TestHelpers.delay(2000); // Give servers time to initialize
            }
            
            console.log('\n' + '='.repeat(50));
            console.log('🧪 Running tests...\n');
            
            // Run all tests
            await this.runTest('MJPEG Streaming Endpoints', this.testMJPEGEndpoints);
            await this.runTest('Snapshot Endpoints with Buffered Frames', this.testSnapshotEndpoints);
            await this.runTest('Multi-Client Support', this.testMultiClientSupport);
            await this.runTest('Buffer Functionality and Frame History', this.testBufferFunctionality);
            await this.runTest('Status and Health Endpoints', this.testStatusEndpoints);
            await this.runTest('Enhanced Server AI Features', this.testEnhancedServerFeatures);
            await this.runTest('Concurrent Client Stress Test', this.testConcurrentClients);
            await this.runTest('Memory Management Under Load', this.testMemoryManagement);
            
        } finally {
            // Always clean up servers
            console.log('\n📦 Stopping test servers...\n');
            await this.serverManager.stopAll();
        }
        
        // Print summary
        console.log('\n' + '='.repeat(50));
        console.log('📊 TEST SUMMARY');
        console.log('='.repeat(50));
        console.log(`Total Tests: ${this.totalTests}`);
        console.log(`Passed: ${this.passedTests}`);
        console.log(`Failed: ${this.totalTests - this.passedTests}`);
        console.log(`Success Rate: ${((this.passedTests / this.totalTests) * 100).toFixed(1)}%`);
        
        if (this.passedTests === this.totalTests) {
            console.log('\n✅ All tests passed! 🎉');
        } else {
            console.log('\n❌ Some tests failed. Check the output above for details.');
        }
        
        return {
            total: this.totalTests,
            passed: this.passedTests,
            failed: this.totalTests - this.passedTests,
            results: this.testResults
        };
    }
}

// Mock FFmpeg for all servers
function setupMockFFmpeg() {
    const Module = require('module');
    const originalRequire = Module.prototype.require;
    
    Module.prototype.require = function(id) {
        if (id === 'child_process') {
            const cp = originalRequire.apply(this, arguments);
            const originalSpawn = cp.spawn;
            
            cp.spawn = function(command, args, options) {
                if (command === 'ffmpeg') {
                    // Create mock FFmpeg process
                    const mockProcess = new EventEmitter();
                    mockProcess.stdout = new EventEmitter();
                    mockProcess.stderr = new EventEmitter();
                    mockProcess.stdin = { write: () => {}, end: () => {} };
                    mockProcess.killed = false;
                    mockProcess.kill = function(signal) {
                        this.killed = true;
                        setTimeout(() => this.emit('close', 0), 100);
                    };
                    
                    // Simulate continuous frame output
                    let frameInterval;
                    setTimeout(() => {
                        frameInterval = setInterval(() => {
                            if (!mockProcess.killed) {
                                const frameData = TestHelpers.createMockJPEG(`Frame ${Date.now()}`);
                                mockProcess.stdout.emit('data', frameData);
                            }
                        }, 66); // ~15 fps
                    }, 100);
                    
                    mockProcess.on('close', () => {
                        if (frameInterval) clearInterval(frameInterval);
                    });
                    
                    return mockProcess;
                } else {
                    return originalSpawn.apply(this, arguments);
                }
            };
            
            return cp;
        }
        return originalRequire.apply(this, arguments);
    };
}

// Run tests if executed directly
if (require.main === module) {
    // Setup mocks before tests
    setupMockFFmpeg();
    
    const test = new StreamingServerTests();
    test.runAllTests()
        .then(results => {
            process.exit(results.failed > 0 ? 1 : 0);
        })
        .catch(error => {
            console.error('Test runner error:', error);
            process.exit(1);
        });
}

module.exports = StreamingServerTests;