import * as fs from "fs";
import * as path from "path";

const BOARD_FILE = path.join(process.cwd(), "shared-board.txt");

// 掲示板がなければ作成
function ensureBoardExists() {
  if (!fs.existsSync(BOARD_FILE)) {
    fs.writeFileSync(BOARD_FILE, "# AIエージェント掲示板\n\n");
  }
}

export const coordinationTools = {
  agent_board_read: {
    description: "エージェント間の掲示板を読む。他のエージェントからのメッセージやタスク状況を確認できる。",
    inputSchema: {
      type: "object" as const,
      properties: {
        last_n_lines: {
          type: "number",
          description: "最新N行だけ取得（省略で全部）",
        },
      },
      required: [],
    },
  },

  agent_board_wait: {
    description: "掲示板に新しいメッセージが来るまで待機する。リアルタイムで他のエージェントの更新を監視できる。",
    inputSchema: {
      type: "object" as const,
      properties: {
        timeout_seconds: {
          type: "number",
          description: "タイムアウト秒数（デフォルト30秒）",
        },
        filter: {
          type: "string",
          description: "特定のエージェント名でフィルタ（例: 'Claude2'）",
        },
      },
      required: [],
    },
  },

  agent_board_write: {
    description: "エージェント間の掲示板にメッセージを書く。タスク完了報告や他のエージェントへの指示に使う。",
    inputSchema: {
      type: "object" as const,
      properties: {
        agent_name: {
          type: "string",
          description: "自分のエージェント名 (例: Agent1, Agent2)",
        },
        message: {
          type: "string",
          description: "掲示板に書くメッセージ",
        },
      },
      required: ["agent_name", "message"],
    },
  },

  agent_board_clear: {
    description: "掲示板をクリアして新しく始める",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
};

// Standalone exports for mcp-ws-server.ts
export function readBoard(lastNLines?: number): string {
  ensureBoardExists();
  const content = fs.readFileSync(BOARD_FILE, "utf-8");
  if (lastNLines && lastNLines > 0) {
    return content.split("\n").slice(-lastNLines).join("\n");
  }
  return content;
}

/**
 * Log to board (for debugging/monitoring)
 * Prefixes with LOG: to distinguish from agent messages
 */
export function logToBoard(source: string, message: string): void {
  ensureBoardExists();
  const timestamp = new Date().toLocaleTimeString("ja-JP");
  const line = `[${timestamp}] [LOG:${source}] ${message}\n`;
  fs.appendFileSync(BOARD_FILE, line);
}

export function writeBoard(agentName: string, message: string): string {
  ensureBoardExists();
  if (!agentName || !message) {
    throw new Error("agent_name と message は必須です");
  }
  const timestamp = new Date().toLocaleTimeString("ja-JP");
  const line = `[${timestamp}] [${agentName}] ${message}\n`;
  fs.appendFileSync(BOARD_FILE, line);
  return `掲示板に書き込みました: ${line.trim()}`;
}

export async function waitForNewMessage(
  timeoutSeconds: number = 30,
  filter?: string
): Promise<string> {
  ensureBoardExists();
  const startContent = fs.readFileSync(BOARD_FILE, "utf-8");
  const startLineCount = startContent.split("\n").length;
  const startTime = Date.now();
  const timeoutMs = timeoutSeconds * 1000;

  while (Date.now() - startTime < timeoutMs) {
    await new Promise(resolve => setTimeout(resolve, 500));
    const currentContent = fs.readFileSync(BOARD_FILE, "utf-8");
    const currentLines = currentContent.split("\n");

    if (currentLines.length > startLineCount) {
      const newLines = currentLines.slice(startLineCount).filter(l => l.trim());
      if (filter) {
        const filtered = newLines.filter(l => l.includes(`[${filter}]`));
        if (filtered.length > 0) {
          return `新しいメッセージ (${filter}):\n${filtered.join("\n")}`;
        }
      } else if (newLines.length > 0) {
        return `新しいメッセージ:\n${newLines.join("\n")}`;
      }
    }
  }
  return `タイムアウト (${timeoutSeconds}秒): 新しいメッセージはありませんでした`;
}

export function clearBoard(): string {
  fs.writeFileSync(BOARD_FILE, "# AIエージェント掲示板\n\n[システム] 掲示板クリア\n");
  return "掲示板をクリアしました";
}

export async function handleCoordinationTool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  ensureBoardExists();

  switch (name) {
    case "agent_board_read": {
      const content = fs.readFileSync(BOARD_FILE, "utf-8");
      const lines = content.split("\n");

      const lastN = args.last_n_lines as number | undefined;
      if (lastN && lastN > 0) {
        return lines.slice(-lastN).join("\n");
      }
      return content;
    }

    case "agent_board_write": {
      const agentName = args.agent_name as string;
      const message = args.message as string;

      if (!agentName || !message) {
        throw new Error("agent_name と message は必須です");
      }

      const timestamp = new Date().toLocaleTimeString("ja-JP");
      const line = `[${timestamp}] [${agentName}] ${message}\n`;

      fs.appendFileSync(BOARD_FILE, line);
      return `掲示板に書き込みました: ${line.trim()}`;
    }

    case "agent_board_wait": {
      const timeoutSeconds = (args.timeout_seconds as number) || 30;
      const filter = args.filter as string | undefined;

      const startContent = fs.readFileSync(BOARD_FILE, "utf-8");
      const startLineCount = startContent.split("\n").length;

      const startTime = Date.now();
      const timeoutMs = timeoutSeconds * 1000;

      // ポーリングで新しい行を待つ
      while (Date.now() - startTime < timeoutMs) {
        await new Promise(resolve => setTimeout(resolve, 500)); // 0.5秒ごとにチェック

        const currentContent = fs.readFileSync(BOARD_FILE, "utf-8");
        const currentLines = currentContent.split("\n");

        if (currentLines.length > startLineCount) {
          // 新しい行がある
          const newLines = currentLines.slice(startLineCount).filter(l => l.trim());

          if (filter) {
            // フィルタがある場合、そのエージェントのメッセージだけ
            const filtered = newLines.filter(l => l.includes(`[${filter}]`));
            if (filtered.length > 0) {
              return `新しいメッセージ (${filter}):\n${filtered.join("\n")}`;
            }
          } else {
            if (newLines.length > 0) {
              return `新しいメッセージ:\n${newLines.join("\n")}`;
            }
          }
        }
      }

      return `タイムアウト (${timeoutSeconds}秒): 新しいメッセージはありませんでした`;
    }

    case "agent_board_clear": {
      fs.writeFileSync(BOARD_FILE, "# AIエージェント掲示板\n\n[システム] 掲示板クリア\n");
      return "掲示板をクリアしました";
    }

    default:
      throw new Error(`Unknown coordination tool: ${name}`);
  }
}
