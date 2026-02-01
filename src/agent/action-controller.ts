/**
 * Action Controller - Central Hub for Agent Coordination
 *
 * Manages state and orchestrates communication between:
 * - Gemini Live Client (AI reasoning)
 * - Vision Provider (screen capture)
 * - MCP Client (Minecraft control)
 */

import { EventEmitter } from 'events';
import { VisionProvider, CapturedFrame, VisionConfig } from './vision-provider.js';
import { GeminiLiveClient, ToolCall, ToolResult, GeminiConfig } from './gemini-live-client.js';
import { MCPWebSocketClientTransport } from './mcp-ws-transport.js';

export type AgentState = 'idle' | 'connecting' | 'processing' | 'executing' | 'error';

export interface ActionControllerConfig {
  gemini: GeminiConfig;
  vision?: Partial<VisionConfig>;
  mcpServerUrl: string;
}

export interface StateSnapshot {
  agentState: AgentState;
  isGeminiConnected: boolean;
  isMCPConnected: boolean;
  isCapturing: boolean;
  frameCount: number;
  pendingToolCalls: number;
  lastError: string | null;
}

/**
 * ActionController coordinates all agent components
 */
export class ActionController extends EventEmitter {
  private gemini: GeminiLiveClient;
  private vision: VisionProvider;
  private mcp: MCPWebSocketClientTransport;
  private state: AgentState = 'idle';
  private lastError: string | null = null;
  private frameQueue: CapturedFrame[] = [];
  private isProcessingFrame = false;
  private autoAnalyzeInterval: NodeJS.Timeout | null = null;

  constructor(private config: ActionControllerConfig) {
    super();
    this.gemini = new GeminiLiveClient(config.gemini);
    this.vision = new VisionProvider(config.vision);
    this.mcp = new MCPWebSocketClientTransport(config.mcpServerUrl);

    this.setupEventHandlers();
  }

  /**
   * Set up event handlers for all components
   */
  private setupEventHandlers(): void {
    // Vision events
    this.vision.on('frame', (frame: CapturedFrame) => {
      this.handleFrame(frame);
    });

    this.vision.on('error', (error: Error) => {
      this.handleError('Vision', error);
    });

    // Gemini events
    this.gemini.on('connected', () => {
      console.log('[Controller] Gemini connected');
      this.emit('geminiConnected');
    });

    this.gemini.on('disconnected', () => {
      console.log('[Controller] Gemini disconnected');
      this.emit('geminiDisconnected');
    });

    this.gemini.on('toolCall', async (toolCall: ToolCall) => {
      await this.handleToolCall(toolCall);
    });

    this.gemini.on('text', (text: string) => {
      console.log(`[Gemini Response] ${text}`);
      this.emit('geminiText', text);
    });

    this.gemini.on('error', (error: Error) => {
      this.handleError('Gemini', error);
    });

    // MCP events
    this.mcp.on('connected', () => {
      console.log('[Controller] MCP connected');
      this.emit('mcpConnected');
    });

    this.mcp.on('disconnected', () => {
      console.log('[Controller] MCP disconnected');
      this.emit('mcpDisconnected');
    });

    this.mcp.on('error', (error: Error) => {
      this.handleError('MCP', error);
    });
  }

  /**
   * Initialize and connect all components
   */
  async initialize(): Promise<void> {
    this.setState('connecting');

    try {
      console.log('[Controller] Initializing components...');

      // Initialize vision provider
      await this.vision.initialize();
      console.log('[Controller] Vision provider initialized');

      // Connect to MCP server
      await this.mcp.connect();
      console.log('[Controller] MCP client connected');

      // Connect to Gemini
      await this.gemini.connect();
      console.log('[Controller] Gemini client connected');

      this.setState('idle');
      console.log('[Controller] All components initialized successfully');
      this.emit('initialized');
    } catch (error) {
      this.handleError('Initialize', error as Error);
      throw error;
    }
  }

  /**
   * Start the vision capture and analysis loop
   */
  startVisionLoop(): void {
    if (this.state !== 'idle' && this.state !== 'processing') {
      console.warn('[Controller] Cannot start vision loop in current state:', this.state);
      return;
    }

    this.vision.startCapture();
    console.log('[Controller] Vision loop started');
    this.emit('visionLoopStarted');
  }

  /**
   * Stop the vision capture loop
   */
  stopVisionLoop(): void {
    this.vision.stopCapture();
    console.log('[Controller] Vision loop stopped');
    this.emit('visionLoopStopped');
  }

  /**
   * Handle a captured frame
   */
  private async handleFrame(frame: CapturedFrame): Promise<void> {
    // Queue the frame for processing
    this.frameQueue.push(frame);

    // Only keep the latest frame to avoid backlog
    if (this.frameQueue.length > 1) {
      this.frameQueue = [this.frameQueue[this.frameQueue.length - 1]];
    }

    // Process if not already processing
    if (!this.isProcessingFrame) {
      await this.processNextFrame();
    }
  }

