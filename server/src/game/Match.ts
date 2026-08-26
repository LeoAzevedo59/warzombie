import { GAME } from '../../../shared/gameconfig.js';
import type { ItemId } from '../../../shared/items.js';
import { dist, normalize2, rayHitNearest } from '../../../shared/math.js';
import type { DevAction, PlayerSnapshot, ProjectileSnapshot, ServerMessage, UpgradeKind, UpgradePrices, WaveState, WeaponUpgrades, ZombieSnapshot } from '../../../shared/protocol.js';
import { damageMultiplier, emptyUpgrades, isMaxed, magSize, pricesFor, spreadDegrees, upgradePriceFor } from '../../../shared/upgrades.js';
import { generateWorld, WORLD_OBJECTS, type WorldObjectSpec } from '../../../shared/worldgen.js';
import { addItem, buy, canFit, emptyHotbar, hasItem, sellAll, type Hotbar } from './Economy.js';
import { ZombieSim, type Obstacle, type Zombie } from './ZombieSim.js';
import { WaveDirector } from './WaveDirector.js';

/** Estado de jogo de um membro (o servidor é a autoridade; a pose vem do client). */
export interface MatchPlayer {
  snapshot: PlayerSnapshot;
  hotbar: Hotbar;
  equipped: number;
  dead: boolean;
  respawnAt: number;
  mag: number;
  reloadUntil: number;
  nextFireAt: number;
  /** último hit em árvore/rocha (ms) — limita a cadência ao HIT_INTERVAL */
  lastHitAt: number;
  /** (dev) multiplicador de dano da arma */
  damageMult: number;
  /** invulnerável (sem dano/lentidão) até este instante (ms) */
  shieldUntil: number;
  upgrades: WeaponUpgrades;
}

export class MatchError extends Error {
  constructor(
    readonly code:
      | 'too_far'
      | 'hotbar_full'
      | 'no_tool'
      | 'not_enough_money'
      | 'no_weapon'
      | 'dead'
      | 'invalid_message'
      | 'no_battery'
      | 'already_active',
    message: string,
  ) {
    super(message);
  }
}

export interface MatchIO {
  send(playerId: string, msg: ServerMessage): void;
  broadcast(msg: ServerMessage): void;
  /** dinheiro mudou (para persistir na sala) */
  onMoneyChanged(amount: number): void;
  /** wave mudou (para persistir na sala) */
  onWaveChanged(wave: number): void;
  /** boss morto: fase concluída */
  onPhaseComplete(): void;
}

/**
 * Simulação de uma partida (por sala): mundo compartilhado, hotbar/HP/munição de cada jogador,
 * dinheiro da sala, tiros e respawn. Não sabe nada de WebSocket: fala com o mundo via MatchIO.
 */
export class Match {
  readonly objects: Map<number, WorldObjectSpec>;
  readonly removed = new Set<number>();
  private hits = new Map<number, number>();
  readonly players = new Map<string, MatchPlayer>();
  money: number;
  /** compras de upgrade por tipo na sala (define o preço para todos) */
  readonly upgradePurchases: Record<UpgradeKind, number> = { damage: 0, ammo: 0, recoil: 0, stamina: 0, laser: 0 };
  readonly zombies: ZombieSim;
  readonly waves: WaveDirector;
  private lastTick: number;
  private obstacleCache: Obstacle[] | null = null;

