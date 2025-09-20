#!/usr/bin/env node

const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

// Test configuration
const LLAMA_CPP_URL = 'http://localhost:8080/v1/chat/completions';
const TEST_IMAGE_PATH = path.join(__dirname, 'test-camera-stream-llava.html'); // We'll create a test image

async function createTestImage() {
    // Create a simple test image as base64
    const canvas = `<svg width="200" height="200" xmlns="http://www.w3.org/2000/svg">
        <rect width="200" height="200" fill="blue"/>
        <text x="50%" y="50%" text-anchor="middle" fill="white" font-size="20">TEST IMAGE</text>
    </svg>`;
    
    const base64 = Buffer.from(canvas).toString('base64');
    return `data:image/svg+xml;base64,${base64}`;
}

async function testLlamaCppFormat() {
    console.log('🧪 Testing llama.cpp image format...\n');
    
    try {
        // Create test image
        const imageBase64 = await createTestImage();
        console.log('✅ Test image created (SVG as base64)');
        console.log(`   Image data URI length: ${imageBase64.length} chars\n`);
        
        // Test request with OpenAI format (what the notebook shows works)
        const requestBody = {
            model: 'smolvlm-500m',
            messages: [
                {
                    role: 'user',
                    content: [
                        {
                            type: 'text',
                            text: 'What do you see in this image?'
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
            max_tokens: 100,
            temperature: 0.7
        };
        
        console.log('📤 Sending request to llama.cpp...');
        console.log(`   URL: ${LLAMA_CPP_URL}`);
        console.log(`   Format: OpenAI-compatible (image_url with url property)`);
        console.log(`   Model: ${requestBody.model}`);
        console.log(`   Message structure: text + image_url\n`);
        
        const response = await axios.post(LLAMA_CPP_URL, requestBody, {
            timeout: 30000,
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        console.log('✅ Response received successfully!');
        console.log('📝 Response content:');
        console.log(`   ${response.data.choices[0].message.content}\n`);
        
        // Test our VisionEngine
        console.log('🔧 Testing VisionEngine integration...\n');
        const VisionEngine = require('./src/vision/VisionEngine');
        const visionEngine = new VisionEngine({
            base_url: 'http://localhost:8080'
        });
        
        const frameData = {
            timestamp: new Date().toISOString(),
            cameraId: 'test',
            image: imageBase64
        };
        
        const analysis = await visionEngine.analyzeFrame(frameData, 'What do you see?');
        console.log('✅ VisionEngine analysis successful!');
        console.log(`   Content: ${analysis.content}`);
        console.log(`   Processing time: ${analysis.processingTime}ms`);
        console.log(`   Model: ${analysis.modelId}\n`);
        
        console.log('🎉 All tests passed! Image format is working correctly.');
        
    } catch (error) {
        console.error('❌ Test failed!');
        console.error(`   Error: ${error.message}`);
        
        if (error.response) {
            console.error(`   HTTP Status: ${error.response.status}`);
            console.error(`   Response: ${JSON.stringify(error.response.data, null, 2)}`);
        }
        
        console.error('\n💡 Troubleshooting tips:');
        console.error('   1. Make sure llama.cpp server is running on port 8080');
        console.error('   2. Verify the model is loaded (smolvlm-500m)');
        console.error('   3. Check that the server supports /v1/chat/completions endpoint');
        console.error('   4. Ensure the server was started with multimodal support');
        
        process.exit(1);
    }
}

// Run the test
testLlamaCppFormat().catch(console.error);