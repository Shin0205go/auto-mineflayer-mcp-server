#!/usr/bin/env node
/**
 * Claude Code launcher for PM2
 * Spawns Claude Code with proper MCP configuration
 */

import { spawn } from 'child_process';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');

const prompt = readFileSync(join(projectRoot, 'scripts/initial-prompt.txt'), 'utf-8');
const mcpConfig = join(projectRoot, 'scripts/claude-mcp-config.json');

console.error('[Launcher] Starting Claude Code...');
console.error('[Launcher] MCP Config:', mcpConfig);
console.error('[Launcher] Initial prompt length:', prompt.length);

// Start Claude in interactive mode with MCP
const claude = spawn('claude', [
  '--dangerously-skip-permissions',
  '--mcp-config', mcpConfig
], {
  stdio: ['pipe', 'inherit', 'inherit'],
  env: { ...process.env }
});

// Send the prompt via stdin after startup
setTimeout(() => {
  console.error('[Launcher] Sending initial prompt via stdin...');
  claude.stdin.write(prompt + '\n');
  // Send submit signal (Ctrl+D equivalent)
  claude.stdin.end();
}, 2000);

claude.on('error', (err) => {
  console.error('[Launcher] Failed to start Claude:', err);
  process.exit(1);
});

claude.on('exit', (code, signal) => {
  console.error(`[Launcher] Claude exited with code ${code}, signal ${signal}`);
  process.exit(code || 0);
});

// Forward signals
process.on('SIGTERM', () => claude.kill('SIGTERM'));
process.on('SIGINT', () => claude.kill('SIGINT'));
