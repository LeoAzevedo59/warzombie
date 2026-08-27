import { GAME } from '../../../shared/gameconfig.js';
import { ITEMS, WALL_HITS, WALL_HP, WALL_TOOL, isWallKind, type ItemId, type WallKind } from '../../../shared/items.js';
import { dist, isClearOfCircles, normalize2, rayHitNearest } from '../../../shared/math.js';
import type { DroppedItem, DevAction, EvacState, PlayerSnapshot, PlayerSummary, ProjectileSnapshot, RoomFeature, RoomFeatures, ServerMessage, StructureSnapshot, UpgradeKind, UpgradePrices, WaveState, WeaponUpgrades, ZombieSnapshot } from '../../../shared/protocol.js';
import { batteryPrice, canFireRunning, damageMultiplier, emptyUpgrades, isMaxed, magSize, maxWeight, pricesFor, revivePrice, spreadDegreesFor, towerMaxHp, towerRepairPrice, towerUpgradePrice, upgradePriceFor, type Stance } from '../../../shared/upgrades.js';
import { generateWorld, mapBounds, WORLD_OBJECTS, type WorldObjectSpec } from '../../../shared/worldgen.js';
import { addItem, buy, canFit, emptyHotbar, fitsWeight, hasItem, sellAll, type Hotbar } from './Economy.js';
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
  /** próximo uso de consumível permitido (ms) */
  nextUseAt: number;
  /** último hit em árvore/rocha (ms) — limita a cadência ao HIT_INTERVAL */
  lastHitAt: number;
  /** (dev) multiplicador de dano da arma */
  damageMult: number;
  /** (dev) paredes/consumíveis não são gastos ao usar */
  infiniteItems: boolean;
  /** invulnerável (sem dano/lentidão) até este instante (ms) */
  shieldUntil: number;
  upgrades: WeaponUpgrades;
  /** virou zumbi (morto por outro jogador): id do zumbi que o representa; respawna quando ele some */
  infectedZombieId: number | null;
  /** embarcou no helicóptero de resgate: fora do mundo, invulnerável */
  boarded: boolean;
  /** sem vidas: só volta com a Medalha de Ressurreição de um aliado */
  eliminated: boolean;
  /** está com a bateria na hotbar (fica na mão; todos os zumbis vão atrás) */
  carrying: boolean;
  /** velocidade (m/s, suavizada) estimada pelas poses e instante da última pose — define a postura ao atirar */
  speed: number;
  lastPoseAt: number;
  /** início da participação nesta partida (ms) e stats da partida */
  joinedAt: number;
  matchZombieKills: number;
  matchHumanKills: number;
  matchDeaths: number;
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
      | 'already_active'
      | 'too_heavy'
      | 'blocked'
      | 'no_wall'
      | 'phase_complete'
      | 'not_eliminated'
      | 'carrying_battery',
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
  /** 5º chefão morto: fase concluída (ids de quem estava na partida ganham troféu) */
  onPhaseComplete(playerIds: string[]): void;
  /** derrota (torre destruída / todos eliminados): a sala deve recomeçar a partida do zero */
  onGameOver(reason: 'tower_destroyed' | 'all_dead'): void;
}

/**
 * Simulação de uma partida (por sala): mundo compartilhado, hotbar/HP/munição de cada jogador,
 * dinheiro da sala, tiros e respawn. Não sabe nada de WebSocket: fala com o mundo via MatchIO.
 */
export class Match {
  readonly objects: Map<number, WorldObjectSpec>;
  readonly removed = new Set<number>();
  /** instante (ms) em que cada recurso removido renasce */
  private respawnAt = new Map<number, number>();
  towerHp: number = GAME.hub.TOWER_HP;
  towerLevel = 0;

  get towerMaxHp(): number {
    return towerMaxHp(this.towerLevel);
  }
  readonly structures = new Map<number, StructureSnapshot>();
  private nextStructureId = 1;
  /** itens largados no chão (somem após DROP_TTL) */
  readonly drops = new Map<number, DroppedItem>();
  private dropExpiresAt = new Map<number, number>();
  private nextDropId = 1;
  private nextAmbientAt: number;
  gameOver = false;
  /** resgate: helicóptero ao lado da antena (depois do 5º chefão) */
  private evac: { x: number; z: number; landedAt: number; deadline: number; boarded: Set<string>; done: boolean } | null = null;
  /** recursos comprados para a sala inteira */
  readonly features: RoomFeatures = { minimap: false };
  private hits = new Map<number, number>();
  /** golpes de ferramenta acumulados por parede */
  private wallHits = new Map<number, number>();
  readonly players = new Map<string, MatchPlayer>();
  money: number;
  /** compras de upgrade por tipo na sala (define o preço para todos) */
  readonly upgradePurchases: Record<UpgradeKind, number> = { damage: 0, ammo: 0, recoil: 0, stamina: 0, laser: 0, weight: 0 };
  /** baterias compradas na sala: cada compra encarece a próxima */
  batteryPurchases = 0;
  /** Medalhas de Ressurreição compradas na sala: cada compra encarece a próxima */
  revivePurchases = 0;

  revivePrice(): number {
    return revivePrice(this.revivePurchases);
  }

  /** Jogadores sem vidas esperando uma medalha. */
  eliminatedIds(): string[] {
    return [...this.players.values()].filter((p) => p.eliminated).map((p) => p.snapshot.id);
  }

