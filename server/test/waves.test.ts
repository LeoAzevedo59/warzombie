import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ZombieSim } from '../src/game/ZombieSim.js';
import { WaveDirector } from '../src/game/WaveDirector.js';
import { bossTier } from '../src/game/ZombieSim.js';
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
      bossIncoming: (w, s) => events.push(`incoming:${w}:${s}`),
      bossSpawned: (_id, _hp, w) => events.push(`boss:${w}`),
      waveCleared: (w) => events.push(`cleared:${w}`),
      phaseComplete: () => events.push('complete'),
      waveFailed: (w, boss) => events.push(`failed:${w}:${boss}`),
      playerCount: () => players,
    },
    () => now,
  );
  return { sim, waves, events, hits, advance: (s: number) => (now += s) };
}

test('waves escalam ×1.5 por jogador; horda limpa chama o chefão da wave; chefão morto = antena espera outra bateria', () => {
  const { sim, waves, events, advance } = setup(3);
  waves.activate();
  assert.equal(waves.state().phase, 'countdown');
  assert.equal(waves.wave, 1); // bateria 1 na antena
  advance(GAME.waves.FIRST_DELAY);
  assert.ok(waves.tick());
  const mult = 1.5 ** 2;
  assert.equal(events[0], `wave:1:${Math.round(GAME.waves.BASE_COUNT[0] * mult)}:3`);
  assert.equal(sim.aliveCount, Math.round(GAME.waves.BASE_COUNT[0] * mult));
  const z = [...sim.alive()][0];
  assert.equal(z.maxHp, Math.round(GAME.zombie.MAX_HP * mult));
  assert.equal(z.damage, Math.round(GAME.zombie.DAMAGE * mult));
  assert.equal(waves.state().timeLeft, GAME.waves.TIME_LIMIT);
  advance(30);
  assert.equal(waves.tick(), false); // ainda com zumbis vivos: nada muda
  for (const zb of [...sim.alive()]) sim.damage(zb, 9999);
  assert.ok(waves.tick());
  assert.equal(waves.state().phase, 'countdown');
  assert.equal(waves.state().bossNext, true);
  assert.equal(waves.state().nextIn, GAME.waves.BOSS_DELAY);
  assert.ok(events.includes(`incoming:1:${GAME.waves.BOSS_DELAY}`));
  advance(GAME.waves.BOSS_DELAY);
  assert.ok(waves.tick());
  assert.equal(waves.state().phase, 'boss');
  assert.ok(events.includes('boss:1'));
  const boss = [...sim.alive()].find((b) => b.kind === 'boss')!;
  assert.equal(boss.maxHp, Math.round(GAME.zombie.MAX_HP * mult * bossTier(1).HP_MULT));
  assert.equal(boss.damage, Math.round(GAME.boss.DAMAGE * bossTier(1).DMG_MULT * mult));
  assert.equal(waves.state().timeLeft, GAME.waves.BOSS_TIME_LIMIT);
  sim.damage(boss, 1e9);
  assert.ok(waves.tick());
  // não vem a wave 2 sozinha: antena parada com 1 bateria, esperando a próxima
  assert.equal(waves.state().phase, 'idle');
  assert.equal(waves.wave, 1);
  assert.equal(waves.state().nextIn, null);
  assert.ok(events.includes('cleared:1'));
  assert.equal(waves.canActivate, true);
  advance(600);
  assert.equal(waves.tick(), false);
  assert.equal(waves.state().phase, 'idle');
  waves.activate();
  assert.equal(waves.wave, 2);
  advance(GAME.waves.FIRST_DELAY);
  waves.tick();
  assert.equal(waves.state().phase, 'wave');
  // wave 2 é mais difícil: vida × HP_GROWTH e dano × DMG_GROWTH
  const z2 = [...sim.alive()][0];
  assert.equal(z2.maxHp, Math.round(GAME.zombie.MAX_HP * mult * GAME.waves.HP_GROWTH));
  assert.equal(z2.damage, Math.round(GAME.zombie.DAMAGE * mult * GAME.waves.DMG_GROWTH));
});

