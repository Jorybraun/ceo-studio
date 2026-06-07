"use strict";
/**
 * Voice tests (offline, no network). Verifies the Phase-2 ElevenLabs layer is
 * OFFLINE-SAFE and that voice spend is metered + capped:
 *   - voice.available()/status() reflect the key's presence
 *   - tts()/stt() throw a clear, catchable error when no key (no crash)
 *   - the tiny .env loader parses + does not clobber existing env vars
 *   - CostMeter.recordVoiceUsage() bills char/time usage AND trips the hard caps
 *     (so a runaway voice loop halts, just like the credit-burn incident).
 *
 * Run: `node test/voice.test.js` (chained into `npm test`).
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "ceo-studio-voice-"));
process.env.CEO_STUDIO_HOME = HOME;
// Ensure a clean, offline voice state regardless of the launching shell.
delete process.env.ELEVENLABS_API_KEY;

const voice = require("../main/core/voice");
const convai = require("../main/core/convai");
const { parseEnv, loadEnv } = require("../main/core/env");
const { CostMeter, estimateVoiceUsd } = require("../main/core/cost");

let passed = 0;
function ok(name, cond) {
  if (!cond) { console.error("FAIL", name); process.exitCode = 1; }
  else { console.log("PASS", name); passed++; }
}

// --- offline-safe voice client ---
ok("voice unavailable without key", voice.available() === false);
const st = voice.status();
ok("status reports unavailable + note", st.available === false && typeof st.note === "string");
ok("status never leaks the key", !("apiKey" in st));
const convaiStatus = convai.status();
ok("live voice exposes brief/bug tools", convaiStatus.tools.includes("create_brief") && convaiStatus.tools.includes("create_bug"));
ok("live voice exposes blocked analyzer", convaiStatus.tools.includes("analyze_blocked_work"));
ok("live voice exposes provenance tools", convaiStatus.tools.includes("create_child_task") && convaiStatus.tools.includes("record_brief_asset") && convaiStatus.tools.includes("show_provenance"));
ok("live voice exposes goal tools", convaiStatus.tools.includes("list_goals") && convaiStatus.tools.includes("set_goal") && convaiStatus.tools.includes("link_work_to_goal") && convaiStatus.tools.includes("review_goals"));
ok("live voice exposes autonomy policy tools", convaiStatus.tools.includes("autonomy_status") && convaiStatus.tools.includes("configure_autonomy") && convaiStatus.tools.includes("run_autonomy_cycle") && convaiStatus.tools.includes("start_autonomy") && convaiStatus.tools.includes("stop_autonomy"));
ok("live voice exposes self-repair bug tool", convaiStatus.tools.includes("report_system_bug"));
ok("live voice exposes self-repair consult tool", convaiStatus.tools.includes("ask_self_repair"));
ok("live voice exposes orchestration org tools", convaiStatus.tools.includes("show_orchestration_org") && convaiStatus.tools.includes("route_work"));

// --- env loader ---
const parsed = parseEnv('# comment\nFOO=bar\nQUOTED="hi there"\nEMPTY=\nBAD LINE\n');
ok("parseEnv reads key=value", parsed.FOO === "bar");
ok("parseEnv strips quotes", parsed.QUOTED === "hi there");
ok("parseEnv ignores comments/garbage", !("BAD LINE" in parsed) && parsed.EMPTY === "");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "env-root-"));
fs.writeFileSync(path.join(tmpRoot, ".env.local"), "VOICE_TEST_ONLY=1\nALREADY_SET=fromfile\n");
process.env.ALREADY_SET = "fromshell";
loadEnv(tmpRoot);
ok("loadEnv sets new vars", process.env.VOICE_TEST_ONLY === "1");
ok("loadEnv does not clobber existing env", process.env.ALREADY_SET === "fromshell");

// --- cost: voice billing + hard caps ---
ok("tts $ is character-based", estimateVoiceUsd({ kind: "tts", chars: 1000 }) > 0);
ok("stt $ is time-based", estimateVoiceUsd({ kind: "stt", seconds: 60 }) > 0);

const meter = new CostMeter("voice-test", { maxSessionUsd: 100, maxDayUsd: 100 });
meter.recordVoiceUsage({ kind: "tts", chars: 500 });
meter.recordVoiceUsage({ kind: "stt", seconds: 10 });
const s = meter.status();
ok("voiceUsd surfaced in status", s.voiceUsd > 0);
ok("ttsChars accumulates", s.ttsChars === 500);
ok("voice $ folds into session total", s.sessionUsd >= s.voiceUsd && s.sessionUsd > 0);

const capMeter = new CostMeter("voice-cap", { maxSessionUsd: 0.0001, maxDayUsd: 100 });
capMeter.recordVoiceUsage({ kind: "tts", chars: 5000 }); // blows the tiny cap
ok("voice spend trips the hard session cap", capMeter.canProceed().ok === false);

// --- tts()/stt() reject gracefully without a key (no crash) ---
(async () => {
  let ttsErr = null, sttErr = null;
  const offlineEnv = { ELEVENLABS_API_KEY: "", OLLAMA_BASE: "http://127.0.0.1:9" };
  try { await voice.tts("hello", { env: offlineEnv }); } catch (e) { ttsErr = e; }
  ok("tts() throws clear NO_VOICE_KEY error offline", ttsErr && ttsErr.code === "NO_VOICE_KEY");
  try { await voice.stt(Buffer.from([1, 2, 3]), { mime: "audio/webm", env: offlineEnv }); } catch (e) { sttErr = e; }
  ok("stt() throws clear NO_VOICE_KEY error offline", sttErr && sttErr.code === "NO_VOICE_KEY");

  console.log(`\n${passed} voice checks passed.`);
})();
