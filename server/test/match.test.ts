import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Match, MatchError } from '../src/game/Match.js';
import { GAME } from '../../shared/gameconfig.js';
import type { PlayerSnapshot, ServerMessage } from '../../shared/protocol.js';

function setup() {
  let now = 0;
  const sent: Array<{ to: string | '*'; msg: ServerMessage }> = [];
  const money: number[] = [];
  const m = new Match(
    1337,
    0,
    {
      send: (to, msg) => sent.push({ to, msg }),
      broadcast: (msg) => sent.push({ to: '*', msg }),
      onMoneyChanged: (a) => money.push(a),
      onWaveChanged: () => undefined,
      onPhaseComplete: () => undefined,
      onGameOver: () => undefined,
    },
    () => now,
    () => 0.5, // recoil determinístico: desvio zero
  );
  const snap = (id: string, x = 0, z = 0): PlayerSnapshot => ({ id, name: id, character: 'matt', hp: 100, kills: 0, pvpKills: 0, deaths: 0, x, z, yaw: 0, anim: 'Idle', crouching: false });
  /** avança o relógio em passos de 100 ms chamando tick() (a simulação limita dt a 0,1 s) */
  const run = (ms: number) => {
    for (let t = 0; t < ms; t += 100) {
      now += 100;
      m.tick();
    }
  };
  return { m, sent, money, snap, run, advance: (ms: number) => (now += ms), last: (type: string) => [...sent].reverse().find((s) => s.msg.type === type) };
}

test('pickup exige proximidade e remove o objeto para todos', () => {
  const { m, sent, snap } = setup();
  const stick = [...m.objects.values()].find((o) => o.kind === 'stick')!;
  const a = m.addPlayer(snap('A', stick.x + 30, stick.z));
  assert.throws(() => m.pickup('A', stick.id), (e: MatchError) => e.code === 'too_far');
  a.snapshot.x = stick.x + 1;
  m.pickup('A', stick.id);
  assert.ok(m.removed.has(stick.id));
  assert.ok(sent.some((s) => s.to === '*' && s.msg.type === 'object_removed'));
  assert.deepEqual(a.hotbar[0], { itemId: 'stick', count: 1 });
  assert.throws(() => m.pickup('A', stick.id), (e: MatchError) => e.code === 'invalid_message');
});

test('árvore exige machado equipado e 3 hits (com cadência)', () => {
  const { m, snap, last, advance } = setup();
  const tree = [...m.objects.values()].find((o) => o.kind === 'tree')!;
  const a = m.addPlayer(snap('A', tree.x + 1, tree.z));
  assert.throws(() => m.hitNode('A', tree.id), (e: MatchError) => e.code === 'no_tool');
  a.hotbar[0] = { itemId: 'axe', count: 1 };
  m.hitNode('A', tree.id);
  m.hitNode('A', tree.id); // rápido demais: ignorado
  assert.equal((last('node_hit')!.msg as { hits: number }).hits, 1);
  advance(1000);
  m.hitNode('A', tree.id);
  assert.equal((last('node_hit')!.msg as { hits: number }).hits, 2);
  advance(1000);
  m.hitNode('A', tree.id);
  assert.ok(m.removed.has(tree.id));
  assert.deepEqual(a.hotbar[1], { itemId: 'wood', count: 3 });
});

test('vender e comprar movem o dinheiro da sala', () => {
  const { m, snap, money } = setup();
  const a = m.addPlayer(snap('A', GAME.hub.VENDOR.x, GAME.hub.VENDOR.z + 1));
  a.hotbar[0] = { itemId: 'wood', count: 20 };
  m.sell('A');
  assert.equal(m.money, 100);
  assert.deepEqual(money, [100]);
  m.buy('A', 'glock');
  assert.equal(m.money, 0);
  assert.deepEqual(a.hotbar[0], { itemId: 'glock', count: 1 });
  assert.equal(a.mag, GAME.weapon.glock.START_MAG);
  a.snapshot.x = 20;
  assert.throws(() => m.sell('A'), (e: MatchError) => e.code === 'too_far');
});

test('escudo de spawn bloqueia dano e lentidão por 5s', () => {
  const { m, snap, advance, sent } = setup();
  const a = m.addPlayer(snap('A', 0, 0));
  const b = m.addPlayer(snap('B', 5, 0));
  assert.ok(sent.some((s) => s.msg.type === 'shield'));
  a.hotbar[0] = { itemId: 'glock', count: 1 };
  m.fire('A', 1, 0);
  assert.equal(b.snapshot.hp, 100);
  advance(GAME.player.SPAWN_SHIELD * 1000 + 1);
  m.fire('A', 1, 0);
  assert.equal(b.snapshot.hp, 75);
});

