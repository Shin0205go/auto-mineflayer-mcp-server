import { botManager } from "../bot-manager/index.js";

export const movementTools = {
  minecraft_get_position: {
    description: "Get the bot's current position in the Minecraft world",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },

  minecraft_move_to: {
    description: "Move the bot to a specific position",
    inputSchema: {
      type: "object" as const,
      properties: {
        x: {
          type: "number",
          description: "X coordinate",
        },
        y: {
          type: "number",
          description: "Y coordinate",
        },
        z: {
          type: "number",
          description: "Z coordinate",
        },
      },
      required: ["x", "y", "z"],
    },
  },

  minecraft_chat: {
    description: "Send a chat message in the Minecraft server",
    inputSchema: {
      type: "object" as const,
      properties: {
        message: {
          type: "string",
          description: "Message to send",
        },
      },
      required: ["message"],
    },
  },

  minecraft_enter_portal: {
    description: "Enter a Nether portal to teleport to the Nether or back to Overworld. The bot will find the nearest portal within 10 blocks, move into it, and wait for teleportation.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
};

export async function handleMovementTool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  const username = botManager.requireSingleBot();

  switch (name) {
    case "minecraft_get_position": {
      const pos = botManager.getPosition(username);
      if (!pos) {
        throw new Error("Not connected to any server");
      }
      return JSON.stringify({
        x: Math.round(pos.x * 100) / 100,
        y: Math.round(pos.y * 100) / 100,
        z: Math.round(pos.z * 100) / 100,
      });
    }

    case "minecraft_move_to": {
      const x = args.x as number;
      const y = args.y as number;
      const z = args.z as number;

      const result = await botManager.moveTo(username, x, y, z);
      return result;
    }

    case "minecraft_chat": {
      const message = args.message as string;
      if (!message) {
        throw new Error("Message is required");
      }

      // Block dangerous commands (tp, teleport, kill, etc.) - except for whitelisted bots
      const whitelistedBots = ["Claude"];

      if (!whitelistedBots.includes(username)) {
        const blockedCommands = ["/tp", "/teleport", "/kill", "/gamemode", "/op", "/deop", "/ban", "/kick"];
        const lowerMessage = message.toLowerCase().trim();
        for (const cmd of blockedCommands) {
          if (lowerMessage.startsWith(cmd + " ") || lowerMessage === cmd) {
            throw new Error(`Command '${cmd}' is not allowed. Use move_to for movement.`);
          }
        }
      }

      await botManager.chat(username, message);
      return `Sent message: ${message}`;
    }

    default:
      throw new Error(`Unknown movement tool: ${name}`);
  }
}
