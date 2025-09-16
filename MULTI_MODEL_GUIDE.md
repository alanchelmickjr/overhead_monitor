# Multi-Model Vision System Guide

## Overview

The enhanced Robot Monitoring System now supports multiple vision models, allowing you to switch between different models based on your hardware capabilities and accuracy requirements. This guide covers the multi-model architecture, configuration, and usage.

## Supported Models

### 1. SmolVLM (500M)
- **Size**: Small (500M parameters)
- **Best for**: Edge devices, real-time processing
- **Processing Time**: ~100-200ms
- **Hardware**: CPU, M4 Mac, Xavier

### 2. LLaVA-7B
- **Size**: Medium (7B parameters)
- **Best for**: Balanced performance and accuracy
- **Processing Time**: ~500-1000ms
- **Hardware**: M4 Mac (Metal), Xavier (CUDA)

### 3. LLaVA-13B
- **Size**: Large (13B parameters)
- **Best for**: Maximum accuracy
- **Processing Time**: ~1000-2000ms
- **Hardware**: High-end GPUs

### 4. Custom Models
- Support for fine-tuned models
- Configurable through `config/models.json`

## Hardware Profiles

### Apple M4 Mac
- **Optimizations**: Metal Performance Shaders
- **Recommended Models**: SmolVLM-500M, LLaVA-7B
- **Batch Processing**: Supported

### NVIDIA AGX Xavier
- **Optimizations**: CUDA, TensorRT, INT8 quantization
- **Recommended Models**: SmolVLM-500M, LLaVA-7B
- **Batch Processing**: Optimized for parallel inference

### CPU-Only
- **Optimizations**: OpenVINO (Intel), basic threading
- **Recommended Models**: SmolVLM-500M
- **Batch Processing**: Limited

## Quick Start

### 1. Start the Enhanced Server

```bash
# Make sure you have the vision API running (e.g., llama.cpp server)
# Default expects it at http://localhost:8080

# Start the enhanced monitoring server
node robot-monitor-server-enhanced.js

# Or with custom vision API URL
VISION_API_URL=http://your-server:8080 node robot-monitor-server-enhanced.js
```

### 2. Access the Web Interface

Open your browser to: `http://localhost:3000`

### 3. Select a Model

Use the model dropdown in the header to switch between available models. The system will automatically detect your hardware and show recommended models with a ⭐ star.

## Features

### Model Switching
- Real-time model switching without restarting
- Automatic parameter adjustment
- Performance metrics tracking

### Benchmarking
- Compare all models on your hardware
- Test different detection scenarios
- Export results as CSV or JSON

### Model Comparison
- Side-by-side comparison of two models
- Detailed metrics: speed, accuracy, confidence
- Visual winner indication

### Auto-Selection
- Define your requirements (latency, accuracy)
- System selects the best model automatically
- Considers hardware capabilities

## API Endpoints

### Model Management

```bash
# Get available models
GET /models

# Switch model
POST /models/switch
Body: { "modelId": "smolvlm-500m" }

# Benchmark all models
POST /models/benchmark
Body: { "testFrame": "base64_image_data" }

# Compare two models
POST /models/compare
Body: { 
  "model1": "smolvlm-500m",
  "model2": "llava-7b",
  "testFrame": "base64_image_data"
}

# Get performance metrics
GET /models/performance

# Export benchmark results
GET /models/benchmark/export?format=csv
```

### Vision Analysis

```bash
# Analyze frame with current model
POST /analyze
Body: {
  "image": "base64_image_data",
  "prompt": "Detect robots and safety issues",
  "model": "optional_model_override"
}
```

## Configuration

### Model Configuration (config/models.json)

