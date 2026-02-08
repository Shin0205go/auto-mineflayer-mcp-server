#!/usr/bin/env node

/**
 * Dev Agent - Self-Improving Agent
 *
 * Two modes of improvement:
 * 1. Source code fixing: Monitors tool execution logs, analyzes failure patterns,
 *    and modifies source code to fix issues (via MCP filesystem + Claude SDK Edit).
 * 2. Behavior tuning: Monitors Game Agent loop results and tunes agent-config.json
 *    personality/priorities/thresholds (via dev_save_config MCP tool).
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
import type { LoopResult, AgentConfig, EvolutionEntry, ConfigChange } from "../types/agent-config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, "..", "..");

const MCP_WS_URL = process.env.MCP_WS_URL || "ws://localhost:8765";
const ANALYSIS_INTERVAL = 60000; // 1 minute (for source code fixing)
const MIN_FAILURES_TO_ANALYZE = 3;
const TUNING_BUFFER_SIZE = 5;          // Analyze config every N loop results
const TUNING_BUFFER_TIMEOUT = 180000;  // Or after 3 minutes

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
  alreadyApplied?: boolean;
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
  private isImproving = false;

  // MCP Filesystem client
  private fsClient: Client | null = null;
  private fsTransport: StdioClientTransport | null = null;

  // Config tuning state
  private loopResultBuffer: LoopResult[] = [];
  private lastTuningTime = Date.now();
  private tuningCount = 0;

  // ========== MCP Filesystem ==========

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

  async editFile(relativePath: string, oldText: string, newText: string): Promise<{ success: boolean; error?: string }> {
    const content = await this.readFile(relativePath);
    if (content === null) {
      return { success: false, error: `Failed to read file: ${relativePath}` };
    }

    if (!content.includes(oldText)) {
      const normalizedContent = content.replace(/\r\n/g, '\n');
      const normalizedOldText = oldText.replace(/\r\n/g, '\n');

      if (!normalizedContent.includes(normalizedOldText)) {
        return { success: false, error: `Old text not found in file (${oldText.length} chars)` };
      }

      const newContent = normalizedContent.replace(normalizedOldText, newText);
      const writeSuccess = await this.writeFile(relativePath, newContent);
      return writeSuccess
        ? { success: true }
        : { success: false, error: "Failed to write file" };
    }

    const matchCount = content.split(oldText).length - 1;
    if (matchCount > 1) {
      console.log(`${PREFIX} ${C.yellow}Warning: ${matchCount} matches found, replacing first only${C.reset}`);
    }

    const newContent = content.replace(oldText, newText);
    const writeSuccess = await this.writeFile(relativePath, newContent);

    return writeSuccess
      ? { success: true }
      : { success: false, error: "Failed to write file" };
  }

  // ========== WebSocket Connection ==========

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(MCP_WS_URL);

      this.ws.on("open", async () => {
        console.log(`${PREFIX} Connected to MCP WS Server`);
        await this.callTool("dev_subscribe", {});
        console.log(`${PREFIX} Subscribed to tool execution logs & loop results`);
        resolve();
      });

      this.ws.on("message", (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString());

          // Handle tool log notifications (for source code fixing)
          if (msg.method === "notifications/toolLog") {
            this.handleToolLog(msg.params as ToolExecutionLog);
            return;
          }

          // Handle loop result notifications (for config tuning)
          if (msg.method === "notifications/loopResult") {
            this.handleLoopResult(msg.params as LoopResult);
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

  // ========== Tool Log Handling (Source Code Fixing) ==========

  private handleToolLog(log: ToolExecutionLog): void {
    const time = new Date(log.timestamp).toLocaleTimeString("ja-JP");
    const status = log.result === "success" ? `${C.green}✓${C.reset}` : `${C.red}✗${C.reset}`;

    console.log(`${PREFIX} [${time}] ${status} ${log.tool} (${log.duration}ms) - ${log.agentName}`);

    if (log.result === "failure") {
      console.log(`${PREFIX}   ${C.red}Error: ${log.error}${C.reset}`);
    }

    this.recentLogs.push(log);

    if (this.recentLogs.length > 100) {
      this.recentLogs.shift();
    }
  }

  // ========== Loop Result Handling (Config Tuning) ==========

  private handleLoopResult(result: LoopResult): void {
    console.log(
      `${PREFIX} Loop #${result.loopNumber} received ` +
      `(success=${result.success}, tools=${result.toolCalls?.length || 0})`
    );

    this.loopResultBuffer.push(result);
  }

  // ========== Main Loop ==========

  async start(): Promise<void> {
    console.log(`
${C.yellow}╔══════════════════════════════════════════════════════════════╗
║              Dev Agent - Self-Improving System               ║
║    Source code fixing + Behavior config tuning                ║
╚══════════════════════════════════════════════════════════════╝${C.reset}
`);

    // Connect to MCP Filesystem server first
    await this.connectFilesystem();

    await this.connect();
    this.isRunning = true;

    // Start Game Agent if managed mode
    if (this.manageGameAgent) {
      console.log(`${PREFIX} Managed mode enabled - will control Game Agent lifecycle`);
      await this.sleep(2000);
      this.startGameAgent();
    }

    await this.writeToBoard("🔧 DevAgent 起動 - ソースコード修正 + 行動チューニング");

    // Main loop
    while (this.isRunning) {
      await this.sleep(10000); // Check every 10 seconds

      const now = Date.now();

      // Check for source code fixing (tool failure analysis)
      if (now - this.lastAnalysisTime > ANALYSIS_INTERVAL) {
        await this.analyzeAndImprove();
        this.lastAnalysisTime = now;
      }

      // Check for config tuning (loop result analysis)
      const bufferFull = this.loopResultBuffer.length >= TUNING_BUFFER_SIZE;
      const tuningTimeout = now - this.lastTuningTime > TUNING_BUFFER_TIMEOUT;
      const hasResults = this.loopResultBuffer.length > 0;

      if (hasResults && (bufferFull || tuningTimeout)) {
        await this.analyzeAndTune();
      }
    }
  }

  // ========== Source Code Fixing ==========

  private async analyzeAndImprove(): Promise<void> {
    const failures = this.recentLogs.filter(l => l.result === "failure");

    if (failures.length < MIN_FAILURES_TO_ANALYZE) {
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

    const sortedTools = Object.entries(summary)
      .sort((a, b) => b[1].count - a[1].count);

    if (sortedTools.length === 0) {
      if (this.manageGameAgent) {
        this.startGameAgent();
      }
      return;
    }

    const [toolName, toolFailures] = sortedTools[0];
    console.log(`${PREFIX} Most failing tool: ${toolName} (${toolFailures.count} failures)`);
    console.log(`${PREFIX} Errors: ${toolFailures.errors.join(", ")}`);

    const MAX_ATTEMPTS = 20;
    const MAX_SAME_ERROR_RETRIES = 3;
    let buildSuccess = false;
    let attempts = 0;

    let lastModifiedFile: string | null = null;
    let lastErrorLine: string | null = null;
    let sameErrorCount = 0;

    while (!buildSuccess && attempts < MAX_ATTEMPTS) {
      attempts++;
      console.log(`${PREFIX} ${C.cyan}Improvement attempt ${attempts}${C.reset}`);

      const plan = await this.generateImprovementPlan(
        toolName,
        toolFailures,
        attempts > 1 ? this.lastBuildError : undefined,
        lastModifiedFile
      );

      if (!plan) {
        console.log(`${PREFIX} ${C.red}Failed to generate improvement plan, retrying...${C.reset}`);
        await this.sleep(5000);
        continue;
      }

      console.log(`${PREFIX} Improvement plan generated for ${toolName}`);
      console.log(`${PREFIX} Problem: ${plan.problem}`);
      console.log(`${PREFIX} File: ${plan.filePath}`);

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

      lastModifiedFile = plan.filePath;
      const fixDescription = `${plan.functionName || plan.suggestedFix}: ${plan.problem}`;

      buildSuccess = await this.rebuild();

      if (buildSuccess) {
        await this.writeToBoard(`🔧 コード修正完了: ${toolName} - ${fixDescription.slice(0, 100)}`);
      }

      if (!buildSuccess) {
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
            break;
          }
        } else {
          sameErrorCount = 1;
          lastErrorLine = currentErrorLine;
        }

        console.log(`${PREFIX} ${C.yellow}Build failed, will try again...${C.reset}`);
        await this.sleep(2000);
      }
    }

    this.recentLogs = this.recentLogs.filter(l => l.tool !== toolName);

    if (buildSuccess) {
      console.log(`${PREFIX} ${C.green}=== Improvement Cycle Complete (${attempts} attempts) ===${C.reset}`);
    } else {
      console.log(`${PREFIX} ${C.red}=== Gave up after ${MAX_ATTEMPTS} attempts. Please fix manually. ===${C.reset}`);
      await this.writeToBoard(`⚠️ コード修正失敗: ${toolName} - ${attempts}回試行後に断念。手動修正が必要です。`);
    }

    this.isImproving = false;
    if (this.manageGameAgent) {
      console.log(`${PREFIX} ${C.green}Resuming Game Agent...${C.reset}`);
      this.startGameAgent();
    }
  }

  private lastBuildError: string | undefined = undefined;

  private async findToolImplementation(toolName: string): Promise<{ file: string; func: string; found: boolean }> {
    console.log(`${PREFIX} Searching for tool: ${toolName}`);

    return new Promise((resolve) => {
      const grep = spawn("grep", ["-rn", toolName, "src/"], {
        cwd: projectRoot,
      });

      let output = "";
      grep.stdout.on("data", (data) => {
        output += data.toString();
      });

      grep.on("close", () => {
        const lines = output.trim().split("\n").filter(l => l && !l.includes("//"));

        let handlerFile: string | null = null;
        for (const line of lines) {
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

        const grepImpl = spawn("grep", ["-A", "15", toolName, handlerFile], {
          cwd: projectRoot,
        });

        let implOutput = "";
        grepImpl.stdout.on("data", (data) => {
          implOutput += data.toString();
        });

        grepImpl.on("close", () => {
          const funcMatch = implOutput.match(/botManager\.(\w+)|await\s+(\w+)\(|return\s+(\w+)\(/);
          if (funcMatch) {
            const funcName = funcMatch[1] || funcMatch[2] || funcMatch[3];
            console.log(`${PREFIX} Found implementation function: ${funcName}`);
            resolve({ file: "src/bot-manager.ts", func: funcName, found: true });
          } else {
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
    brokenFilePath?: string | null
  ): Promise<ImprovementPlan | null> {
    let filePath: string;
    let funcName: string | undefined;
    let found: boolean;

    if (buildError && brokenFilePath) {
      filePath = brokenFilePath;
      funcName = undefined;
      found = true;
      console.log(`${PREFIX} Re-reading broken file: ${filePath}`);
    } else {
      const mapping = await this.findToolImplementation(toolName);
      if (!mapping) {
        console.log(`${PREFIX} Could not find implementation for: ${toolName}`);
        return null;
      }
      filePath = mapping.file;
      funcName = mapping.func;
      found = mapping.found;
    }

    let sourceCode = await this.readFile(filePath);
    if (!sourceCode) {
      console.log(`${PREFIX} Source file not found: ${filePath}`);
      return null;
    }

    const MAX_SOURCE_SIZE = 200000;
    if (sourceCode.length > MAX_SOURCE_SIZE) {
      console.log(`${PREFIX} File very large (${sourceCode.length} chars), truncating...`);
      const targetIndex = funcName ? sourceCode.indexOf(funcName) : -1;
      if (targetIndex > 0) {
        const start = Math.max(0, targetIndex - 50000);
        const end = Math.min(sourceCode.length, targetIndex + 150000);
        sourceCode = `// ... (truncated before line ${sourceCode.slice(0, start).split('\n').length})\n${sourceCode.slice(start, end)}\n// ... (truncated after)`;
      } else {
        sourceCode = sourceCode.slice(0, MAX_SOURCE_SIZE) + "\n// ... (truncated)";
      }
    }

    const implStatus = found
      ? `✅ 実装確認済み: ${funcName || "関数"}() が ${filePath} に存在します。`
      : `⚠️ 実装が見つかりません: ${funcName || "関数"}() の実装を探しています。`;

    const buildErrorSection = buildError
      ? `
## 🚨 ビルドエラー（最優先で修正してください）:
\`\`\`
${buildError}
\`\`\`

**このビルドエラーを解決してください。** 元のランタイムエラーは後回しで構いません。
`
      : "";

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

## 現在のソースコード:
\`\`\`typescript
${sourceCode}
\`\`\`

## タスク
${buildError ? `
**ビルドエラーがあります！** まずビルドエラーを解決してください。
` : `
エラーの原因を分析し、修正してください。
`}
**Editツールを使って直接ファイルを修正してください。**

重要:
- 上記のソースコードを分析して問題箇所を特定
- Editツールで最小限の修正を適用（old_string と new_string を正確に指定）
- **console.log() を追加しない**
- ${buildError ? "ビルドエラーの行番号を参考に修正箇所を特定" : "実装確認済みなら「実装されていない」は誤り"}
- 必ずEditツールを1回は呼び出してください`;

    try {
      const { ANTHROPIC_API_KEY, ...envWithoutKey } = process.env;
      const result = query({
        prompt,
        options: {
          model: process.env.CLAUDE_MODEL || "claude-opus-4-6",
          maxTurns: 3,
          allowedTools: ["Edit"],
          permissionMode: "acceptEdits",
          cwd: projectRoot,
          env: envWithoutKey as Record<string, string>,
        },
      });

      let editApplied = false;

      for await (const msg of result) {
        if (msg.type === "tool_use_summary") {
          const summary = msg as { type: string; toolName?: string; success?: boolean };
          if (summary.toolName === "Edit" && summary.success) {
            editApplied = true;
            console.log(`${PREFIX} ${C.green}Edit applied successfully${C.reset}`);
          }
        }

        if (msg.type === "assistant" && msg.message) {
          const content = msg.message.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === "tool_use" && (block as { name?: string }).name === "Edit") {
                console.log(`${PREFIX} ${C.cyan}Edit tool invoked${C.reset}`);
                editApplied = true;
              }
            }
          }
        }
      }

      if (editApplied) {
        return {
          tool: toolName,
          problem: "Fixed by Claude using Edit tool",
          filePath,
          suggestedFix: "Applied directly",
          alreadyApplied: true,
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
    if (plan.functionName && plan.fixedFunction) {
      return this.replaceFunction(plan.filePath, plan.functionName, plan.fixedFunction);
    }

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

  private validateTypeScriptSyntax(code: string, filename: string = "temp.ts"): { valid: boolean; errors: string[] } {
    const sourceFile = ts.createSourceFile(
      filename,
      code,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );

    const errors: string[] = [];

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

  private async replaceFunction(filePath: string, functionName: string, newFunction: string): Promise<boolean> {
    const content = await this.readFile(filePath);
    if (!content) {
      console.log(`${PREFIX} ${C.red}Failed to read file: ${filePath}${C.reset}`);
      return false;
    }

    const existingFunction = this.extractFunction(content, functionName);
    if (!existingFunction) {
      console.log(`${PREFIX} ${C.red}Function not found: ${functionName}${C.reset}`);
      return false;
    }

    console.log(`${PREFIX} Found function ${functionName} (${existingFunction.length} chars)`);
    console.log(`${PREFIX} Replacing with new version (${newFunction.length} chars)`);

    const newContent = content.replace(existingFunction, newFunction);

    if (newContent === content) {
      console.log(`${PREFIX} ${C.red}Replace failed - content unchanged${C.reset}`);
      return false;
    }

    const syntaxCheck = this.validateTypeScriptSyntax(newContent, filePath);
    if (!syntaxCheck.valid) {
      console.log(`${PREFIX} ${C.red}Syntax error in generated code - rejecting fix${C.reset}`);
      syntaxCheck.errors.slice(0, 5).forEach(err => {
        console.log(`${PREFIX}   ${C.red}${err}${C.reset}`);
      });
      return false;
    }

    console.log(`${PREFIX} ${C.green}Syntax check passed${C.reset}`);

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
          this.lastBuildError = output;
          resolve(false);
        }
      });
    });
  }

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
          const buildOk = await this.rebuild();
          resolve(buildOk);
        } else {
          console.error(`${PREFIX} ${C.red}Failed to restore from git${C.reset}`);
          resolve(false);
        }
      });
    });
  }

  private extractFunction(source: string, funcName: string): string | null {
    const lines = source.split("\n");

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
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].match(new RegExp(`async\\s+${funcName}\\s*\\(`)) ||
            lines[i].match(new RegExp(`${funcName}\\s*\\(`))) {
          const trimmed = lines[i].trimStart();
          if (trimmed.startsWith("async") || trimmed.startsWith(funcName)) {
            funcStartLine = i;
            break;
          }
        }
      }
    }

    if (funcStartLine === -1) return null;

    const funcIndent = lines[funcStartLine].match(/^(\s*)/)?.[1] || "";
    const closingPattern = new RegExp(`^${funcIndent}}\\s*$`);

    let funcEndLine = -1;
    for (let i = funcStartLine + 1; i < lines.length; i++) {
      if (closingPattern.test(lines[i])) {
        funcEndLine = i;
        break;
      }
      const lineIndent = lines[i].match(/^(\s*)/)?.[1] || "";
      if (lines[i].trim() && lineIndent.length < funcIndent.length) {
        break;
      }
    }

    if (funcEndLine === -1) return null;

    return lines.slice(funcStartLine, funcEndLine + 1).join("\n");
  }

  // ========== Config Tuning ==========

  private async analyzeAndTune(): Promise<void> {
    this.tuningCount++;
    const results = [...this.loopResultBuffer];
    this.loopResultBuffer = [];
    this.lastTuningTime = Date.now();

    console.log(`\n${PREFIX} ${C.cyan}=== Config Tuning #${this.tuningCount} (${results.length} loops) ===${C.reset}`);

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

    const prompt = this.buildTuningPrompt(currentConfig, results);

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
          model: process.env.CLAUDE_MODEL || "claude-opus-4-6",
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

      analysisResult = this.parseTuningResponse(responseText);
    } catch (e) {
      console.error(`${PREFIX} Tuning analysis failed:`, e);
      return;
    }

    if (!analysisResult) {
      console.log(`${PREFIX} No actionable config changes from analysis`);
      return;
    }

    if (analysisResult.changes.length === 0) {
      console.log(`${PREFIX} ${C.green}No config changes needed - current config is working well${C.reset}`);
      return;
    }

    console.log(`${PREFIX} ${C.yellow}Reasoning: ${analysisResult.reasoning}${C.reset}`);
    console.log(`${PREFIX} Config changes: ${analysisResult.changes.length}`);
    for (const change of analysisResult.changes) {
      console.log(`${PREFIX}   - ${change.field}: ${JSON.stringify(change.oldValue)} → ${JSON.stringify(change.newValue)} (${change.reason})`);
    }

    // Save updated config
    const newConfig = analysisResult.newConfig;
    newConfig.version = currentConfig.version + 1;
    newConfig.lastUpdated = new Date().toISOString();
    newConfig.updatedBy = "DevAgent";

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

  private buildTuningPrompt(config: AgentConfig, results: LoopResult[]): string {
    const successCount = results.filter(r => r.success).length;
    const failCount = results.length - successCount;

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

  private parseTuningResponse(text: string): {
    reasoning: string;
    changes: ConfigChange[];
    newConfig: AgentConfig;
  } | null {
    try {
      let jsonStr = text.trim();

      const jsonMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1].trim();
      }

      const objStart = jsonStr.indexOf("{");
      const objEnd = jsonStr.lastIndexOf("}");
      if (objStart !== -1 && objEnd !== -1) {
        jsonStr = jsonStr.slice(objStart, objEnd + 1);
      }

      const parsed = JSON.parse(jsonStr);

      if (!parsed.reasoning || !parsed.changes || !parsed.newConfig) {
        console.error(`${PREFIX} Invalid tuning response structure`);
        return null;
      }

      return parsed;
    } catch (e) {
      console.error(`${PREFIX} Failed to parse tuning response:`, e);
      console.error(`${PREFIX} Response text: ${text.slice(0, 500)}`);
      return null;
    }
  }

  // ========== Game Agent Process Management ==========

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

    const agentScript = join(projectRoot, "dist", "agent", "claude-agent.js");

    this.gameAgentProcess = spawn("node", [agentScript], {
      cwd: projectRoot,
      stdio: "inherit",
      env: {
        ...process.env,
        BOT_USERNAME: process.env.BOT_USERNAME || "Claude",
      },
    });

    this.gameAgentProcess.on("exit", (code) => {
      console.log(`${PREFIX} Game Agent exited with code ${code}`);
      this.gameAgentProcess = null;

      if (this.isRunning && !this.isImproving) {
        console.log(`${PREFIX} Restarting Game Agent in 5 seconds...`);
        setTimeout(() => this.startGameAgent(), 5000);
      }
    });

    console.log(`${PREFIX} Game Agent started (PID: ${this.gameAgentProcess.pid})`);
  }

  private stopGameAgent(): void {
    if (this.gameAgentProcess) {
      console.log(`${PREFIX} Stopping Game Agent...`);
      this.gameAgentProcess.kill("SIGTERM");
      this.gameAgentProcess = null;
    }
  }

  // ========== Utilities ==========

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
