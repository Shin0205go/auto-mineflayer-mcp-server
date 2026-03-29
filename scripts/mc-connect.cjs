#!/usr/bin/env node
'use strict';
/**
 * mc-connect CLI - ボットをMinecraftサーバーに接続する
 * Usage: node scripts/mc-connect.cjs [host] [port] [username]
 *        node scripts/mc-connect.cjs localhost 25565 Claude1
 *        node scripts/mc-connect.cjs disconnect
 */
const http = require('http');

const args = process.argv.slice(2);
const daemonPort = parseInt(process.env.VIEWER_PORT || '3099');

let payload;
if (args[0] === 'disconnect') {
  payload = { action: 'disconnect' };
} else {
  payload = {
    action: 'connect',
    host: args[0] || 'localhost',
    port: parseInt(args[1] || '25565'),
    username: args[2] || 'Claude1',
  };
}

const body = JSON.stringify(payload);

const req = http.request(
  {
    hostname: 'localhost',
    port: daemonPort,
    path: '/api/connect',
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