  constructor(
    seed: number,
    money: number,
    private io: MatchIO,
    private now: () => number = Date.now,
    private rand: () => number = Math.random,
  ) {
    this.objects = generateWorld(seed);
    this.money = money;
    this.lastTick = now();
    this.zombies = new ZombieSim(
      {
        damagePlayer: (playerId, amount, byZombie) => {
          const p = this.players.get(playerId);
          if (p) this.damagePlayer(p, amount, undefined, byZombie);
        },
        knockback: (playerId, dx, dz, force) => this.io.send(playerId, { type: 'knockback', dx, dz, force }),
        slowPlayer: (playerId, factor, seconds) => {
          const p = this.players.get(playerId);
          if (!p || this.isShielded(p)) return;
          this.io.broadcast({ type: 'slowed', playerId, factor, seconds });
        },
        bossSlam: (x, z, radius, windup) => this.io.broadcast({ type: 'boss_slam', x, z, radius, windup }),
        zombieDied: (z, killerId) => this.onZombieDied(z, killerId),
      },
      () => this.obstacles(),
    );
    this.waves = new WaveDirector(
      this.zombies,
      {
        waveStarted: (wave, count, players) => {
          this.io.broadcast({ type: 'wave_started', wave, count, players });
          this.io.onWaveChanged(wave);
        },
        bossSpawned: (id, hp) => this.io.broadcast({ type: 'boss_spawned', id, hp }),
        phaseComplete: () => {
          this.io.broadcast({ type: 'phase_complete' });
          this.io.onPhaseComplete();
        },
        waveFailed: (wave, boss) => {
          this.io.broadcast({ type: 'wave_failed', wave, boss });
          this.io.onWaveChanged(0);
        },
        playerCount: () => this.players.size,
      },
      () => this.now() / 1000,
    );
  }

  /** Árvores/rochas ainda de pé + estruturas do hub (cache invalidado quando algo é removido). */
  private obstacles(): Obstacle[] {
    if (!this.obstacleCache) {
      const list: Obstacle[] = [];
      for (const o of this.objects.values()) {
        const def = WORLD_OBJECTS[o.kind];
        if (def.solidRadius && !this.removed.has(o.id)) list.push({ position: o, solidRadius: def.solidRadius });
      }
      list.push({ position: GAME.hub.VENDOR, solidRadius: GAME.hub.VENDOR_RADIUS });
      list.push({ position: GAME.hub.TOWER, solidRadius: GAME.hub.TOWER_RADIUS });
      this.obstacleCache = list;
    }
    return this.obstacleCache;
  }

  waveState(): WaveState {
    return this.waves.state();
  }

  zombieSnapshots(): ZombieSnapshot[] {
    return this.zombies.snapshots();
  }

  projectileSnapshots(): ProjectileSnapshot[] {
    return this.zombies.projectileSnapshots();
  }

  // ---------- jogadores ----------

  addPlayer(snapshot: PlayerSnapshot): MatchPlayer {
    const existing = this.players.get(snapshot.id);
    if (existing) return existing;
    snapshot.hp = GAME.player.MAX_HP;
    const p: MatchPlayer = {
      snapshot,
      hotbar: emptyHotbar(),
      equipped: 0,
      dead: false,
      respawnAt: 0,
      mag: GAME.weapon.glock.START_MAG,
      reloadUntil: 0,
      nextFireAt: 0,
      lastHitAt: -Infinity,
      damageMult: 1,
      shieldUntil: 0,
      upgrades: emptyUpgrades(),
    };
    this.players.set(snapshot.id, p);
    this.grantShield(p);
    return p;
  }

  removePlayer(playerId: string): void {
    this.players.delete(playerId);
  }

  private get(playerId: string): MatchPlayer {
    const p = this.players.get(playerId);
    if (!p) throw new MatchError('invalid_message', 'Jogador não está na partida');
    return p;
  }

  private alive(playerId: string): MatchPlayer {
    const p = this.get(playerId);
    if (p.dead) throw new MatchError('dead', 'Você está morto.');
    return p;
  }

  /** Escudo de spawn: ninguém consegue causar dano nem lentidão por SPAWN_SHIELD s. */
  private grantShield(p: MatchPlayer): void {
    const secs = GAME.player.SPAWN_SHIELD;
    p.shieldUntil = this.now() + secs * 1000;
    this.io.broadcast({ type: 'shield', playerId: p.snapshot.id, seconds: secs });
  }

  isShielded(p: MatchPlayer): boolean {
    return this.now() < p.shieldUntil;
  }

  private sendHotbar(p: MatchPlayer): void {
    this.io.send(p.snapshot.id, { type: 'hotbar', slots: p.hotbar, equipped: p.equipped });
  }

  private sendAmmo(p: MatchPlayer): void {
    this.io.send(p.snapshot.id, { type: 'ammo', mag: p.mag, magSize: magSize(p.upgrades), reloading: p.reloadUntil > this.now() });
  }

  magSizeOf(p: MatchPlayer): number {
    return magSize(p.upgrades);
  }

