import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildGlobalConfigFromPreset,
  buildRagiInstructionBlock,
  chooseProjectAgents,
  configureMcpForAgent,
  formatWizardPlan,
  getInteractiveAgentGroups,
  getInteractiveMcpGroups,
  getMcpFollowUpInstructions,
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

function createWizardStub(overrides = {}) {
  return {
    pickAgents: async ({ detectedAgentIds }) => ({
      cancelled: false,
      selectedAgentIds: detectedAgentIds,
    }),
    pickSkillActions: async ({ skillStatuses }) => Object.fromEntries(skillStatuses.map((status) => {
      if (status.status === 'missing') return [status.agentId, 'install'];
      if (status.status === 'outdated' || status.status === 'invalid') return [status.agentId, 'update'];
      return [status.agentId, 'current'];
    })),
    pickMcpActions: async ({ mcpStatuses }) => Object.fromEntries(mcpStatuses.map((status) => {
      if (status.status === 'configured') return [status.agentId, 'configured'];
      if (status.status === 'unknown') return [status.agentId, 'manual'];
      return [status.agentId, 'configure'];
    })),
    pickDocActions: async ({ docStatuses }) => Object.fromEntries(docStatuses.map((status) => {
      if (status.status === 'missing') return [status.fileName, 'create'];
      if (status.status === 'outdated') return [status.fileName, 'update'];
      return [status.fileName, 'unchanged'];
    })),
    pickGlobalConfig: async ({ globalConfigStatus, currentPreset = 'transformers_js', currentModel = '' }) => (
      globalConfigStatus.valid
        ? { action: 'unchanged', preset: currentPreset, model: currentModel }
        : { action: globalConfigStatus.exists ? 'replace' : 'skip', preset: currentPreset, model: currentModel }
    ),
    reviewPlan: async () => ({ decision: 'apply' }),
    ...overrides,
  };
}

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

async function testUpsertGooseYamlMcpConfig() {
  const updated = upsertMcpConfigFile('extensions:\n  existing:\n    cmd: node\n', {
    kind: 'yaml',
    snippetKind: 'goose-yaml',
  });

  assert.ok(updated.includes('extensions:'));
  assert.ok(updated.includes('  ragi:'));
  assert.ok(updated.includes('    args: [-y, @susutawar/ragi@latest]'));
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

async function testInteractiveAgentGroupsCollapseSharedAgentsDirectory() {
  const groups = getInteractiveAgentGroups({
    orderedAgentIds: ['opencode', 'claude-code', 'cursor', 'goose', 'cline', 'codex'],
  });

  assert.equal(groups[0].id, 'shared-agents-skills');
  assert.deepEqual(groups[0].agentIds, ['opencode', 'cursor', 'cline', 'codex']);
  assert.ok(groups[0].label.includes('.agents/skills'));
  assert.deepEqual(groups.slice(1).map((group) => group.id), ['claude-code', 'goose']);
}

async function testInteractiveMcpGroupsCollapseSharedTarget() {
  const groups = getInteractiveMcpGroups([
    {
      agentId: 'cursor',
      status: 'missing',
      target: { kind: 'json' },
      targetPaths: ['C:\\fake-home\\.cursor\\mcp.json'],
    },
    {
      agentId: 'cline',
      status: 'missing',
      target: { kind: 'json' },
      targetPaths: ['C:\\fake-home\\.cursor\\mcp.json'],
    },
    {
      agentId: 'roo',
      status: 'unknown',
      target: { kind: 'manual' },
      targetPaths: ['Roo Code MCP settings (see Roo Code docs / extension UI)'],
      reason: 'manual-only',
    },
  ]);

  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].agentIds, ['cursor', 'cline']);
  assert.ok(groups[0].label.includes('configure automatically'));
  assert.ok(groups[1].label.includes('show manual instructions'));
}

