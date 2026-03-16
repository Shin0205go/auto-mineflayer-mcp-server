/**
 * Navigate to base area, find iron ore, mine gravel for flint
 * Bot currently at (-32, 95, 1) HP=15, Hunger=14
 * Goal: get flint + iron_ingot → craft flint_and_steel → activate portal
 */
import mineflayer from 'mineflayer';
import pfPkg from 'mineflayer-pathfinder';
const { pathfinder, Movements, goals } = pfPkg;
const { GoalNear, GoalXZ } = goals;
import { Vec3 } from 'vec3';

const bot = mineflayer.createBot({
  host: 'localhost', port: 25565, username: 'Claude1', version: '1.21.4'
});
bot.loadPlugin(pathfinder);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const inv = (name) => bot.inventory.items().find(i => i.name === name);
const invCount = (name) => inv(name)?.count || 0;

async function goTo(x, y, z, dist = 3, t = 40000) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => { bot.pathfinder.stop(); resolve('timeout'); }, t);
    bot.pathfinder.setGoal(new GoalNear(x, y, z, dist));
    bot.once('goal_reached', () => { clearTimeout(timeout); resolve('reached'); });
    bot.once('path_update', (r) => { if (r.status === 'noPath') { clearTimeout(timeout); resolve('noPath'); } });
  });
}

