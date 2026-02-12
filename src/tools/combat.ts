import { botManager } from "../bot-manager/index.js";

export const combatTools = {
  minecraft_get_status: {
    description: "Get bot's health, hunger, and equipment status",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },

  minecraft_get_nearby_entities: {
    description: "Get nearby entities (mobs, players, animals) within range",
    inputSchema: {
      type: "object" as const,
      properties: {
        range: {
          type: "number",
          description: "Detection range in blocks (default: 16)",
          default: 16,
        },
        type: {
          type: "string",
          enum: ["all", "hostile", "passive", "player"],
          description: "Filter by entity type (default: all)",
        },
      },
      required: [],
    },
  },

  minecraft_attack: {
    description: "Attack the nearest hostile mob or a specific entity",
    inputSchema: {
      type: "object" as const,
      properties: {
        entity_name: {
          type: "string",
          description: "Name of entity to attack (e.g., 'zombie', 'skeleton'). If not specified, attacks nearest hostile.",
        },
      },
      required: [],
    },
  },

  minecraft_eat: {
    description: "Eat food from inventory to restore hunger",
    inputSchema: {
      type: "object" as const,
      properties: {
        food_name: {
          type: "string",
          description: "Specific food to eat. If not specified, eats any available food.",
        },
      },
      required: [],
    },
  },

  minecraft_equip_armor: {
    description: "Equip armor from inventory",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },

  minecraft_equip_weapon: {
    description: "Equip the best weapon from inventory",
    inputSchema: {
      type: "object" as const,
      properties: {
        weapon_name: {
          type: "string",
          description: "Specific weapon to equip. If not specified, equips best available.",
        },
      },
      required: [],
    },
  },

  minecraft_flee: {
    description: "Run away from danger (opposite direction from nearest hostile)",
    inputSchema: {
      type: "object" as const,
      properties: {
        distance: {
          type: "number",
          description: "Distance to flee in blocks (default: 20)",
          default: 20,
        },
      },
      required: [],
    },
  },

  minecraft_respawn: {
    description: "Respawn (strategic death/reset). Only works when HP ≤ 4. Use as last resort when trapped or critically low on health with no recovery options.",
    inputSchema: {
      type: "object" as const,
      properties: {
        reason: {
          type: "string",
          description: "Reason for respawning (e.g., 'No food available, HP critical')",
        },
      },
      required: [],
    },
  },
};

export async function handleCombatTool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  const username = botManager.requireSingleBot();

  switch (name) {
    case "minecraft_get_status": {
      return botManager.getStatus(username);
    }

    case "minecraft_get_nearby_entities": {
      const range = (args.range as number) || 16;
      const type = (args.type as string) || "all";
      return botManager.getNearbyEntities(username, range, type);
    }

    case "minecraft_attack": {
      const entityName = args.entity_name as string | undefined;
      return await botManager.attack(username, entityName);
    }

    case "minecraft_eat": {
      const foodName = args.food_name as string | undefined;
      try {
        return await botManager.eat(username, foodName);
      } catch (error) {
        if (error instanceof Error && error.message.includes('Promise timed out')) {
          throw new Error(`Failed to eat${foodName ? ` ${foodName}` : ''}: Item not found in inventory or not edible`);
        }
        throw error;
      }
    }

    case "minecraft_equip_armor": {
      return await botManager.equipArmor(username);
    }

    case "minecraft_equip_weapon": {
      const weaponName = args.weapon_name as string | undefined;
      return await botManager.equipWeapon(username, weaponName);
    }

    case "minecraft_flee": {
      const distance = (args.distance as number) || 20;
      return await botManager.flee(username, distance);
    }

    case "minecraft_respawn": {
      const reason = args.reason as string | undefined;
      return await botManager.respawn(username, reason);
    }

    default:
      throw new Error(`Unknown combat tool: ${name}`);
  }
}
