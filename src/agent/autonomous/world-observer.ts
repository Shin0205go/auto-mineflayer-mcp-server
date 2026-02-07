/**
 * World Observer
 *
 * Calls MCP tools to build a WorldState snapshot.
 * Parses critical numeric values for the interrupt system.
 */

import type { MCPWebSocketClientTransport } from "../mcp-ws-transport.js";
import type { WorldState, InventoryItem, NearbyEntity, Position } from "./types.js";

/**
 * Extract text from MCP tool call result
 */
function extractText(result: unknown): string {
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
 * Parse HP and hunger from status text.
 * Expected format: "HP: 20/20" and "Hunger: 18/20"
 */
function parseStatus(text: string): { health: number; hunger: number; equipment: string } {
  let health = 20;
  let hunger = 20;

  const hpMatch = text.match(/HP:\s*(\d+(?:\.\d+)?)\s*\/\s*\d+/i);
  if (hpMatch) health = parseFloat(hpMatch[1]);

  const hungerMatch = text.match(/(?:Hunger|Food):\s*(\d+(?:\.\d+)?)\s*\/\s*\d+/i);
  if (hungerMatch) hunger = parseFloat(hungerMatch[1]);

  // Extract equipment section
  const equipLines: string[] = [];
  const lines = text.split("\n");
  let inEquip = false;
  for (const line of lines) {
    if (/armor|equipment|hotbar/i.test(line)) {
      inEquip = true;
    }
    if (inEquip) {
      equipLines.push(line);
    }
  }

  return { health, hunger, equipment: equipLines.join("\n") || "unknown" };
}

/**
 * Parse position from position text.
 * Expected format: "Position: x=123.5, y=64.0, z=-456.2"
 */
function parsePosition(text: string): Position {
  const xMatch = text.match(/x[=:]\s*(-?\d+(?:\.\d+)?)/i);
  const yMatch = text.match(/y[=:]\s*(-?\d+(?:\.\d+)?)/i);
  const zMatch = text.match(/z[=:]\s*(-?\d+(?:\.\d+)?)/i);

  return {
    x: xMatch ? parseFloat(xMatch[1]) : 0,
    y: yMatch ? parseFloat(yMatch[1]) : 0,
    z: zMatch ? parseFloat(zMatch[1]) : 0,
  };
}

/**
 * Parse inventory items from inventory text.
 */
function parseInventory(text: string): InventoryItem[] {
  const items: InventoryItem[] = [];
  const lines = text.split("\n");
  for (const line of lines) {
    // Match patterns like "- diamond_sword x1" or "diamond_sword (1)"
    const match1 = line.match(/[-•]\s*(\w+)\s*x(\d+)/i);
    const match2 = line.match(/[-•]\s*(\w+)\s*\((\d+)\)/i);
    const match3 = line.match(/(\w+(?:_\w+)*)\s*[x×]\s*(\d+)/i);
    const m = match1 || match2 || match3;
    if (m) {
      items.push({ name: m[1], count: parseInt(m[2]) });
    }
  }
  return items;
}

/**
 * Parse nearby entities from entities text.
 */
function parseEntities(text: string): NearbyEntity[] {
  const entities: NearbyEntity[] = [];
  const lines = text.split("\n");
  for (const line of lines) {
    // Match patterns like "- zombie (hostile) at distance 5.2" or "zombie: 5.2 blocks"
    const match1 = line.match(/[-•]\s*(\w+)\s*\((\w+)\)\s*(?:at\s+)?(?:distance\s+)?(\d+(?:\.\d+)?)/i);
    const match2 = line.match(/[-•]\s*(\w+).*?(\d+(?:\.\d+)?)\s*blocks?/i);
    if (match1) {
      entities.push({
        name: match1[1],
        type: classifyEntityType(match1[2]),
        distance: parseFloat(match1[3]),
      });
    } else if (match2) {
      entities.push({
        name: match2[1],
        type: guessEntityType(match2[1]),
        distance: parseFloat(match2[2]),
      });
    }
  }
  return entities;
}

function classifyEntityType(typeStr: string): NearbyEntity["type"] {
  const lower = typeStr.toLowerCase();
  if (lower === "hostile") return "hostile";
  if (lower === "passive") return "passive";
  if (lower === "player") return "player";
  return "unknown";
}

const HOSTILE_NAMES = new Set([
  "zombie", "skeleton", "creeper", "spider", "enderman",
  "witch", "slime", "phantom", "drowned", "husk",
  "stray", "blaze", "ghast", "magma_cube", "wither_skeleton",
  "pillager", "vindicator", "evoker", "ravager", "vex",
  "hoglin", "piglin_brute", "warden", "cave_spider",
]);

function guessEntityType(name: string): NearbyEntity["type"] {
  if (HOSTILE_NAMES.has(name.toLowerCase())) return "hostile";
  if (name.toLowerCase() === "player") return "player";
  return "passive";
}

/**
 * Parse time from surroundings text.
 */
function parseTime(text: string): number {
  const match = text.match(/(?:time|tick)[s:=]*\s*(\d+)/i);
  if (match) return parseInt(match[1]);
  // Check for day/night keywords
  if (/night/i.test(text)) return 14000;
  if (/day|morning/i.test(text)) return 6000;
  if (/dusk|sunset/i.test(text)) return 12000;
  if (/dawn|sunrise/i.test(text)) return 23000;
  return 6000; // default to daytime
}

/**
 * Parse biome from surroundings text.
 */
function parseBiome(text: string): string {
  const match = text.match(/(?:biome|バイオーム)[s:=]*\s*(\w+(?:_\w+)*)/i);
  return match ? match[1] : "unknown";
}

/**
 * Check if surroundings text indicates shelter exists.
 */
function parseShelter(text: string): boolean {
  // Look for indicators of shelter
  if (/shelter|house|base|roof|enclosed/i.test(text)) return true;
  if (/bed nearby|bed at/i.test(text)) return true;
  return false;
}

/**
 * Observe the world state by calling MCP tools.
 */
export async function observeWorld(mcp: MCPWebSocketClientTransport): Promise<WorldState> {
  // Call all observation tools in parallel
  const [statusResult, posResult, invResult, entResult, surroundResult] = await Promise.all([
    mcp.callTool("minecraft_get_status", {}).catch(() => "HP: 20/20, Hunger: 20/20"),
    mcp.callTool("minecraft_get_position", {}).catch(() => "x=0, y=64, z=0"),
    mcp.callTool("minecraft_get_inventory", {}).catch(() => "Empty inventory"),
    mcp.callTool("minecraft_get_nearby_entities", { range: 16, type: "all" }).catch(() => "No entities nearby"),
    mcp.callTool("minecraft_get_surroundings", {}).catch(() => "Unable to observe surroundings"),
  ]);

  const rawStatus = extractText(statusResult);
  const rawPosition = extractText(posResult);
  const rawInventory = extractText(invResult);
  const rawEntities = extractText(entResult);
  const rawSurroundings = extractText(surroundResult);

  const { health, hunger, equipment } = parseStatus(rawStatus);
  const position = parsePosition(rawPosition);
  const inventory = parseInventory(rawInventory);
  const allEntities = parseEntities(rawEntities);
  const nearbyThreats = allEntities.filter((e) => e.type === "hostile");

  return {
    time: parseTime(rawSurroundings),
    health,
    hunger,
    position,
    inventory,
    nearbyThreats,
    nearbyEntities: allEntities,
    shelterExists: parseShelter(rawSurroundings),
    equipment,
    biome: parseBiome(rawSurroundings),
    achievements: [],
    rawStatus,
    rawSurroundings,
    rawInventory,
    rawEntities,
  };
}

/**
 * Quick observe - only status and nearby entities (for interrupt checks).
 * Cheaper than full observe.
 */
export async function quickObserve(
  mcp: MCPWebSocketClientTransport,
  previous: WorldState,
): Promise<WorldState> {
  const [statusResult, entResult] = await Promise.all([
    mcp.callTool("minecraft_get_status", {}).catch(() => previous.rawStatus),
    mcp.callTool("minecraft_get_nearby_entities", { range: 16, type: "all" }).catch(() => previous.rawEntities),
  ]);

  const rawStatus = extractText(statusResult);
  const rawEntities = extractText(entResult);

  const { health, hunger, equipment } = parseStatus(rawStatus);
  const allEntities = parseEntities(rawEntities);
  const nearbyThreats = allEntities.filter((e) => e.type === "hostile");

  return {
    ...previous,
    health,
    hunger,
    equipment,
    nearbyThreats,
    nearbyEntities: allEntities,
    rawStatus,
    rawEntities,
  };
}