async function testMcpFollowUpInstructions() {
  const claude = getMcpFollowUpInstructions('claude-code', 'local');
  assert.ok(claude.command?.includes('claude mcp add'));

  const goose = getMcpFollowUpInstructions('goose', 'global');
  assert.equal(goose.command, null);
  assert.ok(goose.note?.includes('Restart Goose'));

  const cursor = getMcpFollowUpInstructions('cursor', 'local');
  assert.ok(cursor.note?.includes('Restart Cursor'));
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

    const gooseGlobal = configureMcpForAgent('goose', 'global', {
      cwd: tempDir,
      home: fakeHome,
      logger: () => {},
    });
    assert.equal(gooseGlobal.status, 'configured');
    assert.ok(existsSync(join(fakeHome, '.config', 'goose', 'config.yaml')));
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

    const gooseMissing = getMcpRegistrationStatus('goose', 'global', {
      cwd: tempDir,
      home: fakeHome,
    });
    assert.equal(gooseMissing.status, 'missing');

    configureMcpForAgent('goose', 'global', {
      cwd: tempDir,
      home: fakeHome,
      logger: () => {},
    });
    const gooseConfigured = getMcpRegistrationStatus('goose', 'global', {
      cwd: tempDir,
      home: fakeHome,
    });
    assert.equal(gooseConfigured.status, 'configured');
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
      wizard: createWizardStub(),
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
      wizard: createWizardStub(),
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
    assert.ok(logs.some((line) => line.includes('skipped (invalid)')));
  });
}

async function testLocalInteractiveInitChoosesMultipleAgents() {
  await withTempDir(async (tempDir) => {
    const fakeHome = join(tempDir, 'home');
    const parsed = parseArgs([]);
    const { result, logs } = await captureConsole(() => runInit(parsed, {
      interactive: true,
      wizard: createWizardStub({
        pickAgents: async () => ({ cancelled: false, selectedAgentIds: ['opencode', 'cursor'] }),
        pickGlobalConfig: async () => ({ action: 'skip', preset: 'transformers_js', model: '' }),
      }),
      home: fakeHome,
    }));

    assert.equal(result.scope, 'local');
    assert.deepEqual(result.selectedAgents, ['opencode', 'cursor']);
    assert.equal(result.didUpdateDocs, true);
    assert.equal(result.globalConfigResult.action, 'skipped');
    assert.ok(logs.some((line) => line.includes('Selected: OpenCode, Cursor')));
    assert.ok(existsSync(join(fakeHome, '.config', 'opencode', 'opencode.json')));
    assert.ok(existsSync(join(fakeHome, '.cursor', 'mcp.json')));
  });
}

async function testLocalInteractiveInitUsesDetectedDefaults() {
  await withTempDir(async (tempDir) => {
    const fakeHome = join(tempDir, 'home');
    mkdirSync(join(process.cwd(), '.agents', 'skills'), { recursive: true });
    const parsed = parseArgs([]);
    const { result } = await captureConsole(() => runInit(parsed, {
      interactive: true,
      wizard: createWizardStub({
        pickGlobalConfig: async () => ({ action: 'skip', preset: 'transformers_js', model: '' }),
      }),
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
    const { result } = await captureConsole(() => runInit(parsed, {
      interactive: true,
      wizard: createWizardStub({
        pickAgents: async () => ({ cancelled: true, selectedAgentIds: [] }),
      }),
      home: fakeHome,
    }));

    assert.equal(result.didUpdateDocs, false);
    assert.deepEqual(result.selectedAgents, []);
    assert.equal(result.globalConfigResult.action, 'cancelled');
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
    const { result, logs } = await captureConsole(() => runInit(parsed, {
      interactive: true,
      wizard: createWizardStub({
        pickAgents: async () => ({ cancelled: false, selectedAgentIds: ['opencode', 'cursor'] }),
        pickGlobalConfig: async () => ({ action: 'skip', preset: 'transformers_js', model: '' }),
      }),
      home: fakeHome,
    }));

    assert.deepEqual(result.selectedAgents, ['opencode', 'cursor']);
    assert.ok(existsSync(join(fakeHome, '.config', 'opencode', 'opencode.json')));
    assert.ok(existsSync(join(fakeHome, '.cursor', 'mcp.json')));
    assert.ok(!existsSync(join(tempDir, 'opencode.json')));
    assert.ok(!existsSync(join(tempDir, '.cursor', 'mcp.json')));
    assert.ok(logs.some((line) => line.includes('Restart OpenCode')));
    assert.ok(logs.some((line) => line.includes('Restart Cursor')));
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
      wizard: createWizardStub(),
      home: fakeHome,
    }));

    assert.equal(result.mcpResults[0].status, 'configured');
    assert.ok(logs.some((line) => line.includes('Selected: Cursor')));
  });
}