  batteryPrice(): number {
    return batteryPrice(this.batteryPurchases);
  }
  /** torre desta sala (ponto aleatório, longe do centro e livre de obstáculos) */
  readonly towerPos: { x: number; z: number };
  readonly zombies: ZombieSim;
  readonly waves: WaveDirector;
  private lastTick: number;
  private readonly startedAt: number;
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
    this.startedAt = now();
    this.nextAmbientAt = now() + GAME.ambient.FIRST_DELAY * 1000;
    this.towerPos = this.pickTowerPos();
    this.zombies = new ZombieSim(
      {
        damagePlayer: (targetId, amount, byZombie) => {
          if (targetId === 'tower') return this.damageTower(amount);
          if (targetId.startsWith('wall:')) return this.damageStructure(Number(targetId.slice(5)), amount);
          const p = this.players.get(targetId);
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
    // a horda (e os ambientais) nunca nascem em cima da antena nem de um jogador vivo
    this.zombies.avoid = () => [
      { position: this.towerPos, minDist: GAME.waves.SPAWN_MIN_FROM_TOWER },
      ...[...this.players.values()].filter((p) => !p.dead && !p.boarded).map((p) => ({ position: p.snapshot, minDist: GAME.waves.SPAWN_MIN_FROM_PLAYER })),
    ];
    this.waves = new WaveDirector(
      this.zombies,
      {
        waveStarted: (wave, count, players) => {
          this.io.broadcast({ type: 'wave_started', wave, count, players });
          this.io.onWaveChanged(wave);
        },
        bossIncoming: (wave, inSeconds) => this.io.broadcast({ type: 'boss_incoming', wave, inSeconds }),
        bossSpawned: (id, hp, wave) => this.io.broadcast({ type: 'boss_spawned', id, hp, wave }),
        waveCleared: (wave) => {
          this.io.broadcast({ type: 'wave_cleared', wave, total: GAME.waves.TOTAL });
          this.io.onWaveChanged(wave);
        },
        phaseComplete: () => {
          this.io.broadcast({ type: 'phase_complete', summary: this.summary(), duration: Math.round((this.now() - this.startedAt) / 1000) });
          this.io.onPhaseComplete([...this.players.keys()]);
          this.callHelicopter();
        },
        waveFailed: (wave, boss) => {
          this.io.broadcast({ type: 'wave_failed', wave, boss });
          this.io.onWaveChanged(this.waves.wave);
        },
        playerCount: () => this.players.size,
      },
      () => this.now() / 1000,
    );
  }

  private pickTowerPos(): { x: number; z: number } {
    const { TOWER_MIN_DIST: min, TOWER_MAX_DIST: max, TOWER_RADIUS } = GAME.hub;
    const solids = [...this.objects.values()].filter((o) => WORLD_OBJECTS[o.kind].solidRadius).map((o) => ({ position: o, solidRadius: WORLD_OBJECTS[o.kind].solidRadius }));
    for (let i = 0; i < 60; i++) {
      const a = this.rand() * Math.PI * 2;
      const d = min + this.rand() * (max - min);
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      if (isClearOfCircles(x, z, solids, TOWER_RADIUS + 1.5)) return { x, z };
    }
    return { ...GAME.hub.TOWER };
  }

  /** Estado do resgate para quem entra depois (null se não há helicóptero). */
  evacState(): EvacState | null {
    if (!this.evac || this.evac.done) return null;
    return { x: this.evac.x, z: this.evac.z, landed: this.now() >= this.evac.landedAt, boarded: [...this.evac.boarded] };
  }

  /** 5º chefão morto: helicóptero pousa num ponto livre ao lado da antena. */
  private callHelicopter(): void {
    const c = GAME.evac;
    const solids = [...this.obstacles(), ...[...this.structures.values()].map((s) => ({ position: s, solidRadius: GAME.walls.WIDTH / 2 }))];
    let pos = { x: this.towerPos.x + c.OFFSET, z: this.towerPos.z };
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const p = { x: this.towerPos.x + Math.cos(a) * c.OFFSET, z: this.towerPos.z + Math.sin(a) * c.OFFSET };
      const b = mapBounds();
      if (p.x < b.minX + 2 || p.x > b.maxX - 2 || p.z < b.minZ + 2 || p.z > b.maxZ - 2) continue;
      if (isClearOfCircles(p.x, p.z, solids, c.CLEARANCE)) {
        pos = p;
        break;
      }
    }
    const now = this.now();
    this.evac = { ...pos, landedAt: now + c.LAND_TIME * 1000, deadline: now + (c.LAND_TIME + c.TIMEOUT) * 1000, boarded: new Set(), done: false };
    this.io.broadcast({ type: 'helicopter', x: pos.x, z: pos.z, landsIn: c.LAND_TIME, timeout: c.TIMEOUT });
  }

  /** Embarque por proximidade depois de pousar; decola com todos a bordo ou no timeout. */
  private tickEvac(now: number): void {
    const e = this.evac;
    if (!e || e.done || now < e.landedAt) return;
    for (const p of this.players.values()) {
      if (p.dead || p.boarded) continue;
      if (dist(p.snapshot, e) <= GAME.evac.BOARD_RADIUS) {
        p.boarded = true;
        e.boarded.add(p.snapshot.id);
        this.io.broadcast({ type: 'player_boarded', playerId: p.snapshot.id });
      }
    }
    const everyone = [...this.players.keys()];
    const allIn = everyone.every((id) => e.boarded.has(id));
    if (allIn || now >= e.deadline) {
      e.done = true;
      const rescued = everyone.filter((id) => e.boarded.has(id));
      this.io.broadcast({ type: 'evac_complete', rescued, leftBehind: everyone.filter((id) => !e.boarded.has(id)) });
    }
  }

  summary(): PlayerSummary[] {
    return [...this.players.values()].map((p) => ({
      id: p.snapshot.id,
      name: p.snapshot.name,
      zombieKills: p.matchZombieKills,
      humanKills: p.matchHumanKills,
      deaths: p.matchDeaths,
      playtime: Math.round((this.now() - p.joinedAt) / 1000),
    }));
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
      list.push({ position: this.towerPos, solidRadius: GAME.hub.TOWER_RADIUS });
      for (const s of this.structures.values()) list.push({ position: s, solidRadius: GAME.walls.WIDTH / 2 });
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
      nextUseAt: 0,
      lastHitAt: -Infinity,
      damageMult: 1,
      infiniteItems: false,
      shieldUntil: 0,
      upgrades: emptyUpgrades(),
      infectedZombieId: null,
      boarded: false,
      eliminated: false,
      carrying: false,
      speed: 0,
      lastPoseAt: 0,
      joinedAt: this.now(),
      matchZombieKills: 0,
      matchHumanKills: 0,
      matchDeaths: 0,
    };
    this.players.set(snapshot.id, p);
    this.grantShield(p);
    return p;
  }

