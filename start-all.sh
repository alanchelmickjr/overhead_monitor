#!/bin/bash

# ========================================
# Overhead Monitor - ONE BUTTON STARTUP
# ========================================
# This script handles EVERYTHING automatically:
# - Installs llama.cpp if missing
# - Downloads models if missing  
# - Installs Node.js dependencies
# - Starts all services

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Starting Overhead Monitor System...${NC}"
echo "========================================"

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# System detection
detect_system() {
    if [[ "$OSTYPE" == "darwin"* ]]; then
        SYSTEM="macos"
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        SYSTEM="linux"
    else
        log_error "Unsupported operating system: $OSTYPE"
        exit 1
    fi
}

# Install llama.cpp if missing
install_llama_cpp() {
    # Check if llama-server already exists
    if command -v llama-server &> /dev/null; then
        LLAMA_SERVER_PATH=$(which llama-server)
        log_success "llama-server found at: $LLAMA_SERVER_PATH"
        return 0
    fi
    
    log_info "llama.cpp not found, installing..."
    
    if [[ "$SYSTEM" == "macos" ]]; then
        # Install via Homebrew on macOS
        if ! command -v brew &> /dev/null; then
            log_info "Installing Homebrew..."
            /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
        fi
        
        log_info "Installing llama.cpp via Homebrew (optimized for M4)..."
        # Install with Metal acceleration for M4
        brew install llama.cpp
        
        # Find the installed binary
        if [ -f "/opt/homebrew/bin/llama-server" ]; then
            LLAMA_SERVER_PATH="/opt/homebrew/bin/llama-server"
        elif [ -f "/usr/local/bin/llama-server" ]; then
            LLAMA_SERVER_PATH="/usr/local/bin/llama-server"
        else
            LLAMA_SERVER_PATH=$(find /opt/homebrew /usr/local -name "llama-server" 2>/dev/null | head -1)
        fi
    else
        # Build from source on Linux
        log_info "Building llama.cpp from source..."
        
        # Install dependencies
        if command -v apt-get &> /dev/null; then
            sudo apt-get update
            sudo apt-get install -y build-essential cmake git
        elif command -v yum &> /dev/null; then
            sudo yum install -y gcc-c++ make cmake git
        fi
        
        LLAMA_DIR="$HOME/llama.cpp"
        if [ ! -d "$LLAMA_DIR" ]; then
            git clone https://github.com/ggerganov/llama.cpp.git "$LLAMA_DIR"
        fi
        
        cd "$LLAMA_DIR"
        git pull
        make clean
        make -j$(nproc)
        
        LLAMA_SERVER_PATH="$LLAMA_DIR/llama-server"
        sudo ln -sf "$LLAMA_SERVER_PATH" /usr/local/bin/llama-server
        cd - > /dev/null
    fi
    
    if [ ! -f "$LLAMA_SERVER_PATH" ]; then
        log_error "Failed to install llama.cpp"
        exit 1
    fi
    
    log_success "llama.cpp installed: $LLAMA_SERVER_PATH"
}

