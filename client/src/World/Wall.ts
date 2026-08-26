import * as pc from 'playcanvas';
import { GAME } from '@shared/gameconfig';
import { ITEMS } from '@shared/items';
import { makeBox } from '@/Assets/Primitives';
import type { StructureSnapshot } from '@shared/protocol';
import { CONFIG } from '@/config';

/** Parede colocada por um jogador: bloco sólido com barra de vida. */
export class Wall {
  readonly entity: pc.Entity;
  readonly id: number;
  readonly solidRadius = GAME.walls.WIDTH / 2;
  private hpFill: pc.Entity;
  private hpBar: pc.Entity;
  maxHp: number;

  constructor(s: StructureSnapshot) {
    this.id = s.id;
    this.maxHp = s.maxHp;
    this.entity = new pc.Entity(`wall#${s.id}`);
    this.entity.setPosition(s.x, 0, s.z);
    this.entity.setEulerAngles(0, s.yaw, 0);
    const color = ITEMS[s.kind].color;
    const h = s.kind === 'wall_iron' ? 1.6 : 1.3;
    this.entity.addChild(makeBox({ color, scale: [GAME.walls.WIDTH, h, GAME.walls.THICK], position: [0, h / 2, 0] }));
    // postes nas pontas
    for (const dx of [-GAME.walls.WIDTH / 2, GAME.walls.WIDTH / 2]) {
      this.entity.addChild(makeBox({ color: '#3a2a18', scale: [0.16, h + 0.2, 0.5], position: [dx, (h + 0.2) / 2, 0] }));
    }
    this.hpBar = new pc.Entity('hpbar');
    this.hpBar.setLocalPosition(0, h + 0.35, 0);
    this.hpBar.addChild(makeBox({ color: '#111', scale: [1.2, 0.08, 0.08], emissive: 0.6 }));
    this.hpFill = makeBox({ color: '#9fc2ff', scale: [1.16, 0.06, 0.1], emissive: 1 });
    this.hpBar.addChild(this.hpFill);
    this.entity.addChild(this.hpBar);
    this.setHp(s.hp);
  }

  get position(): pc.Vec3 {
    return this.entity.getPosition();
  }

  setHp(hp: number): void {
    const ratio = Math.max(0, hp / this.maxHp);
    this.hpFill.setLocalScale(1.16 * ratio, 0.06, 0.1);
    this.hpFill.setLocalPosition(-0.58 * (1 - ratio), 0, 0);
    this.hpBar.enabled = ratio < 1;
  }

  update(): void {
    this.hpBar.setEulerAngles(0, CONFIG.camera.YAW, 0);
  }

  destroy(): void {
    this.entity.destroy();
  }
}