```json
{
  "models": {
    "custom-robot-v1": {
      "id": "custom-robot-v1",
      "name": "Custom Robot Detector v1",
      "description": "Fine-tuned on your robot dataset",
      "type": "vision",
      "size": "500M",
      "hardware": ["cpu", "m4", "xavier"],
      "endpoints": {
        "api": {
          "model": "custom-robot-detector",
          "base_url": "http://localhost:8080"
        }
      },
      "parameters": {
        "max_tokens": 200,
        "temperature": 0.5,
        "ctx_size": 2048
      },
      "prompts": {
        "style": "robot-focused",
        "prefix": "ROBOT DETECTION: "
      }
    }
  }
}
```

### Environment Variables

```bash
# Vision API URL (default: http://localhost:8080)
VISION_API_URL=http://your-api:8080

# Camera URL (with auth)
CAMERA_URL=rtsp://user:pass@192.168.1.100:554/stream1

# Hardware profile override
HARDWARE_PROFILE=xavier  # Options: cpu, m4, xavier
```

## Testing

### Run Comprehensive Tests

```bash
# Test all multi-model features
node test-multi-model-system.js

# This will:
# - List available models
# - Test model switching
# - Run benchmarks
# - Compare models
# - Test auto-selection
# - Monitor performance
```

### Test Output Files
- `benchmark-results.csv` - Benchmark data in CSV format
- `test-report.json` - Complete test report with recommendations

## Best Practices

### 1. Model Selection
- Start with SmolVLM for testing
- Use benchmarking to find the best model for your hardware
- Consider your latency vs accuracy requirements

### 2. Prompt Optimization
- Each model has optimized prompts
- Test different prompt styles for your use case
- Fine-tune prompts in the model configuration

### 3. Performance Tuning
- Monitor the performance metrics regularly
- Use hardware-specific optimizations
- Enable caching for repeated detections

### 4. Deployment
- For production, use the recommended model for your hardware
- Set up monitoring alerts for model performance
- Implement fallback models for reliability

## Troubleshooting

### Model Not Loading
```bash
# Check if models.json exists
ls config/models.json

# Verify vision API is running
curl http://localhost:8080/v1/models

# Check logs for errors
# The server will show detailed error messages
```

### Poor Performance
1. Run benchmarks to identify bottlenecks
2. Check hardware utilization
3. Consider using a smaller model
4. Enable hardware optimizations

### Incorrect Detections
1. Try different models
2. Adjust prompts for your scenario
3. Consider fine-tuning a model
4. Check image quality and lighting

## Advanced Usage

### Custom Model Integration

1. Train your model using your robot dataset
2. Deploy it to a compatible inference server
3. Add configuration to `models.json`
4. Test with the benchmark tool

### Batch Processing

```javascript
// Process multiple cameras with different models
const cameras = ['camera1', 'camera2', 'camera3'];
const models = ['smolvlm-500m', 'llava-7b'];

for (const camera of cameras) {
  const bestModel = await modelSelector.autoSelectModel({
    maxLatency: camera === 'camera1' ? 500 : 1000,
    minAccuracy: 0.75
  });
  
  // Process camera with selected model
}
```

### Performance Monitoring

```javascript
// Set up performance alerts
modelSelector.on('model-switched', (data) => {
  console.log(`Switched to ${data.to}`);
});

visionEngine.on('analysis-complete', (result) => {
  if (result.processingTime > 1000) {
    console.warn('Slow processing detected');
  }
});
```

## Future Enhancements

### Planned Features
1. **Model Fine-tuning Pipeline**: Tools to fine-tune models on your robot data
2. **A/B Testing**: Automatic comparison of models in production
3. **Model Versioning**: Track and rollback model versions
4. **Cloud Model Support**: Integration with cloud-hosted models
5. **Mobile App**: iOS/Android apps with model selection

### Contributing
To add support for a new model:
1. Add model configuration to `config/models.json`
2. Test with the benchmark tool
3. Submit a pull request with results

## Support

For issues or questions:
1. Check the troubleshooting section
2. Run the test suite for diagnostics
3. Check server logs for detailed errors
4. Open an issue on GitHub with test reports

---

Remember: The best model depends on your specific use case, hardware, and requirements. Use the benchmarking tools to make data-driven decisions!