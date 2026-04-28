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

const commands = {
  start: async () => {
    const serverPath = join(__dirname, '../src/mcp/server.ts');
    const proc = spawn('bun', [serverPath], {
      stdio: 'inherit',
      env: process.env
    });
    proc.on('exit', (code) => process.exit(code || 0));
    proc.on('error', (err) => {
      console.error(`Failed to start: ${err.message}`);
      process.exit(1);
    });
  },
  
  init: async () => {
    const initPath = join(__dirname, '../scripts/init.mjs');
    if (!existsSync(initPath)) {
      console.error('Init script not found. Run: bun install');
      process.exit(1);
    }
    const proc = spawn('bun', [initPath, ...args.slice(1)], {
      stdio: 'inherit',
      env: process.env
    });
    proc.on('exit', (code) => process.exit(code || 0));
    proc.on('error', (err) => {
      console.error(`Failed to run init: ${err.message}`);
      process.exit(1);
    });
  },
  
  check: async () => {
    const initPath = join(__dirname, '../scripts/init.mjs');
    if (!existsSync(initPath)) {
      console.error('Init script not found. Run: bun install');
      process.exit(1);
    }
    const proc = spawn('bun', [initPath, '--check'], {
      stdio: 'inherit',
      env: process.env
    });
    proc.on('exit', (code) => process.exit(code || 0));
    proc.on('error', (err) => {
      console.error(`Failed to run check: ${err.message}`);
      process.exit(1);
    });
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