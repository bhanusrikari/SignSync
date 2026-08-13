# SignSync — Product Requirements Document

**Project:** SignSync — AI-Powered Inclusive Communication Accessibility Extension
**Team:** CodeRRR
**Hackathon:** DEMUX 3.0 — Open Innovation
**Domain:** Healthcare & Social Impact — Accessibility, Assistive Technology & Inclusive Communication

---

# 1. Product Vision

SignSync is an **AI-powered accessibility extension that works alongside existing video-calling and communication platforms**.

Instead of creating another video-calling application, SignSync acts as an accessibility layer that users can enable whenever they need it.

The user continues using platforms they already know, while SignSync provides additional accessibility capabilities such as:

* Real-time gesture/sign recognition
* Gesture → text
* Gesture → speech
* Speech → text
* Live accessibility captions
* Personalized gestures
* Multilingual support
* Accessibility controls

The primary goal is:

> **Make existing video communication more accessible without forcing users to switch platforms.**

---

# 2. Product Concept

The product should behave like a browser extension.

Example:

```text
User opens Google Meet / Zoom Web / Microsoft Teams Web
                    ↓
              User joins call
                    ↓
            Opens SignSync
                    ↓
              Enable SignSync
                    ↓
        Accessibility layer appears
                    ↓
       User can disable it anytime
```

SignSync should not replace the existing video call.

It should operate **on top of or alongside** it.

---

# 3. Problem Statement

People with hearing or speech impairments, sign-language users, and elderly users can experience communication barriers when interacting with people who do not understand sign language.

Existing video calling platforms provide video, audio, and sometimes basic captions, but they generally do not provide personalized AI-powered sign/gesture communication.

This creates a significant accessibility gap.

Instead of asking users to move to a completely different communication platform, SignSync provides an accessibility layer that can be activated when needed.

---

# 4. Target Users

## 4.1 Sign-Language Users

Users who communicate through gestures/sign language.

Needs:

* Gesture recognition
* Live captions
* Speech output
* Simple controls
* Existing video-call compatibility

---

## 4.2 Non-Signers

People who do not understand sign language.

Needs:

* Understanding detected gestures
* Captions
* Optional speech output
* Minimal interaction changes

---

## 4.3 Elderly Users

Users who may benefit from simple personalized gestures.

Needs:

* Large controls
* Simple interface
* Personalized gestures
* Minimal configuration

---

# 5. Product Goals

## Primary Goal

Allow users to activate AI accessibility features **during an existing video call without changing the communication platform**.

---

## MVP Goals

The MVP should demonstrate:

```text
Existing Video Call
        ↓
SignSync Extension
        ↓
Enable Accessibility
        ↓
Camera / Audio Input
        ↓
AI Processing
        ↓
Gesture / Speech Recognition
        ↓
Live Accessibility Overlay
```

---

# 6. Core Product Principle

SignSync should follow:

> **Don't replace the communication platform. Enhance it.**

The user should still be able to use:

* Google Meet
* Zoom Web
* Microsoft Teams Web
* Other browser-based video communication platforms

The MVP should primarily target **browser-based video calls**.

Support for every native desktop/mobile application is not guaranteed by the browser extension architecture.

---

# 7. Scope

## In Scope

* Chrome/Chromium browser extension
* React + TypeScript extension UI
* Enable/disable accessibility mode
* Floating accessibility overlay
* Camera-based gesture recognition
* Gesture → text
* Gesture → speech
* Speech → text where browser permissions/APIs allow
* Multilingual interface
* Personalized gestures
* Conversation history
* Accessible UI

---

## Out of Scope for MVP

* Building a separate video-calling application
* Building our own WebRTC calling system
* Replacing Google Meet/Zoom/Teams
* Deep integration with private APIs of third-party platforms
* Guaranteed compatibility with every native desktop application
* Full unrestricted sign-language translation
* Medical diagnosis
* Real emergency-service integration

---

# 8. User Experience

## 8.1 Installation

User installs the SignSync browser extension.

After installation:

```text
SignSync
AI Accessibility Companion

[Get Started]
```

---

# 9. Extension Popup

Clicking the browser extension icon opens:

```text
┌──────────────────────────────┐
│          SignSync             │
│ AI Accessibility Companion   │
├──────────────────────────────┤
│                              │
│ Accessibility                │
│                              │
│       ● ENABLED              │
│                              │
│ ☑ Gesture Recognition        │
│ ☑ Live Captions              │
│ ☑ Speech Output              │
│                              │
│ Language                     │
│ [ English ▼ ]                │
│                              │
│       [ Disable ]            │
└──────────────────────────────┘
```

---

# 10. Enable / Disable

The most important interaction is:

```text
SignSync OFF
     ↓
User clicks Enable
     ↓
SignSync ON
     ↓
Accessibility overlay appears
```

When disabled:

* AI processing stops
* Camera processing stops
* Audio processing stops where applicable
* Overlay disappears
* Existing video call continues normally

The extension must not interfere with the underlying video call when disabled.

---

# 11. Accessibility Overlay

Once enabled, SignSync displays a floating overlay on the current webpage.

Example:

```text
┌──────────────────────────────┐
│ SignSync              ON ●   │
├──────────────────────────────┤
│ 🖐 Gesture: HELP             │
│                              │
│ 🔊 Speech Output             │
│ 💬 Captions                  │
│                              │
│ [Settings] [Disable]         │
└──────────────────────────────┘
```

The overlay should be:

* Draggable
* Non-blocking
* Resizable if practical
* Visually distinct
* Accessible
* Usable over video content

---

# 12. Gesture Recognition

The system should use the user's camera to recognize a focused set of gestures.

Initial example vocabulary:

