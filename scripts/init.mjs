#!/usr/bin/env node

/**
 * ragi init wizard
 * Detects AI agents and installs skill to their skills directories
 * Pure Node.js - no dependencies required
 */
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import readline from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Package info
const PACKAGE_NAME = '@susutawar/ragi';
const BIN_NAME = 'ragi';
const PKG_VERSION = '0.1.2';
const SKILL_NAME = 'ragi';
const GLOBAL_PROJECTS_DIR = join(homedir(), '.ragi', 'projects');
const GLOBAL_CONFIG_DIR = join('.config', BIN_NAME);
const GLOBAL_CONFIG_PATH = join(GLOBAL_CONFIG_DIR, 'config.json');
const SCRIPT_DIR = resolve(fileURLToPath(new URL('.', import.meta.url)));
const MCP_SERVER_NAME = 'ragi';

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

const MCP_ADAPTERS = {
  'opencode': {
    local: {
      fallbackTo: 'global',
      note: 'OpenCode MCP registration is global by default, so local init will update the global OpenCode config.',
    },
    global: {
      kind: 'json',
      base: 'home',
      relativePath: join('.config', 'opencode', 'opencode.json'),
      rootKey: 'mcp',
      entryKind: 'opencode',
    },
  },
  'claude-code': {
    local: {
      fallbackTo: 'global',
      note: 'Claude Code MCP registration is global by default, so local init prints or updates the user-scope registration path.',
    },
    global: {
      kind: 'manual',
      pathHints: ['~/.claude/settings.json', `claude mcp add ${MCP_SERVER_NAME} --scope user -- cmd /c npx -y ${PACKAGE_NAME}`],
      snippetKind: 'claude-cli',
    },
  },
  'cursor': {
    local: {
      fallbackTo: 'global',
      note: 'Cursor MCP registration is global by default, so local init will update the global Cursor MCP config.',
    },
    global: {
      kind: 'json',
      base: 'home',
      relativePath: join('.cursor', 'mcp.json'),
      rootKey: 'mcpServers',
      entryKind: 'stdio',
    },
  },
  'roo': {
    local: {
      kind: 'manual',
      pathHints: ['Roo Code MCP settings (see Roo Code docs / extension UI)'],
      snippetKind: 'stdio',
    },
    global: {
      kind: 'manual',
      pathHints: ['Roo Code MCP settings (see Roo Code docs / extension UI)'],
      snippetKind: 'stdio',
    },
  },
  'windsurf': {
    local: {
      fallbackTo: 'global',
      note: 'Windsurf MCP is configured globally, so local init will update the global Windsurf MCP config.',
    },
    global: {
      kind: 'json',
      base: 'home',
      candidateRelativePaths: [
        join('.codeium', 'windsurf', 'mcp_config.json'),
        join('.codeium', 'mcp_config.json'),
      ],
      rootKey: 'mcpServers',
      entryKind: 'stdio',
    },
  },
  'goose': {
    local: {
      kind: 'manual',
      pathHints: ['~/.config/goose/config.yaml', 'goose configure'],
      snippetKind: 'goose-yaml',
    },
    global: {
      kind: 'manual',
      pathHints: ['~/.config/goose/config.yaml', 'goose configure'],
      snippetKind: 'goose-yaml',
    },
  },
  'cline': {
    local: {
      fallbackTo: 'global',
      note: 'Cline MCP is configured globally, so local init will update the global Cline MCP config.',
    },
    global: {
      kind: 'json',
      base: 'home',
      relativePath: join('.cline', 'data', 'settings', 'cline_mcp_settings.json'),
      rootKey: 'mcpServers',
      entryKind: 'stdio',
    },
  },
  'codex': {
    local: {
      fallbackTo: 'global',
      note: 'Codex MCP is configured globally, so local init will update the global Codex MCP config.',
    },
    global: {
      kind: 'toml',
      base: 'home',
      relativePath: join('.codex', 'config.toml'),
      snippetKind: 'codex-toml',
    },
  },
};

function log(msg) { console.log(msg || ''); }
function error(msg) { console.error(`Error: ${msg}`); }
function warn(msg) { console.warn(`Warning: ${msg}`); }
function info(msg) { console.log(`  ${msg}`); }
function listAgentIds() { return Object.keys(AGENTS); }

function getJsonMcpEntry() {
  return {
    command: 'npx',
    args: ['-y', PACKAGE_NAME],
  };
}

function getOpenCodeMcpEntry() {
  return {
    type: 'local',
    command: ['npx', '-y', PACKAGE_NAME],
  };
}

function getGooseMcpEntry() {
  return {
    name: MCP_SERVER_NAME,
    cmd: 'npx',
    args: ['-y', PACKAGE_NAME],
    enabled: true,
    type: 'stdio',
    timeout: 300,
  };
}

function getDefaultGlobalConfig() {
  return {
    vectorStore: 'sqlite',
    sqlite: { path: ':memory:' },
    embedding: {
      provider: 'transformers_js',
      model: 'Xenova/all-MiniLM-L6-v2',
    },
    providers: {
      ollama: {
        baseUrl: 'http://localhost:11434',
      },
      llama_cpp: {
        baseUrl: 'http://localhost:8080',
      },
    },
    chunking: { maxSize: 512, overlap: 50 },
  };
}

