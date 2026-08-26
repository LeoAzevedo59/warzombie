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
 * - recebe `state`/`player_joined`/`player_left` e mantém os RemotePlayers na cena.
 */
export class NetworkSystem implements System {
  readonly name = 'Network';
  readonly remotes = new Map<string, RemotePlayer>();
  private unsubs: Array<() => void> = [];
  private sendAccum = 0;
  private lastSent = { x: NaN, z: NaN, yaw: NaN, anim: '' as string, crouching: false };
  private lastStats = { hp: NaN, kills: NaN };

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
    this.emitCount();
  }

  private onMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case 'state':
        for (const pose of msg.players) this.remotes.get(pose.id)?.applyPose(pose);
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
      case 'room_left':
        this.bus.emit('net:roomLeft', { reason: msg.reason });
        break;
      case 'error':
        this.bus.emit('ui:toast', { text: `Servidor: ${msg.message}` });
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
    if (this.lastStats.hp !== this.state.hp || this.lastStats.kills !== this.state.kills) {
      this.lastStats = { hp: this.state.hp, kills: this.state.kills };
      this.net.send({ type: 'stats', hp: Math.round(this.state.hp), kills: this.state.kills });
    }
  }

  dispose(): void {
    this.unsubs.forEach((u) => u());
    for (const r of this.remotes.values()) r.dispose();
    this.remotes.clear();
  }
}
