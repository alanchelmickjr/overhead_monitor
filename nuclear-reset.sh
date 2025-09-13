#!/bin/bash

# ========================================
# NUCLEAR OPTION: Complete llama.cpp Reset
# ========================================
# This script completely removes llama.cpp and all models
# then reinstalls everything fresh

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${RED}💥 NUCLEAR RESET: Removing all llama.cpp installations and models${NC}"
echo "========================================"

# Kill any running llama-server processes
echo -e "${YELLOW}🔪 Killing all llama-server processes...${NC}"
pkill -f "llama-server" || true
sleep 2

# Remove Homebrew installation
echo -e "${YELLOW}🗑️  Removing Homebrew llama.cpp...${NC}"
brew uninstall llama.cpp || true
brew uninstall --ignore-dependencies llama.cpp || true

# Remove any manual installations
echo -e "${YELLOW}🗑️  Removing manual installations...${NC}"
sudo rm -f /usr/local/bin/llama-server
sudo rm -f /opt/homebrew/bin/llama-server
rm -rf "$HOME/llama.cpp"

# Remove all cached models
echo -e "${YELLOW}🗑️  Removing all cached models...${NC}"
rm -rf "$HOME/Library/Caches/llama.cpp"
rm -rf "$HOME/models"
rm -rf "$HOME/.cache/huggingface"

# Clean up any leftover processes
echo -e "${YELLOW}🧹 Final cleanup...${NC}"
brew cleanup || true

echo ""
echo -e "${GREEN}✅ Nuclear reset complete!${NC}"
echo ""
echo "Next steps:"
echo "1. Run: ./nuclear-reset.sh"
echo "2. Run: ./start-all.sh (will auto-install fresh)"
echo ""
echo -e "${BLUE}Everything has been wiped clean. Fresh start guaranteed.${NC}"
