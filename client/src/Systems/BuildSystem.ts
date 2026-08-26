import * as pc from 'playcanvas';
import { GAME } from '@shared/gameconfig';
import { WALL_HP } from '@shared/items';
import type { System } from '@/Core/GameLoop';
import type { EventBus } from '@/Core/EventBus';
import type { Player } from '@/Entities/Player/Player';
import type { EquipmentSystem } from './EquipmentSystem';
import type { NetworkClient } from '@/Net/NetworkClient';
import type { World } from '@/World/World';
import { makeBox } from '@/Assets/Primitives';

/**
 * Colocação de paredes (B): com uma parede equipada, mostra um fantasma à frente do jogador e
 * manda `place_wall` para o servidor validar. Também aplica structure_added/hp/removed e o respawn de recursos no World.
 */
export class BuildSystem implements System {
  readonly name = 'Build';
  private unsubs: Array<() => void> = [];
  private ghost: pc.Entity | null = null;
  private fwd = new pc.Vec3();

  constructor(
    private bus: EventBus,
    private player: Player,
    private equipment: EquipmentSystem,
    private net: NetworkClient,
    private world: World,
    sceneRoot: pc.Entity,
  ) {
    this.ghost = makeBox({ color: '#9fc2ff', scale: [GAME.walls.WIDTH, 1.3, GAME.walls.THICK], position: [0, 0.65, 0], emissive: 0.8 });
    this.ghost.enabled = false;
    sceneRoot.addChild(this.ghost);
    this.unsubs.push(
      bus.on('input:place', () => this.place()),
      bus.on('net:structureAdded', ({ structure }) => this.world.addWall(structure)),
      bus.on('net:structureHp', ({ id, hp }) => this.world.setWallHp(id, hp)),
      bus.on('net:structureRemoved', ({ id }) => this.world.removeWall(id)),
      bus.on('net:objectRespawned', ({ objectId }) => this.world.respawnObject(objectId)),
    );
  }

  private hasWall(): boolean {
    const item = this.equipment.equippedItem();
    return !!item && item in WALL_HP;
  }

  /** Ponto e rotação onde a parede iria: à frente do jogador, perpendicular ao olhar. */
  private spot(): { x: number; z: number; yaw: number } {
    this.player.forward(this.fwd);
    const p = this.player.position;
    const d = GAME.walls.PLACE_DIST - 1;
    const yaw = Math.atan2(this.fwd.x, this.fwd.z) * pc.math.RAD_TO_DEG;
    return { x: p.x + this.fwd.x * d, z: p.z + this.fwd.z * d, yaw };
  }

  private place(): void {
    if (!this.hasWall()) {
      this.bus.emit('ui:toast', { text: 'Equipe uma parede (compre no vendedor) e aperte B' });
      return;
    }
    const s = this.spot();
    this.net.send({ type: 'place_wall', x: s.x, z: s.z, yaw: s.yaw });
  }

  update(): void {
    this.world.updateWalls();
    this.world.tower.update();
    if (!this.ghost) return;
    const show = this.hasWall() && !this.player.stats.dead;
    this.ghost.enabled = show;
    if (!show) return;
    const s = this.spot();
    this.ghost.setPosition(s.x, 0, s.z);
    this.ghost.setEulerAngles(0, s.yaw, 0);
  }

  dispose(): void {
    this.unsubs.forEach((u) => u());
    this.ghost?.destroy();
    this.ghost = null;
  }
}
