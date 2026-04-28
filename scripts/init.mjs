#!/usr/bin/env node

/**
 * ragi init wizard
 * Detects AI agents and installs skill to their skills directories
 * Pure Node.js - no dependencies required
 */
import { mkdirSync, existsSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// Package info
const PKG_NAME = 'ragi';
const PKG_VERSION = '0.1.0';
const SKILL_NAME = 'ragi';
const GLOBAL_PROJECTS_DIR = join(homedir(), '.ragi', 'projects');

// Agent configurations (from vercel-labs/skills reference)
const AGENTS = {
  'opencode': {
    local: '.agents/skills',
    global: '.config/opencode/skills',
    name: 'OpenCode'
  },
  'claude-code': {
    local: '.claude/skills',
    global: '.claude/skills',
    name: 'Claude Code'
  },
  'cursor': {
    local: '.agents/skills',
    global: '.cursor/skills',
    name: 'Cursor'
  },
  'roo': {
    local: '.roo/skills',
    global: '.roo/skills',
    name: 'Roo Code'
  },
  'windsurf': {
    local: '.windsurf/skills',
    global: '.codeium/windsurf/skills',
    name: 'Windsurf'
  },
  'goose': {
    local: '.goose/skills',
    global: '.config/goose/skills',
    name: 'Goose'
  },
  'cline': {
    local: '.agents/skills',
    global: '.cline/skills',
    name: 'Cline'
  },
  'codex': {
    local: '.agents/skills',
    global: '.codex/skills',
    name: 'Codex'
  }
};

// Parse args
const args = process.argv.slice(2);
const flags = {
  local: args.includes('--local') || args.includes('-l'),
  global: args.includes('--global') || args.includes('-g'),
  force: args.includes('--force') || args.includes('-f'),
  check: args.includes('--check'),
  help: args.includes('--help') || args.includes('-h'),
};

const agentArg = args.find(a => a.startsWith('-a=') || a.startsWith('--agent='));
const targetAgent = agentArg ? agentArg.split('=')[1] : args.find(a => !a.startsWith('-') && !a.startsWith('--'));

function log(msg) { console.log(msg || ''); }
function error(msg) { console.error(`Error: ${msg}`); }
function warn(msg) { console.warn(`Warning: ${msg}`); }
function info(msg) { console.log(`  ${msg}`); }

function detectAgent(agentId) {
  const agent = AGENTS[agentId];
  if (!agent) return false;
  
  const globalPath = join(homedir(), agent.global);
  const localPath = join(process.cwd(), agent.local);
  
  return existsSync(globalPath) || existsSync(localPath);
}

function getSkillVersion(skillPath) {
  const skillFile = join(skillPath, 'SKILL.md');
  if (!existsSync(skillFile)) return null;
  
  try {
    const content = readFileSync(skillFile, 'utf-8');
    const match = content.match(/^---\nname: (\S+)\n/);
    if (match) return PKG_VERSION; // Version is in package, not skill
  } catch {}
  
  return null;
}

function copySkill(sourcePath, targetDir, force) {
  const sourceSkill = join(sourcePath, 'SKILL.md');
  const targetSkill = join(targetDir, PKG_NAME, 'SKILL.md');
  
  if (!existsSync(sourceSkill)) {
    error(`Skill source not found: ${sourceSkill}`);
    return { success: false, reason: 'source not found' };
  }
  
  // Create package directory in skills dir
  if (!existsSync(targetDir)) {
    try {
      mkdirSync(targetDir, { recursive: true });
    } catch (e) {
      error(`Cannot create directory: ${targetDir}`);
      return { success: false, reason: e.message };
    }
  }
  
  // Check if skill already exists
  if (existsSync(targetSkill) && !force) {
    return { success: false, reason: 'already exists (use --force to overwrite)', skipped: true };
  }
  
  try {
    const content = readFileSync(sourceSkill, 'utf-8');
    // Ensure target directory exists
    const targetPkgDir = join(targetDir, PKG_NAME);
    if (!existsSync(targetPkgDir)) {
      mkdirSync(targetPkgDir, { recursive: true });
    }
    writeFileSync(targetSkill, content);
    return { success: true };
  } catch (e) {
    error(`Failed to copy skill: ${e.message}`);
    return { success: false, reason: e.message };
  }
}

function setupGlobalProjects() {
  if (!existsSync(GLOBAL_PROJECTS_DIR)) {
    try {
      mkdirSync(GLOBAL_PROJECTS_DIR, { recursive: true });
      info(`Created: ${GLOBAL_PROJECTS_DIR}`);
    } catch (e) {
      error(`Cannot create projects directory: ${e.message}`);
    }
  }
}

function checkUpgrades() {
  log(`Checking ${PKG_NAME} skill installations...\n`);
  
  const cwd = process.cwd();
  let found = false;
  
  for (const [agentId, agent] of Object.entries(AGENTS)) {
    // Check local install path
    const localSkillPath = join(cwd, agent.local, PKG_NAME, 'SKILL.md');
    if (existsSync(localSkillPath)) {
      log(`  ${agent.name} (local): installed`);
      found = true;
    }
    
    // Check global install path
    const globalSkillPath = join(homedir(), agent.global, PKG_NAME, 'SKILL.md');
    if (existsSync(globalSkillPath)) {
      log(`  ${agent.name} (global): installed`);
      found = true;
    }
  }
  
  if (!found) {
    log(`No ${PKG_NAME} skills found.`);
    log(`\nInstall with: npx ${PKG_NAME} init`);
  }
  
  process.exit(0);
}

function runInit() {
  const isGlobal = flags.global;
  const isLocal = flags.local;
  const checkOnly = flags.check;
  const force = flags.force;
  const cwd = process.cwd();
  
  // Self location
  const selfPath = join(cwd, 'skills', SKILL_NAME);
  
  // If published (installed via npm), look in node_modules
  if (!existsSync(selfPath)) {
    const nodeModulesPath = join(cwd, 'node_modules', PKG_NAME, 'skills', SKILL_NAME);
    if (existsSync(nodeModulesPath)) {
      // Use installed version
    }
  }
  
  if (checkOnly) {
    checkUpgrades();
    return;
  }
  
  log(`Initializing ${PKG_NAME} v${PKG_VERSION}...\n`);
  
  // Setup global projects dir
  setupGlobalProjects();
  
  // Detect agents or use target
  const detectedAgents = [];
  
  if (targetAgent && AGENTS[targetAgent]) {
    if (detectAgent(targetAgent)) {
      detectedAgents.push(targetAgent);
    } else {
      warn(`${AGENTS[targetAgent].name} not detected.`);
    }
  } else if (!isLocal && !isGlobal) {
    for (const agentId of Object.keys(AGENTS)) {
      if (detectAgent(agentId)) {
        detectedAgents.push(agentId);
      }
    }
  }
  
  if (detectedAgents.length === 0) {
    log('No supported AI agents detected.');
    log(`\nSupported: ${Object.keys(AGENTS).join(', ')}`);
    log(`\nManual install: npx ${PKG_NAME} init -a <agent-name>`);
    process.exit(0);
  }
  
  log(`Detected: ${detectedAgents.map(a => AGENTS[a].name).join(', ')}\n`);
  
  const scope = isGlobal ? 'global' : 'local';
  log(`Installing to ${scope} skills...\n`);
  
  let installed = 0;
  let skipped = 0;
  
  for (const agentId of detectedAgents) {
    const agent = AGENTS[agentId];
    const targetSkillsDir = isGlobal 
      ? join(homedir(), agent.global)
      : join(cwd, agent.local);
    
    process.stdout.write(`  ${agent.name}: `);
    
    const skillSource = existsSync(join(cwd, 'skills', SKILL_NAME, 'SKILL.md'))
      ? join(cwd, 'skills', SKILL_NAME)
      : join(__dirname, '..', 'skills', SKILL_NAME);
    
    const result = copySkill(skillSource, targetSkillsDir, force);
    
    if (result.success) {
      log('installed');
      installed++;
    } else if (result.skipped) {
      log(`skipped (${result.reason})`);
      skipped++;
    } else {
      log(`failed (${result.reason})`);
    }
  }
  
  log(`\nDone: ${installed} installed, ${skipped} skipped`);
  log(`\nConfigure your MCP client to use ragi:`);
  log(`  { "mcpServers": { "ragi": { "command": "npx", "args": ["ragi"] } } }`);
}

function showHelp() {
  log(`${PKG_NAME} v${PKG_VERSION} - Skill installer
  
Usage:
  npx ${PKG_NAME} init              Detect and install
  npx ${PKG_NAME} init --local     Install to project only
  npx ${PKG_NAME} init --global   Install globally
  npx ${PKG_NAME} init -a=<agent> Install to specific agent
  npx ${PKG_NAME} init --check    Check installations
  npx ${PKG_NAME} init --force   Overwrite existing
  npx ${PKG_NAME} init --help     Show this help
  
Examples:
  npx ${PKG_NAME} init
  npx ${PKG_NAME} init -a=opencode
  npx ${PKG_NAME} init --global
  npx ${PKG_NAME} init --check
  
Supported agents:
${Object.entries(AGENTS).map(([id, a]) => `  ${id.padEnd(12)} ${a.name}`).join('\n')}`);
}

// Run
if (flags.help) {
  showHelp();
} else {
  runInit();
}