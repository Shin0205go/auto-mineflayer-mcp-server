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
import ts from "typescript";
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
  functionName?: string;
  fixedFunction?: string;
  alreadyApplied?: boolean;  // Set when Claude applied fix directly via Edit tool
  // Legacy: before/after approach (deprecated)
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

  /**
   * Edit file via MCP filesystem server (pattern-based edit)
   * Uses MCP's edit_file which has whitespace normalization and better matching
   */
  async editFile(relativePath: string, oldText: string, newText: string): Promise<{ success: boolean; error?: string }> {
    // Use safer read → replace → write approach instead of MCP edit_file
    // This ensures exact string matching and prevents corruption

    const content = await this.readFile(relativePath);
    if (content === null) {
      return { success: false, error: `Failed to read file: ${relativePath}` };
    }

    // Check if oldText exists in file
    if (!content.includes(oldText)) {
      // Try with normalized whitespace
      const normalizedContent = content.replace(/\r\n/g, '\n');
      const normalizedOldText = oldText.replace(/\r\n/g, '\n');

      if (!normalizedContent.includes(normalizedOldText)) {
        return { success: false, error: `Old text not found in file (${oldText.length} chars)` };
      }

      // Use normalized versions
      const newContent = normalizedContent.replace(normalizedOldText, newText);
      const writeSuccess = await this.writeFile(relativePath, newContent);
      return writeSuccess
        ? { success: true }
        : { success: false, error: "Failed to write file" };
    }

    // Check for multiple matches (dangerous - could replace wrong one)
    const matchCount = content.split(oldText).length - 1;
    if (matchCount > 1) {
      console.log(`${PREFIX} ${C.yellow}Warning: ${matchCount} matches found, replacing first only${C.reset}`);
    }

    // Replace and write
    const newContent = content.replace(oldText, newText);
    const writeSuccess = await this.writeFile(relativePath, newContent);

    return writeSuccess
      ? { success: true }
      : { success: false, error: "Failed to write file" };
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

  /**
   * Write a message to the agent bulletin board
   */
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

    // Keep trying until build succeeds (with limit to prevent infinite loop)
    const MAX_ATTEMPTS = 20;
    const MAX_SAME_ERROR_RETRIES = 3;  // Give up if same error repeats this many times
    let buildSuccess = false;
    let attempts = 0;

    let lastModifiedFile: string | null = null;
    let lastErrorLine: string | null = null;
    let sameErrorCount = 0;

    while (!buildSuccess && attempts < MAX_ATTEMPTS) {
      attempts++;
      console.log(`${PREFIX} ${C.cyan}Improvement attempt ${attempts}${C.reset}`);

      // Generate improvement plan using Claude
      // If we have a build error, pass the broken file path so we can re-read it
      const plan = await this.generateImprovementPlan(
        toolName,
        toolFailures,
        attempts > 1 ? this.lastBuildError : undefined,
        lastModifiedFile  // Pass the file that was modified (may be broken)
      );

      if (!plan) {
        console.log(`${PREFIX} ${C.red}Failed to generate improvement plan, retrying...${C.reset}`);
        await this.sleep(5000);
        continue;
      }

      console.log(`${PREFIX} Improvement plan generated for ${toolName}`);
      console.log(`${PREFIX} Problem: ${plan.problem}`);
      console.log(`${PREFIX} File: ${plan.filePath}`);

      // Apply the fix (skip if Claude already applied via Edit tool)
      let applied = plan.alreadyApplied || false;
      if (!applied) {
        applied = await this.applyFix(plan);
      } else {
        console.log(`${PREFIX} ${C.green}Fix already applied by Claude${C.reset}`);
      }

      if (!applied) {
        console.log(`${PREFIX} ${C.red}Failed to apply fix, retrying...${C.reset}`);
        await this.sleep(3000);
        continue;
      }

      // Track which file was modified and the fix details
      lastModifiedFile = plan.filePath;
      const fixDescription = `${plan.functionName || plan.suggestedFix}: ${plan.problem}`;

      // Try to build
      buildSuccess = await this.rebuild();

      // If successful, notify via board
      if (buildSuccess) {
        await this.writeToBoard(`🔧 コード修正完了: ${toolName} - ${fixDescription.slice(0, 100)}`);
      }

      if (!buildSuccess) {
        // Extract error line from build error to detect same error loop
        const errorLineMatch = this.lastBuildError?.match(/:(\d+):/);
        const currentErrorLine = errorLineMatch ? errorLineMatch[1] : null;

        if (currentErrorLine && currentErrorLine === lastErrorLine) {
          sameErrorCount++;
          console.log(`${PREFIX} ${C.yellow}Same error line ${currentErrorLine} (${sameErrorCount}/${MAX_SAME_ERROR_RETRIES})${C.reset}`);

          if (sameErrorCount >= MAX_SAME_ERROR_RETRIES) {
            console.log(`${PREFIX} ${C.red}Same build error repeated ${MAX_SAME_ERROR_RETRIES} times. Restoring from git...${C.reset}`);
            if (lastModifiedFile) {
              await this.restoreFromGit(lastModifiedFile);
            }
            break;  // Give up on this improvement cycle
          }
        } else {
          sameErrorCount = 1;
          lastErrorLine = currentErrorLine;
        }

        console.log(`${PREFIX} ${C.yellow}Build failed, will try again...${C.reset}`);
        await this.sleep(2000);
      }
    }

    // Clear analyzed logs
    this.recentLogs = this.recentLogs.filter(l => l.tool !== toolName);

    if (buildSuccess) {
      console.log(`${PREFIX} ${C.green}=== Improvement Cycle Complete (${attempts} attempts) ===${C.reset}`);
    } else {
      console.log(`${PREFIX} ${C.red}=== Gave up after ${MAX_ATTEMPTS} attempts. Please fix manually. ===${C.reset}`);
      await this.writeToBoard(`⚠️ コード修正失敗: ${toolName} - ${attempts}回試行後に断念。手動修正が必要です。`);
    }

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
   * Returns found: true if actually found, false if defaulted
   */
  private async findToolImplementation(toolName: string): Promise<{ file: string; func: string; found: boolean }> {
    // Search for the tool name directly in the codebase
    // This finds where the tool is handled (case "minecraft_xxx":) and its implementation
    console.log(`${PREFIX} Searching for tool: ${toolName}`);

    return new Promise((resolve) => {
      // Simple grep for the tool name - no shell escaping issues
      const grep = spawn("grep", ["-rn", toolName, "src/"], {
        cwd: projectRoot,
      });

      let output = "";
      grep.stdout.on("data", (data) => {
        output += data.toString();
      });

      grep.on("close", () => {
        const lines = output.trim().split("\n").filter(l => l && !l.includes("//"));

        // Find the case handler in tools/*.ts (preferred) or mcp-ws-server.ts
        let handlerFile: string | null = null;
        for (const line of lines) {
          // Look for case statements with the tool name
          if (line.includes("case") && (line.includes(`"${toolName}"`) || line.includes(`'${toolName}'`))) {
            const match = line.match(/^([^:]+):/);
            if (match) {
              handlerFile = match[1];
              console.log(`${PREFIX} Found case handler: ${line.slice(0, 100)}`);
              break;
            }
          }
        }

        if (!handlerFile) {
          console.log(`${PREFIX} Tool handler not found in case statements, defaulting to bot-manager.ts`);
          resolve({ file: "src/bot-manager.ts", func: toolName, found: false });
          return;
        }

        console.log(`${PREFIX} Found tool handler in: ${handlerFile}`);

        // Now search for the actual implementation call in that handler
        // Read the handler file and find the case block
        const grepImpl = spawn("grep", ["-A", "15", toolName, handlerFile], {
          cwd: projectRoot,
        });

        let implOutput = "";
        grepImpl.stdout.on("data", (data) => {
          implOutput += data.toString();
        });

        grepImpl.on("close", () => {
          // Extract the function being called (botManager.xxx or handleXxxTool)
          const funcMatch = implOutput.match(/botManager\.(\w+)|await\s+(\w+)\(|return\s+(\w+)\(/);
          if (funcMatch) {
            const funcName = funcMatch[1] || funcMatch[2] || funcMatch[3];
            console.log(`${PREFIX} Found implementation function: ${funcName}`);
            resolve({ file: "src/bot-manager.ts", func: funcName, found: true });
          } else {
            // Just use the tool name as the function name
            console.log(`${PREFIX} Using tool name as function: ${toolName}`);
            resolve({ file: handlerFile, func: toolName, found: true });
          }
        });
      });
    });
  }

  private async generateImprovementPlan(
    toolName: string,
    failures: FailureSummary[string],
    buildError?: string,
    brokenFilePath?: string | null  // File that was modified and may have broken code
  ): Promise<ImprovementPlan | null> {
    let filePath: string;
    let funcName: string | undefined;
    let found: boolean;

    // If we have a build error and know which file was modified, use that file
    if (buildError && brokenFilePath) {
      filePath = brokenFilePath;
      funcName = undefined;  // Don't extract function - show the whole broken area
      found = true;
      console.log(`${PREFIX} Re-reading broken file: ${filePath}`);
    } else {
      // Dynamically find where the tool is implemented
      const mapping = await this.findToolImplementation(toolName);
      if (!mapping) {
        console.log(`${PREFIX} Could not find implementation for: ${toolName}`);
        return null;
      }
      filePath = mapping.file;
      funcName = mapping.func;
      found = mapping.found;
    }

    // Read source file via MCP (this will read the current state, including any broken code)
    let sourceCode = await this.readFile(filePath);
    if (!sourceCode) {
      console.log(`${PREFIX} Source file not found: ${filePath}`);
      return null;
    }

    // Read entire file - Claude can handle large files
    // Only truncate for extremely large files (>200KB)
    const MAX_SOURCE_SIZE = 200000; // 200KB limit
    if (sourceCode.length > MAX_SOURCE_SIZE) {
      console.log(`${PREFIX} File very large (${sourceCode.length} chars), truncating...`);
      // Try to show area around the function or error
      const targetIndex = funcName ? sourceCode.indexOf(funcName) : -1;
      if (targetIndex > 0) {
        const start = Math.max(0, targetIndex - 50000);
        const end = Math.min(sourceCode.length, targetIndex + 150000);
        sourceCode = `// ... (truncated before line ${sourceCode.slice(0, start).split('\n').length})\n${sourceCode.slice(start, end)}\n// ... (truncated after)`;
      } else {
        sourceCode = sourceCode.slice(0, MAX_SOURCE_SIZE) + "\n// ... (truncated)";
      }
    }

    // Implementation status info for prompt
    const implStatus = found
      ? `✅ 実装確認済み: ${funcName || "関数"}() が ${filePath} に存在します。`
      : `⚠️ 実装が見つかりません: ${funcName || "関数"}() の実装を探しています。`;

    // Build error takes priority - if there's a build error, focus on THAT
    const buildErrorSection = buildError
      ? `
## 🚨 ビルドエラー（最優先で修正してください）:
\`\`\`
${buildError}
\`\`\`

**このビルドエラーを解決してください。** 元のランタイムエラーは後回しで構いません。
`
      : "";

    // Create analysis prompt - Claude will use Edit tool directly
    const prompt = `あなたはMinecraft MCPツールのデバッガーです。

## 失敗しているツール: ${toolName}
${buildErrorSection}
## 実装状況:
${implStatus}

## ランタイムエラー${buildError ? "（ビルドエラー解決後に対処）" : ""}:
${failures.errors.map(e => `- "${e}"`).join("\n")}

## 失敗例:
${JSON.stringify(failures.examples.slice(0, 2), null, 2)}

## 修正対象ファイル: ${filePath}

## タスク
${buildError ? `
**ビルドエラーがあります！** まずビルドエラーを解決してください。
` : `
エラーの原因を分析し、修正してください。
`}
**Editツールを使って直接ファイルを修正してください。**

重要:
- まずReadツールでファイルを読んで問題箇所を確認
- Editツールで最小限の修正を適用
- **console.log() を追加しない**
- ${buildError ? "ビルドエラーの行番号を参考に修正箇所を特定" : "実装確認済みなら「実装されていない」は誤り"}`;

    try {
      const { ANTHROPIC_API_KEY, ...envWithoutKey } = process.env;
      const result = query({
        prompt,
        options: {
          model: "claude-opus-4-5-20251101",
          maxTurns: 10,
          allowedTools: ["Read", "Edit", "Grep", "Glob"],
          permissionMode: "acceptEdits",
          cwd: projectRoot,
          env: envWithoutKey as Record<string, string>,
        },
      });

      let editApplied = false;

      for await (const msg of result) {
        // Track if Edit tool was used via tool_use_summary
        if (msg.type === "tool_use_summary") {
          const summary = msg as { type: string; toolName?: string; success?: boolean };
          if (summary.toolName === "Edit" && summary.success) {
            editApplied = true;
            console.log(`${PREFIX} ${C.green}Edit applied successfully${C.reset}`);
          }
        }

        // Also check assistant messages for Edit tool use
        if (msg.type === "assistant" && msg.message) {
          const content = msg.message.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === "tool_use" && (block as { name?: string }).name === "Edit") {
                console.log(`${PREFIX} ${C.cyan}Edit tool invoked${C.reset}`);
                editApplied = true;  // Assume success if Edit was called
              }
            }
          }
        }
      }

      if (editApplied) {
        // Claude already applied the fix using Edit tool
        return {
          tool: toolName,
          problem: "Fixed by Claude using Edit tool",
          filePath,
          suggestedFix: "Applied directly",
          alreadyApplied: true,  // Flag to skip applyFix
        };
      }

      console.log(`${PREFIX} ${C.yellow}No edit was applied${C.reset}`);
      return null;
    } catch (e) {
      console.error(`${PREFIX} Failed to generate improvement plan:`, e);
    }

    return null;
  }

  private async applyFix(plan: ImprovementPlan): Promise<boolean> {
    // New approach: replace entire function
    if (plan.functionName && plan.fixedFunction) {
      return this.replaceFunction(plan.filePath, plan.functionName, plan.fixedFunction);
    }

    // Legacy fallback: before/after approach
    if (!plan.code?.before || !plan.code?.after) {
      console.log(`${PREFIX} No code changes specified`);
      return false;
    }

    const result = await this.editFile(plan.filePath, plan.code.before, plan.code.after);

    if (result.success) {
      console.log(`${PREFIX} ${C.green}Applied fix to ${plan.filePath}${C.reset}`);
      return true;
    } else {
      console.log(`${PREFIX} ${C.red}Failed to apply fix: ${result.error}${C.reset}`);
      console.log(`${PREFIX} Looking for:`, plan.code.before.slice(0, 100));
      return false;
    }
  }

  /**
   * Validate TypeScript syntax before applying changes
   * Returns { valid: true } or { valid: false, errors: [...] }
   */
  private validateTypeScriptSyntax(code: string, filename: string = "temp.ts"): { valid: boolean; errors: string[] } {
    const sourceFile = ts.createSourceFile(
      filename,
      code,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );

    const errors: string[] = [];

    // Check for parse errors (syntax errors)
    const parseErrors = (sourceFile as any).parseDiagnostics;
    if (parseErrors && parseErrors.length > 0) {
      for (const diag of parseErrors) {
        const message = ts.flattenDiagnosticMessageText(diag.messageText, "\n");
        const pos = diag.start !== undefined
          ? sourceFile.getLineAndCharacterOfPosition(diag.start)
          : { line: 0, character: 0 };
        errors.push(`Line ${pos.line + 1}: ${message}`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Replace an entire function in a file
   */
  private async replaceFunction(filePath: string, functionName: string, newFunction: string): Promise<boolean> {
    const content = await this.readFile(filePath);
    if (!content) {
      console.log(`${PREFIX} ${C.red}Failed to read file: ${filePath}${C.reset}`);
      return false;
    }

    // Find the existing function using extractFunction logic
    const existingFunction = this.extractFunction(content, functionName);
    if (!existingFunction) {
      console.log(`${PREFIX} ${C.red}Function not found: ${functionName}${C.reset}`);
      return false;
    }

    console.log(`${PREFIX} Found function ${functionName} (${existingFunction.length} chars)`);
    console.log(`${PREFIX} Replacing with new version (${newFunction.length} chars)`);

    // Replace the function
    const newContent = content.replace(existingFunction, newFunction);

    if (newContent === content) {
      console.log(`${PREFIX} ${C.red}Replace failed - content unchanged${C.reset}`);
      return false;
    }

    // Validate syntax BEFORE writing
    const syntaxCheck = this.validateTypeScriptSyntax(newContent, filePath);
    if (!syntaxCheck.valid) {
      console.log(`${PREFIX} ${C.red}Syntax error in generated code - rejecting fix${C.reset}`);
      syntaxCheck.errors.slice(0, 5).forEach(err => {
        console.log(`${PREFIX}   ${C.red}${err}${C.reset}`);
      });
      return false;
    }

    console.log(`${PREFIX} ${C.green}Syntax check passed${C.reset}`);

    // Write back
    const success = await this.writeFile(filePath, newContent);
    if (success) {
      console.log(`${PREFIX} ${C.green}Replaced function ${functionName} in ${filePath}${C.reset}`);
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

      let output = "";

      // Capture both stdout and stderr (TypeScript errors go to stdout)
      build.stdout.on("data", (data) => {
        output += data.toString();
      });
      build.stderr.on("data", (data) => {
        output += data.toString();
      });

      build.on("close", (code) => {
        if (code === 0) {
          console.log(`${PREFIX} ${C.green}Build successful!${C.reset}`);
          this.lastBuildError = undefined;
          resolve(true);
        } else {
          console.error(`${PREFIX} ${C.red}Build failed!${C.reset}`);
          console.error(output);
          // Store error for next improvement attempt
          this.lastBuildError = output;
          resolve(false);
        }
      });
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Restore a file from git when build errors can't be fixed
   */
  private async restoreFromGit(filePath: string): Promise<boolean> {
    return new Promise((resolve) => {
      const relativePath = filePath.startsWith(projectRoot)
        ? filePath.slice(projectRoot.length + 1)
        : filePath;

      console.log(`${PREFIX} Restoring ${relativePath} from git...`);

      const git = spawn("git", ["checkout", relativePath], {
        cwd: projectRoot,
        stdio: "pipe",
      });

      git.on("close", async (code) => {
        if (code === 0) {
          console.log(`${PREFIX} ${C.green}Restored ${relativePath} from git${C.reset}`);
          // Verify build works after restore
          const buildOk = await this.rebuild();
          resolve(buildOk);
        } else {
          console.error(`${PREFIX} ${C.red}Failed to restore from git${C.reset}`);
          resolve(false);
        }
      });
    });
  }

  /**
   * Extract a function from source code by name
   * Uses indentation-based extraction for reliability (works with well-formatted TypeScript)
   * Falls back to brace counting if indentation method fails
   */
  private extractFunction(source: string, funcName: string): string | null {
    const lines = source.split("\n");

    // Find the function definition line
    // Match patterns like "  async funcName(" or "  funcName(" at class method level (2 spaces)
    const funcPatterns = [
      new RegExp(`^  async\\s+${funcName}\\s*\\(`),
      new RegExp(`^  ${funcName}\\s*\\(`),
      new RegExp(`^  ${funcName}\\s*=\\s*async`),
    ];

    let funcStartLine = -1;
    for (let i = 0; i < lines.length; i++) {
      for (const pattern of funcPatterns) {
        if (pattern.test(lines[i])) {
          funcStartLine = i;
          break;
        }
      }
      if (funcStartLine !== -1) break;
    }

    if (funcStartLine === -1) {
      // Try without indentation requirement (for nested functions or different formatting)
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].match(new RegExp(`async\\s+${funcName}\\s*\\(`)) ||
            lines[i].match(new RegExp(`${funcName}\\s*\\(`))) {
          // Make sure it's not a call (no . or await before)
          const trimmed = lines[i].trimStart();
          if (trimmed.startsWith("async") || trimmed.startsWith(funcName)) {
            funcStartLine = i;
            break;
          }
        }
      }
    }

    if (funcStartLine === -1) return null;

    // Detect indentation of the function definition
    const funcIndent = lines[funcStartLine].match(/^(\s*)/)?.[1] || "";
    const closingPattern = new RegExp(`^${funcIndent}}\\s*$`);

    // Find the closing brace at the same indentation level
    let funcEndLine = -1;
    for (let i = funcStartLine + 1; i < lines.length; i++) {
      if (closingPattern.test(lines[i])) {
        funcEndLine = i;
        break;
      }
      // Safety: if we hit a line with less indentation that's not empty, stop
      const lineIndent = lines[i].match(/^(\s*)/)?.[1] || "";
      if (lines[i].trim() && lineIndent.length < funcIndent.length) {
        break;
      }
    }

    if (funcEndLine === -1) return null;

    // Extract the function
    return lines.slice(funcStartLine, funcEndLine + 1).join("\n");
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
