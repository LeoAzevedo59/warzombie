import * as pc from 'playcanvas';
import type { System } from '@/Core/GameLoop';
import type { EventBus } from '@/Core/EventBus';
import type { GameState } from '@/Core/GameState';
import type { NetworkClient } from '@/Net/NetworkClient';
import type { Player } from '@/Entities/Player/Player';
import { RemotePlayer } from '@/Entities/Player/RemotePlayer';
import type { NetAnim, PlayerSnapshot, ServerMessage } from '@shared/protocol';
import { applyGameStart } from '@/Core/GameStart';

/** Envio da própria pose ao servidor (Hz). Independe do tick do servidor. */
const SEND_RATE = 20;

/**
 * Ponte entre o jogo local e o servidor:
 * - envia a pose do player local a SEND_RATE Hz (só se mudou);
 * - recebe `state`/`player_joined`/`player_left` e mantém os RemotePlayers na cena;
 * - traduz as mensagens de partida (hotbar, dinheiro, tiros, HP, morte) em eventos do EventBus.
 */
export class NetworkSystem implements System {
  readonly name = 'Network';
  readonly remotes = new Map<string, RemotePlayer>();
  private unsubs: Array<() => void> = [];
  private sendAccum = 0;
  private lastSent = { x: NaN, z: NaN, yaw: NaN, anim: '' as string, crouching: false };

  constructor(
    private net: NetworkClient,
    private bus: EventBus,
    private state: GameState,
    private player: Player,
    private root: pc.Entity,
  ) {
    for (const p of state.roomPlayers) if (p.id !== state.playerId) this.addRemote(p);
    this.unsubs.push(net.onMessage((m) => this.onMessage(m)));
    this.unsubs.push(net.onClose((reason) => bus.emit('net:disconnected', { reason })));
    this.unsubs.push(bus.on('remote:shot', ({ playerId }) => this.remotes.get(playerId)?.playShoot()));
    this.emitCount();
  }

  /** Posição de qualquer jogador da partida. */
  positionOf(id: string): pc.Vec3 | null {
    if (id === this.state.playerId) return this.player.position;
    return this.remotes.get(id)?.position ?? null;
  }

  nameOf(id: string): string {
    if (id === this.state.playerId) return this.state.playerName;
    return this.remotes.get(id)?.name ?? '?';
  }

