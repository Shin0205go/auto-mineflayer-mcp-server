#!/usr/bin/env node
/**
 * MCP Hot-Reload Proxy
 *
 * Sits between Claude Code and the actual MCP server (dist/index.js).
 * Transparently forwards all JSON-RPC messages.
 *
 * Special handling for "mc_reload":
 *   Proxy intercepts the tools/call request for mc_reload,
 *   kills the child process, respawns it, then sends the response
 *   back to Claude Code. This achieves full module reload including
 *   bot-manager (which the old mc_reload couldn't do).
 *
 * Usage: node dist/mcp-proxy.js
 */

import { spawn, ChildProcess } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SERVER_SCRIPT = join(__dirname, "index.js");

let child: ChildProcess | null = null;
let childBuffer = "";
let isRestarting = false;
let requestBuffer: string[] = [];

// Track the initialize request from Claude Code so we can replay it after restart
let lastInitializeRequest: string | null = null;
let initializeResponseSent = false;

function log(msg: string) {
  process.stderr.write(`[mcp-proxy] ${msg}\n`);
}

function sendToClient(msg: object) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

/**
 * Spawn the actual MCP server as a child process
 */
function spawnChild(): ChildProcess {
  log(`Spawning child: node ${SERVER_SCRIPT}`);

  const proc = spawn("node", [SERVER_SCRIPT], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env },
    cwd: join(__dirname, ".."),
  });

  proc.stdout!.on("data", (data: Buffer) => {
    const text = data.toString();
    childBuffer += text;

    const lines = childBuffer.split("\n");
    childBuffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      // Forward everything from child to Claude Code
      process.stdout.write(trimmed + "\n");
    }
  });

  proc.stderr!.on("data", (data: Buffer) => {
    process.stderr.write(data);
  });

  proc.on("close", (code) => {
    log(`Child exited with code ${code}`);
    if (!isRestarting) {
      log("Unexpected child exit — restarting in 1s...");
      setTimeout(() => {
        child = spawnChild();
        // Replay initialize if we have it
        if (lastInitializeRequest) {
          log("Replaying initialize request to new child");
          child.stdin!.write(lastInitializeRequest + "\n");
        }
      }, 1000);
    }
  });

  proc.on("error", (err) => {
    log(`Child process error: ${err.message}`);
  });

  return proc;
}

/**
 * Restart the child process (full hot-reload)
 */
async function restartChild(): Promise<void> {
  isRestarting = true;
  log("=== Full hot-reload: restarting child process ===");

  // Kill old child
  if (child && !child.killed) {
    // Remove close listener to prevent auto-restart
    child.removeAllListeners("close");
    child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        if (child && !child.killed) child.kill("SIGKILL");
        resolve();
      }, 5000);
      child!.on("close", () => { clearTimeout(t); resolve(); });
    });
  }

  childBuffer = "";

  // Spawn new child
  child = spawnChild();

  // Replay the initialize handshake so the new child is in a valid MCP state
  if (lastInitializeRequest) {
    log("Replaying initialize request to new child");
    child.stdin!.write(lastInitializeRequest + "\n");

    // Wait for initialize response from new child, but DON'T forward it to client
    // (client already has a session, we just need the child ready)
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        log("Initialize response timeout — continuing anyway");
        resolve();
      }, 10_000);

      const interceptor = (data: Buffer) => {
        const text = data.toString();
        const lines = text.split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const msg = JSON.parse(trimmed);
            if (msg.result?.serverInfo || msg.result?.protocolVersion) {
              // This is the initialize response — eat it, don't forward
              log("Caught initialize response from new child (not forwarding)");
              clearTimeout(timeout);
              child!.stdout!.removeListener("data", interceptor);

              // Send "initialized" notification to child
              child!.stdin!.write(JSON.stringify({
                jsonrpc: "2.0",
                method: "notifications/initialized",
              }) + "\n");

              resolve();
              return;
            }
          } catch { /* not JSON */ }
        }
      };

      child!.stdout!.on("data", interceptor);
    });
  } else {
    // No initialize to replay — just wait a moment
    await new Promise(r => setTimeout(r, 1000));
  }

  // Flush buffered requests
  if (requestBuffer.length > 0) {
    log(`Flushing ${requestBuffer.length} buffered requests`);
    for (const req of requestBuffer) {
      child.stdin!.write(req + "\n");
    }
    requestBuffer = [];
  }

  isRestarting = false;
  log("=== Child process restarted successfully ===");
}

/**
 * Handle incoming request from Claude Code
 * Returns true if the request was handled by the proxy (not forwarded)
 */
