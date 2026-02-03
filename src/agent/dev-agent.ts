#!/usr/bin/env node

/**
 * Dev Agent - Self-Improving Agent
 *
 * Monitors tool execution logs from Minecraft agents,
 * analyzes failure patterns, and modifies source code to fix issues.
 * Uses MCP filesystem server for file operations.
 */

import "dotenv/config";
import { spawn, ChildProcess } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import WebSocket from "ws";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
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
  private gameAgentProcess: ChildProcess | null = null;
  private manageGameAgent = process.env.MANAGE_GAME_AGENT === "true";
  private isImproving = false;  // Flag to prevent auto-restart during improvement

  // MCP Filesystem client
  private fsClient: Client | null = null;
  private fsTransport: StdioClientTransport | null = null;

  /**
   * Connect to MCP Filesystem server via stdio
   */
  async connectFilesystem(): Promise<void> {
    console.log(`${PREFIX} Starting MCP Filesystem server...`);

    this.fsTransport = new StdioClientTransport({
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", projectRoot],
    });

    this.fsClient = new Client({
      name: "dev-agent",
      version: "1.0.0",
    }, {
      capabilities: {},
    });

    await this.fsClient.connect(this.fsTransport);
    console.log(`${PREFIX} ${C.green}Connected to MCP Filesystem server${C.reset}`);
  }

  /**
   * Read file via MCP filesystem server
   */
  async readFile(relativePath: string): Promise<string | null> {
    if (!this.fsClient) {
      console.error(`${PREFIX} Filesystem client not connected`);
      return null;
    }

    try {
      const result = await this.fsClient.callTool({
        name: "read_text_file",
        arguments: { path: join(projectRoot, relativePath) },
      });

      // Extract text content from result
      if (result.content && Array.isArray(result.content)) {
        for (const item of result.content) {
          if (item.type === "text") {
            return item.text;
          }
        }
      }
      return null;
    } catch (e) {
      console.error(`${PREFIX} Failed to read file ${relativePath}:`, e);
      return null;
    }
  }

  /**
   * Write file via MCP filesystem server
   */
  async writeFile(relativePath: string, content: string): Promise<boolean> {
    if (!this.fsClient) {
      console.error(`${PREFIX} Filesystem client not connected`);
      return false;
    }

    try {
      await this.fsClient.callTool({
        name: "write_file",
        arguments: {
          path: join(projectRoot, relativePath),
          content,
        },
      });
      return true;
    } catch (e) {
      console.error(`${PREFIX} Failed to write file ${relativePath}:`, e);
      return false;
    }
  }

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

    // Connect to MCP Filesystem server first
    await this.connectFilesystem();

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
    this.isImproving = true;
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

    // Keep trying until build succeeds (no limit)
    let buildSuccess = false;
    let attempts = 0;

    while (!buildSuccess) {
      attempts++;
      console.log(`${PREFIX} ${C.cyan}Improvement attempt ${attempts}${C.reset}`);

      // Generate improvement plan using Claude
      const plan = await this.generateImprovementPlan(toolName, toolFailures, attempts > 1 ? this.lastBuildError : undefined);

      if (!plan) {
        console.log(`${PREFIX} ${C.red}Failed to generate improvement plan, retrying...${C.reset}`);
        await this.sleep(5000);
        continue;
      }

      console.log(`${PREFIX} Improvement plan generated for ${toolName}`);
      console.log(`${PREFIX} Problem: ${plan.problem}`);
      console.log(`${PREFIX} File: ${plan.filePath}`);

      // Apply the fix using MCP filesystem
      const applied = await this.applyFix(plan);

      if (!applied) {
        console.log(`${PREFIX} ${C.red}Failed to apply fix, retrying...${C.reset}`);
        await this.sleep(3000);
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

    console.log(`${PREFIX} ${C.green}=== Improvement Cycle Complete (${attempts} attempts) ===${C.reset}`);

    // Restart Game Agent
    this.isImproving = false;
    if (this.manageGameAgent) {
      console.log(`${PREFIX} ${C.green}Resuming Game Agent...${C.reset}`);
      this.startGameAgent();
    }
  }

  private lastBuildError: string | undefined = undefined;

  /**
   * Dynamically find where a tool is implemented using grep
   */
  private async findToolImplementation(toolName: string): Promise<{ file: string; func: string } | null> {
    // Convert tool name to likely function name
    // minecraft_smelt -> smeltItem, minecraft_craft -> craftItem, etc.
    const parts = toolName.replace("minecraft_", "").split("_");
    const funcName = parts[0] + parts.slice(1).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join("");

    // Also try: minecraft_get_surroundings -> getSurroundings
    const altFuncName = parts.map((p, i) => i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1)).join("");

    console.log(`${PREFIX} Searching for function: ${funcName} or ${altFuncName}`);

    return new Promise((resolve) => {
      // Search for function definition in src/
      const grep = spawn("grep", ["-rn", "-E", `(async\\s+)?(${funcName}|${altFuncName})\\s*\\(`, "src/"], {
        cwd: projectRoot,
      });

      let output = "";
      grep.stdout.on("data", (data) => {
        output += data.toString();
      });

      grep.on("close", () => {
        const lines = output.trim().split("\n").filter(l => l);

        // Prioritize bot-manager.ts results (actual implementation)
        for (const line of lines) {
          if (line.includes("bot-manager.ts") && !line.includes("//")) {
            const match = line.match(/^([^:]+):/);
            if (match) {
              console.log(`${PREFIX} Found implementation in: ${match[1]}`);
              resolve({ file: match[1], func: funcName });
              return;
            }
          }
        }

        // Fall back to first .ts file found
        for (const line of lines) {
          if (line.includes(".ts:") && !line.includes("//")) {
            const match = line.match(/^([^:]+):/);
            if (match) {
              console.log(`${PREFIX} Found in: ${match[1]}`);
              resolve({ file: match[1], func: funcName });
              return;
            }
          }
        }

        // Default to bot-manager.ts
        console.log(`${PREFIX} Not found, defaulting to bot-manager.ts`);
        resolve({ file: "src/bot-manager.ts", func: funcName });
      });
    });
  }

  private async generateImprovementPlan(
    toolName: string,
    failures: FailureSummary[string],
    buildError?: string
  ): Promise<ImprovementPlan | null> {
    // Dynamically find where the tool is implemented
    const mapping = await this.findToolImplementation(toolName);
    if (!mapping) {
      console.log(`${PREFIX} Could not find implementation for: ${toolName}`);
      return null;
    }

    const filePath = mapping.file;

    // Read source file via MCP
    let sourceCode = await this.readFile(filePath);
    if (!sourceCode) {
      console.log(`${PREFIX} Source file not found: ${filePath}`);
      return null;
    }

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
      console.error(`${PREFIX} Failed to generate improvement plan:`, e);
    }

    return null;
  }

  private async applyFix(plan: ImprovementPlan): Promise<boolean> {
    if (!plan.code?.before || !plan.code?.after) {
      console.log(`${PREFIX} No code changes specified`);
      return false;
    }

    // Read current file via MCP
    const currentCode = await this.readFile(plan.filePath);
    if (!currentCode) {
      console.log(`${PREFIX} Could not read file: ${plan.filePath}`);
      return false;
    }

    if (!currentCode.includes(plan.code.before)) {
      console.log(`${PREFIX} Could not find code to replace`);
      console.log(`${PREFIX} Looking for:`, plan.code.before.slice(0, 100));
      return false;
    }

    // Apply the fix
    const newCode = currentCode.replace(plan.code.before, plan.code.after);

    // Write via MCP (no backup)
    const success = await this.writeFile(plan.filePath, newCode);

    if (success) {
      console.log(`${PREFIX} ${C.green}Applied fix to ${plan.filePath}${C.reset}`);
    }

    return success;
  }

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

      // Auto-restart after 5 seconds if still running and not improving
      if (this.isRunning && !this.isImproving) {
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

  stop(): void {
    console.log(`${PREFIX} Stopping...`);
    this.isRunning = false;
    this.stopGameAgent();
    if (this.ws) {
      this.ws.close();
    }
    if (this.fsClient) {
      this.fsClient.close();
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