test('estourar o tempo remove a horda e perde só a bateria daquela wave (ambientais/infectados ficam)', () => {
  const { sim, waves, events, advance } = setup(1);
  const ambient = sim.spawn('zombie', 5, 5);
  const infected = sim.spawnInfected('B', 'lis', 'A', 1, 1);
  waves.activate();
  advance(GAME.waves.FIRST_DELAY);
  waves.tick();
  assert.equal(waves.wave, 1);
  advance(GAME.waves.TIME_LIMIT - 1);
  assert.equal(waves.tick(), false);
  advance(1);
  assert.ok(waves.tick());
  assert.equal(waves.state().phase, 'idle');
  assert.equal(waves.wave, 0);
  assert.equal(sim.aliveHunters, 0);
  assert.deepEqual([...sim.zombies.keys()].sort(), [ambient.id, infected.id].sort());
  assert.ok(events.includes('failed:1:false'));
  // nova bateria recomeça da wave 1
  waves.activate();
  advance(GAME.waves.FIRST_DELAY);
  waves.tick();
  assert.equal(waves.wave, 1);
  for (const z of [...sim.alive()]) if (z.hunter) sim.damage(z, 9999);
  waves.tick();
  advance(GAME.waves.BOSS_DELAY);
  waves.tick();
  sim.damage([...sim.alive()].find((z) => z.kind === 'boss')!, 1e9);
  waves.tick();
  assert.equal(waves.wave, 1);
  // falhar contra o chefão da wave 2 volta para 1 bateria: a wave 2 precisa de outra bateria, mas a 1 fica
  waves.activate();
  advance(GAME.waves.FIRST_DELAY);
  waves.tick();
  for (const z of [...sim.alive()]) if (z.hunter) sim.damage(z, 9999);
  waves.tick();
  advance(GAME.waves.BOSS_DELAY);
  waves.tick();
  assert.equal(waves.state().phase, 'boss');
  advance(GAME.waves.BOSS_TIME_LIMIT);
  assert.ok(waves.tick());
  assert.ok(events.includes('failed:2:true'));
  assert.equal(waves.state().phase, 'idle');
  assert.equal(waves.wave, 1);
  assert.equal(sim.aliveHunters, 0);
});

test('5 baterias = 5 waves com um chefão cada, cada vez mais forte; o 5º chefão morto conclui a fase', () => {
  const { sim, waves, events, advance } = setup(1);
  let lastBossHp = 0;
  let lastZombieHp = 0;
  for (let w = 1; w <= GAME.waves.TOTAL; w++) {
    assert.equal(waves.canActivate, true);
    waves.activate();
    assert.equal(waves.wave, w);
    assert.equal(waves.canActivate, false); // uma bateria por wave
    advance(GAME.waves.FIRST_DELAY);
    waves.tick();
    assert.equal(waves.state().phase, 'wave');
    assert.equal(sim.aliveHunters, GAME.waves.BASE_COUNT[w - 1]);
    const horde = [...sim.alive()][0];
    assert.ok(horde.maxHp > lastZombieHp, `wave ${w}: horda deveria ficar mais forte`);
    lastZombieHp = horde.maxHp;
    for (const z of [...sim.alive()]) sim.damage(z, 9999);
    waves.tick(); // limpa -> chefão a caminho
    advance(GAME.waves.BOSS_DELAY);
    assert.ok(waves.tick());
    assert.equal(waves.state().phase, 'boss');
    assert.ok(events.includes(`boss:${w}`));
    const boss = [...sim.alive()].find((z) => z.kind === 'boss')!;
    assert.equal(boss.tier, w);
    assert.equal(boss.maxHp, Math.round(GAME.zombie.MAX_HP * Math.pow(GAME.waves.HP_GROWTH, w - 1) * bossTier(w).HP_MULT));
    assert.ok(boss.maxHp > lastBossHp, `wave ${w}: chefão deveria ficar mais forte`);
    lastBossHp = boss.maxHp;
    sim.damage(boss, 1e9, 'A');
    assert.ok(waves.tick());
    if (w < GAME.waves.TOTAL) {
      assert.equal(waves.state().phase, 'idle');
      assert.ok(events.includes(`cleared:${w}`));
    }
  }
  assert.equal(waves.state().phase, 'complete');
  assert.ok(events.includes('complete'));
  assert.equal(waves.canActivate, false);
  waves.activate(); // sem efeito depois de concluir
  assert.equal(waves.state().phase, 'complete');
  // o último chefão é o insano: muito acima do primeiro
  assert.ok(bossTier(5).HP_MULT >= bossTier(1).HP_MULT * 4);
  assert.ok(bossTier(5).SUMMON > bossTier(1).SUMMON);
});

