import { botManager } from "../bot-manager.js";

export const environmentTools = {
  minecraft_get_surroundings: {
    description:
      "Get immediate surroundings - which directions are passable, blocked, what's above/below, and nearby resources",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
};

export async function handleEnvironmentTool(
  name: string,
  _args: Record<string, unknown>
): Promise<string> {
  const username = botManager.requireSingleBot();

  switch (name) {
    case "minecraft_get_surroundings": {
      return botManager.getSurroundings(username);
    }

    default:
      throw new Error(`Unknown environment tool: ${name}`);
  }
}
