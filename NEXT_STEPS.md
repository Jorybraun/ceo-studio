> **Scope note (read `NORTH_STAR.md` + `E2E_PLAN.md` first).** This document is **L0/L1 implementation scaffolding** — concrete Electron + IPC + renderer code snippets for the Foundation and Document Agent levels. It is a "how to wire the shell" reference, *subordinate* to the sequencing and exit criteria in `E2E_PLAN.md`. The cost guardrails and Brain contract in `E2E_PLAN.md` must be implemented alongside this scaffolding, not after.

# CEO Studio - Implementation Plan

## Phase 1: Electron + Agent (2-3 hours)

### Step 1: Electron App Setup
```bash
cd /Users/hans/Code/AGENT/CEO_STUDIO
npm init -y
npm install electron
npm install -D electron-builder
```

**Create `package.json` scripts:**
```json
{
  "main": "main/index.js",
  "scripts": {
    "start": "electron .",
    "build": "electron-builder"
  }
}
```

### Step 2: Main Process Setup
**Create `main/index.js`:**
```javascript
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile('renderer/index.html');
}

app.whenReady().then(createWindow);

// IPC handlers for project management
ipcMain.handle('add-project', async (event, projectPath) => {
  // Add project logic
});

ipcMain.handle('switch-project', async (event, projectId) => {
  // Switch project logic
});

ipcMain.handle('switch-domain', async (event, domainId) => {
  // Switch domain logic
});

ipcMain.handle('get-projects', async () => {
  // Return projects list
});
```

### Step 3: Project Management
**Create `main/project-manager.js`:**
```javascript
const fs = require('fs');
const path = require('path');
const storage = require('electron-json-storage');

class ProjectManager {
  constructor() {
    this.projects = storage.get('projects', []);
  }

  async addProject(projectPath) {
    const projectName = path.basename(projectPath);
    const project = {
      id: Date.now().toString(),
      name: projectName,
      path: projectPath,
      domains: await this.detectDomains(projectPath),
      settings: {}
    };
    this.projects.push(project);
    storage.set('projects', this.projects);
    return project;
  }

  async detectDomains(projectPath) {
    // Detect domains based on folder structure
    // For now, return default domains
    return [
      { name: 'Discovery', skills: [], knowledge: {} },
      { name: 'Engineering', skills: [], knowledge: {} },
      { name: 'All', skills: [], knowledge: {} }
    ];
  }

  switchProject(projectId) {
    this.currentProject = this.projects.find(p => p.id === projectId);
    return this.currentProject;
  }

  getProjects() {
    return this.projects;
  }
}

module.exports = ProjectManager;
```

### Step 4: Agent with Multi-Project Context
**Create `main/agent.js`:**
```javascript
const OpenAI = require('openai');

class Agent {
  constructor() {
    this.openai = new OpenAI();
    this.context = {
      currentProject: null,
      currentDomain: null,
      allProjects: []
    };
  }

  setContext(project, domain = null) {
    this.context.currentProject = project;
    this.context.currentDomain = domain;
  }

  async generatePanelHTML(prompt) {
    const response = await this.openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: `You are a UI agent controlling panels for project: ${this.context.currentProject?.name}
          Current domain: ${this.context.currentDomain?.name || 'All'}
          Generate HTML for panels using Tailwind CSS.`
        },
        { role: 'user', content: prompt }
      ]
    });

    return response.choices[0].message.content;
  }
}

module.exports = Agent;
```

### Step 5: Renderer Process Setup
**Create `renderer/index.html`:**
```html
<!DOCTYPE html>
<html>
<head>
  <title>CEO Studio</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/highlight.js/lib/highlight.min.js"></script>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/highlight.js/styles/github.min.css">
  <style>
    @keyframes pulse {
      0%, 100% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.1); opacity: 0.8; }
    }
    .agent-circle {
      animation: pulse 2s infinite;
    }
  </style>
</head>
<body class="h-screen flex flex-col">
  <!-- Project and Domain Switchers -->
  <div class="flex justify-between p-4 border-b">
    <select id="project-switcher" class="border rounded p-2">
      <option value="">Select Project</option>
    </select>
    <select id="domain-switcher" class="border rounded p-2">
      <option value="all">All Domains</option>
    </select>
    <button id="add-project" class="bg-blue-500 text-white p-2 rounded">Add Project</button>
  </div>

  <!-- Red Pulsing Circle -->
  <div class="flex justify-center py-4">
    <div id="agent-circle" class="agent-circle w-16 h-16 bg-red-500 rounded-full"></div>
  </div>

  <!-- Two Panels -->
  <div class="flex-1 flex">
    <div id="panel1" class="flex-1 p-4 border-r"></div>
    <div id="panel2" class="flex-1 p-4"></div>
  </div>

  <script src="app.js"></script>
</body>
</html>
```

