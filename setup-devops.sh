#!/bin/bash

# ========================================
# Overhead Monitor DevOps Setup Script
# ========================================
# This script automates the setup of the complete monitoring system
# including llama.cpp, SmolVLM models, and all dependencies

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

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

# ========================================
# System Detection
# ========================================
detect_system() {
    if [[ "$OSTYPE" == "darwin"* ]]; then
        SYSTEM="macos"
        PACKAGE_MANAGER="brew"
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        SYSTEM="linux"
        if command -v apt-get &> /dev/null; then
            PACKAGE_MANAGER="apt"
        elif command -v yum &> /dev/null; then
            PACKAGE_MANAGER="yum"
        else
            log_error "Unsupported Linux distribution"
            exit 1
        fi
    else
        log_error "Unsupported operating system: $OSTYPE"
        exit 1
    fi
    log_info "Detected system: $SYSTEM with $PACKAGE_MANAGER"
}

# ========================================
# Dependency Installation
# ========================================
install_dependencies() {
    log_info "Installing system dependencies..."
    
    if [[ "$SYSTEM" == "macos" ]]; then
        # Check if Homebrew is installed
        if ! command -v brew &> /dev/null; then
            log_info "Installing Homebrew..."
            /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
        fi
        
        # Install dependencies
        brew install ffmpeg node git curl wget cmake
        
    elif [[ "$SYSTEM" == "linux" ]]; then
        if [[ "$PACKAGE_MANAGER" == "apt" ]]; then
            sudo apt-get update
            sudo apt-get install -y ffmpeg nodejs npm git curl wget build-essential cmake
        elif [[ "$PACKAGE_MANAGER" == "yum" ]]; then
            sudo yum install -y ffmpeg nodejs npm git curl wget gcc-c++ make cmake
        fi
    fi
    
    log_success "System dependencies installed"
}

# ========================================
# Node.js Dependencies
# ========================================
install_node_deps() {
    log_info "Installing Node.js dependencies..."
    
    if [ -f "package.json" ]; then
        npm install
        log_success "Node.js dependencies installed"
    else
        log_error "package.json not found. Are you in the correct directory?"
        exit 1
    fi
}

# ========================================
# llama.cpp Installation
# ========================================
install_llama_cpp() {
    log_info "Setting up llama.cpp..."
    
    # Check if llama-server already exists
    if command -v llama-server &> /dev/null; then
        LLAMA_SERVER_PATH=$(which llama-server)
        log_success "llama-server found at: $LLAMA_SERVER_PATH"
        return 0
    fi
    
    # Install via Homebrew on macOS
    if [[ "$SYSTEM" == "macos" ]]; then
        log_info "Installing llama.cpp via Homebrew..."
        
        # Try to install, handle potential errors
        if brew install llama.cpp; then
            # Check common installation paths
            if [ -f "/opt/homebrew/bin/llama-server" ]; then
                LLAMA_SERVER_PATH="/opt/homebrew/bin/llama-server"
            elif [ -f "/usr/local/bin/llama-server" ]; then
                LLAMA_SERVER_PATH="/usr/local/bin/llama-server"
            else
                # Find it dynamically
                LLAMA_SERVER_PATH=$(find /opt/homebrew /usr/local -name "llama-server" 2>/dev/null | head -1)
                if [ -z "$LLAMA_SERVER_PATH" ]; then
                    log_error "llama-server not found after Homebrew installation"
                    exit 1
                fi
            fi
        else
            log_error "Failed to install llama.cpp via Homebrew"
            exit 1
        fi
    else
        # Build from source on Linux
        log_info "Building llama.cpp from source..."
        
        LLAMA_DIR="$HOME/llama.cpp"
        if [ ! -d "$LLAMA_DIR" ]; then
            if ! git clone https://github.com/ggerganov/llama.cpp.git "$LLAMA_DIR"; then
                log_error "Failed to clone llama.cpp repository"
                exit 1
            fi
        fi
        
        cd "$LLAMA_DIR"
        git pull
        
        # Build with CUDA support if available
        if command -v nvcc &> /dev/null; then
            log_info "CUDA detected, building with GPU support..."
            make clean
            if ! LLAMA_CUDA=1 make -j$(nproc); then
                log_error "Failed to build llama.cpp with CUDA support"
                exit 1
            fi
        else
            make clean
            if ! make -j$(nproc); then
                log_error "Failed to build llama.cpp"
                exit 1
            fi
        fi
        
        LLAMA_SERVER_PATH="$LLAMA_DIR/llama-server"
        
        # Verify the binary was built
        if [ ! -f "$LLAMA_SERVER_PATH" ]; then
            log_error "llama-server binary not found after build"
            exit 1
        fi
        
        # Create symlink for global access
        sudo ln -sf "$LLAMA_SERVER_PATH" /usr/local/bin/llama-server
        
        cd - > /dev/null
    fi
    
    # Final verification
    if [ ! -f "$LLAMA_SERVER_PATH" ] && ! command -v "$LLAMA_SERVER_PATH" &> /dev/null; then
        log_error "llama-server installation verification failed"
        exit 1
    fi
    
    log_success "llama.cpp installation complete: $LLAMA_SERVER_PATH"
}

