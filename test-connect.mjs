#!/usr/bin/env node

import { WebSocket } from 'ws';

console.log('[Claude1] Connecting to MCP server at ws://localhost:8765...');

const ws = new WebSocket('ws://localhost:8765');

ws.on('open', () => {
  console.log('[Claude1] Connected to MCP server');

  // Connect to Minecraft
  const connectReq = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'minecraft_connect',
      arguments: {
        host: 'localhost',
        port: 25565,
        username: 'Claude1',
        agentType: 'game'
      }
    }
  };

  console.log('[Claude1] Sending connect request...');
  ws.send(JSON.stringify(connectReq));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  console.log('[Response]', JSON.stringify(msg, null, 2));

  if (msg.id === 1 && !msg.error) {
    console.log('[Claude1] Connected to Minecraft! Checking status...');

    // Connected! Now check status
    const statusReq = {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'minecraft_get_status',
        arguments: {}
      }
    };
    ws.send(JSON.stringify(statusReq));
  } else if (msg.id === 2 && !msg.error) {
    console.log('[Claude1] Status received. Playing for 5 minutes...');

    // Schedule exit after 5 minutes
    setTimeout(() => {
      console.log('[Claude1] 5 minutes complete. Exiting...');
      ws.send(JSON.stringify({
        jsonrpc: '2.0',
        id: 99,
        method: 'tools/call',
        params: {
          name: 'minecraft_disconnect',
          arguments: {}
        }
      }));
      setTimeout(() => process.exit(0), 1000);
    }, 5 * 60 * 1000);
  }
});

ws.on('error', (err) => {
  console.error('[Error]', err.message);
  process.exit(1);
});

ws.on('close', () => {
  console.log('[Claude1] Connection closed');
  process.exit(0);
});
