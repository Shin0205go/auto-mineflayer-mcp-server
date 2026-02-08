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

  // Config tuning state
  private loopResultBuffer: LoopResult[] = [];
  private lastTuningTime = Date.now();
  private tuningCount = 0;


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

  private async subscribeToDev(): Promise<void> {
    await this.callTool("dev_subscribe", {});
  }

  private async getAgentConfig(): Promise<AgentConfig> {
    const result = await this.callTool("dev_get_config", {}) as { content: { text: string }[] };
    const configText = result.content[0].text;
    return JSON.parse(configText);
  }

  private async saveAgentConfig(config: AgentConfig, changes: ConfigChange[], analysis: string): Promise<void> {
    await this.callTool("dev_save_config", {
      config,
      changes,
      analysis,
    });
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

    const MAX_ATTEMPTS = 10;
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

      console.log(`${PREFIX} ${C.green}Fix applied by Claude${C.reset}`);
      console.log(`${PREFIX} Problem: ${plan.problem}`);
      console.log(`${PREFIX} File: ${plan.filePath}`);

      lastModifiedFile = plan.filePath;
      const fixDescription = `${plan.suggestedFix}: ${plan.problem}`;

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

    if (buildError && brokenFilePath) {
      filePath = brokenFilePath;
      funcName = undefined;
      console.log(`${PREFIX} Re-reading broken file: ${filePath}`);
    } else {
      const mapping = await this.findToolImplementation(toolName);
      if (!mapping) {
        console.log(`${PREFIX} Could not find implementation for: ${toolName}`);
        return null;
      }
      filePath = mapping.file;
      funcName = mapping.func;
    }

    const prompt = `${toolName}ツールの修正タスク。

## エラー内容:
${failures.errors.map(e => `- ${e}`).join("\n")}

## 修正対象: ${filePath}
${funcName ? `関数: ${funcName}` : ""}

${buildError ? `
## ビルドエラー（最優先）:
${buildError}
` : ""}

## 指示:
1. まずReadツールで${filePath}を読んでください
2. ${buildError ? `ビルドエラーを修正` : `エラーの原因を特定して修正`}してください
3. Editツールで修正を適用してください

**重要**:
- 長い分析は不要、すぐに修正してください
- old_stringとnew_stringを正確に指定
- 最小限の変更のみ
- console.logは追加しない`;

    try {
      const { ANTHROPIC_API_KEY, ...envWithoutKey } = process.env;
      const result = query({
        prompt,
        options: {
          model: process.env.CLAUDE_MODEL || "claude-opus-4-6",
          maxTurns: 5,
          allowedTools: ["Read", "Edit"],
          permissionMode: "acceptEdits",
          cwd: projectRoot,
          env: envWithoutKey as Record<string, string>,
        },
      });

      let editApplied = false;
      let claudeResponse = "";

      for await (const msg of result) {
        // Log all messages for debugging
        console.log(`${PREFIX} ${C.dim}Claude msg type: ${msg.type}${C.reset}`);

        if (msg.type === "tool_use_summary") {
          const summary = msg as { type: string; toolName?: string; success?: boolean; error?: string };
          console.log(`${PREFIX} Tool: ${summary.toolName}, Success: ${summary.success}, Error: ${summary.error || "none"}`);
          if (summary.toolName === "Edit" && summary.success) {
            editApplied = true;
            console.log(`${PREFIX} ${C.green}Edit applied successfully${C.reset}`);
          }
        }

        if (msg.type === "assistant" && msg.message) {
          const content = msg.message.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === "text") {
                const textContent = (block as { text?: string }).text || "";
                claudeResponse += textContent;
                console.log(`${PREFIX} ${C.dim}Claude: ${textContent.slice(0, 150)}...${C.reset}`);
              }
              if (block.type === "tool_use" && (block as { name?: string }).name === "Edit") {
                console.log(`${PREFIX} ${C.cyan}Edit tool invoked${C.reset}`);
                editApplied = true;
              }
            }
          }
        }
      }

      // Log Claude's final response if no edit was applied
      if (!editApplied && claudeResponse) {
        console.log(`${PREFIX} ${C.yellow}Claude's response (no edit):${C.reset}`);
        console.log(`${PREFIX} ${claudeResponse.slice(0, 500)}`);
      }

      if (editApplied) {
        return {
          tool: toolName,
          problem: "Fixed by Claude using Edit tool",
          filePath,
          suggestedFix: "Applied directly",
        };
      }

      console.log(`${PREFIX} ${C.yellow}No edit was applied${C.reset}`);
      return null;
    } catch (e) {
      console.error(`${PREFIX} Failed to generate improvement plan:`, e);
    }

    return null;
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