test('(dev) próxima wave: parado inicia a horda; na horda pula para o chefão; no chefão mata ele', () => {
  const { sim, waves } = setup(1);
  waves.devNextWave();
  assert.equal(waves.state().phase, 'wave');
  assert.equal(waves.wave, 1);
  waves.devNextWave();
  assert.equal(waves.state().phase, 'boss');
  assert.equal(sim.aliveHunters, 1);
  waves.devNextWave();
  waves.tick();
  assert.equal(waves.state().phase, 'idle');
  assert.equal(waves.wave, 1);
  waves.devSpawnBoss();
  assert.equal(waves.state().phase, 'boss');
  assert.equal(waves.wave, 2);
  assert.equal([...sim.alive()].find((z) => z.kind === 'boss')!.tier, 2);
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
  assert.equal(sim.aliveCount, 1 + bossTier(1).SUMMON);
  assert.equal(boss.state, 'volley');
  for (let i = 0; i < 6; i++) sim.tick(0.1, [t]);
  assert.equal([...sim.projectiles.values()].filter((p) => p.boss).length, GAME.boss.VOLLEY.COUNT);
});

test('zumbi de wave volta a atacar quando o jogador renasce longe', () => {
  const { sim } = setup(1);
  const z = sim.spawn('zombie', 30, 30, 1, 1, true);
  const p = { id: 'p', position: { x: 28, z: 30 }, dead: false };
  for (let i = 0; i < 10; i++) sim.tick(0.1, [p]);
  assert.ok(z.state === 'chase' || z.state === 'attack');
  p.dead = true; // morreu
  for (let i = 0; i < 20; i++) sim.tick(0.1, [p]);
  assert.equal(z.state, 'wander');
  p.dead = false; // renasceu no centro, a ~40 unidades
  p.position = { x: 0, z: 0 };
  sim.tick(0.1, [p]);
  assert.equal(z.state, 'chase');
  assert.equal(z.targetId, 'p');
  const d0 = Math.hypot(z.x, z.z);
  for (let i = 0; i < 20; i++) sim.tick(0.1, [p]);
  assert.ok(Math.hypot(z.x, z.z) < d0 - 5, 'deveria estar vindo até o jogador');
});

test('caçador prefere a torre quando está mais perto e a danifica com STRUCTURE_DAMAGE_MULT', () => {
  const { sim, hits } = setup(1);
  const z = sim.spawn('zombie', 0, 0, 1, 1, true);
  const tower = { id: 'tower', position: { x: 3, z: 0 }, dead: false, radius: 0.9, kind: 'tower' as const };
  const player = { id: 'p', position: { x: 20, z: 0 }, dead: false, radius: 0.35, kind: 'player' as const };
  for (let i = 0; i < 40; i++) sim.tick(0.05, [player, tower]);
  assert.equal(z.targetId, 'tower');
  for (let i = 0; i < 60; i++) sim.tick(0.05, [player, tower]);
  const hit = hits.find((h) => h.id === 'tower');
  assert.ok(hit, 'deveria ter batido na torre');
  assert.equal(hit!.amount, GAME.zombie.DAMAGE * GAME.zombie.STRUCTURE_DAMAGE_MULT);
});

