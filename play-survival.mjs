#!/usr/bin/env node

import { WebSocket } from 'ws';

console.log('[Claude1] Starting survival gameplay...');

const ws = new WebSocket('ws://localhost:8765');
let requestId = 1;
let connected = false;
let gameStartTime = null;

function sendRequest(toolName, args = {}) {
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
  console.log(`[${toolName}] Sending...`);
  ws.send(JSON.stringify(req));
  return id;
}

ws.on('open', () => {
  console.log('[Claude1] Connected to MCP server');
  sendRequest('minecraft_connect', {
    host: 'localhost',
    port: 25565,
    username: 'Claude1',
    agentType: 'game'
  });
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());

  // Skip server/ready messages
  if (msg.method === 'server/ready' || msg.method === 'notifications/gameEvent') {
    if (msg.method === 'notifications/gameEvent') {
      console.log(`[Event] ${msg.params.event.type}: ${msg.params.event.message}`);
    }
    return;
  }

  if (msg.error) {
    console.error(`[Error] ${msg.error.message}`);
    return;
  }

  const result = msg.result?.content?.[0]?.text || JSON.stringify(msg.result);
  console.log(`[Response ${msg.id}] ${result.substring(0, 200)}`);

  // After connect, start gameplay loop
  if (msg.id === 1 && !connected) {
    connected = true;
    gameStartTime = Date.now();
    console.log('[Claude1] Connected! Starting gameplay...');

    // Start gameplay loop
    setTimeout(() => playLoop(), 1000);
  }
});

async function playLoop() {
  const elapsed = Date.now() - gameStartTime;

  // Exit after 5 minutes
  if (elapsed > 5 * 60 * 1000) {
    console.log('[Claude1] 5 minutes complete. Disconnecting...');
    sendRequest('minecraft_disconnect');
    setTimeout(() => process.exit(0), 2000);
    return;
  }

  try {
    // Check status
    sendRequest('minecraft_get_status');
    await sleep(1000);

    // Check surroundings
    sendRequest('minecraft_get_surroundings');
    await sleep(1000);

    // Check inventory
    sendRequest('minecraft_get_inventory');
    await sleep(1000);

    // Try to gather some wood (if we can find trees)
    console.log('[Claude1] Looking for oak_log...');
    sendRequest('minecraft_find_block', { blockType: 'oak_log', maxDistance: 32 });
    await sleep(2000);

    // Try to collect nearby items
    sendRequest('minecraft_collect_items');
    await sleep(1000);

    // Check hunger and eat if needed
    const statusCheck = sendRequest('minecraft_get_status');
    await sleep(1000);

    // Wait before next loop
    await sleep(5000);
  } catch (err) {
    console.error('[Loop Error]', err);
  }

  // Schedule next loop
  setTimeout(() => playLoop(), 1000);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

ws.on('error', (err) => {
  console.error('[WS Error]', err.message);
});

ws.on('close', () => {
  console.log('[Claude1] Connection closed');
  process.exit(0);
});
