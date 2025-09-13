#!/bin/bash

# Start llama.cpp server with SmolVLM for vision analysis
# Make sure you have llama.cpp installed with the SmolVLM model

echo "Starting llama.cpp server with SmolVLM..."
echo "======================================="

# Path to llama.cpp directory (adjust this to your installation)
LLAMA_CPP_DIR="$HOME/llama.cpp"

# Path to SmolVLM model (adjust this to your model location)
MODEL_PATH="$HOME/models/smolvlm.gguf"

# Check if llama.cpp exists
if [ ! -d "$LLAMA_CPP_DIR" ]; then
    echo "Error: llama.cpp not found at $LLAMA_CPP_DIR"
    echo "Please update LLAMA_CPP_DIR in this script"
    exit 1
fi

# Check if model exists
if [ ! -f "$MODEL_PATH" ]; then
    echo "Error: Model not found at $MODEL_PATH"
    echo "Please update MODEL_PATH in this script"
    echo ""
    echo "To download SmolVLM model:"
    echo "  wget https://huggingface.co/YOUR_MODEL_PATH/smolvlm.gguf"
    exit 1
fi

cd "$LLAMA_CPP_DIR"

# Start the server
./server \
    -m "$MODEL_PATH" \
    --host 0.0.0.0 \
    --port 8080 \
    --ctx-size 2048 \
    --n-predict 512 \
    --parallel 2 \
    --cont-batching \
    --mmproj "$MODEL_PATH.mmproj" \
    --image

echo ""
echo "Server should be running at http://localhost:8080"
echo "API endpoint: http://localhost:8080/v1/chat/completions"