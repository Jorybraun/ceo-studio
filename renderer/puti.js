import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";

/**
 * PuTI — xterm.js terminal controller for mounted registry agents.
 *
 * The main path is a live node-pty client attached to the agent's tmux
 * session/window. Snapshot mode remains only as a fallback when live PTY attach
 * is unavailable.
 */
class PuTI {
  constructor() {
    this.host = null;
    this.agentId = null;
    this.mode = "live";
    this.terminalId = null;
    this.term = null;
    this.fitAddon = null;
    this.resizeObserver = null;
    this.snapshotTimer = null;
    this.toolbarEl = null;
    this.statusEl = null;
    this.terminalHost = null;
    this.agentSelect = null;
    this.modeSelect = null;
    this.mountButton = null;
    this._agents = [];
    this._disposables = [];
    this._terminalDisposables = [];
  }

  mount(host) {
    if (!host) return;
    this.destroy();
    this.host = host;
    this.host.innerHTML = "";
    this.host.classList.add("puti-shell");

    this.toolbarEl = document.createElement("div");
    this.toolbarEl.className = "puti-toolbar";
    this.toolbarEl.innerHTML = `
      <label class="puti-field">
        <span>Agent</span>
        <select class="puti-agent-select">
          <option value="">Select agent...</option>
        </select>
      </label>
      <label class="puti-field puti-field-render">
        <span>Render</span>
        <select class="puti-mode-select">
          <option value="live">Live xterm</option>
          <option value="snapshot">Snapshot fallback</option>
        </select>
      </label>
      <button type="button" class="puti-mount" title="Mount selected agent">Mount</button>
      <button type="button" class="puti-reconnect" title="Reconnect terminal">Reconnect</button>
    `;
    this.host.appendChild(this.toolbarEl);

    this.statusEl = document.createElement("div");
    this.statusEl.className = "puti-status";
    this.statusEl.textContent = "Select a mounted agent to attach a live terminal.";
    this.host.appendChild(this.statusEl);

    this.terminalHost = document.createElement("div");
    this.terminalHost.className = "puti-terminal-host";
    this.host.appendChild(this.terminalHost);

    this.agentSelect = this.toolbarEl.querySelector(".puti-agent-select");
    this.modeSelect = this.toolbarEl.querySelector(".puti-mode-select");
    this.mountButton = this.toolbarEl.querySelector(".puti-mount");

    this.agentSelect.addEventListener("change", (e) => this.selectAgent(e.target.value));
    this.modeSelect.addEventListener("change", (e) => this.setMode(e.target.value));
    this.toolbarEl.querySelector(".puti-reconnect").addEventListener("click", () => this._connect());
    this.mountButton.addEventListener("click", () => this.mountSelectedAgent());

    const keyHandler = (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === "T") {
        e.preventDefault();
        this.setMode(this.mode === "live" ? "snapshot" : "live");
      }
    };
    this.host.addEventListener("keydown", keyHandler);
    this._disposables.push(() => this.host?.removeEventListener("keydown", keyHandler));

