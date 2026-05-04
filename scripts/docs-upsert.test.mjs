import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildRagiInstructionBlock,
  chooseProjectAgents,
  configureMcpForAgent,
  getGlobalConfigPath,
  getGlobalConfigStatus,
  getMcpRegistrationStatus,
  getSkillInstallationStatus,
  maybeScaffoldGlobalConfig,
  parseAgentSelection,
  parseArgs,
  resolveDetectedAgents,
  runInit,
  scaffoldGlobalConfig,
  upsertMcpConfigFile,
  upsertMarkedBlock,
} from './init.mjs';

const DOC_BLOCK_BEGIN = '<!-- RAGI:BEGIN -->';
const blockText = buildRagiInstructionBlock();
const REPO_ROOT = process.cwd();
const SOURCE_SKILL_CONTENT = readFileSync(join(REPO_ROOT, 'skills', 'ragi', 'SKILL.md'), 'utf-8');

function captureConsole(fn) {
  const logs = [];
  const warnings = [];
  const errors = [];
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;

  console.log = (message = '') => logs.push(String(message));
  console.warn = (message = '') => warnings.push(String(message));
  console.error = (message = '') => errors.push(String(message));

  return Promise.resolve()
    .then(fn)
    .then((result) => ({ result, logs, warnings, errors }))
    .finally(() => {
      console.log = originalLog;
      console.warn = originalWarn;
      console.error = originalError;
    });
}

function withTempDir(fn) {
  const tempDir = mkdtempSync(join(process.cwd(), 'tmp-ragi-test-'));
  const previousCwd = process.cwd();
  process.chdir(tempDir);

  return Promise.resolve()
    .then(() => fn(tempDir))
    .finally(() => {
      process.chdir(previousCwd);
      rmSync(tempDir, { recursive: true, force: true });
    });
}

async function testUpsertMarkedBlock() {
  const original = [
    '# Repo',
    '',
    DOC_BLOCK_BEGIN,
    'old content',
    '<!-- RAGI:END -->',
    '',
    'tail',
    '',
  ].join('\n');

  const updated = upsertMarkedBlock(original, blockText);
  assert.ok(updated.includes('Use ragi MCP tools'));
  assert.ok(!updated.includes('old content'));
  assert.equal(updated.split(DOC_BLOCK_BEGIN).length - 1, 1);

  const afterHeading = upsertMarkedBlock('# Repo\n\nhello\n', blockText);
  assert.ok(afterHeading.startsWith('# Repo\n\n'));
  assert.ok(afterHeading.includes(DOC_BLOCK_BEGIN));

  const noHeading = upsertMarkedBlock('hello\nworld\n', blockText);
  assert.ok(noHeading.startsWith(DOC_BLOCK_BEGIN));
}

async function testUpsertJsonMcpConfig() {
  const updated = upsertMcpConfigFile(JSON.stringify({
    mcpServers: {
      existing: {
        command: 'node',
        args: ['existing.js'],
      },
    },
  }, null, 2), {
    kind: 'json',
    rootKey: 'mcpServers',
    entryKind: 'stdio',
  });

  const parsed = JSON.parse(updated);
  assert.ok(parsed.mcpServers.existing);
  assert.deepEqual(parsed.mcpServers.ragi, {
    command: 'npx',
    args: ['-y', '@susutawar/ragi@latest'],
  });
}

async function testUpsertTomlMcpConfig() {
  const updated = upsertMcpConfigFile('[mcp_servers.playwright]\ncommand = "npx"\n', {
    kind: 'toml',
    snippetKind: 'codex-toml',
  });

  assert.ok(updated.includes('[mcp_servers.playwright]'));
  assert.ok(updated.includes('[mcp_servers.ragi]'));
  assert.ok(updated.includes('command = "npx"'));
  assert.ok(updated.includes('args = ["-y", "@susutawar/ragi@latest"]'));
}

