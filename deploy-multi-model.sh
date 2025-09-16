#!/bin/bash

# Deployment script for Multi-Model Robot Monitoring System
# Supports Apple M4 Mac and NVIDIA AGX Xavier

echo "🚀 Deploying Multi-Model Robot Monitoring System"
echo "=============================================="

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Detect platform
detect_platform() {
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # Check if Apple Silicon
        if [[ $(uname -m) == 'arm64' ]]; then
            echo "m4"
        else
            echo "mac_intel"
        fi
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        # Check if NVIDIA Xavier
        if [ -f /etc/nv_tegra_release ] && grep -q "Xavier" /etc/nv_tegra_release; then
            echo "xavier"
        else
            echo "linux"
        fi
    else
        echo "unknown"
    fi
}

PLATFORM=$(detect_platform)
echo -e "${GREEN}Detected platform: $PLATFORM${NC}"

# Check prerequisites
check_prerequisites() {
    echo -e "\n${YELLOW}Checking prerequisites...${NC}"
    
    # Check Node.js
    if ! command -v node &> /dev/null; then
        echo -e "${RED}Node.js is not installed. Please install Node.js 16+ first.${NC}"
        exit 1
    fi
    
    # Check FFmpeg
    if ! command -v ffmpeg &> /dev/null; then
        echo -e "${RED}FFmpeg is not installed. Please install FFmpeg first.${NC}"
        echo "Install with: brew install ffmpeg (Mac) or apt-get install ffmpeg (Linux)"
        exit 1
    fi
    
    echo -e "${GREEN}✓ Prerequisites met${NC}"
}

# Install dependencies
install_dependencies() {
    echo -e "\n${YELLOW}Installing dependencies...${NC}"
    
    # Update package.json if needed
    if [ ! -f package.json ]; then
        cat > package.json << 'EOF'
{
  "name": "overhead-robot-monitor",
  "version": "2.0.0",
  "description": "Multi-Model Robot Monitoring System with Vision AI",
  "main": "robot-monitor-server-enhanced.js",
  "scripts": {
    "start": "node robot-monitor-server-enhanced.js",
    "test": "node test-multi-model-system.js",
    "benchmark": "node test-multi-model-system.js",
    "dev": "nodemon robot-monitor-server-enhanced.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "cors": "^2.8.5",
    "body-parser": "^1.20.2",
    "node-fetch": "^2.6.9",
    "dotenv": "^16.0.3",
    "ws": "^8.13.0"
  },
  "devDependencies": {
    "nodemon": "^2.0.22"
  }
}
EOF
    fi
    
    npm install
    echo -e "${GREEN}✓ Dependencies installed${NC}"
}

# Setup configuration
setup_configuration() {
    echo -e "\n${YELLOW}Setting up configuration...${NC}"
    
    # Create .env file if not exists
    if [ ! -f .env ]; then
        echo -e "${YELLOW}Creating .env file...${NC}"
        cat > .env << EOF
# Vision API Configuration
VISION_API_URL=http://localhost:8080

# Camera Configuration
CAMERA_URL=rtsp://LeKiwi:LeKiwi995@192.168.88.40:554/stream1

# Hardware Profile Override (auto-detected if not set)
# HARDWARE_PROFILE=m4

# Server Port
PORT=3000
EOF
        echo -e "${GREEN}✓ Created .env file (please update with your settings)${NC}"
    fi
    
    # Ensure config directory exists
    mkdir -p config
    
    # Check if models.json exists
    if [ ! -f config/models.json ]; then
        echo -e "${YELLOW}models.json already exists, using existing configuration${NC}"
    else
        echo -e "${GREEN}✓ Model configuration ready${NC}"
    fi
}