    this.refreshAgents();
  }

  async refreshAgents() {
    try {
      const r = await (window.ceo?.registryList ? window.ceo.registryList() : { agents: [] });
      this._agents = (r && r.agents) || [];
    } catch {
      this._agents = [];
    }

    if (!this.agentSelect) return;
    const previous = this.agentSelect.value || this.agentId;
    const preferred = previous && this._agents.some((a) => a.id === previous)
      ? previous
      : (this._agents.find((a) => a.tmux_session || a.mounted)?.id || this._agents[0]?.id || "");
    this.agentSelect.innerHTML = '<option value="">Select agent...</option>' +
      this._agents.map((a) => {
        const live = a.tmux_session || a.mounted ? " live" : "";
        return `<option value="${esc(a.id)}">${esc(a.name || a.id)}${live}</option>`;
      }).join("");
    if (preferred) {
      this.agentSelect.value = preferred;
      if (!this.agentId) this.selectAgent(preferred);
    }
  }

  async openAgent(agentId, mode = "live") {
    const id = String(agentId || "").trim();
    if (!id) return;
    if (mode) {
      this.mode = mode === "snapshot" ? "snapshot" : "live";
      if (this.modeSelect) this.modeSelect.value = this.mode;
    }
    await this.refreshAgents();
    await this.selectAgent(id);
  }

  async selectAgent(agentId) {
    this.agentId = String(agentId || "").trim() || null;
    if (this.agentSelect) this.agentSelect.value = this.agentId || "";
    if (!this.agentId) {
      await this._closeTerminal();
      this._setStatus("Select a mounted agent to attach a live terminal.");
      this._createTerminal();
      this.term.write("No agent selected.\r\n");
      return;
    }
    await this._connect();
  }

  async setMode(mode) {
    this.mode = mode === "snapshot" ? "snapshot" : "live";
    if (this.modeSelect) this.modeSelect.value = this.mode;
    await this._connect();
  }

  async mountSelectedAgent() {
    if (!this.agentId) return;
    this._setStatus(`Mounting ${this.agentId}...`, "warn");
    let r = {};
    try { r = await window.ceo.registryMount(this.agentId, { allowPaid: true }); }
    catch (e) { r = { ok: false, reason: String(e && e.message ? e.message : e) }; }
    await this.refreshAgents();
    if (!r || !r.ok) {
      this._setStatus(`Mount failed: ${r ? r.reason : "unknown"}`, "error");
      return;
    }
    await this._connect();
  }

  async _connect() {
    this._stopSnapshot();
    await this._closeTerminal();
    this._createTerminal();

    if (!this.agentId) {
      this.term.write("No agent selected.\r\n");
      return;
    }

    if (this.mode === "snapshot") {
      this._setStatus(`Snapshot fallback - polling ${this.agentId}.`, "warn");
      this._startSnapshot();
      return;
    }

    this._setStatus(`Opening live terminal for ${this.agentId}...`);
    const size = this._fit();
    let r = {};
    try {
      r = await window.ceo.terminalOpen({
        agentId: this.agentId,
        cols: size.cols,
        rows: size.rows,
      });
    } catch (e) {
      r = { ok: false, reason: String(e && e.message ? e.message : e) };
    }

    if (!r || !r.ok) {
      this.term.write(`Live PTY unavailable: ${r ? r.reason : "unknown"}\r\n`);
      this.term.write("Using snapshot fallback.\r\n");
      this.mode = "snapshot";
      if (this.modeSelect) this.modeSelect.value = "snapshot";
      this._setStatus(`Live PTY unavailable - using snapshot fallback.`, "warn");
      this._startSnapshot();
      return;
    }

    this.terminalId = r.terminalId;
    this._setStatus(`Live xterm - ${r.agentId} (${r.session}:${r.window}).`, "ok");

    const dataOff = window.ceo.onTerminalData((payload) => {
      if (!payload || payload.terminalId !== this.terminalId || !this.term) return;
      this.term.write(payload.data || "");
    });
    const exitOff = window.ceo.onTerminalExit((payload) => {
      if (!payload || payload.terminalId !== this.terminalId) return;
      this.terminalId = null;
      this._setStatus(`Terminal detached${payload.exitCode != null ? ` (${payload.exitCode})` : ""}.`, "warn");
    });
    this._terminalDisposables.push(dataOff, exitOff);

    this._terminalDisposables.push(this.term.onData((data) => {
      if (this.terminalId) window.ceo.terminalInput(this.terminalId, data).catch(() => {});
    }));
    this._terminalDisposables.push(this.term.onResize(({ cols, rows }) => {
      if (this.terminalId) window.ceo.terminalResize(this.terminalId, cols, rows).catch(() => {});
    }));
  }

  _createTerminal() {
    if (!this.terminalHost) return;
    this.terminalHost.innerHTML = "";
    this.term = new Terminal({
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 8000,
      fontFamily: '"SFMono-Regular", "Menlo", "Cascadia Mono", "Liberation Mono", monospace',
      fontSize: 13,
      lineHeight: 1.25,
      theme: {
        background: "#050807",
        foreground: "#c5f3dd",
        cursor: "#ffffff",
        selectionBackground: "#345044",
        black: "#0a0f0d",
        red: "#ff6b6b",
        green: "#8de6b0",
        yellow: "#f5d76e",
        blue: "#7fb7ff",
        magenta: "#d7a4ff",
        cyan: "#7fe7e0",
        white: "#edf7f2",
        brightBlack: "#56635d",
        brightRed: "#ff8c8c",
        brightGreen: "#a9f5c7",
        brightYellow: "#ffe58f",
        brightBlue: "#9bccff",
        brightMagenta: "#e3bbff",
        brightCyan: "#9ef7f1",
        brightWhite: "#ffffff",
      },
    });
    this.fitAddon = new FitAddon();
    this.term.loadAddon(this.fitAddon);
    const unicode11 = new Unicode11Addon();
    this.term.loadAddon(unicode11);
    this.term.unicode.activeVersion = "11";
    this.term.open(this.terminalHost);
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      this.term.loadAddon(webgl);
    } catch {
      // Canvas renderer is acceptable fallback when WebGL is unavailable.
    }
    this._fit();

    if (this.resizeObserver) this.resizeObserver.disconnect();
    this.resizeObserver = new ResizeObserver(() => {
      const fitted = this._fit();
      if (this.terminalId) {
        window.ceo.terminalResize(this.terminalId, fitted.cols, fitted.rows).catch(() => {});
      }
    });
    this.resizeObserver.observe(this.terminalHost);
  }

  _fit() {
    try {
      this.fitAddon?.fit();
    } catch { /* layout can be zero during first paint */ }
    return {
      cols: this.term?.cols || 100,
      rows: this.term?.rows || 30,
    };
  }

  _startSnapshot() {
    this._stopSnapshot();
    this._pollSnapshot();
    this.snapshotTimer = setInterval(() => this._pollSnapshot(), 1500);
  }

  _stopSnapshot() {
    if (this.snapshotTimer) clearInterval(this.snapshotTimer);
    this.snapshotTimer = null;
  }

  async _pollSnapshot() {
    if (!this.agentId || !this.term) return;
    let r = {};
    try { r = await window.ceo.registryTerminal(this.agentId); }
    catch (e) { r = { ok: false, reason: String(e && e.message ? e.message : e) }; }
    this.term.write("\x1b[2J\x1b[H");
    if (r && r.ok) {
      this.term.write(toTerminalText(r.output || "(empty)"));
      this._setStatus(`Snapshot fallback - ${this.agentId} (${r.window || "main"}).`, "warn");
      return;
    }
    this.term.write(toTerminalText(`Terminal unavailable: ${r ? r.reason : "unknown"}\n\nMount the agent to start its session.`));
    this._setStatus(`Snapshot fallback - ${this.agentId} unavailable.`, "error");
  }

  async _closeTerminal() {
    this._stopSnapshot();
    const id = this.terminalId;
    this.terminalId = null;
    if (id) {
      try { await window.ceo.terminalClose(id); } catch { /* detach best effort */ }
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    this._terminalDisposables.forEach((fn) => {
      try {
        if (typeof fn === "function") fn();
        else if (fn && typeof fn.dispose === "function") fn.dispose();
      } catch { /* ignore */ }
    });
    this._terminalDisposables = [];
    if (this.term) {
      try { this.term.dispose(); } catch { /* ignore */ }
      this.term = null;
      this.fitAddon = null;
    }
  }

  _setStatus(text, tone = "neutral") {
    if (!this.statusEl) return;
    this.statusEl.textContent = text || "";
    this.statusEl.dataset.tone = tone;
  }

  destroy() {
    this._stopSnapshot();
    const id = this.terminalId;
    this.terminalId = null;
    if (id) window.ceo?.terminalClose?.(id).catch(() => {});
    if (this.resizeObserver) this.resizeObserver.disconnect();
    this.resizeObserver = null;
    if (this.term) {
      try { this.term.dispose(); } catch { /* ignore */ }
      this.term = null;
    }
    this._disposables.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
    this._disposables = [];
    this._terminalDisposables.forEach((fn) => {
      try {
        if (typeof fn === "function") fn();
        else if (fn && typeof fn.dispose === "function") fn.dispose();
      } catch { /* ignore */ }
    });
    this._terminalDisposables = [];
    if (this.host) this.host.innerHTML = "";
    this.host = null;
    this.toolbarEl = null;
    this.statusEl = null;
    this.terminalHost = null;
    this.agentSelect = null;
    this.modeSelect = null;
    this.mountButton = null;
  }
}

function toTerminalText(text) {
  return String(text == null ? "" : text).replace(/\r?\n/g, "\r\n");
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

window.CEOPuTI = new PuTI();

export { PuTI };