  upgradePrices(): UpgradePrices {
    return pricesFor(this.upgradePurchases);
  }

  /** Compra um nível de upgrade (dinheiro da sala; nível só deste jogador; preço sobe para todos). */
  buyUpgrade(playerId: string, kind: UpgradeKind): void {
    const p = this.alive(playerId);
    this.assertNearHub(p, GAME.hub.VENDOR);
    if (isMaxed(kind, p.upgrades[kind])) throw new MatchError('invalid_message', 'Upgrade já está no máximo.');
    const price = upgradePriceFor(kind, this.upgradePurchases[kind]);
    if (this.money < price) throw new MatchError('not_enough_money', 'Dinheiro insuficiente.');
    p.upgrades[kind]++;
    this.upgradePurchases[kind]++;
    this.setMoney(this.money - price, -price);
    this.io.send(playerId, { type: 'upgrades', upgrades: { ...p.upgrades } });
    this.io.broadcast({ type: 'upgrade_prices', prices: this.upgradePrices() });
    if (kind === 'ammo') this.sendAmmo(p);
  }

  equippedItem(p: MatchPlayer): ItemId | null {
    return p.hotbar[p.equipped]?.itemId ?? null;
  }

  // ---------- mundo ----------

  private objectNear(p: MatchPlayer, objectId: number): WorldObjectSpec {
    const o = this.objects.get(objectId);
    if (!o || this.removed.has(objectId)) throw new MatchError('invalid_message', 'Objeto não existe mais.');
    const def = WORLD_OBJECTS[o.kind];
    if (dist(p.snapshot, o) > GAME.interaction.RADIUS + def.radius + 0.5) throw new MatchError('too_far', 'Chegue mais perto.');
    return o;
  }

  pickup(playerId: string, objectId: number): void {
    const p = this.alive(playerId);
    const o = this.objectNear(p, objectId);
    const def = WORLD_OBJECTS[o.kind];
    if (def.requiredTool) throw new MatchError('invalid_message', 'Esse objeto precisa de ferramenta.');
    this.harvest(p, o);
  }

  hitNode(playerId: string, objectId: number): void {
    const p = this.alive(playerId);
    const o = this.objectNear(p, objectId);
    const def = WORLD_OBJECTS[o.kind];
    if (!def.requiredTool) throw new MatchError('invalid_message', 'Esse objeto se pega direto.');
    if (this.equippedItem(p) !== def.requiredTool) throw new MatchError('no_tool', 'Equipe a ferramenta certa.');
    // cadência: o client manda 1 hit por HIT_INTERVAL; mais rápido que isso (com folga de jitter) é ignorado
    const now = this.now();
    if (now - p.lastHitAt < GAME.interaction.HIT_INTERVAL * 1000 * 0.8) return;
    p.lastHitAt = now;
    const hits = (this.hits.get(objectId) ?? 0) + 1;
    if (hits >= def.hitsRequired) {
      if (!canFit(p.hotbar, def.drops)) throw new MatchError('hotbar_full', 'Hotbar cheia.');
      this.hits.delete(objectId);
      this.harvest(p, o);
      return;
    }
    this.hits.set(objectId, hits);
    this.io.broadcast({ type: 'node_hit', objectId, hits, required: def.hitsRequired });
  }

  private harvest(p: MatchPlayer, o: WorldObjectSpec): void {
    const def = WORLD_OBJECTS[o.kind];
    if (!canFit(p.hotbar, def.drops)) throw new MatchError('hotbar_full', 'Hotbar cheia.');
    for (const d of def.drops) {
      addItem(p.hotbar, d.itemId, d.count);
      this.io.send(p.snapshot.id, { type: 'item_gained', itemId: d.itemId, count: d.count });
    }
    this.removed.add(o.id);
    this.obstacleCache = null;
    this.io.broadcast({ type: 'object_removed', objectId: o.id });
    this.sendHotbar(p);
  }

  selectSlot(playerId: string, index: number): void {
    const p = this.get(playerId);
    if (index < 0 || index >= p.hotbar.length) throw new MatchError('invalid_message', 'Slot inválido.');
    p.equipped = index;
    this.sendHotbar(p);
  }

  // ---------- economia ----------

