#!/usr/bin/env node

/**
 * Dev Agent - Self-Improving Agent
 *
 * Monitors tool execution logs from Minecraft agents,
 * analyzes failure patterns, and modifies source code to fix issues.
 */

import "dotenv/config";
import { spawn } from "child_process";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import WebSocket from "ws";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { ToolExecutionLog } from "../types/tool-log.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, "..", "..");

const MCP_WS_URL = process.env.MCP_WS_URL || "ws://localhost:8765";
const ANALYSIS_INTERVAL = 60000; // 1 minute
const MIN_FAILURES_TO_ANALYZE = 3;

interface FailureSummary {
  [tool: string]: {
    count: number;
    errors: string[];
    examples: ToolExecutionLog[];
  };
}

interface ImprovementPlan {
  tool: string;
  problem: string;
  filePath: string;
  suggestedFix: string;
  code?: {
    before: string;
    after: string;
  };
}

class DevAgent {
  private ws: WebSocket | null = null;
  private isRunning = false;
  private pendingRequests = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>();
  private requestId = 0;
  private recentLogs: ToolExecutionLog[] = [];
  private lastAnalysisTime = 0;

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(MCP_WS_URL);

      this.ws.on("open", async () => {
        console.log("[DevAgent] Connected to MCP WS Server");
        // Subscribe as Dev Agent
        await this.callTool("dev_subscribe", {});
        console.log("[DevAgent] Subscribed to tool execution logs");
        resolve();
      });

