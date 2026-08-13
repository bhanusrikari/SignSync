# SignSync — Technical Specification

## 1. Architecture Change

The previous architecture based on building a standalone WebRTC video-calling application is **no longer the primary architecture**.

SignSync should be implemented as a **browser extension**.

The extension must operate alongside existing browser-based video calling applications.

The underlying video call belongs to the existing platform.

SignSync provides the accessibility layer.

---

# 2. High-Level Architecture

```text
┌─────────────────────────────────────────────┐
│          Existing Video Call Website        │
│                                             │
│   Google Meet / Zoom Web / Teams Web        │
│                                             │
│   ┌─────────────────────────────────────┐   │
│   │         SignSync Overlay            │   │
│   │                                     │   │
│   │ 🖐 HELP                             │   │
│   │                                     │   │
│   │ Captions     🔊 Speech     ⚙️       │   │
│   └─────────────────────────────────────┘   │
└──────────────────────┬──────────────────────┘
                       │
                 Content Script
                       │
              ┌────────┴─────────┐
              │                  │
        Extension UI        AI Processing
              │                  │
         Popup UI          MediaPipe Hands
              │             Gesture Model
              │                  │
              └────────┬─────────┘
                       │
                 Service Worker
                       │
                 Chrome Storage
```

---

# 3. Technology Stack

## Browser Extension

Use:

* Chrome Extension Manifest V3
* React
* TypeScript
* Vite
* Tailwind CSS
* Lucide React
* Framer Motion where useful

---

## AI

Use:

* MediaPipe Hands
* OpenCV where required
* NumPy
* scikit-learn
* Random Forest
* Pickle/joblib

For a production-oriented future version, the model can be moved to browser-compatible inference using ONNX Runtime Web or TensorFlow.js.

For the hackathon, prioritize the simplest reliable inference architecture.

---

## Backend

FastAPI is optional for the MVP.

Use it only for functionality that genuinely requires a server, such as:

* Model management
* User-specific data processing
* Future translation APIs
* Analytics
* Advanced personalized model training

Do **not** route every camera frame through FastAPI.

---

## Storage

Firebase:

* Firebase Authentication
* Firestore

Use Chrome Storage for lightweight local extension configuration.

---

# 4. Repository Structure

Use:

```text
signsync/
│
├── extension/
│   ├── src/
│   │   ├── popup/
│   │   │   ├── App.tsx
│   │   │   ├── main.tsx
│   │   │   └── components/
│   │   │
│   │   ├── content/
│   │   │   ├── content.tsx
│   │   │   ├── Overlay.tsx
│   │   │   ├── CaptionOverlay.tsx
│   │   │   └── styles.css
│   │   │
│   │   ├── background/
│   │   │   └── service-worker.ts
│   │   │
│   │   ├── ai/
│   │   │   ├── handTracker.ts
│   │   │   ├── featureExtractor.ts
│   │   │   ├── gestureClassifier.ts
│   │   │   └── inference.ts
│   │   │
│   │   ├── audio/
│   │   │   ├── speechRecognition.ts
│   │   │   └── speechSynthesis.ts
│   │   │
│   │   ├── hooks/
│   │   │   ├── useGestureRecognition.ts
│   │   │   ├── useSpeechRecognition.ts
│   │   │   └── useSettings.ts
│   │   │
│   │   ├── services/
│   │   │   ├── storage.ts
│   │   │   ├── firebase.ts
│   │   │   └── history.ts
│   │   │
│   │   ├── types/
│   │   ├── utils/
│   │   └── shared/
│   │
│   ├── public/
│   │   ├── manifest.json
│   │   └── icons/
│   │
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   └── .env
│
├── ai-training/
│   ├── dataset/
│   ├── train.py
│   ├── feature_extractor.py
│   ├── labels.json
│   └── models/
│
├── backend/
│   ├── app/
│   ├── requirements.txt
│   └── .env
│
├── README.md
└── .gitignore
```

---

# 5. Chrome Extension Components

