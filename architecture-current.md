# Current architecture diagram

<div style="display:flex;justify-content:center;">
<svg width="1200" height="820" viewBox="0 0 1200 820" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Current CEO Studio architecture">
  <defs>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
      <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#1e293b" stroke-width="0.5"/>
    </pattern>
    <marker id="arrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
      <path d="M0,0 L0,6 L9,3 z" fill="#94a3b8" />
    </marker>
    <marker id="arrow-cyan" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
      <path d="M0,0 L0,6 L9,3 z" fill="#22d3ee" />
    </marker>
  </defs>
  <rect x="0" y="0" width="1200" height="820" fill="#020617"/>
  <rect x="0" y="0" width="1200" height="820" fill="url(#grid)" opacity="0.55"/>

  <!-- Boundaries -->
  <rect x="30" y="30" width="1140" height="760" rx="14" fill="none" stroke="#fbbf24" stroke-dasharray="8 4" stroke-width="1.5"/>
  <text x="50" y="54" fill="#fbbf24" font-family="JetBrains Mono, monospace" font-size="12">CEO Studio app boundary</text>

  <!-- Main process -->
  <rect x="70" y="95" width="260" height="125" rx="10" fill="#0f172a" stroke="#34d399" stroke-width="2"/>
  <rect x="70" y="95" width="260" height="125" rx="10" fill="rgba(6,78,59,0.35)" stroke="#34d399" stroke-width="2"/>
  <text x="90" y="125" fill="#e2e8f0" font-family="JetBrains Mono, monospace" font-size="14">main/index.js</text>
  <text x="90" y="148" fill="#94a3b8" font-family="JetBrains Mono, monospace" font-size="11">Electron main process</text>
  <text x="90" y="170" fill="#cbd5e1" font-family="JetBrains Mono, monospace" font-size="11">Project session • domains</text>
  <text x="90" y="188" fill="#cbd5e1" font-family="JetBrains Mono, monospace" font-size="11">CostMeter • Hermes relay</text>
  <text x="90" y="206" fill="#cbd5e1" font-family="JetBrains Mono, monospace" font-size="11">voice • jobs • registry</text>

  <!-- Preload -->
  <rect x="420" y="95" width="220" height="90" rx="10" fill="#0f172a" stroke="#22d3ee" stroke-width="2"/>
  <rect x="420" y="95" width="220" height="90" rx="10" fill="rgba(8,51,68,0.35)" stroke="#22d3ee" stroke-width="2"/>
  <text x="440" y="128" fill="#e2e8f0" font-family="JetBrains Mono, monospace" font-size="14">main/preload.js</text>
  <text x="440" y="151" fill="#94a3b8" font-family="JetBrains Mono, monospace" font-size="11">window.ceo IPC bridge</text>

  <!-- Renderer -->
  <rect x="700" y="65" width="430" height="235" rx="10" fill="#0f172a" stroke="#22d3ee" stroke-width="2"/>
  <rect x="700" y="65" width="430" height="235" rx="10" fill="rgba(8,51,68,0.18)" stroke="#22d3ee" stroke-width="2"/>
  <text x="720" y="94" fill="#e2e8f0" font-family="JetBrains Mono, monospace" font-size="14">renderer layer</text>
  <text x="720" y="118" fill="#94a3b8" font-family="JetBrains Mono, monospace" font-size="11">app.js • dashboard.js • convai.js</text>
  <text x="720" y="140" fill="#cbd5e1" font-family="JetBrains Mono, monospace" font-size="11">Thin UI cockpit</text>
  <text x="720" y="160" fill="#cbd5e1" font-family="JetBrains Mono, monospace" font-size="11">Projects • domains • files • tasks</text>
  <text x="720" y="180" fill="#cbd5e1" font-family="JetBrains Mono, monospace" font-size="11">Chat/voice • agents • config</text>
  <text x="720" y="200" fill="#cbd5e1" font-family="JetBrains Mono, monospace" font-size="11">Panel 1 is the main content surface</text>

  <!-- Backends row -->
  <rect x="70" y="315" width="220" height="95" rx="10" fill="#0f172a" stroke="#a78bfa" stroke-width="2"/>
  <rect x="70" y="315" width="220" height="95" rx="10" fill="rgba(76,29,149,0.32)" stroke="#a78bfa" stroke-width="2"/>
  <text x="90" y="345" fill="#e2e8f0" font-family="JetBrains Mono, monospace" font-size="14">brain</text>
  <text x="90" y="368" fill="#94a3b8" font-family="JetBrains Mono, monospace" font-size="11">project index + context</text>

  <rect x="325" y="315" width="220" height="95" rx="10" fill="#0f172a" stroke="#fbbf24" stroke-width="2"/>
  <rect x="325" y="315" width="220" height="95" rx="10" fill="rgba(120,53,15,0.25)" stroke="#fbbf24" stroke-width="2"/>
  <text x="345" y="345" fill="#e2e8f0" font-family="JetBrains Mono, monospace" font-size="14">domains</text>
  <text x="345" y="368" fill="#94a3b8" font-family="JetBrains Mono, monospace" font-size="11">scope + scaffolds</text>

  <rect x="580" y="315" width="220" height="95" rx="10" fill="#0f172a" stroke="#fb7185" stroke-width="2"/>
  <rect x="580" y="315" width="220" height="95" rx="10" fill="rgba(136,19,55,0.30)" stroke="#fb7185" stroke-width="2"/>
  <text x="600" y="345" fill="#e2e8f0" font-family="JetBrains Mono, monospace" font-size="14">Hermes CEO relay</text>
  <text x="600" y="368" fill="#94a3b8" font-family="JetBrains Mono, monospace" font-size="11">ask / board / swarm / room</text>

  <rect x="835" y="315" width="220" height="95" rx="10" fill="#0f172a" stroke="#fb923c" stroke-width="2"/>
  <rect x="835" y="315" width="220" height="95" rx="10" fill="rgba(251,146,60,0.25)" stroke="#fb923c" stroke-width="2"/>
  <text x="855" y="345" fill="#e2e8f0" font-family="JetBrains Mono, monospace" font-size="14">gbrain bridge</text>
  <text x="855" y="368" fill="#94a3b8" font-family="JetBrains Mono, monospace" font-size="11">CLI-backed query / ingest</text>

  <!-- Bottom row -->
  <rect x="70" y="470" width="240" height="110" rx="10" fill="#0f172a" stroke="#34d399" stroke-width="2"/>
  <rect x="70" y="470" width="240" height="110" rx="10" fill="rgba(6,78,59,0.22)" stroke="#34d399" stroke-width="2"/>
  <text x="90" y="502" fill="#e2e8f0" font-family="JetBrains Mono, monospace" font-size="14">jobs + ticket packs</text>
  <text x="90" y="525" fill="#94a3b8" font-family="JetBrains Mono, monospace" font-size="11">background work queue</text>
  <text x="90" y="545" fill="#94a3b8" font-family="JetBrains Mono, monospace" font-size="11">comment apply back to board</text>

  <rect x="350" y="470" width="240" height="110" rx="10" fill="#0f172a" stroke="#22d3ee" stroke-width="2"/>
  <rect x="350" y="470" width="240" height="110" rx="10" fill="rgba(8,51,68,0.22)" stroke="#22d3ee" stroke-width="2"/>
  <text x="370" y="502" fill="#e2e8f0" font-family="JetBrains Mono, monospace" font-size="14">docs tree + read</text>
  <text x="370" y="525" fill="#94a3b8" font-family="JetBrains Mono, monospace" font-size="11">safe project file access</text>
  <text x="370" y="545" fill="#94a3b8" font-family="JetBrains Mono, monospace" font-size="11">used by voice agent tools</text>

  <rect x="630" y="470" width="240" height="110" rx="10" fill="#0f172a" stroke="#a78bfa" stroke-width="2"/>
  <rect x="630" y="470" width="240" height="110" rx="10" fill="rgba(76,29,149,0.22)" stroke="#a78bfa" stroke-width="2"/>
  <text x="650" y="502" fill="#e2e8f0" font-family="JetBrains Mono, monospace" font-size="14">registry / meetings</text>
  <text x="650" y="525" fill="#94a3b8" font-family="JetBrains Mono, monospace" font-size="11">agents, personas, teams</text>
  <text x="650" y="545" fill="#94a3b8" font-family="JetBrains Mono, monospace" font-size="11">A2A meeting engine</text>

  <rect x="910" y="470" width="240" height="110" rx="10" fill="#0f172a" stroke="#fb7185" stroke-width="2"/>
  <rect x="910" y="470" width="240" height="110" rx="10" fill="rgba(136,19,55,0.22)" stroke="#fb7185" stroke-width="2"/>
  <text x="930" y="502" fill="#e2e8f0" font-family="JetBrains Mono, monospace" font-size="14">voice + convai</text>
  <text x="930" y="525" fill="#94a3b8" font-family="JetBrains Mono, monospace" font-size="11">ElevenLabs STT / TTS / live voice</text>
  <text x="930" y="545" fill="#94a3b8" font-family="JetBrains Mono, monospace" font-size="11">cost-gated, main-owned</text>

  <!-- Arrows -->
  <path d="M330 155 L420 140" stroke="#94a3b8" stroke-width="2" fill="none" marker-end="url(#arrow)"/>
  <path d="M640 140 L700 140" stroke="#22d3ee" stroke-width="2" fill="none" marker-end="url(#arrow-cyan)"/>
  <path d="M200 220 L180 315" stroke="#94a3b8" stroke-width="2" fill="none" marker-end="url(#arrow)"/>
  <path d="M475 185 L435 315" stroke="#94a3b8" stroke-width="2" fill="none" marker-end="url(#arrow)"/>
  <path d="M810 185 L690 315" stroke="#94a3b8" stroke-width="2" fill="none" marker-end="url(#arrow)"/>
  <path d="M880 185 L945 315" stroke="#94a3b8" stroke-width="2" fill="none" marker-end="url(#arrow)"/>

  <path d="M190 410 L190 470" stroke="#94a3b8" stroke-width="2" fill="none" marker-end="url(#arrow)"/>
  <path d="M440 410 L470 470" stroke="#94a3b8" stroke-width="2" fill="none" marker-end="url(#arrow)"/>
  <path d="M690 410 L750 470" stroke="#94a3b8" stroke-width="2" fill="none" marker-end="url(#arrow)"/>
  <path d="M945 410 L1030 470" stroke="#94a3b8" stroke-width="2" fill="none" marker-end="url(#arrow)"/>

  <!-- Legend -->
  <rect x="40" y="705" width="1120" height="60" rx="10" fill="#0b1220" stroke="#1e293b"/>
  <text x="60" y="730" fill="#cbd5e1" font-family="JetBrains Mono, monospace" font-size="11">Legend:</text>
  <text x="130" y="730" fill="#34d399" font-family="JetBrains Mono, monospace" font-size="11">green = main/core execution</text>
  <text x="350" y="730" fill="#22d3ee" font-family="JetBrains Mono, monospace" font-size="11">cyan = renderer/preload/UI bridge</text>
  <text x="620" y="730" fill="#fbbf24" font-family="JetBrains Mono, monospace" font-size="11">amber = app boundary / domain scope</text>
  <text x="60" y="752" fill="#fb7185" font-family="JetBrains Mono, monospace" font-size="11">rose = guarded external/live paths</text>
  <text x="350" y="752" fill="#a78bfa" font-family="JetBrains Mono, monospace" font-size="11">violet = knowledge stores</text>
  <text x="620" y="752" fill="#fb923c" font-family="JetBrains Mono, monospace" font-size="11">orange = GBrain CLI bridge</text>
</svg>
</div>

- Main process owns state, relay, guardrails, and all privileged I/O.
- Preload exposes only the IPC surface.
- Renderer is the thin cockpit.
- Brain/GBrain/docs/jobs/registry/voice are all main-owned backends.