async function testParseAgentSelection() {
  const parsed = parseAgentSelection('1, 3, 3,5', ['opencode', 'claude-code', 'cursor', 'roo', 'codex']);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.selectedAgentIds, ['opencode', 'cursor', 'codex']);

  const invalid = parseAgentSelection('0,2', ['opencode', 'codex']);
  assert.equal(invalid.ok, false);
}

async function testChooseProjectAgentsMultipleSelection() {
  const prompts = ['1,3'];
  const logs = [];
  const choice = await chooseProjectAgents({
    prompt: async () => prompts.shift() ?? '',
    logger: (message) => logs.push(String(message)),
    detectedAgentIds: ['codex'],
    orderedAgentIds: ['opencode', 'claude-code', 'codex'],
    agents: {
      'opencode': { name: 'OpenCode' },
      'claude-code': { name: 'Claude Code' },
      'codex': { name: 'Codex' },
    },
  });

  assert.deepEqual(choice.selectedAgentIds, ['opencode', 'codex']);
  assert.equal(choice.cancelled, false);
  assert.ok(logs.some((line) => line.includes('1. OpenCode')));
}

async function testChooseProjectAgentsUsesDetectedDefaults() {
  const choice = await chooseProjectAgents({
    prompt: async () => '',
    logger: () => {},
    detectedAgentIds: ['codex'],
    orderedAgentIds: ['opencode', 'codex'],
    agents: {
      'opencode': { name: 'OpenCode' },
      'codex': { name: 'Codex' },
    },
  });

  assert.deepEqual(choice.selectedAgentIds, ['codex']);
  assert.equal(choice.usedDetectedDefaults, true);
}

async function testConfigureMcpForAgentByScope() {
  await withTempDir(async (tempDir) => {
    const fakeHome = join(tempDir, 'home');

    const cursorLocal = configureMcpForAgent('cursor', 'local', {
      cwd: tempDir,
      home: fakeHome,
      logger: () => {},
    });
    assert.equal(cursorLocal.status, 'configured');
    assert.ok(existsSync(join(fakeHome, '.cursor', 'mcp.json')));
    assert.ok(!existsSync(join(tempDir, '.cursor', 'mcp.json')));

    const codexGlobal = configureMcpForAgent('codex', 'global', {
      cwd: tempDir,
      home: fakeHome,
      logger: () => {},
    });
    assert.equal(codexGlobal.status, 'configured');
    assert.ok(existsSync(join(fakeHome, '.codex', 'config.toml')));

    const gooseManual = configureMcpForAgent('goose', 'global', {
      cwd: tempDir,
      home: fakeHome,
      logger: () => {},
    });
    assert.equal(gooseManual.status, 'manual');
  });
}

async function testGetMcpRegistrationStatus() {
  await withTempDir(async (tempDir) => {
    const fakeHome = join(tempDir, 'home');

    const missing = getMcpRegistrationStatus('cursor', 'local', {
      cwd: tempDir,
      home: fakeHome,
    });
    assert.equal(missing.status, 'missing');

    configureMcpForAgent('cursor', 'local', {
      cwd: tempDir,
      home: fakeHome,
      logger: () => {},
    });
    const configured = getMcpRegistrationStatus('cursor', 'local', {
      cwd: tempDir,
      home: fakeHome,
    });
    assert.equal(configured.status, 'configured');

    const manual = getMcpRegistrationStatus('goose', 'global', {
      cwd: tempDir,
      home: fakeHome,
    });
    assert.equal(manual.status, 'unknown');
  });
}

async function testGlobalConfigStatusAndScaffold() {
  await withTempDir(async (tempDir) => {
    const fakeHome = join(tempDir, 'home');
    const missing = getGlobalConfigStatus({ home: fakeHome });
    assert.equal(missing.exists, false);
    assert.equal(missing.valid, false);

    const filePath = scaffoldGlobalConfig({ home: fakeHome });
    assert.equal(filePath, getGlobalConfigPath(fakeHome));

    const status = getGlobalConfigStatus({ home: fakeHome });
    assert.equal(status.exists, true);
    assert.equal(status.valid, true);
  });
}