  removePlayer(playerId: string): void {
    const p = this.players.get(playerId);
    if (p?.infectedZombieId !== null && p?.infectedZombieId !== undefined) this.zombies.remove(p.infectedZombieId);
    this.players.delete(playerId);
    // saiu o último que ainda podia comprar a medalha: quem ficou está todo eliminado
    if (this.players.size > 0) this.checkAllEliminated();
  }

  /** Todos os jogadores da partida sem vidas: derrota, a partida recomeça. */
  private checkAllEliminated(): void {
    if (this.gameOver || this.players.size === 0) return;
    for (const p of this.players.values()) if (!p.eliminated) return;
    this.gameOver = true;
    this.zombies.clear();
    this.io.broadcast({ type: 'game_over', reason: 'all_dead', restartIn: 6 });
    this.io.onGameOver('all_dead');
  }

  /**
   * Medalha de Ressurreição: um aliado vivo, no vendedor, paga (preço da sala, sobe a cada compra)
   * e escolhe um jogador eliminado, que volta na hora ao centro com as vidas zeradas de novo.
   */
  buyRevive(playerId: string, targetId: string): void {
    const p = this.alive(playerId);
    this.assertNearHub(p, GAME.hub.VENDOR);
    const target = this.players.get(targetId);
    if (!target) throw new MatchError('invalid_message', 'Esse jogador não está na partida.');
    if (!target.eliminated) throw new MatchError('not_eliminated', 'Esse jogador não precisa de medalha.');
    const price = this.revivePrice();
    if (this.money < price) throw new MatchError('not_enough_money', 'Dinheiro insuficiente.');
    this.revivePurchases++;
    this.setMoney(this.money - price, -price);
    target.eliminated = false;
    target.matchDeaths = 0;
    target.respawnAt = this.now(); // o tick renasce agora
    this.io.broadcast({ type: 'player_revived', playerId: targetId, byId: playerId });
    this.io.broadcast({ type: 'revive_price', price: this.revivePrice() });
  }

  /** Pose nova do client (antes de aplicá-la ao snapshot): atualiza a velocidade estimada. */
  notePose(playerId: string, x: number, z: number): void {
    const p = this.players.get(playerId);
    if (!p) return;
    const now = this.now();
    const dt = (now - p.lastPoseAt) / 1000;
    if (p.lastPoseAt > 0 && dt > 0 && dt < 1) {
      const v = Math.hypot(x - p.snapshot.x, z - p.snapshot.z) / dt;
      p.speed = p.speed * 0.5 + v * 0.5;
    }
    p.lastPoseAt = now;
  }

  /** Postura atual: sem pose há IDLE_AFTER_MS = parado; senão pela velocidade estimada. */
  stanceOf(p: MatchPlayer): Stance {
    const a = GAME.accuracy;
    if (this.now() - p.lastPoseAt > a.IDLE_AFTER_MS) return 'idle';
    return p.speed >= a.RUN_MIN_SPEED ? 'run' : p.speed >= a.WALK_MIN_SPEED ? 'walk' : 'idle';
  }

  private get(playerId: string): MatchPlayer {
    const p = this.players.get(playerId);
    if (!p) throw new MatchError('invalid_message', 'Jogador não está na partida');
    return p;
  }

