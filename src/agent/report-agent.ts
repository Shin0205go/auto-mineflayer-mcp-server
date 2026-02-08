#!/usr/bin/env node

/**
 * Report Agent - Evolution Report Generator
 *
 * Periodically reads evolution-history.jsonl and loop-results.jsonl,
 * generates a markdown report using Claude, and saves it to
 * learning/evolution-reports/.
 *
 * Runs standalone - reads files directly (no MCP connection needed).
 */

import "dotenv/config";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from "fs";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { LoopResult, EvolutionEntry, AgentConfig } from "../types/agent-config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, "..", "..");

const REPORT_INTERVAL = 30 * 60 * 1000; // 30 minutes
const EVOLUTION_HISTORY_FILE = join(projectRoot, "learning", "evolution-history.jsonl");
const LOOP_RESULTS_FILE = join(projectRoot, "logs", "loop-results.jsonl");
const CONFIG_FILE = join(projectRoot, "learning", "agent-config.json");
const REPORTS_DIR = join(projectRoot, "learning", "evolution-reports");
const BOARD_FILE = join(projectRoot, "shared-board.txt");

// Colors
const C = {
  blue: "\x1b[34m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  dim: "\x1b[2m",
  reset: "\x1b[0m",
};
const PREFIX = `${C.blue}[ReportAgent]${C.reset}`;

class ReportAgent {
  private isRunning = false;
  private reportCount = 0;

  async start(): Promise<void> {
    console.log(`
${C.blue}╔══════════════════════════════════════════════════════════════╗
║            Report Agent - Evolution Reports                  ║
║       Generates periodic reports on agent evolution          ║
╚══════════════════════════════════════════════════════════════╝${C.reset}
`);

    // Ensure reports directory exists
    if (!existsSync(REPORTS_DIR)) {
      mkdirSync(REPORTS_DIR, { recursive: true });
    }

    this.isRunning = true;

    // Initial delay
    console.log(`${PREFIX} First report in 30 minutes...`);
    await this.sleep(REPORT_INTERVAL);

    while (this.isRunning) {
      try {
        await this.generateReport();
      } catch (e) {
        console.error(`${PREFIX} Report generation error:`, e);
      }

      await this.sleep(REPORT_INTERVAL);
    }
  }

  private async generateReport(): Promise<void> {
    this.reportCount++;
    console.log(`\n${PREFIX} ${C.blue}=== Generating Report #${this.reportCount} ===${C.reset}`);

    // Read data sources
    const evolutionEntries = this.readJSONL<EvolutionEntry>(EVOLUTION_HISTORY_FILE);
    const loopResults = this.readJSONL<LoopResult>(LOOP_RESULTS_FILE);
    const config = this.readConfig();

    if (evolutionEntries.length === 0 && loopResults.length === 0) {
      console.log(`${PREFIX} No data to report on`);
      return;
    }

    console.log(`${PREFIX} Data: ${evolutionEntries.length} evolution entries, ${loopResults.length} loop results`);

    // Only use recent data (last 30 minutes)
    const sinceTimestamp = Date.now() - REPORT_INTERVAL;
    const recentLoops = loopResults.filter(r => r.timestamp > sinceTimestamp);
    // Use all evolution entries (they're already timestamped)
    const recentEvolutions = evolutionEntries.slice(-10);

    if (recentLoops.length === 0 && recentEvolutions.length === 0) {
      console.log(`${PREFIX} No recent activity to report`);
      return;
    }

    // Build prompt
    const prompt = this.buildReportPrompt(config, recentEvolutions, recentLoops);

    // Generate report with Claude
    let reportContent: string | null = null;

    try {
      const { ANTHROPIC_API_KEY, ...envWithoutKey } = process.env;

      const queryResult = query({
        prompt,
        options: {
          model: process.env.CLAUDE_MODEL || "sonnet",
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

      reportContent = responseText;
    } catch (e) {
      console.error(`${PREFIX} Claude query failed:`, e);
      return;
    }

    if (!reportContent) {
      console.log(`${PREFIX} No report generated`);
      return;
    }

    // Save report
    const now = new Date();
    const dateStr = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const filename = `report-${dateStr}.md`;
    const filepath = join(REPORTS_DIR, filename);

    writeFileSync(filepath, reportContent);
    console.log(`${PREFIX} ${C.green}Report saved: ${filepath}${C.reset}`);

    // Write summary to board
    const summaryLine = reportContent.split("\n").find(l => l.startsWith("##") || l.trim().length > 10);
    if (summaryLine) {
      this.writeToBoard(`📊 進化レポート: ${summaryLine.replace(/^#+\s*/, "").slice(0, 100)}`);
    }
  }

  private buildReportPrompt(
    config: AgentConfig | null,
    evolutions: EvolutionEntry[],
    loops: LoopResult[]
  ): string {
    const configSection = config
      ? `現在のバージョン: v${config.version}, 最終更新: ${config.lastUpdated}`
      : "設定ファイルなし";

    const evolutionSection = evolutions.length > 0
      ? evolutions.map(e =>
          `- v${e.configVersion} (${e.timestamp}): ${e.changes.length}件の変更 - ${e.analysis.slice(0, 100)}`
        ).join("\n")
      : "（変更なし）";

    const successRate = loops.length > 0
      ? `${loops.filter(l => l.success).length}/${loops.length} (${Math.round(loops.filter(l => l.success).length / loops.length * 100)}%)`
      : "N/A";

    const loopSection = loops.length > 0
      ? loops.slice(-10).map(l =>
          `- #${l.loopNumber} [${l.success ? "OK" : "NG"}] ${l.summary.slice(0, 80)}`
        ).join("\n")
      : "（ループなし）";

    return `あなたはMinecraft AIエージェントの進化レポーターです。
以下のデータから、わかりやすい日本語のマークダウンレポートを作成してください。

## データ

### エージェント設定
${configSection}

### 設定変更履歴（直近）
${evolutionSection}

### ループ実行結果
成功率: ${successRate}
${loopSection}

## レポート要件
以下の構成でマークダウンを出力してください:

1. **サマリー** - 今期間の概要（1-2文）
2. **設定変更** - 行われた設定変更とその意図
3. **行動パフォーマンス** - 成功率、よくある失敗パターン
4. **改善傾向** - 前回との比較、良くなった点・悪くなった点
5. **推奨事項** - 次に調整すべき項目

簡潔に、データに基づいて書いてください。推測は最小限に。`;
  }

  private readJSONL<T>(filepath: string): T[] {
    try {
      if (!existsSync(filepath)) return [];
      const content = readFileSync(filepath, "utf-8");
      return content
        .trim()
        .split("\n")
        .filter(line => line.trim())
        .map(line => JSON.parse(line) as T);
    } catch (e) {
      console.error(`${PREFIX} Failed to read ${filepath}:`, e);
      return [];
    }
  }

  private readConfig(): AgentConfig | null {
    try {
      if (!existsSync(CONFIG_FILE)) return null;
      return JSON.parse(readFileSync(CONFIG_FILE, "utf-8")) as AgentConfig;
    } catch {
      return null;
    }
  }

  private writeToBoard(message: string): void {
    try {
      const timestamp = new Date().toLocaleString("ja-JP");
      const line = `[${timestamp}] [ReportAgent] ${message}\n`;

      if (existsSync(BOARD_FILE)) {
        appendFileSync(BOARD_FILE, line);
      }
    } catch {
      // Board write is best-effort
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  stop(): void {
    console.log(`${PREFIX} Stopping...`);
    this.isRunning = false;
  }
}

// Main entry point
async function main(): Promise<void> {
  const agent = new ReportAgent();

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
