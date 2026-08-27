import * as pc from 'playcanvas';
import { instantiateModel, type ModelKey } from '@/Assets/ModelAssets';
import { makeGroundX } from '@/Assets/Primitives';
import { ItemDatabase } from '@/Items/ItemDatabase';
import type { ItemId } from '@/Items/Item';
import type { DroppedItem } from '@shared/protocol';

/** Modelo e escala extra de cada item quando está no chão. */
const DROP_MODEL: Record<ItemId, { key: ModelKey; scale: number; lift: number }> = {
  stick: { key: 'log_small', scale: 1, lift: 0 },
  stone: { key: 'resource_stone', scale: 1, lift: 0 },
  wood: { key: 'log', scale: 1, lift: 0 },
  bigstone: { key: 'rock_small', scale: 1, lift: 0 },
  knife: { key: 'zak_knife', scale: 1, lift: 0.15 },
  axe: { key: 'zak_axe', scale: 0.85, lift: 0.15 },
  pickaxe: { key: 'tool_pickaxe', scale: 1, lift: 0.05 },
  glock: { key: 'zak_pistol', scale: 1, lift: 0.15 },
  battery: { key: 'box', scale: 1, lift: 0 },
  wall_wood: { key: 'fence_wood', scale: 2.2, lift: 0 },
  wall_stone: { key: 'fence_stone', scale: 2.2, lift: 0 },
  wall_iron: { key: 'fence_iron', scale: 2.2, lift: 0 },
};

/** Item largado no chão: modelo do item flutuando/girando devagar, com o X de destaque. Regras no server. */
export class Drop {
  readonly kind = 'drop' as const;
  readonly id: number;
  readonly itemId: ItemId;
  readonly count: number;
  readonly entity: pc.Entity;
  readonly radius = 0.4;
  readonly solidRadius = 0;
  private model: pc.Entity;
  private highlightMark: pc.Entity;
  private highlighted = false;
  private t = Math.random() * 10;
  private lift: number;

  constructor(d: DroppedItem) {
    this.id = d.id;
    this.itemId = d.itemId;
    this.count = d.count;
    this.entity = new pc.Entity(`drop#${d.id}`);
    this.entity.setPosition(d.x, 0, d.z);
    const def = DROP_MODEL[d.itemId];
    this.lift = def.lift;
    this.model = instantiateModel(def.key);
    const s = this.model.getLocalScale().x * def.scale;
    this.model.setLocalScale(s, s, s);
    this.entity.addChild(this.model);
    this.highlightMark = makeGroundX('#ffd34d', 0.9);
    this.highlightMark.enabled = false;
    this.entity.addChild(this.highlightMark);
  }

  get position(): pc.Vec3 {
    return this.entity.getPosition();
  }

  update(dt: number): void {
    this.t += dt;
    this.model.setLocalPosition(0, this.lift + 0.05 + Math.sin(this.t * 2) * 0.04, 0);
    this.model.setLocalEulerAngles(0, this.t * 40, 0);
  }

  promptLabel(): string {
    const name = ItemDatabase.get(this.itemId).name;
    return `[E] Pegar ${name}${this.count > 1 ? ` ×${this.count}` : ''}`;
  }

  setHighlight(on: boolean): void {
    if (this.highlighted === on) return;
    this.highlighted = on;
    this.highlightMark.enabled = on;
  }

  destroy(): void {
    this.entity.destroy();
  }
}
