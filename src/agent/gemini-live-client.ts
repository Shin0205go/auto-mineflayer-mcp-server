/**
 * Gemini Live Client
 *
 * Handles bidirectional streaming communication with Gemini Live API.
 * Sends video frames and receives tool calls/text responses.
 */

import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { EventEmitter } from 'events';

export interface GeminiConfig {
  /** Gemini API key */
  apiKey: string;
  /** Model name (default: gemini-2.0-flash-exp) */
  model?: string;
  /** System instruction for the agent */
  systemInstruction?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResult {
  id: string;
  result: string;
  isError?: boolean;
}

// MCP tool definitions for Gemini
const MCP_TOOLS = [
  {
    functionDeclarations: [
      {
        name: 'minecraft_connect',
        description: 'Connect to a Minecraft server',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            host: { type: SchemaType.STRING, description: 'Server hostname (default: localhost)' },
            port: { type: SchemaType.NUMBER, description: 'Server port (default: 25565)' },
            username: { type: SchemaType.STRING, description: 'Bot username' },
          },
          required: ['username'],
        },
      },
      {
        name: 'minecraft_disconnect',
        description: 'Disconnect from the Minecraft server',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {},
        },
      },
      {
        name: 'minecraft_get_position',
        description: 'Get the bot\'s current position in the world',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {},
        },
      },
      {
        name: 'minecraft_move_to',
        description: 'Move the bot to a specific coordinate',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            x: { type: SchemaType.NUMBER, description: 'X coordinate' },
            y: { type: SchemaType.NUMBER, description: 'Y coordinate' },
            z: { type: SchemaType.NUMBER, description: 'Z coordinate' },
          },
          required: ['x', 'y', 'z'],
        },
      },
      {
        name: 'minecraft_chat',
        description: 'Send a chat message in Minecraft',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            message: { type: SchemaType.STRING, description: 'Message to send' },
          },
          required: ['message'],
        },
      },
      {
        name: 'minecraft_look_around',
        description: 'Scan the surrounding blocks to understand the environment',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            radius: { type: SchemaType.NUMBER, description: 'Scan radius (default: 5, max: 10)' },
          },
        },
      },
      {
        name: 'minecraft_visualize_thinking',
        description: 'Display the current thinking state with particles',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            state: {
              type: SchemaType.STRING,
              description: 'Thinking state: idle, processing, searching, executing, or error',
            },
            message: { type: SchemaType.STRING, description: 'Optional message to display in chat' },
          },
          required: ['state'],
        },
      },
      {
        name: 'minecraft_place_block',
        description: 'Place a block at the specified coordinates',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            block_type: { type: SchemaType.STRING, description: 'Block type (e.g., stone, oak_planks)' },
            x: { type: SchemaType.NUMBER, description: 'X coordinate' },
            y: { type: SchemaType.NUMBER, description: 'Y coordinate' },
            z: { type: SchemaType.NUMBER, description: 'Z coordinate' },
          },
          required: ['block_type', 'x', 'y', 'z'],
        },
      },
      {
        name: 'minecraft_build_structure',
        description: 'Build a preset structure (house, tower, or marker)',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            structure: { type: SchemaType.STRING, description: 'Structure type: house, tower, or marker' },
            x: { type: SchemaType.NUMBER, description: 'X coordinate (optional, uses current position)' },
            y: { type: SchemaType.NUMBER, description: 'Y coordinate (optional)' },
            z: { type: SchemaType.NUMBER, description: 'Z coordinate (optional)' },
          },
          required: ['structure'],
        },
      },
    ],
  },
];

const DEFAULT_SYSTEM_INSTRUCTION = `You are an intelligent Minecraft agent that can see the game world through a live video stream and interact with it using tools.

Your capabilities:
1. **Vision**: You receive live video frames from Minecraft and can analyze what you see
2. **Tools**: You can use MCP tools to control a bot in the game

Available tools:
- minecraft_connect: Connect to a Minecraft server
- minecraft_disconnect: Disconnect from the server
- minecraft_get_position: Get current coordinates
- minecraft_move_to: Move to specific coordinates
- minecraft_chat: Send chat messages
- minecraft_look_around: Scan surrounding blocks
- minecraft_visualize_thinking: Show your thinking state with particles
- minecraft_place_block: Place a single block
- minecraft_build_structure: Build preset structures (house, tower, marker)

Guidelines:
1. When analyzing the video, describe what you see briefly
2. Use minecraft_visualize_thinking to show your current state:
   - "processing" when analyzing the scene
   - "searching" when gathering information
   - "executing" when performing actions
   - "idle" when waiting
   - "error" when something goes wrong
3. Be proactive - if you see something interesting, explore it
4. Coordinate your visual understanding with tool information for precise actions
5. Always respond to user voice commands if audio is provided`;

/**
 * GeminiLiveClient manages real-time communication with Gemini
 */
export class GeminiLiveClient extends EventEmitter {
  private genAI: GoogleGenerativeAI;
  private config: GeminiConfig;
  private session: ReturnType<ReturnType<GoogleGenerativeAI['getGenerativeModel']>['startChat']> | null = null;
  private isConnected = false;
  private pendingToolCalls: Map<string, ToolCall> = new Map();
  private toolCallIdCounter = 0;

