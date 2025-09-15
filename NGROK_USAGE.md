# ngrok Usage Guide for LeKiwi Robot Nanny Cam

## Quick Start

1. **Start all services with ngrok:**
   ```bash
   ./start-all.sh
   ```

2. **Access your services remotely:**
   - Camera Viewer: Check ngrok dashboard for URL
   - Robot Monitor: Check ngrok dashboard for URL
   - Vision API: Check ngrok dashboard for URL

## Important Notes

### Large Image Payload Handling

When using ngrok with the vision system, be aware that:
- Base64 encoded images are large (1-5MB per frame)
- ngrok free tier has bandwidth limits
- WebSocket/Socket.IO connections may timeout with large payloads

### Recommended Usage

1. **For Development/Testing:**
   - Use ngrok for remote access to the UI
   - Keep vision processing local when possible
   - Reduce frame rates if experiencing issues

2. **For Production:**
   - Consider ngrok paid plans for:
     - Higher bandwidth limits
     - Stable URLs
     - Better WebSocket support
   - Or use alternative solutions like:
     - VPN access
     - Cloud deployment
     - Direct port forwarding

## Troubleshooting

### SmolVLM API Errors
If you see errors like `Cannot read properties of undefined (reading 'startsWith')`:
- This usually means image data was corrupted in transit
- Check that services are running locally first
- Verify image payloads are being sent correctly

### Connection Issues
- Check ngrok status: http://localhost:4040
- Verify all services are running: `./start-all.sh`
- Check firewall settings

### Performance Issues
- Reduce video frame rate
- Use snapshot mode instead of continuous streaming
- Consider compressing images before transmission

## URLs Management

ngrok generates random URLs each time. To get consistent URLs:
1. Sign up for ngrok account
2. Reserve custom subdomains
3. Update ngrok.yml with your custom domains

## Security

Remember that ngrok URLs are public! To secure them:
1. Use ngrok authentication
2. Add to ngrok.yml:
   ```yaml
   tunnels:
     camera-viewer:
       proto: http
       addr: 3000
       auth: "username:password"
   ```
3. Or use OAuth/IP restrictions (paid features)

## Monitoring

Check ngrok status and traffic:
- Local dashboard: http://localhost:4040
- Shows all active tunnels
- Request/response inspection
- Traffic metrics

## Stop Services

To stop everything:
1. Press Ctrl+C in the terminal running start-all.sh
2. Or run: `pkill -f ngrok`