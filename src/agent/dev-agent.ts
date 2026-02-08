#!/usr/bin/env node

/**
 * Dev Agent v2 - Behavior Tuning Agent
 *
 * Monitors Game Agent loop results and tunes agent-config.json
 * to improve behavior. No source code editing - only config changes.
 *
 * Flow:
 * 1. Connect to MCP WS Server, subscribe for loop result notifications
 * 2. Buffer loop results (5 loops or 3 minutes)
 * 3. Analyze with Claude SDK (query, maxTurns:1, no tools)
 * 4. Parse JSON output: {reasoning, changes[], newConfig}
 * 5. Save via dev_save_config
 * 6. Post summary to agent board
 */

import "dotenv/config";
import WebSocket from "ws";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { LoopResult, AgentConfig, EvolutionEntry, ConfigChange } from "../types/agent-config.js";

const MCP_WS_URL = process.env.MCP_WS_URL || "ws://localhost:8765";
const BUFFER_SIZE = 5;          // Analyze every N loop results
const BUFFER_TIMEOUT = 180000;  // Or after 3 minutes

// Colors for terminal output
const C = {
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
  reset: "\x1b[0m",
};
const PREFIX = `${C.yellow}[DevAgent]${C.reset}`;

class DevAgent {
  private ws: WebSocket | null = null;
  private isRunning = false;
  private pendingRequests = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>();
  private requestId = 0;
  private loopResultBuffer: LoopResult[] = [];
  private lastAnalysisTime = Date.now();
  private analysisCount = 0;

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(MCP_WS_URL);

      this.ws.on("open", async () => {
        console.log(`${PREFIX} Connected to MCP WS Server`);
        // Subscribe as Dev Agent to receive loop result notifications
        await this.callTool("dev_subscribe", {});
        console.log(`${PREFIX} Subscribed to notifications`);
        resolve();
      });