async function testGetSkillInstallationStatus() {
  await withTempDir(async (tempDir) => {
    const fakeHome = join(tempDir, 'home');
    const currentTarget = join(tempDir, '.agents', 'skills', 'ragi');
    const packagedSkillHash = createHash('sha256').update(SOURCE_SKILL_CONTENT).digest('hex');
    mkdirSync(currentTarget, { recursive: true });
    writeFileSync(join(currentTarget, 'SKILL.md'), SOURCE_SKILL_CONTENT);

    const current = getSkillInstallationStatus('opencode', 'local', {
      cwd: tempDir,
      home: fakeHome,
      packagedSkillHash,
    });
    assert.equal(current.status, 'current');

    writeFileSync(join(currentTarget, 'SKILL.md'), `${SOURCE_SKILL_CONTENT}\nchanged\n`);
    const outdated = getSkillInstallationStatus('opencode', 'local', {
      cwd: tempDir,
      home: fakeHome,
      packagedSkillHash,
    });
    assert.equal(outdated.status, 'outdated');
  });
}

async function testMaybeScaffoldGlobalConfigSkipsValidFile() {
  await withTempDir(async (tempDir) => {
    const fakeHome = join(tempDir, 'home');
    scaffoldGlobalConfig({ home: fakeHome });
    const { result, logs } = await captureConsole(() => maybeScaffoldGlobalConfig({
      home: fakeHome,
      interactive: true,
      prompt: async () => {
        throw new Error('prompt should not be called for valid config');
      },
    }));

    assert.equal(result.action, 'unchanged');
    assert.equal(logs.length, 0);
  });
}

async function testMaybeScaffoldGlobalConfigCreatesMissingFile() {
  await withTempDir(async (tempDir) => {
    const fakeHome = join(tempDir, 'home');
    const { result } = await captureConsole(() => maybeScaffoldGlobalConfig({
      home: fakeHome,
      interactive: true,
      prompt: async () => true,
    }));

    assert.equal(result.action, 'created');
    assert.ok(existsSync(getGlobalConfigPath(fakeHome)));
  });
}

async function testMaybeScaffoldGlobalConfigPrintsWhenNonInteractive() {
  await withTempDir(async (tempDir) => {
    const fakeHome = join(tempDir, 'home');
    const { result, logs } = await captureConsole(() => maybeScaffoldGlobalConfig({
      home: fakeHome,
      interactive: false,
    }));

    assert.equal(result.action, 'printed');
    assert.ok(logs.some((line) => line.includes('Global ragi config not found')));
    assert.ok(!existsSync(getGlobalConfigPath(fakeHome)));
  });
}

async function testMaybeScaffoldGlobalConfigHandlesInvalidFile() {
  await withTempDir(async (tempDir) => {
    const fakeHome = join(tempDir, 'home');
    const configPath = getGlobalConfigPath(fakeHome);
    mkdirSync(join(fakeHome, '.config', 'ragi'), { recursive: true });
    writeFileSync(configPath, '{"embedding":{"provider":"nope"}}\n');

    const { result } = await captureConsole(() => maybeScaffoldGlobalConfig({
      home: fakeHome,
      interactive: true,
      prompt: async () => true,
    }));

    assert.equal(result.action, 'replaced');
    assert.equal(getGlobalConfigStatus({ home: fakeHome }).valid, true);
  });
}

async function testCurrentSkillIsSkippedAsUpToDate() {
  await withTempDir(async (tempDir) => {
    const fakeHome = join(tempDir, 'home');
    const targetDir = join(tempDir, '.agents', 'skills', 'ragi');
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(targetDir, 'SKILL.md'), SOURCE_SKILL_CONTENT);
    scaffoldGlobalConfig({ home: fakeHome });
    configureMcpForAgent('opencode', 'local', {
      cwd: tempDir,
      home: fakeHome,
      logger: () => {},
    });

    const parsed = parseArgs(['-a=opencode', '--no-docs']);
    const { result, logs } = await captureConsole(() => runInit(parsed, {
      interactive: true,
      promptConfirm: async () => {
        throw new Error('promptConfirm should not be called for current skills');
      },
      home: fakeHome,
    }));

    assert.equal(result.current, 1);
    assert.equal(result.installed, 0);
    assert.ok(logs.some((line) => line.includes('already up to date')));
  });
}

