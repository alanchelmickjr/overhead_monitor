#!/usr/bin/env node

const http = require('http');
const https = require('https');

const PORT = process.env.PORT || 3000;
const BASE_URL = `http://localhost:${PORT}`;

console.log('🧪 Testing Routing Configuration');
console.log('================================\n');

async function testRoute(path, expectedFile) {
    return new Promise((resolve) => {
        http.get(`${BASE_URL}${path}`, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                const success = res.statusCode === 200;
                const contentType = res.headers['content-type'];
                const isHTML = contentType && contentType.includes('text/html');
                
                console.log(`${success ? '✅' : '❌'} GET ${path}`);
                console.log(`   Status: ${res.statusCode}`);
                console.log(`   Content-Type: ${contentType || 'Not set'}`);
                
                if (success && isHTML) {
                    // Check for specific content to verify correct file
                    if (expectedFile === 'test-camera-stream-llava.html' && data.includes('llava')) {
                        console.log(`   ✓ Serving correct file: ${expectedFile}`);
                    } else if (expectedFile === 'camera-viewer.html' && data.includes('camera-viewer')) {
                        console.log(`   ✓ Serving correct file: ${expectedFile}`);
                    } else if (expectedFile === 'not-index' && !data.includes('<title>Robot Overhead Monitor</title>')) {
                        console.log(`   ✓ NOT serving public/index.html`);
                    } else {
                        console.log(`   ⚠️  May not be serving expected file: ${expectedFile}`);
                    }
                }
                console.log('');
                resolve();
            });
        }).on('error', (err) => {
            console.log(`❌ GET ${path}`);
            console.log(`   Error: ${err.message}`);
            console.log('   Make sure the server is running on port', PORT);
            console.log('');
            resolve();
        });
    });
}

async function runTests() {
    console.log(`Testing against ${BASE_URL}\n`);
    
    // Test homepage
    await testRoute('/', 'test-camera-stream-llava.html');
    
    // Test settings page
    await testRoute('/settings', 'camera-viewer.html');
    
    // Test that public/index.html is not served at root
    await testRoute('/', 'not-index');
    
    // Test that static assets are still accessible
    await testRoute('/styles.css', 'styles.css');
    
    console.log('\n📋 Testing Complete!');
    console.log('\nTo manually verify:');
    console.log('1. Start the server: npm start');
    console.log('2. Open http://localhost:3000 - should show test-camera-stream-llava.html');
    console.log('3. Open http://localhost:3000/settings - should show camera-viewer.html');
    console.log('4. Verify that public/index.html is NOT shown at the homepage');
}

// Check if server is running before testing
http.get(`${BASE_URL}/health`, (res) => {
    console.log('✅ Server is running, starting tests...\n');
    runTests();
}).on('error', () => {
    console.log('⚠️  Server is not running!');
    console.log('\nPlease start the server first:');
    console.log('  npm start\n');
    console.log('Then run this test again:');
    console.log('  node test-routing.js\n');
});