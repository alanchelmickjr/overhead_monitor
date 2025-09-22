#!/bin/bash

# ========================================
# LeKiwi Pen Nanny Cam - ONE BUTTON STARTUP
# ========================================
# This script handles EVERYTHING automatically:
# - Installs llama.cpp if missing
# - Downloads models if missing
# - Installs Node.js dependencies
# - Starts all services
# - Configures and starts ngrok tunnels

set -e  # Exit on error

# Parse command line arguments
DEBUG_MODE=false
SHOW_HELP=false

for arg in "$@"; do
    case $arg in
        -d|--debug)
            DEBUG_MODE=true
            shift
            ;;
        -h|--help)
            SHOW_HELP=true
            shift
            ;;
        *)
            ;;
    esac
done

# Show help if requested
if [ "$SHOW_HELP" = true ]; then
    echo "LeKiwi Pen Nanny Cam - Startup Script"
    echo ""
    echo "Usage: ./start-all.sh [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -d, --debug    Enable debug output (verbose logging)"
    echo "  -h, --help     Show this help message"
    echo ""
    echo "Examples:"
    echo "  ./start-all.sh          # Start in quiet mode (default)"
    echo "  ./start-all.sh --debug  # Start with debug output enabled"
    echo ""
    exit 0
fi

# Export DEBUG environment variable for Node.js processes
export DEBUG=$DEBUG_MODE

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${BLUE}🦜 Starting LeKiwi Pen Nanny Cam System...${NC}"
if [ "$DEBUG_MODE" = true ]; then
    echo -e "${YELLOW}🔍 Debug mode enabled${NC}"
fi
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

