"""
Tests for the VertexProvider (Gemma via the Cloudflare AI Gateway).

NO API COST / OFFLINE: the URL + model builders are pure and tested directly;
the network call is exercised through a monkeypatched `_complete` so the
dispatch/tell history round-trip is verified without hitting the gateway. The
missing-credentials path is also checked (must error cleanly, never crash).

Run: python3 tests/test_vertex_provider.py
"""

import json
import os
import sys
import tempfile
from pathlib import Path

HARNESS_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HARNESS_ROOT))

from agents.providers import get_provider, known_providers  # noqa: E402
from agents.providers.vertex_provider import (  # noqa: E402
    VertexProvider, gateway_url, gateway_model, DEFAULT_MODEL,
)

passed = 0
def ok(name, cond):
    global passed
    if not cond:
        print("FAIL", name)
        sys.exit(1)
    print("PASS", name)
    passed += 1


# 1. URL builder strips /google-vertex-ai and adds the compat path.
ok("gateway_url builds compat endpoint",
   gateway_url("https://gw/v1/acct/name/google-vertex-ai")
   == "https://gw/v1/acct/name/compat/chat/completions")
ok("gateway_url tolerates trailing slash",
   gateway_url("https://gw/v1/acct/name/google-vertex-ai/")
   == "https://gw/v1/acct/name/compat/chat/completions")

# 2. Model builder prefixes google-vertex-ai/ exactly once.
ok("gateway_model prefixes", gateway_model("google/gemma-4-26b-a4b-it-maas")
   == "google-vertex-ai/google/gemma-4-26b-a4b-it-maas")
ok("gateway_model idempotent", gateway_model("google-vertex-ai/x") == "google-vertex-ai/x")
ok("gateway_model defaults to Gemma", gateway_model(None) == f"google-vertex-ai/{DEFAULT_MODEL}")

# 3. Provider is registered and resolvable by name.
ok("vertex in known_providers", "vertex" in known_providers())
ok("get_provider('vertex') resolves", isinstance(get_provider("vertex"), VertexProvider))
ok("vertex is not gated as paid", get_provider("vertex").paid is False)

# 4. Missing credentials -> clean error result (no crash, no network).
for key in ("CF_AI_GATEWAY_URL", "CF_API_TOKEN"):
    os.environ.pop(key, None)
with tempfile.TemporaryDirectory() as tmp:
    prov = VertexProvider()
    res = prov.dispatch("ada", "hello", model=None, workdir=Path(tmp) / "wd", timeout=5)
    ok("no creds -> error result", res.error and "CF_AI_GATEWAY_URL" in res.reply)

# 5. dispatch/tell history round-trip with a stubbed network call.
with tempfile.TemporaryDirectory() as tmp:
    prov = VertexProvider()
    prov.gateway = "https://gw/v1/a/n/google-vertex-ai"
    prov.token = "cfut_test"
    seen = {}

    def fake_complete(messages, *, timeout):
        seen["messages"] = list(messages)
        return f"reply#{len([m for m in messages if m['role'] == 'user'])}", None

    prov._complete = fake_complete  # type: ignore[assignment]
    wd = Path(tmp) / "wd"

    d = prov.dispatch("ada", "first question", model=None, workdir=wd, timeout=5)
    ok("dispatch returns reply", d.reply == "reply#1" and not d.error)
    ok("dispatch returns a vertex session id", str(d.session_id).startswith("vertex-ada-"))

    t = prov.tell("ada", "second question", session_id=d.session_id, model=None, workdir=wd, timeout=5)
    ok("tell returns reply", t.reply == "reply#2" and not t.error)
    # The second call must have replayed the full history (2 user + 1 assistant turns).
    roles = [m["role"] for m in seen["messages"]]
    ok("tell replays prior history", roles == ["user", "assistant", "user"])

    # History persisted to the workdir store.
    store = json.loads((wd / "vertex_sessions.json").read_text())
    ok("session history persisted", len(store[d.session_id]) == 4)

print(f"\n{passed} vertex-provider checks passed (offline; stubbed network).")
