import { botManager } from "../bot-manager.js";

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

      if (!username) {
        throw new Error("Username is required");
      }

      await botManager.connect({ host, port, username, version });
      return `Successfully connected to ${host}:${port} as ${username}`;
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