log_debug() {
    if [ "$DEBUG_MODE" = true ]; then
        echo -e "${CYAN}[DEBUG]${NC} $1"
    fi
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

# Check and install ngrok
check_ngrok() {
    log_debug "Checking ngrok installation..."
    
    if ! command -v ngrok &> /dev/null; then
        log_warning "ngrok not found. Installing..."
        
        if [[ "$SYSTEM" == "macos" ]]; then
            if command -v brew &> /dev/null; then
                brew install ngrok
            else
                log_error "Please install Homebrew first or download ngrok from https://ngrok.com"
                exit 1
            fi
        else
            # Linux installation
            curl -s https://ngrok-agent.s3.amazonaws.com/ngrok.asc | sudo tee /etc/apt/trusted.gpg.d/ngrok.asc >/dev/null
            echo "deb https://ngrok-agent.s3.amazonaws.com buster main" | sudo tee /etc/apt/sources.list.d/ngrok.list
            sudo apt update && sudo apt install ngrok
        fi
    fi
    
    log_success "ngrok is installed: $(ngrok version)"
    
    # Check for authtoken
    if ! ngrok config check &>/dev/null; then
        log_warning "ngrok authtoken not configured!"
        echo -e "${CYAN}🚀 Would you like to set up ngrok now for remote access? (y/n)${NC}"
        read -r setup_response
        
        if [[ "$setup_response" =~ ^[Yy]$ ]]; then
            # Run automated setup
            if [[ -f "./setup-ngrok.sh" ]]; then
                echo -e "${BLUE}Starting automated ngrok setup...${NC}"
                ./setup-ngrok.sh
                
                # Check if setup was successful
                if ngrok config check &>/dev/null; then
                    log_success "ngrok setup completed!"
                    SKIP_NGROK=false
                else
                    log_warning "ngrok setup was not completed"
                    SKIP_NGROK=true
                fi
            else
                echo -e "${YELLOW}setup-ngrok.sh not found. Manual setup required:${NC}"
                echo -e "${YELLOW}1. Run: ngrok config add-authtoken YOUR_TOKEN${NC}"
                echo -e "${YELLOW}2. Get token from: https://dashboard.ngrok.com/get-started/your-authtoken${NC}"
                SKIP_NGROK=true
            fi
        else
            echo -e "${YELLOW}Continuing in local mode without remote access.${NC}"
            SKIP_NGROK=true
        fi
    else
        SKIP_NGROK=false
    fi
}

# Start ngrok tunnels
start_ngrok() {
    if [[ "$SKIP_NGROK" == "true" ]]; then
        return 0
    fi
    
    log_debug "Starting ngrok tunnels..."
    
    # Kill any existing ngrok processes to prevent domain conflicts
    pkill -f "ngrok" || true
    pkill -9 -f "ngrok" || true
    sleep 3
    
    # Start ngrok tunnels with custom domains (Pay-as-you-go plan requires registered domains)
    ngrok start robot-monitor frontiertower --config ngrok.yml &
    NGROK_PID=$!
    
    # Wait for ngrok to start
    sleep 3
    
    # Get tunnel URLs from ngrok API
    if command -v curl &> /dev/null; then
        NGROK_API_RESPONSE=$(curl -s http://localhost:4040/api/tunnels 2>/dev/null || echo "{}")
        
        if [[ "$NGROK_API_RESPONSE" != "{}" ]] && [[ "$NGROK_API_RESPONSE" != "" ]]; then
            log_success "ngrok tunnels started!"
            
            # Parse and display tunnel URLs (only registered domains work on pay-as-you-go)
            echo -e "\n${PURPLE}🌐 Public URLs:${NC}"
            echo "$NGROK_API_RESPONSE" | grep -o '"public_url":"[^"]*' | cut -d'"' -f4 | while read -r url; do
                if [[ "$url" == *"lekiwi"* ]]; then
                    echo -e "   ${CYAN}🤖 Robot Monitor:${NC} $url"
                    ROBOT_PUBLIC_URL="$url"
                elif [[ "$url" == *"frontiertower"* ]]; then
                    echo -e "   ${CYAN}🏰 Frontier Tower:${NC} $url"
                    FRONTIERTOWER_PUBLIC_URL="$url"
                else
                    echo -e "   ${CYAN}🔗 Tunnel:${NC} $url"
                fi
            done
            echo ""
        else
            log_warning "Could not retrieve ngrok tunnel URLs. Check http://localhost:4040"
        fi
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
    
    log_debug "llama.cpp not found, installing..."
    
    if [[ "$SYSTEM" == "macos" ]]; then
        # Install via Homebrew on macOS
        if ! command -v brew &> /dev/null; then
            log_debug "Installing Homebrew..."
            /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
        fi
        
        log_debug "Installing llama.cpp via Homebrew (optimized for M4)..."
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
        log_debug "Building llama.cpp from source..."
        
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
        log_debug "Downloading LLaVA 1.5 models (more stable than SmolVLM)..."
        
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
        log_debug "Installing Node.js dependencies..."
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
log_debug "Checking and installing dependencies..."
detect_system
check_ngrok
install_llama_cpp
download_models
install_node_deps

# Kill any existing processes
echo -e "${YELLOW}🧹 Cleaning up existing processes...${NC}"
pkill -f "node.*robot-monitor-server-enhanced.js" || true
pkill -f "node.*robot-monitor-public-server.js" || true
pkill -f "llama-server" || true
# Kill ALL ngrok processes to prevent domain conflicts
pkill -f "ngrok" || true
pkill -9 -f "ngrok" || true
# Wait for processes to fully terminate
sleep 3

# Start llama.cpp server directly
echo -e "${BLUE}🤖 Starting llama.cpp server...${NC}"
if [ "$DEBUG_MODE" = true ]; then
    echo -e "${GREEN}Using llama-server: $LLAMA_SERVER_PATH${NC}"
    echo -e "${GREEN}Using model: $MODEL_PATH${NC}"
    echo -e "${GREEN}Using mmproj: $MMPROJ_PATH${NC}"
fi

# Check if port 8080 is already in use
if lsof -Pi :8080 -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo -e "${YELLOW}Warning: Port 8080 is already in use. Stopping existing process...${NC}"
    pkill -f "llama-server.*port 8080" || true
    sleep 2
fi

# Start llama.cpp server with LLaVA-optimized parameters
# Only add --verbose flag if in debug mode
LLAMA_ARGS=(
    --model "$MODEL_PATH"
    --mmproj "$MMPROJ_PATH"
    --host 0.0.0.0
    --port 8080
    --ctx-size 4096
    --threads 4
    --gpu-layers 32
    --batch-size 512
    --ubatch-size 512
)

if [ "$DEBUG_MODE" = true ]; then
    LLAMA_ARGS+=(--verbose)
fi

"$LLAMA_SERVER_PATH" "${LLAMA_ARGS[@]}" &

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

# Start ONLY the enhanced robot monitor on port 3000 (internal control server)
# This includes ALL camera, RTSP proxy, and AI vision features
if [ -f "robot-monitor-server-enhanced.js" ]; then
    log_debug "Starting enhanced robot monitor on port 3000 (internal control)..."
    PORT=3000 DEBUG=$DEBUG_MODE node robot-monitor-server-enhanced.js &
    ROBOT_PID=$!
else
    log_error "robot-monitor-server-enhanced.js not found!"
    exit 1
fi

# Start public monitor server
if [ -f "robot-monitor-public-server.js" ]; then
    log_debug "Starting public monitor server on port 4040..."
    DEBUG=$DEBUG_MODE node robot-monitor-public-server.js &
    PUBLIC_PID=$!
fi

# Wait for services to be ready
if wait_for_service 3000 "Enhanced Robot Monitor (internal control)" 30; then
    echo -e "${GREEN}✅ Enhanced Robot Monitor started successfully on port 3000${NC}"
else
    echo -e "${RED}❌ Failed to start Enhanced Robot Monitor${NC}"
    exit 1
fi

if wait_for_service 4040 "Public monitor server (read-only viewer)" 30; then
    echo -e "${GREEN}✅ Public monitor server started successfully on port 4040${NC}"
else
    echo -e "${YELLOW}⚠️  Public monitor server may not be ready yet${NC}"
fi

# Start ngrok tunnels
start_ngrok

# Final status check
echo ""
echo "========================================"
echo -e "${BLUE}📊 Service Status Check${NC}"
echo "========================================"

check_service 8080 "llama.cpp server"
check_service 3000 "Enhanced Robot Monitor (internal)"
check_service 4040 "Public monitor server (public viewer)"
check_service 8000 "Frontier Tower server"
if [[ "$SKIP_NGROK" != "true" ]]; then
    check_service 4040 "ngrok web interface"
fi

echo ""
echo "========================================"
echo -e "${GREEN}🎉 System Ready!${NC}"
echo "========================================"
echo ""
echo -e "${GREEN}📱 Local Access Points:${NC}"
echo "   • Internal Control (PRIVATE): http://localhost:3000"
echo "   • Public Viewer (SHARED): http://localhost:4040"
echo "   • Frontier Tower: http://localhost:8000"
echo "   • LLaVA API: http://localhost:8080/v1/chat/completions"
if [[ "$SKIP_NGROK" != "true" ]]; then
    echo "   • ngrok dashboard: http://localhost:4040"
fi
echo ""

if [[ "$SKIP_NGROK" != "true" ]]; then
    echo -e "${PURPLE}🌐 Remote Access:${NC}"
    echo "   Check ngrok dashboard at http://localhost:4040 for public URLs"
    echo "   Or run: curl -s http://localhost:4040/api/tunnels | jq '.tunnels[].public_url'"
    echo ""
fi

echo -e "${GREEN}✨ Multi-Model Features:${NC}"
echo "   • Model switching: Use dropdown in header"
echo "   • Benchmark models: Click ⚡ button"
echo "   • Compare models: Click 📊 button"
echo ""
echo -e "${YELLOW}💡 Tip: Open http://localhost:3000 in Safari for best performance${NC}"
echo -e "${YELLOW}🛑 Press Ctrl+C to stop all services${NC}"
echo ""

# Trap to cleanup on exit
trap 'echo -e "\n${YELLOW}🛑 Shutting down services...${NC}"; pkill -f "llama-server" || true; pkill -f "node.*robot-monitor-server-enhanced.js" || true; pkill -f "node.*robot-monitor-public-server.js" || true; pkill -f "ngrok" || true; echo -e "${GREEN}✅ All services stopped${NC}"; exit 0' INT TERM

# Keep the script running and monitor services
while true; do
    sleep 300  # Check every 5 minutes instead of 10 seconds
    
    # Check if critical services are still running
    if ! lsof -Pi :8080 -sTCP:LISTEN -t >/dev/null 2>&1; then
        echo -e "${RED}❌ llama.cpp server stopped unexpectedly${NC}"
        break
    fi
    
    if ! lsof -Pi :3000 -sTCP:LISTEN -t >/dev/null 2>&1; then
        echo -e "${RED}❌ Enhanced Robot Monitor stopped unexpectedly${NC}"
        break
    fi
    
    # Check ngrok status if enabled - DISABLED to prevent restart loops
    # if [[ "$SKIP_NGROK" != "true" ]] && ! pgrep -f "ngrok" > /dev/null; then
    #     echo -e "${YELLOW}⚠️  ngrok stopped. Killing any stale processes and restarting...${NC}"
    #     # Kill any existing ngrok processes first to avoid conflicts
    #     pkill -f "ngrok" 2>/dev/null || true
    #     sleep 2
    #     start_ngrok
    # fi
done

echo -e "${RED}💥 One or more services failed. Exiting...${NC}"
exit 1