Manifest V3 should define:

```text
popup
content_scripts
background service worker
permissions
host_permissions
```

Conceptually:

```json
{
  "manifest_version": 3,
  "name": "SignSync",
  "description": "AI accessibility companion for video communication",
  "action": {
    "default_popup": "popup.html"
  },
  "background": {
    "service_worker": "background.js"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content.js"]
    }
  ]
}
```

Use the minimum permissions necessary.

Do not request excessive permissions without justification.

---

# 6. Extension Components

## Popup

The popup is responsible for:

* Enable/disable
* Language
* Feature toggles
* Settings
* Status

---

## Content Script

The content script is responsible for:

* Injecting the SignSync accessibility overlay
* Rendering captions
* Receiving state updates
* Communicating with the extension runtime

It should not contain the entire AI system.

---

## Service Worker

The service worker handles:

* Extension-level state
* Message routing
* Storage operations
* Background events

Do not attempt to maintain continuous camera processing inside the service worker.

---

# 7. Communication Architecture

Use Chrome Extension messaging.

```text
Popup
  │
  │ chrome.runtime.sendMessage
  ▼
Service Worker
  │
  │ chrome.tabs.sendMessage
  ▼
Content Script
  │
  ▼
Overlay
```

Example messages:

```text
ENABLE_SIGNSYNC
DISABLE_SIGNSYNC
UPDATE_SETTINGS
GESTURE_DETECTED
CAPTION_UPDATE
SPEECH_RESULT
CLEAR_HISTORY
```

---

# 8. SignSync State

Central state:

```ts
type SignSyncState = {
  enabled: boolean;
  gestureRecognition: boolean;
  captions: boolean;
  speechOutput: boolean;
  speechRecognition: boolean;
  language: "en-IN" | "hi-IN" | "te-IN";
  overlayPosition: {
    x: number;
    y: number;
  };
};
```

Store lightweight settings using Chrome Storage.

---

# 9. Enable / Disable Lifecycle

## Enable

```text
Popup
 ↓
ENABLE_SIGNSYNC
 ↓
Content Script
 ↓
Create Overlay
 ↓
Request Required Permission
 ↓
Start AI
```

---

## Disable

```text
Popup
 ↓
DISABLE_SIGNSYNC
 ↓
Stop AI
 ↓
Stop Processing
 ↓
Remove/Hide Overlay
```

The underlying website must remain unaffected.

---

# 10. Critical Design Requirement

**SignSync must never replace the webpage's video-call functionality.**

Do not:

* Create a second video call
* Capture and re-stream the entire call unnecessarily
* Replace the site's video elements
* Depend on internal WebRTC implementation of Meet/Zoom/Teams

Instead:

```text
Existing Call
     │
     └── SignSync Accessibility Layer
```

---

# 11. Camera Architecture

The extension should use camera access for gesture recognition.

Conceptually:

```text
User Camera
     │
     ├─────────────→ Existing Video Call
     │
     └─────────────→ SignSync Gesture Processing
```

However, browsers may restrict simultaneous access or create conflicts depending on the platform.

Therefore:

1. Detect whether camera access is available.
2. Request permission clearly.
3. If direct camera access conflicts with the existing call, provide a fallback architecture.
4. Never break the existing call.

---

# 12. AI Processing

Preferred pipeline:

```text
Camera Frame
      ↓
MediaPipe Hands
      ↓
21 Landmarks
      ↓
Normalization
      ↓
Feature Vector
      ↓
Random Forest
      ↓
Label + Confidence
      ↓
Temporal Smoothing
      ↓
Overlay
```

---

# 13. Landmark Features

Each hand:

```text
21 landmarks
×
x, y, z
=
63 raw values
```

Normalize around the wrist:

```python
x_i' = x_i - x_wrist
y_i' = y_i - y_wrist
z_i' = z_i - z_wrist
```

Flatten into a feature vector.

---

# 14. Gesture Model

Initial vocabulary:

