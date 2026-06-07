Voice Plan Review & Refinement - Grok Builder Perspective

Original brief: .voice-brief.md (ElevenLabs two-way voice for CEO Studio desktop app)

Builder Assessment:

Implementation Complexity: Medium. 
- New main/core/voice.js module for ElevenLabs TTS (simple REST) + STT (Scribe, requires audio upload handling).
- IPC additions: voice:speak, voice:listen, state events for listening/speaking.
- Renderer: thin mic button + audio element (Web Audio API or <audio>).
- Env: dotenv load for ELEVENLABS_API_KEY (already in .env.local).
- CostMeter integration: track character usage for TTS, audio seconds for STT.
- Graceful degradation: if no key, fall back to text-only, no crash.
- Testing: 27 existing tests must pass; add voice mocks for offline.

Integration with Hermes/CEO Studio Architecture:
- Voice must route through existing Hermes CEO relay (see main/index.js: Hermes CEO bridge, kanban, swarm).
- Input (STT transcript) -> agent:ask (which is Hermes-orchestrated CEO) -> TTS output.
- Leverage CostMeter already in main/core (voice usage surfaced in UI alongside LLM costs).
- Main process owns all: renderer thin via preload IPC (contextIsolation on).
- Aligns with domain/agent personas: voice as input modality for Domain Architect / CEO interactions.
- No conflict with AGUI server or registry; voice augments the conversational loop.
- Potential reuse: Hermes skills for voice personas if extended later.

Refinements to Plan:
1. Add explicit Hermes relay hook in voice flow: STT output feeds directly into Hermes CEO session.
2. Surface voice cost in existing cost UI (extend CostMeter).
3. Make voice module support profile-based voices (ElevenLabs voice IDs per agent persona).
4. Handle push-to-talk vs always-listen modes for desktop UX.
5. Offline-first: voice module checks key at init, emits 'voice:unavailable' event.
6. Dependencies: check if axios/fetch already present before adding; prefer native where possible.
7. Definition of done expanded: verify full loop with Hermes CEO, cost tracking visible, tests green.

Risks: ElevenLabs rate limits/costs during dev; audio format handling in STT (must match Scribe requirements). Mitigate with small test clips.

This keeps voice as natural extension of the existing Electron + Hermes architecture without architectural debt.