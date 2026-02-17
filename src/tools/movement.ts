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

      // For very long distances (> 200 blocks), use segmented movement
      const currentPos = botManager.getPosition(username);
      if (!currentPos) {
        throw new Error("Cannot get current position");
      }

      const distance = Math.sqrt(
        Math.pow(x - currentPos.x, 2) +
        Math.pow(z - currentPos.z, 2)
      );

      if (distance > 200) {
        // Segment into 30-block hops for safer navigation
        const segmentSize = 30;
        const segments = Math.ceil(distance / segmentSize);
        const deltaX = (x - currentPos.x) / segments;
        const deltaZ = (z - currentPos.z) / segments;

        let currentX = currentPos.x;
        let currentZ = currentPos.z;

        for (let i = 0; i < segments; i++) {
          const nextX = i === segments - 1 ? x : currentX + deltaX;
          const nextZ = i === segments - 1 ? z : currentZ + deltaZ;

          const segmentResult = await botManager.moveTo(username, nextX, y, nextZ);

          // If a segment fails, return the error
          if (segmentResult.includes("Cannot reach") || segmentResult.includes("Path blocked")) {
            return `Segmented move stopped at segment ${i + 1}/${segments}: ${segmentResult}`;
          }

          currentX = nextX;
          currentZ = nextZ;

          // Small delay between segments to allow chunk loading
          await new Promise<void>(resolve => setTimeout(resolve, 500));
        }

        return `Reached destination via ${segments} segments`;
      } else {
        // For short distances, use normal movement
        const result = await botManager.moveTo(username, x, y, z);
        return result;
      }
    }

    case "minecraft_chat": {
      const message = args.message as string;
      if (!message) {
        throw new Error("Message is required");
      }

      // Block dangerous commands (tp, teleport, kill, etc.) - except for whitelisted bots
      const whitelistedBots = ["Claude", "Claude1", "Claude2", "Claude3", "Claude4", "Claude5", "Claude6", "Claude7"];

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

    case "minecraft_enter_portal": {
      const result = await botManager.enterPortal(username);
      return result;
    }

    default:
      throw new Error(`Unknown movement tool: ${name}`);
  }
}