# ========================================
# SmolVLM Model Download
# ========================================
download_smolvlm_model() {
    log_info "Setting up SmolVLM model..."
    
    MODEL_DIR="$HOME/models"
    mkdir -p "$MODEL_DIR"
    
    # Define possible model locations
    CACHE_MODEL="$HOME/Library/Caches/llama.cpp/ggml-org_SmolVLM-500M-Instruct-GGUF_SmolVLM-500M-Instruct-Q8_0.gguf"
    CACHE_MMPROJ="$HOME/Library/Caches/llama.cpp/ggml-org_SmolVLM-500M-Instruct-GGUF_mmproj-SmolVLM-500M-Instruct-Q8_0.gguf"
    LOCAL_MODEL="$MODEL_DIR/smolvlm/SmolVLM-500M-Instruct-Q8_0.gguf"
    LOCAL_MMPROJ="$MODEL_DIR/smolvlm/mmproj-SmolVLM-500M-Instruct-Q8_0.gguf"
    
    # Check if models already exist in cache
    if [ -f "$CACHE_MODEL" ] && [ -f "$CACHE_MMPROJ" ]; then
        log_success "SmolVLM model found in cache"
        MODEL_PATH="$CACHE_MODEL"
        MMPROJ_PATH="$CACHE_MMPROJ"
    # Check if models exist in local directory
    elif [ -f "$LOCAL_MODEL" ] && [ -f "$LOCAL_MMPROJ" ]; then
        log_success "SmolVLM model found in local directory"
        MODEL_PATH="$LOCAL_MODEL"
        MMPROJ_PATH="$LOCAL_MMPROJ"
    else
        log_info "Downloading SmolVLM model..."
        mkdir -p "$MODEL_DIR/smolvlm"
        
        # Using HuggingFace CLI or direct download
        if command -v huggingface-cli &> /dev/null; then
            log_info "Using HuggingFace CLI to download models..."
            if huggingface-cli download ggml-org/SmolVLM-500M-Instruct-GGUF \
                SmolVLM-500M-Instruct-Q8_0.gguf \
                mmproj-SmolVLM-500M-Instruct-Q8_0.gguf \
                --local-dir "$MODEL_DIR/smolvlm"; then
                MODEL_PATH="$LOCAL_MODEL"
                MMPROJ_PATH="$LOCAL_MMPROJ"
            else
                log_error "Failed to download models via HuggingFace CLI"
                exit 1
            fi
        else
            # Direct download fallback
            log_info "Downloading SmolVLM model directly..."
            
            if wget -O "$LOCAL_MODEL" \
                "https://huggingface.co/ggml-org/SmolVLM-500M-Instruct-GGUF/resolve/main/SmolVLM-500M-Instruct-Q8_0.gguf" && \
               wget -O "$LOCAL_MMPROJ" \
                "https://huggingface.co/ggml-org/SmolVLM-500M-Instruct-GGUF/resolve/main/mmproj-SmolVLM-500M-Instruct-Q8_0.gguf"; then
                MODEL_PATH="$LOCAL_MODEL"
                MMPROJ_PATH="$LOCAL_MMPROJ"
            else
                log_error "Failed to download models directly"
                exit 1
            fi
        fi
    fi
    
    # Verify models exist and are not empty
    if [ ! -f "$MODEL_PATH" ] || [ ! -s "$MODEL_PATH" ]; then
        log_error "Model file is missing or empty: $MODEL_PATH"
        exit 1
    fi
    
    if [ ! -f "$MMPROJ_PATH" ] || [ ! -s "$MMPROJ_PATH" ]; then
        log_error "MMProj file is missing or empty: $MMPROJ_PATH"
        exit 1
    fi
    
    log_success "SmolVLM model ready at: $MODEL_PATH"
    log_success "MMProj ready at: $MMPROJ_PATH"
}

