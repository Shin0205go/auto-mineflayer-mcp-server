/**
 * Gemini Agent Client
 *
 * Autonomous Gemini agent using Google Generative AI SDK.
 * Similar pattern to ClaudeClient but uses WebSocket MCP.
 */

import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { EventEmitter } from "events";
import { MCPWebSocketClientTransport } from "./mcp-ws-transport.js";

export interface GeminiConfig {
  apiKey: string;
  model?: string;
  systemInstruction?: string;
  maxTurns?: number;
  mcpServerUrl?: string;
}

export interface AgentResult {
  success: boolean;
  result?: string;
  error?: string;
}

interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
}

const DEFAULT_SYSTEM_INSTRUCTION = `あなたはMinecraftを自律的に操作するAIエージェント「Gemini」です。

## 利用可能なツール（MCP経由）
- minecraft_connect: サーバーに接続
- minecraft_disconnect: 切断
- minecraft_get_position: 現在位置を確認
- minecraft_move_to: 指定座標に歩いて移動（pathfinder使用）
- minecraft_look_around: 周囲のブロックをスキャン
- minecraft_dig_block: ブロックを掘る
- minecraft_place_block: ブロックを置く（4.5ブロック以内）
- minecraft_collect_items: 近くのアイテムを拾う
- minecraft_get_inventory: インベントリを確認
- minecraft_craft: アイテムをクラフト
- minecraft_chat: チャットを送信
- agent_board_read/write: 掲示板で他エージェントと連携

## 行動ルール
1. 接続は最初に一度だけ
2. 移動は歩いて行う（/tpコマンド禁止）
3. 周囲を確認してから行動する
4. 掲示板を確認して、他のエージェント（Claude等）と協力する

## 協調のヒント
- agent_board_readで他エージェントのメッセージを確認
- agent_board_writeで自分の状況や計画を共有
- 「Gemini」という名前で書き込む

自律的に探索、採掘、建築を行ってください。`;

/**
 * Convert MCP tool schema to Gemini function declaration
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mcpToolToGeminiFunction(tool: MCPTool): any {
  const properties: Record<string, unknown> = {};

  if (tool.inputSchema.properties) {
    for (const [key, value] of Object.entries(tool.inputSchema.properties)) {
      const prop = value as { type?: string; description?: string };
      let type = SchemaType.STRING;
      if (prop.type === "number" || prop.type === "integer") {
        type = SchemaType.NUMBER;
      } else if (prop.type === "boolean") {
        type = SchemaType.BOOLEAN;
      }
      properties[key] = {
        type,
        description: prop.description,
      };
    }
  }

  return {
    name: tool.name,
    description: tool.description,
    parameters: {
      type: SchemaType.OBJECT,
      properties,
      required: tool.inputSchema.required || [],
    },
  };
}

/**
 * GeminiClient manages communication with Gemini
 */
export class GeminiClient extends EventEmitter {
  private config: GeminiConfig;
  private genAI: GoogleGenerativeAI;
  private mcp: MCPWebSocketClientTransport;
  private tools: MCPTool[] = [];
  private isConnected = false;

  constructor(config: GeminiConfig) {
    super();
    this.config = {
      model: "gemini-2.0-flash",
      systemInstruction: DEFAULT_SYSTEM_INSTRUCTION,
      maxTurns: 20,
      mcpServerUrl: "ws://localhost:8765",
      ...config,
    };

    this.genAI = new GoogleGenerativeAI(this.config.apiKey);
    this.mcp = new MCPWebSocketClientTransport(this.config.mcpServerUrl!);
  }

  /**
   * Connect to MCP server and load tools
   */
  async connect(): Promise<void> {
    console.log("[Gemini] Connecting to MCP server...");
    await this.mcp.connect();

    const response = (await this.mcp.listTools()) as { tools: MCPTool[] };
    this.tools = response.tools;
    console.log(`[Gemini] Loaded ${this.tools.length} tools from MCP`);

    this.isConnected = true;
    this.emit("connected");
  }

  /**
   * Run a query with autonomous tool execution
   */
  async runQuery(prompt: string): Promise<AgentResult> {
    if (!this.isConnected) {
      throw new Error("Not connected to MCP server");
    }

    const model = this.genAI.getGenerativeModel({
      model: this.config.model!,
      systemInstruction: this.config.systemInstruction,
      tools: [
        {
          functionDeclarations: this.tools.map(mcpToolToGeminiFunction),
        },
      ],
    });

    const chat = model.startChat();
    let currentPrompt = prompt;
    let turns = 0;
    let lastText = "";

    try {
      while (turns < this.config.maxTurns!) {
        turns++;
        console.log(`[Gemini] Turn ${turns}/${this.config.maxTurns}`);

        const result = await chat.sendMessage(currentPrompt);
        const response = result.response;

        // Check for text response
        const text = response.text();
        if (text) {
          console.log(`[Gemini] ${text}`);
          lastText = text;
          this.emit("text", text);
        }

        // Check for function calls
        const functionCalls = response.functionCalls();
        if (!functionCalls || functionCalls.length === 0) {
          // No more tool calls, done
          break;
        }

        // Execute function calls
        const functionResponses = [];
        for (const call of functionCalls) {
          console.log(`[Gemini] Tool: ${call.name}`, call.args);
          this.emit("tool_use", call.name, call.args);

          try {
            const mcpResult = (await this.mcp.callTool(
              call.name,
              call.args as Record<string, unknown>
            )) as { content: Array<{ text: string }> };

            const resultText = mcpResult.content?.[0]?.text || JSON.stringify(mcpResult);
            console.log(`[Gemini] Result: ${resultText.substring(0, 200)}...`);

            functionResponses.push({
              name: call.name,
              response: { result: resultText },
            });
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.error(`[Gemini] Tool error: ${errorMsg}`);
            functionResponses.push({
              name: call.name,
              response: { error: errorMsg },
            });
          }
        }

        // Send function results back to Gemini
        currentPrompt = JSON.stringify(functionResponses);
      }

      return {
        success: true,
        result: lastText,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error("[Gemini] Error:", errorMsg);
      this.emit("error", error);
      return {
        success: false,
        error: errorMsg,
      };
    }
  }

  /**
   * Disconnect from MCP
   */
  disconnect(): void {
    this.mcp.close();
    this.isConnected = false;
    this.emit("disconnected");
  }
}
