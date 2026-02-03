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

// Colors for terminal output
const C = {
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  reset: "\x1b[0m",
};
const PREFIX = `${C.yellow}[DevAgent]${C.reset}`;

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
  private gameAgentProcess: ReturnType<typeof spawn> | null = null;
  private manageGameAgent = process.env.MANAGE_GAME_AGENT === "true";

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(MCP_WS_URL);

      this.ws.on("open", async () => {
        console.log(`${PREFIX} Connected to MCP WS Server`);
        // Subscribe as Dev Agent
        await this.callTool("dev_subscribe", {});
        console.log(`${PREFIX} Subscribed to tool execution logs`);
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

  private handleToolLog(log: ToolExecutionLog): void {
    const time = new Date(log.timestamp).toLocaleTimeString("ja-JP");
    const status = log.result === "success" ? `${C.green}✓${C.reset}` : `${C.red}✗${C.reset}`;

    console.log(`${PREFIX} [${time}] ${status} ${log.tool} (${log.duration}ms) - ${log.agentName}`);

    if (log.result === "failure") {
      console.log(`${PREFIX}   ${C.red}Error: ${log.error}${C.reset}`);
    }

    this.recentLogs.push(log);

    // Keep only last 100 logs
    if (this.recentLogs.length > 100) {
      this.recentLogs.shift();
    }
  }

  async start(): Promise<void> {
    console.log(`
${C.yellow}╔══════════════════════════════════════════════════════════════╗
║              Dev Agent - Self-Improving System               ║
║         Monitors tool logs and fixes source code             ║
╚══════════════════════════════════════════════════════════════╝${C.reset}
`);

    await this.connect();
    this.isRunning = true;

    // Start Game Agent if managed mode
    if (this.manageGameAgent) {
      console.log(`${PREFIX} Managed mode enabled - will control Game Agent lifecycle`);
      await this.sleep(2000); // Wait for MCP server to be ready
      this.startGameAgent();
    }

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
      console.log(`${PREFIX} Not enough failures to analyze (${failures.length}/${MIN_FAILURES_TO_ANALYZE})`);
      return;
    }

    console.log(`${PREFIX} ${C.yellow}=== Starting Improvement Cycle ===${C.reset}`);
    console.log(`${PREFIX} Analyzing ${failures.length} failures...`);

    // STOP Game Agent during improvement
    if (this.manageGameAgent && this.gameAgentProcess) {
      console.log(`${PREFIX} ${C.yellow}Pausing Game Agent for improvement...${C.reset}`);
      this.stopGameAgent();
      await this.sleep(2000);
    }

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
      // Restart Game Agent if no tools to fix
      if (this.manageGameAgent) {
        this.startGameAgent();
      }
      return;
    }

    const [toolName, toolFailures] = sortedTools[0];
    console.log(`${PREFIX} Most failing tool: ${toolName} (${toolFailures.count} failures)`);
    console.log(`${PREFIX} Errors: ${toolFailures.errors.join(", ")}`);

    // Keep trying until build succeeds
    let buildSuccess = false;
    let attempts = 0;
    const MAX_ATTEMPTS = 5;

    while (!buildSuccess && attempts < MAX_ATTEMPTS) {
      attempts++;
      console.log(`${PREFIX} ${C.cyan}Improvement attempt ${attempts}/${MAX_ATTEMPTS}${C.reset}`);

      // Generate improvement plan using Claude
      const plan = await this.generateImprovementPlan(toolName, toolFailures, attempts > 1 ? this.lastBuildError : undefined);

      if (!plan) {
        console.log(`${PREFIX} ${C.red}Failed to generate improvement plan${C.reset}`);
        break;
      }

      console.log(`${PREFIX} Improvement plan generated for ${toolName}`);
      console.log(`${PREFIX} Problem: ${plan.problem}`);
      console.log(`${PREFIX} File: ${plan.filePath}`);

      // Apply the fix
      const applied = await this.applyFix(plan);

      if (!applied) {
        console.log(`${PREFIX} ${C.red}Failed to apply fix${C.reset}`);
        continue;
      }

      // Try to build
      buildSuccess = await this.rebuild();

      if (!buildSuccess) {
        console.log(`${PREFIX} ${C.yellow}Build failed, will try again...${C.reset}`);
        await this.sleep(2000);
      }
    }

    // Clear analyzed logs
    this.recentLogs = this.recentLogs.filter(l => l.tool !== toolName);

    if (buildSuccess) {
      console.log(`${PREFIX} ${C.green}=== Improvement Cycle Complete ===${C.reset}`);
    } else {
      console.log(`${PREFIX} ${C.red}=== Improvement Failed after ${MAX_ATTEMPTS} attempts ===${C.reset}`);
      // Restore from backup
      if (this.lastAppliedFixPath) {
        const backupPath = this.lastAppliedFixPath + ".backup";
        if (existsSync(backupPath)) {
          console.log(`${PREFIX} Restoring from backup...`);
          const backup = readFileSync(backupPath, "utf-8");
          writeFileSync(this.lastAppliedFixPath, backup);
          await this.rebuildAfterRollback();
        }
      }
    }

    // Restart Game Agent
    if (this.manageGameAgent) {
      console.log(`${PREFIX} ${C.green}Resuming Game Agent...${C.reset}`);
      this.startGameAgent();
    }
  }

  private lastBuildError: string | undefined = undefined;

  private async generateImprovementPlan(
    toolName: string,
    failures: FailureSummary[string],
    buildError?: string
  ): Promise<ImprovementPlan | null> {
    // Map tool name to source file and function name
    const toolToFile: Record<string, { file: string; func?: string }> = {
      minecraft_craft: { file: "src/tools/crafting.ts" },
      minecraft_smelt: { file: "src/tools/crafting.ts" },
      minecraft_fight: { file: "src/tools/combat.ts" },
      minecraft_flee: { file: "src/tools/combat.ts" },
      minecraft_eat: { file: "src/tools/combat.ts" },
      minecraft_move_to: { file: "src/bot-manager.ts", func: "moveTo" },
      minecraft_dig_block: { file: "src/tools/building.ts" },
      minecraft_place_block: { file: "src/tools/building.ts" },
      minecraft_get_surroundings: { file: "src/tools/environment.ts" },
      minecraft_find_block: { file: "src/tools/environment.ts" },
      minecraft_connect: { file: "src/tools/connection.ts" },
      minecraft_collect_items: { file: "src/bot-manager.ts", func: "collectNearbyItems" },
    };

    const mapping = toolToFile[toolName] || { file: "src/bot-manager.ts" };
    const filePath = mapping.file;
    const fullPath = join(projectRoot, filePath);

    if (!existsSync(fullPath)) {
      console.log(`${PREFIX} Source file not found: ${filePath}`);
      return null;
    }

    let sourceCode = readFileSync(fullPath, "utf-8");

    // If file is too large, try to extract just the relevant function
    const MAX_SOURCE_SIZE = 15000; // ~15KB limit
    if (sourceCode.length > MAX_SOURCE_SIZE && mapping.func) {
      console.log(`${PREFIX} File too large (${sourceCode.length} chars), extracting function: ${mapping.func}`);
      const extracted = this.extractFunction(sourceCode, mapping.func);
      if (extracted) {
        sourceCode = `// Extracted function from ${filePath}\n\n${extracted}`;
        console.log(`${PREFIX} Extracted ${sourceCode.length} chars`);
      } else {
        // Fall back to first part of file
        sourceCode = sourceCode.slice(0, MAX_SOURCE_SIZE) + "\n// ... (truncated)";
      }
    } else if (sourceCode.length > MAX_SOURCE_SIZE) {
      sourceCode = sourceCode.slice(0, MAX_SOURCE_SIZE) + "\n// ... (truncated)";
    }

    // Build error section (for retry attempts)
    const buildErrorSection = buildError
      ? `\n## 前回のビルドエラー:\n\`\`\`\n${buildError}\n\`\`\`\n\n**重要**: 前回の修正でビルドエラーが発生しました。このエラーを解決する修正を提案してください。\n`
      : "";

    // Create analysis prompt
    const prompt = `あなたはMinecraft MCPツールのデバッガーです。

## 失敗しているツール: ${toolName}
${buildErrorSection}
## エラー内容:
${failures.errors.map(e => `- ${e}`).join("\n")}

## 失敗例:
${JSON.stringify(failures.examples.slice(0, 2), null, 2)}

## ソースコード (${filePath}):
\`\`\`typescript
${sourceCode}
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
          model: "claude-opus-4-20250514",
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
      console.error(`${PREFIX} Failed to generate improvement plan:`, e);
    }

    return null;
  }

  private async applyFix(plan: ImprovementPlan): Promise<boolean> {
    if (!plan.code?.before || !plan.code?.after) {
      console.log(`${PREFIX} No code changes specified`);
      return false;
    }

    const fullPath = join(projectRoot, plan.filePath);
    const currentCode = readFileSync(fullPath, "utf-8");

    if (!currentCode.includes(plan.code.before)) {
      console.log(`${PREFIX} Could not find code to replace`);
      console.log(`${PREFIX} Looking for:`, plan.code.before.slice(0, 100));
      return false;
    }

    // Apply the fix
    const newCode = currentCode.replace(plan.code.before, plan.code.after);

    // Backup original
    const backupPath = fullPath + ".backup";
    writeFileSync(backupPath, currentCode);

    // Write new code
    writeFileSync(fullPath, newCode);

    // Track for potential rollback
    this.lastAppliedFixPath = fullPath;

    console.log(`${PREFIX} ${C.green}Applied fix to ${plan.filePath}${C.reset}`);
    console.log(`${PREFIX} Backup saved to ${backupPath}`);

    return true;
  }

  private lastAppliedFixPath: string | null = null;

  private async rebuild(): Promise<boolean> {
    console.log(`${PREFIX} Rebuilding project...`);

    return new Promise((resolve) => {
      const build = spawn("npm", ["run", "build"], {
        cwd: projectRoot,
        stdio: "pipe",
      });

      let stderr = "";

      build.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      build.on("close", (code) => {
        if (code === 0) {
          console.log(`${PREFIX} ${C.green}Build successful!${C.reset}`);
          this.lastBuildError = undefined;
          this.lastAppliedFixPath = null;
          resolve(true);
        } else {
          console.error(`${PREFIX} ${C.red}Build failed!${C.reset}`);
          console.error(stderr);
          // Store error for next improvement attempt
          this.lastBuildError = stderr;
          resolve(false);
        }
      });
    });
  }

  private async rebuildAfterRollback(): Promise<boolean> {
    return new Promise((resolve) => {
      const build = spawn("npm", ["run", "build"], {
        cwd: projectRoot,
        stdio: "pipe",
      });

      build.on("close", (code) => {
        resolve(code === 0);
      });
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Extract a function from source code by name
   * Handles async functions, regular functions, and arrow function properties
   */
  private extractFunction(source: string, funcName: string): string | null {
    // Try patterns: async funcName(, funcName(, funcName =, funcName:
    const patterns = [
      new RegExp(`(async\\s+${funcName}\\s*\\([^)]*\\)[^{]*\\{)`, "m"),
      new RegExp(`(${funcName}\\s*\\([^)]*\\)[^{]*\\{)`, "m"),
      new RegExp(`(${funcName}\\s*=\\s*async\\s*\\([^)]*\\)[^{]*\\{)`, "m"),
      new RegExp(`(${funcName}\\s*:\\s*async\\s*\\([^)]*\\)[^{]*\\{)`, "m"),
    ];

    for (const pattern of patterns) {
      const match = source.match(pattern);
      if (match && match.index !== undefined) {
        // Find the matching closing brace
        const startIndex = match.index;
        let braceCount = 0;
        let inString = false;
        let stringChar = "";
        let endIndex = startIndex;

        for (let i = startIndex; i < source.length; i++) {
          const char = source[i];
          const prevChar = i > 0 ? source[i - 1] : "";

          // Handle strings
          if ((char === '"' || char === "'" || char === "`") && prevChar !== "\\") {
            if (!inString) {
              inString = true;
              stringChar = char;
            } else if (char === stringChar) {
              inString = false;
            }
          }

          if (!inString) {
            if (char === "{") braceCount++;
            if (char === "}") {
              braceCount--;
              if (braceCount === 0) {
                endIndex = i + 1;
                break;
              }
            }
          }
        }

        if (endIndex > startIndex) {
          return source.slice(startIndex, endIndex);
        }
      }
    }

    return null;
  }

  /**
   * Start the Game Agent as a child process
   */
  private startGameAgent(): void {
    if (!this.manageGameAgent) {
      console.log(`${PREFIX} Game Agent management disabled. Set MANAGE_GAME_AGENT=true to enable.`);
      return;
    }

    if (this.gameAgentProcess) {
      console.log(`${PREFIX} Game Agent already running`);
      return;
    }

    console.log(`${PREFIX} Starting Game Agent...`);

    // Use Node for claude-agent
    const agentScript = join(projectRoot, "dist", "agent", "claude-agent.js");

    this.gameAgentProcess = spawn("node", [agentScript], {
      cwd: projectRoot,
      stdio: "inherit",  // Inherit all stdio for OAuth to work
      env: {
        ...process.env,
        BOT_USERNAME: process.env.BOT_USERNAME || "Claude",
      },
    });

    this.gameAgentProcess.on("exit", (code) => {
      console.log(`${PREFIX} Game Agent exited with code ${code}`);
      this.gameAgentProcess = null;

      // Auto-restart after 5 seconds if still running
      if (this.isRunning) {
        console.log(`${PREFIX} Restarting Game Agent in 5 seconds...`);
        setTimeout(() => this.startGameAgent(), 5000);
      }
    });

    console.log(`${PREFIX} Game Agent started (PID: ${this.gameAgentProcess.pid})`);
  }

  /**
   * Stop the Game Agent
   */
  private stopGameAgent(): void {
    if (this.gameAgentProcess) {
      console.log(`${PREFIX} Stopping Game Agent...`);
      this.gameAgentProcess.kill("SIGTERM");
      this.gameAgentProcess = null;
    }
  }

  /**
   * Restart the Game Agent (stop + start)
   */
  private async restartGameAgent(): Promise<void> {
    if (!this.manageGameAgent) {
      console.log(`${PREFIX} Restart Minecraft agents manually to apply changes.`);
      return;
    }

    this.stopGameAgent();
    await this.sleep(2000); // Wait for graceful shutdown
    this.startGameAgent();
  }

  stop(): void {
    console.log(`${PREFIX} Stopping...`);
    this.isRunning = false;
    this.stopGameAgent();
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
