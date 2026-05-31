"""
Unit tests for the Grok provider's headless-JSON parser.

NO API COST: pure parser tests over captured/representative stdout. The ERROR
case uses the REAL JSON line emitted by `grok --output-format json` when the
account is credit-blocked (captured live 2026-05-31). The success/plain cases
exercise the defensive fallbacks.

The live success round-trip itself is NOT asserted here — it must be verified
with a credited Grok run (`grok models` to confirm auth, then a 1-line
`./bin/agent dispatch --provider grok ...`). This test only guarantees the
parser behaves correctly on the shapes we can pin down offline.

Run: python3 tests/test_grok_provider_parse.py
"""

import sys
from pathlib import Path

HARNESS_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HARNESS_ROOT))

from agents.providers.grok_provider import parse_stream  # noqa: E402

passed = 0
def ok(name, cond):
    global passed
    if not cond:
        print("FAIL", name)
        sys.exit(1)
    print("PASS", name)
    passed += 1


# 1. REAL error line captured from a credit-blocked grok run.
real_error = ('{"type":"error","message":"Internal error: {\\n  \\"message\\": '
              '\\"API error (status 403 Forbidden): ... run out of credits or need '
              'a Grok subscription. [WKE=personal-team-blocked:spending-limit]\\",'
              '\\n  \\"http_status\\": 403\\n}"}')
text, error, session = parse_stream(real_error)
ok("error event detected", error is not None and "403" in error)
ok("no text returned on pure error", text == "")

# 2. Representative success event (typed JSON with text) -> extracted.
success = '{"type":"assistant","text":"Hello from grok","session_id":"abc123"}'
text, error, session = parse_stream(success)
ok("assistant text extracted", text == "Hello from grok")
ok("no error on success", error is None)
ok("session id captured", session == "abc123")

# 3. Content-block style event -> text joined.
blocks = '{"type":"message","content":[{"type":"text","text":"part one"},{"type":"text","text":"part two"}]}'
text, _, _ = parse_stream(blocks)
ok("content blocks joined", "part one" in text and "part two" in text)

# 4. Plain (non-JSON) output -> raw fallback (reply never lost).
plain = "\x1b[32mjust some plain text reply\x1b[0m"
text, error, _ = parse_stream(plain)
ok("plain fallback returns de-ANSI'd text", text == "just some plain text reply" and error is None)

print(f"\n{passed} grok parser checks passed (zero API cost). Live success path: verify at 4pm with credits.")
