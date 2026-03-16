/**
 * Far exploration: go 200-400 blocks away to find animals, sugar cane, or village
 * HP=9.5, Hunger=0 (starvation floor on Normal difficulty = won't die from hunger alone)
 * But avoid any fall damage or mob combat!
 */
import mineflayer from 'mineflayer';
import pfPkg from 'mineflayer-pathfinder';
const { pathfinder, Movements, goals } = pfPkg;
const { GoalXZ, GoalNear } = goals;

const bot = mineflayer.createBot({
  host: 'localhost', port: 25565, username: 'Claude1', version: '1.21.4'
});
bot.loadPlugin(pathfinder);

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function goTo(x, z, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      bot.pathfinder.stop();
      resolve('timeout');
    }, timeoutMs);
    bot.pathfinder.setGoal(new GoalXZ(x, z));
    bot.once('goal_reached', () => { clearTimeout(timeout); resolve('reached'); });
    bot.once('path_update', (r) => {
      if (r.status === 'noPath') { clearTimeout(timeout); resolve('noPath'); }
    });
  });
}

function scanAnimals(radius = 100) {
  return Object.values(bot.entities).filter(e =>
    ['pig', 'sheep', 'cow', 'chicken'].includes(e.name) &&
    e.position.distanceTo(bot.entity.position) < radius
  ).sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position));
}

async function huntAnimal(target) {
  const tx = target.position.x, ty = target.position.y, tz = target.position.z;
  console.log(`  Hunting ${target.name} at ${Math.round(tx)},${Math.round(ty)},${Math.round(tz)}`);

  await new Promise((resolve) => {
    const timeout = setTimeout(() => { bot.pathfinder.stop(); resolve(); }, 15000);
    bot.pathfinder.setGoal(new GoalNear(tx, ty, tz, 2));
    bot.once('goal_reached', () => { clearTimeout(timeout); resolve(); });
    bot.once('path_update', (r) => { if (r.status === 'noPath') { clearTimeout(timeout); resolve(); } });
  });

  const distFinal = target.position.distanceTo(bot.entity.position);
  if (distFinal < 5) {
    const sword = bot.inventory.items().find(i => i.name.includes('sword'));
    if (sword) await bot.equip(sword, 'hand');
    for (let i = 0; i < 12; i++) {
      if (!target.isValid) break;
      try { bot.attack(target); } catch(e) {}
      await sleep(500);
    }
    await sleep(1500);
    // Walk to drops
    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, 4000);
      bot.pathfinder.setGoal(new GoalNear(tx, ty, tz, 1));
      bot.once('goal_reached', () => { clearTimeout(timeout); resolve(); });
      bot.once('path_update', () => { clearTimeout(timeout); resolve(); });
    });
    await sleep(800);
  }

  const got = bot.inventory.items().filter(i =>
    ['porkchop', 'beef', 'mutton', 'chicken', 'cooked_porkchop', 'cooked_beef',
     'cooked_mutton', 'cooked_chicken', 'leather'].includes(i.name)
  );
  console.log('  Got:', got.map(i => `${i.name}x${i.count}`).join(', ') || 'nothing');
  return got;
}

function checkSugarCane() {
  const sc = bot.findBlock({ matching: bot.registry.blocksByName['sugar_cane']?.id, maxDistance: 64 });
  return sc;
}

function checkVillage() {
  // Look for villagers, hay bales, or village buildings (beds, barrels, etc.)
  const villager = Object.values(bot.entities).find(e => e.name === 'villager');
  const hayBale = bot.findBlock({ matching: bot.registry.blocksByName['hay_block']?.id, maxDistance: 64 });
  const farmland = bot.findBlock({ matching: bot.registry.blocksByName['farmland']?.id, maxDistance: 32 });
  return { villager, hayBale, farmland };
}