  private alive(playerId: string): MatchPlayer {
    const p = this.get(playerId);
    if (p.dead) throw new MatchError('dead', 'Você está morto.');
    if (p.boarded) throw new MatchError('dead', 'Você já está no helicóptero.');
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

  /** Quem está carregando a bateria (para quem entra depois). */
  carrierIds(): string[] {
    return [...this.players.values()].filter((p) => p.carrying).map((p) => p.snapshot.id);
  }

  /**
   * Toda mudança de hotbar passa aqui. A bateria, quando está na hotbar, vai para a mão (slot
   * equipado forçado) e avisa a sala que este jogador virou a isca dos zumbis.
   */
  private sendHotbar(p: MatchPlayer): void {
    const slot = p.hotbar.findIndex((s) => s?.itemId === 'battery');
    if (slot >= 0) p.equipped = slot;
    const carrying = slot >= 0;
    if (carrying !== p.carrying) {
      p.carrying = carrying;
      this.io.broadcast({ type: 'battery_carrier', playerId: p.snapshot.id, carrying });
    }
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
      if (!fitsWeight(p.hotbar, def.drops, maxWeight(p.upgrades))) throw new MatchError('too_heavy', 'Peso demais — venda algo ou melhore a capacidade.');
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
    if (!fitsWeight(p.hotbar, def.drops, maxWeight(p.upgrades))) throw new MatchError('too_heavy', 'Peso demais — venda algo ou melhore a capacidade.');
    for (const d of def.drops) {
      addItem(p.hotbar, d.itemId, d.count);
      this.io.send(p.snapshot.id, { type: 'item_gained', itemId: d.itemId, count: d.count });
    }
    this.removed.add(o.id);
    this.respawnAt.set(o.id, this.now() + (def.requiredTool ? GAME.respawn.NODE : GAME.respawn.SMALL) * 1000);
    this.obstacleCache = null;
    this.io.broadcast({ type: 'object_removed', objectId: o.id });
    this.sendHotbar(p);
  }

  /** Larga a pilha inteira do slot equipado no chão, na frente do jogador. */
  dropItem(playerId: string): void {
    const p = this.alive(playerId);
    const stack = p.hotbar[p.equipped];
    if (!stack) throw new MatchError('invalid_message', 'Nada equipado para largar.');
    // cai num ponto aleatório ao redor do jogador (vários drops seguidos não empilham)
    const ang = this.rand() * Math.PI * 2;
    const r = 0.7 + this.rand() * 0.5;
    const b = mapBounds();
    const x = Math.min(b.maxX, Math.max(b.minX, p.snapshot.x + Math.sin(ang) * r));
    const z = Math.min(b.maxZ, Math.max(b.minZ, p.snapshot.z + Math.cos(ang) * r));
    p.hotbar[p.equipped] = null;
    this.spawnDrop(stack.itemId, stack.count, x, z);
    this.sendHotbar(p);
  }

  private spawnDrop(itemId: ItemId, count: number, x: number, z: number): DroppedItem {
    const drop: DroppedItem = { id: this.nextDropId++, itemId, count, x, z };
    this.drops.set(drop.id, drop);
    this.dropExpiresAt.set(drop.id, this.now() + GAME.drops.TTL * 1000);
    this.io.broadcast({ type: 'drop_added', drop });
    return drop;
  }

  /** Pega um item largado (qualquer jogador), respeitando espaço e peso da hotbar. */
  pickupDrop(playerId: string, id: number): void {
    const p = this.alive(playerId);
    const d = this.drops.get(id);
    if (!d) throw new MatchError('invalid_message', 'Esse item já foi pego.');
    if (dist(p.snapshot, d) > GAME.interaction.RADIUS + 0.5) throw new MatchError('too_far', 'Chegue mais perto.');
    const stacks = [{ itemId: d.itemId, count: d.count }];
    if (!canFit(p.hotbar, stacks)) throw new MatchError('hotbar_full', 'Hotbar cheia.');
    if (!fitsWeight(p.hotbar, stacks, maxWeight(p.upgrades))) throw new MatchError('too_heavy', 'Peso demais — venda algo ou melhore a capacidade.');
    addItem(p.hotbar, d.itemId, d.count);
    this.removeDrop(id);
    this.io.send(p.snapshot.id, { type: 'item_gained', itemId: d.itemId, count: d.count });
    this.sendHotbar(p);
  }

  private removeDrop(id: number): void {
    this.drops.delete(id);
    this.dropExpiresAt.delete(id);
    this.io.broadcast({ type: 'drop_removed', id });
  }

  selectSlot(playerId: string, index: number): void {
    const p = this.get(playerId);
    if (index < 0 || index >= p.hotbar.length) throw new MatchError('invalid_message', 'Slot inválido.');
    if (p.carrying && index !== p.equipped) throw new MatchError('carrying_battery', 'Largue a bateria (Q) antes de pegar outro item.');
    p.equipped = index;
    this.sendHotbar(p);
  }

  // ---------- economia ----------

  private assertNearTower(p: MatchPlayer): void {
    if (dist(p.snapshot, this.towerPos) > GAME.interaction.HUB_RADIUS + GAME.hub.TOWER_RADIUS) throw new MatchError('too_far', 'Chegue mais perto da torre de comunicação.');
  }

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
    if (!fitsWeight(p.hotbar, [{ itemId, count: 1 }], maxWeight(p.upgrades))) throw new MatchError('too_heavy', 'Peso demais para carregar isso.');
    const r = buy(p.hotbar, this.money, itemId, itemId === 'battery' ? this.batteryPrice() : undefined);
    if (!r.ok) {
      const msg = r.code === 'not_enough_money' ? 'Dinheiro insuficiente.' : r.code === 'hotbar_full' ? 'Hotbar cheia.' : 'Item não está à venda.';
      throw new MatchError(r.code, msg);
    }
    this.setMoney(this.money - r.price, -r.price);
    if (itemId === 'battery') {
      // cada bateria comprada encarece a próxima para a sala toda
      this.batteryPurchases++;
      this.io.broadcast({ type: 'battery_price', price: this.batteryPrice() });
    }
    if (itemId === 'glock') {
      p.mag = GAME.weapon.glock.START_MAG;
      p.reloadUntil = 0;
      this.sendAmmo(p);
    }
    this.sendHotbar(p);
  }