# Platform-specific setup
platform_setup() {
    echo -e "\n${YELLOW}Platform-specific setup for: $PLATFORM${NC}"
    
    case $PLATFORM in
        "m4")
            echo "Setting up for Apple M4 Mac..."
            echo "- Metal Performance Shaders will be used for acceleration"
            echo "- Recommended models: SmolVLM-500M, LLaVA-7B"
            
            # Check if llama.cpp is installed for Metal support
            if [ ! -d "llama.cpp" ]; then
                echo -e "${YELLOW}Consider installing llama.cpp with Metal support for best performance${NC}"
                echo "git clone https://github.com/ggerganov/llama.cpp"
                echo "cd llama.cpp && make LLAMA_METAL=1"
            fi
            ;;
            
        "xavier")
            echo "Setting up for NVIDIA AGX Xavier..."
            echo "- CUDA and TensorRT optimizations available"
            echo "- Recommended models: SmolVLM-500M, LLaVA-7B"
            
            # Check CUDA
            if command -v nvcc &> /dev/null; then
                echo -e "${GREEN}✓ CUDA detected: $(nvcc --version | grep release | awk '{print $6}')"
            else
                echo -e "${YELLOW}CUDA not found. Install CUDA toolkit for GPU acceleration${NC}"
            fi
            ;;
            
        *)
            echo "Generic setup - CPU inference will be used"
            echo "- Recommended model: SmolVLM-500M"
            ;;
    esac
}

# Create startup scripts
create_startup_scripts() {
    echo -e "\n${YELLOW}Creating startup scripts...${NC}"
    
    # Create start script
    cat > start-monitor.sh << 'EOF'
#!/bin/bash
echo "🤖 Starting Multi-Model Robot Monitor..."

# Check if vision API is running
if ! curl -s http://localhost:8080/v1/models > /dev/null 2>&1; then
    echo "⚠️  Vision API not detected at http://localhost:8080"
    echo "Please start your vision inference server first"
    echo "Example: ./server -m smolvlm.gguf --port 8080"
    exit 1
fi

# Start the monitoring server
node robot-monitor-server-enhanced.js
EOF
    chmod +x start-monitor.sh
    
    # Create benchmark script
    cat > benchmark-models.sh << 'EOF'
#!/bin/bash
echo "🏃 Running Model Benchmarks..."
node test-multi-model-system.js
EOF
    chmod +x benchmark-models.sh
    
    echo -e "${GREEN}✓ Startup scripts created${NC}"
}

# Create systemd service (Linux only)
create_systemd_service() {
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        echo -e "\n${YELLOW}Creating systemd service...${NC}"
        
        sudo tee /etc/systemd/system/robot-monitor.service > /dev/null << EOF
[Unit]
Description=Robot Monitoring System
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$(pwd)
ExecStart=/usr/bin/node $(pwd)/robot-monitor-server-enhanced.js
Restart=on-failure
Environment="NODE_ENV=production"

[Install]
WantedBy=multi-user.target
EOF
        
        echo -e "${GREEN}✓ Systemd service created${NC}"
        echo "To enable auto-start: sudo systemctl enable robot-monitor"
        echo "To start now: sudo systemctl start robot-monitor"
    fi
}

# Final setup
final_setup() {
    echo -e "\n${YELLOW}Finalizing setup...${NC}"
    
    # Create necessary directories
    mkdir -p logs
    mkdir -p captures
    mkdir -p models
    
    # Set permissions
    chmod +x robot-monitor-server-enhanced.js
    chmod +x test-multi-model-system.js
    
    echo -e "${GREEN}✓ Setup complete!${NC}"
}

# Print next steps
print_next_steps() {
    echo -e "\n${GREEN}🎉 Deployment Complete!${NC}"
    echo -e "\n${YELLOW}Next Steps:${NC}"
    echo "1. Start your vision inference server:"
    echo "   Example: ./server -m models/smolvlm.gguf --port 8080"
    echo ""
    echo "2. Update .env with your camera URL and API settings"
    echo ""
    echo "3. Start the monitoring system:"
    echo "   ./start-monitor.sh"
    echo ""
    echo "4. Open http://localhost:3000 in your browser"
    echo ""
    echo "5. (Optional) Run benchmarks to find the best model:"
    echo "   ./benchmark-models.sh"
    echo ""
    echo -e "${GREEN}Documentation:${NC}"
    echo "- Quick Start: QUICKSTART.md"
    echo "- Multi-Model Guide: MULTI_MODEL_GUIDE.md"
    echo "- API Reference: API.md"
}

# Main deployment flow
main() {
    check_prerequisites
    install_dependencies
    setup_configuration
    platform_setup
    create_startup_scripts
    
    if [[ "$PLATFORM" == "xavier" ]] || [[ "$PLATFORM" == "linux" ]]; then
        create_systemd_service
    fi
    
    final_setup
    print_next_steps
}

# Run deployment
main

echo -e "\n${GREEN}Ready to monitor robots! 🤖${NC}"