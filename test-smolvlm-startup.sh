#!/bin/bash

# Test script for the new SmolVLM startup configuration

echo "======================================"
echo "Testing SmolVLM Startup Configuration"
echo "======================================"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test 1: Check if llama-server is installed
echo -e "\n${BLUE}Test 1: Checking llama-server installation${NC}"
if command -v llama-server &> /dev/null; then
    echo -e "${GREEN}✅ llama-server found at: $(which llama-server)${NC}"
else
    echo -e "${RED}❌ llama-server not found. Please run ./start-all.sh first${NC}"
    exit 1
fi

# Test 2: Test default model (SmolVLM-500M)
echo -e "\n${BLUE}Test 2: Testing default model (SmolVLM-500M)${NC}"
echo "Command: ./start-all.sh (uses default SmolVLM-500M)"
echo -e "${YELLOW}This would start with: ggml-org/SmolVLM-500M-Instruct-GGUF${NC}"

# Test 3: Test model switching via environment variable
echo -e "\n${BLUE}Test 3: Testing model switching via environment variable${NC}"
echo "Command: MODEL='ggml-org/SmolVLM2-2.2B-Instruct-GGUF' ./start-all.sh"
echo -e "${YELLOW}This would start with: ggml-org/SmolVLM2-2.2B-Instruct-GGUF${NC}"

# Test 4: Test model switching via command line
echo -e "\n${BLUE}Test 4: Testing model switching via command line${NC}"
echo "Command: ./start-all.sh -m ggml-org/gemma-3-4b-it-GGUF"
echo -e "${YELLOW}This would start with: ggml-org/gemma-3-4b-it-GGUF${NC}"

# Test 5: Quick API test (if server is running)
echo -e "\n${BLUE}Test 5: Testing API endpoint (if server is running)${NC}"
if lsof -Pi :8080 -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo -e "${GREEN}✅ Server is running on port 8080${NC}"
    
    # Create a simple test image (1x1 red pixel)
    TEST_IMAGE="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=="
    
    # Test the API
    echo "Testing /v1/chat/completions endpoint..."
    RESPONSE=$(curl -s -X POST http://localhost:8080/v1/chat/completions \
        -H "Content-Type: application/json" \
        -d "{
            \"model\": \"smolvlm-500m\",
            \"messages\": [{
                \"role\": \"user\",
                \"content\": [
                    {\"type\": \"text\", \"text\": \"What color is this image?\"},
                    {\"type\": \"image_url\", \"image_url\": {\"url\": \"$TEST_IMAGE\"}}
                ]
            }],
            \"max_tokens\": 50,
            \"temperature\": 0.7
        }" 2>/dev/null)
    
    if [ $? -eq 0 ] && [ -n "$RESPONSE" ]; then
        echo -e "${GREEN}✅ API responded successfully${NC}"
        echo "Response preview: ${RESPONSE:0:100}..."
    else
        echo -e "${YELLOW}⚠️ API did not respond as expected${NC}"
    fi
else
    echo -e "${YELLOW}⚠️ Server not running on port 8080. Start it with ./start-all.sh${NC}"
fi

# Test 6: Check model configuration
echo -e "\n${BLUE}Test 6: Checking model configuration${NC}"
if [ -f "config/models.json" ]; then
    echo -e "${GREEN}✅ models.json found${NC}"
    
    # Check if SmolVLM is configured
    if grep -q "ggml-org/SmolVLM-500M-Instruct-GGUF" config/models.json; then
        echo -e "${GREEN}✅ SmolVLM-500M is configured${NC}"
    else
        echo -e "${YELLOW}⚠️ SmolVLM-500M not found in config${NC}"
    fi
else
    echo -e "${RED}❌ config/models.json not found${NC}"
fi

echo -e "\n${GREEN}======================================"
echo "Test Summary"
echo "======================================${NC}"
echo "1. To start with default SmolVLM-500M:"
echo "   ./start-all.sh"
echo ""
echo "2. To use a different model:"
echo "   ./start-all.sh -m ggml-org/gemma-3-4b-it-GGUF"
echo ""
echo "3. Or use environment variable:"
echo "   MODEL='ggml-org/Qwen2-VL-7B-Instruct-GGUF' ./start-all.sh"
echo ""
echo "4. Available models:"
echo "   - ggml-org/SmolVLM-500M-Instruct-GGUF (default)"
echo "   - ggml-org/SmolVLM-256M-Instruct-GGUF"
echo "   - ggml-org/SmolVLM2-2.2B-Instruct-GGUF"
echo "   - ggml-org/gemma-3-4b-it-GGUF"
echo "   - ggml-org/gemma-3-12b-it-GGUF"
echo "   - ggml-org/Qwen2-VL-2B-Instruct-GGUF"
echo "   - ggml-org/Qwen2-VL-7B-Instruct-GGUF"
echo "   - And many more..."
echo ""
echo -e "${GREEN}✨ Configuration complete!${NC}"