# ========================================
# Update Configuration Files
# ========================================
update_configs() {
    log_info "Updating configuration files..."
    
    # Update start-llama-server.sh
    cat > start-llama-server.sh << 'EOF'
#!/bin/bash

# Start llama.cpp server with SmolVLM for vision analysis
# Auto-configured by setup-devops.sh

echo "Starting llama.cpp server with SmolVLM..."
echo "======================================="

# Paths configured during setup
LLAMA_SERVER="__LLAMA_SERVER_PATH__"
MODEL_PATH="__MODEL_PATH__"
MMPROJ_PATH="__MMPROJ_PATH__"

# Check if server exists
if [ ! -f "$LLAMA_SERVER" ] && ! command -v "$LLAMA_SERVER" &> /dev/null; then
    echo "Error: llama-server not found at $LLAMA_SERVER"
    echo "Please run ./setup-devops.sh first"
    exit 1
fi

# Check if model exists
if [ ! -f "$MODEL_PATH" ]; then
    echo "Error: Model not found at $MODEL_PATH"
    echo "Please run ./setup-devops.sh first"
    exit 1
fi

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
    --log-disable

echo ""
echo "Server should be running at http://localhost:8080"
echo "API endpoint: http://localhost:8080/v1/chat/completions"
EOF

    # Replace placeholders
    sed -i.bak "s|__LLAMA_SERVER_PATH__|${LLAMA_SERVER_PATH}|g" start-llama-server.sh
    sed -i.bak "s|__MODEL_PATH__|${MODEL_PATH}|g" start-llama-server.sh
    sed -i.bak "s|__MMPROJ_PATH__|${MMPROJ_PATH}|g" start-llama-server.sh
    rm -f start-llama-server.sh.bak
    
    chmod +x start-llama-server.sh
    
    # Create config.json if it doesn't exist
    if [ ! -f "config.json" ]; then
        cp config.example.json config.json 2>/dev/null || cat > config.json << 'EOF'
{
  "rtsp": {
    "url": "rtsp://192.168.88.40:554/stream1",
    "username": "LeKiwi",
    "password": "LeKiwi995"
  },
  "llama": {
    "apiUrl": "http://localhost:8080/v1/chat/completions",
    "model": "smolvlm-instruct"
  },
  "monitoring": {
    "interval": 30000,
    "conditions": [
      "Robot tipped over or fallen",
      "Robot stuck or not moving",
      "Robots colliding with each other",
      "Ball stuck in cup (scoring event)"
    ]
  }
}
EOF
    fi
    
    log_success "Configuration files updated"
}