# Download models if missing
download_models() {
    MODEL_DIR="$HOME/models"
    mkdir -p "$MODEL_DIR/smolvlm"
    
    # Define model paths
    CACHE_MODEL="$HOME/Library/Caches/llama.cpp/ggml-org_SmolVLM-500M-Instruct-GGUF_SmolVLM-500M-Instruct-Q8_0.gguf"
    CACHE_MMPROJ="$HOME/Library/Caches/llama.cpp/ggml-org_SmolVLM-500M-Instruct-GGUF_mmproj-SmolVLM-500M-Instruct-Q8_0.gguf"
    LOCAL_MODEL="$MODEL_DIR/smolvlm/ggml-model-q4_k.gguf"
    LOCAL_MMPROJ="$MODEL_DIR/smolvlm/mmproj-model-f16.gguf"
    
    # Check if models exist
    if [ -f "$CACHE_MODEL" ] && [ -f "$CACHE_MMPROJ" ]; then
        MODEL_PATH="$CACHE_MODEL"
        MMPROJ_PATH="$CACHE_MMPROJ"
        log_success "Models found in cache"
    elif [ -f "$LOCAL_MODEL" ] && [ -f "$LOCAL_MMPROJ" ]; then
        MODEL_PATH="$LOCAL_MODEL"
        MMPROJ_PATH="$LOCAL_MMPROJ"
        log_success "Models found locally"
    else
        log_info "Downloading LLaVA 1.5 models (more stable than SmolVLM)..."
        
        # Install wget if missing on macOS
        if [[ "$SYSTEM" == "macos" ]] && ! command -v wget &> /dev/null; then
            brew install wget
        fi
        
        # Download LLaVA 1.5 models (known to work with llama.cpp)
        wget -O "$LOCAL_MODEL" "https://huggingface.co/mys/ggml_llava-v1.5-7b/resolve/main/ggml-model-q4_k.gguf"
        wget -O "$LOCAL_MMPROJ" "https://huggingface.co/mys/ggml_llava-v1.5-7b/resolve/main/mmproj-model-f16.gguf"
        
        MODEL_PATH="$LOCAL_MODEL"
        MMPROJ_PATH="$LOCAL_MMPROJ"
        log_success "Models downloaded"
    fi
}

# Install Node.js dependencies
install_node_deps() {
    if [ -f "package.json" ] && [ ! -d "node_modules" ]; then
        log_info "Installing Node.js dependencies..."
        npm install
        log_success "Node.js dependencies installed"
    fi
}

# Function to check if a service is running
check_service() {
    local port=$1
    local name=$2
    if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
        echo -e "${GREEN}✅ $name is running on port $port${NC}"
        return 0
    else
        echo -e "${RED}❌ $name is not running on port $port${NC}"
        return 1
    fi
}

# Function to wait for service to start
wait_for_service() {
    local port=$1
    local name=$2
    local timeout=${3:-30}
    
    echo -e "${YELLOW}⏳ Waiting for $name to start on port $port...${NC}"
    
    for i in $(seq 1 $timeout); do
        if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
            echo -e "${GREEN}✅ $name is ready!${NC}"
            return 0
        fi
        sleep 1
    done
    
    echo -e "${RED}❌ Timeout waiting for $name to start${NC}"
    return 1
}

# AUTO-SETUP: Install everything if missing
log_info "Checking and installing dependencies..."
detect_system
install_llama_cpp
download_models
install_node_deps

# Kill any existing processes
echo -e "${YELLOW}🧹 Cleaning up existing processes...${NC}"
pkill -f "node.*server.js" || true
pkill -f "node.*camera-server.js" || true
pkill -f "node.*robot-monitor-server.js" || true
pkill -f "llama-server" || true
sleep 2

# Start llama.cpp server directly
echo -e "${BLUE}🤖 Starting llama.cpp server...${NC}"
echo -e "${GREEN}Using llama-server: $LLAMA_SERVER_PATH${NC}"
echo -e "${GREEN}Using model: $MODEL_PATH${NC}"
echo -e "${GREEN}Using mmproj: $MMPROJ_PATH${NC}"

# Check if port 8080 is already in use
if lsof -Pi :8080 -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo -e "${YELLOW}Warning: Port 8080 is already in use. Stopping existing process...${NC}"
    pkill -f "llama-server.*port 8080" || true
    sleep 2
fi

# Start llama.cpp server with LLaVA-optimized parameters
"$LLAMA_SERVER_PATH" \
    --model "$MODEL_PATH" \
    --mmproj "$MMPROJ_PATH" \
    --host 0.0.0.0 \
    --port 8080 \
    --ctx-size 4096 \
    --threads 4 \
    --gpu-layers 32 \
    --batch-size 512 \
    --ubatch-size 512 \
    --verbose &

LLAMA_PID=$!
echo "llama-server started with PID: $LLAMA_PID"