test('jogador a até GUARD_RADIUS da torre é atacado antes dela (mesmo estando mais longe do zumbi)', () => {
  const { sim, hits } = setup(1);
  const z = sim.spawn('zombie', 0, 0, 1, 1, true);
  const tower = { id: 'tower', position: { x: 3, z: 0 }, dead: false, radius: 0.9, kind: 'tower' as const };
  const guard = { id: 'p', position: { x: 3 + GAME.zombie.GUARD_RADIUS - 1, z: 0 }, dead: false, radius: 0.35, kind: 'player' as const };
  for (let i = 0; i < 40; i++) sim.tick(0.05, [guard, tower]);
  assert.equal(z.targetId, 'p');
  for (let i = 0; i < 80; i++) sim.tick(0.05, [guard, tower]);
  assert.ok(hits.some((h) => h.id === 'p'), 'deveria ter batido no defensor');
  assert.ok(!hits.some((h) => h.id === 'tower'), 'não deveria ter tocado na torre');
  // defensor saiu do raio: volta para a torre
  guard.position.x = 40;
  for (let i = 0; i < 40; i++) sim.tick(0.05, [guard, tower]);
  assert.equal(z.targetId, 'tower');
});

test('infectado: mais forte que zumbi comum, caça o assassino mesmo com outro jogador mais perto, e some após DURATION', () => {
  const { sim, hits } = setup(1);
  const z = sim.spawnInfected('B', 'lis', 'A', 0, 0);
  assert.equal(z.maxHp, GAME.zombie.MAX_HP * GAME.infected.HP_MULT);
  assert.equal(z.damage, Math.round(GAME.zombie.DAMAGE * GAME.infected.DAMAGE_MULT));
  assert.ok(GAME.infected.SPEED > GAME.zombie.CHASE_SPEED);
  assert.equal(sim.aliveHunters, 0); // não conta para limpar a wave
  const killer = { id: 'A', position: { x: 20, z: 0 }, dead: false, kind: 'player' as const };
  const other = { id: 'C', position: { x: 2, z: -3 }, dead: false, kind: 'player' as const };
  const tower = { id: 'tower', position: { x: 2, z: 3 }, dead: false, radius: 0.9, kind: 'tower' as const };
  sim.tick(0.1, [killer, other, tower]);
  assert.equal(z.targetId, 'A'); // longe (fora do raio de detecção) e com C do lado: mesmo assim vai no A
  for (let i = 0; i < 40; i++) sim.tick(0.1, [killer, other, tower]);
  assert.ok(z.x > 10, `deveria estar correndo até o assassino: x=${z.x}`);
  // assassino morreu (outro alguém): passa a caçar qualquer jogador vivo
  killer.dead = true;
  sim.tick(0.1, [killer, other, tower]);
  assert.equal(z.targetId, 'C');
  assert.ok(!hits.some((h) => h.id === 'tower'));
  // expira: some sem morrer
  z.ttl = 0.05;
  sim.tick(0.1, [killer, other, tower]);
  assert.equal(sim.zombies.has(z.id), false);
});

test('infectado nunca mira o próprio dono e traz `owner` no snapshot', () => {
  const { sim } = setup(1);
  const z = sim.spawnInfected('B', 'lis', null, 0, 0);
  const owner = { id: 'B', position: { x: 1, z: 0 }, dead: false, kind: 'player' as const };
  const other = { id: 'C', position: { x: 6, z: 0 }, dead: false, kind: 'player' as const };
  sim.tick(0.1, [owner, other]);
  assert.equal(z.targetId, 'C');
  assert.equal(sim.snapshots()[0].owner, 'B');
  assert.equal(sim.snapshots()[0].kind, 'infected');
});

