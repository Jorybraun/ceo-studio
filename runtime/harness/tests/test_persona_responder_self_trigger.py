"""
Regression test for persona-responder self-trigger loop.

Reproduces the core bug: mention matching must NOT react to lines authored by self,
otherwise responder replies to its own posts forever.

Run: python3 runtime/harness/tests/test_persona_responder_self_trigger.py
"""

import importlib.machinery
import importlib.util
from pathlib import Path


HARNESS_ROOT = Path(__file__).resolve().parent.parent
RESPONDER_PATH = HARNESS_ROOT / "bin" / "persona-responder"


loader = importlib.machinery.SourceFileLoader("persona_responder", str(RESPONDER_PATH))
spec = importlib.util.spec_from_loader(loader.name, loader)
assert spec is not None
mod = importlib.util.module_from_spec(spec)
loader.exec_module(mod)


def test_self_authored_lines_are_ignored_even_if_they_mention_self():
    my_names = {"grok-builder", "grok builder", "grok"}

    # This mirrors post_to_room output: "speaker: reply"
    self_line = "grok-builder: thanks @grok-builder, posting my own update"
    assert mod.should_respond_to_line(self_line, my_names) is False


def test_external_mentions_still_trigger_response():
    my_names = {"grok-builder", "grok builder", "grok"}

    external_line = "orchestrator: @grok-builder can you propose a fix?"
    assert mod.should_respond_to_line(external_line, my_names) is True


def test_non_mentions_do_not_trigger_response():
    my_names = {"grok-builder", "grok builder", "grok"}

    neutral_line = "orchestrator: shipping notes for today"
    assert mod.should_respond_to_line(neutral_line, my_names) is False


if __name__ == "__main__":
    test_self_authored_lines_are_ignored_even_if_they_mention_self()
    test_external_mentions_still_trigger_response()
    test_non_mentions_do_not_trigger_response()
    print("PASS: persona-responder self-trigger regression checks")