bot.once('spawn', async () => {
  console.log('Spawned at:', bot.entity.position, 'HP:', bot.health, 'Hunger:', bot.food);

  const movements = new Movements(bot);
  movements.maxDropDown = 2;
  movements.canDig = false;
  bot.pathfinder.setMovements(movements);

  await sleep(1500);

  // Explore in 8 directions, each 200-300 blocks out
  const basePos = bot.entity.position.clone();
  const explorations = [
    { name: 'NE', dx: 150, dz: -150 },
    { name: 'NW', dx: -150, dz: -150 },
    { name: 'SE', dx: 150, dz: 150 },
    { name: 'SW', dx: -150, dz: 150 },
    { name: 'N2', dx: 0, dz: -250 },
    { name: 'S2', dx: 0, dz: 250 },
    { name: 'E2', dx: 250, dz: 0 },
    { name: 'W2', dx: -250, dz: 0 },
  ];

  let foundFood = false;
  let foundLeather = false;

  for (const exp of explorations) {
    if (foundLeather) break;

    const tx = basePos.x + exp.dx;
    const tz = basePos.z + exp.dz;
    console.log(`\n=== Exploring ${exp.name}: ${Math.round(tx)},z=${Math.round(tz)} ===`);

    // Navigate in stages
    const midX = basePos.x + exp.dx * 0.5;
    const midZ = basePos.z + exp.dz * 0.5;
    const r1 = await goTo(midX, midZ, 25000);
    console.log(`Stage 1 result: ${r1} at ${Math.round(bot.entity.position.x)},${Math.round(bot.entity.position.z)}`);

    // Check animals at midpoint
    let animals = scanAnimals(100);
    if (animals.length > 0) {
      console.log(`Found ${animals.length} animals at midpoint!`);
      animals.slice(0, 3).forEach(a => {
        const d = Math.round(a.position.distanceTo(bot.entity.position));
        console.log(`  ${a.name} dist=${d}`);
      });

      // Hunt
      for (const animal of animals.slice(0, 3)) {
        await huntAnimal(animal);
        const leather = bot.inventory.items().find(i => i.name === 'leather');
        if (leather) { foundLeather = true; break; }
      }

      // Eat any raw meat
      const rawMeat = bot.inventory.items().find(i =>
        ['beef', 'porkchop', 'mutton', 'chicken'].includes(i.name)
      );
      const cookedMeat = bot.inventory.items().find(i =>
        ['cooked_beef', 'cooked_porkchop', 'cooked_mutton', 'cooked_chicken'].includes(i.name)
      );
      const eatThis = cookedMeat || rawMeat;
      if (eatThis) {
        foundFood = true;
        console.log('Eating', eatThis.name);
        await bot.equip(eatThis, 'hand');
        for (let e = 0; e < Math.min(eatThis.count, 5); e++) {
          bot.activateItem();
          await sleep(1800);
          if (bot.food >= 18) break;
        }
        console.log('HP:', bot.health, 'Hunger:', bot.food);
      }

      if (foundLeather) break;
    }

    // Check village/sugar cane at midpoint
    const sc = checkSugarCane();
    if (sc) console.log('SUGAR CANE at', sc.position);
    const village = checkVillage();
    if (village.villager) console.log('VILLAGER found!', village.villager.position);
    if (village.hayBale) console.log('HAY BALE at', village.hayBale.position);

    // Continue to full distance
    const r2 = await goTo(tx, tz, 30000);
    console.log(`Stage 2 result: ${r2} at ${Math.round(bot.entity.position.x)},${Math.round(bot.entity.position.z)}`);

    // Check animals at destination
    await sleep(500);
    animals = scanAnimals(100);
    if (animals.length > 0) {
      console.log(`Found ${animals.length} animals at destination!`);
      animals.slice(0, 3).forEach(a => {
        const d = Math.round(a.position.distanceTo(bot.entity.position));
        console.log(`  ${a.name} dist=${d}`);
      });

      for (const animal of animals.slice(0, 3)) {
        await huntAnimal(animal);
        const leather = bot.inventory.items().find(i => i.name === 'leather');
        if (leather) { foundLeather = true; break; }
      }

      const rawMeat = bot.inventory.items().find(i =>
        ['beef', 'porkchop', 'mutton', 'chicken'].includes(i.name)
      );
      const cookedMeat = bot.inventory.items().find(i =>
        ['cooked_beef', 'cooked_porkchop', 'cooked_mutton', 'cooked_chicken'].includes(i.name)
      );
      const eatThis = cookedMeat || rawMeat;
      if (eatThis) {
        foundFood = true;
        console.log('Eating', eatThis.name);
        await bot.equip(eatThis, 'hand');
        for (let e = 0; e < Math.min(eatThis.count, 5); e++) {
          bot.activateItem();
          await sleep(1800);
          if (bot.food >= 18) break;
        }
        console.log('HP:', bot.health, 'Hunger:', bot.food);
      }

      if (foundLeather) break;
    }

    // Check village/sugar cane at destination
    const sc2 = checkSugarCane();
    if (sc2) console.log('SUGAR CANE at', sc2.position);
    const village2 = checkVillage();
    if (village2.villager) console.log('VILLAGER found!', village2.villager.position);
    if (village2.hayBale) console.log('HAY BALE at', village2.hayBale.position);

    // Return to base between explorations
    console.log('Returning to base...');
    await goTo(basePos.x, basePos.z, 40000);
    await sleep(500);
    animals = scanAnimals(200);
    console.log('Animals visible now:', animals.length);
  }

  console.log('\n=== Final Status ===');
  console.log('Pos:', bot.entity.position);
  console.log('HP:', bot.health, 'Hunger:', bot.food);
  const inv = bot.inventory.items();
  console.log('Leather:', inv.find(i => i.name === 'leather')?.count || 0);
  console.log('Key inventory:', inv.filter(i =>
    ['leather', 'beef', 'porkchop', 'mutton', 'cooked_beef', 'cooked_porkchop', 'cooked_mutton'].includes(i.name)
  ).map(i => `${i.name}x${i.count}`).join(', ') || 'none');

  bot.end();
});

bot.on('error', e => { console.error('Bot error:', e.message); });
bot.on('end', () => { console.log('Bot disconnected'); process.exit(0); });