function validateRagiConfigShape(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { valid: false, reason: 'config must be a JSON object' };
  }

  if ('vectorStore' in parsed) {
    const allowedVectorStores = new Set(['sqlite', 'qdrant_local']);
    if (typeof parsed.vectorStore !== 'string' || !allowedVectorStores.has(parsed.vectorStore)) {
      return { valid: false, reason: 'vectorStore must be "sqlite" or "qdrant_local"' };
    }
  }

  if ('sqlite' in parsed) {
    if (!parsed.sqlite || typeof parsed.sqlite !== 'object' || Array.isArray(parsed.sqlite)) {
      return { valid: false, reason: 'sqlite must be an object' };
    }
    if ('path' in parsed.sqlite && typeof parsed.sqlite.path !== 'string') {
      return { valid: false, reason: 'sqlite.path must be a string' };
    }
  }

  if ('embedding' in parsed) {
    const allowedProviders = new Set(['ollama', 'transformers_js', 'llama_cpp']);
    if (!parsed.embedding || typeof parsed.embedding !== 'object' || Array.isArray(parsed.embedding)) {
      return { valid: false, reason: 'embedding must be an object' };
    }
    if ('provider' in parsed.embedding) {
      if (typeof parsed.embedding.provider !== 'string' || !allowedProviders.has(parsed.embedding.provider)) {
        return { valid: false, reason: 'embedding.provider is not supported' };
      }
    }
    if ('model' in parsed.embedding && typeof parsed.embedding.model !== 'string') {
      return { valid: false, reason: 'embedding.model must be a string' };
    }
    if ('baseUrl' in parsed.embedding && typeof parsed.embedding.baseUrl !== 'string') {
      return { valid: false, reason: 'embedding.baseUrl must be a string' };
    }
  }

  if ('providers' in parsed) {
    if (!parsed.providers || typeof parsed.providers !== 'object' || Array.isArray(parsed.providers)) {
      return { valid: false, reason: 'providers must be an object' };
    }

    const providerKeys = ['ollama', 'llama_cpp'];
    for (const providerKey of providerKeys) {
      if (!(providerKey in parsed.providers)) {
        continue;
      }

      const providerConfig = parsed.providers[providerKey];
      if (!providerConfig || typeof providerConfig !== 'object' || Array.isArray(providerConfig)) {
        return { valid: false, reason: `providers.${providerKey} must be an object` };
      }

      if ('baseUrl' in providerConfig && typeof providerConfig.baseUrl !== 'string') {
        return { valid: false, reason: `providers.${providerKey}.baseUrl must be a string` };
      }
    }
  }

  if ('chunking' in parsed) {
    if (!parsed.chunking || typeof parsed.chunking !== 'object' || Array.isArray(parsed.chunking)) {
      return { valid: false, reason: 'chunking must be an object' };
    }
    if ('maxSize' in parsed.chunking && (!Number.isInteger(parsed.chunking.maxSize) || parsed.chunking.maxSize <= 0)) {
      return { valid: false, reason: 'chunking.maxSize must be a positive integer' };
    }
    if ('overlap' in parsed.chunking && (!Number.isInteger(parsed.chunking.overlap) || parsed.chunking.overlap < 0)) {
      return { valid: false, reason: 'chunking.overlap must be a non-negative integer' };
    }
  }

  return { valid: true };
}

export function getGlobalConfigPath(home = homedir()) {
  return join(home, GLOBAL_CONFIG_PATH);
}

export function getGlobalConfigStatus(options = {}) {
  const {
    home = homedir(),
    exists = existsSync,
  } = options;
  const filePath = getGlobalConfigPath(home);

  if (!exists(filePath)) {
    return { exists: false, valid: false, filePath, reason: 'missing' };
  }

  try {
    const raw = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    const validation = validateRagiConfigShape(parsed);
    if (!validation.valid) {
      return { exists: true, valid: false, filePath, reason: validation.reason };
    }
    return { exists: true, valid: true, filePath };
  } catch (err) {
    return { exists: true, valid: false, filePath, reason: err.message };
  }
}

export function scaffoldGlobalConfig(options = {}) {
  const { home = homedir() } = options;
  const filePath = getGlobalConfigPath(home);
  ensureParentDirectory(filePath);
  writeFileSync(filePath, `${JSON.stringify(getDefaultGlobalConfig(), null, 2)}\n`);
  return filePath;
}

export function parseArgs(argv = process.argv.slice(2)) {
  const agentArg = argv.find(a => a.startsWith('-a=') || a.startsWith('--agent='));
  const targetAgent = agentArg ? agentArg.split('=')[1] : argv.find(a => !a.startsWith('-') && !a.startsWith('--'));

  return {
    args: argv,
    flags: {
      local: argv.includes('--local') || argv.includes('-l'),
      global: argv.includes('--global') || argv.includes('-g'),
      force: argv.includes('--force') || argv.includes('-f'),
      check: argv.includes('--check'),
      help: argv.includes('--help') || argv.includes('-h'),
      noDocs: argv.includes('--no-docs'),
    },
    targetAgent,
  };
}

function detectAgent(agentId, scope = 'local', options = {}) {
  const agent = AGENTS[agentId];
  if (!agent) return false;
  const {
    cwd = process.cwd(),
    home = homedir(),
    exists = existsSync,
  } = options;

  if (scope === 'global') {
    return exists(join(home, agent.global));
  }

  return exists(join(cwd, agent.local));
}

function hashContent(content) {
  return createHash('sha256').update(content).digest('hex');
}

function resolveSkillSourceDir(cwd = process.cwd()) {
  const localSkillPath = join(cwd, 'skills', SKILL_NAME);
  if (existsSync(join(localSkillPath, 'SKILL.md'))) {
    return localSkillPath;
  }

  return join(SCRIPT_DIR, '..', 'skills', SKILL_NAME);
}

function getPackagedSkillMetadata(options = {}) {
  const {
    cwd = process.cwd(),
    readFile = readFileSync,
  } = options;
  const sourceDir = resolveSkillSourceDir(cwd);
  const skillFile = join(sourceDir, 'SKILL.md');
  const content = readFile(skillFile, 'utf-8');
  return {
    sourceDir,
    skillFile,
    content,
    hash: hashContent(content),
  };
}

