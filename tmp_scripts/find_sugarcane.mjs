/**
 * Search for sugar cane (reed/bamboo areas) and village
 * Also check nearby biomes
 */
import mineflayer from 'mineflayer';
import pfPkg from 'mineflayer-pathfinder';
const { pathfinder, Movements, goals } = pfPkg;
const { GoalNear, GoalXZ, GoalBlock } = goals;

const bot = mineflayer.createBot({
  host: 'localhost', port: 25565, username: 'Claude1', version: '1.21.4'
});
bot.loadPlugin(pathfinder);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

bot.once('spawn', async () => {
  await sleep(5000);
  console.log('Start:', bot.entity.position, 'HP:', bot.health, 'Food:', bot.food);
  console.log('Time:', bot.time.timeOfDay, 'Biome:', bot.world.getBiome ? 'checking...' : 'N/A');

  const mov = new Movements(bot);
  mov.canDig = false;  // Don't dig during exploration
  mov.maxDropDown = 3;
  bot.pathfinder.setMovements(mov);

  // Search for sugar_cane blocks in loaded world
  function findSugarCane(radius) {
    const pos = bot.entity.position;
    const caneId = bot.registry.blocksByName['sugar_cane'] ? bot.registry.blocksByName['sugar_cane'].id : null;
    if (!caneId) {
      // Try 'reeds' (older version name)
      const reedId = bot.registry.blocksByName['reeds'] ? bot.registry.blocksByName['reeds'].id : null;
      if (!reedId) return [];
      return bot.findBlocks({ matching: reedId, maxDistance: radius, count: 5 });
    }
    return bot.findBlocks({ matching: caneId, maxDistance: radius, count: 5 });
  }

  // Search current area for sugar cane
  let canes = findSugarCane(128);
  console.log('Sugar cane within 128 blocks:', canes.length);
  if (canes.length > 0) {
    console.log('Found sugar cane at:', canes[0]);
  }

  // Also search for village structures
  function findVillageBlocks(radius) {
    const hayId = bot.registry.blocksByName['hay_block']?.id;
    const bellId = bot.registry.blocksByName['bell']?.id;
    const results = [];
    if (hayId) {
      const hay = bot.findBlocks({ matching: hayId, maxDistance: radius, count: 3 });
      if (hay.length > 0) results.push({ type: 'hay_block', positions: hay });
    }
    if (bellId) {
      const bells = bot.findBlocks({ matching: bellId, maxDistance: radius, count: 3 });
      if (bells.length > 0) results.push({ type: 'bell', positions: bells });
    }
    return results;
  }

  const villageBlocks = findVillageBlocks(128);
  console.log('Village indicators:', villageBlocks.length);

  // Explore in all 4 directions to find sugar cane (grows near water)
  const explorePoints = [
    { x: 100, z: 0, desc: 'east' },
    { x: -100, z: 0, desc: 'west' },
    { x: 0, z: 100, desc: 'south' },
    { x: 0, z: -200, desc: 'far north' },
  ];

  for (const pt of explorePoints) {
    console.log('--- Exploring', pt.desc, '(' + pt.x + ', ?, ' + pt.z + ') ---');
    bot.pathfinder.setGoal(new GoalXZ(pt.x, pt.z));
    await sleep(20000);
    bot.pathfinder.setGoal(null);

    const pos = bot.entity.position;
    console.log('At:', pos, 'HP:', bot.health, 'Time:', bot.time.timeOfDay);

    // Search for sugar cane
    let canes = findSugarCane(64);
    console.log('Sugar cane nearby:', canes.length);
    if (canes.length > 0) {
      console.log('FOUND SUGAR CANE at:', canes[0]);
      break;
    }

    // Search for village
    const vb = findVillageBlocks(64);
    if (vb.length > 0) {
      console.log('FOUND VILLAGE STRUCTURE:', vb);
      break;
    }

    // Also check entities for villagers
    const villagers = Object.values(bot.entities).filter(e =>
      e && e.name && e.name.toLowerCase().includes('villager')
    );
    if (villagers.length > 0) {
      console.log('FOUND VILLAGER!', villagers[0].position);
      break;
    }
  }

  console.log('=== DONE ===');
  console.log('Final pos:', bot.entity.position, 'HP:', bot.health);

  // Final sugar cane search
  let finalCanes = findSugarCane(64);
  console.log('Sugar cane at final pos:', finalCanes.length, finalCanes.length > 0 ? finalCanes[0] : '');

  bot.quit();
});

bot.on('error', (err) => console.error('Bot error:', err.message));
bot.on('kicked', (reason) => console.log('Kicked:', reason));
bot.on('death', () => console.log('BOT DIED!'));
