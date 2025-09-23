# Fix Startup Script for SmolVLM and Multi-Model Support

## Problem Analysis

The current `start-all.sh` script has several issues:

1. **Model Mismatch**: It looks for SmolVLM cache files (lines 281-282) but downloads LLaVA models instead (lines 296-305)
2. **Old Model Loading**: Uses the old `--model` and `--mmproj` flags instead of the new `-hf` option
3. **No Model Selection**: Hardcoded to use whatever models are downloaded, no way to switch models
4. **Wrong Default**: Not using SmolVLM as the default model as shown in the example notebook

## Solution

### 1. Use the New `-hf` Flag

The new llama.cpp supports loading models directly from Hugging Face:
```bash
llama-server -hf ggml-org/SmolVLM-500M-Instruct-GGUF
```

This eliminates the need to manually download models and manage paths.

### 2. Add Model Selection Support

Add environment variable support for model selection:
```bash
# Default to SmolVLM-500M
MODEL=${MODEL:-"ggml-org/SmolVLM-500M-Instruct-GGUF"}

# Start server with selected model
llama-server -hf "$MODEL" --host 0.0.0.0 --port 8080
```

### 3. Available Models

Based on the documentation provided, these models are available:

**Vision Models:**
- `ggml-org/SmolVLM-Instruct-GGUF` (default SmolVLM)
- `ggml-org/SmolVLM-256M-Instruct-GGUF` (smaller)
- `ggml-org/SmolVLM-500M-Instruct-GGUF` (recommended default)
- `ggml-org/SmolVLM2-2.2B-Instruct-GGUF` (larger)
- `ggml-org/gemma-3-4b-it-GGUF`
- `ggml-org/gemma-3-12b-it-GGUF`
- `ggml-org/pixtral-12b-GGUF`
- `ggml-org/Qwen2-VL-2B-Instruct-GGUF`
- `ggml-org/Qwen2-VL-7B-Instruct-GGUF`

### 4. Updated Startup Script Structure

```bash
#!/bin/bash

# Model selection (defaults to SmolVLM-500M)
MODEL=${MODEL:-"ggml-org/SmolVLM-500M-Instruct-GGUF"}

# Remove the entire download_models() function - not needed anymore

# Start llama.cpp server with -hf flag
"$LLAMA_SERVER_PATH" \
    -hf "$MODEL" \
    --host 0.0.0.0 \
    --port 8080 \
    --ctx-size 4096 \
    --threads 4 \
    --gpu-layers 32 \
    --batch-size 512 \
    --ubatch-size 512 \
    ${DEBUG_MODE:+--verbose} &
```

### 5. Usage Examples

```bash
# Use default SmolVLM-500M
./start-all.sh

# Use a different model
MODEL="ggml-org/SmolVLM2-2.2B-Instruct-GGUF" ./start-all.sh

# Use Gemma-3 4B
MODEL="ggml-org/gemma-3-4b-it-GGUF" ./start-all.sh

# Use Qwen2-VL 7B
MODEL="ggml-org/Qwen2-VL-7B-Instruct-GGUF" ./start-all.sh
```

## Files to Update

1. **start-all.sh**:
   - Remove the `download_models()` function entirely
   - Update the llama-server startup command to use `-hf`
   - Add MODEL environment variable support
   - Update help text to show model selection

2. **config/models.json**:
   - Update model references to use Hugging Face model IDs
   - Remove local file paths for gguf/mmproj

3. **src/vision/VisionEngine.js**:
   - Already supports the OpenAI-compatible API format
   - May need to update default model name to match

## Implementation Steps

1. Create a new `start-all.sh` with the fixes
2. Test with SmolVLM-500M as default
3. Test model switching via environment variable
4. Update documentation to reflect the changes
5. Remove old model download logic

## Benefits

1. **Simpler**: No need to manage model downloads or paths
2. **Flexible**: Easy to switch models via environment variable
3. **Faster**: Models are cached automatically by llama.cpp
4. **Correct**: Uses SmolVLM as intended in the example notebook
5. **Modern**: Uses the latest llama.cpp features