bot.once('spawn', async () => {
  await sleep(2000);
  console.log('Pos:', bot.entity.position, 'HP:', bot.health, 'Hunger:', bot.food);

  const movements = new Movements(bot);
  movements.maxDropDown = 3; // Slightly more than 2 for terrain
  movements.canDig = true;
  movements.allow1by1towers = false;
  bot.pathfinder.setMovements(movements);

  // Step 1: Navigate to base area (crafting table + furnace)
  console.log('\n=== Going to furnace area (-5, 101, -14) ===');
  const r1 = await goTo(-5, 101, -14, 4, 50000);
  console.log('Nav:', r1, 'at', bot.entity.position, 'HP:', bot.health);

  // Check furnace
  const furnaceBlock = bot.findBlock({ matching: bot.registry.blocksByName['furnace']?.id, maxDistance: 15 });
  console.log('Furnace:', furnaceBlock?.position || 'not found');

  // Step 2: Mine gravel for flint (lots available nearby)
  console.log('\n=== Mining gravel for flint ===');
  let flint = invCount('flint');
  let mined = 0;

  for (let attempt = 0; attempt < 50 && flint === 0; attempt++) {
    const gravelId = bot.registry.blocksByName['gravel']?.id;

    // Find closest gravel
    const gravelBlocks = bot.findBlocks({ matching: gravelId, maxDistance: 30, count: 5 });
    if (gravelBlocks.length === 0) {
      console.log('No gravel nearby!');
      break;
    }

    // Try each gravel block
    let mineSuccess = false;
    for (const gPos of gravelBlocks) {
      const gb = bot.blockAt(new Vec3(gPos.x, gPos.y, gPos.z));
      if (!gb || gb.name !== 'gravel') continue;

      const dist = gb.position.distanceTo(bot.entity.position);
      if (dist > 4) {
        // Navigate close
        const r = await goTo(gPos.x, gPos.y, gPos.z, 2, 8000);
        if (r === 'noPath') continue;
      }

      const closeGravel = bot.findBlock({ matching: gravelId, maxDistance: 3 });
      if (!closeGravel) continue;

      const pick = inv('iron_pickaxe');
      if (pick) await bot.equip(pick, 'hand');

      try {
        await Promise.race([bot.dig(closeGravel), sleep(5000)]);
      } catch(e) {}
      await sleep(300);
      mined++;
      mineSuccess = true;
      flint = invCount('flint');
      break;
    }

    if (!mineSuccess) {
      console.log('Could not mine gravel at attempt', attempt);
      // Try navigating somewhere else
      const randomGravel = gravelBlocks[Math.floor(Math.random() * gravelBlocks.length)];
      await goTo(randomGravel.x, randomGravel.y, randomGravel.z, 3, 10000);
    }

    if (mined % 10 === 0 && mined > 0) {
      console.log(`Mined ${mined} gravel, flint=${flint}, gravel_inv=${invCount('gravel')}`);
    }
  }

  console.log(`Flint: ${flint} (mined ${mined} gravel)`);

  // Step 3: Find and mine iron ore
  console.log('\n=== Mining iron ore ===');
  let rawIron = invCount('raw_iron');

  if (rawIron === 0) {
    // Iron ore at (-8, 101-103, -80) - ~80 blocks away
    console.log('Going to iron ore cluster (-8, 101, -80)...');
    const r2 = await goTo(-8, 101, -80, 5, 60000);
    console.log('Nav:', r2, 'at', bot.entity.position);

    // Mine iron ore
    const oreId = bot.registry.blocksByName['iron_ore']?.id;
    for (let i = 0; i < 5; i++) {
      const ore = bot.findBlock({ matching: oreId, maxDistance: 15 });
      if (!ore) {
        console.log('No iron ore nearby');
        break;
      }
      console.log('Mining ore at', ore.position);
      const r3 = await goTo(ore.position.x, ore.position.y, ore.position.z, 2, 12000);
      const pick2 = inv('diamond_pickaxe') || inv('iron_pickaxe');
      if (pick2) await bot.equip(pick2, 'hand');
      const closeOre = bot.findBlock({ matching: oreId, maxDistance: 3 });
      if (closeOre) {
        await Promise.race([bot.dig(closeOre), sleep(5000)]);
        await sleep(300);
      }
    }
    rawIron = invCount('raw_iron');
    console.log('Raw iron:', rawIron);
  }

  // Step 4: Smelt
  let ironIngot = invCount('iron_ingot');
  if (rawIron > 0 && ironIngot === 0) {
    console.log('\n=== Smelting ===');
    let fb = bot.findBlock({ matching: bot.registry.blocksByName['furnace']?.id, maxDistance: 50 });
    if (!fb) {
      await goTo(-5, 101, -14, 3, 30000);
      fb = bot.findBlock({ matching: bot.registry.blocksByName['furnace']?.id, maxDistance: 10 });
    }

    if (fb) {
      const r4 = await goTo(fb.position.x, fb.position.y, fb.position.z, 2, 20000);
      console.log('At furnace:', r4, 'at', bot.entity.position);
      const fbBlock = bot.blockAt(fb.position);
      try {
        const furnace = await bot.openFurnace(fbBlock);
        const coal = inv('coal');
        const ri = inv('raw_iron');
        const n = Math.min(ri.count, 3);
        if (coal) await furnace.putFuel(coal.type, null, Math.min(coal.count, n + 1));
        await sleep(200);
        if (ri) await furnace.putInput(ri.type, null, n);
        await sleep(200);
        console.log(`Smelting ${n} iron...`);
        await sleep(n * 10500 + 3000);
        const out = furnace.outputItem();
        if (out) { await furnace.takeOutput(); console.log('Got', out.name, out.count); }
        furnace.close();
      } catch(e) { console.log('Furnace error:', e.message); }
    }
    ironIngot = invCount('iron_ingot');
  }

  // Step 5: Craft flint_and_steel
  flint = invCount('flint');
  ironIngot = invCount('iron_ingot');
  console.log('\nFlint:', flint, 'Iron ingot:', ironIngot);

  if (flint > 0 && ironIngot > 0) {
    console.log('=== Crafting flint_and_steel ===');
    const fasId = bot.registry.itemsByName['flint_and_steel']?.id;
    const recipes = bot.recipesFor(fasId, null, 1, null);
    if (recipes.length > 0) {
      try {
        await bot.craft(recipes[0], 1, null);
        console.log('flint_and_steel:', invCount('flint_and_steel') > 0 ? 'SUCCESS!' : 'FAILED');
      } catch(e) { console.log('Error:', e.message); }
    }
  }

  // Step 6: Activate portal
  if (invCount('flint_and_steel') > 0) {
    console.log('\n=== Activating portal at (-4 to -5, 103, 27) ===');
    await goTo(-4, 103, 27, 3, 40000);
    console.log('At portal, pos:', bot.entity.position);

    const fas = inv('flint_and_steel');
    if (fas) await bot.equip(fas, 'hand');

    // Activate portal by right-clicking obsidian blocks in the frame
    const obsidianId = bot.registry.blocksByName['obsidian']?.id;
    const obsidianBlocks = bot.findBlocks({ matching: obsidianId, maxDistance: 8, count: 5 });
    console.log('Obsidian nearby:', obsidianBlocks.length);

    for (const obsPos of obsidianBlocks) {
      const obsBlock = bot.blockAt(new Vec3(obsPos.x, obsPos.y, obsPos.z));
      if (!obsBlock) continue;
      try {
        await bot.activateBlock(obsBlock);
        await sleep(500);
        const portalActive = bot.findBlock({
          matching: bot.registry.blocksByName['nether_portal']?.id,
          maxDistance: 10
        });
        if (portalActive) {
          console.log('PORTAL ACTIVATED!');
          break;
        }
      } catch(e) { console.log('Activate error:', e.message); }
    }

    const portalCheck = bot.findBlock({
      matching: bot.registry.blocksByName['nether_portal']?.id,
      maxDistance: 15
    });
    console.log('Portal status:', portalCheck ? 'ACTIVE at ' + portalCheck.position : 'inactive');
  }

  console.log('\n=== Final ===');
  console.log('HP:', bot.health, 'Hunger:', bot.food, 'at', bot.entity.position);
  ['flint', 'iron_ingot', 'raw_iron', 'flint_and_steel'].forEach(n => {
    const c = invCount(n);
    if (c > 0) console.log(` ${n}x${c}`);
  });

  bot.end();
});

bot.on('error', e => { console.error(e.message); process.exit(1); });
bot.on('end', () => process.exit(0));