test('zumbi comum abre o combate com o soco, não com o chute; o chute só vem depois do cooldown cheio', () => {
  const { sim, hits } = setup(1);
  const z = sim.spawn('zombie', 1.2, 0);
  z.state = 'chase';
  const targets = [{ id: 'p', position: { x: 0, z: 0 }, dead: false, radius: GAME.player.RADIUS, kind: 'player' as const }];
  // até o cooldown do chute vencer, todos os golpes são socos
  let t = 0;
  while (t < GAME.zombie.SPECIAL.COOLDOWN - 0.2) {
    sim.tick(0.05, targets);
    t += 0.05;
  }
  assert.ok(hits.length >= 3, `deveria ter socado várias vezes (${hits.length})`);
  assert.ok(hits.every((h) => h.amount === GAME.zombie.DAMAGE), `só socos antes do cooldown: ${hits.map((h) => h.amount).join(',')}`);
  // depois disso o chute aparece, com 1,75× o dano
  for (let i = 0; i < 80; i++) sim.tick(0.05, targets);
  const kick = Math.round(GAME.zombie.DAMAGE * GAME.zombie.SPECIAL.DAMAGE_MULT);
  assert.ok(hits.some((h) => h.amount === kick), `chute de ${kick} após o cooldown: ${hits.map((h) => h.amount).join(',')}`);
  assert.equal(kick, 28);
});

test('chefão fica atordoado (parado, sem atacar) depois da investida e volta a caçar depois de STUN.AFTER_CHARGE', () => {
  const { sim, hits } = setup(1);
  const boss = sim.spawn('boss', 0, 0, 1, 1, true, 1);
  boss.spitCooldown = 999; // sem rajada: força a investida como primeira habilidade
  boss.summonCooldown = 999;
  boss.chargeCooldown = 0;
  const player = { id: 'p', position: { x: 12, z: 0 }, dead: false, radius: 0.35, kind: 'player' as const };
  let guard = 0;
  while (boss.state !== 'charge' && guard++ < 200) sim.tick(0.05, [player]);
  assert.equal(boss.state, 'charge', 'deveria ter investido');
  player.position.x = 40; // sai da frente: a investida termina sem acertar
  while (boss.state === 'charge' && guard++ < 400) sim.tick(0.05, [player]);
  assert.equal(boss.state, 'stunned');
  assert.equal(boss.vx, 0);
  assert.equal(boss.vz, 0);
  assert.equal(sim.snapshots().find((s) => s.id === boss.id)!.stunned, true);
  const hitsBefore = hits.length;
  const x0 = boss.x;
  const steps = Math.floor((GAME.boss.STUN.AFTER_CHARGE - 0.1) / 0.05);
  for (let i = 0; i < steps; i++) sim.tick(0.05, [player]);
  assert.equal(boss.state, 'stunned', 'ainda atordoado antes de AFTER_CHARGE');
  assert.equal(boss.x, x0, 'atordoado não anda');
  assert.equal(hits.length, hitsBefore, 'atordoado não ataca');
  for (let i = 0; i < 10; i++) sim.tick(0.05, [player]);
  assert.equal(boss.state, 'chase');
  assert.equal(sim.snapshots().find((s) => s.id === boss.id)!.stunned, undefined);
});

test('rajada do chefão abre o leque o bastante para passar entre dois cuspes', () => {
  // a meia distância do alcance, o vão entre projéteis vizinhos precisa ser maior que o jogador + o raio do cuspe
  const v = GAME.boss.VOLLEY;
  const gapAtMid = 2 * (v.RANGE / 2) * Math.sin((v.SPREAD_DEG * Math.PI) / 180 / 2);
  assert.ok(gapAtMid > 2 * (v.RADIUS ?? 0.55) + 2 * GAME.player.RADIUS + 0.6, `vão ${gapAtMid.toFixed(2)} pequeno demais`);
});
