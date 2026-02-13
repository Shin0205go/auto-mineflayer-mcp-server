#!/usr/bin/env node

// Claude3 - Simple Minecraft play script
import { createMCPClient } from '@modelcontextprotocol/sdk/client/index.js';
import { WebSocketClientTransport } from './dist/agent/mcp-ws-transport.js';

const MCP_WS_URL = process.env.MCP_WS_URL || 'ws://localhost:8765';
const PLAY_DURATION_MS = 5 * 60 * 1000; // 5 minutes

async function main() {
  console.log('[Claude3] Starting Minecraft play session...');

  // Connect to MCP WebSocket server
  const transport = new WebSocketClientTransport(new URL(MCP_WS_URL));
  const client = createMCPClient({ name: 'Claude3', version: '1.0' }, {
    capabilities: {
      sampling: {}
    }
  });

  await client.connect(transport);
  console.log('[Claude3] Connected to MCP server');

  try {
    // Connect to Minecraft
    console.log('[Claude3] Connecting to Minecraft server...');
    const connectResult = await client.request(
      { method: 'tools/call', params: {
        name: 'minecraft_connect',
        arguments: {
          host: 'localhost',
          port: 25565,
          username: 'Claude3',
          agentType: 'game'
        }
      }},
      { timeout: 30000 }
    );
    console.log('[Claude3] Connect result:', connectResult);

    // Get initial status
    const statusResult = await client.request(
      { method: 'tools/call', params: {
        name: 'minecraft_get_status',
        arguments: {}
      }},
      { timeout: 5000 }
    );
    console.log('[Claude3] Status:', statusResult);

    // Get position
    const posResult = await client.request(
      { method: 'tools/call', params: {
        name: 'minecraft_get_position',
        arguments: {}
      }},
      { timeout: 5000 }
    );
    console.log('[Claude3] Position:', posResult);

    // Get inventory
    const invResult = await client.request(
      { method: 'tools/call', params: {
        name: 'minecraft_get_inventory',
        arguments: {}
      }},
      { timeout: 5000 }
    );
    console.log('[Claude3] Inventory:', invResult);

    // Get surroundings
    const surroundResult = await client.request(
      { method: 'tools/call', params: {
        name: 'minecraft_get_surroundings',
        arguments: {}
      }},
      { timeout: 5000 }
    );
    console.log('[Claude3] Surroundings:', surroundResult);

    // Send chat message
    await client.request(
      { method: 'tools/call', params: {
        name: 'minecraft_chat',
        arguments: {
          message: 'Hello! Claude3 here, starting 5-minute survival session!'
        }
      }},
      { timeout: 5000 }
    );

    console.log('[Claude3] Playing for 5 minutes...');
    console.log('[Claude3] (This is a simple connection test - full autonomous play requires AI agent)');

    // Wait for play duration
    await new Promise(resolve => setTimeout(resolve, PLAY_DURATION_MS));

    console.log('[Claude3] Session complete, disconnecting...');

  } catch (error) {
    console.error('[Claude3] Error during play:', error);
    throw error;
  } finally {
    // Disconnect
    try {
      await client.request(
        { method: 'tools/call', params: {
          name: 'minecraft_disconnect',
          arguments: {}
        }},
        { timeout: 5000 }
      );
      console.log('[Claude3] Disconnected from Minecraft');
    } catch (err) {
      console.error('[Claude3] Error disconnecting:', err);
    }

    await client.close();
    console.log('[Claude3] MCP client closed');
  }

  console.log('[Claude3] Exiting...');
  process.exit(0);
}

main().catch(error => {
  console.error('[Claude3] Fatal error:', error);
  process.exit(1);
});
