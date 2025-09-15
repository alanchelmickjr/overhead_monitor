#!/bin/bash

# ========================================
# ngrok Automated Setup Script
# ========================================
# This script automates ngrok configuration
# for the LeKiwi Pen Nanny Cam system

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${PURPLE}🌐 ngrok Automated Setup${NC}"
echo "========================================"

# Check if ngrok is installed
check_ngrok_installed() {
    if ! command -v ngrok &> /dev/null; then
        echo -e "${YELLOW}⚠️  ngrok not found. Installing...${NC}"
        
        if [[ "$OSTYPE" == "darwin"* ]]; then
            if command -v brew &> /dev/null; then
                brew install ngrok
            else
                echo -e "${RED}Error: Homebrew not found. Please install Homebrew first.${NC}"
                echo "Visit: https://brew.sh"
                exit 1
            fi
        elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
            curl -s https://ngrok-agent.s3.amazonaws.com/ngrok.asc | sudo tee /etc/apt/trusted.gpg.d/ngrok.asc >/dev/null
            echo "deb https://ngrok-agent.s3.amazonaws.com buster main" | sudo tee /etc/apt/sources.list.d/ngrok.list
            sudo apt update && sudo apt install ngrok
        fi
    fi
    
    echo -e "${GREEN}✅ ngrok is installed: $(ngrok version)${NC}"
}

# Check if token is already configured
check_existing_token() {
    if ngrok config check &>/dev/null 2>&1; then
        echo -e "${YELLOW}⚠️  ngrok is already configured!${NC}"
        echo ""
        echo "Do you want to reconfigure with a new token? (y/n)"
        read -r response
        if [[ ! "$response" =~ ^[Yy]$ ]]; then
            echo -e "${GREEN}✅ Using existing configuration${NC}"
            return 0
        fi
    fi
    return 1
}

# Auto-open browser for signup
open_ngrok_signup() {
    local signup_url="https://dashboard.ngrok.com/signup"
    local token_url="https://dashboard.ngrok.com/get-started/your-authtoken"
    
    echo -e "${BLUE}📝 Opening ngrok signup page...${NC}"
    
    # Detect OS and open browser
    if [[ "$OSTYPE" == "darwin"* ]]; then
        open "$signup_url" 2>/dev/null || true
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        xdg-open "$signup_url" 2>/dev/null || true
    fi
    
    echo ""
    echo -e "${CYAN}Please complete these steps:${NC}"
    echo "1. Sign up for a free ngrok account (browser should open automatically)"
    echo "2. After signing in, your auth token will be shown"
    echo "3. Copy the auth token (it looks like: 2abcDEF123456789_...)"
    echo ""
    echo -e "${YELLOW}Press Enter when you have copied your auth token...${NC}"
    read -r
    
    # Try to open the token page
    if [[ "$OSTYPE" == "darwin"* ]]; then
        open "$token_url" 2>/dev/null || true
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        xdg-open "$token_url" 2>/dev/null || true
    fi
    
    # Add a small delay and clear message
    sleep 1
    echo ""
    echo -e "${GREEN}Great! Now let's configure ngrok with your token.${NC}"
}

