"use strict";
/**
 * Domain Context Management — understanding what domains actually mean.
 *
 * Domains are strategic ownership areas with their own:
 * - Purpose and responsibilities
 * - Core agents and skills needed
 * - Current state and priorities
 * - Interfaces with other domains
 * - Active epics and work
 *
 * This system gives agents real understanding of domain context, not just names.
 */
const fs = require("fs");
const path = require("path");
const { brainDir } = require("./paths");
const brain = require("./brain");

function domainsDir(slug) {
  return path.join(brainDir(slug), "domains");
}

function initDomains(slug) {
  const L = brain.layout(slug);
  const domainsPath = domainsDir(slug);
  if (!fs.existsSync(domainsPath)) {
    fs.mkdirSync(domainsPath, { recursive: true });
  }
  return domainsPath;
}

/**
 * Define or update a domain with its context.
 */
function defineDomain(slug, domainDef) {
  initDomains(slug);
  const domainsPath = domainsDir(slug);
  const domainFile = path.join(domainsPath, `${domainDef.name}.json`);
  
  const definition = {
    name: domainDef.name,
    purpose: domainDef.purpose || "",
    responsibilities: domainDef.responsibilities || [],
    coreAgents: domainDef.coreAgents || [],
    currentState: domainDef.currentState || "",
    priorities: domainDef.priorities || [],
    interfaces: domainDef.interfaces || [],
    activeEpics: domainDef.activeEpics || [],
    createdAt: domainDef.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    learnedInsights: domainDef.learnedInsights || [], // Agent learning over time
    // Path context - where this domain lives in the project
    sourcePath: domainDef.sourcePath || null,
    sourceType: domainDef.sourceType || null,
    relativePath: domainDef.relativePath || null,
  };
  
  fs.writeFileSync(domainFile, JSON.stringify(definition, null, 2));
  return definition;
}

/**
 * Get domain context by name.
 */
function getDomain(slug, domainName) {
  const domainsPath = domainsDir(slug);
  const domainFile = path.join(domainsPath, `${domainName}.json`);
  
  try {
    const data = fs.readFileSync(domainFile, "utf-8");
    return JSON.parse(data);
  } catch {
    return null;
  }
}

/**
 * Get all domains for a project.
 */
function getAllDomains(slug) {
  const domainsPath = domainsDir(slug);
  if (!fs.existsSync(domainsPath)) return [];
  
  const files = fs.readdirSync(domainsPath)
    .filter(f => f.endsWith(".json"))
    .map(f => f.replace(".json", ""));
  
  return files.map(name => getDomain(slug, name)).filter(Boolean);
}

/**
 * Add a learned insight to a domain (agent learning).
 */
function addInsight(slug, domainName, insight) {
  const domain = getDomain(slug, domainName);
  if (!domain) {
    // Auto-create domain if it doesn't exist
    defineDomain(slug, {
      name: domainName,
      purpose: `Auto-detected domain: ${domainName}`,
      learnedInsights: [insight]
    });
    return;
  }
  
  domain.learnedInsights.push({
    insight,
    timestamp: new Date().toISOString(),
    source: "agent_learning"
  });
  
  domain.updatedAt = new Date().toISOString();
  defineDomain(slug, domain);
}

/**
 * Update domain state (used by agents to track progress).
 */
function updateDomainState(slug, domainName, updates) {
  const domain = getDomain(slug, domainName);
  if (!domain) return null;
  
  Object.assign(domain, updates);
  domain.updatedAt = new Date().toISOString();
  return defineDomain(slug, domain);
}

/**
 * Generate domain description for agents.
 */
function getDomainDescription(slug, domainName) {
  const domain = getDomain(slug, domainName);
  if (!domain) {
    return `Domain "${domainName}" - no context available yet. Ask the user to define this domain's purpose and responsibilities.`;
  }
  
  let description = `Domain "${domain.name}": ${domain.purpose}`;
  
  // Add path context so agent knows where the domain lives
  if (domain.relativePath) {
    description += `\nLocation: ${domain.relativePath}`;
  }
  if (domain.sourceType) {
    description += ` (${domain.sourceType})`;
  }
  
  if (domain.responsibilities.length > 0) {
    description += `\nResponsibilities: ${domain.responsibilities.slice(0, 3).join(", ")}`;
  }
  
  if (domain.currentState) {
    description += `\nCurrent state: ${domain.currentState}`;
  }
  
  if (domain.priorities.length > 0) {
    description += `\nTop priorities: ${domain.priorities.slice(0, 2).join(", ")}`;
  }
  
  if (domain.learnedInsights.length > 0) {
    const recentInsights = domain.learnedInsights.slice(-3);
    description += `\nRecent learned insights: ${recentInsights.map(i => i.insight).join("; ")}`;
  }
  
  return description;
}

/**
 * Detect domains from project structure.
 */