function getTargetSkillsDir(agentId, scope, options = {}) {
  const {
    cwd = process.cwd(),
    home = homedir(),
  } = options;
  const agent = AGENTS[agentId];
  return scope === 'global' ? join(home, agent.global) : join(cwd, agent.local);
}

export function getSkillInstallationStatus(agentId, scope, options = {}) {
  const {
    cwd = process.cwd(),
    home = homedir(),
    exists = existsSync,
    readFile = readFileSync,
    packagedSkillHash,
  } = options;
  const targetSkillsDir = getTargetSkillsDir(agentId, scope, { cwd, home });
  const targetSkillPath = join(targetSkillsDir, SKILL_NAME, 'SKILL.md');

  if (!exists(targetSkillPath)) {
    return { agentId, status: 'missing', targetSkillsDir, targetSkillPath };
  }

  try {
    const installedContent = readFile(targetSkillPath, 'utf-8');
    const installedHash = hashContent(installedContent);
    return {
      agentId,
      status: installedHash === packagedSkillHash ? 'current' : 'outdated',
      targetSkillsDir,
      targetSkillPath,
    };
  } catch (err) {
    return {
      agentId,
      status: 'invalid',
      targetSkillsDir,
      targetSkillPath,
      reason: err.message,
    };
  }
}

export function getSkillInstallationStatuses(agentIds, scope, options = {}) {
  return agentIds.map((agentId) => getSkillInstallationStatus(agentId, scope, options));
}

