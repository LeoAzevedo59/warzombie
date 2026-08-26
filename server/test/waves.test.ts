import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ZombieSim } from '../src/game/ZombieSim.js';
import { WaveDirector } from '../src/game/WaveDirector.js';
import { GAME } from '../../shared/gameconfig.js';

function setup(players: number) {
  let now = 0;
  const events: string[] = [];
  const hits: Array<{ id: string; amount: number }> = [];
  const sim = new ZombieSim(
    {
      damagePlayer: (id, amount) => hits.push({ id, amount }),
      knockback: () => undefined,
      slowPlayer: (id, f, t) => events.push(`slow:${id}:${f}:${t}`),
      bossSlam: () => events.push('slam'),
      zombieDied: (z) => events.push(`died:${z.kind}`),
    },
    () => [],
    () => 0.5, // determinístico
  );
  const waves = new WaveDirector(
    sim,
    {
      waveStarted: (w, count, n) => events.push(`wave:${w}:${count}:${n}`),
      bossSpawned: () => events.push('boss'),
      phaseComplete: () => events.push('complete'),
      playerCount: () => players,
    },
    () => now,
  );
  return { sim, waves, events, hits, advance: (s: number) => (now += s) };
}

test('waves escalam ×1.5 por jogador e seguem o intervalo de 60s', () => {
  const { sim, waves, events, advance } = setup(3);
  waves.activate();
  assert.equal(waves.state().phase, 'countdown');
  advance(GAME.waves.FIRST_DELAY);
  assert.ok(waves.tick());
  const mult = 1.5 ** 2;
  assert.equal(events[0], `wave:1:${Math.round(GAME.waves.BASE_COUNT[0] * mult)}:3`);
  assert.equal(sim.aliveCount, Math.round(GAME.waves.BASE_COUNT[0] * mult));
  const z = [...sim.alive()][0];
  assert.equal(z.maxHp, Math.round(GAME.zombie.MAX_HP * mult));
  assert.equal(z.damage, Math.round(GAME.zombie.DAMAGE * mult));
  assert.equal(waves.state().nextIn, 60);
  advance(59);
  assert.equal(waves.tick(), false);
  advance(1);
  assert.ok(waves.tick());
  assert.equal(waves.wave, 2);
});

test('depois da wave 5 limpa vem o boss; boss morto conclui a fase', () => {
  const { sim, waves, events, advance } = setup(1);
  waves.activate();
  advance(GAME.waves.FIRST_DELAY);
  for (let w = 1; w <= 5; w++) {
    waves.tick();
    assert.equal(waves.wave, w);
    advance(GAME.waves.INTERVAL);
  }
  assert.equal(waves.tick(), false); // wave 5 sem próxima agendada, zumbis ainda vivos
  for (const z of [...sim.alive()]) sim.damage(z, 9999);
  assert.ok(waves.tick());
  assert.equal(waves.state().phase, 'boss');
  assert.ok(events.includes('boss'));
  const boss = [...sim.alive()].find((z) => z.kind === 'boss')!;
  assert.equal(boss.maxHp, GAME.zombie.MAX_HP * GAME.boss.HP_MULT);
  sim.damage(boss, 99999, 'A');
  assert.ok(waves.tick());
  assert.equal(waves.state().phase, 'complete');
  assert.ok(events.includes('complete'));
});

test('zumbi persegue o jogador vivo mais próximo, ataca no alcance e respeita os limites do mapa', () => {
  const { sim, hits } = setup(1);
  const z = sim.spawn('zombie', 0, 0);
  const far = { id: 'far', position: { x: 10, z: 0 }, dead: false };
  const near = { id: 'near', position: { x: 4, z: 0 }, dead: false };
  const dead = { id: 'dead', position: { x: 1, z: 0 }, dead: true };
  for (let i = 0; i < 40; i++) sim.tick(0.05, [far, near, dead]);
  assert.equal(z.state === 'chase' || z.state === 'attack', true);
  assert.equal(z.targetId, 'near');
  assert.ok(z.x > 1.5, `deveria ter avançado: x=${z.x}`);
  // deixa atacar: leva ~1s de animação até o hit
  for (let i = 0; i < 80; i++) sim.tick(0.05, [far, near, dead]);
  assert.ok(hits.some((h) => h.id === 'near'), 'deveria ter acertado o jogador próximo');
  // limites: andando para fora do mapa, para na borda
  z.state = 'wander';
  z.stateTime = 0;
  z.wanderWait = 0;
  z.wanderTarget = { x: 1000, z: 0 };
  z.x = 47;
  sim.tick(0.5, []);
  assert.ok(z.x <= 3 * 16, `fora do mapa: x=${z.x}`);
});

test('cuspidor lança projétil que causa dano e lentidão', () => {
  const { sim, hits, events } = setup(1);
  const z = sim.spawn('spitter', 0, 0);
  z.spitCooldown = 0;
  const t = { id: 'p', position: { x: 8, z: 0 }, dead: false };
  for (let i = 0; i < 6; i++) sim.tick(0.1, [t]); // detecta e entra em chase -> spit
  assert.equal(z.state, 'spit');
  for (let i = 0; i < 4; i++) sim.tick(0.1, [t]); // dispara em FIRE_AT (0.35s)
  assert.ok(sim.projectiles.size >= 1, 'projétil deveria existir');
  for (let i = 0; i < 20; i++) sim.tick(0.05, [t]);
  assert.ok(hits.some((h) => h.id === 'p' && h.amount === GAME.zombie.SPIT.DAMAGE), 'dano do cuspe');
  assert.ok(events.some((e) => e.startsWith('slow:p:')), 'lentidão aplicada');
  assert.equal(sim.projectiles.size, 0);
});

test('chefão invoca zumbis e dispara rajada à distância', () => {
  const { sim } = setup(1);
  const boss = sim.spawn('boss', 0, 0);
  boss.summonCooldown = 0;
  boss.spitCooldown = 0;
  boss.chargeCooldown = 99;
  const t = { id: 'p', position: { x: 12, z: 0 }, dead: false };
  for (let i = 0; i < 4; i++) sim.tick(0.1, [t]);
  assert.equal(sim.aliveCount, 1 + GAME.boss.SUMMON.COUNT);
  assert.equal(boss.state, 'volley');
  for (let i = 0; i < 6; i++) sim.tick(0.1, [t]);
  assert.equal([...sim.projectiles.values()].filter((p) => p.boss).length, GAME.boss.VOLLEY.COUNT);
});
