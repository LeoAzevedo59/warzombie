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
  const snap = (id: string, x = 0, z = 0): PlayerSnapshot => ({ id, name: id, hp: 100, kills: 0, pvpKills: 0, deaths: 0, x, z, yaw: 0, anim: 'Idle', crouching: false });
  return { m, sent, money, snap, advance: (ms: number) => (now += ms), last: (type: string) => [...sent].reverse().find((s) => s.msg.type === type) };
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

test('tiro acerta outro jogador, mata em 4 e respawna depois de 5s', () => {
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
  m.tick();
  assert.ok(b.dead);
  advance(5000);
  m.tick();
  assert.ok(!b.dead);
  assert.equal(b.snapshot.hp, 100);
  assert.ok(sent.some((s) => s.msg.type === 'player_respawned'));
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
