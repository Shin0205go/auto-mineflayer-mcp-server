import { botManager } from "../bot-manager/index.js";

export const stateTools = {
  minecraft_get_state: {
    description: "Get comprehensive bot state including position, status, inventory, surroundings, nearby entities, and biome",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
};

export async function handleStateTool(
  name: string,
  _args: Record<string, unknown>
): Promise<string> {
  const username = botManager.requireSingleBot();

  switch (name) {
    case "minecraft_get_state": {
      try {
        // Get all state information
        const position = botManager.getPosition(username);
        const status = botManager.getStatus(username);
        const inventory = botManager.getInventory(username);
        const surroundings = botManager.getSurroundings(username);
        const nearbyEntities = botManager.findEntities(username, "all", 16);
        const biome = await botManager.getBiome(username);

        // Combine into a single response
        const state = {
          position: position ? {
            x: Math.round(position.x * 100) / 100,
            y: Math.round(position.y * 100) / 100,
            z: Math.round(position.z * 100) / 100,
          } : null,
          status: status,
          inventory: inventory.map(item => ({
            name: item.name,
            count: item.count,
          })),
          surroundings: surroundings,
          nearbyEntities: nearbyEntities,
          biome: biome,
        };

        return JSON.stringify(state, null, 2);
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        return `Failed to get state: ${errMsg}`;
      }
    }

    default:
      throw new Error(`Unknown state tool: ${name}`);
  }
}