# Get token from user
get_auth_token() {
    local token=""
    
    while [[ -z "$token" ]]; do
        echo ""
        echo -e "${CYAN}📋 Please paste your ngrok auth token below and press Enter:${NC}"
        echo -e "${YELLOW}(Right-click or Cmd+V to paste, then press Enter)${NC}"
        echo -n "> "
        read -r token
        
        # Basic validation
        if [[ -z "$token" ]]; then
            echo -e "${RED}❌ Token cannot be empty. Please try again.${NC}"
        elif [[ ${#token} -lt 20 ]]; then
            echo -e "${RED}❌ Token seems too short. Please paste the full token.${NC}"
            token=""
        fi
    done
    
    echo "$token"
}

# Configure ngrok
configure_ngrok() {
    local token="$1"
    
    echo -e "${BLUE}🔧 Configuring ngrok...${NC}"
    
    if ngrok config add-authtoken "$token" 2>/dev/null; then
        echo -e "${GREEN}✅ ngrok configured successfully!${NC}"
        return 0
    else
        echo -e "${RED}❌ Failed to configure ngrok${NC}"
        return 1
    fi
}

# Update ngrok.yml with token if needed
update_config_file() {
    local token="$1"
    local config_file="ngrok.yml"
    
    if [[ -f "$config_file" ]]; then
        # Check if placeholder exists
        if grep -q "YOUR_NGROK_AUTH_TOKEN_HERE" "$config_file"; then
            echo -e "${BLUE}📝 Updating ngrok.yml with your token...${NC}"
            
            # Create backup
            cp "$config_file" "${config_file}.backup"
            
            # Replace placeholder with actual token (escape special characters)
            # Use | as delimiter since tokens often contain /
            escaped_token=$(printf '%s\n' "$token" | sed 's/[[\.*^$()+?{|]/\\&/g')
            
            if [[ "$OSTYPE" == "darwin"* ]]; then
                sed -i '' "s|YOUR_NGROK_AUTH_TOKEN_HERE|$escaped_token|g" "$config_file"
            else
                sed -i "s|YOUR_NGROK_AUTH_TOKEN_HERE|$escaped_token|g" "$config_file"
            fi
            
            echo -e "${GREEN}✅ Updated ngrok.yml${NC}"
        fi
    fi
}

# Test ngrok connection
test_ngrok() {
    echo -e "${BLUE}🧪 Testing ngrok connection...${NC}"
    
    # Start a test tunnel
    timeout 5 ngrok http 8080 >/dev/null 2>&1 &
    local ngrok_pid=$!
    
    sleep 3
    
    # Check if tunnel is working
    if curl -s http://localhost:4040/api/tunnels >/dev/null 2>&1; then
        echo -e "${GREEN}✅ ngrok is working correctly!${NC}"
        kill $ngrok_pid 2>/dev/null || true
        return 0
    else
        echo -e "${YELLOW}⚠️  Could not verify ngrok connection${NC}"
        kill $ngrok_pid 2>/dev/null || true
        return 1
    fi
}

# Main setup flow
main() {
    echo ""
    
    # Step 1: Check ngrok installation
    check_ngrok_installed
    
    # Step 2: Check existing configuration
    if check_existing_token; then
        test_ngrok
        echo ""
        echo -e "${GREEN}🎉 ngrok is ready to use!${NC}"
        echo -e "${CYAN}Run ./start-all.sh to start your system with ngrok tunnels${NC}"
        exit 0
    fi
    
    # Step 3: Guide user through signup
    open_ngrok_signup
    
    # Step 4: Get auth token
    token=$(get_auth_token)
    
    # Step 5: Configure ngrok
    if configure_ngrok "$token"; then
        # Step 6: Update config file
        update_config_file "$token"
        
        # Step 7: Test connection
        test_ngrok
        
        echo ""
        echo "========================================"
        echo -e "${GREEN}🎉 Setup Complete!${NC}"
        echo "========================================"
        echo ""
        echo -e "${CYAN}ngrok is now configured and ready to use.${NC}"
        echo ""
        echo -e "${GREEN}Next steps:${NC}"
        echo "1. Run: ./start-all.sh"
        echo "2. Your public URLs will be displayed automatically"
        echo "3. Share the URLs to access your LeKiwi Pen Nanny Cam remotely"
        echo ""
        echo -e "${YELLOW}💡 Tips:${NC}"
        echo "• Check tunnel status anytime: ./ngrok-status.sh"
        echo "• View ngrok dashboard: http://localhost:4040"
        echo "• Free tier allows 1 online tunnel at a time"
        echo ""
    else
        echo -e "${RED}❌ Setup failed. Please try again or configure manually:${NC}"
        echo "ngrok config add-authtoken YOUR_TOKEN"
    fi
}

# Run main function
main