# ========================================
# Service Management Scripts
# ========================================
create_service_scripts() {
    log_info "Creating service management scripts..."
    
    # Create systemd service for Linux
    if [[ "$SYSTEM" == "linux" ]]; then
        cat > overhead-monitor.service << EOF
[Unit]
Description=Overhead Monitor Service
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$(pwd)
ExecStart=$(pwd)/start-all.sh
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
        
        log_info "To install as systemd service:"
        log_info "  sudo cp overhead-monitor.service /etc/systemd/system/"
        log_info "  sudo systemctl daemon-reload"
        log_info "  sudo systemctl enable overhead-monitor"
        log_info "  sudo systemctl start overhead-monitor"
    fi
    
    # Create launchd plist for macOS
    if [[ "$SYSTEM" == "macos" ]]; then
        cat > com.overhead.monitor.plist << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.overhead.monitor</string>
    <key>ProgramArguments</key>
    <array>
        <string>$(pwd)/start-all.sh</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$(pwd)</string>
    <key>KeepAlive</key>
    <true/>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$(pwd)/logs/overhead-monitor.log</string>
    <key>StandardErrorPath</key>
    <string>$(pwd)/logs/overhead-monitor.error.log</string>
</dict>
</plist>
EOF
        
        log_info "To install as launchd service:"
        log_info "  cp com.overhead.monitor.plist ~/Library/LaunchAgents/"
        log_info "  launchctl load ~/Library/LaunchAgents/com.overhead.monitor.plist"
    fi
    
    log_success "Service scripts created"
}

