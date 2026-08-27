import * as pc from 'playcanvas';
import { GAME } from '@shared/gameconfig';
import type { System } from '@/Core/GameLoop';
import type { EventBus } from '@/Core/EventBus';
import type { GameState } from '@/Core/GameState';
import type { Player } from '@/Entities/Player/Player';
import { makeBox } from '@/Assets/Primitives';
import type { InputSystem } from './InputSystem';
import type { EquipmentSystem } from './EquipmentSystem';
import type { NetworkClient } from '@/Net/NetworkClient';
import { ITEMS } from '@shared/items';

const MUZZLE_HEIGHT = 1.2;

/**
 * Tiro com a Glock equipada: clique manda `fire {dx,dz}` (player -> mouse no chão) para o servidor,
 * que decide acerto/dano e responde `shot` para todos — é aí que o traçante é desenhado
 * (inclusive o nosso), garantindo que todos vejam o mesmo tiro. R recarrega.
 */
export class CombatSystem implements System {
  readonly name = 'Combat';
  private unsubs: Array<() => void> = [];
  private cooldown = 0;
  private dir = new pc.Vec3();
  private tmp = new pc.Vec3();
  /** mira laser: da arma até o alcance máximo, na direção do mouse (o recoil desvia o tiro real disso) */
  private laser: pc.Entity | null = null;
  private laserDir = new pc.Vec3();

  constructor(
    private bus: EventBus,
    private state: GameState,
    private player: Player,
    private input: InputSystem,
    private equipment: EquipmentSystem,
    private net: NetworkClient,
    private sceneRoot: pc.Entity,
    /** posição atual de qualquer jogador da partida (local ou remoto) */
    private playerPosition: (id: string) => pc.Vec3 | null,
  ) {
    this.unsubs.push(
      bus.on('input:fire', () => this.fire()),
      bus.on('input:reload', () => this.reload()),
      bus.on('net:shot', ({ playerId, dx, dz, length }) => {
        const from = this.playerPosition(playerId);
        if (!from) return;
        void dx;
        void dz;
        void length;
        if (playerId === this.state.playerId) this.player.playShoot();
        else this.bus.emit('remote:shot', { playerId });
      }),
    );
  }

  update(dt: number): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.updateLaser();
  }

  get canFire(): boolean {
    return this.equipment.equippedItem() === 'glock' && this.cooldown <= 0 && !this.player.stats.dead && !this.state.reloading;
  }

  private fire(): void {
    const eq = this.equipment.equippedItem();
    if (eq && eq.startsWith('wall_')) return; // modo construção: o clique coloca a parede
    if (eq && ITEMS[eq].heal) {
      // consumível: clique usa (o servidor cura e desconta)
      if (this.player.stats.dead || this.cooldown > 0) return;
      if (this.state.hp >= GAME.player.MAX_HP) {
        this.bus.emit('ui:toast', { text: 'Sua vida já está cheia.' });
        return;
      }
      this.cooldown = GAME.consumable.USE_COOLDOWN;
      this.net.send({ type: 'use_item' });
      return;
    }
    if (this.equipment.equippedItem() === 'knife' && !this.player.stats.dead && this.cooldown <= 0) {
      this.cooldown = GAME.weapon.knife.COOLDOWN;
      const from = this.player.position;
      const aim = this.input.state.aimPoint;
      if (aim) {
        this.dir.set(aim.x - from.x, 0, aim.z - from.z);
        if (this.dir.lengthSq() < 1e-4) this.player.forward(this.dir);
        else this.dir.normalize();
        this.player.lookAt(aim);
      } else this.player.forward(this.dir);
      this.net.send({ type: 'melee', dx: this.dir.x, dz: this.dir.z });
      return;
    }
    if (!this.canFire) return;
    if (this.state.ammo <= 0) {
      this.bus.emit('audio:sfx', { name: 'gun_empty' });
      this.bus.emit('ui:toast', { text: 'Sem munição — aperte R para recarregar' });
      return;
    }
    this.cooldown = GAME.weapon.glock.COOLDOWN;

    // direção: player -> mouse no chão; sem mouse válido, pra onde está olhando
    const from = this.player.position;
    const aim = this.input.state.aimPoint;
    if (aim) {
      this.dir.set(aim.x - from.x, 0, aim.z - from.z);
      if (this.dir.lengthSq() < 1e-4) this.player.forward(this.dir);
      else this.dir.normalize();
      this.player.lookAt(aim);
    } else {
      this.player.forward(this.dir);
    }
    this.net.send({ type: 'fire', dx: this.dir.x, dz: this.dir.z });
  }

  private reload(): void {
    if (this.equipment.equippedItem() !== 'glock' || this.player.stats.dead) return;
    if (!this.state.reloading && this.state.ammo < this.state.magSize) this.bus.emit('audio:sfx', { name: 'gun_reload' });
    this.net.send({ type: 'reload' });
  }

  private updateLaser(): void {
    // laser só com o upgrade "Mira laser"
    const show = this.state.upgrades.laser > 0 && this.equipment.equippedItem() === 'glock' && !this.player.stats.dead && !!this.input.state.aimPoint;
    if (!show) {
      if (this.laser) this.laser.enabled = false;
      return;
    }
    const range = GAME.weapon.glock.RANGE;
    if (!this.laser) {
      this.laser = makeBox({ color: '#ff2a2a', scale: [0.02, 0.02, range], emissive: 2 });
      this.sceneRoot.addChild(this.laser);
    }
    this.laser.enabled = true;
    const from = this.player.position;
    const aim = this.input.state.aimPoint!;
    this.laserDir.set(aim.x - from.x, 0, aim.z - from.z);
    if (this.laserDir.lengthSq() < 1e-4) this.player.forward(this.laserDir);
    else this.laserDir.normalize();
    const mid = this.tmp.copy(this.laserDir).mulScalar(range / 2).add(from);
    this.laser.setPosition(mid.x, MUZZLE_HEIGHT, mid.z);
    this.laser.setEulerAngles(0, Math.atan2(this.laserDir.x, this.laserDir.z) * pc.math.RAD_TO_DEG, 0);
  }

  dispose(): void {
    this.unsubs.forEach((u) => u());
    this.laser?.destroy();
    this.laser = null;
  }
}