function detectDomainsFromProject(projectPath) {
  const detectedDomains = [];
  
  // Check for harness domain structure: context/[domain]-team/
  const contextPath = path.join(projectPath, "harness", "context");
  if (fs.existsSync(contextPath)) {
    const folders = fs.readdirSync(contextPath);
    folders.forEach(folder => {
      if (folder.endsWith("-team")) {
        const domainName = folder.replace("-team", "");
        const domainPath = path.join(contextPath, folder);
        detectedDomains.push({
          name: domainName,
          path: domainPath,
          source: "harness-context"
        });
      }
    });
  }
  
  // Check for teams folder with domain teams
  const teamsPath = path.join(projectPath, "harness", "teams");
  if (fs.existsSync(teamsPath)) {
    const teams = fs.readdirSync(teamsPath);
    teams.forEach(team => {
      const teamPath = path.join(teamsPath, team);
      const stats = fs.statSync(teamPath);
      if (stats.isDirectory()) {
        // Skip if it's just a container folder (like README.md)
        const definitionPath = path.join(teamPath, "definition.md");
        if (fs.existsSync(definitionPath)) {
          // Extract domain name from team name (e.g., discovery-planning → discovery)
          const domainName = team.split("-")[0];
          if (!detectedDomains.find(d => d.name === domainName)) {
            detectedDomains.push({
              name: domainName,
              path: teamPath,
              source: "harness-teams",
              teamName: team
            });
          }
        }
      }
    });
  }
  
  // Check for direct domain folders (e.g., discovery/, engineering/)
  const directFolders = fs.readdirSync(projectPath);
  directFolders.forEach(folder => {
    // Skip common non-domain folders
    const skipFolders = ["node_modules", ".git", "harness", "dist", "build", "test", "tests", "runtime", 
                       "docker", "personas", "teams", "workflows", "bin", "lib", "src", "config",
                       "integrations", "skills", "architecture", "agents", "prompts", "docs", "examples",
                       "templates", "mgmt"];
    if (!skipFolders.includes(folder) && !folder.startsWith(".")) {
      const folderPath = path.join(projectPath, folder);
      const stats = fs.statSync(folderPath);
      if (stats.isDirectory()) {
        // Check if this looks like a domain folder (has certain files)
        const hasDomainFiles = fs.existsSync(path.join(folderPath, "AGENTS.md")) ||
                             fs.existsSync(path.join(folderPath, "README.md")) ||
                             fs.existsSync(path.join(folderPath, "package.json"));
        
        if (hasDomainFiles && !detectedDomains.find(d => d.name === folder)) {
          detectedDomains.push({
            name: folder,
            path: folderPath,
            source: "direct-folder"
          });
        }
      }
    }
  });
  
  return detectedDomains;
}

/**
 * Parse domain context from AGENTS.md file.
 */
function parseAgentsMD(agentsPath) {
  try {
    const content = fs.readFileSync(agentsPath, "utf-8");
    
    const purposeMatch = content.match(/\*\*Purpose\*\*:\s*(.+?)(?:\n|$)/);
    const purpose = purposeMatch ? purposeMatch[1].trim() : "";
    
    // Extract responsibilities
    const responsibilities = [];
    const lines = content.split("\n");
    let inResponsibilities = false;
    for (const line of lines) {
      if (line.toLowerCase().includes("responsibilit")) {
        inResponsibilities = true;
        continue;
      }
      if (inResponsibilities && line.startsWith("-")) {
        responsibilities.push(line.replace(/^-\s*/, "").trim());
      } else if (inResponsibilities && line.trim() === "") {
        inResponsibilities = false;
      }
    }
    
    return { purpose, responsibilities };
  } catch {
    return { purpose: "", responsibilities: [] };
  }
}

/**
 * Parse domain overview from docs/domain-overview.md
 */