**Create `renderer/app.js`:**
```javascript
const { ipcRenderer } = require('electron');

const panelBuffers = { panel1: '', panel2: '' };

// Project switcher
document.getElementById('project-switcher').addEventListener('change', async (e) => {
  const projectId = e.target.value;
  await ipcRenderer.invoke('switch-project', projectId);
  // Update domain switcher with project's domains
});

// Domain switcher
document.getElementById('domain-switcher').addEventListener('change', async (e) => {
  const domainId = e.target.value;
  await ipcRenderer.invoke('switch-domain', domainId);
});

// Add project button
document.getElementById('add-project').addEventListener('click', async () => {
  // Open file picker to select project folder
  const result = await ipcRenderer.invoke('open-project-picker');
  if (result) {
    await ipcRenderer.invoke('add-project', result);
    loadProjects();
  }
});

// Load projects on startup
async function loadProjects() {
  const projects = await ipcRenderer.invoke('get-projects');
  const switcher = document.getElementById('project-switcher');
  switcher.innerHTML = '<option value="">Select Project</option>';
  projects.forEach(project => {
    const option = document.createElement('option');
    option.value = project.id;
    option.textContent = project.name;
    switcher.appendChild(option);
  });
}

// IPC for panel updates
ipcRenderer.on('panel-update', (event, { panel, html }) => {
  if (panel && panelBuffers[panel] !== undefined) {
    panelBuffers[panel] += html;
    document.getElementById(panel).innerHTML = panelBuffers[panel];

    // Process visual libraries
    document.querySelectorAll(`#${panel} .markdown:not(.processed)`).forEach(el => {
      el.innerHTML = marked.parse(el.textContent);
      el.classList.add('processed');
    });
    mermaid.init();
    document.querySelectorAll(`#${panel} pre code:not(.processed)`).forEach(block => {
      hljs.highlightElement(block);
      block.classList.add('processed');
    });
  }
});

loadProjects();
```

## Phase 2: Project Integration (2-3 hours)

### Step 1: File Picker Integration
**Update `main/index.js`:**
```javascript
const { dialog } = require('electron');

ipcMain.handle('open-project-picker', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory']
  });
  return result.filePaths[0];
});
```

### Step 2: File Reading from Projects
**Create `main/file-reader.js`:**
```javascript
const fs = require('fs');
const path = require('path');

function readFile(projectPath, relativePath) {
  const fullPath = path.join(projectPath, relativePath);
  return fs.readFileSync(fullPath, 'utf-8');
}

function listFiles(projectPath, relativeDir) {
  const fullPath = path.join(projectPath, relativeDir);
  return fs.readdirSync(fullPath);
}

module.exports = { readFile, listFiles };
```

### Step 3: Domain Detection
**Update `main/project-manager.js`:**
```javascript
async detectDomains(projectPath) {
  const domains = [];
  
  // Check for common domain indicators
  const dirs = fs.readdirSync(projectPath);
  
  if (dirs.includes('discovery')) {
    domains.push({ name: 'Discovery', skills: [], knowledge: {} });
  }
  if (dirs.includes('engineering')) {
    domains.push({ name: 'Engineering', skills: [], knowledge: {} });
  }
  if (dirs.includes('docs') || dirs.includes('knowledge')) {
    domains.push({ name: 'Documentation', skills: [], knowledge: {} });
  }
  
  domains.push({ name: 'All', skills: [], knowledge: {} });
  return domains;
}
```

### Step 4: Skills Integration
**Create `main/skills-loader.js`:**
```javascript
const fs = require('fs');
const path = require('path');

function loadSkills(projectPath, domainName) {
  const skillsPath = path.join(projectPath, 'context/skills');
  // Load domain-specific skills
  // Return skill instructions for agent
}

module.exports = { loadSkills };
```

## Phase 3: Polish (1-2 hours)

### Step 1: Red Circle States
**Update `renderer/app.js`:**
```javascript
ipcRenderer.on('agent-state', (event, state) => {
  const circle = document.getElementById('agent-circle');
  switch(state) {
    case 'thinking':
      circle.classList.add('animate-pulse');
      circle.classList.remove('bg-green-500');
      circle.classList.add('bg-red-500');
      break;
    case 'idle':
      circle.classList.remove('animate-pulse');
      circle.classList.remove('bg-red-500');
      circle.classList.add('bg-green-500');
      break;
    case 'error':
      circle.classList.remove('animate-pulse');
      circle.classList.remove('bg-green-500');
      circle.classList.add('bg-red-500');
      break;
  }
});
```

### Step 2: 2-Way Stream Chat
**Add chat input to panel when agent requests:**
```javascript
function addChatInput(panel) {
  const panelEl = document.getElementById(panel);
  const inputHtml = `
    <div class="chat-input mt-4">
      <input type="text" id="chat-input-${panel}" placeholder="Type a message..." class="border rounded p-2 w-full">
      <button onclick="sendChat('${panel}')" class="bg-blue-500 text-white p-2 rounded mt-2">Send</button>
    </div>
  `;
  panelEl.innerHTML += inputHtml;
}

function sendChat(panel) {
  const input = document.getElementById(`chat-input-${panel}`);
  const message = input.value;
  ipcRenderer.invoke('send-chat', { panel, message });
  input.value = '';
}
```

### Step 3: Project Persistence
**Update `main/project-manager.js`:**
```javascript
constructor() {
  this.projects = storage.get('projects', []);
  this.currentProject = storage.get('currentProject', null);
}

switchProject(projectId) {
  this.currentProject = this.projects.find(p => p.id === projectId);
  storage.set('currentProject', this.currentProject);
  return this.currentProject;
}
```

## Total Time: 5-8 hours for working MVP