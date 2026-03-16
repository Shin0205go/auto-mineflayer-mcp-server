/**
 * Find animals and shear sheep for wool to make bed
 */
import mineflayer from 'mineflayer';
import pfPkg from 'mineflayer-pathfinder';
const { pathfinder, Movements, goals } = pfPkg;
const { GoalNear } = goals;

const bot = mineflayer.createBot({
  host: 'localhost', port: 25565, username: 'Claude1', version: '1.21.4'
});
bot.loadPlugin(pathfinder);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

bot.once('spawn', async () => {
  await sleep(3000);
  console.log('Pos:', bot.entity.position);
  console.log('HP:', bot.health, 'Food:', bot.food);
  console.log('Time:', bot.time.timeOfDay);

  // List all nearby entities
  const entities = Object.values(bot.entities);
  const animals = entities.filter(e =>
    e && e.name && ['sheep', 'cow', 'pig', 'chicken', 'rabbit'].includes(e.name.toLowerCase())
  );

  console.log('Nearby animals (within loaded chunks):', animals.length);
  animals.forEach(a => {
    const dist = a.position.distanceTo(bot.entity.position);
    console.log(' -', a.name, 'at', a.position, 'dist:', dist.toFixed(1));
  });

  // Try to find sheep specifically
  const sheep = animals.filter(a => a.name && a.name.toLowerCase() === 'sheep');
  console.log('Sheep found:', sheep.length);

  // If no sheep nearby, explore in different directions
  if (sheep.length === 0) {
    console.log('No sheep in view. Moving to explore areas...');

    // Try several exploration points
    const points = [
      { x: -39, y: 114, z: -133 },  // Known sheep location
      { x: -50, y: 100, z: -100 },
      { x: 50, y: 95, z: -50 },
      { x: -30, y: 95, z: 50 },
    ];

    for (const pt of points) {
      const movements = new Movements(bot);
      movements.canDig = false;
      movements.maxDropDown = 2;
      bot.pathfinder.setMovements(movements);

      bot.pathfinder.setGoal(new GoalNear(pt.x, pt.y, pt.z, 5));

      // Wait for pathfinder to try
      await sleep(8000);
      bot.pathfinder.setGoal(null);

      const pos = bot.entity.position;
      console.log(`At (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})`);
      console.log('HP:', bot.health, 'Food:', bot.food);

      // Check for animals at new position
      const newEntities = Object.values(bot.entities);
      const newAnimals = newEntities.filter(e =>
        e && e.name && ['sheep', 'cow', 'pig', 'chicken'].includes(e.name.toLowerCase())
      );
      console.log('Animals now visible:', newAnimals.length);
      newAnimals.forEach(a => {
        const dist = a.position.distanceTo(bot.entity.position);
        console.log(' -', a.name, 'at', a.position, 'dist:', dist.toFixed(1));
      });

      if (newAnimals.length > 0) {
        console.log('Found animals! Stopping exploration.');
        break;
      }
    }
  }

  console.log('Done exploring. Final pos:', bot.entity.position);
  console.log('HP:', bot.health, 'Food:', bot.food);
  bot.quit();
});

bot.on('error', (err) => console.error('Bot error:', err.message));
bot.on('kicked', (reason) => console.log('Kicked:', reason));