  private assertNearHub(p: MatchPlayer, spot: { x: number; z: number }): void {
    if (dist(p.snapshot, spot) > GAME.interaction.HUB_RADIUS) throw new MatchError('too_far', 'Chegue mais perto do vendedor.');
  }

  sell(playerId: string): void {
    const p = this.alive(playerId);
    this.assertNearHub(p, GAME.hub.VENDOR);
    const { total } = sellAll(p.hotbar);
    if (total <= 0) throw new MatchError('invalid_message', 'Nada para vender.');
    this.setMoney(this.money + total, total);
    this.sendHotbar(p);
  }

  buy(playerId: string, itemId: ItemId): void {
    const p = this.alive(playerId);
    this.assertNearHub(p, GAME.hub.VENDOR);
    const r = buy(p.hotbar, this.money, itemId);
    if (!r.ok) {
      const msg = r.code === 'not_enough_money' ? 'Dinheiro insuficiente.' : r.code === 'hotbar_full' ? 'Hotbar cheia.' : 'Item não está à venda.';
      throw new MatchError(r.code, msg);
    }
    this.setMoney(this.money - r.price, -r.price);
    if (itemId === 'glock') {
      p.mag = GAME.weapon.glock.START_MAG;
      p.reloadUntil = 0;
      this.sendAmmo(p);
    }
    this.sendHotbar(p);
  }

  /** Coloca a bateria na torre: consome o item e dispara as waves. */
  activateBattery(playerId: string): void {
    const p = this.alive(playerId);
    if (dist(p.snapshot, GAME.hub.TOWER) > GAME.interaction.HUB_RADIUS + GAME.hub.TOWER_RADIUS) {
      throw new MatchError('too_far', 'Chegue mais perto da torre.');
    }
    if (this.waves.active) throw new MatchError('already_active', 'As waves já estão em andamento.');
    if (!hasItem(p.hotbar, 'battery')) throw new MatchError('no_battery', 'Compre uma Bateria da Torre no vendedor.');
    const i = p.hotbar.findIndex((s) => s?.itemId === 'battery');
    p.hotbar[i] = null;
    this.sendHotbar(p);
    this.waves.activate();
    this.io.broadcast({ type: 'wave_state', wave: this.waves.state() });
  }

  private setMoney(amount: number, delta: number): void {
    this.money = amount;
    this.io.onMoneyChanged(amount);
    this.io.broadcast({ type: 'money', amount, delta });
  }

  // ---------- combate ----------

  fire(playerId: string, dx: number, dz: number): void {
    const p = this.alive(playerId);
    const w = GAME.weapon.glock;
    if (this.equippedItem(p) !== 'glock') throw new MatchError('no_weapon', 'Equipe a Glock.');
    const now = this.now();
    if (now < p.nextFireAt || now < p.reloadUntil) return; // spam: ignora silenciosamente
    if (p.mag <= 0) {
      this.sendAmmo(p);
      return;
    }
    p.mag--;
    p.nextFireAt = now + w.COOLDOWN * 1000;
    // recoil: o tiro sai desviado da mira por até ±spread graus (menos com upgrade)
    const aim = normalize2(dx, dz);
    const spread = (spreadDegrees(p.upgrades) * Math.PI) / 180;
    const angle = Math.atan2(aim.dx, aim.dz) + (this.rand() * 2 - 1) * spread;
    const dir = { dx: Math.sin(angle), dz: Math.cos(angle) };
    const from = p.snapshot;

    type Hit = { position: { x: number; z: number }; mp?: MatchPlayer; zb?: Zombie };
    const targets: Hit[] = [...this.players.values()].filter((o) => o !== p && !o.dead).map((o) => ({ position: o.snapshot, mp: o }));
    for (const zb of this.zombies.alive()) targets.push({ position: zb, zb });
    const hit = rayHitNearest(from, dir.dx, dir.dz, targets, w.RANGE, w.HIT_RADIUS + GAME.player.RADIUS);
    this.io.broadcast({
      type: 'shot',
      playerId,
      dx: dir.dx,
      dz: dir.dz,
      length: hit.t,
      hitPlayerId: hit.target?.mp?.snapshot.id,
      hitZombieId: hit.target?.zb?.id,
    });
    this.sendAmmo(p);
    const dmg = Math.round(w.DAMAGE * p.damageMult * damageMultiplier(p.upgrades));
    if (hit.target?.mp) this.damagePlayer(hit.target.mp, dmg, playerId);
    if (hit.target?.zb) this.zombies.damage(hit.target.zb, dmg, playerId);
  }

