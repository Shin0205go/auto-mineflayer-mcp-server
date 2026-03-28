import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// Source-analysis tests for bot-crafting.ts
// Documents the root-cause fixes for craft() consuming ingredients without producing items.
// No live mineflayer bot required.

const src = readFileSync(resolve("src/bot-manager/bot-crafting.ts"), "utf-8");

// ─── 1. Ingredient substitution fix ──────────────────────────────────────────

describe("ingredient substitution (bot-crafting.ts)", () => {
  it("inShape is treated as Array<Array<{id,metadata}|null>> (not number[][])", () => {
    // Bug: code compared shape[row][col] === oldId (object vs number → always false)
    // Fix: code now accesses cell.id for comparison
    expect(src).toContain(
      "inShape as Array<Array<{ id: number; metadata?: number } | null>>"
    );
  });

  it("inShape substitution uses cell.id === oldId (not cell === oldId)", () => {
    // Bug: shape[row][col] === oldId compared object reference to number → always false
    // Fix: cell.id === oldId compares the numeric id property
    expect(src).toContain("if (cell && cell.id === oldId) cell.id = substituteItemData.id");
    // Must NOT use the broken pattern (object comparison)
    expect(src).not.toMatch(/\bshape\[row\]\[col\]\s*===\s*oldId/);
  });

  it("ingredients is treated as Array<{id,metadata}> (not number[])", () => {
    // Bug: code compared ingredients[idx] === oldId (object vs number → always false)
    // Fix: code now accesses ing.id for comparison
    expect(src).toContain("if (ing && ing.id === oldId) ing.id = substituteItemData.id");
    // Must NOT use the broken pattern
    expect(src).not.toMatch(/\bingredients\[idx\]\s*===\s*oldId/);
  });

  it("iterates inShape cells with for-of loop (not index-based assignment)", () => {
    // Old code: shape[row][col] = substituteItemData.id (assignment to dereferenced cell)
    // New code: cell.id = substituteItemData.id (mutates the object in place)
    const idx = src.indexOf("inShape as Array<Array<{ id: number; metadata?: number } | null>>");
    expect(idx).toBeGreaterThan(-1);
    const block = src.substring(idx, idx + 400);
    expect(block).toContain("for (const row of shape)");
    expect(block).toContain("for (const cell of row)");
  });
});

// ─── 2. Result slot recovery ──────────────────────────────────────────────────

describe("result slot recovery (bot-crafting.ts)", () => {
  it("checks slot 0 of inventory after 2500ms wait (simple craft result slot)", () => {
    // Mineflayer grabResult() can fail silently on laggy servers:
    // putAway(0) packet arrives before server confirms slot 0 → item stuck in result slot.
    // Fix: explicitly check bot.inventory.slots[0] after the 2500ms wait.
    expect(src).toContain("RECOVERY: Check if item is stuck in the crafting result slot (slot 0)");
    expect(src).toMatch(/bot\.inventory\.slots\[0\]/);
  });

  it("shift-clicks slot 0 to recover stuck items (clickWindow(0, 0, 1))", () => {
    // Shift-click (button=1) on slot 0 moves the crafting result to inventory.
    // Regular click (button=0) picks it up to cursor — needs a second click to place.
    const recoveryIdx = src.indexOf("RECOVERY: Check if item is stuck in the crafting result slot");
    expect(recoveryIdx).toBeGreaterThan(-1);
    const recoveryBlock = src.substring(recoveryIdx, recoveryIdx + 1100);
    expect(recoveryBlock).toContain("clickWindow(0, 0, 1)"); // shift-click slot 0
    expect(recoveryBlock).toContain("shift-clicking to collect");
  });

  it("logs recovery action with item name and count", () => {
    // Recovery should log exactly what it found so we can diagnose future issues.
    expect(src).toContain("item stuck in result slot 0:");
    expect(src).toContain("Recovery result:");
  });

  it("recovers from crafting table window result slot before closing", () => {
    // Same bug applies to crafting table (4x4 grid, slot 0 = result).
    // Before closing the table window, shift-click slot 0 if item is present.
    expect(src).toContain("RECOVERY: check result slot 0 of crafting table window before closing");
    const tableRecoveryIdx = src.indexOf("RECOVERY: check result slot 0 of crafting table window before closing");
    expect(tableRecoveryIdx).toBeGreaterThan(-1);
    const tableBlock = src.substring(tableRecoveryIdx, tableRecoveryIdx + 800);
    expect(tableBlock).toContain("clickWindow(0, 0, 1)");
    expect(tableBlock).toContain("Table recovery:");
  });
});

// ─── 3. Underground escape in gather() ────────────────────────────────────────

describe("underground escape in gather() (high-level-actions.ts)", () => {
  const hlaSrc = readFileSync(resolve("src/tools/high-level-actions.ts"), "utf-8");

  it("triggers surface escape when failedPositions >= 3 AND bot Y < 62", () => {
    // Session 96 / 92d: bot stuck underground at Y<62, gather() times out endlessly.
    // Fix: when 3+ blocks are unreachable AND bot is deep underground, escape to Y=80.
    expect(hlaSrc).toContain("gatherBot.entity.position.y < 62");
    expect(hlaSrc).toContain("auto-escaped underground");
  });

  it("uses moveTo(x, 80, z) to escape underground", () => {
    // Target Y=80 puts bot above most cave systems (most caves end by Y=72).
    const escapeIdx = hlaSrc.indexOf("gatherBot.entity.position.y < 62");
    expect(escapeIdx).toBeGreaterThan(-1);
    const escapeBlock = hlaSrc.substring(escapeIdx, escapeIdx + 400);
    expect(escapeBlock).toContain("80");
    expect(escapeBlock).toContain("moveTo");
  });
});

// ─── 4. emergencyDigUp condition for deep underground ─────────────────────────

describe("emergencyDigUp deepUnderground condition (bot-movement.ts)", () => {
  const moveSrc = readFileSync(resolve("src/bot-manager/bot-movement.ts"), "utf-8");

  it("triggers emergencyDigUp when bot is at Y<62 even if target Y is similar", () => {
    // Session 96 bug: bot at Y=60, target at Y=61 (diff=1).
    // Old condition: targetIsHigher = (y - currentBotY) > 5 → false for diff=1 → no escape.
    // New condition: deepUnderground = currentBotY < 62 && y >= currentBotY - 2 → true → escape.
    expect(moveSrc).toContain("deepUnderground");
    expect(moveSrc).toMatch(/currentBotY\s*<\s*62\s*&&\s*y\s*>=\s*currentBotY\s*-\s*2/);
  });

  it("deepUnderground condition OR'd with targetIsHigher for emergencyDigUp trigger", () => {
    const deepIdx = moveSrc.indexOf("deepUnderground");
    expect(deepIdx).toBeGreaterThan(-1);
    // Find the if statement that uses both conditions
    const block = moveSrc.substring(Math.max(0, deepIdx - 100), deepIdx + 300);
    expect(block).toContain("targetIsHigher || deepUnderground");
  });
});