async function testOutdatedSkillPromptsAndUpdates() {
  await withTempDir(async (tempDir) => {
    const fakeHome = join(tempDir, 'home');
    const targetDir = join(tempDir, '.agents', 'skills', 'ragi');
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(targetDir, 'SKILL.md'), 'old skill content\n');
    scaffoldGlobalConfig({ home: fakeHome });

    const parsed = parseArgs(['-a=opencode', '--no-docs']);
    const { result, logs } = await captureConsole(() => runInit(parsed, {
      interactive: true,
      promptConfirm: async (question) => question.startsWith('Update installed ragi skill'),
      home: fakeHome,
    }));

    assert.equal(result.updated, 1);
    assert.equal(readFileSync(join(targetDir, 'SKILL.md'), 'utf-8'), SOURCE_SKILL_CONTENT);
    assert.ok(logs.some((line) => line.includes('updated')));
  });
}

async function testOutdatedSkillSkipsWithoutForceNonInteractive() {
  await withTempDir(async (tempDir) => {
    const fakeHome = join(tempDir, 'home');
    const targetDir = join(tempDir, '.agents', 'skills', 'ragi');
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(targetDir, 'SKILL.md'), 'old skill content\n');

    const parsed = parseArgs(['-a=opencode', '--no-docs']);
    const { result, logs } = await captureConsole(() => runInit(parsed, {
      interactive: false,
      home: fakeHome,
    }));

    assert.equal(result.updated, 0);
    assert.equal(result.skipped, 1);
    assert.ok(logs.some((line) => line.includes('Re-run with --force to overwrite.')));
    assert.equal(readFileSync(join(targetDir, 'SKILL.md'), 'utf-8'), 'old skill content\n');
  });
}

async function testForceOverwritesOutdatedSkill() {
  await withTempDir(async (tempDir) => {
    const fakeHome = join(tempDir, 'home');
    const targetDir = join(tempDir, '.agents', 'skills', 'ragi');
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(targetDir, 'SKILL.md'), 'old skill content\n');

    const parsed = parseArgs(['-a=opencode', '--no-docs', '--force']);
    const { result } = await captureConsole(() => runInit(parsed, {
      interactive: false,
      home: fakeHome,
    }));

    assert.equal(result.updated, 1);
    assert.equal(readFileSync(join(targetDir, 'SKILL.md'), 'utf-8'), SOURCE_SKILL_CONTENT);
  });
}

async function testInvalidSkillIsTreatedAsUpdateNeeded() {
  await withTempDir(async (tempDir) => {
    const fakeHome = join(tempDir, 'home');
    const targetDir = join(tempDir, '.agents', 'skills', 'ragi', 'SKILL.md');
    mkdirSync(targetDir, { recursive: true });

    const packagedSkillHash = createHash('sha256').update(SOURCE_SKILL_CONTENT).digest('hex');
    const status = getSkillInstallationStatus('opencode', 'local', {
      cwd: tempDir,
      home: fakeHome,
      packagedSkillHash,
    });

    assert.equal(status.status, 'invalid');

    const parsed = parseArgs(['-a=opencode', '--no-docs']);
    const { result, logs } = await captureConsole(() => runInit(parsed, {
      interactive: false,
      home: fakeHome,
    }));

    assert.equal(result.skipped, 1);
    assert.ok(logs.some((line) => line.includes('installed skill is unreadable')));
  });
}

