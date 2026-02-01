#!/usr/bin/env node

/**
 * Minecraft AI Agent - Main Entry Point
 *
 * This agent acts as a "command center" between Gemini and Minecraft (MCP).
 *
 * Architecture:
 * ┌─────────────────┐     Video Stream     ┌──────────────────┐
 * │  Minecraft      │ ◄───────────────────► │  Vision Provider │
 * │  (Screen)       │                       │  (Capture)       │
 * └─────────────────┘                       └────────┬─────────┘
 *                                                    │
 *                                                    ▼
 * ┌─────────────────┐     Tool Calls       ┌──────────────────┐
 * │  MCP WS Server  │ ◄───────────────────► │  Action          │
 * │  (Mineflayer)   │                       │  Controller      │
 * └─────────────────┘                       └────────┬─────────┘
 *                                                    │
 *                                                    ▼
 *                                           ┌──────────────────┐
 *                                           │  Gemini Live     │
 *                                           │  (AI Reasoning)  │
 *                                           └──────────────────┘
 */

import 'dotenv/config';
import * as readline from 'readline';
import { ActionController, ActionControllerConfig, StateSnapshot } from './action-controller.js';

// Configuration from environment variables
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MCP_WS_URL = process.env.MCP_WS_URL || 'ws://localhost:8765';
const VISION_FPS = parseFloat(process.env.VISION_FPS || '1.0');
const VISION_WIDTH = parseInt(process.env.VISION_WIDTH || '768', 10);
const VISION_HEIGHT = parseInt(process.env.VISION_HEIGHT || '768', 10);

function printBanner(): void {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                   Minecraft AI Agent                         ║
║              Gemini + MCP + Vision Integration               ║
╚══════════════════════════════════════════════════════════════╝
`);
}

function printHelp(): void {
  console.log(`
Commands:
  start     - Start the vision capture loop
  stop      - Stop the vision capture loop
  analyze   - Capture and analyze a single frame
  status    - Show current agent status
  say <msg> - Send a text command to Gemini
  fps <n>   - Set capture FPS (0.5 - 2.0)
  help      - Show this help message
  quit      - Exit the agent
`);
}

function printStatus(state: StateSnapshot): void {
  console.log(`
Agent Status:
  State:           ${state.agentState}
  Gemini:          ${state.isGeminiConnected ? '✓ Connected' : '✗ Disconnected'}
  MCP:             ${state.isMCPConnected ? '✓ Connected' : '✗ Disconnected'}
  Capturing:       ${state.isCapturing ? '✓ Active' : '✗ Stopped'}
  Frames:          ${state.frameCount}
  Pending Tools:   ${state.pendingToolCalls}
  Last Error:      ${state.lastError || 'None'}
`);
}

async function main(): Promise<void> {
  printBanner();

  // Validate API key
  if (!GEMINI_API_KEY) {
    console.error('Error: GEMINI_API_KEY environment variable is required');
    console.error('Set it in a .env file or export it before running');
    process.exit(1);
  }

  // Create configuration
  const config: ActionControllerConfig = {
    gemini: {
      apiKey: GEMINI_API_KEY,
      model: 'gemini-2.0-flash-exp',
    },
    vision: {
      fps: VISION_FPS,
      width: VISION_WIDTH,
      height: VISION_HEIGHT,
      format: 'webp',
      quality: 80,
    },
    mcpServerUrl: MCP_WS_URL,
  };

  console.log(`Configuration:
  MCP Server:      ${MCP_WS_URL}
  Vision FPS:      ${VISION_FPS}
  Resolution:      ${VISION_WIDTH}x${VISION_HEIGHT}
`);

  // Create action controller
  const controller = new ActionController(config);

  // Set up event listeners
  controller.on('stateChange', ({ oldState, newState }) => {
    console.log(`[State] ${oldState} → ${newState}`);
  });

  controller.on('toolCallReceived', (toolCall) => {
    console.log(`[Tool] Executing: ${toolCall.name}`);
  });

  controller.on('toolCallCompleted', ({ toolCall, result }) => {
    console.log(`[Tool] Completed: ${toolCall.name}`);
  });

  controller.on('toolCallError', ({ toolCall, error }) => {
    console.error(`[Tool] Error in ${toolCall.name}: ${error}`);
  });

  controller.on('geminiText', (text) => {
    console.log(`\n[Gemini] ${text}\n`);
  });

  controller.on('error', ({ source, error }) => {
    console.error(`[Error] ${source}: ${error.message}`);
  });

  // Initialize components
  console.log('Initializing components...');

  try {
    await controller.initialize();
    console.log('All components initialized successfully!\n');
  } catch (error) {
    console.error('Failed to initialize:', error);
    console.error('\nMake sure the MCP WebSocket server is running:');
    console.error('  npm run start:mcp-ws\n');
    process.exit(1);
  }

  // Set up readline for interactive commands
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  printHelp();

  const promptUser = (): void => {
    rl.question('> ', async (input) => {
      const trimmed = input.trim();

      if (!trimmed) {
        promptUser();
        return;
      }

      const [command, ...args] = trimmed.split(' ');
      const argString = args.join(' ');

      try {
        switch (command.toLowerCase()) {
          case 'start':
            controller.startVisionLoop();
            console.log('Vision capture started');
            break;

          case 'stop':
            controller.stopVisionLoop();
            console.log('Vision capture stopped');
            break;

          case 'analyze':
            console.log('Capturing and analyzing frame...');
            await controller.analyzeCurrentFrame(argString || undefined);
            break;

          case 'status':
            printStatus(controller.getState());
            break;

          case 'say':
            if (!argString) {
              console.log('Usage: say <message>');
            } else {
              await controller.sendCommand(argString);
            }
            break;

          case 'fps':
            const fps = parseFloat(argString);
            if (isNaN(fps) || fps < 0.1 || fps > 5) {
              console.log('FPS must be between 0.1 and 5');
            } else {
              controller.updateVisionConfig({ fps });
              console.log(`FPS set to ${fps}`);
            }
            break;

          case 'help':
            printHelp();
            break;

          case 'quit':
          case 'exit':
            console.log('Shutting down...');
            await controller.shutdown();
            rl.close();
            process.exit(0);
            break;

          default:
            // Treat unknown commands as messages to Gemini
            await controller.sendCommand(trimmed);
            break;
        }
      } catch (error) {
        console.error('Error:', error instanceof Error ? error.message : error);
      }

      promptUser();
    });
  };

  // Handle Ctrl+C
  rl.on('close', async () => {
    console.log('\nShutting down...');
    await controller.shutdown();
    process.exit(0);
  });

  // Start interactive prompt
  promptUser();
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
  process.exit(1);
});

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
