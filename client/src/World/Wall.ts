import * as pc from 'playcanvas';
import { GAME } from '@shared/gameconfig';
import { makeBox } from '@/Assets/Primitives';
import { instantiateModel, type ModelKey } from '@/Assets/ModelAssets';
import type { StructureSnapshot } from '@shared/protocol';
import { CONFIG } from '@/config';

/** Modelo (Kenney Survival Kit) por tipo de parede; cada GLB tem 0,5 x 0,52 — escalado para WIDTH x altura. */
const WALL_MODEL: Record<string, { key: ModelKey; height: number }> = {
  wall_wood: { key: 'fence_wood', height: 1.5 },
  wall_stone: { key: 'fence_stone', height: 1.6 },
  wall_iron: { key: 'fence_iron', height: 1.7 },
};

/** Parede colocada por um jogador: cerca sólida com barra de vida. */
export class Wall {
  readonly entity: pc.Entity;
  readonly id: number;
  /** raio grosseiro (usado pelo server/zumbis); o player colide com a cápsula (ver `segment`) */
  readonly solidRadius = GAME.walls.WIDTH / 2;
  /** colisão precisa: segmento de meia-largura WIDTH/2 com raio THICK/2, na direção `yaw` */
  readonly segment: { yaw: number; halfLen: number; radius: number };
  private hpFill: pc.Entity;
  private hpBar: pc.Entity;
  maxHp: number;

  constructor(s: StructureSnapshot) {
    this.id = s.id;
    this.maxHp = s.maxHp;
    this.entity = new pc.Entity(`wall#${s.id}`);
    this.entity.setPosition(s.x, 0, s.z);
    this.entity.setEulerAngles(0, s.yaw, 0);
    this.segment = { yaw: s.yaw, halfLen: GAME.walls.WIDTH / 2, radius: GAME.walls.THICK / 2 + 0.05 };
    const def = WALL_MODEL[s.kind] ?? WALL_MODEL.wall_wood;
    const h = def.height;
    const model = instantiateModel(def.key);
    // GLB: 0,5 de largura, 0,52 de altura, ~0,05 de espessura
    model.setLocalScale(GAME.walls.WIDTH / 0.5, h / 0.52, GAME.walls.THICK / 0.05);
    this.entity.addChild(model);
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
