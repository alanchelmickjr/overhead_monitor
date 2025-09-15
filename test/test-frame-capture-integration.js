/**
 * Frame Capture Integration Tests
 * Tests the complete integration of FrameCaptureService and FrameBufferManager
 */

const FrameCaptureService = require('../src/camera/FrameCaptureService');
const FrameBufferManager = require('../src/camera/FrameBufferManager');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');

// Test utilities
class TestHelpers {
    static createMockFrame(cameraId, sequenceNumber) {
        // Create a simple JPEG header and footer
        const jpegHeader = Buffer.from([0xFF, 0xD8]);
        const jpegFooter = Buffer.from([0xFF, 0xD9]);
        const content = Buffer.from(`Mock frame ${sequenceNumber} for camera ${cameraId}`);
        
        return Buffer.concat([jpegHeader, content, jpegFooter]);
    }

    static createMockFFmpegProcess() {
        const mockProcess = new EventEmitter();
        mockProcess.stdout = new EventEmitter();
        mockProcess.stderr = new EventEmitter();
        mockProcess.killed = false;
        mockProcess.kill = function(signal) {
            this.killed = true;
            setTimeout(() => this.emit('close', 0), 100);
        };
        
        return mockProcess;
    }

    static async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Test suite
class FrameCaptureIntegrationTest {
    constructor() {
        this.captureService = null;
        this.bufferManager = null;
        this.testResults = [];
        this.totalTests = 0;
        this.passedTests = 0;
    }

    async setUp() {
        console.log('🔧 Setting up test environment...\n');
        
        // Initialize services
        this.captureService = new FrameCaptureService();
        this.bufferManager = new FrameBufferManager({
            defaultBufferSize: 50,
            maxBufferMemory: 10 * 1024 * 1024 // 10MB for tests
        });

        // Connect frame capture to buffer manager
        this.captureService.on('frame', (frame) => {
            this.bufferManager.addFrame(frame);
        });
    }

