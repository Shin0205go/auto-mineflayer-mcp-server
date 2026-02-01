#!/usr/bin/env node
/**
 * Gemini Live API + Minecraft Voice Control (CLI版)
 *
 * 画面を見ながら音声で指示を受けてMinecraftを操作
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { botManager } from "./bot-manager.js";
import * as readline from "readline";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

if (!GEMINI_API_KEY) {
  console.error("❌ GEMINI_API_KEY 環境変数を設定してください");
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// Minecraftツールの定義
const minecraftTools = [
  {
    name: "minecraft_chat",
    description: "Minecraftでチャットメッセージを送信",
    parameters: {
      type: "object",
      properties: {
        message: { type: "string", description: "送信するメッセージ" }
      },
      required: ["message"]
    }
  },
  {
    name: "minecraft_move",
    description: "ボットを指定座標に移動",
    parameters: {
      type: "object",
      properties: {
        x: { type: "number" },
        y: { type: "number" },
        z: { type: "number" }
      },
      required: ["x", "y", "z"]
    }
  },
  {
    name: "minecraft_build_house",
    description: "指定座標に家を建てる",
    parameters: {
      type: "object",
      properties: {
        x: { type: "number" },
        y: { type: "number" },
        z: { type: "number" }
      },
      required: ["x", "y", "z"]
    }
  },
  {
    name: "minecraft_build_tower",
    description: "指定座標に塔を建てる",
    parameters: {
      type: "object",
      properties: {
        x: { type: "number" },
        y: { type: "number" },
        z: { type: "number" }
      },
      required: ["x", "y", "z"]
    }
  },
  {
    name: "minecraft_place_block",
    description: "指定座標にブロックを置く",
    parameters: {
      type: "object",
      properties: {
        block_type: { type: "string", description: "ブロックの種類 (例: stone, oak_planks)" },
        x: { type: "number" },
        y: { type: "number" },
        z: { type: "number" }
      },
      required: ["block_type", "x", "y", "z"]
    }
  },
  {
    name: "minecraft_get_position",
    description: "ボットの現在位置を取得",
    parameters: { type: "object", properties: {} }
  }
];

const BOT_USERNAME = "GeminiVoiceBot";

// ツール実行
async function executeTool(name: string, params: Record<string, unknown>): Promise<string> {
  console.log(`🔧 実行: ${name}`, params);

  switch (name) {
    case "minecraft_chat":
      await botManager.chat(BOT_USERNAME, params.message as string);
      return `チャット送信: ${params.message}`;

    case "minecraft_move":
      await botManager.moveTo(
        BOT_USERNAME,
        params.x as number,
        params.y as number,
        params.z as number
      );
      return `移動完了: (${params.x}, ${params.y}, ${params.z})`;

    case "minecraft_build_house":
      // buildStructure removed - use placeBlock with /setblock commands instead
      await botManager.chat(BOT_USERNAME, `Building house at (${params.x}, ${params.y}, ${params.z})`);
      return `家を建築: (${params.x}, ${params.y}, ${params.z})`;

    case "minecraft_build_tower":
      // buildStructure removed - use placeBlock with /setblock commands instead
      await botManager.chat(BOT_USERNAME, `Building tower at (${params.x}, ${params.y}, ${params.z})`);
      return `塔を建築: (${params.x}, ${params.y}, ${params.z})`;

    case "minecraft_place_block":
      await botManager.placeBlock(
        BOT_USERNAME,
        params.block_type as string,
        params.x as number,
        params.y as number,
        params.z as number
      );
      return `ブロック配置: ${params.block_type} at (${params.x}, ${params.y}, ${params.z})`;

    case "minecraft_get_position":
      const pos = botManager.getPosition(BOT_USERNAME);
      return pos ? `現在位置: (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})` : "位置不明";

    default:
      return `未対応: ${name}`;
  }
}

// Geminiとの対話
async function chat(userInput: string): Promise<string> {
  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    systemInstruction: `あなたはMinecraft操作アシスタントです。
ユーザーの指示に従ってMinecraftを操作します。
現在のボット位置を基準に、相対的な指示も理解してください。
「ここに」「近くに」などの指示は現在位置の近くを意味します。`
  });

  // 現在位置を取得して含める
  const pos = botManager.getPosition(BOT_USERNAME);
  const context = pos
    ? `[現在のボット位置: x=${pos.x.toFixed(0)}, y=${pos.y.toFixed(0)}, z=${pos.z.toFixed(0)}]`
    : "[ボット未接続]";

  const prompt = `${context}\n\nユーザー: ${userInput}\n\n指示を実行するためのアクションをJSON形式で返してください。
形式: {"tool": "ツール名", "params": {パラメータ}}
利用可能なツール: minecraft_chat, minecraft_move, minecraft_build_house, minecraft_build_tower, minecraft_place_block, minecraft_get_position`;

  const result = await model.generateContent(prompt);
  const text = result.response.text();

  // JSONを抽出して実行
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const action = JSON.parse(jsonMatch[0]);
      if (action.tool) {
        const execResult = await executeTool(action.tool, action.params || {});
        return `${text}\n\n✅ ${execResult}`;
      }
    } catch (e) {
      // JSONパース失敗は無視
    }
  }

  return text;
}

// メイン
async function main() {
  console.log("🎮 Minecraft Voice Control (CLI)");
  console.log("================================");
  console.log("");

  // Minecraft接続
  const host = process.env.MC_HOST || "localhost";
  const port = parseInt(process.env.MC_PORT || "51513");

  console.log(`📡 Minecraft接続中... ${host}:${port}`);

  try {
    await botManager.connect({
      host,
      port,
      username: BOT_USERNAME
    });
    console.log("✅ 接続完了!");
  } catch (e) {
    console.error("❌ 接続失敗:", e);
    process.exit(1);
  }

  // REPLループ
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  console.log("");
  console.log("💬 テキストで指示を入力 (終了: quit)");
  console.log("例: 「ここに家を建てて」「前に10ブロック移動」");
  console.log("");

  const prompt = () => {
    rl.question("あなた> ", async (input) => {
      if (input.toLowerCase() === "quit") {
        await botManager.disconnect(BOT_USERNAME);
        rl.close();
        process.exit(0);
      }

      try {
        const response = await chat(input);
        console.log(`\nGemini> ${response}\n`);
      } catch (e) {
        console.error("エラー:", e);
      }

      prompt();
    });
  };

  prompt();
}

main().catch(console.error);