async function testLocalInteractiveInitChoosesMultipleAgents() {
  await withTempDir(async (tempDir) => {
    const fakeHome = join(tempDir, 'home');
    const parsed = parseArgs([]);
    const prompts = ['1,3'];
    const { result, logs } = await captureConsole(() => runInit(parsed, {
      interactive: true,
      prompt: async () => prompts.shift() ?? '',
      promptConfirm: async () => false,
      home: fakeHome,
    }));

    assert.equal(result.scope, 'local');
    assert.deepEqual(result.selectedAgents, ['opencode', 'cursor']);
    assert.equal(result.didUpdateDocs, true);
    assert.equal(result.globalConfigResult.action, 'skipped');
    assert.ok(logs.some((line) => line.includes('Selected: OpenCode, Cursor')));
    assert.ok(logs.some((line) => line.includes('configure MCP manually')));
  });
}

async function testLocalInteractiveInitUsesDetectedDefaults() {
  await withTempDir(async (tempDir) => {
    const fakeHome = join(tempDir, 'home');
    mkdirSync(join(process.cwd(), '.agents', 'skills'), { recursive: true });
    const parsed = parseArgs([]);
    const { result } = await captureConsole(() => runInit(parsed, {
      interactive: true,
      prompt: async () => '',
      promptConfirm: async () => false,
      home: fakeHome,
    }));

    assert.equal(result.scope, 'local');
    assert.equal(result.didUpdateDocs, true);
    assert.deepEqual(result.selectedAgents, ['opencode', 'cursor', 'cline', 'codex']);
  });
}

async function testLocalInteractiveInitCancelsWithoutDefaults() {
  await withTempDir(async (tempDir) => {
    const fakeHome = join(tempDir, 'home');
    const parsed = parseArgs([]);
    const { result, logs } = await captureConsole(() => runInit(parsed, {
      interactive: true,
      prompt: async () => '',
      home: fakeHome,
    }));

    assert.equal(result.didUpdateDocs, false);
    assert.deepEqual(result.selectedAgents, []);
    assert.ok(logs.some((line) => line.includes('No detected default agents.')));
  });
}

async function testLocalNonInteractiveFallbackDetection() {
  await withTempDir(async (tempDir) => {
    const fakeHome = join(tempDir, 'home');
    mkdirSync(join(process.cwd(), '.agents', 'skills'), { recursive: true });
    const parsed = parseArgs([]);
    const { result, logs } = await captureConsole(() => runInit(parsed, { home: fakeHome }));

    assert.deepEqual(result.selectedAgents, ['opencode', 'cursor', 'cline', 'codex']);
    assert.ok(logs.some((line) => line.includes('Interactive agent selection skipped because no TTY is available.')));
    assert.equal(result.globalConfigResult.action, 'printed');
  });
}

async function testNoDocsSuppressesDocUpdates() {
  await withTempDir(async (tempDir) => {
    const fakeHome = join(tempDir, 'home');
    const parsed = parseArgs(['-a=codex', '--no-docs']);
    const { result, logs } = await captureConsole(() => runInit(parsed, { home: fakeHome }));

    assert.equal(result.didUpdateDocs, false);
    assert.ok(!logs.some((line) => line.includes('AGENTS.md not found.')));
    assert.ok(!existsSync(join(process.cwd(), 'AGENTS.md')));
  });
}

async function testGlobalInitAutodetectsGlobalAgentOnce() {
  const detected = resolveDetectedAgents({
    scope: 'global',
    options: {
      home: 'C:\\fake-home',
      exists: (filePath) => filePath === join('C:\\fake-home', '.codex', 'skills'),
    },
  });

  assert.deepEqual(detected, ['codex']);

  await withTempDir(async (tempDir) => {
    const fakeHome = join(tempDir, 'home');
    mkdirSync(join(fakeHome, '.codex', 'skills'), { recursive: true });
    const parsed = parseArgs(['--global', '--force']);
    const { result, logs } = await captureConsole(() => runInit(parsed, { home: fakeHome }));

    assert.equal(result.scope, 'global');
    assert.ok(!logs.some((line) => line.includes('Choose which agents are used in this project:')));
    assert.equal(logs.filter((line) => line.includes('Global install does not edit project docs.')).length, 1);
    assert.equal(result.globalConfigResult.action, 'printed');
  });
}