test('tiro acerta outro jogador e mata em 4; zumbi que morre para um zumbi comum respawna em 5s', () => {
  const { m, snap, advance, last, sent } = setup();
  const a = m.addPlayer(snap('A', 0, 0));
  const b = m.addPlayer(snap('B', 5, 0));
  advance(GAME.player.SPAWN_SHIELD * 1000 + 1);
  a.hotbar[0] = { itemId: 'glock', count: 1 };
  a.mag = GAME.weapon.glock.MAG;
  for (let i = 0; i < 4; i++) {
    m.fire('A', 1, 0);
    advance(400);
  }
  assert.equal(b.snapshot.hp, 0);
  assert.ok(b.dead);
  assert.equal(a.snapshot.pvpKills, 1);
  assert.equal(b.snapshot.deaths, 1);
  assert.equal((last('player_died')!.msg as { killerId: string }).killerId, 'A');
  assert.equal(a.mag, GAME.weapon.glock.MAG - 4);
  // morte por zumbi comum: respawn normal em 5 s
  const z = m.zombies.spawn('zombie', 1, 0);
  m.damagePlayer(a, 999, undefined, z.id);
  assert.ok(a.dead);
  assert.equal(a.infectedZombieId, null);
  assert.equal((last('player_died')!.msg as { respawnIn: number }).respawnIn, GAME.player.RESPAWN_SECONDS);
  m.tick();
  assert.ok(a.dead);
  advance(5000);
  m.tick();
  assert.ok(!a.dead);
  assert.equal(a.snapshot.hp, 100);
  assert.ok(sent.some((s) => s.msg.type === 'player_respawned' && (s.msg as { playerId: string }).playerId === 'A'));
  // cooldown: dois tiros no mesmo instante = um só
  const shots = sent.filter((s) => s.msg.type === 'shot').length;
  m.fire('A', 1, 0);
  m.fire('A', 1, 0);
  assert.equal(sent.filter((s) => s.msg.type === 'shot').length, shots + 1);
});

test('recarga volta o pente cheio depois de RELOAD', () => {
  const { m, snap, advance } = setup();
  const a = m.addPlayer(snap('A'));
  a.hotbar[0] = { itemId: 'glock', count: 1 };
  a.mag = 2;
  m.reload('A');
  m.tick();
  assert.equal(a.mag, 2);
  advance(GAME.weapon.glock.RELOAD * 1000 + 1);
  m.tick();
  assert.equal(a.mag, GAME.weapon.glock.MAG);
});

test('upgrades: dano, pente e recoil', () => {
  const { m, snap, advance } = setup();
  const a = m.addPlayer(snap('A', GAME.hub.VENDOR.x, GAME.hub.VENDOR.z + 1));
  const b = m.addPlayer(snap('B', GAME.hub.VENDOR.x + 5, GAME.hub.VENDOR.z + 1));
  advance(GAME.player.SPAWN_SHIELD * 1000 + 1);
  a.hotbar[0] = { itemId: 'glock', count: 1 };
  m.money = 10;
  assert.throws(() => m.buyUpgrade('A', 'damage'), (e: MatchError) => e.code === 'not_enough_money');
  m.money = 1000;
  m.buyUpgrade('A', 'damage');
  m.buyUpgrade('A', 'ammo');
  m.buyUpgrade('A', 'recoil');
  assert.deepEqual(a.upgrades, { damage: 1, ammo: 1, recoil: 1, stamina: 0, laser: 0, weight: 0 });
  assert.equal(m.money, 1000 - 40 - 30 - 40);
  // preço sobe para a sala: B paga mais caro pelo primeiro nível de dano
  assert.equal(m.upgradePrices().damage, Math.round(40 * 1.35));
  b.snapshot.x = GAME.hub.VENDOR.x;
  m.buyUpgrade('B', 'damage');
  assert.equal(b.upgrades.damage, 1);
  assert.equal(m.money, 1000 - 40 - 30 - 40 - Math.round(40 * 1.35));
  b.snapshot.x = GAME.hub.VENDOR.x + 5;
  a.mag = 0;
  m.reload('A');
  advance(GAME.weapon.glock.RELOAD * 1000 + 1);
  m.tick();
  assert.equal(a.mag, GAME.weapon.glock.MAG + GAME.upgrades.ammo.STEP);
  m.fire('A', 1, 0);
  assert.equal(b.snapshot.hp, 100 - Math.round(25 * 1.2));
});