function handleRequest(line: string): boolean {
  try {
    const msg = JSON.parse(line);

    // Capture initialize request for replay after restart
    if (msg.method === "initialize") {
      lastInitializeRequest = line;
      log("Captured initialize request for replay");
    }

    // Intercept mc_reload: handle it in the proxy
    if (msg.method === "tools/call" && msg.params?.name === "mc_reload") {
      const requestId = msg.id;
      log("Intercepted mc_reload — performing full process restart");

      restartChild().then(async () => {
        // Send tools/list_changed notification to Claude Code
        sendToClient({
          jsonrpc: "2.0",
          method: "notifications/tools/list_changed",
        });

        // Auto-reconnect: send mc_connect to the new child
        const username = process.env.BOT_USERNAME || "";
        const host = process.env.MC_HOST || "localhost";
        const port = parseInt(process.env.MC_PORT || "25565");
        let reconnectResult = "";

        if (username && child && child.stdin && !child.killed) {
          log(`Auto-reconnecting bot: ${username}@${host}:${port}`);
          try {
            reconnectResult = await new Promise<string>((resolve) => {
              const connectId = `_proxy_reconnect_${Date.now()}`;
              const connectReq = JSON.stringify({
                jsonrpc: "2.0",
                id: connectId,
                method: "tools/call",
                params: {
                  name: "mc_connect",
                  arguments: { action: "connect", username, host, port },
                },
              });

              const timeout = setTimeout(() => {
                log("Auto-reconnect timeout");
                resolve("Auto-reconnect: timeout (bot may need manual mc_connect)");
              }, 15_000);

              // Intercept the response for our reconnect call
              const interceptor = (data: Buffer) => {
                const text = data.toString();
                for (const line of text.split("\n")) {
                  const trimmed = line.trim();
                  if (!trimmed) continue;
                  try {
                    const resp = JSON.parse(trimmed);
                    if (resp.id === connectId) {
                      clearTimeout(timeout);
                      child!.stdout!.removeListener("data", interceptor);
                      const content = resp.result?.content?.[0]?.text || "connected";
                      log(`Auto-reconnect result: ${content.substring(0, 100)}`);
                      resolve(`Auto-reconnect: ${content}`);
                      return;
                    }
                  } catch { /* not JSON */ }
                  // Forward non-reconnect messages to client
                  process.stdout.write(trimmed + "\n");
                }
              };

              child!.stdout!.on("data", interceptor);
              child!.stdin!.write(connectReq + "\n");
            });
          } catch (err: any) {
            reconnectResult = `Auto-reconnect failed: ${err.message}`;
          }
        } else if (!username) {
          reconnectResult = "No BOT_USERNAME env var — call mc_connect manually.";
        }

        // Send success response
        sendToClient({
          jsonrpc: "2.0",
          id: requestId,
          result: {
            content: [{
              type: "text",
              text: `Full hot-reload complete (process restart).\nAll modules reloaded including bot-manager.\n${reconnectResult}\ntools/list_changed notification sent.`,
            }],
          },
        });
      }).catch((err) => {
        sendToClient({
          jsonrpc: "2.0",
          id: requestId,
          result: {
            content: [{
              type: "text",
              text: `Hot-reload failed: ${err.message}`,
            }],
            isError: true,
          },
        });
      });

      return true; // Handled — don't forward to child
    }
  } catch {
    // Not valid JSON — forward as-is
  }

  return false;
}

/**
 * Main: set up proxy
 */
function main() {
  log("Starting MCP hot-reload proxy");
  log(`Downstream server: ${SERVER_SCRIPT}`);

  child = spawnChild();

  let stdinBuffer = "";
  process.stdin.on("data", (data: Buffer) => {
    const text = data.toString();
    stdinBuffer += text;

    const lines = stdinBuffer.split("\n");
    stdinBuffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (isRestarting) {
        requestBuffer.push(trimmed);
        log("Buffered request during restart");
        continue;
      }

      // Check if proxy should handle this request
      if (handleRequest(trimmed)) {
        continue; // Proxy handled it
      }

      // Forward to child
      if (child && child.stdin && !child.killed) {
        child.stdin.write(trimmed + "\n");
      }
    }
  });

  process.stdin.on("end", () => {
    log("stdin closed — shutting down");
    if (child && !child.killed) child.kill("SIGTERM");
    process.exit(0);
  });

  const shutdown = () => {
    log("Shutting down...");
    if (child && !child.killed) child.kill("SIGTERM");
    setTimeout(() => process.exit(0), 1000);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
