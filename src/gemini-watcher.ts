#!/usr/bin/env node
/**
 * Gemini Live API - Minecraft Screen Watcher
 *
 * Minecraftの画面をリアルタイムで監視し、
 * 観察結果を掲示板にWebSocketで送信
 */

// @ts-ignore
import WebSocket from "ws";
import { GoogleGenerativeAI } from "@google/generative-ai";
// @ts-ignore
import screenshot from "screenshot-desktop";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const BOARD_WS_URL = "ws://localhost:8765";
const WATCH_INTERVAL = 3000; // 3秒ごとに画面チェック

if (!GEMINI_API_KEY) {
  console.error("❌ GEMINI_API_KEY 環境変数を設定してください");
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

let ws: WebSocket | null = null;
let lastObservation = "";

// 掲示板に書き込み
function writeToBoard(message: string): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: "write",
      agent: "Gemini",
      message
    }));
    console.log(`📝 [Gemini] ${message}`);
  }
}

// 画面をキャプチャしてBase64に
async function captureScreen(): Promise<string> {
  const img = await screenshot({ format: "png" });
  return img.toString("base64");
}

// Geminiに画面を見せて分析
async function analyzeScreen(imageBase64: string): Promise<string> {
  const result = await model.generateContent([
    {
      inlineData: {
        mimeType: "image/png",
        data: imageBase64
      }
    },
    {
      text: `あなたはMinecraftの画面を監視するAIです。
画面を見て、以下の形式で簡潔に報告してください：

【状況】（1文で現在の状況）
【プレイヤー位置】（見える座標やバイオーム）
【注目点】（重要な変化や建造物、モブなど）

変化がない場合は「変化なし」とだけ返してください。
長々と説明せず、要点だけ伝えてください。`
    }
  ]);

  return result.response.text();
}

// メイン監視ループ
async function watchLoop(): Promise<void> {
  try {
    const imageBase64 = await captureScreen();
    const observation = await analyzeScreen(imageBase64);

    // 変化があれば報告
    if (observation !== lastObservation && !observation.includes("変化なし")) {
      lastObservation = observation;
      writeToBoard(observation.replace(/\n/g, " "));
    }
  } catch (e) {
    console.error("監視エラー:", e);
  }
}

// WebSocket接続
function connectToBoard(): void {
  ws = new WebSocket(BOARD_WS_URL);

  ws.on("open", () => {
    console.log("✅ 掲示板サーバーに接続");
    writeToBoard("Gemini Watcher 起動。Minecraft画面の監視を開始します。");
  });

  ws.on("message", (data: Buffer) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === "update") {
      // 他のエージェントからのメッセージを確認
      console.log(`📨 掲示板更新: ${msg.newLines.substring(0, 50)}...`);
    }
  });

  ws.on("close", () => {
    console.log("🔌 切断。3秒後に再接続...");
    setTimeout(connectToBoard, 3000);
  });

  ws.on("error", (e: Error) => {
    console.error("WebSocketエラー:", e.message);
  });
}

// メイン
async function main(): Promise<void> {
  console.log("🎮 Gemini Minecraft Watcher");
  console.log("===========================");
  console.log("");

  // 掲示板に接続
  connectToBoard();

  // 監視ループ開始（接続後に開始）
  setTimeout(() => {
    console.log(`👁️ 画面監視開始 (${WATCH_INTERVAL / 1000}秒間隔)`);
    setInterval(watchLoop, WATCH_INTERVAL);
    watchLoop(); // 最初の1回
  }, 2000);
}

main().catch(console.error);
