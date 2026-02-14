#!/usr/bin/env node

/**
 * MCP WebSocket Client for Claude Code
 *
 * This script acts as an MCP stdio bridge to the WebSocket MCP server.
 * It receives JSON-RPC requests from Claude Code via stdin,
 * forwards them to the WebSocket server, and returns responses via stdout.
 */

import { WebSocket } from 'ws';
import { createInterface } from 'readline';

const WS_URL = process.env.MCP_WS_URL || 'ws://localhost:8765';

let ws = null;
let connected = false;
const pendingRequests = new Map();
let requestId = 0;

// Connect to WebSocket server
function connect() {
  ws = new WebSocket(WS_URL);

  ws.on('open', () => {
    console.error(`[MCP-WS-Client] Connected to ${WS_URL}`);
    connected = true;
  });

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());

      // If it's a response to a pending request, resolve it
      if ('id' in message && message.id !== undefined) {
        const resolve = pendingRequests.get(message.id);
        if (resolve) {
          pendingRequests.delete(message.id);
          // Send response to stdout (Claude Code)
          process.stdout.write(JSON.stringify(message) + '\n');
        }
      } else if ('method' in message) {
        // It's a notification, forward to Claude Code
        process.stdout.write(JSON.stringify(message) + '\n');
      }
    } catch (error) {
      console.error('[MCP-WS-Client] Failed to parse message:', error);
    }
  });

  ws.on('close', () => {
    console.error('[MCP-WS-Client] Connection closed');
    connected = false;
    // Reject all pending requests
    for (const [id, _] of pendingRequests) {
      const errorResponse = {
        jsonrpc: '2.0',
        id,
        error: { code: -32000, message: 'Connection closed' }
      };
      process.stdout.write(JSON.stringify(errorResponse) + '\n');
    }
    pendingRequests.clear();
  });

  ws.on('error', (error) => {
    console.error('[MCP-WS-Client] WebSocket error:', error);
  });
}

// Handle stdin (requests from Claude Code)
const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

rl.on('line', (line) => {
  if (!line.trim()) return;

  try {
    const request = JSON.parse(line);

    if (!connected) {
      // If not connected, return error immediately
      const errorResponse = {
        jsonrpc: '2.0',
        id: request.id,
        error: { code: -32000, message: 'Not connected to MCP WebSocket server' }
      };
      process.stdout.write(JSON.stringify(errorResponse) + '\n');
      return;
    }

    // Track this request
    if ('id' in request) {
      pendingRequests.set(request.id, true);
    }

    // Forward request to WebSocket server
    ws.send(JSON.stringify(request));
  } catch (error) {
    console.error('[MCP-WS-Client] Failed to parse request:', error);
  }
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.error('[MCP-WS-Client] Shutting down...');
  if (ws) {
    ws.close();
  }
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.error('[MCP-WS-Client] Shutting down...');
  if (ws) {
    ws.close();
  }
  process.exit(0);
});

// Start connection
connect();
