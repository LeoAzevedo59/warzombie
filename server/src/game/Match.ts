import { GAME } from '../../../shared/gameconfig.js';
import type { ItemId } from '../../../shared/items.js';
import { dist, normalize2, rayHitNearest } from '../../../shared/math.js';
import type { PlayerSnapshot, ServerMessage } from '../../../shared/protocol.js';
import { generateWorld, WORLD_OBJECTS, type WorldObjectSpec } from '../../../shared/worldgen.js';
import { addItem, buy, canFit, emptyHotbar, sellAll, type Hotbar } from './Economy.js';

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
}

export class MatchError extends Error {
  constructor(
    readonly code: 'too_far' | 'hotbar_full' | 'no_tool' | 'not_enough_money' | 'no_weapon' | 'dead' | 'invalid_message',
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

  constructor(
    seed: number,
    money: number,
    private io: MatchIO,
    private now: () => number = Date.now,
  ) {
    this.objects = generateWorld(seed);
    this.money = money;
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
      mag: GAME.weapon.glock.MAG,
      reloadUntil: 0,
      nextFireAt: 0,
    };
    this.players.set(snapshot.id, p);
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

  private sendHotbar(p: MatchPlayer): void {
    this.io.send(p.snapshot.id, { type: 'hotbar', slots: p.hotbar, equipped: p.equipped });
  }

  private sendAmmo(p: MatchPlayer): void {
    this.io.send(p.snapshot.id, { type: 'ammo', mag: p.mag, magSize: GAME.weapon.glock.MAG, reloading: p.reloadUntil > this.now() });
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
    if (p.mag <= 0) {
      this.sendAmmo(p);
      return;
    }
    p.mag--;
    p.nextFireAt = now + w.COOLDOWN * 1000;
    const dir = normalize2(dx, dz);
    const from = p.snapshot;

    const targets = [...this.players.values()].filter((o) => o !== p && !o.dead).map((o) => ({ position: o.snapshot, mp: o }));
    const hit = rayHitNearest(from, dir.dx, dir.dz, targets, w.RANGE, w.HIT_RADIUS + GAME.player.RADIUS);
    // TODO(M3): também testar zumbis da ZombieSim
    this.io.broadcast({ type: 'shot', playerId, dx: dir.dx, dz: dir.dz, length: hit.t, hitPlayerId: hit.target?.mp.snapshot.id });
    this.sendAmmo(p);
    if (hit.target) this.damagePlayer(hit.target.mp, w.DAMAGE, playerId);
  }

  reload(playerId: string): void {
    const p = this.alive(playerId);
    const w = GAME.weapon.glock;
    if (this.equippedItem(p) !== 'glock' || p.mag === w.MAG || p.reloadUntil > this.now()) return;
    p.reloadUntil = this.now() + w.RELOAD * 1000;
    this.sendAmmo(p);
  }

  damagePlayer(target: MatchPlayer, amount: number, by?: string): void {
    if (target.dead) return;
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

  /** Chamado a cada tick do servidor: recarga terminada, respawns. */
  tick(): void {
    const now = this.now();
    for (const p of this.players.values()) {
      if (p.reloadUntil && now >= p.reloadUntil) {
        p.reloadUntil = 0;
        p.mag = GAME.weapon.glock.MAG;
        this.sendAmmo(p);
      }
      if (p.dead && now >= p.respawnAt) {
        p.dead = false;
        p.snapshot.hp = GAME.player.MAX_HP;
        p.snapshot.x = 0;
        p.snapshot.z = 0;
        p.snapshot.anim = 'Idle';
        this.io.broadcast({ type: 'player_respawned', playerId: p.snapshot.id, x: 0, z: 0, hp: p.snapshot.hp });
      }
    }
  }
}
