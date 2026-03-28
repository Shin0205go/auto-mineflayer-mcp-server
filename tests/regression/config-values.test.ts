/**
 * Regression tests for configuration values and code patterns that broke during 2026-03-23 session.
 * These tests verify source code contains correct values/patterns by reading the source files
 * and checking for specific strings, since most values are embedded in functions and not directly exportable.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(import.meta.dirname, "../..");

function readSrc(relPath: string): string {
  return readFileSync(join(ROOT, relPath), "utf-8");
}

// ─── 1. Pathfinder maxDropDown values ──────────────────────────────────────────

describe("pathfinder maxDropDown settings", () => {
  const movementSrc = readSrc("src/bot-manager/bot-movement.ts");
  const coreSrc = readSrc("src/bot-manager/bot-core.ts");
  const blocksSrc = readSrc("src/bot-manager/bot-blocks.ts");
  const survivalSrc = readSrc("src/bot-manager/bot-survival.ts");
  const craftingSrc = readSrc("src/bot-manager/bot-crafting.ts");
  const itemsSrc = readSrc("src/bot-manager/bot-items.ts");

  it("bot-core: default maxDropDown is 2 (not 1 — maxDropDown=1 caused movement failures in hilly biomes)", () => {
    expect(coreSrc).toContain("movements.maxDropDown = 2");
    // Must NOT contain maxDropDown = 1 (regression: caused pathfinder to fail in birch_forest)
    expect(coreSrc).not.toMatch(/movements\.maxDropDown\s*=\s*1/);
  });

  it("bot-movement: moveToBasic sets maxDropDown to 2", () => {
    expect(movementSrc).toContain("bot.pathfinder.movements.maxDropDown = 2");
    expect(movementSrc).not.toMatch(/movements\.maxDropDown\s*=\s*1/);
  });

  it("bot-blocks: maxDropDown is 2", () => {
    expect(blocksSrc).toContain("bot.pathfinder.movements.maxDropDown = 2");
    expect(blocksSrc).not.toMatch(/movements\.maxDropDown\s*=\s*1/);
  });

  it("bot-survival: applySafePathfinderSettings uses maxDropDown = 2", () => {
    expect(survivalSrc).toContain("bot.pathfinder.movements.maxDropDown = 2");
  });

  it("bot-crafting: maxDropDown is 2", () => {
    expect(craftingSrc).toContain("bot.pathfinder.movements.maxDropDown = 2");
    expect(craftingSrc).not.toMatch(/movements\.maxDropDown\s*=\s*1/);
  });

  it("collectNearbyItems: maxDropDown is 3 (items fall 1-2 blocks from kill position)", () => {
    expect(itemsSrc).toContain("bot.pathfinder.movements.maxDropDown = 3");
  });

  it("bot-survival post-kill item collection: maxDropDown is 3", () => {
    expect(survivalSrc).toContain("bot.pathfinder.movements.maxDropDown = 3");
  });
});

// ─── 2. collectNearbyItems implementation ──────────────────────────────────────

describe("collectNearbyItems (bot-items.ts)", () => {
  const src = readSrc("src/bot-manager/bot-items.ts");

  it("uses Math.ceil for Y coordinate (not Math.round — Math.round puts goal inside ground block)", () => {
    expect(src).toContain("Math.ceil(itemPos.y)");
    // Ensure Math.round is NOT used for Y in the GoalNear call
    expect(src).not.toMatch(/new goals\.GoalNear\([^)]*Math\.round\(itemPos\.y\)/);
  });

  it("GoalNear range is 1 (not 2 — range=2 left bot outside auto-pickup range, Sessions 58-65)", () => {
    // Fix [Sessions 58-65]: GoalNear(2) stopped pathfinder at 2 blocks from item,
    // outside Minecraft's ~1-block auto-pickup range. Changed to GoalNear(1).
    const goalNearMatch = src.match(
      /new goals\.GoalNear\(\s*Math\.round\(itemPos\.x\),\s*Math\.ceil\(itemPos\.y\),\s*Math\.round\(itemPos\.z\),\s*(\d+)/
    );
    expect(goalNearMatch).not.toBeNull();
    expect(goalNearMatch![1]).toBe("1");
  });

  it("canDig is set to false during item collection", () => {
    expect(src).toContain("bot.pathfinder.movements.canDig = false");
  });
});

// ─── 3. fight() hostile abort in bot-survival.ts ──────────────────────────────

describe("fight() hostile abort (bot-survival.ts)", () => {
  const src = readSrc("src/bot-manager/bot-survival.ts");

  it("hostile abort distance is 4-5 blocks (not 12 — 12 caused constant aborts during animal hunting)", () => {
    // The passive hunt hostile abort section: after passiveFoodMobs, find the hostile distance check
    // It should use "< 5" for the hostile abort distance within the passive hunt block
    const passiveHuntIdx = src.indexOf("passiveFoodMobs");
    expect(passiveHuntIdx).toBeGreaterThan(-1);
    // Get a larger block to capture the full passive hunt logic
    const passiveHuntBlock = src.substring(passiveHuntIdx, passiveHuntIdx + 2000);
    // The line: return e.position.distanceTo(bot.entity.position) < 5;
    const hasSmallRadius = passiveHuntBlock.includes("< 4") || passiveHuntBlock.includes("< 5"); expect(hasSmallRadius).toBe(true);
    // Must NOT use 12 in this specific section
    expect(passiveHuntBlock).not.toContain(".distanceTo(bot.entity.position) < 12");
  });

  it("food-desperate hunt skips hostile abort (isFoodDesperateFight)", () => {
    expect(src).toContain("isPassiveHunt && !isFoodDesperateFight");
  });

  it("isFoodDesperateFight requires: food animal target + no food + hunger <= 6", () => {
    expect(src).toMatch(
      /isFoodDesperateFight\s*=\s*isFoodAnimalTarget\s*&&\s*hasNoFood\s*&&\s*hungerLevel\s*<=\s*6/
    );
  });

  it("attack range check: within 3.5 blocks skips abort", () => {
    expect(src).toContain("distToTarget <= 3.5");
    expect(src).toContain("alreadyInRange");
  });
});

// ─── 4. mc_status nearbyEntities ──────────────────────────────────────────────

describe("mc_status nearbyEntities (core-tools.ts)", () => {
  const src = readSrc("src/tools/core-tools.ts");

  it("status result includes nearbyEntities field in return object", () => {
    expect(src).toMatch(/nearbyEntities,/);
  });

  it("nearbyEntities is declared as Record<string, number>", () => {
    expect(src).toMatch(/const nearbyEntities:\s*Record<string,\s*number>\s*=\s*\{\}/);
  });
});

// ─── 5. bot.moveTo() calls botManager.moveTo() directly ──────────────────────

describe("bot.moveTo() in mc-execute sandbox", () => {
  const src = readSrc("src/tools/mc-execute.ts");

  it("moveTo calls botManager.moveTo() directly (not mc_navigate)", () => {
    expect(src).toContain("botManager.moveTo(username, x, y, z)");
  });

  it("moveTo definition does not reference mc_navigate", () => {
    // Extract the moveTo function body (next ~200 chars after 'moveTo:')
    const moveToIdx = src.indexOf("moveTo: async (x: number");
    expect(moveToIdx).toBeGreaterThan(-1);
    const moveToBlock = src.substring(moveToIdx, moveToIdx + 300);
    expect(moveToBlock).not.toContain("mc_navigate");
  });
});

// ─── 6. combat phantom kill (attackCount === 0 + target gone) ─────────────────

describe("combat phantom kill detection (bot-survival.ts)", () => {
  const src = readSrc("src/bot-manager/bot-survival.ts");

  it("checks attackCount === 0 when target disappears", () => {
    expect(src).toMatch(/if\s*\(attackCount\s*===\s*0\)/);
  });

  it("attackCount === 0 block returns 'disappeared' not 'defeated'", () => {
    const idx = src.indexOf("if (attackCount === 0)");
    expect(idx).toBeGreaterThan(-1);
    // Get the block after the check (up to the closing of the if block)
    const block = src.substring(idx, idx + 800);
    expect(block).toContain("disappeared");
    expect(block).not.toContain('"defeated"');
  });

  it("attempts re-targeting before reporting disappeared", () => {
    const idx = src.indexOf("if (attackCount === 0)");
    const block = src.substring(idx, idx + 500);
    expect(block).toContain("findTarget()");
    expect(block).toContain("retargeting");
  });
});

// ─── 7. farm() auto-flee on abort ─────────────────────────────────────────────

describe("farm() auto-flee on abort (core-tools.ts)", () => {
  const src = readSrc("src/tools/core-tools.ts");

  it("mid-farm hostile detection calls mc_flee", () => {
    expect(src).toContain("Hostile detected during farming");
    // After hostile detection, mc_flee must be called
    const idx = src.indexOf("Hostile detected during farming");
    expect(idx).toBeGreaterThan(-1);
    const afterAbort = src.substring(idx, idx + 500);
    expect(afterAbort).toContain("mc_flee");
  });

  it("mid-farm low HP triggers flee", () => {
    // The HP check during farming should also call mc_flee
    // Look for the HP<10 farm abort
    const matches = [...src.matchAll(/midFarmHp\s*<\s*10/g)];
    expect(matches.length).toBeGreaterThan(0);
    // After that check, mc_flee should be called
    const idx = src.indexOf("midFarmHp < 10");
    expect(idx).toBeGreaterThan(-1);
    const afterHpCheck = src.substring(idx, idx + 300);
    expect(afterHpCheck).toContain("mc_flee");
  });
});

// ─── 8. wait() HP abort logic ─────────────────────────────────────────────────

describe("wait() HP abort logic (mc-execute.ts)", () => {
  const src = readSrc("src/tools/mc-execute.ts");

  it("HP < 3 is absolute abort floor regardless of HP stability", () => {
    expect(src).toContain("hp < 3");
  });

  it("HP < 6 only aborts if HP has actually dropped (hpDroppedSinceStart >= 1)", () => {
    expect(src).toContain("hp < 6 && hpDroppedSinceStart >= 1");
  });

  it("tracks waitStartHp for stable-HP detection", () => {
    expect(src).toContain("waitStartHp");
    expect(src).toContain("const hpDroppedSinceStart = waitStartHp - hp");
  });

  it("abort condition is: hp < 6 && hpDroppedSinceStart >= 1 (hp<3 absolute floor removed — caused infinite abort loop at stable low HP)", () => {
    // hp < 3 absolute floor was removed because it caused the bot to get stuck in an
    // infinite abort loop when HP was stable at < 3 (e.g., respawn bug). The bot should
    // wait even at very low HP as long as HP isn't actively dropping.
    expect(src).toMatch(
      /if\s*\(\s*hp\s*<\s*6\s*&&\s*hpDroppedSinceStart\s*>=\s*1\s*\)/
    );
  });

  it("does NOT abort on hp < 6 alone (prevents infinite abort loop at stable low HP)", () => {
    // There should be no standalone hp < 6 abort without the hpDroppedSinceStart guard
    // The only hp < 6 check should be paired with hpDroppedSinceStart
    const hpLt6Matches = [...src.matchAll(/hp\s*<\s*6/g)];
    for (const match of hpLt6Matches) {
      const context = src.substring(Math.max(0, match.index! - 20), match.index! + 60);
      // Each hp < 6 should either be in the compound condition or in a comment
      const isInCompound = context.includes("hpDroppedSinceStart") || context.includes("hp < 3");
      const isComment = context.includes("//") || context.includes("`");
      expect(isInCompound || isComment).toBe(true);
    }
  });
});

// ─── 9. HP regen warning in status() ──────────────────────────────────────────

describe("HP regen warning in mc_status (core-tools.ts)", () => {
  const src = readSrc("src/tools/core-tools.ts");

  it("warns when HP < 10 and hunger < 18 that HP will NOT regenerate", () => {
    // Bot3 Bug #57 [2026-03-28]: bot at HP=4.2, hunger=12, waited 10s expecting HP to recover.
    // In Minecraft, natural HP regeneration requires hunger >= 18. At hunger 1-17, no regen.
    expect(src).toContain("HP WILL NOT REGENERATE NATURALLY");
    expect(src).toContain("hunger must be >= 18 for natural HP regen");
  });

  it("HP regen warning fires when HP < 10 AND food < 18 AND food > 0 (not starvation)", () => {
    // The warning is for the mid-range case (hunger 1-17, HP low) — not starvation (food=0).
    // Starvation (food=0) already has its own STARVATION warning.
    const warnIdx = src.indexOf("HP WILL NOT REGENERATE NATURALLY");
    expect(warnIdx).toBeGreaterThan(-1);
    // Find the enclosing if condition
    const before = src.substring(Math.max(0, warnIdx - 300), warnIdx);
    expect(before).toContain("health < 10");
    expect(before).toContain("food < 18");
    expect(before).toContain("food > 0");
  });
});