```text
HELLO
YES
NO
HELP
WATER
THANK_YOU
STOP
CALL
EMERGENCY
OK
```

Model:

```python
RandomForestClassifier
```

Prediction:

```json
{
  "label": "HELP",
  "confidence": 0.94
}
```

---

# 15. Confidence Threshold

Use:

```text
CONFIDENCE_THRESHOLD = 0.75
```

If confidence is below threshold:

```text
Do not update the caption.
```

Make the threshold configurable.

---

# 16. Temporal Smoothing

Don't display every frame's prediction.

Example:

```text
Frame 1 → HELP
Frame 2 → HELP
Frame 3 → HELP
Frame 4 → UNKNOWN
Frame 5 → HELP

Result → HELP
```

Use a rolling window.

Suggested:

```text
WINDOW_SIZE = 5
MIN_OCCURRENCES = 3
```

---

# 17. Overlay Architecture

The overlay should be injected into the current webpage using a Shadow DOM where practical.

Reason:

Video websites often have their own CSS.

Without isolation:

```text
Meet CSS
   ↓
SignSync CSS conflict
```

Use:

```text
Web Page
   │
   └── SignSync Host
           │
        Shadow DOM
           │
        SignSync UI
```

This prevents most style collisions.

---

# 18. Overlay Position

Use:

```css
position: fixed;
z-index: very-high;
```

The overlay must:

* Stay above page content
* Be draggable
* Not block the underlying video controls unnecessarily
* Allow pointer interaction only on SignSync controls

---

# 19. Caption Component

Create:

```text
CaptionOverlay.tsx
```

Example:

```text
┌─────────────────────────────┐
│ 🖐 HELP                     │
│ Confidence: High            │
└─────────────────────────────┘
```

Avoid exposing confidence numbers to normal users unless useful.

Instead use:

```text
High confidence
```

or simply display the recognized phrase.

---

# 20. Speech Recognition

Use the browser Speech Recognition API where available.

Create:

```text
useSpeechRecognition()
```

Flow:

```text
Speech
 ↓
Browser Speech Recognition
 ↓
Transcript
 ↓
Caption Overlay
```

If unsupported:

```text
Speech recognition isn't supported in this browser.
```

Do not break the extension.

---

# 21. Speech Synthesis

Use:

```text
window.speechSynthesis
```

Flow:

```text
Gesture
 ↓
Text
 ↓
Speech Synthesis
```

Example:

```text
HELP
 ↓
"Help"
```

Use selected language where supported.

---

# 22. Language Configuration

Centralize:

```ts
const LANGUAGES = {
  en: {
    code: "en-IN",
    name: "English"
  },
  hi: {
    code: "hi-IN",
    name: "Hindi"
  },
  te: {
    code: "te-IN",
    name: "Telugu"
  }
};
```

---

# 23. Personalized Gestures

MVP implementation:

```text
Create Personalized Gesture
        ↓
Name
        ↓
Phrase
        ↓
Associate Gesture
```

Example:

```text
Gesture: Custom gesture
Phrase: "I need my medicine"
```

Store metadata in Firestore/local storage.

---

# 24. Conversation History

Store:

```ts
type ConversationEntry = {
  text: string;
  source: "gesture" | "speech";
  language: string;
  timestamp: number;
};
```

Example:

```json
{
  "text": "HELP",
  "source": "gesture",
  "language": "en-IN",
  "timestamp": 1786620000000
}
```

For privacy, local storage should be preferred for the MVP unless cloud synchronization is required.

---

# 25. Privacy Architecture

Prefer:

```text
Camera
 ↓
Local Browser Processing
 ↓
Gesture
```

instead of:

```text
Camera
 ↓
Upload Frame
 ↓
FastAPI
 ↓
AI
 ↓
Response
```

Do not upload raw camera frames by default.

Do not store raw video unless explicitly required.

---

# 26. Backend

FastAPI should be **optional rather than mandatory**.

If used, expose:

```text
GET /health
POST /api/gestures/personalized
GET /api/history
```