  /** Usa o consumível equipado (bandagem/analgésico): cura `heal` (até o máximo) e gasta 1 unidade. */
  useItem(playerId: string): void {
    const p = this.alive(playerId);
    const stack = p.hotbar[p.equipped];
    const def = stack ? ITEMS[stack.itemId] : null;
    if (!stack || !def?.heal) throw new MatchError('invalid_message', 'Equipe uma bandagem ou analgésico.');
    const now = this.now();
    if (now < p.nextUseAt) return; // spam: ignora
    if (p.snapshot.hp >= GAME.player.MAX_HP) throw new MatchError('invalid_message', 'Sua vida já está cheia.');
    p.nextUseAt = now + GAME.consumable.USE_COOLDOWN * 1000;
    p.snapshot.hp = Math.min(GAME.player.MAX_HP, p.snapshot.hp + def.heal);
    if (!p.infiniteItems) {
      stack.count--;
      if (stack.count <= 0) p.hotbar[p.equipped] = null;
    }
    this.io.broadcast({ type: 'hp', playerId, hp: p.snapshot.hp });
    this.sendHotbar(p);
  }

  /** Coloca uma bateria na torre: consome o item e dispara a próxima wave (uma bateria por wave). */
  activateBattery(playerId: string): void {
    const p = this.alive(playerId);
    if (dist(p.snapshot, this.towerPos) > GAME.interaction.HUB_RADIUS + GAME.hub.TOWER_RADIUS) {
      throw new MatchError('too_far', 'Chegue mais perto da torre de comunicação.');
    }
    if (this.waves.phase === 'complete') throw new MatchError('phase_complete', 'A antena já tem todas as baterias: fase concluída.');
    if (this.waves.active) throw new MatchError('already_active', 'A wave já está em andamento.');
    if (!hasItem(p.hotbar, 'battery')) throw new MatchError('no_battery', 'Compre uma Bateria no vendedor.');
    const i = p.hotbar.findIndex((s) => s?.itemId === 'battery');
    p.hotbar[i] = null;
    this.sendHotbar(p);
    this.waves.activate();
    this.io.broadcast({ type: 'wave_state', wave: this.waves.state() });
  }

  /** Compra um recurso da sala (minimapa): paga uma vez, ativa para todos. */
  buyFeature(playerId: string, feature: RoomFeature): void {
    const p = this.alive(playerId);
    this.assertNearHub(p, GAME.hub.VENDOR);
    if (this.features[feature]) throw new MatchError('invalid_message', 'A sala já tem esse recurso.');
    const price = feature === 'minimap' ? GAME.features.MINIMAP_PRICE : 0;
    if (this.money < price) throw new MatchError('not_enough_money', 'Dinheiro insuficiente.');
    this.features[feature] = true;
    this.setMoney(this.money - price, -price);
    this.io.broadcast({ type: 'room_features', features: { ...this.features } });
  }

  // ---------- torre / paredes ----------

  /** Reforça a torre: +HP máximo e cura o mesmo valor (dinheiro da sala; preço sobe por nível). */
  upgradeTower(playerId: string): void {
    const p = this.alive(playerId);
    this.assertNearTower(p);
    if (this.gameOver) throw new MatchError('invalid_message', 'A torre de comunicação foi destruída.');
    const price = towerUpgradePrice(this.towerLevel);
    if (price === null) throw new MatchError('invalid_message', 'A antena já está no máximo.');
    if (this.money < price) throw new MatchError('not_enough_money', 'Dinheiro insuficiente.');
    this.towerLevel++;
    this.towerHp = Math.min(this.towerMaxHp, this.towerHp + GAME.towerUpgrade.HP_STEP);
    this.setMoney(this.money - price, -price);
    this.io.broadcast({ type: 'tower_hp', hp: this.towerHp, maxHp: this.towerMaxHp, level: this.towerLevel });
  }

  /** Repara a torre até o máximo (dinheiro da sala). */
  repairTower(playerId: string): void {
    const p = this.alive(playerId);
    this.assertNearTower(p);
    if (this.gameOver) throw new MatchError('invalid_message', 'A torre de comunicação foi destruída.');
    const missing = this.towerMaxHp - this.towerHp;
    if (missing <= 0) throw new MatchError('invalid_message', 'A antena já está com vida cheia.');
    const price = towerRepairPrice(missing);
    if (this.money < price) throw new MatchError('not_enough_money', 'Dinheiro insuficiente.');
    this.towerHp = this.towerMaxHp;
    this.setMoney(this.money - price, -price);
    this.io.broadcast({ type: 'tower_hp', hp: this.towerHp, maxHp: this.towerMaxHp, level: this.towerLevel });
  }

