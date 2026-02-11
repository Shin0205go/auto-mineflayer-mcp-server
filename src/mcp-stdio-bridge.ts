/**
 * MCP stdio-to-WebSocket Bridge
 * Allows Claude Code CLI to connect to WebSocket MCP server via stdio
 */

import WebSocket from "ws";

const WS_URL = process.env.MCP_WS_URL || "ws://localhost:8765";

let ws: WebSocket | null = null;
const pendingRequests = new Map<string | number, (response: any) => void>();

// Connect to WebSocket MCP server
function connect() {
  ws = new WebSocket(WS_URL);

  ws.on("open", () => {
    console.error(`[Bridge] Connected to ${WS_URL}`);
  });

  ws.on("message", (data: Buffer) => {
    try {
      const message = JSON.parse(data.toString());

      // If it's a response to our request, resolve it
      if (message.id !== undefined && pendingRequests.has(message.id)) {
        const resolve = pendingRequests.get(message.id);
        pendingRequests.delete(message.id);
        resolve!(message);
      } else if (message.method === "tools/list" || message.result) {
        // Forward response to stdout
        process.stdout.write(JSON.stringify(message) + "\n");
      }
    } catch (err) {
      console.error("[Bridge] Failed to parse message:", err);
    }
  });

  ws.on("error", (err) => {
    console.error("[Bridge] WebSocket error:", err);
  });

  ws.on("close", () => {
    console.error("[Bridge] WebSocket closed, reconnecting...");
    setTimeout(connect, 1000);
  });
}

// Read from stdin and forward to WebSocket
process.stdin.on("data", async (data: Buffer) => {
  try {
    const lines = data.toString().split("\n").filter(l => l.trim());

    for (const line of lines) {
      if (!line.trim()) continue;

      const message = JSON.parse(line);
      console.error("[Bridge] Received from Claude:", message.method || message.id);

      if (ws && ws.readyState === WebSocket.OPEN) {
        // Send to WebSocket
        ws.send(JSON.stringify(message));

        // Wait for response if it's a request
        if (message.id !== undefined) {
          const response = await new Promise<any>((resolve) => {
            pendingRequests.set(message.id, resolve);
            // Timeout after 30s
            setTimeout(() => {
              if (pendingRequests.has(message.id)) {
                pendingRequests.delete(message.id);
                resolve({
                  jsonrpc: "2.0",
                  id: message.id,
                  error: { code: -32603, message: "Request timeout" }
                });
              }
            }, 30000);
          });

          // Send response to stdout
          process.stdout.write(JSON.stringify(response) + "\n");
        }
      } else {
        console.error("[Bridge] WebSocket not connected");
        if (message.id !== undefined) {
          const errorResponse = {
            jsonrpc: "2.0",
            id: message.id,
            error: { code: -32603, message: "WebSocket not connected" }
          };
          process.stdout.write(JSON.stringify(errorResponse) + "\n");
        }
      }
    }
  } catch (err) {
    console.error("[Bridge] Failed to process stdin:", err);
  }
});

// Start
connect();
console.error("[Bridge] MCP stdio-to-WebSocket bridge starting...");
