#!/usr/bin/env node

import { homedir } from 'node:os';
import { parseArgs, resolveDetectedAgents, configureMcpForAgent, getMcpRegistrationStatus, getMcpFollowUpInstructions } from './init.mjs';

function log(message = '') {
  process.stdout.write(`${message}\n`);
}

function getScope(flags) {
  return flags.global ? 'global' : 'local';
}

async function main(argv = process.argv.slice(2)) {
  const parsed = parseArgs(argv);
  const scope = getScope(parsed.flags);
  const cwd = process.cwd();
  const home = homedir();
  const selectedAgents = resolveDetectedAgents({
    targetAgent: parsed.targetAgent,
    scope,
    options: { cwd, home },
  });

  if (selectedAgents.length === 0) {
    log('No supported AI agents detected for MCP update.');
    log('Re-run with `-a=<agent-name>` to target a specific host.');
    return 1;
  }

  log(`Refreshing ragi MCP definitions for: ${selectedAgents.join(', ')}`);
  for (const agentId of selectedAgents) {
    const status = getMcpRegistrationStatus(agentId, scope, { cwd, home });
    if (status.status === 'configured' || status.status === 'missing' || status.status === 'invalid' || status.status === 'unknown') {
      configureMcpForAgent(agentId, scope, { cwd, home, logger: log });
      const followUp = getMcpFollowUpInstructions(agentId, scope, { cwd, home });
      if (followUp.command) {
        log(`  ${agentId}: run ${followUp.command}`);
      }
    }
  }

  return 0;
}

main().then((code) => {
  process.exitCode = code;
}).catch((err) => {
  process.stderr.write(`Error: ${err.message}\n`);
  process.exitCode = 1;
});
