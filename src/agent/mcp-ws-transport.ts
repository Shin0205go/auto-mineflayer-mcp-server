/**
 * MCP WebSocket Transport
 *
 * Custom Transport implementation for MCP protocol over WebSocket.
 * Allows the Gemini agent to communicate with the MCP server via WebSocket.
 */

import { WebSocket } from 'ws';
import { EventEmitter } from 'events';

export interface JSONRPCRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JSONRPCResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface JSONRPCNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

export type JSONRPCMessage = JSONRPCRequest | JSONRPCResponse | JSONRPCNotification;

/**
 * WebSocket-based MCP Transport for client-side communication
 */
export class MCPWebSocketClientTransport extends EventEmitter {
  private ws: WebSocket | null = null;
  private url: string;
  private pendingRequests: Map<string | number, {
    resolve: (value: JSONRPCResponse) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }> = new Map();
  private requestId = 0;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private connected = false;

  constructor(url: string) {
    super();
    this.url = url;
  }

  /**
   * Connect to the MCP WebSocket server
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);

        this.ws.on('open', () => {
          console.log('[MCP-WS] Connected to MCP server');
          this.connected = true;
          this.reconnectAttempts = 0;
          this.emit('connected');
          resolve();
        });

        this.ws.on('message', (data: Buffer) => {
          try {
            const message = JSON.parse(data.toString()) as JSONRPCMessage;
            this.handleMessage(message);
          } catch (error) {
            console.error('[MCP-WS] Failed to parse message:', error);
          }
        });

        this.ws.on('close', () => {
          console.log('[MCP-WS] Connection closed');
          this.connected = false;
          this.emit('disconnected');
          this.handleReconnect();
        });

        this.ws.on('error', (error) => {
          console.error('[MCP-WS] WebSocket error:', error);
          if (!this.connected) {
            reject(error);
          }
          this.emit('error', error);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Handle incoming JSON-RPC messages
   */
  private handleMessage(message: JSONRPCMessage): void {
    // Check if this is a response to a pending request
    if ('id' in message && message.id !== undefined) {
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(message.id);
        pending.resolve(message as JSONRPCResponse);
        return;
      }
    }

    // Emit notification for other messages
    if ('method' in message) {
      this.emit('notification', message);
    }
  }

  /**
   * Handle reconnection logic
   */
  private async handleReconnect(): Promise<void> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[MCP-WS] Max reconnection attempts reached');
      this.emit('reconnect_failed');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    console.log(`[MCP-WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    setTimeout(async () => {
      try {
        await this.connect();
      } catch (error) {
        console.error('[MCP-WS] Reconnection failed:', error);
      }
    }, delay);
  }

  /**
   * Send a JSON-RPC request and wait for response
   */
  async request(method: string, params?: Record<string, unknown>, timeoutMs = 30000): Promise<unknown> {
    if (!this.ws || !this.connected) {
      throw new Error('Not connected to MCP server');
    }

    const id = ++this.requestId;
    const request: JSONRPCRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout for method: ${method}`));
      }, timeoutMs);

      this.pendingRequests.set(id, {
        resolve: (response) => {
          if (response.error) {
            reject(new Error(response.error.message));
          } else {
            resolve(response.result);
          }
        },
        reject,
        timeout
      });

      this.ws!.send(JSON.stringify(request));
    });
  }

  /**
   * Send a notification (no response expected)
   */
  notify(method: string, params?: Record<string, unknown>): void {
    if (!this.ws || !this.connected) {
      throw new Error('Not connected to MCP server');
    }

    const notification: JSONRPCNotification = {
      jsonrpc: '2.0',
      method,
      params
    };

    this.ws.send(JSON.stringify(notification));
  }

  /**
   * Call an MCP tool
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    // Use longer timeout for tool calls (60s) as some operations like movement take time
    return this.request('tools/call', { name, arguments: args }, 60000);
  }

  /**
   * List available MCP tools
   */
  async listTools(): Promise<unknown> {
    return this.request('tools/list');
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Close the connection
   */
  close(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.pendingRequests.forEach((pending) => {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Connection closed'));
    });
    this.pendingRequests.clear();
  }
}