async function testInteractiveMcpAcceptConfiguresSupportedAgents() {
  await withTempDir(async (tempDir) => {
    const fakeHome = join(tempDir, 'home');
    const parsed = parseArgs([]);
    const prompts = ['1,3'];
    const { result } = await captureConsole(() => runInit(parsed, {
      interactive: true,
      prompt: async () => prompts.shift() ?? '',
      promptConfirm: async () => true,
      home: fakeHome,
    }));

    assert.deepEqual(result.selectedAgents, ['opencode', 'cursor']);
    assert.ok(existsSync(join(fakeHome, '.config', 'opencode', 'opencode.json')));
    assert.ok(existsSync(join(fakeHome, '.cursor', 'mcp.json')));
    assert.ok(!existsSync(join(tempDir, 'opencode.json')));
    assert.ok(!existsSync(join(tempDir, '.cursor', 'mcp.json')));
  });
}

async function testInteractiveInitSkipsMcpPromptWhenAlreadyConfigured() {
  await withTempDir(async (tempDir) => {
    const fakeHome = join(tempDir, 'home');
    configureMcpForAgent('cursor', 'local', {
      cwd: tempDir,
      home: fakeHome,
      logger: () => {},
    });
    scaffoldGlobalConfig({ home: fakeHome });

    const parsed = parseArgs(['-a=cursor', '--no-docs']);
    const { result, logs } = await captureConsole(() => runInit(parsed, {
      interactive: true,
      promptConfirm: async () => {
        throw new Error('promptConfirm should not be called when MCP is already configured');
      },
      home: fakeHome,
    }));

    assert.equal(result.mcpResults[0].status, 'configured');
    assert.ok(logs.some((line) => line.includes('MCP already registered for: Cursor')));
    assert.ok(logs.some((line) => line.includes('All selected agents already have ragi MCP registered.')));
  });
}

async function testInteractiveInitOnlyPrintsManualForUnknownMcpStatus() {
  await withTempDir(async (tempDir) => {
    const fakeHome = join(tempDir, 'home');
    const parsed = parseArgs([]);
    const prompts = ['2,6'];
    const { logs } = await captureConsole(() => runInit(parsed, {
      interactive: true,
      prompt: async () => prompts.shift() ?? '',
      promptConfirm: async () => false,
      home: fakeHome,
    }));

    assert.ok(logs.some((line) => line.includes('MCP status could not be verified automatically for: Claude Code, Goose')));
  });
}

async function testInteractiveMcpDeclinePrintsInstructions() {
  await withTempDir(async (tempDir) => {
    const fakeHome = join(tempDir, 'home');
    const parsed = parseArgs(['-a=cursor', '--no-docs']);
    const { logs } = await captureConsole(() => runInit(parsed, {
      interactive: true,
      promptConfirm: async () => false,
      home: fakeHome,
    }));

    assert.ok(logs.some((line) => line.includes('configure MCP manually')));
    assert.ok(logs.some((line) => line.includes('~/.cursor\\mcp.json') || line.includes('~/.cursor/mcp.json') || line.includes('.cursor\\mcp.json') || line.includes('.cursor/mcp.json')));
  });
}

async function testGlobalInitMcpPromptBypassesDocs() {
  await withTempDir(async (tempDir) => {
    const fakeHome = join(tempDir, 'home');
    const parsed = parseArgs(['--global', '-a=cursor']);
    const { result, logs } = await captureConsole(() => runInit(parsed, {
      interactive: true,
      promptConfirm: async () => false,
      home: fakeHome,
    }));

    assert.equal(result.scope, 'global');
    assert.equal(result.didUpdateDocs, false);
    assert.ok(logs.some((line) => line.includes('Global install does not edit project docs.')));
  });
}

async function testManualOnlyMcpAgentPrintsInstructions() {
  await withTempDir(async (tempDir) => {
    const fakeHome = join(tempDir, 'home');
    const parsed = parseArgs(['-a=goose', '--no-docs']);
    const { logs } = await captureConsole(() => runInit(parsed, {
      interactive: true,
      promptConfirm: async () => true,
      home: fakeHome,
    }));

    assert.ok(logs.some((line) => line.includes('Goose: configure MCP manually.')));
    assert.ok(logs.some((line) => line.includes('~/.config/goose/config.yaml')));
  });
}