# ========================================
# Docker Setup
# ========================================
create_docker_setup() {
    log_info "Creating Docker configuration..."
    
    # Update Dockerfile
    cat > Dockerfile << 'EOF'
FROM node:18-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    ffmpeg \
    curl \
    wget \
    git \
    build-essential \
    cmake \
    && rm -rf /var/lib/apt/lists/*

# Install llama.cpp
RUN git clone https://github.com/ggerganov/llama.cpp.git /opt/llama.cpp && \
    cd /opt/llama.cpp && \
    make -j$(nproc) && \
    ln -s /opt/llama.cpp/llama-server /usr/local/bin/llama-server

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install Node.js dependencies
RUN npm ci --only=production

# Copy application files
COPY . .

# Download SmolVLM model
RUN mkdir -p /models && \
    wget -O /models/SmolVLM-500M-Instruct-Q8_0.gguf \
    "https://huggingface.co/ggml-org/SmolVLM-500M-Instruct-GGUF/resolve/main/SmolVLM-500M-Instruct-Q8_0.gguf" && \
    wget -O /models/mmproj-SmolVLM-500M-Instruct-Q8_0.gguf \
    "https://huggingface.co/ggml-org/SmolVLM-500M-Instruct-GGUF/resolve/main/mmproj-SmolVLM-500M-Instruct-Q8_0.gguf"

# Update model paths in start script
RUN sed -i 's|$HOME/models|/models|g' start-llama-server.sh

# Make scripts executable
RUN chmod +x *.sh

# Expose ports
EXPOSE 3000 3000 8080

# Start services
CMD ["./start-all.sh"]
EOF

    # Update docker-compose.yml
    cat > docker-compose.yml << 'EOF'
version: '3.8'

services:
  overhead-monitor:
    build: .
    container_name: overhead-monitor
    ports:
      - "3000:3000"  # Camera viewer
      - "3000:3000"  # RTSP proxy
      - "8080:8080"  # llama.cpp server
    environment:
      - RTSP_URL=${RTSP_URL:-rtsp://192.168.88.40:554/stream1}
      - RTSP_USERNAME=${RTSP_USERNAME:-LeKiwi}
      - RTSP_PASSWORD=${RTSP_PASSWORD:-LeKiwi995}
    volumes:
      - ./logs:/app/logs
      - ./config.json:/app/config.json
    restart: unless-stopped
    networks:
      - monitor-net

  nginx:
    image: nginx:alpine
    container_name: overhead-nginx
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./ssl:/etc/nginx/ssl:ro
    depends_on:
      - overhead-monitor
    networks:
      - monitor-net

networks:
  monitor-net:
    driver: bridge
EOF

    log_success "Docker configuration created"
}

# ========================================
# Validation and Testing
# ========================================
validate_setup() {
    log_info "Validating setup..."
    
    local errors=0
    
    # Check Node.js
    if ! command -v node &> /dev/null; then
        log_error "Node.js not found"
        ((errors++))
    else
        log_success "Node.js: $(node --version)"
    fi
    
    # Check FFmpeg
    if ! command -v ffmpeg &> /dev/null; then
        log_error "FFmpeg not found"
        ((errors++))
    else
        log_success "FFmpeg: $(ffmpeg -version 2>&1 | head -n1)"
    fi
    
    # Check llama-server
    if [ ! -f "$LLAMA_SERVER_PATH" ] && ! command -v "$LLAMA_SERVER_PATH" &> /dev/null; then
        log_error "llama-server not found at $LLAMA_SERVER_PATH"
        ((errors++))
    else
        log_success "llama-server: $LLAMA_SERVER_PATH"
    fi
    
    # Check models
    if [ ! -f "$MODEL_PATH" ]; then
        log_error "SmolVLM model not found at $MODEL_PATH"
        ((errors++))
    else
        log_success "SmolVLM model: $MODEL_PATH"
    fi
    
    # Check scripts
    for script in start-llama-server.sh start-camera-monitor.sh start-all.sh; do
        if [ ! -x "$script" ]; then
            log_warning "$script not executable, fixing..."
            chmod +x "$script"
        fi
    done
    
    if [ $errors -eq 0 ]; then
        log_success "All validations passed!"
        return 0
    else
        log_error "Validation failed with $errors errors"
        return 1
    fi
}

# ========================================
# Test Run
# ========================================
test_services() {
    log_info "Testing services..."
    
    # Test llama.cpp server
    log_info "Starting llama.cpp server for testing..."
    timeout 30 ./start-llama-server.sh &
    LLAMA_PID=$!
    
    sleep 10
    
    if curl -s http://localhost:8080/health > /dev/null 2>&1; then
        log_success "llama.cpp server is responsive"
    else
        log_warning "llama.cpp server not responding, checking alternative endpoints..."
        curl -s http://localhost:8080/
    fi
    
    kill $LLAMA_PID 2>/dev/null || true
    
    log_success "Service tests completed"
}

# ========================================
# Main Setup Flow
# ========================================
main() {
    echo "========================================"
    echo "Overhead Monitor DevOps Setup"
    echo "========================================"
    echo ""
    
    # Create logs directory
    mkdir -p logs
    
    # Run setup steps
    detect_system
    install_dependencies
    install_node_deps
    install_llama_cpp
    download_smolvlm_model
    update_configs
    create_service_scripts
    create_docker_setup
    
    echo ""
    echo "========================================"
    echo "Setup Summary"
    echo "========================================"
    
    validate_setup
    
    echo ""
    echo "========================================"
    echo "Next Steps"
    echo "========================================"
    echo ""
    echo "1. Start the services:"
    echo "   ./start-all.sh"
    echo ""
    echo "2. Or run with Docker:"
    echo "   docker-compose up -d"
    echo ""
    echo "3. Access the interfaces:"
    echo "   - Camera viewer: http://localhost:3000"
    echo "   - RTSP proxy: http://localhost:3000"
    echo "   - SmolVLM test: http://localhost:3000/test-camera-stream-smolvlm.html"
    echo ""
    echo "4. Optional: Install as system service (see logs above)"
    echo ""
    
    # Optional test run
    read -p "Would you like to test the services now? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        test_services
    fi
    
    log_success "Setup complete!"
}

# Run main function
main "$@"