  damageTower(amount: number): void {
    if (this.gameOver || this.towerHp <= 0) return;
    this.towerHp = Math.max(0, this.towerHp - amount);
    this.io.broadcast({ type: 'tower_hp', hp: this.towerHp, maxHp: this.towerMaxHp, level: this.towerLevel });
    if (this.towerHp <= 0) {
      this.gameOver = true;
      this.zombies.clear();
      this.io.broadcast({ type: 'game_over', reason: 'tower_destroyed', restartIn: 6 });
      this.io.onGameOver('tower_destroyed');
    }
  }

  /** Golpe de ferramenta numa parede: machado (madeira/porteira) ou picareta (pedra/ferro); WALL_HITS golpes derrubam. */
  hitWall(playerId: string, id: number): void {
    const p = this.alive(playerId);
    const s = this.structures.get(id);
    if (!s) throw new MatchError('invalid_message', 'Essa parede já caiu.');
    if (dist(p.snapshot, s) > GAME.interaction.RADIUS + GAME.walls.WIDTH / 2 + 0.5) throw new MatchError('too_far', 'Chegue mais perto.');
    const tool = WALL_TOOL[s.kind];
    if (this.equippedItem(p) !== tool) throw new MatchError('no_tool', tool === 'axe' ? 'Precisa do machado para derrubar isso.' : 'Precisa da picareta para derrubar isso.');
    const now = this.now();
    if (now - p.lastHitAt < GAME.interaction.HIT_INTERVAL * 1000 * 0.8) return;
    p.lastHitAt = now;
    const hits = (this.wallHits.get(id) ?? 0) + 1;
    const required = WALL_HITS[s.kind];
    if (hits >= required) {
      this.wallHits.delete(id);
      this.structures.delete(id);
      this.obstacleCache = null;
      this.io.broadcast({ type: 'structure_removed', id });
      return;
    }
    this.wallHits.set(id, hits);
    this.io.broadcast({ type: 'structure_hit', id, hits, required });
  }

  damageStructure(id: number, amount: number): void {
    const s = this.structures.get(id);
    if (!s) return;
    s.hp = Math.max(0, s.hp - amount);
    if (s.hp <= 0) {
      this.structures.delete(id);
      this.wallHits.delete(id);
      this.obstacleCache = null;
      this.io.broadcast({ type: 'structure_removed', id });
    } else {
      this.io.broadcast({ type: 'structure_hp', id, hp: s.hp });
    }
  }

  /** Coloca a parede equipada perto do jogador, num ponto livre. */
  placeWall(playerId: string, x: number, z: number, yaw: number): void {
    const p = this.alive(playerId);
    const item = this.equippedItem(p);
    if (!item || !isWallKind(item)) throw new MatchError('no_wall', 'Equipe uma parede na hotbar.');
    const kind = item as WallKind;
    if (dist(p.snapshot, { x, z }) > GAME.walls.PLACE_DIST + 0.5) throw new MatchError('too_far', 'Muito longe para colocar.');
    const b = mapBounds();
    if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) throw new MatchError('blocked', 'Fora do mapa.');
    const r = GAME.walls.WIDTH / 2;
    const blockers = [...this.obstacles(), ...[...this.players.values()].map((o) => ({ position: o.snapshot, solidRadius: GAME.player.RADIUS }))];
    if (!isClearOfCircles(x, z, blockers, r * 0.6)) throw new MatchError('blocked', 'Lugar ocupado.');
    if (dist({ x, z }, GAME.hub.VENDOR) < 3) throw new MatchError('blocked', 'Não dá para bloquear o vendedor.');
    const slot = p.hotbar.findIndex((s) => s?.itemId === kind);
    const stack = p.hotbar[slot]!;
    if (!p.infiniteItems) {
      stack.count--;
      if (stack.count <= 0) p.hotbar[slot] = null;
    }
    const s: StructureSnapshot = { id: this.nextStructureId++, kind, x, z, yaw, hp: WALL_HP[kind], maxHp: WALL_HP[kind] };
    this.structures.set(s.id, s);
    this.obstacleCache = null;
    this.io.broadcast({ type: 'structure_added', structure: s });
    this.sendHotbar(p);
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
    // correndo só atira com o Recoil no máximo (o client já avisa; aqui é a garantia)
    const stance = this.stanceOf(p);
    if (stance === 'run' && !canFireRunning(p.upgrades)) return;
    if (p.mag <= 0) {
      this.sendAmmo(p);
      return;
    }
    p.mag--;
    p.nextFireAt = now + w.COOLDOWN * 1000;
    // recoil: o tiro sai desviado da mira por até ±spread graus (menos com upgrade; parado é mais preciso, andando menos)
    const aim = normalize2(dx, dz);
    const spread = (spreadDegreesFor(p.upgrades, stance) * Math.PI) / 180;
    const angle = Math.atan2(aim.dx, aim.dz) + (this.rand() * 2 - 1) * spread;
    const dir = { dx: Math.sin(angle), dz: Math.cos(angle) };
    const from = p.snapshot;

