/**
 * L1 Executor
 *
 * Executes one action per tick using Haiku model.
 * Only receives tools from active skills (+ core tools).
 * Lightweight system prompt with skill context injected dynamically.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { MCPWebSocketClientTransport } from "../mcp-ws-transport.js";
import type { WorldState, TacticalPlan, AnthropicTool, ExecutorResult } from "./types.js";

// Core tools always available to the executor
const CORE_TOOL_NAMES = new Set([
  "minecraft_get_position",
  "minecraft_get_status",
  "minecraft_get_inventory",
  "minecraft_get_surroundings",
  "minecraft_get_nearby_entities",
  "minecraft_move_to",
  "minecraft_chat",
]);

/**
 * Convert MCP tool definitions to Anthropic API format.
 * Filters to only include core tools + active skill tools.
 */
export function buildToolSet(
  allMcpTools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>,
  skillToolNames: string[],
): AnthropicTool[] {
  const allowedNames = new Set([...CORE_TOOL_NAMES, ...skillToolNames]);

  return allMcpTools
    .filter((t) => allowedNames.has(t.name))
    .map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as AnthropicTool["input_schema"],
    }));
}

/**
 * Build executor system prompt with active skill contexts.
 */
function buildSystemPrompt(plan: TacticalPlan, skillContexts: string): string {
  return `Minecraft botの実行エンジン。利用可能なツールで次のアクションを1つ実行せよ。
中断条件に該当したら即座にテキストで「ABORT: 理由」と報告。

## 現在のプラン
${plan.plan}

## 中断条件
${plan.abortConditions.map((c) => `- ${c}`).join("\n")}

${skillContexts}

行動を1つ選んで実行せよ。`;
}

/**
 * Build a concise state message for the executor.
 */
function buildStateMessage(
  state: WorldState,
  lastAction?: string,
  lastResult?: string,
): string {
  const parts: string[] = [];

  parts.push(`HP:${state.health} 食:${state.hunger} pos:(${state.position.x.toFixed(0)},${state.position.y.toFixed(0)},${state.position.z.toFixed(0)})`);

  if (state.nearbyThreats.length > 0) {
    const threats = state.nearbyThreats
      .map((t) => `${t.name}(${t.distance.toFixed(0)}m)`)
      .join(",");
    parts.push(`⚠敵: ${threats}`);
  }

  if (lastAction && lastResult) {
    // Truncate long results
    const shortResult = lastResult.length > 200
      ? lastResult.slice(0, 200) + "..."
      : lastResult;
    parts.push(`前回: ${lastAction} → ${shortResult}`);
  }

  return parts.join("\n");
}

/**
 * Extract text from MCP tool call result.
 */
function extractToolResultText(result: unknown): string {
  if (typeof result === "string") return result;
  const r = result as { content?: Array<{ type: string; text: string }> };
  if (r?.content && Array.isArray(r.content)) {
    return r.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n");
  }
  return JSON.stringify(result);
}

/**
 * Run the L1 Executor for one tick.
 *
 * Calls Haiku with current state + available tools.
 * If the model returns tool_use, executes it via MCP.
 * Returns the result of the action.
 */
export async function runExecutor(
  client: Anthropic,
  model: string,
  mcp: MCPWebSocketClientTransport,
  plan: TacticalPlan,
  state: WorldState,
  tools: AnthropicTool[],
  skillContexts: string,
  lastAction?: string,
  lastResult?: string,
): Promise<ExecutorResult> {
  const systemPrompt = buildSystemPrompt(plan, skillContexts);
  const userMessage = buildStateMessage(state, lastAction, lastResult);

  try {
    const response = await client.messages.create({
      model,
      max_tokens: 256,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
      tools: tools as Anthropic.Tool[],
    });

    // Check for tool use
    const toolUseBlock = response.content.find((b) => b.type === "tool_use");
    const textBlock = response.content.find((b) => b.type === "text");

    if (toolUseBlock && toolUseBlock.type === "tool_use") {
      const toolName = toolUseBlock.name;
      const toolInput = toolUseBlock.input as Record<string, unknown>;

      console.log(`[Executor] Tool: ${toolName}`, JSON.stringify(toolInput));

      // Execute via MCP
      try {
        const result = await mcp.callTool(toolName, toolInput);
        const resultText = extractToolResultText(result);

        // Check if result is truncated for logging
        const logResult = resultText.length > 100
          ? resultText.slice(0, 100) + "..."
          : resultText;
        console.log(`[Executor] Result: ${logResult}`);

        return {
          action: `${toolName}(${JSON.stringify(toolInput)})`,
          toolName,
          toolResult: resultText,
          aborted: false,
          completed: false,
        };
      } catch (toolError) {
        const errMsg = toolError instanceof Error ? toolError.message : String(toolError);
        console.error(`[Executor] Tool error: ${errMsg}`);
        return {
          action: `${toolName} FAILED`,
          toolName,
          toolResult: `Error: ${errMsg}`,
          aborted: false,
          completed: false,
        };
      }
    }

    // Text-only response — check for abort or completion signals
    if (textBlock && textBlock.type === "text") {
      const text = textBlock.text;
      console.log(`[Executor] Text: ${text}`);

      if (text.includes("ABORT")) {
        return {
          action: "abort",
          aborted: true,
          abortReason: text,
          completed: false,
        };
      }

      // If the model responds with text only (no tool use), it might be done
      return {
        action: "thinking",
        toolResult: text,
        aborted: false,
        completed: text.toLowerCase().includes("完了") || text.toLowerCase().includes("done"),
      };
    }

    // Unexpected response
    return {
      action: "no_action",
      aborted: false,
      completed: false,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`[Executor] Error: ${errMsg}`);
    return {
      action: "error",
      toolResult: errMsg,
      aborted: false,
      completed: false,
    };
  }
}