test('peso: não pega além da capacidade; upgrade aumenta', () => {
  const { m, snap } = setup();
  const stone = [...m.objects.values()].find((o) => o.kind === 'stone')!;
  const a = m.addPlayer(snap('A', stone.x + 1, stone.z));
  a.hotbar[0] = { itemId: 'bigstone', count: 7 }; // 28 de 30
  m.pickup('A', stone.id); // +2 = 30, cabe
  const stone2 = [...m.objects.values()].find((o) => o.kind === 'stone' && o.id !== stone.id)!;
  a.snapshot.x = stone2.x + 1;
  a.snapshot.z = stone2.z;
  assert.throws(() => m.pickup('A', stone2.id), (e: MatchError) => e.code === 'too_heavy');
  a.upgrades.weight = 1; // +10
  m.pickup('A', stone2.id);
  assert.equal(a.hotbar.find((s) => s?.itemId === 'stone')?.count, 2);
});

test('parede: coloca perto, bloqueia lugar ocupado, e zumbi derruba; torre zerada = game over', () => {
  const { m, snap, sent } = setup();
  const a = m.addPlayer(snap('A', 0, 0));
  a.hotbar[0] = { itemId: 'wall_wood', count: 2 };
  m.placeWall('A', 2, 0, 0);
  assert.equal(m.structures.size, 1);
  assert.equal(a.hotbar[0]?.count, 1);
  assert.throws(() => m.placeWall('A', 2.2, 0, 0), (e: MatchError) => e.code === 'blocked');
  assert.throws(() => m.placeWall('A', 20, 0, 0), (e: MatchError) => e.code === 'too_far');
  const id = [...m.structures.keys()][0];
  m.damageStructure(id, 149);
  assert.equal(m.structures.get(id)?.hp, 1);
  m.damageStructure(id, 5);
  assert.equal(m.structures.size, 0);
  assert.ok(sent.some((s) => s.msg.type === 'structure_removed'));
  m.damageTower(99999);
  assert.ok(m.gameOver);
  assert.ok(sent.some((s) => s.msg.type === 'game_over'));
});

test('recurso coletado renasce depois do tempo', () => {
  const { m, snap, advance, sent } = setup();
  const stick = [...m.objects.values()].find((o) => o.kind === 'stick')!;
  m.addPlayer(snap('A', stick.x + 1, stick.z));
  m.pickup('A', stick.id);
  assert.ok(m.removed.has(stick.id));
  advance(GAME.respawn.SMALL * 1000 - 1);
  m.tick();
  assert.ok(m.removed.has(stick.id));
  advance(2);
  m.tick();
  assert.ok(!m.removed.has(stick.id));
  assert.ok(sent.some((s) => s.msg.type === 'object_respawned'));
});

test('faca acerta o zumbi à frente, não o de trás', () => {
  const { m, snap, advance } = setup();
  const a = m.addPlayer(snap('A', 0, 0));
  advance(GAME.player.SPAWN_SHIELD * 1000 + 1);
  a.hotbar[0] = { itemId: 'knife', count: 1 };
  const front = m.zombies.spawn('zombie', 1.2, 0);
  const back = m.zombies.spawn('zombie', -1.2, 0);
  m.melee('A', 1, 0);
  assert.equal(front.hp, GAME.zombie.MAX_HP - GAME.weapon.knife.DAMAGE);
  assert.equal(back.hp, GAME.zombie.MAX_HP);
  m.melee('A', 1, 0); // cooldown: ignorado
  assert.equal(front.hp, GAME.zombie.MAX_HP - GAME.weapon.knife.DAMAGE);
});

test('reforço da torre: +500 de máximo e cura, preço sobe', () => {
  const { m, snap } = setup();
  m.addPlayer(snap('A', m.towerPos.x + 1, m.towerPos.z)); // reforço/reparo acontecem na torre
  m.money = 1000;
  m.damageTower(600);
  m.upgradeTower('A');
  assert.equal(m.towerMaxHp, GAME.hub.TOWER_HP + 500);
  assert.equal(m.towerHp, GAME.hub.TOWER_HP - 600 + 500);
  assert.equal(m.money, 900);
  m.upgradeTower('A');
  assert.equal(m.money, 900 - Math.round(100 * 1.35));
});