    type Hit = { position: { x: number; z: number }; mp?: MatchPlayer; zb?: Zombie };
    const targets: Hit[] = [...this.players.values()].filter((o) => o !== p && !o.dead && !o.boarded).map((o) => ({ position: o.snapshot, mp: o }));
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
        // pilha cheia (ferramentas/armas têm stackMax 1)
        if (addItem(p.hotbar, a.itemId, ITEMS[a.itemId].stackMax) === ITEMS[a.itemId].stackMax) throw new MatchError('hotbar_full', 'Hotbar cheia.');
        if (a.itemId === 'glock') {
          p.mag = magSize(p.upgrades);
          this.sendAmmo(p);
        }
        this.sendHotbar(p);
        return;
      case 'infinite_items':
        p.infiniteItems = a.on;
        return;
      case 'upgrade':
        if (isMaxed(a.kind, p.upgrades[a.kind])) throw new MatchError('invalid_message', 'Upgrade já está no máximo.');
        p.upgrades[a.kind]++;
        this.io.send(playerId, { type: 'upgrades', upgrades: { ...p.upgrades } });
        if (a.kind === 'ammo') this.sendAmmo(p);
        return;
      case 'tower_upgrade':
        if (towerUpgradePrice(this.towerLevel) === null) throw new MatchError('invalid_message', 'A antena já está no máximo.');
        this.towerLevel++;
        this.towerHp = Math.min(this.towerMaxHp, this.towerHp + GAME.towerUpgrade.HP_STEP);
        this.io.broadcast({ type: 'tower_hp', hp: this.towerHp, maxHp: this.towerMaxHp, level: this.towerLevel });
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
    if (killer) {
      killer.snapshot.kills++;
      killer.matchZombieKills++;
    }
    // chefão deixa o coração no chão: vale caro no vendedor
    if (z.kind === 'boss') {
      const b = mapBounds();
      this.spawnDrop('boss_heart', 1, Math.min(b.maxX, Math.max(b.minX, z.x)), Math.min(b.maxZ, Math.max(b.minZ, z.z)));
    }
    // infectado abatido: o dono volta a ser humano pelo respawn normal
    const owner = z.ownerId ? this.players.get(z.ownerId) : undefined;
    if (owner && owner.infectedZombieId === z.id) {
      owner.infectedZombieId = null;
      owner.respawnAt = this.now() + GAME.player.RESPAWN_SECONDS * 1000;
    }
    this.io.broadcast({ type: 'zombie_died', id: z.id, kind: z.kind, killerId });
  }

  /**
   * Fogo amigo: quem morre para outro jogador vira zumbi por GAME.infected.DURATION s onde caiu,
   * caçando quem o matou (`focusId`; null = qualquer jogador vivo). Só respawna quando o zumbi
   * morre (RESPAWN_SECONDS depois) ou some (na hora).
   */
  private infect(target: MatchPlayer, focusId: string | null): void {
    const z = this.zombies.spawnInfected(target.snapshot.id, target.snapshot.character, focusId, target.snapshot.x, target.snapshot.z);
    target.infectedZombieId = z.id;
    target.respawnAt = Infinity;
    this.io.broadcast({ type: 'player_infected', playerId: target.snapshot.id, zombieId: z.id, targetId: focusId, seconds: GAME.infected.DURATION });
  }

  /** Faca: acerta o alvo mais próximo dentro do arco à frente (zumbi ou jogador). */
  melee(playerId: string, dx: number, dz: number): void {
    const p = this.alive(playerId);
    const k = GAME.weapon.knife;
    if (this.equippedItem(p) !== 'knife') throw new MatchError('no_weapon', 'Equipe a Faca.');
    const now = this.now();
    if (now < p.nextFireAt) return;
    p.nextFireAt = now + k.COOLDOWN * 1000;
    const dir = normalize2(dx, dz);
    const cosArc = Math.cos(((k.ARC_DEG / 2) * Math.PI) / 180);
    type Hit = { d: number; mp?: MatchPlayer; zb?: Zombie };
    let best: Hit | null = null;
    const consider = (pos: { x: number; z: number }, radius: number, h: Hit) => {
      const ox = pos.x - p.snapshot.x;
      const oz = pos.z - p.snapshot.z;
      const d = Math.hypot(ox, oz);
      if (d - radius > k.RANGE) return;
      if (d > 0.05 && (ox * dir.dx + oz * dir.dz) / d < cosArc) return;
      h.d = d;
      if (!best || d < best.d) best = h;
    };
    for (const o of this.players.values()) if (o !== p && !o.dead && !o.boarded) consider(o.snapshot, GAME.player.RADIUS, { d: 0, mp: o });
    for (const zb of this.zombies.alive()) consider(zb, zb.radius, { d: 0, zb });
    const hit = best as Hit | null;
    this.io.broadcast({ type: 'melee_swing', playerId, hitPlayerId: hit?.mp?.snapshot.id, hitZombieId: hit?.zb?.id });
    const dmg = Math.round(k.DAMAGE * p.damageMult * damageMultiplier(p.upgrades));
    if (hit?.mp) this.damagePlayer(hit.mp, dmg, playerId);
    if (hit?.zb) this.zombies.damage(hit.zb, dmg, playerId);
  }

  reload(playerId: string): void {
    const p = this.alive(playerId);
    const w = GAME.weapon.glock;
    if (this.equippedItem(p) !== 'glock' || p.mag === magSize(p.upgrades) || p.reloadUntil > this.now()) return;
    p.reloadUntil = this.now() + w.RELOAD * 1000;
    this.sendAmmo(p);
  }

  /** `by` = jogador que causou (tiro/faca); `byZombie` = id do zumbi (um infectado conta como o jogador dono). */
  damagePlayer(target: MatchPlayer, amount: number, by?: string, byZombie?: number): void {
    if (target.dead || target.boarded || this.isShielded(target)) return;
    const zb = byZombie !== undefined ? this.zombies.zombies.get(byZombie) : undefined;
    const infectedBy = zb?.kind === 'infected' ? zb : undefined;
    const killerId = by ?? infectedBy?.ownerId ?? undefined;
    target.snapshot.hp = Math.max(0, target.snapshot.hp - amount);
    this.io.broadcast({ type: 'hp', playerId: target.snapshot.id, hp: target.snapshot.hp, by: killerId });
    if (target.snapshot.hp <= 0) {
      target.dead = true;
      target.snapshot.deaths++;
      target.matchDeaths++;
      const killer = killerId ? this.players.get(killerId) : undefined;
      if (killer && killer !== target) {
        killer.snapshot.pvpKills++;
        killer.matchHumanKills++;
      }
      target.snapshot.anim = 'Death';
      target.respawnAt = this.now() + GAME.player.RESPAWN_SECONDS * 1000;
      const livesLeft = Math.max(0, GAME.lives.MAX_DEATHS - target.matchDeaths);
      // sem vidas: eliminado (não renasce nem vira zumbi); todos eliminados = derrota
      if (livesLeft <= 0) {
        target.eliminated = true;
        target.respawnAt = Infinity;
        this.io.broadcast({ type: 'player_died', playerId: target.snapshot.id, killerId, respawnIn: 0, eliminated: true, livesLeft: 0 });
        this.checkAllEliminated();
        return;
      }
      // fogo amigo (tiro/faca de outro jogador, ou o zumbi de um infectado): vira zumbi
      const pvp = (by !== undefined && by !== target.snapshot.id) || infectedBy !== undefined;
      this.io.broadcast({ type: 'player_died', playerId: target.snapshot.id, killerId, respawnIn: pvp ? GAME.infected.DURATION : GAME.player.RESPAWN_SECONDS, eliminated: false, livesLeft });
      if (pvp) {
        // caça quem o matou; se foi um infectado, caça o alvo dele (ou qualquer um vivo)
        const focus = by !== undefined ? by : infectedBy!.focusId;
        const focusAlive = focus !== null && focus !== target.snapshot.id && this.players.get(focus)?.dead === false;
        this.infect(target, focusAlive ? focus : null);
      }
    }
  }

  // ---------- loop ----------

  /** Chamado a cada tick do servidor: zumbis/waves, recarga terminada, respawns. */
  tick(): void {
    const now = this.now();
    const dt = Math.min(0.1, Math.max(0, (now - this.lastTick) / 1000));
    this.lastTick = now;

    if (this.gameOver) return;
    if (this.waves.active || this.zombies.zombies.size > 0) {
      const targets: import('./ZombieSim.js').Target[] = [...this.players.values()].map((p) => ({ id: p.snapshot.id, position: p.snapshot, dead: p.dead || p.boarded, radius: GAME.player.RADIUS, kind: 'player' as const, lure: p.carrying }));
      targets.push({ id: 'tower', position: this.towerPos, dead: this.towerHp <= 0, radius: GAME.hub.TOWER_RADIUS, kind: 'tower' });
      for (const s of this.structures.values()) targets.push({ id: `wall:${s.id}`, position: s, dead: false, radius: GAME.walls.WIDTH / 2, kind: 'wall' });
      this.zombies.tick(dt, targets);
      // a torre pode ter caído agora: nada de spawn ambiental nem eventos de wave depois do game over
      if (this.gameOver) return;
    }
    // recursos renascem
    for (const [id, at] of this.respawnAt) {
      if (now < at) continue;
      this.respawnAt.delete(id);
      this.removed.delete(id);
      this.obstacleCache = null;
      this.io.broadcast({ type: 'object_respawned', objectId: id });
    }
    // itens largados expiram
    for (const [id, at] of this.dropExpiresAt) if (now >= at) this.removeDrop(id);
    // zumbis ambientais: sempre alguns no mapa, mesmo sem wave
    if (now >= this.nextAmbientAt) {
      this.nextAmbientAt = now + GAME.ambient.INTERVAL * 1000;
      const max = GAME.ambient.BASE_MAX + GAME.ambient.PER_PLAYER * this.players.size;
      if (this.players.size > 0 && this.zombies.aliveAmbient < max) {
        const sp = this.zombies.pickSpawnPoint();
        this.zombies.spawn(this.rand() < GAME.zombie.SPITTER_RATIO ? 'spitter' : 'zombie', sp.x, sp.z, 1, 1, false);
      }
    }
    if (this.waves.tick()) this.io.broadcast({ type: 'wave_state', wave: this.waves.state() });
    this.tickEvac(now);
    for (const p of this.players.values()) {
      if (p.reloadUntil && now >= p.reloadUntil) {
        p.reloadUntil = 0;
        p.mag = magSize(p.upgrades);
        this.sendAmmo(p);
      }
      // infectado cujo zumbi sumiu sem morrer (expirou / horda limpa): volta ao normal agora
      if (p.dead && p.infectedZombieId !== null && !this.zombies.zombies.has(p.infectedZombieId)) {
        p.infectedZombieId = null;
        p.respawnAt = now;
      }
      if (p.dead && !p.eliminated && now >= p.respawnAt) {
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
