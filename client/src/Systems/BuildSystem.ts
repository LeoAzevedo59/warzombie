import * as pc from 'playcanvas';
import { GAME } from '@shared/gameconfig';
import { WALL_HP } from '@shared/items';
import type { System } from '@/Core/GameLoop';
import type { EventBus } from '@/Core/EventBus';
import type { Player } from '@/Entities/Player/Player';
import type { EquipmentSystem } from './EquipmentSystem';
import type { NetworkClient } from '@/Net/NetworkClient';
import type { World } from '@/World/World';
import type { InputSystem } from './InputSystem';
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
  /** giro extra da parede (roda do mouse), em graus */
  private rotation = 0;

  constructor(
    private bus: EventBus,
    private player: Player,
    private equipment: EquipmentSystem,
    private net: NetworkClient,
    private world: World,
    sceneRoot: pc.Entity,
    private input: InputSystem,
  ) {
    this.ghost = makeBox({ color: '#9fc2ff', scale: [GAME.walls.WIDTH, 1.3, GAME.walls.THICK], position: [0, 0.65, 0], emissive: 0.8 });
    this.ghost.enabled = false;
    sceneRoot.addChild(this.ghost);
    this.unsubs.push(
      bus.on('input:place', () => this.place()),
      // com parede equipada, o clique coloca (não atira) e a roda gira
      bus.on('input:fire', () => {
        if (this.hasWall()) this.place();
      }),
      bus.on('input:wheel', ({ delta }) => {
        if (this.hasWall()) this.rotation = (this.rotation + delta * GAME.walls.ROTATE_STEP_DEG + 360) % 360;
      }),
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

  /** Ponto e rotação onde a parede iria: no cursor (até PLACE_DIST do jogador), perpendicular à linha jogador→cursor, + giro da roda. */
  private spot(): { x: number; z: number; yaw: number } {
    const p = this.player.position;
    const aim = this.input.state.aimPoint;
    let dx: number;
    let dz: number;
    if (aim) {
      dx = aim.x - p.x;
      dz = aim.z - p.z;
    } else {
      this.player.forward(this.fwd);
      dx = this.fwd.x * 2;
      dz = this.fwd.z * 2;
    }
    const dist = Math.hypot(dx, dz) || 1;
    const d = Math.min(GAME.walls.PLACE_DIST, Math.max(1, dist));
    const ux = dx / dist;
    const uz = dz / dist;
    const yaw = Math.atan2(ux, uz) * pc.math.RAD_TO_DEG + this.rotation;
    return { x: p.x + ux * d, z: p.z + uz * d, yaw };
  }

  private place(): void {
    if (!this.hasWall()) {
      this.bus.emit('ui:toast', { text: 'Equipe uma parede (compre no vendedor): clique para colocar, roda do mouse gira' });
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
