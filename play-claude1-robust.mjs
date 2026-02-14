#!/usr/bin/env node

import { WebSocket } from 'ws';

console.log('[Claude1] Starting robust survival gameplay...');

let ws = null;
let requestId = 1;
let gameStartTime = Date.now();
let reconnectAttempts = 0;
const MAX_RECONNECT = 10;

function connect() {
  return new Promise((resolve, reject) => {
    ws = new WebSocket('ws://localhost:8765');

    ws.on('open', () => {
      console.log('[Claude1] Connected to MCP server');
      reconnectAttempts = 0;
      resolve();
    });

    ws.on('error', (err) => {
      console.error('[WS Error]', err.message);
      reject(err);
    });

    ws.on('close', () => {
      console.log('[Claude1] Connection closed');
      // Auto-reconnect
      if (reconnectAttempts < MAX_RECONNECT) {
        reconnectAttempts++;
        console.log(`[Claude1] Reconnecting... (${reconnectAttempts}/${MAX_RECONNECT})`);
        setTimeout(() => connect().then(() => playLoop()).catch(console.error), 5000);
      } else {
        console.log('[Claude1] Max reconnect attempts reached. Exiting.');
        process.exit(1);
      }
    });
  });
}

function sendRequest(toolName, args = {}) {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return reject(new Error('WebSocket not connected'));
    }

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
      try {
        const msg = JSON.parse(data.toString());

        // Skip notifications
        if (msg.method === 'notifications/gameEvent') {
          return;
        }

        if (msg.id === id) {
          ws.removeListener('message', handler);
          if (msg.error) {
            reject(new Error(msg.error.message));
          } else {
            resolve(msg.result?.content?.[0]?.text || JSON.stringify(msg.result));
          }
        }
      } catch (err) {
        // Ignore parse errors
      }
    };

    ws.on('message', handler);
    ws.send(JSON.stringify(req));

    // Timeout after 15 seconds
    setTimeout(() => {
      ws.removeListener('message', handler);
      reject(new Error(`Timeout waiting for ${toolName}`));
    }, 15000);
  });
}

async function playLoop() {
  while (true) {
    try {
      const elapsed = Date.now() - gameStartTime;

      // Exit after 5 minutes
      if (elapsed > 5 * 60 * 1000) {
        console.log('[Claude1] 5 minutes complete. Disconnecting...');
        try {
          await sendRequest('minecraft_disconnect');
        } catch (err) {
          console.error('[Disconnect error]', err.message);
        }
        process.exit(0);
        return;
      }

      // Check if connected to Minecraft
      let status;
      try {
        status = await sendRequest('minecraft_get_status');
      } catch (err) {
        // Not connected, try to connect
        console.log('[Claude1] Not connected to Minecraft. Connecting...');
        const connectResult = await sendRequest('minecraft_connect', {
          host: 'localhost',
          port: 25565,
          username: 'Claude1Robust',
          agentType: 'game'
        });
        console.log('[Connect]', connectResult);
        await new Promise(resolve => setTimeout(resolve, 2000));
        continue;
      }

      console.log('[Status]', status);
      const statusObj = JSON.parse(status);
      const health = parseFloat(statusObj.health.split('/')[0]);

      // If low health, try to flee
      if (health < 10) {
        console.log('[Claude1] Low health! Fleeing...');
        try {
          await sendRequest('minecraft_flee', { distance: 20 });
        } catch (err) {
          console.error('[Flee error]', err.message);
        }
      }

      // Check surroundings
      try {
        const surroundings = await sendRequest('minecraft_get_surroundings');
        const lines = surroundings.split('\n');
        const dangerLine = lines.find(l => l.includes('危険'));
        if (dangerLine) {
          console.log('[Warning]', dangerLine);
        }
      } catch (err) {
        console.error('[Surroundings error]', err.message);
      }

      // Try to collect items
      try {
        await sendRequest('minecraft_collect_items');
      } catch (err) {
        // Ignore errors
      }

      // Wait 10 seconds before next loop
      await new Promise(resolve => setTimeout(resolve, 10000));

    } catch (err) {
      console.error('[Loop Error]', err.message);
      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

// Start
connect().then(() => playLoop()).catch(err => {
  console.error('[Fatal]', err);
  process.exit(1);
});
