#!/bin/bash

# Start llama.cpp server with SmolVLM for vision analysis
# Auto-configured by setup-devops.sh

echo "Starting llama.cpp server with SmolVLM..."
echo "======================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Try to find llama-server in common locations
LLAMA_SERVER=""
if command -v llama-server &> /dev/null; then
    LLAMA_SERVER=$(which llama-server)
elif [ -f "/opt/homebrew/bin/llama-server" ]; then
    LLAMA_SERVER="/opt/homebrew/bin/llama-server"
elif [ -f "/usr/local/bin/llama-server" ]; then
    LLAMA_SERVER="/usr/local/bin/llama-server"
elif [ -f "$HOME/llama.cpp/llama-server" ]; then
    LLAMA_SERVER="$HOME/llama.cpp/llama-server"
fi

# Try to find models in common locations
MODEL_PATH=""
MMPROJ_PATH=""

# Check cache first
if [ -f "$HOME/Library/Caches/llama.cpp/ggml-org_SmolVLM-500M-Instruct-GGUF_SmolVLM-500M-Instruct-Q8_0.gguf" ]; then
    MODEL_PATH="$HOME/Library/Caches/llama.cpp/ggml-org_SmolVLM-500M-Instruct-GGUF_SmolVLM-500M-Instruct-Q8_0.gguf"
    MMPROJ_PATH="$HOME/Library/Caches/llama.cpp/ggml-org_SmolVLM-500M-Instruct-GGUF_mmproj-SmolVLM-500M-Instruct-Q8_0.gguf"
# Check local models directory
elif [ -f "$HOME/models/smolvlm/SmolVLM-500M-Instruct-Q8_0.gguf" ]; then
    MODEL_PATH="$HOME/models/smolvlm/SmolVLM-500M-Instruct-Q8_0.gguf"
    MMPROJ_PATH="$HOME/models/smolvlm/mmproj-SmolVLM-500M-Instruct-Q8_0.gguf"
fi

# Check if llama-server exists
if [ -z "$LLAMA_SERVER" ] || [ ! -f "$LLAMA_SERVER" ]; then
    echo -e "${RED}Error: llama-server not found${NC}"
    echo -e "${YELLOW}Please run ./setup-devops.sh to install llama.cpp${NC}"
    exit 1
fi

# Check if models exist
if [ -z "$MODEL_PATH" ] || [ ! -f "$MODEL_PATH" ]; then
    echo -e "${RED}Error: SmolVLM model not found${NC}"
    echo -e "${YELLOW}Please run ./setup-devops.sh to download the model${NC}"
    exit 1
fi

if [ -z "$MMPROJ_PATH" ] || [ ! -f "$MMPROJ_PATH" ]; then
    echo -e "${RED}Error: MMProj model not found${NC}"
    echo -e "${YELLOW}Please run ./setup-devops.sh to download the model${NC}"
    exit 1
fi

echo -e "${GREEN}Using llama-server: $LLAMA_SERVER${NC}"
echo -e "${GREEN}Using model: $MODEL_PATH${NC}"
echo -e "${GREEN}Using mmproj: $MMPROJ_PATH${NC}"

# Check if port 8080 is already in use
if lsof -Pi :8080 -sTCP:LISTEN -t >/dev/null ; then
    echo -e "${YELLOW}Warning: Port 8080 is already in use. Stopping existing process...${NC}"
    pkill -f "llama-server.*port 8080" || true
    sleep 2
fi

echo -e "${GREEN}Starting llama.cpp server...${NC}"

# Start the server with vision support
"$LLAMA_SERVER" \
    --model "$MODEL_PATH" \
    --mmproj "$MMPROJ_PATH" \
    --host 0.0.0.0 \
    --port 8080 \
    --ctx-size 2048 \
    --n-predict 512 \
    --parallel 2 \
    --cont-batching \
    --embedding \
    --multimodal \
    --log-disable &

LLAMA_PID=$!
echo "llama-server started with PID: $LLAMA_PID"

# Wait a moment and check if it's running
sleep 3
if kill -0 $LLAMA_PID 2>/dev/null; then
    echo -e "${GREEN}✅ llama.cpp server is running${NC}"
    echo "Server: http://localhost:8080"
    echo "API endpoint: http://localhost:8080/v1/chat/completions"
    echo "Health check: http://localhost:8080/health"
else
    echo -e "${RED}❌ Failed to start llama.cpp server${NC}"
    exit 1
fi

# Keep the script running
wait $LLAMA_PID