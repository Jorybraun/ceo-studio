"use strict";
// Brief Intake tests: the fragile bits are (1) robustly parsing a structured
// brief draft out of an arbitrary LLM reply and (2) computing missing required
// fields identically to domain-board.createBrief. The Hermes relay is injected.
const assert = require("assert");
const intake = require("../main/core/brief-intake");

let passed = 0;
function ok(cond, msg) { assert.ok(cond, msg); passed++; }
function eq(a, b, msg) { assert.deepStrictEqual(a, b, msg); passed++; }

// --- parseBriefDraft -------------------------------------------------------

// 1. Fenced ```json block.
{
  const reply = "Sure, here is the brief:\n```json\n" +
    JSON.stringify({ title: "Wire cost limits", goal: "Enforce a hard budget", acceptanceCriteria: ["ceiling enforced", "dedupe works"] }) +
    "\n```\nLet me know!";
  const d = intake.parseBriefDraft(reply);
  ok(d, "parses fenced json");
  eq(d.title, "Wire cost limits", "fenced title");
  eq(d.acceptanceCriteria, ["ceiling enforced", "dedupe works"], "fenced AC array");
}

// 2. Bare object embedded in prose (no fence), with trailing text.
{
  const reply = 'Here you go: {"title":"Faster dashboard","goal":"Render under 1s"} — hope that helps.';
  const d = intake.parseBriefDraft(reply);
  ok(d, "parses bare object in prose");
  eq(d.title, "Faster dashboard", "bare title");
  eq(d.goal, "Render under 1s", "bare goal");
}

// 3. { "brief": {...} } wrapper.
{
  const reply = '{"brief":{"title":"Onboarding","goal":"Cut signup to 2 steps"}}';
  const d = intake.parseBriefDraft(reply);
  ok(d, "parses brief-wrapper");
  eq(d.title, "Onboarding", "wrapper title");
}

// 4. acceptanceCriteria given as a newline/comma string is coerced to a list.
{
  const reply = '{"title":"X","acceptanceCriteria":"a\\nb, c"}';
  const d = intake.parseBriefDraft(reply);
  eq(d.acceptanceCriteria, ["a", "b", "c"], "string AC coerced to list");
}

// 5. Garbage / no JSON returns null (caller falls back gracefully).
{
  eq(intake.parseBriefDraft("I am not sure what you mean."), null, "no json → null");
  eq(intake.parseBriefDraft(""), null, "empty → null");
}

// --- missingFields ---------------------------------------------------------
{
  const complete = {
    title: "t", goal: "g", domain: "d", currentRenderedState: "c",
    problemMismatch: "p", acceptanceCriteria: ["a"], nextAction: "n",
  };
  eq(intake.missingFields(complete), [], "complete brief has no missing fields");
  eq(intake.missingFields({ ...complete, acceptanceCriteria: [] }), ["acceptanceCriteria"], "empty AC array is missing");
  eq(intake.missingFields({ ...complete, goal: "  " }), ["goal"], "whitespace goal is missing");
  ok(intake.missingFields({}).length === 7, "empty draft missing all 7 required fields");
}

// --- draftBrief (Hermes injected) ------------------------------------------
(async function run() {
  // a. Happy path: ask returns a full JSON draft.
  {
    const ask = async () => ({ ok: true, reply: JSON.stringify({
      title: "Wire cost limits", goal: "Hard budget ceiling", domain: "Engineering",
      currentRenderedState: "Runner bypasses cost_limits.py", problemMismatch: "No enforced ceiling",
      acceptanceCriteria: ["ceiling enforced"], nextAction: "wire cost_limits.py",
    }) });
    const r = await intake.draftBrief({ description: "we need cost limits in the runner" }, { ask });
    ok(r.ok, "draftBrief ok");
    eq(r.missing, [], "complete draft → no missing");
    eq(r.draft.domain, "Engineering", "draft carries domain");
  }

  // b. Known fields win over the model's parsed values.
  {
    const ask = async () => ({ ok: true, reply: '{"title":"Model title","goal":"Model goal"}' });
    const r = await intake.draftBrief({ description: "x", known: { title: "Human title" } }, { ask });
    eq(r.draft.title, "Human title", "known title overrides parsed");
    eq(r.draft.goal, "Model goal", "parsed goal still used when not known");
  }

  // c. domainHint fills an empty domain.
  {
    const ask = async () => ({ ok: true, reply: '{"title":"T","goal":"G"}' });
    const r = await intake.draftBrief({ description: "x", domainHint: "Discovery" }, { ask });
    eq(r.draft.domain, "Discovery", "domainHint fills empty domain");
    ok(r.missing.includes("currentRenderedState"), "still reports other missing fields");
  }

  // d. CEO unavailable → ok:false but a graceful draft from known fields.
  {
    const ask = async () => ({ ok: false, reason: "Hermes CLI not found" });
    const r = await intake.draftBrief({ description: "x", known: { title: "Keep me" } }, { ask });
    ok(!r.ok, "draftBrief reports failure");
    eq(r.draft.title, "Keep me", "known fields preserved on failure");
    ok(Array.isArray(r.missing), "missing still computed on failure");
  }

  // e. Empty input is rejected before calling the model.
  {
    let called = false;
    const ask = async () => { called = true; return { ok: true, reply: "{}" }; };
    const r = await intake.draftBrief({ description: "" }, { ask });
    ok(!r.ok, "empty description rejected");
    ok(!called, "model not called for empty input");
  }

  console.log(`brief-intake test passed — ${passed} checks`);
})().catch((e) => { console.error("brief-intake test FAILED:", e && e.stack || e); process.exit(1); });