Do not build an API that receives a continuous video stream for every frame.

---

# 27. Firebase

Use Firebase for:

* Optional authentication
* User profile
* Cloud-synced personalized gestures
* Optional conversation history

The extension should remain functional without authentication for the core gesture-recognition experience where practical.

---

# 28. Platform Compatibility

The architecture should be:

```text
                    SignSync
                       │
          ┌────────────┴────────────┐
          │                         │
   Generic Browser Layer      Optional Adapters
          │                         │
          ▼                         ├── Google Meet
  Content Script + Overlay          ├── Zoom Web
                                    └── Teams Web
```

The generic layer should handle:

* Overlay
* Gesture recognition
* Settings
* Captions
* Speech

Platform adapters should only be introduced when a platform-specific integration is actually required.

---

# 29. Do Not Depend on DOM Scraping

Avoid fragile logic like:

```text
Find Google Meet caption element
Replace it
```

or:

```text
Find Zoom video element
Modify it
```

The MVP should render its own overlay.

This makes SignSync substantially more platform independent.

---

# 30. Browser Permissions

Request permissions only when necessary.

Potential permissions include:

* Camera
* Microphone
* Storage
* Active tab / host access

Explain to users why a permission is required.

Example:

```text
Camera access is required for AI gesture recognition.
```

---

# 31. Security

Never commit:

```text
.env
Firebase private keys
API keys
service-account credentials
model secrets
```

Use:

```text
.env.example
```

and `.gitignore`.

---

# 32. Performance

The extension must not noticeably degrade the video call.

Do not process every camera frame through the entire AI pipeline.

Use:

```text
requestAnimationFrame
+
inference throttling
```

Target approximately:

```text
UI: 30 FPS where possible
AI inference: 5–15 predictions/sec
```

The exact rate should be configurable.

---

# 33. Failure Handling

## Camera Permission Denied

```text
Sign recognition requires camera access.
```

The underlying video call should continue.

---

## AI Model Unavailable

```text
Sign recognition is temporarily unavailable.
```

Do not disable the video call.

---

## Speech Recognition Unsupported

```text
Speech recognition isn't supported in this browser.
```

Other SignSync features continue working.

---

## Extension Disabled

Everything SignSync-specific disappears.

The video call continues normally.

---

# 34. Testing

## Extension

Test:

```text
[ ] Install extension
[ ] Popup opens
[ ] Enable works
[ ] Disable works
[ ] Overlay appears
[ ] Overlay disappears
[ ] Overlay doesn't break webpage
[ ] Overlay can be dragged
[ ] Settings persist
```

---

## AI

```text
[ ] MediaPipe detects hand
[ ] Known gesture recognized
[ ] Unknown gesture rejected
[ ] Low confidence rejected
[ ] Predictions smoothed
```

---

## Browser Integration

Test on at least:

```text
[ ] Google Meet Web
[ ] Zoom Web if available
[ ] Microsoft Teams Web if available
```

Do not claim universal support until tested.

---

# 35. Development Phases

## Phase 1 — Extension Foundation

```text
[ ] Create Manifest V3 extension
[ ] React + TypeScript + Vite
[ ] Popup
[ ] Content script
[ ] Service worker
[ ] Messaging
```

---

## Phase 2 — Overlay

```text
[ ] Inject overlay
[ ] Shadow DOM
[ ] Enable/disable
[ ] Draggable UI
[ ] Caption component
```

---

## Phase 3 — AI

```text
[ ] Camera access
[ ] MediaPipe
[ ] Landmark extraction
[ ] Feature normalization
[ ] Random Forest
[ ] Prediction
[ ] Confidence threshold
[ ] Temporal smoothing
```

---

## Phase 4 — Communication

```text
[ ] Gesture → text
[ ] Gesture → speech
[ ] Speech → text
[ ] Captions
```

---

## Phase 5 — Product Features

```text
[ ] Language selector
[ ] History
[ ] Personalized gestures
[ ] Settings
```