  /** Cheats de desenvolvimento (o GameServer só chama com DEV_CHEATS ligado). */
  dev(playerId: string, a: DevAction): void {
    const p = this.get(playerId);
    switch (a.action) {
      case 'money':
        this.setMoney(Math.max(0, this.money + a.amount), a.amount);
        return;
      case 'give':
        if (addItem(p.hotbar, a.itemId, 1) > 0) throw new MatchError('hotbar_full', 'Hotbar cheia.');
        this.sendHotbar(p);
        return;
      case 'damage_mult':
        p.damageMult = a.value;
        return;
      case 'heal':
        p.snapshot.hp = GAME.player.MAX_HP;
        this.io.broadcast({ type: 'hp', playerId, hp: p.snapshot.hp });
        return;
      case 'kill_zombies':
        for (const z of [...this.zombies.alive()]) this.zombies.damage(z, 1e9, playerId);
        return;
      case 'next_wave':
        this.waves.devNextWave();
        this.io.broadcast({ type: 'wave_state', wave: this.waves.state() });
        return;
      case 'spawn_boss':
        this.waves.devSpawnBoss();
        this.io.broadcast({ type: 'wave_state', wave: this.waves.state() });
        return;
    }
  }

  private onZombieDied(z: Zombie, killerId?: string): void {
    const killer = killerId ? this.players.get(killerId) : undefined;
    if (killer) killer.snapshot.kills++;
    this.io.broadcast({ type: 'zombie_died', id: z.id, kind: z.kind, killerId });
  }

  reload(playerId: string): void {
    const p = this.alive(playerId);
    const w = GAME.weapon.glock;
    if (this.equippedItem(p) !== 'glock' || p.mag === magSize(p.upgrades) || p.reloadUntil > this.now()) return;
    p.reloadUntil = this.now() + w.RELOAD * 1000;
    this.sendAmmo(p);
  }

  damagePlayer(target: MatchPlayer, amount: number, by?: string, _byZombie?: number): void {
    if (target.dead || this.isShielded(target)) return;
    target.snapshot.hp = Math.max(0, target.snapshot.hp - amount);
    this.io.broadcast({ type: 'hp', playerId: target.snapshot.id, hp: target.snapshot.hp, by });
    if (target.snapshot.hp <= 0) {
      target.dead = true;
      target.snapshot.anim = 'Death';
      target.respawnAt = this.now() + GAME.player.RESPAWN_SECONDS * 1000;
      this.io.broadcast({ type: 'player_died', playerId: target.snapshot.id, killerId: by, respawnIn: GAME.player.RESPAWN_SECONDS });
    }
  }

  // ---------- loop ----------

  /** Chamado a cada tick do servidor: zumbis/waves, recarga terminada, respawns. */
  tick(): void {
    const now = this.now();
    const dt = Math.min(0.1, Math.max(0, (now - this.lastTick) / 1000));
    this.lastTick = now;

    if (this.waves.active || this.zombies.zombies.size > 0) {
      const targets = [...this.players.values()].map((p) => ({ id: p.snapshot.id, position: p.snapshot, dead: p.dead }));
      this.zombies.tick(dt, targets);
    }
    if (this.waves.tick()) this.io.broadcast({ type: 'wave_state', wave: this.waves.state() });
    for (const p of this.players.values()) {
      if (p.reloadUntil && now >= p.reloadUntil) {
        p.reloadUntil = 0;
        p.mag = magSize(p.upgrades);
        this.sendAmmo(p);
      }
      if (p.dead && now >= p.respawnAt) {
        p.dead = false;
        p.snapshot.hp = GAME.player.MAX_HP;
        p.snapshot.x = 0;
        p.snapshot.z = 0;
        p.snapshot.anim = 'Idle';
        this.io.broadcast({ type: 'player_respawned', playerId: p.snapshot.id, x: 0, z: 0, hp: p.snapshot.hp });
        this.grantShield(p);
      }
    }
  }
}
