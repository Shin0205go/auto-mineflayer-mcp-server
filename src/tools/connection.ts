import { botManager } from "../bot-manager/index.js";
import { setAgentType } from "../agent-state.js";

export const connectionTools = {
  minecraft_connect: {
    description: "Connect to a Minecraft server",
    inputSchema: {
      type: "object" as const,
      properties: {
        host: {
          type: "string",
          description: "Server host address (default: localhost)",
          default: "localhost",
        },
        port: {
          type: "number",
          description: "Server port (default: 25565)",
          default: 25565,
        },
        username: {
          type: "string",
          description: "Bot username",
        },
        version: {
          type: "string",
          description: "Minecraft version (optional, auto-detect if not specified)",
        },
        agentType: {
          type: "string",
          enum: ["game", "dev"],
          default: "dev",
          description: "Agent type: 'game' for Game Agent (basic tools only), 'dev' for Dev Agent (all tools). Default: 'dev' for Claude Code CLI.",
        },
      },
      required: ["username"],
    },
  },

  minecraft_disconnect: {
    description: "Disconnect from the Minecraft server",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },

  minecraft_get_chat_messages: {
    description: "Get chat messages from players",
    inputSchema: {
      type: "object" as const,
      properties: {
        clear: {
          type: "boolean",
          description: "Whether to clear messages after reading (default: true)",
          default: true,
        },
      },
      required: [],
    },
  },
};

export async function handleConnectionTool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  switch (name) {
    case "minecraft_connect": {
      const host = (args.host as string) || process.env.MC_HOST || "localhost";
      const port = (args.port as number) || parseInt(process.env.MC_PORT || "25565");
      const username = args.username as string;
      const version = args.version as string | undefined;
      const agentType = (args.agentType as "game" | "dev") || "dev";

      if (!username) {
        throw new Error("Username is required");
      }

      // Set agent type for tool filtering
      setAgentType(agentType);

      try {
        await botManager.connect({ host, port, username, version });

        // Wait 2 seconds for bot to fully spawn and stabilize
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Get initial state information
        try {
          const position = botManager.getPosition(username);
          const status = botManager.getStatus(username);
          const inventory = botManager.getInventory(username);

          let stateInfo = `\n\nInitial state:`;
          stateInfo += `\nPosition: (${Math.round(position.x)}, ${Math.round(position.y)}, ${Math.round(position.z)})`;
          stateInfo += `\n${status}`;
          stateInfo += `\nInventory: ${inventory.length > 0 ? inventory.map(i => `${i.name}:${i.count}`).join(', ') : 'Empty'}`;

          return `Successfully connected to ${host}:${port} as ${username} (agentType: ${agentType})${stateInfo}`;
        } catch (stateError) {
          // If state retrieval fails, just return basic connection info
          return `Successfully connected to ${host}:${port} as ${username} (agentType: ${agentType})`;
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to connect to ${host}:${port}: ${errorMessage}`);
      }
    }

    case "minecraft_disconnect": {
      const username = botManager.requireSingleBot();
      await botManager.disconnect(username);
      return "Successfully disconnected from server";
    }

    case "minecraft_get_chat_messages": {
      const username = botManager.requireSingleBot();
      const clear = args.clear !== false;
      const messages = botManager.getChatMessages(username, clear);

      if (messages.length === 0) {
        return "No new chat messages";
      }

      return JSON.stringify(messages, null, 2);
    }

    default:
      throw new Error(`Unknown connection tool: ${name}`);
  }
}
