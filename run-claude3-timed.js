#!/usr/bin/env node

/**
 * Temporary script to run Claude3 agent with 5-minute timeout
 */

import { spawn } from 'child_process';

const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

const agent = spawn('node', ['dist/agent/claude-agent.js'], {
  stdio: 'inherit',
  env: { ...process.env, BOT_USERNAME: 'Claude3' }
});

const timer = setTimeout(() => {
  console.log('\n[Timeout] 5 minutes elapsed, stopping agent...');
  agent.kill('SIGINT');
}, TIMEOUT_MS);

agent.on('exit', (code) => {
  clearTimeout(timer);
  console.log(`\n[Exit] Agent exited with code ${code}`);
  process.exit(code || 0);
});

process.on('SIGINT', () => {
  clearTimeout(timer);
  agent.kill('SIGINT');
});