async function testInteractiveInitOnlyPrintsManualForUnknownMcpStatus() {
  await withTempDir(async (tempDir) => {
    const fakeHome = join(tempDir, 'home');
    const parsed = parseArgs([]);
    const { logs } = await captureConsole(() => runInit(parsed, {
      interactive: true,
      wizard: createWizardStub({
        pickAgents: async () => ({ cancelled: false, selectedAgentIds: ['claude-code', 'roo'] }),
        pickGlobalConfig: async () => ({ action: 'skip', preset: 'transformers_js', model: '' }),
      }),
      home: fakeHome,
    }));

    assert.ok(logs.some((line) => line.includes('Claude Code: configure MCP manually.')));
    assert.ok(logs.some((line) => line.includes('Roo Code: configure MCP manually.')));
  });
}

async function testInteractiveMcpDeclinePrintsInstructions() {
  await withTempDir(async (tempDir) => {
    const fakeHome = join(tempDir, 'home');
    const parsed = parseArgs(['-a=cursor', '--no-docs']);
    const { logs } = await captureConsole(() => runInit(parsed, {
      interactive: true,
      wizard: createWizardStub({
        pickMcpActions: async ({ mcpStatuses }) => Object.fromEntries(mcpStatuses.map((status) => [status.agentId, status.status === 'configured' ? 'configured' : 'skip'])),
      }),
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
      wizard: createWizardStub({
        pickGlobalConfig: async () => ({ action: 'skip', preset: 'transformers_js', model: '' }),
      }),
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
    const parsed = parseArgs(['-a=roo', '--no-docs']);
    const { logs } = await captureConsole(() => runInit(parsed, {
      interactive: true,
      wizard: createWizardStub(),
      home: fakeHome,
    }));

    assert.ok(logs.some((line) => line.includes('Roo Code: configure MCP manually.')));
    assert.ok(logs.some((line) => line.includes('Roo Code MCP settings')));
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
      wizard: createWizardStub({
        pickMcpActions: async ({ mcpStatuses }) => Object.fromEntries(mcpStatuses.map((status) => [status.agentId, 'skip'])),
      }),
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
      wizard: createWizardStub({
        pickAgents: async () => {
          throw new Error('pickAgents should not be called for explicit agent installs');
        },
      }),
      home: fakeHome,
    }));
    assert.ok(result.detectedAgents.includes('codex'));
    assert.deepEqual(result.selectedAgents, ['codex']);
    assert.ok(!logs.some((line) => line.includes('Choose which agents are used in this project:')));
  });
}

async function testUpdateMcpScriptExistsInPackageScripts() {
  const packageJson = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf-8'));
  assert.equal(packageJson.scripts['mcp:update'], 'node scripts/update-mcp.mjs');
}

async function testInteractiveReviewBackRevisitsConfigChoice() {
  await withTempDir(async (tempDir) => {
    const fakeHome = join(tempDir, 'home');
    const parsed = parseArgs(['-a=cursor', '--no-docs']);
    let reviewCalls = 0;

    const { result } = await captureConsole(() => runInit(parsed, {
      interactive: true,
      wizard: createWizardStub({
        pickGlobalConfig: async ({ currentPreset }) => (
          reviewCalls === 0
            ? { action: 'create', preset: 'ollama', model: '' }
            : { action: 'create', preset: 'transformers_js', model: currentPreset }
        ),
        reviewPlan: async ({ planText }) => {
          reviewCalls += 1;
          if (reviewCalls === 1) {
            assert.ok(planText.includes('ollama'));
            return { decision: 'back', section: 'config' };
          }
          assert.ok(planText.includes('transformers_js'));
          return { decision: 'apply' };
        },
      }),
      home: fakeHome,
    }));

    assert.equal(result.globalConfigResult.action, 'created');
    const written = JSON.parse(readFileSync(getGlobalConfigPath(fakeHome), 'utf-8'));
    assert.equal(written.embedding.provider, 'transformers_js');
  });
}

async function testInteractiveCancelBeforeApplyMakesNoChanges() {
  await withTempDir(async (tempDir) => {
    const fakeHome = join(tempDir, 'home');
    const parsed = parseArgs(['-a=cursor']);
    const { result } = await captureConsole(() => runInit(parsed, {
      interactive: true,
      wizard: createWizardStub({
        reviewPlan: async () => ({ decision: 'cancel' }),
      }),
      home: fakeHome,
    }));

    assert.equal(result.globalConfigResult.action, 'cancelled');
    assert.ok(!existsSync(join(fakeHome, '.cursor', 'mcp.json')));
    assert.ok(!existsSync(getGlobalConfigPath(fakeHome)));
    assert.ok(!existsSync(join(process.cwd(), 'AGENTS.md')));
  });
}

