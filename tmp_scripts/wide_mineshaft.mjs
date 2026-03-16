/**
 * Wide area search for mineshaft (rail blocks) and chests
 * Multiple directions at y=20-50 level
 */
import mineflayer from 'mineflayer';
import pfPkg from 'mineflayer-pathfinder';
const { pathfinder, Movements, goals } = pfPkg;
const { GoalNear, GoalXZ } = goals;

const bot = mineflayer.createBot({
  host: 'localhost', port: 25565, username: 'Claude1', version: '1.21.4'
});
bot.loadPlugin(pathfinder);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

bot.once('spawn', async () => {
  await sleep(5000);
  console.log('Start:', bot.entity.position, 'HP:', bot.health, 'Food:', bot.food);

  const mov = new Movements(bot);
  mov.canDig = true;
  mov.allow1by1towers = true;
  mov.maxDropDown = 4;
  bot.pathfinder.setMovements(mov);

  function findBlocks(blockName, radius) {
    const id = bot.registry.blocksByName[blockName]?.id;
    if (!id) { console.log('Block', blockName, 'not found in registry'); return []; }
    return bot.findBlocks({ matching: id, maxDistance: radius, count: 10 });
  }

  function checkForStructures() {
    const chests = findBlocks('chest', 64);
    const rails = findBlocks('rail', 64);
    const cobwebs = findBlocks('cobweb', 64);
    const spawners = findBlocks('spawner', 64);
    const mossCobble = findBlocks('mossy_cobblestone', 64);
    const sugarcane = findBlocks('sugar_cane', 64);

    console.log('Chests:', chests.length, chests.length > 0 ? chests.slice(0,2).join(', ') : '');
    console.log('Rails:', rails.length, rails.length > 0 ? rails[0] : '');
    console.log('Cobwebs:', cobwebs.length, cobwebs.length > 0 ? cobwebs[0] : '');
    console.log('Spawners:', spawners.length, spawners.length > 0 ? spawners[0] : '');
    console.log('Mossy cobblestone:', mossCobble.length);
    console.log('Sugar cane:', sugarcane.length, sugarcane.length > 0 ? sugarcane[0] : '');

    return { chests, rails, cobwebs, spawners, mossCobble, sugarcane };
  }

  // Search from underground positions in different quadrants
  const searchPoints = [
    { x: 100, z: 100, label: 'south-east' },
    { x: -100, z: 100, label: 'south-west' },
    { x: 100, z: -200, label: 'north-east' },
    { x: -100, z: -200, label: 'north-west' },
    { x: 200, z: 0, label: 'east' },
    { x: -200, z: 0, label: 'west' },
  ];

  for (const sp of searchPoints) {
    console.log('=== Searching', sp.label, '(' + sp.x + ', ?, ' + sp.z + ') ===');

    // Move to surface position first
    bot.pathfinder.setGoal(new GoalXZ(sp.x, sp.z));
    await sleep(25000);
    bot.pathfinder.setGoal(null);

    const surfacePos = bot.entity.position;
    console.log('Surface at:', surfacePos, 'HP:', bot.health, 'Time:', bot.time.timeOfDay);

    // Check at surface level first
    const surfaceStructs = checkForStructures();
    if (surfaceStructs.sugarcane.length > 0) {
      console.log('SUGAR CANE FOUND at surface! At:', surfaceStructs.sugarcane[0]);
      break;
    }

    // Now check if there are notable structures
    if (surfaceStructs.chests.length > 1 || surfaceStructs.rails.length > 0) {
      console.log('STRUCTURE FOUND! Investigating...');
      break;
    }
  }

  console.log('=== FINAL ===');
  console.log('Pos:', bot.entity.position);
  const finalStructs = checkForStructures();

  bot.quit();
});

bot.on('error', (err) => console.error('Bot error:', err.message));
bot.on('kicked', (reason) => console.log('Kicked:', reason));
bot.on('death', () => {
  console.log('BOT DIED! Respawned.');
});
