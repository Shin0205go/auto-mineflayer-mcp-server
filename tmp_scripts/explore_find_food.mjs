/**
 * Explore methodically to find animals for food and wool
 * Current position: (-22.5, 95, -133)
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
  await sleep(5000);  // Wait longer for chunks to load
  console.log('Start:', bot.entity.position, 'HP:', bot.health, 'Food:', bot.food);
  console.log('Time:', bot.time.timeOfDay);

  const mov = new Movements(bot);
  mov.canDig = true;
  mov.allow1by1towers = true;
  mov.maxDropDown = 3;
  bot.pathfinder.setMovements(mov);

  // Exploration waypoints in a spiral pattern
  const waypoints = [
    { x: -40, z: -130 },   // near known sheep hill
    { x: -55, z: -155 },   // further north
    { x: -30, z: -180 },   // northeast
    { x: 20, z: -180 },    // back east
    { x: 50, z: -150 },    // far east
    { x: 50, z: -80 },     // return south
    { x: 0, z: -50 },      // base area
  ];

  for (const wp of waypoints) {
    console.log('--- Moving to waypoint (' + wp.x + ', ?, ' + wp.z + ') ---');
    bot.pathfinder.setGoal(new GoalXZ(wp.x, wp.z));

    let moved = false;
    bot.once('goal_reached', () => { moved = true; });

    await sleep(20000);
    bot.pathfinder.setGoal(null);

    const pos = bot.entity.position;
    console.log('At:', pos, 'HP:', bot.health, 'Food:', bot.food);

    // Check time
    const time = bot.time.timeOfDay;
    console.log('Time:', time, time > 12541 ? '(NIGHT - careful!)' : '(day)');

    // Check for animals
    const entities = Object.values(bot.entities);
    const animals = entities.filter(e => e && e.name &&
      ['sheep', 'cow', 'pig', 'chicken', 'rabbit'].includes(e.name.toLowerCase())
    );
    console.log('Animals in view:', animals.length);
    animals.slice(0, 5).forEach(a => {
      const dist = a.position.distanceTo(pos);
      console.log(' -', a.name, 'at y=' + a.position.y.toFixed(0), 'dist:', dist.toFixed(1));
    });

    if (animals.length > 0) {
      const closest = animals.sort((a, b) =>
        a.position.distanceTo(pos) - b.position.distanceTo(pos)
      )[0];

      if (closest.position.distanceTo(pos) < 50) {
        console.log('Attempting to reach', closest.name, '...');
        bot.pathfinder.setGoal(new GoalNear(
          closest.position.x, closest.position.y, closest.position.z, 3
        ));
        await sleep(15000);
        bot.pathfinder.setGoal(null);

        const dist2 = closest.position.distanceTo(bot.entity.position);
        if (dist2 < 5) {
          console.log('Reached', closest.name + '!');

          if (closest.name.toLowerCase() === 'sheep') {
            const shearsItem = bot.inventory.items().find(i => i.name === 'shears');
            if (shearsItem) {
              await bot.equip(shearsItem, 'hand');
              try {
                await bot.activateEntity(closest);
                console.log('SHEARED SHEEP!');
              } catch (e) { console.log('Shear error:', e.message); }
              await sleep(500);
            }
          }

          // Kill for food test
          const sword = bot.inventory.items().find(i => i.name.includes('sword'));
          if (sword) await bot.equip(sword, 'hand');
          const countBefore = bot.inventory.items().length;
          bot.attack(closest);
          await sleep(2000);
          const countAfter = bot.inventory.items().length;

          if (countAfter > countBefore) {
            console.log('GOT DROPS! doMobLoot is ENABLED!');
            const food = bot.inventory.items().filter(i =>
              ['beef', 'mutton', 'porkchop', 'chicken', 'rabbit'].includes(i.name)
            );
            console.log('Raw food:', food.map(i => i.name + 'x' + i.count).join(', '));
            break;
          } else {
            console.log('No drops - doMobLoot still disabled');
          }
        }
      }
    }

    const wool = bot.inventory.items().filter(i => i.name.includes('wool'));
    const food = bot.inventory.items().filter(i =>
      ['beef', 'mutton', 'porkchop', 'chicken', 'rotten_flesh'].includes(i.name)
    );
    console.log('Wool so far:', wool.map(i => i.name + 'x' + i.count).join(', ') || 'none');
    console.log('Food so far:', food.map(i => i.name + 'x' + i.count).join(', ') || 'none');
    if (wool.reduce((s, i) => s + i.count, 0) >= 3 && food.length > 0) {
      console.log('Have enough! Stopping.');
      break;
    }
  }

  const wool = bot.inventory.items().filter(i => i.name.includes('wool'));
  const food = bot.inventory.items().filter(i =>
    ['beef', 'mutton', 'porkchop', 'chicken', 'cooked_beef', 'cooked_mutton', 'rotten_flesh'].includes(i.name)
  );
  console.log('=== FINAL ===');
  console.log('Pos:', bot.entity.position, 'HP:', bot.health, 'Food:', bot.food);
  console.log('Wool:', wool.map(i => i.name + 'x' + i.count).join(', ') || 'none');
  console.log('Food items:', food.map(i => i.name + 'x' + i.count).join(', ') || 'none');

  bot.quit();
});

bot.on('error', (err) => console.error('Bot error:', err.message));
bot.on('kicked', (reason) => console.log('Kicked:', reason));
bot.on('death', () => console.log('BOT DIED! Respawning...'));
