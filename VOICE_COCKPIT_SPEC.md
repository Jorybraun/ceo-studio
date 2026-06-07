# Voice Cockpit: 2-Way Agent Conversation

**Goal:** Talk to the agent in CEO Studio. Agent responds by voice. Natural conversation.

## The Simplest Working Version (2 days)

### Architecture
```
┌─────────────────────────────────────────┐
│  CEO Studio Cockpit                     │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │  🎤 [Hold to speak]             │   │
│  │                                 │   │
│  │  You: "I need authentication"   │   │
│  │                                 │   │
│  │  CEO: "I'll break that into..." │   │
│  │                                 │   │
│  │  [Playing 🔊]                   │   │
│  │                                 │   │
│  │  [Text transcript below]        │   │
│  └─────────────────────────────────┘   │
│                                         │
└─────────────────────────────────────────┘
```

### Tech Stack (Free, No API Keys)

| Component | Technology | Why |
|-----------|-----------|-----|
| **STT (you → text)** | Web Speech API | Built into Electron/Chromium, free, decent quality |
| **Processing** | Hermes CEO relay | `hermes chat -q` as always |
| **TTS (agent → voice)** | macOS `say` command | Free, multiple voices, offline |
| **UI** | AG-UI or simple HTML | Mic button, transcript, playing indicator |

### Implementation

**1. Add Web Speech STT to renderer (1 hour)**
```javascript
// renderer/voice-chat.js
const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
recognition.continuous = false;
recognition.interimResults = true;

micButton.onmousedown = () => recognition.start();
micButton.onmouseup = () => recognition.stop();

recognition.onresult = (event) => {
  const transcript = event.results[0][0].transcript;
  // Send to main process
  window.ceo.voiceChat(transcript);
};
```

**2. Add voice IPC handler in main (30 min)**
```javascript
// main/index.js
ipcMain.handle("voice:chat", async (_e, text) => {
  // Send to CEO via Hermes relay
  const response = await hermes.askCeo(text);
  
  // Speak response using macOS say
  const { exec } = require('child_process');
  exec(`say -v "Samantha" "${response.text.replace(/"/g, '\\"')}"`);
  
  return { text: response.text, spoken: true };
});
```

**3. Simple UI in renderer (2 hours)**
```html
<div id="voice-chat">
  <div id="transcript"></div>
  <button id="mic" onmousedown="startListening()" onmouseup="stopListening()">
    🎤 Hold to speak
  </button>
  <div id="status"></div>
</div>
```

### Voice Options (macOS `say`)

```bash
# List available voices
say -v '?' | head -20

# Good options:
say -v "Samantha" "Hello"      # Clear, professional
say -v "Daniel" "Hello"        # Male UK
say -v "Kate" "Hello"          # Female UK
say -v "Ava" "Hello"           # Premium (if installed)
```

## Better Version: Native macOS STT (1 week)

Web Speech API is okay but **NSSpeechRecognizer** is better quality and offline.

```javascript
// main/core/native-stt.js (native module)
// Uses macOS Speech framework directly
```

Or use **whisper.cpp** locally:
```bash
# Download whisper model, run locally
# No cloud, no API keys, Eloquent-quality transcription
```

## The Conversation Flow

```
You: [Hold mic] "I need to add authentication to this app"
      ↓
      Web Speech API → "I need to add authentication to this app"
      ↓
      hermes.askCeo(text)
      ↓
      CEO: "I'll break that down. First, do you want OAuth, JWT, or simple password?"
      ↓
      say -v Samantha "I'll break that down..."
      ↓
You hear: "I'll break that down. First, do you want OAuth, JWT, or simple password?"
      ↓
You: [Hold mic] "OAuth with Google"
      ↓
      ... and so on
```

## Features to Add

| Feature | Effort | Value |
|---------|--------|-------|
| Basic voice chat (above) | 1 day | Core |
| Interrupt/respond while playing | 2 hours | Natural feel |
| Visual waveform while listening | 3 hours | Nice UX |
| "Push to talk" keybinding | 30 min | Power user |
| History of voice conversations | 2 hours | Context |
| Different voices per agent | 1 hour | Personality |

## What We Delete

- ElevenLabs integration (all of it)
- Cloud STT/TTS
- API keys for voice

## What We Keep

- Hermes CEO relay (the brain)
- Everything else works as-is

## Success Criteria

1. Hold button → speak → release → hear response
2. No API keys needed
3. Works offline
4. Conversation history saved
5. CEO can create Kanban tasks from voice

## Next Step

Add the voice chat panel to the current cockpit. 1 day of work, you can talk to your agent immediately.

Want me to implement this now?