      this.ws.on("message", (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString());

          // Handle tool log notifications
          if (msg.method === "notifications/toolLog") {
            this.handleToolLog(msg.params as ToolExecutionLog);
            return;
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
          console.error("[DevAgent] Failed to parse message:", e);
        }
      });

      this.ws.on("error", (error) => {
        console.error("[DevAgent] WebSocket error:", error);
        reject(error);
      });

      this.ws.on("close", () => {
        console.log("[DevAgent] WebSocket closed");
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

  private handleToolLog(log: ToolExecutionLog): void {
    const time = new Date(log.timestamp).toLocaleTimeString("ja-JP");
    const status = log.result === "success" ? "✓" : "✗";

    console.log(`[DevAgent] ${status} ${log.tool} (${log.duration}ms) - ${log.agentName}`);

    if (log.result === "failure") {
      console.log(`[DevAgent]   Error: ${log.error}`);
    }

    this.recentLogs.push(log);

    // Keep only last 100 logs
    if (this.recentLogs.length > 100) {
      this.recentLogs.shift();
    }
  }

  async start(): Promise<void> {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║              Dev Agent - Self-Improving System               ║
║         Monitors tool logs and fixes source code             ║
╚══════════════════════════════════════════════════════════════╝
`);

    await this.connect();
    this.isRunning = true;

    // Main loop - periodically analyze failures
    while (this.isRunning) {
      await this.sleep(ANALYSIS_INTERVAL);

      const now = Date.now();
      if (now - this.lastAnalysisTime > ANALYSIS_INTERVAL) {
        await this.analyzeAndImprove();
        this.lastAnalysisTime = now;
      }
    }
  }

  private async analyzeAndImprove(): Promise<void> {
    // Get failure summary
    const failures = this.recentLogs.filter(l => l.result === "failure");

    if (failures.length < MIN_FAILURES_TO_ANALYZE) {
      console.log(`[DevAgent] Not enough failures to analyze (${failures.length}/${MIN_FAILURES_TO_ANALYZE})`);
      return;
    }

    console.log(`[DevAgent] Analyzing ${failures.length} failures...`);

    // Group by tool
    const summary: FailureSummary = {};
    for (const log of failures) {
      if (!summary[log.tool]) {
        summary[log.tool] = { count: 0, errors: [], examples: [] };
      }
      summary[log.tool].count++;
      if (log.error && !summary[log.tool].errors.includes(log.error)) {
        summary[log.tool].errors.push(log.error);
      }
      if (summary[log.tool].examples.length < 3) {
        summary[log.tool].examples.push(log);
      }
    }

    // Find tools with most failures
    const sortedTools = Object.entries(summary)
      .sort((a, b) => b[1].count - a[1].count);

    if (sortedTools.length === 0) {
      return;
    }

    const [toolName, toolFailures] = sortedTools[0];
    console.log(`[DevAgent] Most failing tool: ${toolName} (${toolFailures.count} failures)`);
    console.log(`[DevAgent] Errors: ${toolFailures.errors.join(", ")}`);

    // Generate improvement plan using Claude
    const plan = await this.generateImprovementPlan(toolName, toolFailures);

    if (plan) {
      console.log(`[DevAgent] Improvement plan generated for ${toolName}`);
      console.log(`[DevAgent] Problem: ${plan.problem}`);
      console.log(`[DevAgent] File: ${plan.filePath}`);

      // Apply the fix
      const applied = await this.applyFix(plan);

      if (applied) {
        // Clear analyzed logs
        this.recentLogs = this.recentLogs.filter(l => l.tool !== toolName);

        // Rebuild
        await this.rebuild();
      }
    }
  }

  private async generateImprovementPlan(
    toolName: string,
    failures: FailureSummary[string]
  ): Promise<ImprovementPlan | null> {
    // Map tool name to source file
    const toolToFile: Record<string, string> = {
      minecraft_craft: "src/tools/crafting.ts",
      minecraft_smelt: "src/tools/crafting.ts",
      minecraft_fight: "src/tools/combat.ts",
      minecraft_flee: "src/tools/combat.ts",
      minecraft_eat: "src/tools/combat.ts",
      minecraft_move_to: "src/tools/movement.ts",
      minecraft_dig_block: "src/tools/building.ts",
      minecraft_place_block: "src/tools/building.ts",
      minecraft_get_surroundings: "src/tools/environment.ts",
      minecraft_find_block: "src/tools/environment.ts",
      minecraft_connect: "src/tools/connection.ts",
    };

    const filePath = toolToFile[toolName] || "src/bot-manager.ts";
    const fullPath = join(projectRoot, filePath);

    if (!existsSync(fullPath)) {
      console.log(`[DevAgent] Source file not found: ${filePath}`);
      return null;
    }

    const sourceCode = readFileSync(fullPath, "utf-8");

    // Create analysis prompt
    const prompt = `あなたはMinecraft MCPツールのデバッガーです。

## 失敗しているツール: ${toolName}

## エラー内容:
${failures.errors.map(e => `- ${e}`).join("\n")}

## 失敗例:
${JSON.stringify(failures.examples.slice(0, 2), null, 2)}

## ソースコード (${filePath}):
\`\`\`typescript
${sourceCode.slice(0, 8000)}
\`\`\`

## タスク
1. 失敗の原因を分析してください
2. 修正が必要な箇所を特定してください
3. 具体的な修正コードを提案してください

以下のJSON形式で回答してください:
\`\`\`json
{
  "problem": "問題の説明",
  "location": "関数名や行の説明",
  "fix": {
    "before": "修正前のコード断片",
    "after": "修正後のコード断片"
  }
}
\`\`\`

注意:
- before/afterは実際にファイル内に存在するコードを正確に指定してください
- 小さな修正にとどめてください
- 根本的な設計変更は避けてください`;

    try {
      const { ANTHROPIC_API_KEY, ...envWithoutKey } = process.env;
      const result = query({
        prompt,
        options: {
          model: "claude-sonnet-4-20250514",
          maxTurns: 1,
          tools: [],
          env: envWithoutKey as Record<string, string>,
        },
      });

      let responseText = "";
      for await (const msg of result) {
        if (msg.type === "result" && msg.subtype === "success") {
          responseText = msg.result || "";
        }
      }

      // Parse JSON from response
      const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[1]);
        return {
          tool: toolName,
          problem: parsed.problem,
          filePath,
          suggestedFix: parsed.location,
          code: parsed.fix,
        };
      }
    } catch (e) {
      console.error("[DevAgent] Failed to generate improvement plan:", e);
    }

    return null;
  }

  private async applyFix(plan: ImprovementPlan): Promise<boolean> {
    if (!plan.code?.before || !plan.code?.after) {
      console.log("[DevAgent] No code changes specified");
      return false;
    }

    const fullPath = join(projectRoot, plan.filePath);
    const currentCode = readFileSync(fullPath, "utf-8");

    if (!currentCode.includes(plan.code.before)) {
      console.log("[DevAgent] Could not find code to replace");
      console.log("[DevAgent] Looking for:", plan.code.before.slice(0, 100));
      return false;
    }

    // Apply the fix
    const newCode = currentCode.replace(plan.code.before, plan.code.after);

    // Backup original
    const backupPath = fullPath + ".backup";
    writeFileSync(backupPath, currentCode);

    // Write new code
    writeFileSync(fullPath, newCode);

    console.log(`[DevAgent] Applied fix to ${plan.filePath}`);
    console.log(`[DevAgent] Backup saved to ${backupPath}`);

    return true;
  }

  private async rebuild(): Promise<boolean> {
    console.log("[DevAgent] Rebuilding project...");

    return new Promise((resolve) => {
      const build = spawn("npm", ["run", "build"], {
        cwd: projectRoot,
        stdio: "pipe",
      });

      let stdout = "";
      let stderr = "";

      build.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      build.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      build.on("close", (code) => {
        if (code === 0) {
          console.log("[DevAgent] Build successful!");
          console.log("[DevAgent] Restart Minecraft agents to apply changes.");
          resolve(true);
        } else {
          console.error("[DevAgent] Build failed!");
          console.error(stderr);
          resolve(false);
        }
      });
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  stop(): void {
    console.log("[DevAgent] Stopping...");
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
    console.error("[DevAgent] Fatal error:", error);
    process.exit(1);
  }
}

main();