---

## Phase 6 — Platform Testing

```text
[ ] Google Meet
[ ] Zoom Web
[ ] Microsoft Teams Web
[ ] Verify no UI interference
```

---

# 36. Demo Mode

Create:

```text
VITE_DEMO_MODE=true
```

Demo mode should allow the team to demonstrate the UI even if browser permissions or model loading fail.

It can provide:

```text
Simulated gesture:
HELP

Simulated speech:
"I need assistance."
```

However, the real AI pipeline must be demonstrated whenever possible.

---

# 37. Hackathon Demo Acceptance Test

Before the presentation:

```text
[ ] Extension installed
[ ] Video call opened
[ ] SignSync popup opened
[ ] SignSync enabled
[ ] Overlay appears
[ ] Camera permission works
[ ] Hand detected
[ ] HELP gesture recognized
[ ] Caption appears
[ ] Speech output works
[ ] Speech-to-text works where supported
[ ] Language can be changed
[ ] SignSync disabled
[ ] Overlay disappears
[ ] Video call continues normally
```

---

# 38. Critical Technical Constraint

Do not tell Claude Code to build:

```text
"SignSync video calling"
```

Instead tell it to build:

```text
"SignSync accessibility extension that runs alongside existing browser-based video calls."
```

The existing application owns:

```text
Video
Audio
Call connection
Participants
```

SignSync owns:

```text
AI gesture recognition
Accessibility overlay
Gesture → text
Gesture → speech
Speech → text
Personalized gestures
Language settings
Accessibility controls
```

---

# 39. Final Technical Architecture

```text
                  EXISTING VIDEO CALL
                         │
             ┌───────────┴───────────┐
             │                       │
          Video                   Audio
             │                       │
             │                       │
       ┌─────┴───────────────────────┴─────┐
       │            SIGN SYNC                │
       │                                     │
       │  Chrome Extension                   │
       │                                     │
       │  ┌───────────────┐                  │
       │  │ Popup         │                  │
       │  └───────┬───────┘                  │
       │          │                          │
       │  ┌───────▼────────┐                 │
       │  │ Service Worker  │                 │
       │  └───────┬────────┘                 │
       │          │                          │
       │  ┌───────▼────────┐                 │
       │  │ Content Script │                 │
       │  └───────┬────────┘                 │
       │          │                          │
       │  ┌───────▼────────┐                 │
       │  │ Shadow DOM     │                 │
       │  │ Overlay        │                 │
       │  └───────┬────────┘                 │
       │          │                          │
       │  ┌───────▼──────────────┐           │
       │  │ AI Accessibility     │           │
       │  │ Engine               │           │
       │  │                      │           │
       │  │ MediaPipe            │           │
       │  │ Feature Extraction   │           │
       │  │ Random Forest        │           │
       │  └──────────────────────┘           │
       │                                     │
       │  Speech Recognition                 │
       │  Speech Synthesis                   │
       │  Language Support                   │
       │  Personalized Gestures              │
       │  Conversation History               │
       └─────────────────────────────────────┘
```

---

# 40. Claude Code's First Task

When starting implementation, **do not immediately build every feature**.

First create:

```text
1. Manifest V3 extension
2. React + TypeScript + Vite setup
3. Popup UI
4. Content script
5. Service worker
6. Popup ↔ content-script messaging
7. Enable/disable state
8. Shadow DOM accessibility overlay
```

Then verify that:

```text
Chrome
 ↓
Open Google Meet
 ↓
Click SignSync
 ↓
Enable
 ↓
Overlay appears
 ↓
Disable
 ↓
Overlay disappears
```

Only after this works should AI gesture recognition be added.

The second milestone should be:

```text
Camera
 ↓
MediaPipe
 ↓
Gesture recognition
 ↓
Live overlay
```

Then add speech, multilingual support, history, and personalized gestures.

**The most important requirement is that SignSync must remain an independent accessibility layer and must not become another video-calling application.**