async function testExistingProjectOverridesAreLeftUntouched() {
  await withTempDir(async (tempDir) => {
    const fakeHome = join(tempDir, 'home');
    mkdirSync(join(process.cwd(), '.cursor'), { recursive: true });
    writeFileSync(join(process.cwd(), '.cursor', 'mcp.json'), '{"mcpServers":{"localOnly":{}}}');
    const parsed = parseArgs(['-a=cursor', '--no-docs']);
    const { logs } = await captureConsole(() => runInit(parsed, {
      interactive: true,
      promptConfirm: async () => false,
      home: fakeHome,
    }));

    assert.ok(logs.some((line) => line.includes('Project-local MCP config files already exist')));
    assert.ok(logs.some((line) => line.includes('.cursor/mcp.json') || line.includes('.cursor\\mcp.json')));
  });
}

async function testExplicitAgentInstallsWithoutDetection() {
  await withTempDir(async (tempDir) => {
    const fakeHome = join(tempDir, 'home');
    const parsed = parseArgs(['-a=codex', '--force', '--no-docs']);
    const { result, logs } = await captureConsole(() => runInit(parsed, {
      interactive: true,
      prompt: async () => '1,2',
      promptConfirm: async () => false,
      home: fakeHome,
    }));
    assert.ok(result.detectedAgents.includes('codex'));
    assert.deepEqual(result.selectedAgents, ['codex']);
    assert.ok(!logs.some((line) => line.includes('Choose which agents are used in this project:')));
  });
}

async function run() {
  await testUpsertMarkedBlock();
  await testUpsertJsonMcpConfig();
  await testUpsertTomlMcpConfig();
  await testParseAgentSelection();
  await testChooseProjectAgentsMultipleSelection();
  await testChooseProjectAgentsUsesDetectedDefaults();
  await testConfigureMcpForAgentByScope();
  await testGetMcpRegistrationStatus();
  await testGlobalConfigStatusAndScaffold();
  await testMaybeScaffoldGlobalConfigSkipsValidFile();
  await testMaybeScaffoldGlobalConfigCreatesMissingFile();
  await testMaybeScaffoldGlobalConfigPrintsWhenNonInteractive();
  await testMaybeScaffoldGlobalConfigHandlesInvalidFile();
  await testGetSkillInstallationStatus();
  await testCurrentSkillIsSkippedAsUpToDate();
  await testOutdatedSkillPromptsAndUpdates();
  await testOutdatedSkillSkipsWithoutForceNonInteractive();
  await testForceOverwritesOutdatedSkill();
  await testInvalidSkillIsTreatedAsUpdateNeeded();
  await testLocalInteractiveInitChoosesMultipleAgents();
  await testLocalInteractiveInitUsesDetectedDefaults();
  await testLocalInteractiveInitCancelsWithoutDefaults();
  await testLocalNonInteractiveFallbackDetection();
  await testNoDocsSuppressesDocUpdates();
  await testGlobalInitAutodetectsGlobalAgentOnce();
  await testInteractiveMcpAcceptConfiguresSupportedAgents();
  await testInteractiveInitSkipsMcpPromptWhenAlreadyConfigured();
  await testInteractiveInitOnlyPrintsManualForUnknownMcpStatus();
  await testInteractiveMcpDeclinePrintsInstructions();
  await testGlobalInitMcpPromptBypassesDocs();
  await testManualOnlyMcpAgentPrintsInstructions();
  await testExistingProjectOverridesAreLeftUntouched();
  await testExplicitAgentInstallsWithoutDetection();
}

try {
  await run();
  process.stdout.write('ok\n');
} catch (err) {
  process.stderr.write(`fail: ${String(err && err.stack ? err.stack : err)}\n`);
  process.exitCode = 1;
}
