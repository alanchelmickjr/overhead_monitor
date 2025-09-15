# Ball-in-Cup Event Tracking System Documentation

## Overview
This document describes the implementation of an event tracking system for ball-in-cup training datasets, integrated into the overhead robot monitoring system. The system tracks ball placement events, human gestures, and provides real-time scoring and visual feedback.

## Implementation Date
September 15, 2025

## System Purpose
The ball-in-cup tracking system is designed to:
- Create labeled datasets for pick-and-place robot training
- Track successful ball placements with accurate scoring
- Detect human reset gestures for dataset segmentation
- Provide visual feedback for training operators

## Key Features Implemented

### 1. Ball State Tracking
- **State Detection**: Tracks whether ball is "in cup" or "out of cup"
- **Transition Detection**: Detects state changes (out → in = score, in → out = ready)
- **Debouncing**: Prevents repeated scoring while ball remains in cup
- **State Persistence**: Maintains last known state across frames

### 2. Scoring System
- **Automatic Scoring**: Increments score only on successful placement (out → in transition)
- **Score Display**: Large, visible score counter with green highlighting
- **Manual Reset**: Button to reset score with confirmation
- **Score Persistence**: Maintains score throughout monitoring session

### 3. Visual Indicators
- **Ball Status Indicator**: 
  - 🔵 Orange glow = Ball out of cup
  - ✅ Green glow = Ball in cup
- **Ready State Indicator**:
  - Green "Ready for placement!" when ball is out
  - Red "Scoring Complete - Remove ball to continue" when ball is in
- **Last Transition Time**: Shows timestamp of last state change

### 4. Reset Detection
- **Gesture Recognition**: Detects human with one arm raised + looking at camera
- **Automatic Reset**: Resets score when gesture is detected
- **Manual Reset**: Button with confirmation dialog
- **Reset Logging**: All resets are logged with timestamp and type

### 5. AI Prompt Engineering
The system uses specialized prompts for vision models:

```javascript
// Ball Detection Prompt
"1. Ball Detection: Is there a blue ball visible in the image? 
If yes, is it currently inside a cup or outside of any cup? 
Be very specific about the ball's location."

// Gesture Detection Prompt  
"2. Human Gesture Detection: Is there a person in the frame 
with one arm raised straight up in the air AND looking 
directly at the camera? This is a reset signal."
```

## Technical Implementation

### State Management
```javascript
let ballState = {
    isInCup: false,
    lastTransitionTime: null,
    score: 0,
    isReady: false,
    lastKnownState: 'unknown'
};
```

### Event Processing Flow
1. **Image Capture**: Frame captured from camera stream
2. **AI Analysis**: Vision model analyzes frame with specialized prompts
3. **State Detection**: Parse AI response for ball location and gestures
4. **Transition Logic**: Compare with previous state, detect transitions
5. **UI Update**: Update visual indicators and score
6. **Logging**: Record events for dataset creation

### CSS Styling
- Ball indicator with dynamic glow effects
- Score display with large, bold numbers
- Ready state indicator with color coding
- Smooth transitions for state changes

## Integration Points

### Camera Server
- Uses existing camera stream at `http://localhost:3001/stream.mjpeg`
- Captures snapshots via `/snapshot.jpg` endpoint
- Proxy endpoint `/analyze` for AI model communication

### AI Models
- Compatible with both SmolVLM and Llava models
- Model selection dropdown preserved
- Custom prompts optimized for ball tracking

### Storage
- LocalStorage for settings persistence
- Alert logging for redundancy
- Event detection panel for history

## Usage Instructions

1. **Setup**:
   - Start camera server: `npm run camera-server`
   - Open `test-camera-stream-llava.html` in browser

2. **Configuration**:
   - Ensure "Track ball placement in cup" is checked
   - Optionally enable "Detect human reset gesture"
   - Set analysis interval (30 seconds recommended)

3. **Operation**:
   - Click "Start Monitoring" to begin tracking
   - Place ball in cup to score points
   - Remove ball to ready system for next placement
   - Raise arm while looking at camera to reset score

4. **Data Collection**:
   - Each successful placement is logged with timestamp
   - Reset events are tracked separately
   - All events appear in detection panel

## Deployment Considerations

### Hardware Compatibility
- **M4 Mac Mini**: Current development platform
- **AGX Xavier**: Production deployment target
- **MacBook Air M2**: Entry-level hardware validation

### Performance Notes
- Frame analysis interval adjustable (10s to 5min)
- Efficient state tracking minimizes API calls
- Visual updates use CSS transitions for smoothness

### Future Enhancements
1. **Weaviate Integration**: Vector database for training data storage
2. **Multi-Cup Support**: Track multiple cups simultaneously  
3. **Dataset Export**: Generate labeled datasets in standard formats
4. **Analytics Dashboard**: Training session statistics and insights
5. **Mobile Interface**: Responsive design for tablet monitoring

## File Modified
- `test-camera-stream-llava.html` - Complete implementation

## Dependencies
- Existing camera server infrastructure
- SmolVLM or Llava AI models
- Modern web browser with ES6 support

## Testing Checklist
- [ ] Ball detection accuracy
- [ ] State transition logic
- [ ] Score increment/reset
- [ ] Gesture recognition
- [ ] Visual indicator updates
- [ ] Cross-browser compatibility
- [ ] Model switching (SmolVLM/Llava)

## Support
For issues or enhancements, reference this documentation and the inline code comments in `test-camera-stream-llava.html`.