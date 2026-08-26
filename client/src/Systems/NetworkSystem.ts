import * as pc from 'playcanvas';
import type { System } from '@/Core/GameLoop';
import type { EventBus } from '@/Core/EventBus';
import type { GameState } from '@/Core/GameState';
import type { NetworkClient } from '@/Net/NetworkClient';
import type { Player } from '@/Entities/Player/Player';
import { RemotePlayer } from '@/Entities/Player/RemotePlayer';
import type { NetAnim, PlayerSnapshot, ServerMessage } from '@shared/protocol';

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
        break;
      case 'wave_state':
        this.state.wave = msg.wave;
        this.bus.emit('wave:state', { wave: msg.wave });
        break;
      case 'wave_started':
        this.bus.emit('wave:started', { wave: msg.wave, count: msg.count, players: msg.players });
        break;
      case 'boss_spawned':
        this.bus.emit('boss:spawned', { id: msg.id, hp: msg.hp });
        break;
      case 'boss_slam':
        this.bus.emit('boss:slam', { x: msg.x, z: msg.z, radius: msg.radius, windup: msg.windup });
        break;
      case 'zombie_died':
        if (msg.killerId === this.state.playerId) this.state.kills++;
        this.bus.emit('zombie:died', { id: msg.id, kind: msg.kind, killerId: msg.killerId ?? null });
        break;
      case 'phase_complete':
        this.bus.emit('phase:complete');
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
      case 'ammo':
        this.state.ammo = msg.mag;
        this.state.reloading = msg.reloading;
        this.bus.emit('net:ammo', { mag: msg.mag, magSize: msg.magSize, reloading: msg.reloading });
        break;
      case 'hp':
        if (msg.playerId === this.state.playerId) {
          const before = this.state.hp;
          this.player.stats.setHp(msg.hp);
          if (msg.hp < before) this.bus.emit('player:damaged', { amount: before - msg.hp, special: false });
        } else {
          const r = this.remotes.get(msg.playerId);
          if (r) r.hp = msg.hp;
        }
        break;
      case 'player_died':
        if (msg.playerId === this.state.playerId) {
          this.player.stats.setHp(0);
          this.player.anim.play('Death', 0.1, true);
          this.bus.emit('player:died', { killerName: msg.killerId ? this.nameOf(msg.killerId) : null, respawnIn: msg.respawnIn });
        } else {
          this.remotes.get(msg.playerId)?.die();
          this.bus.emit('ui:toast', { text: `${this.nameOf(msg.playerId)} morreu${msg.killerId ? ` (${this.nameOf(msg.killerId)})` : ''}` });
        }
        break;
      case 'player_respawned':
        if (msg.playerId === this.state.playerId) {
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
    const anim = (this.player.anim.state ?? 'Idle') as NetAnim;
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