  private onMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case 'state':
        for (const pose of msg.players) this.remotes.get(pose.id)?.applyPose(pose);
        this.bus.emit('net:zombies', { zombies: msg.zombies });
        this.bus.emit('net:projectiles', { projectiles: msg.projectiles });
        break;
      case 'shield':
        this.bus.emit('net:shield', { playerId: msg.playerId, seconds: msg.seconds });
        break;
      case 'slowed':
        if (msg.playerId === this.state.playerId) {
          this.player.applySlow(msg.factor, msg.seconds);
          this.bus.emit('player:slowed', { factor: msg.factor, seconds: msg.seconds });
        }
        break;
      case 'wave_state':
        this.state.wave = msg.wave;
        this.bus.emit('wave:state', { wave: msg.wave });
        break;
      case 'wave_started':
        this.bus.emit('wave:started', { wave: msg.wave, count: msg.count, players: msg.players });
        break;
      case 'boss_spawned':
        this.bus.emit('boss:spawned', { id: msg.id, hp: msg.hp, wave: msg.wave });
        break;
      case 'boss_incoming':
        this.bus.emit('boss:incoming', { wave: msg.wave, inSeconds: msg.inSeconds });
        break;
      case 'wave_cleared':
        this.bus.emit('wave:cleared', { wave: msg.wave, total: msg.total });
        break;
      case 'helicopter':
        this.bus.emit('evac:helicopter', { x: msg.x, z: msg.z, landsIn: msg.landsIn, timeout: msg.timeout });
        break;
      case 'player_boarded':
        if (msg.playerId === this.state.playerId) {
          this.state.boarded = true;
          this.player.entity.enabled = false;
          this.bus.emit('ui:toast', { text: 'Você embarcou no helicóptero!' });
        } else {
          this.remotes.get(msg.playerId)?.hide();
          this.bus.emit('ui:toast', { text: `${this.nameOf(msg.playerId)} embarcou no helicóptero` });
        }
        this.bus.emit('evac:boarded', { playerId: msg.playerId });
        break;
      case 'evac_complete':
        this.bus.emit('evac:complete', { rescued: msg.rescued, leftBehind: msg.leftBehind });
        break;
      case 'player_trophy':
        if (msg.playerId === this.state.playerId) this.state.trophies = msg.trophies;
        else {
          const r = this.remotes.get(msg.playerId);
          if (r) r.trophies = msg.trophies;
        }
        this.bus.emit('net:trophy', { playerId: msg.playerId, trophies: msg.trophies });
        break;
      case 'battery_price':
        this.state.batteryPrice = msg.price;
        this.bus.emit('net:batteryPrice', { price: msg.price });
        break;
      case 'player_infected':
        if (msg.playerId === this.state.playerId) {
          // vira espectador do próprio zumbi: o corpo some, a câmera segue o zumbi (WorldScene)
          this.state.spectateZombieId = msg.zombieId;
          this.player.entity.enabled = false;
          this.bus.emit('player:infected', { targetName: msg.targetId ? this.nameOf(msg.targetId) : null, seconds: msg.seconds, zombieId: msg.zombieId });
        } else {
          this.remotes.get(msg.playerId)?.hide();
          this.bus.emit('ui:toast', { text: `${this.nameOf(msg.playerId)} virou zumbi!${msg.targetId === this.state.playerId ? ' Ele quer VOCÊ.' : ''}` });
        }
        break;
      case 'boss_slam':
        this.bus.emit('boss:slam', { x: msg.x, z: msg.z, radius: msg.radius, windup: msg.windup });
        break;
      case 'zombie_died':
        if (msg.killerId === this.state.playerId) this.state.kills++;
        this.bus.emit('zombie:died', { id: msg.id, kind: msg.kind, killerId: msg.killerId ?? null });
        break;
      case 'phase_complete':
        this.bus.emit('phase:complete', { summary: msg.summary, duration: msg.duration });
        break;
      case 'knockback':
        this.bus.emit('net:knockback', { dx: msg.dx, dz: msg.dz, force: msg.force });
        break;
      case 'player_joined':
        this.addRemote(msg.player);
        this.bus.emit('net:playerJoined', { name: msg.player.name });
        this.emitCount();
        break;
      case 'player_left': {
        const r = this.remotes.get(msg.id);
        if (!r) break;
        this.remotes.delete(msg.id);
        r.dispose();
        this.bus.emit('net:playerLeft', { name: r.name });
        this.emitCount();
        break;
      }
      case 'hotbar':
        this.bus.emit('net:hotbar', { slots: msg.slots, equipped: msg.equipped });
        break;
      case 'money':
        this.state.money = msg.amount;
        this.bus.emit('net:money', { amount: msg.amount, delta: msg.delta });
        break;
      case 'item_gained':
        this.bus.emit('item:collected', { itemId: msg.itemId, count: msg.count });
        break;
      case 'object_removed':
        this.bus.emit('net:objectRemoved', { objectId: msg.objectId });
        break;
      case 'node_hit':
        this.bus.emit('net:nodeHit', { objectId: msg.objectId, hits: msg.hits, required: msg.required });
        break;
      case 'shot':
        this.bus.emit('net:shot', { playerId: msg.playerId, dx: msg.dx, dz: msg.dz, length: msg.length, hitPlayerId: msg.hitPlayerId ?? null });
        break;
      case 'upgrades':
        this.state.upgrades = { ...msg.upgrades };
        this.bus.emit('net:upgrades', { upgrades: msg.upgrades });
        this.player.stats.notify();
        this.bus.emit('ui:toast', { text: 'Upgrade comprado!' });
        break;
      case 'upgrade_prices':
        this.state.upgradePrices = { ...msg.prices };
        this.bus.emit('net:upgradePrices', { prices: msg.prices });
        break;
      case 'room_features':
        this.state.features = { ...msg.features };
        this.bus.emit('net:features', { features: msg.features });
        if (msg.features.minimap) this.bus.emit('ui:toast', { text: 'Minimapa ativado para a sala!' });
        break;
      case 'tower_hp':
        this.state.towerHp = msg.hp;
        this.state.towerMaxHp = msg.maxHp;
        this.state.towerLevel = msg.level;
        this.bus.emit('net:towerHp', { hp: msg.hp, maxHp: msg.maxHp });
        break;
      case 'game_over':
        this.bus.emit('net:gameOver', { restartIn: msg.restartIn, reason: msg.reason });
        break;
      case 'revive_price':
        this.state.revivePrice = msg.price;
        this.bus.emit('net:revivePrice', { price: msg.price });
        break;
      case 'player_revived':
        this.state.eliminated.delete(msg.playerId);
        if (msg.playerId === this.state.playerId) this.state.deaths = 0; // volta com as vidas cheias
        this.bus.emit('net:eliminatedChanged');
        this.bus.emit('ui:toast', { text: msg.playerId === this.state.playerId ? `${this.nameOf(msg.byId)} comprou uma Medalha de Ressurreição para você!` : `${this.nameOf(msg.byId)} reviveu ${this.nameOf(msg.playerId)} com uma Medalha de Ressurreição` });
        break;
      case 'game_start':
        // reinício após derrota (ou nova partida): recarrega o mundo
        applyGameStart(this.state, msg);
        this.bus.emit('scene:change', { scene: 'world' });
        break;
      case 'structure_added':
        this.bus.emit('net:structureAdded', { structure: msg.structure });
        break;
      case 'structure_hit':
        this.bus.emit('net:structureHit', { id: msg.id, hits: msg.hits, required: msg.required });
        break;
      case 'structure_hp':
        this.bus.emit('net:structureHp', { id: msg.id, hp: msg.hp });
        break;
      case 'drop_added':
        this.bus.emit('net:dropAdded', { drop: msg.drop });
        if (msg.drop.itemId === 'boss_heart') this.bus.emit('ui:toast', { text: 'O chefão deixou o coração! Pegue e venda no vendedor.' });
        break;
      case 'drop_removed':
        this.bus.emit('net:dropRemoved', { id: msg.id });
        break;
      case 'structure_removed':
        this.bus.emit('net:structureRemoved', { id: msg.id });
        break;
      case 'object_respawned':
        this.state.collectedObjectIds.delete(msg.objectId);
        this.bus.emit('net:objectRespawned', { objectId: msg.objectId });
        break;
      case 'wave_failed':
        this.bus.emit('wave:failed', { wave: msg.wave, boss: msg.boss });
        break;
      case 'melee_swing':
        this.bus.emit('net:melee', { playerId: msg.playerId, hitPlayerId: msg.hitPlayerId ?? null, hitZombieId: msg.hitZombieId ?? null });
        if (msg.playerId === this.state.playerId) this.player.playMelee();
        else this.remotes.get(msg.playerId)?.playMelee();
        break;
      case 'ammo':
        this.state.ammo = msg.mag;
        this.state.magSize = msg.magSize;
        this.state.reloading = msg.reloading;
        this.bus.emit('net:ammo', { mag: msg.mag, magSize: msg.magSize, reloading: msg.reloading });
        break;
      case 'hp':
        if (msg.playerId === this.state.playerId) {
          const before = this.state.hp;
          this.player.stats.setHp(msg.hp);
          if (msg.hp < before) this.bus.emit('player:damaged', { amount: before - msg.hp, special: false });
          else if (msg.hp > before && !msg.by) this.bus.emit('player:healed', { amount: msg.hp - before });
        } else {
          const r = this.remotes.get(msg.playerId);
          if (r) r.hp = msg.hp;
        }
        break;
      case 'player_died': {
        const killerName = msg.killerId ? this.nameOf(msg.killerId) : null;
        if (msg.eliminated) {
          this.state.eliminated.add(msg.playerId);
          this.bus.emit('net:eliminatedChanged');
        }
        if (msg.playerId === this.state.playerId) {
          this.state.deaths++;
          this.player.stats.setHp(0);
          this.player.anim.play('Death', 0.1, true);
          if (msg.eliminated) this.bus.emit('player:eliminated', { killerName });
          else this.bus.emit('player:died', { killerName, respawnIn: msg.respawnIn, livesLeft: msg.livesLeft });
        } else {
          this.remotes.get(msg.playerId)?.die();
          const who = this.nameOf(msg.playerId);
          this.bus.emit('ui:toast', { text: msg.eliminated ? `${who} foi ELIMINADO — compre uma Medalha de Ressurreição no vendedor para reviver` : `${who} morreu${killerName ? ` (${killerName})` : ''}` });
        }
        break;
      }
      case 'player_respawned':
        if (this.state.eliminated.delete(msg.playerId)) this.bus.emit('net:eliminatedChanged');
        if (msg.playerId === this.state.playerId) {
          this.state.spectateZombieId = null;
          this.player.entity.enabled = true;
          this.player.setPosition(msg.x, 0, msg.z);
          this.player.stats.setHp(msg.hp);
          this.player.anim.play('Idle', 0.1, true);
          this.bus.emit('player:respawned');
        } else {
          this.remotes.get(msg.playerId)?.respawn(msg.x, msg.z);
        }
        break;
      case 'room_left':
        this.bus.emit('net:roomLeft', { reason: msg.reason });
        break;
      case 'error':
        this.bus.emit('ui:toast', { text: msg.message });
        break;
      default:
        break;
    }
  }

  private addRemote(snapshot: PlayerSnapshot): void {
    if (this.remotes.has(snapshot.id)) return;
    const r = new RemotePlayer(snapshot.id, snapshot);
    this.root.addChild(r.entity);
    r.initAnimation();
    this.remotes.set(snapshot.id, r);
  }

  private emitCount(): void {
    this.bus.emit('net:onlineCount', { count: this.remotes.size + 1 });
  }

  update(dt: number): void {
    for (const r of this.remotes.values()) r.update(dt);
    if (this.player.stats.dead) return; // morto não manda pose (o servidor ignoraria)

    this.sendAccum += dt;
    if (this.sendAccum < 1 / SEND_RATE) return;
    this.sendAccum = 0;

    const pos = this.player.position;
    const yaw = this.player.entity.getEulerAngles().y;
    const raw = this.player.anim.state ?? 'Idle';
    const anim = (['Idle', 'Walk', 'Run', 'Gun_Shoot', 'Punch_Left', 'Death'].includes(raw) ? raw : 'Idle') as NetAnim;
    const crouching = this.player.crouching;
    const l = this.lastSent;
    if (l.x !== pos.x || l.z !== pos.z || Math.abs(l.yaw - yaw) > 0.01 || l.anim !== anim || l.crouching !== crouching) {
      l.x = pos.x;
      l.z = pos.z;
      l.yaw = yaw;
      l.anim = anim;
      l.crouching = crouching;
      this.net.send({ type: 'move', x: pos.x, z: pos.z, yaw, anim, crouching });
    }
  }

  dispose(): void {
    this.unsubs.forEach((u) => u());
    for (const r of this.remotes.values()) r.dispose();
    this.remotes.clear();
  }
}