function parseDomainOverview(overviewPath) {
  try {
    const content = fs.readFileSync(overviewPath, "utf-8");
    
    const purposeMatch = content.match(/\*\*Purpose\*\*:\s*(.+?)(?:\n|$)/);
    const purpose = purposeMatch ? purposeMatch[1].trim() : "";
    
    const currentStateMatch = content.match(/## Current State[\s\S]*?\n([\s\S]*?)(?:\n##|$)/);
    const currentState = currentStateMatch ? currentStateMatch[1].trim().substring(0, 200) : "";
    
    const prioritiesMatch = content.match(/## Active Epics[\s\S]*?\n([\s\S]*?)(?:\n##|$)/);
    const priorities = prioritiesMatch ? 
      prioritiesMatch[1].split("-").map(p => p.trim()).filter(Boolean) : [];
    
    return { purpose, currentState, priorities };
  } catch {
    return { purpose: "", currentState: "", priorities: [] };
  }
}

/**
 * Parse team definition from definition.md
 */
function parseTeamDefinition(definitionPath) {
  try {
    const content = fs.readFileSync(definitionPath, "utf-8");
    
    // Extract charter as purpose
    const charterMatch = content.match(/## Charter[\s\S]*?\n([\s\S]*?)(?:\n##|$)/);
    const purpose = charterMatch ? charterMatch[1].trim().substring(0, 300) : "";
    
    // Extract core roles as responsibilities
    const responsibilities = [];
    const lines = content.split("\n");
    let inRoles = false;
    for (const line of lines) {
      if (line.includes("Core Roles")) {
        inRoles = true;
        continue;
      }
      if (inRoles && line.startsWith("|")) {
        const parts = line.split("|").map(p => p.trim());
        if (parts.length >= 4 && parts[1] && parts[1] !== "Role") {
          responsibilities.push(`${parts[1]}: ${parts[3]}`);
        }
      } else if (inRoles && !line.startsWith("|") && line.trim() !== "") {
        inRoles = false;
      }
    }
    
    // Extract non-negotiables as priorities/constraints
    const nonNegotiables = [];
    let inNonNegotiables = false;
    for (const line of lines) {
      if (line.includes("Non-Negotiables")) {
        inNonNegotiables = true;
        continue;
      }
      if (inNonNegotiables && line.startsWith("-")) {
        nonNegotiables.push(line.replace(/^-\s*/, "").trim());
      } else if (inNonNegotiables && line.trim() === "") {
        inNonNegotiables = false;
      }
    }
    
    return { purpose, responsibilities, priorities: nonNegotiables };
  } catch {
    return { purpose: "", responsibilities: [], priorities: [] };
  }
}

/**
 * Ingest domain context from project structure into domain definitions.
 */
function ingestDomainsFromProject(slug, projectPath) {
  const detectedDomains = detectDomainsFromProject(projectPath);
  const ingested = [];
  
  for (const detected of detectedDomains) {
    let purpose = "";
    let responsibilities = [];
    let currentState = "";
    let priorities = [];
    let interfaces = [];
    
    // Try to parse from harness structure
    if (detected.source === "harness-context") {
      const agentsPath = path.join(detected.path, "AGENTS.md");
      if (fs.existsSync(agentsPath)) {
        const parsed = parseAgentsMD(agentsPath);
        purpose = parsed.purpose;
        responsibilities = parsed.responsibilities;
      }
      
      const overviewPath = path.join(detected.path, "docs", "domain-overview.md");
      if (fs.existsSync(overviewPath)) {
        const parsed = parseDomainOverview(overviewPath);
        if (!purpose) purpose = parsed.purpose;
        currentState = parsed.currentState;
        priorities = parsed.priorities;
      }
    } else if (detected.source === "harness-teams") {
      // Parse from team definition.md
      const definitionPath = path.join(detected.path, "definition.md");
      if (fs.existsSync(definitionPath)) {
        const parsed = parseTeamDefinition(definitionPath);
        purpose = parsed.purpose;
        responsibilities = parsed.responsibilities;
        priorities = parsed.priorities;
      }
      
      // Also check for domain context if referenced
      const contextMatch = purpose.match(/context\/([^\s]+)\//);
      if (contextMatch) {
        const contextDomainPath = path.join(projectPath, "harness", "context", contextMatch[1]);
        if (fs.existsSync(contextDomainPath)) {
          const agentsPath = path.join(contextDomainPath, "AGENTS.md");
          if (fs.existsSync(agentsPath)) {
            const parsed = parseAgentsMD(agentsPath);
            if (!purpose) purpose = parsed.purpose;
            if (responsibilities.length === 0) responsibilities = parsed.responsibilities;
          }
        }
      }
    } else {
      // Try to parse from direct folder
      const agentsPath = path.join(detected.path, "AGENTS.md");
      if (fs.existsSync(agentsPath)) {
        const parsed = parseAgentsMD(agentsPath);
        purpose = parsed.purpose;
        responsibilities = parsed.responsibilities;
      }
      
      const readmePath = path.join(detected.path, "README.md");
      if (fs.existsSync(readmePath)) {
        const content = fs.readFileSync(readmePath, "utf-8");
        const firstLine = content.split("\n")[0].replace(/^#+\s*/, "");
        if (!purpose) purpose = firstLine;
      }
    }
    
    // Default purpose if none found
    if (!purpose) {
      purpose = `Domain ${detected.name} - detected from project structure`;
    }
    
    // Calculate relative path from project root
    const relativePath = path.relative(projectPath, detected.path);
    
    // Create or update domain definition
    const existing = getDomain(slug, detected.name);
    const definition = defineDomain(slug, {
      name: detected.name,
      purpose,
      responsibilities,
      currentState,
      priorities,
      interfaces,
      coreAgents: existing?.coreAgents || [],
      learnedInsights: existing?.learnedInsights || [],
      createdAt: existing?.createdAt,
      // Path context
      sourcePath: detected.path,
      sourceType: detected.source,
      relativePath: relativePath,
    });
    
    ingested.push({
      name: detected.name,
      source: detected.source,
      path: detected.path,
      relativePath: relativePath,
      purpose,
      hasContext: !!purpose && purpose !== `Domain ${detected.name} - detected from project structure`
    });
  }
  
  return ingested;
}

module.exports = {
  domainsDir,
  initDomains,
  defineDomain,
  getDomain,
  getAllDomains,
  addInsight,
  updateDomainState,
  getDomainDescription,
  detectDomainsFromProject,
  parseAgentsMD,
  parseDomainOverview,
  parseTeamDefinition,
  ingestDomainsFromProject
};