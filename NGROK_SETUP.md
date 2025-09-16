# 🦜 ngrok Setup Guide for LeKiwi Pen Nanny Cam

This guide explains how to use ngrok with your LeKiwi Pen Nanny Cam system for secure remote access.

## 🚀 Quick Start

1. **Get your ngrok auth token**:
   - Sign up at https://ngrok.com (free account works)
   - Get your auth token from: https://dashboard.ngrok.com/get-started/your-authtoken

2. **Configure ngrok**:
   ```bash
   ngrok config add-authtoken YOUR_AUTH_TOKEN_HERE
   ```

3. **Start everything with one command**:
   ```bash
   ./start-all.sh
   ```

That's it! The script will:
- ✅ Check and install ngrok if needed
- ✅ Start all services (camera, robot monitor, LLaVA API)
- ✅ Create secure tunnels for remote access
- ✅ Display your public URLs

## 📊 Monitoring Tunnels

Check your tunnel status anytime:
```bash
./ngrok-status.sh
```

Or visit the ngrok dashboard:
```bash
open http://localhost:4040
```

## 🔗 Service Endpoints

### Local Access (always available):
- **Camera Viewer**: http://localhost:3000
- **Model Comparison**: http://localhost:3000
- **LLaVA API**: http://localhost:8080/v1/chat/completions
- **Public Robot Monitor**: http://localhost:4040

### Remote Access (when ngrok is running):
Your public URLs will be displayed when you run `./start-all.sh`

Example URLs:
- Camera: `https://abc123.ngrok-free.app` → localhost:3000
- Robot: `https://def456.ngrok-free.app` → localhost:4040
- API: `https://ghi789.ngrok-free.app` → localhost:8080

## 🛠️ Configuration Details

The `ngrok.yml` file defines tunnels for:
- `camera-viewer`: Main UI interface (port 3000)
- `robot-monitor`: LeKiwi pen monitoring and RTSP proxy (port 4040)
- `llava-api`: Vision AI API endpoint (port 8080)

Each tunnel:
- Uses HTTPS by default (`bind_tls: true`)
- Includes request inspection
- Has descriptive metadata

## 🔧 Troubleshooting

### ngrok not starting?
1. Check if you've added your auth token:
   ```bash
   ngrok config check
   ```

2. Verify ngrok is installed:
   ```bash
   ngrok version
   ```

3. Check for port conflicts:
   ```bash
   lsof -i :4040  # ngrok web interface
   ```

### Can't access remote URLs?
- Free ngrok accounts have limits (40 connections/minute)
- URLs change on each restart (upgrade for static domains)
- Some networks block ngrok (try different region in ngrok.yml)

### Services not accessible?
1. Check local services first:
   ```bash
   curl http://localhost:3000  # Should respond
   ```

2. Check ngrok tunnel status:
   ```bash
   curl http://localhost:4040/api/tunnels
   ```

## 🎯 Pro Tips

1. **Copy URLs quickly**:
   ```bash
   # Copy camera URL to clipboard (macOS)
   curl -s http://localhost:4040/api/tunnels | grep -o '"public_url":"[^"]*' | grep camera | cut -d'"' -f4 | pbcopy
   ```

2. **Use specific tunnels**:
   ```bash
   # Start only camera viewer tunnel
   ngrok start camera-viewer --config ngrok.yml
   ```

3. **Custom domains** (paid feature):
   - Add to ngrok.yml: `hostname: your-app.ngrok.io`

4. **Region selection**:
   - Default: `us` (United States)
   - Options: `eu` (Europe), `ap` (Asia/Pacific), `au` (Australia), `sa` (South America), `jp` (Japan), `in` (India)

## 🔐 Security Notes

- ngrok tunnels are secure (HTTPS/TLS encrypted)
- Anyone with the URL can access your services
- Use ngrok's built-in authentication for sensitive data:
  ```yaml
  tunnels:
    camera-viewer:
      auth: "username:password"
  ```

## 📱 Mobile Access

Your public ngrok URLs work great on mobile devices:
1. Run `./start-all.sh`
2. Get the camera URL from the output
3. Open on your phone/tablet
4. Add to home screen for app-like experience

## 🆘 Need Help?

- Run without ngrok: Answer 'y' when prompted to continue locally
- Check logs: `cat ~/.ngrok2/ngrok.log`
- ngrok docs: https://ngrok.com/docs

---

**Remember**: The enhanced `start-all.sh` handles everything automatically. Just run it and enjoy remote access to your LeKiwi Pen Nanny Cam! 🦜🎉