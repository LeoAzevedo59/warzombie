import * as pc from 'playcanvas';
import { GAME } from '@shared/gameconfig';
import { colorMaterial, makeBox } from '@/Assets/Primitives';
import { instantiateModel, type ModelKey } from '@/Assets/ModelAssets';
import type { StructureSnapshot } from '@shared/protocol';
import { CONFIG } from '@/config';

/** Modelo (Kenney Survival Kit) por tipo de parede; cada GLB tem 0,5 x 0,52 — escalado para WIDTH x altura. */
const WALL_MODEL: Record<string, { key: ModelKey; height: number; color?: string }> = {
  wall_wood: { key: 'fence_wood', height: 1.5 },
  // o kit não tem cerca de pedra: a reforçada (madeira) recebe um material cinza-pedra chapado
  wall_stone: { key: 'fence_stone', height: 1.6, color: '#8e959c' },
  wall_iron: { key: 'fence_iron', height: 1.7 },
};

/** AABB (no espaço local do modelo já escalado, antes de entrar na cena) de todos os meshes. */
function modelBounds(model: pc.Entity): pc.BoundingBox | null {
  let out: pc.BoundingBox | null = null;
  for (const r of model.findComponents('render') as pc.RenderComponent[]) {
    for (const mi of r.meshInstances) {
      const b = mi.aabb;
      if (!out) out = new pc.BoundingBox(b.center.clone(), b.halfExtents.clone());
      else out.add(b);
    }
  }
  return out;
}

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
    if (def.color) {
      const mat = colorMaterial(def.color);
      for (const r of model.findComponents('render') as pc.RenderComponent[]) r.meshInstances.forEach((mi) => (mi.material = mat));
    }
    // GLB: 0,5 de largura, 0,52 de altura, ~0,05 de espessura
    model.setLocalScale(GAME.walls.WIDTH / 0.5, h / 0.52, GAME.walls.THICK / 0.05);
    // a origem do GLB fica num canto: centraliza pela AABB real para a parede nascer onde o fantasma mostrou
    const box = modelBounds(model);
    if (box) model.setLocalPosition(-box.center.x, -(box.center.y - box.halfExtents.y), -box.center.z);
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