# Wait for llama server to be ready
if wait_for_service 8080 "llama.cpp server" 60; then
    echo -e "${GREEN}✅ llama.cpp server started successfully${NC}"
else
    echo -e "${RED}❌ Failed to start llama.cpp server${NC}"
    kill $LLAMA_PID 2>/dev/null || true
    exit 1
fi

# Start camera monitoring services directly
echo -e "${BLUE}📹 Starting camera monitoring services...${NC}"

# Start camera server
if [ -f "camera-server.js" ]; then
    node camera-server.js &
    CAMERA_PID=$!
fi

# Start RTSP proxy
if [ -f "rtsp-proxy.js" ]; then
    node rtsp-proxy.js &
    RTSP_PID=$!
fi

# Start robot monitor - use enhanced version with multi-model support
if [ -f "robot-monitor-server-enhanced.js" ]; then
    log_info "Starting enhanced robot monitor with multi-model support..."
    node robot-monitor-server-enhanced.js &
    ROBOT_PID=$!
elif [ -f "robot-monitor-server.js" ]; then
    log_info "Starting standard robot monitor..."
    node robot-monitor-server.js &
    ROBOT_PID=$!
fi

# Wait for camera services to be ready
if wait_for_service 3000 "camera viewer" 30; then
    echo -e "${GREEN}✅ Camera viewer started successfully${NC}"
else
    echo -e "${YELLOW}⚠️  Camera viewer may not be ready yet${NC}"
fi

if wait_for_service 3001 "RTSP proxy" 30; then
    echo -e "${GREEN}✅ RTSP proxy started successfully${NC}"
else
    echo -e "${YELLOW}⚠️  RTSP proxy may not be ready yet${NC}"
fi

# Final status check
echo ""
echo "========================================"
echo -e "${BLUE}📊 Service Status Check${NC}"
echo "========================================"

check_service 8080 "llama.cpp server"
check_service 3000 "Camera viewer"
check_service 3001 "RTSP proxy"

echo ""
echo "========================================"
echo -e "${GREEN}🎉 System Ready!${NC}"
echo "========================================"
echo ""
echo -e "${GREEN}📱 Access Points:${NC}"
echo "   • Camera viewer: http://localhost:3000"
echo "   • RTSP proxy/Robot Monitor: http://localhost:3001"
echo "   • LLaVA test: http://localhost:3000"
echo "   • LLaVA API: http://localhost:8080/v1/chat/completions"
echo ""
echo -e "${GREEN}✨ Multi-Model Features:${NC}"
echo "   • Model switching: Use dropdown in header"
echo "   • Benchmark models: Click ⚡ button"
echo "   • Compare models: Click 📊 button"
echo ""
echo -e "${YELLOW}💡 Tip: Open http://localhost:3000 in Safari for best performance${NC}"
echo -e "${YELLOW}🛑 Press Ctrl+C to stop all services${NC}"
echo ""

# Trap to cleanup on exit
trap 'echo -e "\n${YELLOW}🛑 Shutting down services...${NC}"; pkill -f "llama-server" || true; pkill -f "node.*server.js" || true; pkill -f "node.*camera-server.js" || true; pkill -f "node.*robot-monitor-server.js" || true; echo -e "${GREEN}✅ All services stopped${NC}"; exit 0' INT TERM

# Keep the script running and monitor services
while true; do
    sleep 10
    
    # Check if critical services are still running
    if ! lsof -Pi :8080 -sTCP:LISTEN -t >/dev/null 2>&1; then
        echo -e "${RED}❌ llama.cpp server stopped unexpectedly${NC}"
        break
    fi
    
    if ! lsof -Pi :3000 -sTCP:LISTEN -t >/dev/null 2>&1; then
        echo -e "${RED}❌ Camera viewer stopped unexpectedly${NC}"
        break
    fi
done

echo -e "${RED}💥 One or more services failed. Exiting...${NC}"
exit 1