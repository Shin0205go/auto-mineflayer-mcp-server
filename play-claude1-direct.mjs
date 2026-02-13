#!/usr/bin/env node

import { WebSocket } from 'ws';

console.log('[Claude1] Starting survival gameplay (direct control)...');

const ws = new WebSocket('ws://localhost:8765');
let requestId = 1;
let connected = false;
let gameStartTime = null;

function sendRequest(toolName, args = {}) {
  return new Promise((resolve, reject) => {
    const id = requestId++;
    const req = {
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: args
      }
    };

    const handler = (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id === id) {
        ws.removeListener('message', handler);
        if (msg.error) {
          reject(new Error(msg.error.message));
        } else {
          resolve(msg.result?.content?.[0]?.text || JSON.stringify(msg.result));
        }
      }
    };

    ws.on('message', handler);
    ws.send(JSON.stringify(req));

    // Timeout after 10 seconds
    setTimeout(() => {
      ws.removeListener('message', handler);
      reject(new Error(`Timeout waiting for ${toolName}`));
    }, 10000);
  });
}

ws.on('open', async () => {
  try {
    console.log('[Claude1] Connected to MCP server');

    // Connect to Minecraft
    console.log('[Claude1] Connecting to Minecraft...');
    const connectResult = await sendRequest('minecraft_connect', {
      host: 'localhost',
      port: 25565,
      username: 'Claude1Direct',
      agentType: 'game'
    });
    console.log('[Connect]', connectResult);

    // Start gameplay
    gameStartTime = Date.now();
    await playLoop();

  } catch (err) {
    console.error('[Error]', err.message);
    process.exit(1);
  }
});

async function playLoop() {
  try {
    const elapsed = Date.now() - gameStartTime;

    // Exit after 5 minutes
    if (elapsed > 5 * 60 * 1000) {
      console.log('[Claude1] 5 minutes complete. Disconnecting...');
      await sendRequest('minecraft_disconnect');
      process.exit(0);
      return;
    }

    // Check status
    const status = await sendRequest('minecraft_get_status');
    console.log('[Status]', status);

    // Check surroundings
    const surroundings = await sendRequest('minecraft_get_surroundings');
    console.log('[Surroundings]', surroundings.substring(0, 200));

    // Check inventory
    const inventory = await sendRequest('minecraft_get_inventory');
    console.log('[Inventory]', inventory.substring(0, 100));

    // Wait 10 seconds before next loop
    await new Promise(resolve => setTimeout(resolve, 10000));

    // Schedule next loop
    await playLoop();

  } catch (err) {
    console.error('[Loop Error]', err.message);
    // Retry after 5 seconds
    setTimeout(() => playLoop(), 5000);
  }
}

ws.on('error', (err) => {
  console.error('[WS Error]', err.message);
  process.exit(1);
});

ws.on('close', () => {
  console.log('[Claude1] Connection closed');
  process.exit(0);
});
