"use strict";
/**
 * Central path helpers. Per-project memory and config live OUTSIDE the app dir
 * (~/.ceo-studio/<slug>/) so the runtime stays agnostic and projects isolated.
 * Override the root with CEO_STUDIO_HOME (used by tests).
 */
const os = require("os");
const path = require("path");
const fs = require("fs");

function studioHome() {
  const base = process.env.CEO_STUDIO_HOME || path.join(os.homedir(), ".ceo-studio");
  fs.mkdirSync(base, { recursive: true });
  return base;
}

function projectsRegistryPath() {
  return path.join(studioHome(), "projects.json");
}

function brainDir(slug) {
  const dir = path.join(studioHome(), slug, "brain");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "project";
}

module.exports = { studioHome, projectsRegistryPath, brainDir, slugify };