function copySkill(sourcePath, targetDir) {
  const sourceSkill = join(sourcePath, 'SKILL.md');
  const targetSkill = join(targetDir, SKILL_NAME, 'SKILL.md');
  
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
  
  try {
    const content = readFileSync(sourceSkill, 'utf-8');
    // Ensure target directory exists
    const targetPkgDir = join(targetDir, SKILL_NAME);
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

const DOC_BLOCK_BEGIN = '<!-- RAGI:BEGIN -->';
const DOC_BLOCK_END = '<!-- RAGI:END -->';

export function buildRagiInstructionBlock() {
  return [
    DOC_BLOCK_BEGIN,
    'Use ragi MCP tools to look up repo information before guessing.',
    '',
    'When answering "what/where/how" questions about this repo:',
    '- Prefer `rag_search` first (semantic).',
    '- Use `rag_list_projects` if project path/allowlist is unclear.',
    '- Use `rag_index` if results suggest the repo is not indexed yet.',
    '',
    'Inputs: `projectPath` (absolute path), `query`, optional `limit`.',
    'Fallback: if RAG is unavailable/unindexed, use normal file search.',
    DOC_BLOCK_END,
    '',
  ].join('\n');
}

export function upsertMarkedBlock(fileContent, blockText) {
  const beginIndex = fileContent.indexOf(DOC_BLOCK_BEGIN);
  const endIndex = fileContent.indexOf(DOC_BLOCK_END);

  if (beginIndex !== -1 && endIndex !== -1 && endIndex > beginIndex) {
    const afterEndIndex = endIndex + DOC_BLOCK_END.length;
    const before = fileContent.slice(0, beginIndex);
    const after = fileContent.slice(afterEndIndex);
    const normalizedBefore = before.endsWith('\n') ? before : `${before}\n`;
    const normalizedAfter = after.startsWith('\n') ? after.slice(1) : after;
    return `${normalizedBefore}${blockText}${normalizedAfter}`;
  }

  const trimmed = fileContent.replace(/\s+$/, '');
  const lines = trimmed.length === 0 ? [] : trimmed.split(/\r?\n/);

  if (lines.length > 0 && lines[0].startsWith('#')) {
    const firstLine = lines[0];
    const rest = lines.slice(1);
    const hasBlank = rest.length > 0 && rest[0].trim() === '';
    const restNormalized = hasBlank ? rest.slice(1) : rest;
    const rebuilt = [firstLine, '', blockText.replace(/\s+$/, ''), '', ...restNormalized].join('\n');
    return `${rebuilt}\n`;
  }

  const rebuilt = [blockText.replace(/\s+$/, ''), '', ...lines].join('\n');
  return `${rebuilt.replace(/\s+$/, '')}\n`;
}

function isInteractive() {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

async function promptYesNo(question, defaultValue = false) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await new Promise((resolve) => rl.question(question, resolve));
    const normalized = String(answer).trim().toLowerCase();
    if (!normalized) {
      return defaultValue;
    }
    return normalized === 'y' || normalized === 'yes';
  } finally {
    rl.close();
  }
}

function resolveTargetPath(target, options = {}) {
  const {
    cwd = process.cwd(),
    home = homedir(),
    exists = existsSync,
  } = options;

  const baseDir = target.base === 'home' ? home : cwd;
  if (target.relativePath) {
    return join(baseDir, target.relativePath);
  }

  if (target.candidateRelativePaths) {
    const candidates = target.candidateRelativePaths.map((relativePath) => join(baseDir, relativePath));
    const existing = candidates.find((candidate) => exists(candidate));
    return existing ?? candidates[0];
  }

  return null;
}

function resolveMcpTarget(agentId, scope, options = {}) {
  const adapter = MCP_ADAPTERS[agentId];
  if (!adapter) {
    return {
      kind: 'manual',
      pathHints: ['Agent-specific MCP config path is unknown.'],
      snippetKind: 'stdio',
    };
  }

  const initialTarget = adapter[scope];
  if (!initialTarget) {
    return {
      kind: 'manual',
      pathHints: ['Agent-specific MCP config path is unknown.'],
      snippetKind: 'stdio',
    };
  }

  if (initialTarget.fallbackTo) {
    const fallback = adapter[initialTarget.fallbackTo];
    return {
      ...fallback,
      note: initialTarget.note,
    };
  }

  return initialTarget;
}

function areJsonEntriesEqual(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function getExpectedMcpEntry(target) {
  return target.entryKind === 'opencode' ? getOpenCodeMcpEntry() : getJsonMcpEntry();
}

function ensureParentDirectory(filePath) {
  mkdirSync(dirname(filePath), { recursive: true });
}

function upsertJsonConfigContent(existingContent, rootKey, entry) {
  const parsed = existingContent.trim() ? JSON.parse(existingContent) : {};
  const next = (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
  const root = (next[rootKey] && typeof next[rootKey] === 'object' && !Array.isArray(next[rootKey]))
    ? next[rootKey]
    : {};
  next[rootKey] = {
    ...root,
    [MCP_SERVER_NAME]: entry,
  };
  return `${JSON.stringify(next, null, 2)}\n`;
}

function upsertTomlMcpServer(existingContent) {
  const block = [
    `[mcp_servers.${MCP_SERVER_NAME}]`,
    `command = "npx"`,
    `args = ["-y", "${PACKAGE_NAME}"]`,
    '',
  ].join('\n');
  const pattern = /^\[mcp_servers\.ragi\]\s*\n(?:.*\n)*?(?=^\[|\Z)/m;

  if (pattern.test(existingContent)) {
    return existingContent.replace(pattern, block);
  }

  const trimmed = existingContent.replace(/\s+$/, '');
  if (!trimmed) {
    return block;
  }

  return `${trimmed}\n\n${block}`;
}

function renderMcpSnippet(snippetKind = 'stdio') {
  if (snippetKind === 'codex-toml') {
    return [
      `[mcp_servers.${MCP_SERVER_NAME}]`,
      `command = "npx"`,
      `args = ["-y", "${PACKAGE_NAME}"]`,
    ].join('\n');
  }

  if (snippetKind === 'opencode') {
    return JSON.stringify({
      mcp: {
        [MCP_SERVER_NAME]: getOpenCodeMcpEntry(),
      },
    }, null, 2);
  }

  if (snippetKind === 'goose-yaml') {
    return [
      'extensions:',
      `  ${MCP_SERVER_NAME}:`,
      `    name: ${MCP_SERVER_NAME}`,
      `    cmd: npx`,
      `    args: [-y, ${PACKAGE_NAME}]`,
      `    enabled: true`,
      `    type: stdio`,
      `    timeout: 300`,
    ].join('\n');
  }

  if (snippetKind === 'claude-cli') {
    return `claude mcp add ${MCP_SERVER_NAME} --scope user -- cmd /c npx -y ${PACKAGE_NAME}`;
  }

  return JSON.stringify({
    mcpServers: {
      [MCP_SERVER_NAME]: getJsonMcpEntry(),
    },
  }, null, 2);
}

function describeTargetPaths(target, options = {}) {
  const resolvedPath = resolveTargetPath(target, options);
  if (resolvedPath) {
    return [resolvedPath];
  }

  return target.pathHints ?? [];
}

function printManualMcpInstructions(agentId, scope, options = {}) {
  const logger = options.logger ?? log;
  const target = resolveMcpTarget(agentId, scope, options);
  const agentName = AGENTS[agentId]?.name ?? agentId;
  const pathHints = describeTargetPaths(target, options);
  const snippetKind = target.entryKind === 'opencode' ? 'opencode' : (target.snippetKind ?? 'stdio');

  logger(`\n${agentName}: configure MCP manually.`);
  if (target.note) {
    logger(`  ${target.note}`);
  }
  if (pathHints.length > 0) {
    logger(`  Target: ${pathHints.join(' or ')}`);
  }
  logger(renderMcpSnippet(snippetKind));
}

export function upsertMcpConfigFile(existingContent, target) {
  if (target.kind === 'json') {
    const entry = target.entryKind === 'opencode' ? getOpenCodeMcpEntry() : getJsonMcpEntry();
    return upsertJsonConfigContent(existingContent, target.rootKey, entry);
  }

  if (target.kind === 'toml') {
    return upsertTomlMcpServer(existingContent);
  }

  throw new Error(`Unsupported writable MCP target kind: ${target.kind}`);
}

export function getMcpRegistrationStatus(agentId, scope, options = {}) {
  const {
    cwd = process.cwd(),
    home = homedir(),
    exists = existsSync,
  } = options;
  const target = resolveMcpTarget(agentId, scope, { cwd, home, exists });
  const targetPaths = describeTargetPaths(target, { cwd, home, exists });

  if (target.kind === 'manual') {
    return {
      agentId,
      status: 'unknown',
      target,
      targetPaths,
      reason: 'manual-only',
    };
  }

  const resolvedPath = resolveTargetPath(target, { cwd, home, exists });
  if (!resolvedPath) {
    return {
      agentId,
      status: 'unknown',
      target,
      targetPaths,
      reason: 'path-unresolved',
    };
  }

  if (!exists(resolvedPath)) {
    return {
      agentId,
      status: 'missing',
      target,
      targetPaths: [resolvedPath],
    };
  }

  try {
    const existingContent = readFileSync(resolvedPath, 'utf-8');

    if (target.kind === 'json') {
      const parsed = existingContent.trim() ? JSON.parse(existingContent) : {};
      const root = parsed?.[target.rootKey];
      const entry = root?.[MCP_SERVER_NAME];
      if (!entry) {
        return { agentId, status: 'missing', target, targetPaths: [resolvedPath] };
      }
      const expected = getExpectedMcpEntry(target);
      return {
        agentId,
        status: areJsonEntriesEqual(entry, expected) ? 'configured' : 'configured',
        target,
        targetPaths: [resolvedPath],
      };
    }

    if (target.kind === 'toml') {
      const pattern = /^\[mcp_servers\.ragi\]\s*$/m;
      return {
        agentId,
        status: pattern.test(existingContent) ? 'configured' : 'missing',
        target,
        targetPaths: [resolvedPath],
      };
    }
  } catch (err) {
    return {
      agentId,
      status: 'invalid',
      target,
      targetPaths: [resolvedPath],
      reason: err.message,
    };
  }

  return {
    agentId,
    status: 'unknown',
    target,
    targetPaths: [resolvedPath],
    reason: 'unsupported-target',
  };
}

export function getMcpRegistrationStatuses(agentIds, scope, options = {}) {
  return agentIds.map((agentId) => getMcpRegistrationStatus(agentId, scope, options));
}

export function configureMcpForAgent(agentId, scope, options = {}) {
  const {
    cwd = process.cwd(),
    home = homedir(),
    exists = existsSync,
    logger = log,
  } = options;
  const target = resolveMcpTarget(agentId, scope, { cwd, home, exists });
  const agentName = AGENTS[agentId]?.name ?? agentId;

  if (target.kind === 'manual') {
    printManualMcpInstructions(agentId, scope, { cwd, home, exists, logger });
    return { agentId, status: 'manual', targetPaths: describeTargetPaths(target, { cwd, home, exists }) };
  }

  const resolvedPath = resolveTargetPath(target, { cwd, home, exists });
  if (!resolvedPath) {
    printManualMcpInstructions(agentId, scope, { cwd, home, exists, logger });
    return { agentId, status: 'manual', targetPaths: describeTargetPaths(target, { cwd, home, exists }) };
  }

  if (target.note) {
    logger(`  ${agentName}: ${target.note}`);
  } else {
    logger(`  ${agentName}: configuring MCP at ${resolvedPath}`);
  }

  try {
    const existingContent = exists(resolvedPath) ? readFileSync(resolvedPath, 'utf-8') : '';
    const updatedContent = upsertMcpConfigFile(existingContent, target);
    ensureParentDirectory(resolvedPath);
      writeFileSync(resolvedPath, updatedContent);
    logger(`  ${agentName}: MCP configured`);
    return { agentId, status: 'configured', targetPaths: [resolvedPath] };
  } catch (err) {
    logger(`  ${agentName}: unable to write MCP config automatically (${err.message})`);
    printManualMcpInstructions(agentId, scope, { cwd, home, exists, logger });
    return { agentId, status: 'manual', targetPaths: describeTargetPaths(target, { cwd, home, exists }), reason: err.message };
  }
}

export function configureMcpForAgents(agentIds, scope, options = {}) {
  return agentIds.map((agentId) => configureMcpForAgent(agentId, scope, options));
}

function summarizeSkillStatuses(statuses) {
  return {
    missing: statuses.filter((status) => status.status === 'missing'),
    current: statuses.filter((status) => status.status === 'current'),
    outdated: statuses.filter((status) => status.status === 'outdated'),
    invalid: statuses.filter((status) => status.status === 'invalid'),
  };
}

function summarizeMcpStatuses(statuses, logger = log) {
  const configured = statuses.filter((status) => status.status === 'configured');
  const actionable = statuses.filter((status) => status.status === 'missing' || status.status === 'invalid');
  const unknown = statuses.filter((status) => status.status === 'unknown');

  if (configured.length > 0) {
    logger(`MCP already registered for: ${configured.map((status) => AGENTS[status.agentId]?.name ?? status.agentId).join(', ')}`);
  }

  if (unknown.length > 0) {
    logger(`MCP status could not be verified automatically for: ${unknown.map((status) => AGENTS[status.agentId]?.name ?? status.agentId).join(', ')}`);
  }

  return { configured, actionable, unknown };
}

async function promptText(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await new Promise((resolve) => rl.question(question, resolve));
    return String(answer);
  } finally {
    rl.close();
  }
}

function printExistingProjectOverrideNotes(selectedAgents, cwd, logger = log) {
  const projectOverridePaths = [
    { filePath: join(cwd, '.cursor', 'mcp.json'), label: '.cursor/mcp.json' },
    { filePath: join(cwd, '.mcp.json'), label: '.mcp.json' },
    { filePath: join(cwd, 'opencode.json'), label: 'opencode.json' },
  ];

  const existing = projectOverridePaths.filter((entry) => existsSync(entry.filePath));
  if (existing.length === 0) {
    return;
  }

  logger('\nProject-local MCP config files already exist and are left untouched:');
  for (const entry of existing) {
    logger(`  ${entry.label} (acts as a project override)`);
  }
  logger('Global host registration is now the default setup path.');
}

export function parseAgentSelection(input, orderedAgentIds) {
  const trimmed = String(input).trim();
  if (!trimmed) {
    return { ok: true, selectedAgentIds: [] };
  }

  const parts = trimmed.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) {
    return { ok: true, selectedAgentIds: [] };
  }

  const selectedAgentIds = [];
  const seen = new Set();

  for (const part of parts) {
    if (!/^\d+$/.test(part)) {
      return { ok: false, reason: `Invalid selection "${part}"` };
    }

    const index = Number(part);
    if (index < 1 || index > orderedAgentIds.length) {
      return { ok: false, reason: `Selection "${part}" is out of range` };
    }

    const agentId = orderedAgentIds[index - 1];
    if (!seen.has(agentId)) {
      seen.add(agentId);
      selectedAgentIds.push(agentId);
    }
  }

  return { ok: true, selectedAgentIds };
}

export async function chooseProjectAgents(options = {}) {
  const {
    prompt = promptText,
    logger = log,
    detectedAgentIds = [],
    orderedAgentIds = listAgentIds(),
    agents = AGENTS,
  } = options;

  logger('Choose which agents are used in this project:');
  for (const [index, agentId] of orderedAgentIds.entries()) {
    const agent = agents[agentId];
    if (!agent) continue;
    const suffix = detectedAgentIds.includes(agentId) ? ' (detected default)' : '';
    logger(`  ${index + 1}. ${agent.name}${suffix}`);
  }

  const defaultLabel = detectedAgentIds.length > 0
    ? detectedAgentIds.map((agentId) => agents[agentId]?.name ?? agentId).join(', ')
    : 'none';
  logger(`Press Enter to use detected defaults: ${defaultLabel}`);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const answer = await prompt('Select agents by number (example: 1,3,5): ');
    const parsed = parseAgentSelection(answer, orderedAgentIds);

    if (!parsed.ok) {
      logger(`${parsed.reason}. Example: 1,3,5`);
      continue;
    }

    if (parsed.selectedAgentIds.length === 0) {
      if (detectedAgentIds.length > 0) {
        return { selectedAgentIds: detectedAgentIds, usedDetectedDefaults: true, cancelled: false };
      }

      logger('No detected default agents. Re-run with `-a=<agent>` or choose one or more numbers.');
      return { selectedAgentIds: [], usedDetectedDefaults: false, cancelled: true };
    }

    return { selectedAgentIds: parsed.selectedAgentIds, usedDetectedDefaults: false, cancelled: false };
  }

  logger(`No valid agent selection provided. Re-run \`npx -y ${PACKAGE_NAME} init\` and choose agents, or use \`-a=<agent>\`.`);
  return { selectedAgentIds: [], usedDetectedDefaults: false, cancelled: true };
}

export async function updateDocsInCwd(options = {}) {
  const {
    cwd = process.cwd(),
    interactive = isInteractive(),
    prompt = promptYesNo,
    logger = log,
  } = options;
  const blockText = buildRagiInstructionBlock();
  const targetFiles = ['AGENTS.md', 'CLAUDE.md'];
  const results = [];

  for (const fileName of targetFiles) {
    const filePath = join(cwd, fileName);
    const exists = existsSync(filePath);

    if (!exists) {
      if (!interactive) {
        logger(`\n${fileName} not found. Create it to prioritize ragi in this repo:`);
        logger(blockText);
        results.push({ fileName, action: 'printed' });
        continue;
      }

      const shouldCreate = await prompt(`Create ${fileName} with ragi instructions? (y/N) `);
      if (!shouldCreate) {
        results.push({ fileName, action: 'skipped' });
        continue;
      }

      writeFileSync(filePath, `${blockText}`);
      logger(`  Updated: ${fileName}`);
      results.push({ fileName, action: 'created' });
      continue;
    }

    const content = readFileSync(filePath, 'utf-8');
    const updated = upsertMarkedBlock(content, blockText);
    if (updated !== content) {
      writeFileSync(filePath, updated);
      results.push({ fileName, action: 'updated' });
    } else {
      results.push({ fileName, action: 'unchanged' });
    }
    logger(`  Updated: ${fileName}`);
  }

  return results;
}

export async function maybeScaffoldGlobalConfig(options = {}) {
  const {
    home = homedir(),
    interactive = isInteractive(),
    prompt = promptYesNo,
    logger = log,
  } = options;
  const status = getGlobalConfigStatus({ home });

  if (status.valid) {
    return { action: 'unchanged', filePath: status.filePath, reason: null };
  }

  const scaffoldLabel = JSON.stringify(getDefaultGlobalConfig(), null, 2);
  if (!interactive) {
    if (!status.exists) {
      logger(`\nGlobal ragi config not found at ${status.filePath}.`);
      logger('Create it to customize runtime defaults when needed:');
      logger(scaffoldLabel);
      logger('Recommended embedding models: ollama -> nomic-embed-text, transformers_js -> Xenova/all-MiniLM-L6-v2, llama_cpp -> an embedding-capable model served by your llama.cpp instance.');
      return { action: 'printed', filePath: status.filePath, reason: 'missing' };
    }

    logger(`\nGlobal ragi config at ${status.filePath} is invalid: ${status.reason}`);
    logger('Fix or replace it with this scaffold:');
    logger(scaffoldLabel);
    return { action: 'printed', filePath: status.filePath, reason: status.reason };
  }

  const shouldCreate = !status.exists
    ? await prompt(`Create global ragi config at ${status.filePath}? (Y/n) `, true)
    : await prompt(`Global ragi config at ${status.filePath} is invalid (${status.reason}). Replace it with a scaffold? (y/N) `, false);

  if (!shouldCreate) {
    return { action: 'skipped', filePath: status.filePath, reason: status.reason ?? 'declined' };
  }

  scaffoldGlobalConfig({ home });
  logger(`  Updated: ${status.filePath}`);
  return { action: status.exists ? 'replaced' : 'created', filePath: status.filePath, reason: null };
}

export function checkUpgrades(logger = log) {
  logger(`Checking ${SKILL_NAME} skill installations...\n`);

  const cwd = process.cwd();
  let found = false;
  
  for (const [agentId, agent] of Object.entries(AGENTS)) {
    // Check local install path
    const localSkillPath = join(cwd, agent.local, SKILL_NAME, 'SKILL.md');
    if (existsSync(localSkillPath)) {
      logger(`  ${agent.name} (local): installed`);
      found = true;
    }
    
    // Check global install path
    const globalSkillPath = join(homedir(), agent.global, SKILL_NAME, 'SKILL.md');
    if (existsSync(globalSkillPath)) {
      logger(`  ${agent.name} (global): installed`);
      found = true;
    }
  }
  
  if (!found) {
    logger(`No ${SKILL_NAME} skills found.`);
    logger(`\nInstall with: npx -y ${PACKAGE_NAME} init`);
  }

  return found;
}

export function resolveDetectedAgents({ targetAgent, scope, options = {} }) {
  if (targetAgent) {
    if (!AGENTS[targetAgent]) {
      return [];
    }
    return [targetAgent];
  }

  return Object.keys(AGENTS).filter((agentId) => detectAgent(agentId, scope, options));
}

function getScope(flags) {
  return flags.global ? 'global' : 'local';
}

export async function runInit(parsed = parseArgs(), runtimeOptions = {}) {
  const { flags, targetAgent } = parsed;
  const scope = getScope(flags);
  const isGlobal = scope === 'global';
  const force = flags.force;
  const cwd = runtimeOptions.cwd ?? process.cwd();
  const home = runtimeOptions.home ?? homedir();
  const interactive = runtimeOptions.interactive ?? isInteractive();
  const prompt = runtimeOptions.prompt ?? promptText;
  const promptConfirm = runtimeOptions.promptConfirm ?? promptYesNo;
  
  // Self location
  const selfPath = join(cwd, 'skills', SKILL_NAME);
  
  // If published (installed via npm), look in node_modules
  if (!existsSync(selfPath)) {
    const nodeModulesPath = join(cwd, 'node_modules', ...PACKAGE_NAME.split('/'), 'skills', SKILL_NAME);
    if (existsSync(nodeModulesPath)) {
      // Use installed version
    }
  }

  log(`Initializing ${PACKAGE_NAME} v${PKG_VERSION}...\n`);
  
  // Setup global projects dir
  setupGlobalProjects();
  
  if (targetAgent && !AGENTS[targetAgent]) {
    warn(`Unknown agent: ${targetAgent}`);
    return { detectedAgents: [], installed: 0, skipped: 0, scope, didUpdateDocs: false };
  }

  const detectedAgents = resolveDetectedAgents({ targetAgent, scope, options: { cwd, home } });
  let selectedAgents = detectedAgents;

  if (!isGlobal && !targetAgent && interactive) {
    const choice = await chooseProjectAgents({
      prompt,
      logger: log,
      detectedAgentIds: detectedAgents,
      orderedAgentIds: listAgentIds(),
    });

    if (choice.cancelled) {
      return { detectedAgents, selectedAgents: [], installed: 0, skipped: 0, scope, didUpdateDocs: false };
    }

    selectedAgents = choice.selectedAgentIds;
  } else if (!isGlobal && !targetAgent && !interactive) {
    log('Interactive agent selection skipped because no TTY is available. Using detected local agents.');
  }
  
  if (selectedAgents.length === 0) {
    log('No supported AI agents detected.');
    log(`\nSupported: ${Object.keys(AGENTS).join(', ')}`);
    log(`\nManual install: npx -y ${PACKAGE_NAME} init -a <agent-name>`);
  } else {
    if (!isGlobal && !targetAgent && interactive) {
      log(`Selected: ${selectedAgents.map(a => AGENTS[a].name).join(', ')}\n`);
    } else {
      log(`Detected: ${selectedAgents.map(a => AGENTS[a].name).join(', ')}\n`);
    }
  }

  let installed = 0;
  let updated = 0;
  let current = 0;
  let skipped = 0;
  let skillResults = [];

  if (selectedAgents.length > 0) {
    const packagedSkill = getPackagedSkillMetadata({ cwd });
    const skillStatuses = getSkillInstallationStatuses(selectedAgents, scope, {
      cwd,
      home,
      packagedSkillHash: packagedSkill.hash,
    });
    const { missing, current: currentStatuses, outdated, invalid } = summarizeSkillStatuses(skillStatuses);
    const staleStatuses = [...outdated, ...invalid];
    let updateStatuses = [];

    if (force) {
      updateStatuses = staleStatuses;
    } else if (interactive && staleStatuses.length > 0) {
      const staleAgentNames = staleStatuses.map((status) => AGENTS[status.agentId]?.name ?? status.agentId).join(', ');
      const shouldUpdate = await promptConfirm(`Update installed ragi skill for ${staleAgentNames}? (y/N) `, false);
      if (shouldUpdate) {
        updateStatuses = staleStatuses;
      }
    } else if (!interactive && staleStatuses.length > 0) {
      log(`Skill updates available for ${staleStatuses.map((status) => AGENTS[status.agentId]?.name ?? status.agentId).join(', ')}. Re-run with --force to overwrite.`);
    }

    if (missing.length > 0 || updateStatuses.length > 0) {
      log(`Installing to ${scope} skills...\n`);
    }

    const updateAgentIds = new Set(updateStatuses.map((status) => status.agentId));

    for (const agentId of selectedAgents) {
      const agent = AGENTS[agentId];
      const status = skillStatuses.find((entry) => entry.agentId === agentId);
      const targetSkillsDir = getTargetSkillsDir(agentId, scope, { cwd, home });

      process.stdout.write(`  ${agent.name}: `);

      if (status.status === 'current') {
        log('already up to date');
        current++;
        skillResults.push({ agentId, status: 'current' });
        continue;
      }

      if (status.status === 'missing' || updateAgentIds.has(agentId)) {
        const result = copySkill(packagedSkill.sourceDir, targetSkillsDir);
        if (result.success) {
          if (status.status === 'missing') {
            log('installed');
            installed++;
            skillResults.push({ agentId, status: 'installed' });
          } else {
            log('updated');
            updated++;
            skillResults.push({ agentId, status: 'updated' });
          }
        } else {
          log(`failed (${result.reason})`);
          skipped++;
          skillResults.push({ agentId, status: 'failed', reason: result.reason });
        }
        continue;
      }

      if (status.status === 'outdated') {
        log(force ? 'updated' : 'skipped (update available, use --force or confirm prompt)');
        skipped++;
        skillResults.push({ agentId, status: 'skipped', reason: 'outdated' });
        continue;
      }

      if (status.status === 'invalid') {
        log(force ? 'updated' : `skipped (installed skill is unreadable${status.reason ? `: ${status.reason}` : ''})`);
        skipped++;
        skillResults.push({ agentId, status: 'skipped', reason: 'invalid' });
        continue;
      }
    }

    if (currentStatuses.length > 0 && missing.length === 0 && updateStatuses.length === 0) {
      log('All selected skills are already up to date.');
    }
  }

  log(`\nDone: ${installed} installed, ${updated} updated, ${current} current, ${skipped} skipped`);
  log(`\nRegister ragi with your MCP host using:`);
  log(`  { "mcpServers": { "ragi": { "command": "npx", "args": ["-y", "${PACKAGE_NAME}"] } } }`);
  printExistingProjectOverrideNotes(selectedAgents, cwd, log);

  let mcpResults = [];
  if (selectedAgents.length > 0) {
    const mcpStatuses = getMcpRegistrationStatuses(selectedAgents, scope, { cwd, home });
    const { actionable, unknown } = summarizeMcpStatuses(mcpStatuses, log);
    const needsAttention = [...actionable, ...unknown];

    if (needsAttention.length === 0) {
      log('All selected agents already have ragi MCP registered.');
      mcpResults = mcpStatuses;
    } else if (interactive) {
      const shouldConfigureMcp = await promptConfirm('Register `ragi` as an MCP server for the selected agent(s) that still need setup? (Y/n) ', true);
      if (shouldConfigureMcp) {
        const actionableAgentIds = actionable.map((status) => status.agentId);
        const unknownAgentIds = unknown.map((status) => status.agentId);
        const configuredResults = actionableAgentIds.length > 0
          ? configureMcpForAgents(actionableAgentIds, scope, { cwd, home, logger: log })
          : [];
        for (const agentId of unknownAgentIds) {
          printManualMcpInstructions(agentId, scope, { cwd, home, logger: log });
        }
        mcpResults = [...mcpStatuses.filter((status) => status.status === 'configured'), ...configuredResults, ...unknown];
      } else {
        for (const agentId of needsAttention.map((status) => status.agentId)) {
          printManualMcpInstructions(agentId, scope, { cwd, home, logger: log });
        }
        mcpResults = mcpStatuses;
      }
    } else {
      log('Interactive MCP setup skipped because no TTY is available.');
      for (const agentId of needsAttention.map((status) => status.agentId)) {
        printManualMcpInstructions(agentId, scope, { cwd, home, logger: log });
      }
      mcpResults = mcpStatuses;
    }
  }

  if (isGlobal) {
    log('\nGlobal install does not edit project docs. Re-run without `--global` in a project to update `AGENTS.md`/`CLAUDE.md`.');
    const globalConfigResult = await maybeScaffoldGlobalConfig({ home, interactive, prompt: promptConfirm, logger: log });
    return { detectedAgents, selectedAgents, installed, updated, current, skipped, skillResults, scope, didUpdateDocs: false, globalConfigResult, mcpResults };
  }

  const globalConfigResult = await maybeScaffoldGlobalConfig({ home, interactive, prompt: promptConfirm, logger: log });

  if (flags.noDocs) {
    return { detectedAgents, selectedAgents, installed, updated, current, skipped, skillResults, scope, didUpdateDocs: false, globalConfigResult, mcpResults };
  }

  await updateDocsInCwd();
  return { detectedAgents, selectedAgents, installed, updated, current, skipped, skillResults, scope, didUpdateDocs: true, globalConfigResult, mcpResults };
}

function showHelp() {
  log(`${BIN_NAME} v${PKG_VERSION} - Skill installer
  
Usage:
  npx -y ${PACKAGE_NAME} init              Detect and install
  npx -y ${PACKAGE_NAME} init --local     Install to project only
  npx -y ${PACKAGE_NAME} init --global   Install globally
  npx -y ${PACKAGE_NAME} init -a=<agent> Install to specific agent
  npx -y ${PACKAGE_NAME} init --check    Check installations
  npx -y ${PACKAGE_NAME} init --no-docs  Skip updating AGENTS.md/CLAUDE.md
  npx -y ${PACKAGE_NAME} init --force   Overwrite outdated installed skills
  npx -y ${PACKAGE_NAME} init --help     Show this help
  
Examples:
  npx -y ${PACKAGE_NAME} init
  npx -y ${PACKAGE_NAME} init -a=opencode
  npx -y ${PACKAGE_NAME} init --global
  npx -y ${PACKAGE_NAME} init --check
  npx -y ${PACKAGE_NAME} init --no-docs

Init can also register ragi with the selected agent host(s).
Init checks MCP registration status first and only prompts for agents that still need setup.
MCP registration is global by default; repo-local MCP config is treated as an advanced override.
Unsupported agents receive manual MCP registration instructions instead of automatic file edits.
Init also checks ~/.config/ragi/config.json and can scaffold it when missing or invalid.
.ragrc remains an optional project override for repo-specific runtime settings.
Recommended embedding models: ollama -> nomic-embed-text, transformers_js -> Xenova/all-MiniLM-L6-v2, llama_cpp -> an embedding-capable model served by your llama.cpp instance.
  
Supported agents:
${Object.entries(AGENTS).map(([id, a]) => `  ${id.padEnd(12)} ${a.name}`).join('\n')}`);
}

export async function main(parsed = parseArgs()) {
  if (parsed.flags.help) {
    showHelp();
    return 0;
  }

  if (parsed.flags.check) {
    checkUpgrades();
    return 0;
  }

  await runInit(parsed);
  return 0;
}

// Run
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
  });
}