  /**
   * Process the next frame in the queue
   */
  private async processNextFrame(): Promise<void> {
    if (this.frameQueue.length === 0 || this.isProcessingFrame) {
      return;
    }

    this.isProcessingFrame = true;
    this.setState('processing');

    const frame = this.frameQueue.shift()!;

    try {
      await this.gemini.sendFrame(frame.base64, frame.mimeType);
      this.emit('frameProcessed', frame.frameNumber);
    } catch (error) {
      console.error('[Controller] Error processing frame:', error);
    } finally {
      this.isProcessingFrame = false;
      this.setState('idle');

      // Process next frame if any
      if (this.frameQueue.length > 0) {
        await this.processNextFrame();
      }
    }
  }

  /**
   * Handle a tool call from Gemini
   */
  private async handleToolCall(toolCall: ToolCall): Promise<void> {
    console.log(`[Controller] Tool call: ${toolCall.name}`, toolCall.args);
    this.setState('executing');
    this.emit('toolCallReceived', toolCall);

    try {
      // Execute the tool via MCP
      const result = await this.mcp.callTool(toolCall.name, toolCall.args);
      const resultText = this.extractResultText(result);

      console.log(`[Controller] Tool result: ${resultText.substring(0, 100)}...`);

      // Send result back to Gemini
      const toolResult: ToolResult = {
        id: toolCall.id,
        result: resultText,
        isError: false,
      };

      await this.gemini.sendToolResult(toolResult);
      this.emit('toolCallCompleted', { toolCall, result: resultText });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[Controller] Tool call error: ${errorMessage}`);

      // Send error back to Gemini
      const toolResult: ToolResult = {
        id: toolCall.id,
        result: `Error: ${errorMessage}`,
        isError: true,
      };

      await this.gemini.sendToolResult(toolResult);
      this.emit('toolCallError', { toolCall, error: errorMessage });
    } finally {
      this.setState('idle');
    }
  }

  /**
   * Extract text from MCP tool result
   */
  private extractResultText(result: unknown): string {
    if (typeof result === 'string') {
      return result;
    }
    if (typeof result === 'object' && result !== null) {
      const r = result as Record<string, unknown>;
      if (r.content && Array.isArray(r.content)) {
        const textContent = r.content.find(
          (c: unknown) => typeof c === 'object' && c !== null && (c as Record<string, unknown>).type === 'text'
        );
        if (textContent && typeof textContent === 'object') {
          return (textContent as Record<string, unknown>).text as string || JSON.stringify(result);
        }
      }
    }
    return JSON.stringify(result);
  }

  /**
   * Send a text command to Gemini
   */
  async sendCommand(text: string): Promise<void> {
    console.log(`[Controller] User command: ${text}`);
    this.setState('processing');

    try {
      await this.gemini.sendText(text);
    } catch (error) {
      this.handleError('Command', error as Error);
    }
  }

  /**
   * Manually trigger a frame analysis
   */
  async analyzeCurrentFrame(prompt?: string): Promise<void> {
    try {
      const frame = await this.vision.captureFrame();
      this.setState('processing');
      await this.gemini.sendFrame(frame.base64, frame.mimeType, prompt);
    } catch (error) {
      this.handleError('Analyze', error as Error);
    }
  }

  /**
   * Update the agent state
   */
  private setState(newState: AgentState): void {
    if (this.state !== newState) {
      const oldState = this.state;
      this.state = newState;
      this.emit('stateChange', { oldState, newState });
    }
  }

  /**
   * Handle errors from any component
   */
  private handleError(source: string, error: Error): void {
    this.lastError = `[${source}] ${error.message}`;
    console.error(`[Controller] Error from ${source}:`, error.message);
    this.setState('error');
    this.emit('error', { source, error });
  }

  /**
   * Get current state snapshot
   */
  getState(): StateSnapshot {
    return {
      agentState: this.state,
      isGeminiConnected: this.gemini.getConnectionStatus(),
      isMCPConnected: this.mcp.isConnected(),
      isCapturing: this.vision.getStats().isCapturing,
      frameCount: this.vision.getStats().frameNumber,
      pendingToolCalls: this.gemini.getPendingToolCalls().length,
      lastError: this.lastError,
    };
  }

  /**
   * Update vision configuration
   */
  updateVisionConfig(config: Partial<VisionConfig>): void {
    this.vision.updateConfig(config);
  }

  /**
   * Shutdown all components
   */
  async shutdown(): Promise<void> {
    console.log('[Controller] Shutting down...');

    this.stopVisionLoop();
    this.vision.destroy();
    this.gemini.disconnect();
    this.mcp.close();

    this.setState('idle');
    console.log('[Controller] Shutdown complete');
    this.emit('shutdown');
  }
}