test('reparo da torre cobra pela vida faltante e enche', () => {
  const { m, snap } = setup();
  m.addPlayer(snap('A', m.towerPos.x + 1, m.towerPos.z));
  m.money = 500;
  assert.throws(() => m.repairTower('A'), (e: MatchError) => e.code === 'invalid_message');
  m.damageTower(400);
  m.repairTower('A');
  assert.equal(m.towerHp, m.towerMaxHp);
  assert.equal(m.money, 500 - 40);
});

test('fogo amigo: morto por outro jogador vira zumbi por 30s caçando o assassino; expira -> volta ao normal', () => {
  const { m, snap, advance, run, last, sent } = setup();
  const a = m.addPlayer(snap('A', 0, 0));
  const b = m.addPlayer(snap('B', 5, 0));
  advance(GAME.player.SPAWN_SHIELD * 1000 + 1);
  a.hotbar[0] = { itemId: 'knife', count: 1 };
  a.damageMult = 100;
  b.snapshot.x = 1;
  m.melee('A', 1, 0);
  assert.ok(b.dead);
  assert.equal((last('player_died')!.msg as { respawnIn: number }).respawnIn, GAME.infected.DURATION);
  const inf = last('player_infected')!.msg as { playerId: string; zombieId: number; targetId: string | null; seconds: number };
  assert.equal(inf.playerId, 'B');
  assert.equal(inf.targetId, 'A');
  assert.equal(inf.seconds, GAME.infected.DURATION);
  assert.equal(b.infectedZombieId, inf.zombieId);
  const z = m.zombies.zombies.get(inf.zombieId)!;
  assert.equal(z.kind, 'infected');
  assert.equal(z.ownerId, 'B');
  assert.equal(z.focusId, 'A');
  assert.equal(z.x, 1); // nasce onde o jogador caiu
  assert.equal(m.zombieSnapshots().find((s) => s.id === z.id)?.owner, 'B');
  assert.equal(m.zombieSnapshots().find((s) => s.id === z.id)?.character, 'matt'); // zumbi usa o personagem do dono
  // 5 s depois ainda não renasceu (não é o respawn normal)
  run(6000);
  assert.ok(b.dead);
  assert.ok(m.zombies.zombies.has(z.id));
  // zumbi mira o assassino: A fugiu para longe e mesmo assim é o alvo
  a.snapshot.x = 30;
  m.tick();
  assert.equal(z.targetId, 'A');
  // 30 s: o zumbi some e B volta ao normal na hora, com escudo
  const shields = sent.filter((s) => s.msg.type === 'shield').length;
  while (m.zombies.zombies.has(z.id)) run(100);
  assert.ok(!b.dead);
  assert.equal(b.infectedZombieId, null);
  const resp = last('player_respawned')!.msg as { playerId: string; hp: number };
  assert.equal(resp.playerId, 'B');
  assert.equal(resp.hp, 100);
  assert.ok(sent.filter((s) => s.msg.type === 'shield').length > shields);
});

test('fogo amigo: zumbi infectado mata o assassino -> ele também vira zumbi (com crédito PvP para o dono)', () => {
  const { m, snap, advance, last } = setup();
  const a = m.addPlayer(snap('A', 0, 0));
  const b = m.addPlayer(snap('B', 1, 0));
  const c = m.addPlayer(snap('C', 40, 40));
  advance(GAME.player.SPAWN_SHIELD * 1000 + 1);
  a.hotbar[0] = { itemId: 'knife', count: 1 };
  a.damageMult = 100;
  m.melee('A', 1, 0);
  assert.ok(b.dead);
  const zb = m.zombies.zombies.get(b.infectedZombieId!)!;
  // o zumbi de B mata A
  m.damagePlayer(a, 999, undefined, zb.id);
  assert.ok(a.dead);
  assert.equal((last('player_died')!.msg as { killerId?: string }).killerId, 'B');
  assert.equal(b.snapshot.pvpKills, 1);
  assert.equal(b.matchHumanKills, 1);
  const infA = last('player_infected')!.msg as { playerId: string; targetId: string | null };
  assert.equal(infA.playerId, 'A');
  assert.equal(infA.targetId, null); // o zumbi de B caçava A (morto): o de A caça qualquer vivo
  const za = m.zombies.zombies.get(a.infectedZombieId!)!;
  m.tick();
  assert.equal(za.targetId, 'C');
  assert.equal(zb.targetId, 'C');
  // C abate o zumbi de A: A respawna pelo tempo normal
  m.zombies.damage(za, 1e9, 'C');
  assert.equal(a.infectedZombieId, null);
  assert.equal(c.snapshot.kills, 1);
  m.tick();
  assert.ok(a.dead);
  advance(GAME.player.RESPAWN_SECONDS * 1000);
  m.tick();
  assert.ok(!a.dead);
  assert.ok(b.dead); // B continua zumbi
  // B sai da sala: o zumbi dele some
  m.removePlayer('B');
  assert.equal(m.zombies.zombies.has(zb.id), false);
});