    async tearDown() {
        console.log('\n🧹 Cleaning up test environment...');
        
        if (this.captureService) {
            await this.captureService.stopAll();
            this.captureService.removeAllListeners();
        }
        
        if (this.bufferManager) {
            this.bufferManager.destroy();
        }
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

    // Test 1: Basic frame capture and buffering
    async testBasicFrameCapture() {
        const cameraId = 'test-camera-1';
        const frameCount = 10;
        let capturedFrames = 0;
        
        // Initialize buffer
        this.bufferManager.initializeBuffer(cameraId, { bufferSize: 20 });
        
        // Subscribe to frames
        const subscription = this.bufferManager.subscribe({
            subscriberId: 'test-subscriber-1',
            cameraIds: [cameraId],
            mode: 'live',
            callback: (frame) => {
                capturedFrames++;
            }
        });

        // Mock FFmpeg spawn
        const originalSpawn = require('child_process').spawn;
        require('child_process').spawn = (cmd, args) => {
            const mockProcess = TestHelpers.createMockFFmpegProcess();
            
            // Simulate frame output
            setTimeout(async () => {
                for (let i = 0; i < frameCount; i++) {
                    const frameData = TestHelpers.createMockFrame(cameraId, i);
                    mockProcess.stdout.emit('data', frameData);
                    await TestHelpers.delay(50);
                }
            }, 100);
            
            return mockProcess;
        };

        try {
            // Start capture
            await this.captureService.startCapture({
                cameraId,
                url: 'mock://test-stream',
                ffmpegOptions: { fps: 15, resolution: '1280x720' }
            });

            // Wait for frames
            await TestHelpers.delay(frameCount * 50 + 500);

            // Verify results
            const stats = this.bufferManager.getBufferStats(cameraId);
            if (stats.currentFrames < frameCount) {
                throw new Error(`Expected ${frameCount} frames in buffer, got ${stats.currentFrames}`);
            }
            
            if (capturedFrames < frameCount) {
                throw new Error(`Expected ${frameCount} frames captured, got ${capturedFrames}`);
            }

            console.log(`   ✓ Captured and buffered ${capturedFrames} frames`);
            
        } finally {
            require('child_process').spawn = originalSpawn;
            subscription.unsubscribe();
            await this.captureService.stopCapture(cameraId);
        }
    }

    // Test 2: Multi-camera support
    async testMultiCameraSupport() {
        const cameras = ['camera-1', 'camera-2', 'camera-3'];
        const framesPerCamera = 5;
        const framesByCamera = {};
        
        // Initialize buffers
        cameras.forEach(cameraId => {
            this.bufferManager.initializeBuffer(cameraId, { bufferSize: 10 });
            framesByCamera[cameraId] = 0;
        });
        
        // Subscribe to all cameras
        const subscription = this.bufferManager.subscribe({
            subscriberId: 'multi-camera-subscriber',
            cameraIds: [], // Empty means all cameras
            mode: 'live',
            callback: (frame) => {
                framesByCamera[frame.cameraId]++;
            }
        });

        // Mock FFmpeg spawn
        const originalSpawn = require('child_process').spawn;
        require('child_process').spawn = (cmd, args) => {
            const mockProcess = TestHelpers.createMockFFmpegProcess();
            
            // Extract camera ID from args (mock URL)
            const urlArg = args[args.indexOf('-i') + 1];
            const cameraId = urlArg.split('/').pop();
            
            // Simulate frame output
            setTimeout(async () => {
                for (let i = 0; i < framesPerCamera; i++) {
                    const frameData = TestHelpers.createMockFrame(cameraId, i);
                    mockProcess.stdout.emit('data', frameData);
                    await TestHelpers.delay(100);
                }
            }, 100);
            
            return mockProcess;
        };

        try {
            // Start capture for all cameras
            for (const cameraId of cameras) {
                await this.captureService.startCapture({
                    cameraId,
                    url: `mock://stream/${cameraId}`,
                    ffmpegOptions: { fps: 10 }
                });
            }

            // Wait for frames
            await TestHelpers.delay(framesPerCamera * 100 + 1000);

            // Verify results
            for (const cameraId of cameras) {
                const stats = this.bufferManager.getBufferStats(cameraId);
                if (stats.currentFrames < framesPerCamera) {
                    throw new Error(`Camera ${cameraId}: Expected ${framesPerCamera} frames, got ${stats.currentFrames}`);
                }
                
                if (framesByCamera[cameraId] < framesPerCamera) {
                    throw new Error(`Camera ${cameraId}: Expected ${framesPerCamera} distributed frames, got ${framesByCamera[cameraId]}`);
                }
            }

            console.log(`   ✓ Successfully captured from ${cameras.length} cameras`);
            console.log(`   ✓ Total frames captured: ${Object.values(framesByCamera).reduce((a, b) => a + b, 0)}`);
            
        } finally {
            require('child_process').spawn = originalSpawn;
            subscription.unsubscribe();
            for (const cameraId of cameras) {
                await this.captureService.stopCapture(cameraId);
            }
        }
    }

    // Test 3: Multiple subscribers
    async testMultipleSubscribers() {
        const cameraId = 'test-camera-multi-sub';
        const subscriberCount = 5;
        const frameCount = 10;
        const receivedFrames = {};
        
        this.bufferManager.initializeBuffer(cameraId, { bufferSize: 20 });
        
        // Create multiple subscribers
        const subscriptions = [];
        for (let i = 0; i < subscriberCount; i++) {
            const subscriberId = `subscriber-${i}`;
            receivedFrames[subscriberId] = 0;
            
            const sub = this.bufferManager.subscribe({
                subscriberId,
                cameraIds: [cameraId],
                mode: 'live',
                callback: (frame) => {
                    receivedFrames[subscriberId]++;
                }
            });
            
            subscriptions.push(sub);
        }

        // Mock FFmpeg
        const originalSpawn = require('child_process').spawn;
        require('child_process').spawn = () => {
            const mockProcess = TestHelpers.createMockFFmpegProcess();
            
            setTimeout(async () => {
                for (let i = 0; i < frameCount; i++) {
                    const frameData = TestHelpers.createMockFrame(cameraId, i);
                    mockProcess.stdout.emit('data', frameData);
                    await TestHelpers.delay(50);
                }
            }, 100);
            
            return mockProcess;
        };

        try {
            await this.captureService.startCapture({
                cameraId,
                url: 'mock://test',
                ffmpegOptions: {}
            });

            await TestHelpers.delay(frameCount * 50 + 500);

            // Verify all subscribers received frames
            for (const [subscriberId, count] of Object.entries(receivedFrames)) {
                if (count < frameCount) {
                    throw new Error(`${subscriberId} received only ${count}/${frameCount} frames`);
                }
            }

            console.log(`   ✓ All ${subscriberCount} subscribers received ${frameCount} frames each`);
            
        } finally {
            require('child_process').spawn = originalSpawn;
            subscriptions.forEach(sub => sub.unsubscribe());
            await this.captureService.stopCapture(cameraId);
        }
    }

    // Test 4: Memory management and buffer limits
    async testMemoryManagement() {
        const cameraId = 'test-camera-memory';
        const largeFrameSize = 1024 * 1024; // 1MB per frame
        const maxFrames = 8; // Should hit memory limit before buffer size
        
        this.bufferManager.initializeBuffer(cameraId, { bufferSize: 20 });
        
        let droppedFrames = 0;
        this.bufferManager.on('frame-dropped', (event) => {
            if (event.reason === 'memory-limit') {
                droppedFrames++;
            }
        });

        // Add large frames
        for (let i = 0; i < maxFrames + 5; i++) {
            const frame = {
                id: `frame-${i}`,
                cameraId,
                timestamp: new Date().toISOString(),
                sequenceNumber: i,
                data: Buffer.alloc(largeFrameSize),
                metadata: { size: largeFrameSize }
            };
            
            this.bufferManager.addFrame(frame);
        }

        const stats = this.bufferManager.getStatistics();
        const bufferStats = this.bufferManager.getBufferStats(cameraId);

        if (stats.totalMemoryUsage > this.bufferManager.maxBufferMemory) {
            throw new Error('Memory limit exceeded');
        }

        if (droppedFrames === 0) {
            throw new Error('Expected frames to be dropped due to memory limit');
        }

        console.log(`   ✓ Memory limit enforced: ${stats.totalMemoryUsage} / ${this.bufferManager.maxBufferMemory} bytes`);
        console.log(`   ✓ Dropped ${droppedFrames} frames due to memory constraints`);
        console.log(`   ✓ Current buffer has ${bufferStats.currentFrames} frames`);
    }

    // Test 5: Buffer replay functionality
    async testBufferReplay() {
        const cameraId = 'test-camera-replay';
        const frameCount = 20;
        const replayCount = 10;
        
        this.bufferManager.initializeBuffer(cameraId, { bufferSize: 25 });
        
        // Add frames to buffer
        for (let i = 0; i < frameCount; i++) {
            const frame = {
                id: `frame-${i}`,
                cameraId,
                timestamp: new Date().toISOString(),
                sequenceNumber: i,
                data: TestHelpers.createMockFrame(cameraId, i),
                metadata: { sequenceNumber: i }
            };
            
            this.bufferManager.addFrame(frame);
        }

        // Subscribe with buffer replay
        let replayedFrames = [];
        const subscription = this.bufferManager.subscribe({
            subscriberId: 'replay-subscriber',
            cameraIds: [cameraId],
            mode: 'buffered',
            bufferReplayCount: replayCount,
            callback: (frame) => {
                replayedFrames.push(frame.metadata.sequenceNumber);
            }
        });

        // Wait for replay
        await TestHelpers.delay(200);

        if (replayedFrames.length !== replayCount) {
            throw new Error(`Expected ${replayCount} replayed frames, got ${replayedFrames.length}`);
        }

        // Verify we got the newest frames
        const expectedSequences = Array.from({ length: replayCount }, (_, i) => frameCount - replayCount + i);
        const allMatch = replayedFrames.every((seq, idx) => seq === expectedSequences[idx]);
        
        if (!allMatch) {
            throw new Error('Replayed frames are not the newest ones or in wrong order');
        }

        console.log(`   ✓ Successfully replayed ${replayCount} newest frames`);
        console.log(`   ✓ Frame sequences: ${replayedFrames.join(', ')}`);
        
        subscription.unsubscribe();
    }

    // Test 6: Error handling and recovery
    async testErrorHandlingAndRecovery() {
        const cameraId = 'test-camera-error';
        let errorEmitted = false;
        let captureRestarted = false;
        
        this.captureService.on('error', (error) => {
            errorEmitted = true;
        });
        
        this.captureService.on('capture-started', (event) => {
            if (event.cameraId === cameraId && captureRestarted === false && errorEmitted) {
                captureRestarted = true;
            }
        });

        // Mock FFmpeg with error
        const originalSpawn = require('child_process').spawn;
        let spawnCount = 0;
        require('child_process').spawn = () => {
            spawnCount++;
            const mockProcess = TestHelpers.createMockFFmpegProcess();
            
            if (spawnCount === 1) {
                // First spawn - simulate error
                setTimeout(() => {
                    mockProcess.stderr.emit('data', Buffer.from('Error: Connection refused'));
                    mockProcess.emit('close', 1); // Non-zero exit code
                }, 100);
            } else {
                // Restart - simulate success
                setTimeout(() => {
                    const frameData = TestHelpers.createMockFrame(cameraId, 1);
                    mockProcess.stdout.emit('data', frameData);
                }, 100);
            }
            
            return mockProcess;
        };

        try {
            this.captureService.isRunning = true; // Enable auto-restart
            
            await this.captureService.startCapture({
                cameraId,
                url: 'mock://error-test',
                ffmpegOptions: {}
            });

            // Wait for error and restart
            await TestHelpers.delay(6000); // Auto-restart has 5s delay

            if (!errorEmitted) {
                throw new Error('Error event was not emitted');
            }
            
            if (!captureRestarted) {
                throw new Error('Capture was not automatically restarted after error');
            }

            console.log(`   ✓ Error was properly emitted`);
            console.log(`   ✓ Capture automatically restarted after failure`);
            
        } finally {
            require('child_process').spawn = originalSpawn;
            this.captureService.isRunning = false;
            await this.captureService.stopCapture(cameraId);
        }
    }

    // Test 7: Get frames functionality
    async testGetFramesFunctionality() {
        const cameraId = 'test-camera-get-frames';
        const frameCount = 30;
        
        this.bufferManager.initializeBuffer(cameraId, { bufferSize: 25 });
        
        // Add frames
        for (let i = 0; i < frameCount; i++) {
            const frame = {
                id: `frame-${i}`,
                cameraId,
                timestamp: new Date().toISOString(),
                sequenceNumber: i,
                data: Buffer.from(`Frame ${i}`),
                metadata: { index: i }
            };
            
            this.bufferManager.addFrame(frame);
        }

        // Test getting newest frames
        const newestFrames = this.bufferManager.getFrames(cameraId, 10, true);
        if (newestFrames.length !== 10) {
            throw new Error(`Expected 10 newest frames, got ${newestFrames.length}`);
        }
        
        if (newestFrames[9].metadata.index !== 29) {
            throw new Error('Newest frames are not correct');
        }

        // Test getting oldest frames
        const oldestFrames = this.bufferManager.getFrames(cameraId, 10, false);
        if (oldestFrames.length !== 10) {
            throw new Error(`Expected 10 oldest frames, got ${oldestFrames.length}`);
        }
        
        // When buffer is full (25), oldest would be frame 5 (30-25)
        if (oldestFrames[0].metadata.index !== 5) {
            throw new Error('Oldest frames are not correct');
        }

        // Test getting latest single frame
        const latestFrame = this.bufferManager.getLatestFrame(cameraId);
        if (!latestFrame || latestFrame.metadata.index !== 29) {
            throw new Error('Latest frame is not correct');
        }

        console.log(`   ✓ getFrames() returns correct newest frames`);
        console.log(`   ✓ getFrames() returns correct oldest frames`);
        console.log(`   ✓ getLatestFrame() returns the most recent frame`);
    }

    // Test 8: Performance under load
    async testPerformanceUnderLoad() {
        const cameraCount = 5;
        const framesPerSecond = 15;
        const testDuration = 3000; // 3 seconds
        const cameras = Array.from({ length: cameraCount }, (_, i) => `perf-camera-${i}`);
        
        const frameCountByCamera = {};
        const startTime = Date.now();
        
        // Initialize buffers and subscribe
        cameras.forEach(cameraId => {
            this.bufferManager.initializeBuffer(cameraId, { bufferSize: 100 });
            frameCountByCamera[cameraId] = 0;
        });
        
        const subscription = this.bufferManager.subscribe({
            subscriberId: 'perf-subscriber',
            cameraIds: [],
            mode: 'live',
            callback: (frame) => {
                frameCountByCamera[frame.cameraId]++;
            }
        });

        // Mock high-speed FFmpeg
        const originalSpawn = require('child_process').spawn;
        require('child_process').spawn = (cmd, args) => {
            const mockProcess = TestHelpers.createMockFFmpegProcess();
            const urlArg = args[args.indexOf('-i') + 1];
            const cameraId = urlArg.split('/').pop();
            
            // Simulate continuous frame output
            const interval = setInterval(() => {
                const frameData = TestHelpers.createMockFrame(cameraId, Date.now());
                mockProcess.stdout.emit('data', frameData);
            }, 1000 / framesPerSecond);
            
            mockProcess.on('close', () => clearInterval(interval));
            
            return mockProcess;
        };

        try {
            // Start all cameras
            for (const cameraId of cameras) {
                await this.captureService.startCapture({
                    cameraId,
                    url: `mock://perf/${cameraId}`,
                    ffmpegOptions: { fps: framesPerSecond }
                });
            }

            // Run for test duration
            await TestHelpers.delay(testDuration);
            
            // Stop all cameras
            for (const cameraId of cameras) {
                await this.captureService.stopCapture(cameraId);
            }

            const elapsedTime = Date.now() - startTime;
            const totalFrames = Object.values(frameCountByCamera).reduce((a, b) => a + b, 0);
            const expectedFrames = cameraCount * framesPerSecond * (testDuration / 1000);
            const efficiency = (totalFrames / expectedFrames) * 100;

            console.log(`   ✓ Processed ${totalFrames} frames in ${elapsedTime}ms`);
            console.log(`   ✓ Efficiency: ${efficiency.toFixed(1)}% (${totalFrames}/${Math.floor(expectedFrames)} expected)`);
            console.log(`   ✓ Average FPS per camera: ${(totalFrames / cameraCount / (elapsedTime / 1000)).toFixed(1)}`);
            
            if (efficiency < 80) {
                throw new Error(`Performance too low: ${efficiency.toFixed(1)}% efficiency`);
            }
            
        } finally {
            require('child_process').spawn = originalSpawn;
            subscription.unsubscribe();
        }
    }

    // Run all tests
    async runAllTests() {
        console.log('🚀 Starting Frame Capture Integration Tests\n');
        console.log('='.repeat(50));
        
        await this.setUp();
        
        await this.runTest('Basic Frame Capture and Buffering', this.testBasicFrameCapture);
        await this.runTest('Multi-Camera Support', this.testMultiCameraSupport);
        await this.runTest('Multiple Subscribers', this.testMultipleSubscribers);
        await this.runTest('Memory Management and Buffer Limits', this.testMemoryManagement);
        await this.runTest('Buffer Replay Functionality', this.testBufferReplay);
        await this.runTest('Error Handling and Recovery', this.testErrorHandlingAndRecovery);
        await this.runTest('Get Frames Functionality', this.testGetFramesFunctionality);
        await this.runTest('Performance Under Load', this.testPerformanceUnderLoad);
        
        await this.tearDown();
        
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

// Run tests if executed directly
if (require.main === module) {
    const test = new FrameCaptureIntegrationTest();
    test.runAllTests()
        .then(results => {
            process.exit(results.failed > 0 ? 1 : 0);
        })
        .catch(error => {
            console.error('Test runner error:', error);
            process.exit(1);
        });
}

module.exports = FrameCaptureIntegrationTest;