```text
HELLO
YES
NO
HELP
WATER
THANK YOU
STOP
CALL
EMERGENCY
OK
```

The exact vocabulary may change according to the training dataset.

---

# 13. Gesture Recognition Flow

```text
User Camera
     ↓
MediaPipe Hands
     ↓
21 Hand Landmarks
     ↓
Feature Extraction
     ↓
ML Classifier
     ↓
Gesture + Confidence
     ↓
Temporal Smoothing
     ↓
Accessibility Overlay
```

---

# 14. Gesture → Text

Example:

```text
User performs gesture

        ↓

AI detects:

HELP

        ↓

SignSync overlay:

┌───────────────────┐
│ 🖐 HELP           │
└───────────────────┘
```

The recognized phrase can be added to conversation history.

---

# 15. Gesture → Speech

Optional text-to-speech:

```text
Gesture
   ↓
HELP
   ↓
Browser Speech Synthesis
   ↓
"Help"
```

The user can toggle this feature.

---

# 16. Speech → Text

Where browser capabilities and permissions allow:

```text
Speech
   ↓
Browser Speech Recognition
   ↓
Text
   ↓
SignSync Caption Overlay
```

The caption should appear in a floating accessibility layer.

---

# 17. Multilingual Support

Initial languages:

* English
* Hindi
* Telugu

The abstract explicitly specifies these languages.

Language selection:

```text
English
Hindi
Telugu
```

The system should use a centralized language configuration so more languages can be added later.

---

# 18. Personalized Gestures

Users can define frequently used gestures/phrases.

Example:

```text
Custom Gesture
       ↓
"I need my medicine"
```

The goal is particularly useful for elderly users or users with personalized communication patterns.

For the hackathon MVP, this can initially be implemented using a limited set of custom gesture mappings.

---

# 19. Conversation History

The extension can optionally maintain recognized communication.

Example:

```text
Today — 1:42 PM

HELP
I need water
Thank you
```

Each entry can contain:

* Text
* Source
* Timestamp
* Language

Users should be able to clear history.

---

# 20. Accessibility Controls

The extension should allow:

* Enable/disable gesture recognition
* Enable/disable captions
* Enable/disable speech output
* Language selection
* Overlay position
* Font size
* Caption size
* High-contrast mode

---

# 21. Supported Platform Strategy

## MVP

Target browser-based communication applications.

Examples:

```text
Google Meet Web
Zoom Web
Microsoft Teams Web
```

The extension should not rely on DOM selectors specific to one platform for its core AI functionality.

The accessibility layer should be **platform-agnostic wherever possible**.

---

# 22. Platform-Agnostic Design

Avoid:

```text
if Google Meet:
    do X

if Zoom:
    do Y
```

for core functionality.

Instead:

```text
Current Browser Tab
        ↓
SignSync Content Script
        ↓
Accessibility Overlay
        ↓
AI Processing
```

Platform-specific adapters can be added later if required.

---

# 23. Privacy Principle

SignSync handles sensitive camera/audio information.

The default principle should be:

> **Process as much as possible locally in the browser.**

The application should avoid uploading raw camera/video streams to a server unless explicitly required.

Prefer:

```text
Camera
 ↓
Local AI
 ↓
Gesture
```

instead of:

```text
Camera
 ↓
Internet
 ↓
Backend
 ↓
AI
```

---

# 24. Success Criteria

The MVP is successful if a user can:

1. Install SignSync.
2. Open a supported browser video call.
3. Click the extension.
4. Enable SignSync.
5. Grant camera permission.
6. Perform a recognized gesture.
7. See the recognized gesture as a live overlay.
8. Optionally hear the recognized phrase.
9. Use speech-to-text where supported.
10. Change language.
11. Disable SignSync.
12. Continue the video call normally.

---

# 25. Hackathon Demo

The recommended demonstration:

### Scenario — Accessible Healthcare Conversation

```text
Doctor / Healthcare Worker
        ↕
Existing Video Call
        ↕
Sign-Language User
```

The sign-language user joins an existing video call.

They activate SignSync.

They perform:

```text
HELP
```

SignSync detects the gesture and shows:

```text
┌─────────────────┐
│ 🖐 HELP         │
└─────────────────┘
```

Optional speech output says:

> Help.

The other participant speaks.

SignSync converts speech into text and displays it as an accessibility caption.

The user disables SignSync.

The underlying video call continues normally.

---

# 26. Product Differentiator

SignSync is not another video-calling application.

Its differentiator is:

```text
Existing Communication Platform
              +
     SignSync AI Layer
              =
      Accessible Call
```

This dramatically reduces the need for users to change their existing communication habits.

---

# 27. Future Scope

Future versions can support:

* More browser platforms
* Native desktop accessibility companion
* System-wide accessibility overlay
* Mobile accessibility layer
* Indian Sign Language
* Larger vocabulary
* Continuous sign-language sentence recognition
* Better personalized models
* Offline AI inference
* Emergency contacts
* Location sharing
* Healthcare integrations
* Accessibility analytics

---

# 28. MVP Priority

## P0 — Must Have

* Chrome extension
* Enable/disable
* Content-script overlay
* Camera access
* MediaPipe
* Gesture recognition
* Gesture → text
* Basic video-call webpage compatibility

## P1 — Should Have

* Gesture → speech
* Speech → text
* Multilingual support
* Conversation history
* Accessibility controls

## P2 — Nice to Have

* Personalized gesture training
* Advanced translation
* Advanced platform integrations
* SOS integrations

If time becomes limited, complete P0 before P1/P2.

---

# 29. Final Product Definition

> **SignSync is an AI-powered accessibility extension that works alongside existing browser-based video communication platforms, enabling users to turn real-time gesture recognition, live captions, speech output, and other accessibility features on or off whenever needed.**
