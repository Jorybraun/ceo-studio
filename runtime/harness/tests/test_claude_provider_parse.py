"""
Unit tests for the Claude provider's headless-JSON parser.

NO API COST: pure parser tests over captured/representative stdout. The ERROR
case uses the REAL JSON object emitted by `claude -p --output-format json` when
auth is not configured (captured live 2026-05-31, status 401). The success case
exercises the normal `{"type":"result",...}` shape.

The live success round-trip itself is NOT asserted here — it must be verified
with an authenticated Claude run. This test only guarantees the parser behaves
correctly on the shapes we can pin down offline.

Run: python3 tests/test_claude_provider_parse.py
"""

import sys
from pathlib import Path

HARNESS_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HARNESS_ROOT))

from agents.providers.claude_provider import parse_result  # noqa: E402

passed = 0
def ok(name, cond):
    global passed
    if not cond:
        print("FAIL", name)
        sys.exit(1)
    print("PASS", name)
    passed += 1


# 1. REAL error object captured from an unauthenticated claude run (status 401).
real_error = ('{"type":"result","subtype":"success","is_error":true,'
              '"api_error_status":401,"result":"Failed to authenticate. API '
              'Error: 401","session_id":"de604d1c-f274-49c6-a74e-01da9286d2b1",'
              '"total_cost_usd":0}')
text, error, session = parse_result(real_error)
ok("error detected via is_error", error is not None and "401" in error)
ok("no text returned on pure error", text == "")
ok("session id captured on error", session == "de604d1c-f274-49c6-a74e-01da9286d2b1")

# 2. Normal success result -> reply text + session id extracted.
success = ('{"type":"result","subtype":"success","is_error":false,'
           '"result":"pong","session_id":"abc-123","total_cost_usd":0.01}')
text, error, session = parse_result(success)
ok("result text extracted", text == "pong")
ok("no error on success", error is None)
ok("session id captured on success", session == "abc-123")

# 3. Stream-json assistant chunks -> text blocks joined (defensive path).
stream = ('{"type":"assistant","session_id":"s9","message":{"content":'
          '[{"type":"text","text":"part one "},{"type":"text","text":"part two"}]}}')
text, error, session = parse_result(stream)
ok("stream text blocks joined", "part one" in text and "part two" in text)
ok("session id captured in stream", session == "s9")

# 4. Plain (non-JSON) output -> raw fallback so a reply is never lost.
plain = "\x1b[32mjust a plain reply\x1b[0m"
text, error, _ = parse_result(plain)
ok("plain fallback returns de-ANSI'd text", text == "just a plain reply" and error is None)

# 5. error subtype (non-success) without is_error -> still flagged.
sub_err = '{"type":"result","subtype":"error_max_turns","result":"hit limit"}'
text, error, _ = parse_result(sub_err)
ok("non-success subtype flagged as error", error is not None and "hit limit" in error)

print(f"\n{passed} claude parser checks passed (zero API cost). "
      f"Live success path: verify with an authenticated claude run.")
