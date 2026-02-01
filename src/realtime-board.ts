/**
 * リアルタイム掲示板 - WebSocket Server
 *
 * shared-board.txt の変更を監視してWebSocketで通知
 * Geminiからの書き込みも受け付ける
 */

import { WebSocketServer, WebSocket } from "ws";
import * as fs from "fs";
import * as path from "path";
import { watch } from "chokidar";

const BOARD_FILE = path.join(process.cwd(), "shared-board.txt");
const WS_PORT = 8765;

// 接続中のクライアント
const clients: Set<WebSocket> = new Set();

// 最後の内容（差分検出用）
let lastContent = "";

// 掲示板の内容を取得
function getBoardContent(): string {
  try {
    return fs.readFileSync(BOARD_FILE, "utf-8");
  } catch {
    return "";
  }
}

// 掲示板に書き込み
function writeToBoard(agent: string, message: string): void {
  const timestamp = new Date().toLocaleTimeString("ja-JP");
  const line = `[${timestamp}] [${agent}] ${message}\n`;
  fs.appendFileSync(BOARD_FILE, line);
}

// 全クライアントにブロードキャスト
function broadcast(data: object): void {
  const json = JSON.stringify(data);
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(json);
    }
  });
}

// WebSocketサーバー起動
export function startRealtimeBoard(): void {
  const wss = new WebSocketServer({ port: WS_PORT });

  console.log(`📡 リアルタイム掲示板 WebSocket: ws://localhost:${WS_PORT}`);

  wss.on("connection", (ws: WebSocket) => {
    console.log("🔗 クライアント接続");
    clients.add(ws);

    // 接続時に現在の内容を送信
    ws.send(JSON.stringify({
      type: "init",
      content: getBoardContent()
    }));

    // メッセージ受信（Geminiからの書き込み等）
    ws.on("message", (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());

        if (msg.type === "write") {
          // 掲示板に書き込み
          writeToBoard(msg.agent || "Unknown", msg.message);
          console.log(`📝 [${msg.agent}] ${msg.message}`);
        } else if (msg.type === "read") {
          // 現在の内容を返す
          ws.send(JSON.stringify({
            type: "content",
            content: getBoardContent()
          }));
        }
      } catch (e) {
        console.error("メッセージパースエラー:", e);
      }
    });

    ws.on("close", () => {
      console.log("🔌 クライアント切断");
      clients.delete(ws);
    });
  });

  // ファイル変更監視
  const watcher = watch(BOARD_FILE, {
    persistent: true,
    ignoreInitial: true
  });

  watcher.on("change", () => {
    const content = getBoardContent();
    if (content !== lastContent) {
      // 新しい行だけ抽出
      const newLines = content.slice(lastContent.length).trim();
      lastContent = content;

      if (newLines) {
        console.log(`📢 掲示板更新: ${newLines.split("\n")[0].substring(0, 50)}...`);
        broadcast({
          type: "update",
          newLines,
          fullContent: content
        });
      }
    }
  });

  lastContent = getBoardContent();

  // 掲示板初期化
  if (!fs.existsSync(BOARD_FILE)) {
    fs.writeFileSync(BOARD_FILE, "# AIエージェント掲示板\n\n");
  }
}

// スタンドアロン実行時
if (import.meta.url === `file://${process.argv[1]}`) {
  startRealtimeBoard();
  console.log("リアルタイム掲示板サーバー起動中...");
}