test('bateria: preço da sala sobe a cada compra; uma bateria por wave; fase concluída não aceita mais', () => {
  const { m, snap, last } = setup();
  const a = m.addPlayer(snap('A', GAME.hub.VENDOR.x, GAME.hub.VENDOR.z + 1));
  m.money = 10000;
  const base = 150;
  assert.equal(m.batteryPrice(), base);
  m.buy('A', 'battery');
  assert.equal(m.money, 10000 - base);
  assert.equal(m.batteryPrice(), Math.round(base * GAME.battery.GROWTH));
  assert.equal((last('battery_price')!.msg as { price: number }).price, m.batteryPrice());
  a.hotbar[0] = null;
  m.buy('A', 'battery');
  assert.equal(m.money, 10000 - base - Math.round(base * GAME.battery.GROWTH));
  assert.equal(m.batteryPrice(), Math.round(base * GAME.battery.GROWTH ** 2));
  // coloca na torre: wave 1; a segunda bateria só depois do chefão da wave 1
  a.snapshot.x = m.towerPos.x + 1;
  a.snapshot.z = m.towerPos.z;
  m.activateBattery('A');
  assert.equal(m.waves.wave, 1);
  assert.equal(a.hotbar.some((s) => s?.itemId === 'battery'), false);
  a.hotbar[0] = { itemId: 'battery', count: 1 };
  assert.throws(() => m.activateBattery('A'), (e: MatchError) => e.code === 'already_active');
  m.waves.devNextWave(); // horda
  m.waves.devNextWave(); // chefão
  m.waves.devNextWave(); // mata o chefão
  m.tick();
  assert.equal(m.waves.state().phase, 'idle');
  assert.equal(last('wave_cleared')!.msg.type, 'wave_cleared');
  m.activateBattery('A');
  assert.equal(m.waves.wave, 2);
  for (let w = 2; w <= GAME.waves.TOTAL; w++) {
    m.waves.devNextWave();
    m.waves.devNextWave();
    m.waves.devNextWave();
    m.tick();
    if (w < GAME.waves.TOTAL) {
      a.hotbar[0] = { itemId: 'battery', count: 1 };
      m.activateBattery('A');
    }
  }
  assert.equal(m.waves.state().phase, 'complete');
  assert.ok(last('phase_complete'));
  a.hotbar[0] = { itemId: 'battery', count: 1 };
  assert.throws(() => m.activateBattery('A'), (e: MatchError) => e.code === 'phase_complete');
});

test('consumíveis: bandagem/analgésico curam até o máximo, gastam 1 unidade, respeitam cooldown e vida cheia', () => {
  const { m, snap, advance, last } = setup();
  const a = m.addPlayer(snap('A', 0, 0));
  a.hotbar[0] = { itemId: 'bandage', count: 2 };
  a.hotbar[1] = { itemId: 'painkiller', count: 1 };
  assert.throws(() => m.useItem('A'), (e: MatchError) => e.code === 'invalid_message'); // vida cheia
  a.snapshot.hp = 20;
  m.useItem('A');
  assert.equal(a.snapshot.hp, 55);
  assert.equal(a.hotbar[0]?.count, 1);
  assert.equal((last('hp')!.msg as { hp: number }).hp, 55);
  m.useItem('A'); // cooldown: ignorado
  assert.equal(a.snapshot.hp, 55);
  advance(GAME.consumable.USE_COOLDOWN * 1000 + 1);
  m.useItem('A');
  assert.equal(a.snapshot.hp, 90);
  assert.equal(a.hotbar[0], null); // acabou a pilha
  advance(2000);
  a.equipped = 1;
  m.useItem('A');
  assert.equal(a.snapshot.hp, 100); // analgésico não passa do máximo
  assert.equal(a.hotbar[1], null);
  a.equipped = 2;
  assert.throws(() => m.useItem('A'), (e: MatchError) => e.code === 'invalid_message'); // nada equipado
});