      this.ws.on("message", (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString());

          // Handle loop result notifications
          if (msg.method === "notifications/loopResult") {
            this.handleLoopResult(msg.params as LoopResult);
            return;
          }

          // Handle tool log notifications (just log them)
          if (msg.method === "notifications/toolLog") {
            return; // Silently ignore tool logs in v2
          }

          // Handle RPC responses
          if ("id" in msg && msg.id !== undefined) {
            const pending = this.pendingRequests.get(msg.id);
            if (pending) {
              this.pendingRequests.delete(msg.id);
              if (msg.error) {
                pending.reject(new Error(msg.error.message));
              } else {
                pending.resolve(msg.result);
              }
            }
          }
        } catch (e) {
          console.error(`${PREFIX} Failed to parse message:`, e);
        }
      });

      this.ws.on("error", (error) => {
        console.error(`${PREFIX} WebSocket error:`, error);
        reject(error);
      });

      this.ws.on("close", () => {
        console.log(`${PREFIX} WebSocket closed`);
        this.ws = null;
      });
    });
  }

  private async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Not connected");
    }

    const id = ++this.requestId;

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });

      this.ws!.send(JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: { name, arguments: args },
      }));

      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error("Request timeout"));
        }
      }, 30000);
    });
  }

  private async writeToBoard(message: string): Promise<void> {
    try {
      await this.callTool("agent_board_write", {
        agent_name: "DevAgent",
        message,
      });
    } catch (e) {
      console.error(`${PREFIX} Failed to write to board:`, e);
    }
  }

  private handleLoopResult(result: LoopResult): void {
    console.log(
      `${PREFIX} Loop #${result.loopNumber} received ` +
      `(success=${result.success}, tools=${result.toolCalls?.length || 0})`
    );

    this.loopResultBuffer.push(result);
  }

  async start(): Promise<void> {
    console.log(`
${C.yellow}╔══════════════════════════════════════════════════════════════╗
║           Dev Agent v2 - Behavior Tuning                    ║
║     Monitors loop results and tunes agent-config.json       ║
╚══════════════════════════════════════════════════════════════╝${C.reset}
`);

    await this.connect();
    this.isRunning = true;
    this.lastAnalysisTime = Date.now();

    await this.writeToBoard("🔧 DevAgent v2 起動 - 行動チューニングモード");

    // Main loop - check buffer periodically
    while (this.isRunning) {
      await this.sleep(10000); // Check every 10 seconds

      const bufferFull = this.loopResultBuffer.length >= BUFFER_SIZE;
      const timeoutReached = Date.now() - this.lastAnalysisTime > BUFFER_TIMEOUT;
      const hasResults = this.loopResultBuffer.length > 0;

      if (hasResults && (bufferFull || timeoutReached)) {
        await this.analyzeAndTune();
      }
    }
  }

  private async analyzeAndTune(): Promise<void> {
    this.analysisCount++;
    const results = [...this.loopResultBuffer];
    this.loopResultBuffer = [];
    this.lastAnalysisTime = Date.now();

    console.log(`\n${PREFIX} ${C.cyan}=== Analysis #${this.analysisCount} (${results.length} loops) ===${C.reset}`);

    // Get current config
    let currentConfig: AgentConfig;
    try {
      const configStr = await this.callTool("dev_get_config", {}) as { content: { text: string }[] };
      const configText = configStr.content?.[0]?.text || JSON.stringify(configStr);
      currentConfig = JSON.parse(configText);
    } catch (e) {
      console.error(`${PREFIX} Failed to get config:`, e);
      return;
    }

    console.log(`${PREFIX} Current config version: ${currentConfig.version}`);

    // Build analysis prompt
    const prompt = this.buildAnalysisPrompt(currentConfig, results);

    // Run Claude analysis
    let analysisResult: {
      reasoning: string;
      changes: ConfigChange[];
      newConfig: AgentConfig;
    } | null = null;

    try {
      const { ANTHROPIC_API_KEY, ...envWithoutKey } = process.env;

      const queryResult = query({
        prompt,
        options: {
          model: process.env.CLAUDE_MODEL || "opus",
          maxTurns: 1,
          tools: [],
          env: envWithoutKey as Record<string, string>,
          permissionMode: "bypassPermissions",
          allowDangerouslySkipPermissions: true,
        },
      });

      let responseText = "";
      for await (const msg of queryResult) {
        if (msg.type === "assistant" && msg.message?.content) {
          const content = msg.message.content as { type: string; text?: string }[];
          for (const block of content) {
            if (block.type === "text" && block.text) {
              responseText += block.text;
            }
          }
        }
      }

      // Parse JSON from response
      analysisResult = this.parseAnalysisResponse(responseText);
    } catch (e) {
      console.error(`${PREFIX} Analysis failed:`, e);
      return;
    }

    if (!analysisResult) {
      console.log(`${PREFIX} No actionable changes from analysis`);
      return;
    }

    // Check if there are actual changes
    if (analysisResult.changes.length === 0) {
      console.log(`${PREFIX} ${C.green}No changes needed - current config is working well${C.reset}`);
      return;
    }

    console.log(`${PREFIX} ${C.yellow}Reasoning: ${analysisResult.reasoning}${C.reset}`);
    console.log(`${PREFIX} Changes: ${analysisResult.changes.length}`);
    for (const change of analysisResult.changes) {
      console.log(`${PREFIX}   - ${change.field}: ${JSON.stringify(change.oldValue)} → ${JSON.stringify(change.newValue)} (${change.reason})`);
    }

    // Save updated config
    const newConfig = analysisResult.newConfig;
    newConfig.version = currentConfig.version + 1;
    newConfig.lastUpdated = new Date().toISOString();
    newConfig.updatedBy = "DevAgent-v2";

    const evolution: EvolutionEntry = {
      timestamp: new Date().toISOString(),
      configVersion: newConfig.version,
      changes: analysisResult.changes,
      analysis: analysisResult.reasoning,
    };

    try {
      await this.callTool("dev_save_config", {
        config: newConfig,
        evolution,
      });
      console.log(`${PREFIX} ${C.green}Config saved (v${newConfig.version})${C.reset}`);

      // Post summary to board
      const changeSummary = analysisResult.changes
        .map(c => `${c.field}: ${c.reason}`)
        .join("; ");
      await this.writeToBoard(
        `🧬 設定更新 v${newConfig.version}: ${changeSummary.slice(0, 150)}`
      );
    } catch (e) {
      console.error(`${PREFIX} Failed to save config:`, e);
    }
  }

  private buildAnalysisPrompt(config: AgentConfig, results: LoopResult[]): string {
    // Summarize results
    const successCount = results.filter(r => r.success).length;
    const failCount = results.length - successCount;

    // Collect all tool calls
    const toolStats: Record<string, { total: number; errors: number; errorMsgs: string[] }> = {};
    for (const r of results) {
      for (const tc of (r.toolCalls || [])) {
        if (!toolStats[tc.tool]) {
          toolStats[tc.tool] = { total: 0, errors: 0, errorMsgs: [] };
        }
        toolStats[tc.tool].total++;
        if (tc.error) {
          toolStats[tc.tool].errors++;
          if (!toolStats[tc.tool].errorMsgs.includes(tc.error)) {
            toolStats[tc.tool].errorMsgs.push(tc.error);
          }
        }
      }
    }

    const toolStatsText = Object.entries(toolStats)
      .sort(([, a], [, b]) => b.errors - a.errors)
      .map(([tool, stats]) => {
        const errText = stats.errors > 0
          ? ` (errors: ${stats.errors}: ${stats.errorMsgs.slice(0, 2).join(", ")})`
          : "";
        return `- ${tool}: ${stats.total}回${errText}`;
      })
      .join("\n");

    return `あなたはMinecraft AIエージェントの行動チューナーです。
ループ結果を分析し、設定パラメータを調整してください。

## 現在の設定 (v${config.version})
\`\`\`json
${JSON.stringify(config, null, 2)}
\`\`\`

## 直近${results.length}ループの結果
- 成功: ${successCount}, 失敗: ${failCount}

### 各ループサマリー
${results.map(r => `- #${r.loopNumber} [${r.success ? "✓" : "✗"}] ${r.summary}`).join("\n")}

### ツール使用統計
${toolStatsText || "（なし）"}

## 分析観点
1. 失敗原因の深堀り（ツールエラーか判断ミスか優先度の問題か）
2. 繰り返しパターン検出（同じ失敗の繰り返し）
3. 性格パラメータは適切か（攻撃性・探索意欲・リスク許容）
4. 優先度調整の必要性
5. ルール追加/修正の必要性
6. 閾値は適切か（逃走HP、食事タイミング）

## 出力フォーマット
以下のJSONのみを出力してください。マークダウンのコードブロックは不要です。
{
  "reasoning": "分析の要約（日本語）",
  "changes": [
    {
      "field": "変更したフィールドのパス (e.g. personality.aggressiveness)",
      "oldValue": "変更前の値",
      "newValue": "変更後の値",
      "reason": "変更理由"
    }
  ],
  "newConfig": { ... 完全なAgentConfigオブジェクト ... }
}

## 重要ルール
- 変更は1-3項目に限定（段階的改善）
- 成功パターンは壊さない
- 変更が不要なら changes を空配列にする
- newConfig は必ず完全なオブジェクトにする`;
  }

  private parseAnalysisResponse(text: string): {
    reasoning: string;
    changes: ConfigChange[];
    newConfig: AgentConfig;
  } | null {
    try {
      // Try to extract JSON from response
      // Handle case where response is wrapped in markdown code blocks
      let jsonStr = text.trim();

      // Remove markdown code blocks if present
      const jsonMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1].trim();
      }

      // Try to find JSON object
      const objStart = jsonStr.indexOf("{");
      const objEnd = jsonStr.lastIndexOf("}");
      if (objStart !== -1 && objEnd !== -1) {
        jsonStr = jsonStr.slice(objStart, objEnd + 1);
      }

      const parsed = JSON.parse(jsonStr);

      if (!parsed.reasoning || !parsed.changes || !parsed.newConfig) {
        console.error(`${PREFIX} Invalid analysis response structure`);
        return null;
      }

      return parsed;
    } catch (e) {
      console.error(`${PREFIX} Failed to parse analysis response:`, e);
      console.error(`${PREFIX} Response text: ${text.slice(0, 500)}`);
      return null;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  stop(): void {
    console.log(`${PREFIX} Stopping...`);
    this.isRunning = false;
    if (this.ws) {
      this.ws.close();
    }
  }
}

// Main entry point
async function main(): Promise<void> {
  const agent = new DevAgent();

  process.on("SIGINT", () => {
    agent.stop();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    agent.stop();
    process.exit(0);
  });

  try {
    await agent.start();
  } catch (error) {
    console.error(`${PREFIX} Fatal error:`, error);
    process.exit(1);
  }
}

main();