  constructor(config: GeminiConfig) {
    super();
    this.config = {
      model: 'gemini-2.0-flash-exp',
      systemInstruction: DEFAULT_SYSTEM_INSTRUCTION,
      ...config,
    };
    this.genAI = new GoogleGenerativeAI(this.config.apiKey);
  }

  /**
   * Start a new generative session
   */
  async connect(): Promise<void> {
    try {
      const model = this.genAI.getGenerativeModel({
        model: this.config.model!,
        systemInstruction: this.config.systemInstruction,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tools: MCP_TOOLS as any,
      });

      // Start a chat session for multi-turn conversation
      this.session = model.startChat({
        history: [],
      });

      this.isConnected = true;
      console.log('[Gemini] Connected to Gemini API');
      this.emit('connected');
    } catch (error) {
      console.error('[Gemini] Failed to connect:', error);
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Send a video frame to Gemini for analysis
   */
  async sendFrame(base64Image: string, mimeType: string, prompt?: string): Promise<void> {
    if (!this.isConnected || !this.session) {
      throw new Error('Not connected to Gemini');
    }

    try {
      const imagePart = {
        inlineData: {
          mimeType,
          data: base64Image,
        },
      };

      const textPart = {
        text: prompt || 'Analyze this Minecraft scene. What do you see? What should we do next?',
      };

      const result = await this.session.sendMessage([imagePart, textPart]);
      const response = result.response;

      // Check for function calls
      const functionCalls = response.functionCalls();
      if (functionCalls && functionCalls.length > 0) {
        for (const fc of functionCalls) {
          const toolCall: ToolCall = {
            id: `tc_${++this.toolCallIdCounter}`,
            name: fc.name,
            args: fc.args as Record<string, unknown>,
          };
          this.pendingToolCalls.set(toolCall.id, toolCall);
          this.emit('toolCall', toolCall);
        }
      }

      // Check for text response
      const text = response.text();
      if (text) {
        this.emit('text', text);
      }
    } catch (error) {
      console.error('[Gemini] Error sending frame:', error);
      this.emit('error', error);
    }
  }

  /**
   * Send a text message to Gemini
   */
  async sendText(text: string): Promise<void> {
    if (!this.isConnected || !this.session) {
      throw new Error('Not connected to Gemini');
    }

    try {
      const result = await this.session.sendMessage(text);
      const response = result.response;

      // Check for function calls
      const functionCalls = response.functionCalls();
      if (functionCalls && functionCalls.length > 0) {
        for (const fc of functionCalls) {
          const toolCall: ToolCall = {
            id: `tc_${++this.toolCallIdCounter}`,
            name: fc.name,
            args: fc.args as Record<string, unknown>,
          };
          this.pendingToolCalls.set(toolCall.id, toolCall);
          this.emit('toolCall', toolCall);
        }
      }

      // Check for text response
      const responseText = response.text();
      if (responseText) {
        this.emit('text', responseText);
      }
    } catch (error) {
      console.error('[Gemini] Error sending text:', error);
      this.emit('error', error);
    }
  }

  /**
   * Send tool execution result back to Gemini
   */
  async sendToolResult(result: ToolResult): Promise<void> {
    if (!this.isConnected || !this.session) {
      throw new Error('Not connected to Gemini');
    }

    const toolCall = this.pendingToolCalls.get(result.id);
    if (!toolCall) {
      console.warn(`[Gemini] Unknown tool call ID: ${result.id}`);
      return;
    }

    try {
      // Send function response back to Gemini
      const functionResponse = {
        functionResponse: {
          name: toolCall.name,
          response: {
            result: result.result,
            isError: result.isError || false,
          },
        },
      };

      const response = await this.session.sendMessage([functionResponse]);
      this.pendingToolCalls.delete(result.id);

      // Check for follow-up function calls
      const functionCalls = response.response.functionCalls();
      if (functionCalls && functionCalls.length > 0) {
        for (const fc of functionCalls) {
          const newToolCall: ToolCall = {
            id: `tc_${++this.toolCallIdCounter}`,
            name: fc.name,
            args: fc.args as Record<string, unknown>,
          };
          this.pendingToolCalls.set(newToolCall.id, newToolCall);
          this.emit('toolCall', newToolCall);
        }
      }

      // Check for text response
      const text = response.response.text();
      if (text) {
        this.emit('text', text);
      }
    } catch (error) {
      console.error('[Gemini] Error sending tool result:', error);
      this.emit('error', error);
    }
  }

  /**
   * Check if connected
   */
  getConnectionStatus(): boolean {
    return this.isConnected;
  }

  /**
   * Get pending tool calls
   */
  getPendingToolCalls(): ToolCall[] {
    return Array.from(this.pendingToolCalls.values());
  }

  /**
   * Disconnect from Gemini
   */
  disconnect(): void {
    this.session = null;
    this.isConnected = false;
    this.pendingToolCalls.clear();
    console.log('[Gemini] Disconnected');
    this.emit('disconnected');
  }

  /**
   * Update system instruction
   */
  async updateSystemInstruction(instruction: string): Promise<void> {
    this.config.systemInstruction = instruction;
    // Reconnect with new instruction
    if (this.isConnected) {
      this.disconnect();
      await this.connect();
    }
  }
}
