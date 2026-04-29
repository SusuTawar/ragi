#!/usr/bin/env node

/**
 * ragi CLI entry point
 * Routes commands to appropriate handlers
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);

const command = args[0] || 'start';
const nodeExecutable = process.execPath;

function runNodeScript(scriptPath, scriptArgs = [], errorLabel = "run command") {
  const proc = spawn(nodeExecutable, [scriptPath, ...scriptArgs], {
    stdio: 'inherit',
    env: process.env
  });
  proc.on('exit', (code) => process.exit(code || 0));
  proc.on('error', (err) => {
    console.error(`Failed to ${errorLabel}: ${err.message}`);
    process.exit(1);
  });
}

const commands = {
  start: async () => {
    const serverPath = join(__dirname, '../dist/mcp/server.js');
    if (!existsSync(serverPath)) {
      console.error('Built server not found. Run: npm run build');
      process.exit(1);
    }
    runNodeScript(serverPath, [], 'start');
  },
  
  init: async () => {
    const initPath = join(__dirname, '../scripts/init.mjs');
    if (!existsSync(initPath)) {
      console.error('Init script not found. Reinstall the package or run: npm install');
      process.exit(1);
    }
    runNodeScript(initPath, args.slice(1), 'run init');
  },
  
  check: async () => {
    const initPath = join(__dirname, '../scripts/init.mjs');
    if (!existsSync(initPath)) {
      console.error('Init script not found. Reinstall the package or run: npm install');
      process.exit(1);
    }
    runNodeScript(initPath, ['--check'], 'run check');
  },
  
  help: async () => {
    console.log(`ragi - Local RAG MCP server

Usage:
  ragi              Start MCP server
  ragi init         Initialize (local)
  ragi init -g      Initialize (global to all agents)
  ragi init -a <agent>  Initialize for specific agent
  ragi init --check Check for upgrades
  ragi help        Show this help`);
  }
};

if (commands[command]) {
  commands[command]().catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
} else if (command === '--help' || command === '-h') {
  commands.help();
} else {
  console.error(`Unknown command: ${command}`);
  console.error('Run "ragi help" for usage');
  process.exit(1);
}
