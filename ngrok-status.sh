#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${PURPLE}🌐 ngrok Tunnel Status${NC}"
echo "========================================"

# Check if ngrok is running
if ! pgrep -f "ngrok start" > /dev/null; then
    echo -e "${RED}❌ ngrok is not running${NC}"
    echo -e "${YELLOW}Run ./start-all.sh to start all services${NC}"
    exit 1
fi

# Check if curl is available
if ! command -v curl &> /dev/null; then
    echo -e "${RED}Error: curl is not installed${NC}"
    exit 1
fi

# Get tunnel information from ngrok API
RESPONSE=$(curl -s http://localhost:4040/api/tunnels 2>/dev/null)

if [ -z "$RESPONSE" ] || [ "$RESPONSE" = "{}" ]; then
    echo -e "${YELLOW}⚠️  Could not connect to ngrok API${NC}"
    echo -e "${YELLOW}Make sure ngrok is running with web interface enabled${NC}"
    exit 1
fi

# Check if jq is available for better JSON parsing
if command -v jq &> /dev/null; then
    # Parse with jq
    echo "$RESPONSE" | jq -r '.tunnels[] | "\(.name): \(.public_url) -> \(.config.addr)"' | while IFS=: read -r name rest; do
        url_and_addr=$(echo "$rest" | xargs)
        
        case "$name" in
            "camera-viewer"*)
                echo -e "${CYAN}📱 Camera Viewer:${NC}"
                ;;
            "robot-monitor"*)
                echo -e "${CYAN}🤖 Robot Monitor:${NC}"
                ;;
            "llava-api"*)
                echo -e "${CYAN}🧠 LLaVA API:${NC}"
                ;;
            *)
                echo -e "${CYAN}🔗 $name:${NC}"
                ;;
        esac
        echo "   $url_and_addr"
        echo ""
    done
    
    # Show statistics
    echo -e "\n${BLUE}📊 Connection Statistics:${NC}"
    CONN_COUNT=$(echo "$RESPONSE" | jq '.tunnels | length')
    echo -e "   Active tunnels: ${GREEN}$CONN_COUNT${NC}"
    
else
    # Fallback parsing without jq
    echo -e "${GREEN}✅ ngrok is running${NC}\n"
    
    # Extract URLs using grep and sed
    echo "$RESPONSE" | grep -o '"public_url":"[^"]*' | cut -d'"' -f4 | while read -r url; do
        # Try to identify which service based on the response
        if echo "$RESPONSE" | grep -B5 "$url" | grep -q "camera-viewer"; then
            echo -e "${CYAN}📱 Camera Viewer:${NC} $url"
        elif echo "$RESPONSE" | grep -B5 "$url" | grep -q "robot-monitor"; then
            echo -e "${CYAN}🤖 Robot Monitor:${NC} $url"
        elif echo "$RESPONSE" | grep -B5 "$url" | grep -q "llava-api"; then
            echo -e "${CYAN}🧠 LLaVA API:${NC} $url"
        else
            echo -e "${CYAN}🔗 Tunnel:${NC} $url"
        fi
    done
fi

echo -e "\n${BLUE}📋 Quick Commands:${NC}"
echo "   • View web interface: open http://localhost:4040"
echo "   • Copy camera URL: curl -s http://localhost:4040/api/tunnels | grep -o '\"public_url\":\"[^\"]*' | grep camera | cut -d'\"' -f4 | pbcopy"
echo "   • Restart tunnels: pkill ngrok && ngrok start --all --config ngrok.yml"
echo ""