async function testInteractiveMixedSkillAndMcpActions() {
  await withTempDir(async (tempDir) => {
    const fakeHome = join(tempDir, 'home');
    mkdirSync(join(tempDir, '.agents', 'skills', 'ragi'), { recursive: true });
    writeFileSync(join(tempDir, '.agents', 'skills', 'ragi', 'SKILL.md'), 'old skill content\n');
    const parsed = parseArgs([]);

    const { result } = await captureConsole(() => runInit(parsed, {
      interactive: true,
      wizard: createWizardStub({
        pickAgents: async () => ({ cancelled: false, selectedAgentIds: ['opencode', 'cursor'] }),
        pickSkillActions: async () => ({ opencode: 'skip', cursor: 'install' }),
        pickMcpActions: async () => ({ opencode: 'skip', cursor: 'configure' }),
        pickGlobalConfig: async () => ({ action: 'skip', preset: 'transformers_js', model: '' }),
      }),
      home: fakeHome,
    }));

    assert.equal(result.installed, 1);
    assert.equal(result.skipped >= 1, true);
    assert.ok(existsSync(join(tempDir, '.agents', 'skills', 'ragi', 'SKILL.md')));
    assert.ok(existsSync(join(fakeHome, '.cursor', 'mcp.json')));
    assert.ok(!existsSync(join(fakeHome, '.config', 'opencode', 'opencode.json')));
  });
}

async function testProviderPresetScaffoldsChosenConfig() {
  const ollama = buildGlobalConfigFromPreset('ollama');
  assert.equal(ollama.embedding.provider, 'ollama');
  assert.equal(ollama.embedding.model, 'nomic-embed-text');

  const llamaCpp = buildGlobalConfigFromPreset('llama_cpp', { model: 'custom-embed-model' });
  assert.equal(llamaCpp.embedding.provider, 'llama_cpp');
  assert.equal(llamaCpp.embedding.model, 'custom-embed-model');
}

async function testFormatWizardPlanIncludesManualAndDocsSummary() {
  const text = formatWizardPlan({
    selectedAgents: ['cursor', 'goose'],
    skillPlan: [
      { agentId: 'cursor', action: 'install' },
      { agentId: 'goose', action: 'skip' },
    ],
    mcpPlan: [
      { agentId: 'cursor', action: 'configure' },
      { agentId: 'goose', action: 'manual' },
    ],
    docsPlan: [
      { fileName: 'AGENTS.md', action: 'create' },
    ],
    globalConfigPlan: {
      action: 'create',
      preset: 'transformers_js',
      model: '',
    },
  }, { scope: 'local', isGlobal: false, flags: {} });

  assert.ok(text.includes('Cursor -> install'));
  assert.ok(text.includes('Goose -> manual'));
  assert.ok(text.includes('AGENTS.md -> create'));
}

async function run() {
  await testUpsertMarkedBlock();
  await testUpsertJsonMcpConfig();
  await testUpsertTomlMcpConfig();
  await testUpsertGooseYamlMcpConfig();
  await testParseAgentSelection();
  await testChooseProjectAgentsMultipleSelection();
  await testChooseProjectAgentsUsesDetectedDefaults();
  await testInteractiveAgentGroupsCollapseSharedAgentsDirectory();
  await testInteractiveMcpGroupsCollapseSharedTarget();
  await testMcpFollowUpInstructions();
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
  await testUpdateMcpScriptExistsInPackageScripts();
  await testInteractiveReviewBackRevisitsConfigChoice();
  await testInteractiveCancelBeforeApplyMakesNoChanges();
  await testInteractiveMixedSkillAndMcpActions();
  await testProviderPresetScaffoldsChosenConfig();
  await testFormatWizardPlanIncludesManualAndDocsSummary();
}

try {
  await run();
  process.stdout.write('ok\n');
} catch (err) {
  process.stderr.write(`fail: ${String(err && err.stack ? err.stack : err)}\n`);
  process.exitCode = 1;
}
