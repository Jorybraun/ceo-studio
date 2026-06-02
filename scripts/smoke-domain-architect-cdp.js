#!/usr/bin/env node
"use strict";

const CDP = require("chrome-remote-interface");

const PORT = Number(process.env.CEO_STUDIO_REMOTE_DEBUG_PORT || process.env.ELECTRON_REMOTE_DEBUG_PORT || 9222);
const PROJECT_SUFFIX = process.env.CEO_STUDIO_QA_PROJECT_SUFFIX || "CEO_STUDIO";

async function main() {
  const targets = await CDP.List({ port: PORT });
  const target = targets.find((t) => /CEO Studio/i.test(t.title || "")) || targets.find((t) => t.type === "page") || targets[0];
  if (!target) throw new Error(`No CEO Studio CDP target on port ${PORT}`);
  const client = await CDP({ port: PORT, target });
  const { Runtime, Page } = client;
  await Promise.all([Runtime.enable(), Page.enable()]);

  async function ev(expression) {
    const r = await Runtime.evaluate({ expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) {
      const description = r.exceptionDetails.exception && r.exceptionDetails.exception.description;
      throw new Error(description || r.exceptionDetails.text || "Runtime evaluation failed");
    }
    return r.result.value;
  }

  try {
    await Page.reload({ ignoreCache: true });
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const result = await ev(`(async () => {
      function waitFor(fn, ms = 12000) {
        return new Promise((resolve, reject) => {
          const start = Date.now();
          const tick = () => {
            try {
              const value = fn();
              if (value) return resolve(value);
            } catch {}
            if (Date.now() - start > ms) return reject(new Error("wait timed out"));
            setTimeout(tick, 120);
          };
          tick();
        });
      }
      async function click(selector) {
        await waitFor(() => document.querySelector(selector));
        document.querySelector(selector).click();
      }
      async function answer(text) {
        await waitFor(() => document.getElementById("domain-architect-answer"));
        const input = document.getElementById("domain-architect-answer");
        input.value = text;
        document.getElementById("domain-architect-answer-save").click();
        await new Promise((resolve) => setTimeout(resolve, 250));
        await waitFor(() => {
          const panel = document.getElementById("domain-architect-panel");
          return panel && !panel.textContent.includes("Recording...");
        });
      }

      await waitFor(() => window.ceo && window.ceoUI);
      const projects = await window.ceo.listProjects();
      const project = (projects || []).find((p) => String(p.path || "").endsWith(${JSON.stringify(PROJECT_SUFFIX)})) || (projects || [])[0];
      if (!project) throw new Error("No project available");
      const projectSwitcher = document.getElementById("project-switcher");
      if (![...projectSwitcher.options].some((o) => o.value === project.id)) {
        const option = document.createElement("option");
        option.value = project.id;
        option.textContent = project.name;
        projectSwitcher.appendChild(option);
      }
      projectSwitcher.value = project.id;
      projectSwitcher.dispatchEvent(new Event("change", { bubbles: true }));
      await waitFor(() => window.ceoUI.getContext && window.ceoUI.getContext().project);

      await window.ceoUI.openDomainWizard({ name: "CDP Practice Domain" });
      await click("#domain-architect-start");
      await waitFor(() => document.getElementById("domain-architect-answer"));
      await answer("Owns temporary UI verification for the Domain Architect interview state.");
      await answer("The Domain Architect can collect required fields and reach explicit confirmation readiness.");
      await answer("Does not persist a throwaway domain during this smoke check. Does not create Kanban work.");
      await answer("Interview state tracking, live outline, missing-field detection, confirmation gate.");
      await answer("Domain Lifecycle, Hermes CEO relay, Agenda Agent, domain storage.");
      await answer("domain-architect, agenda-agent, docs-steward");

      await waitFor(() => {
        const panel = document.getElementById("domain-architect-panel");
        return panel && panel.textContent.includes("Ready for confirmation.");
      });
      const confirm = document.getElementById("domain-architect-confirm");
      return {
        ok: true,
        title: document.getElementById("panel-title") && document.getElementById("panel-title").textContent,
        ready: !confirm.disabled,
        name: document.getElementById("domain-name") && document.getElementById("domain-name").value,
        purpose: document.getElementById("domain-purpose") && document.getElementById("domain-purpose").value,
        panel: (document.getElementById("domain-architect-panel") && document.getElementById("domain-architect-panel").textContent || "").slice(0, 1200),
      };
    })()`);
    console.log(JSON.stringify(result, null, 2));
    if (!result || !result.ok || !result.ready) process.exitCode = 1;
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
