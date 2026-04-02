#!/usr/bin/env node
'use strict';
/**
 * mc-execute CLI - ボットでJSコードを実行する
 * Usage: node scripts/mc-execute.cjs "await bot.status()"
 *        MC_TIMEOUT=60000 node scripts/mc-execute.cjs "await bot.gather('log', 10)"
 */
const http = require('http');

async function main() {
let code = process.argv.slice(2).join(' ');
if (!code && !process.stdin.isTTY) {
  // Allow piping code via stdin: echo "..." | node scripts/mc-execute.cjs
  const chunks = [];
  await new Promise(r => {
    process.stdin.on('data', d => chunks.push(d));
    process.stdin.on('end', r);
  });
  code = Buffer.concat(chunks).toString().trim();
}
if (!code) {
  console.error('Usage: node scripts/mc-execute.cjs "<code>"');
  process.exit(1);
}

const port = parseInt(process.env.VIEWER_PORT || '3099');
const timeout = parseInt(process.env.MC_TIMEOUT || '120000');
const username = process.env.BOT_USERNAME || undefined;
const body = JSON.stringify({ code, timeout, ...(username ? { username } : {}) });

const req = http.request(
  {
    hostname: 'localhost',
    port,
    path: '/api/execute',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
  },
  (res) => {
    let data = '';
    res.on('data', (chunk) => (data += chunk));
    res.on('end', () => {
      try {
        const obj = JSON.parse(data);
        if (obj.error) {
          console.error('Error:', obj.error);
          process.exit(1);
        }
        console.log(obj.result);
      } catch {
        console.log(data);
      }
    });
  }
);

req.on('error', (e) => {
  console.error('Daemon not running. Start with: npm run daemon');
  console.error(e.message);
  process.exit(1);
});

req.write(body);
req.end();
}
main().catch(e => { console.error(e.message); process.exit(1); });
