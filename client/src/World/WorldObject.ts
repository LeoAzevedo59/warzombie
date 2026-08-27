import * as pc from 'playcanvas';
import { ItemDatabase } from '@/Items/ItemDatabase';
import { makeGroundX } from '@/Assets/Primitives';
import { instantiateModel, type ModelKey } from '@/Assets/ModelAssets';
import { WORLD_OBJECTS, type WorldObjectDef, type WorldObjectKind, type WorldObjectSpec } from '@shared/worldgen';

export type { WorldObjectKind };

/** Variantes de modelo por tipo; a escolha é determinística pelo id (client e server não precisam concordar: é só visual). */
const VARIANTS: Record<WorldObjectKind, ModelKey[]> = {
  stick: ['log_small'],
  stone: ['resource_stone'],
  tree: ['tree_default', 'tree_oak', 'tree_detailed', 'tree_pine', 'tree_pine_round', 'tree_thin'],
  rock: ['stone_tall_b', 'stone_c', 'stone_tall_g', 'stone_e', 'stone_tall_b'],
};

/** Tamanho do X de destaque no chão por tipo. */
const MARK_SIZE: Record<WorldObjectKind, number> = { stick: 0.8, stone: 0.7, tree: 1.6, rock: 2.6 };

/** Objeto interativo no mundo: coletável simples ou nó de recurso (árvore/rocha). Visual apenas — regras no server. */
export class WorldObject {
  readonly id: number;
  readonly kind: WorldObjectKind;
  readonly entity: pc.Entity;
  readonly def: WorldObjectDef;
  /** hits conhecidos (o server é a fonte; atualizado por node_hit) */
  hits = 0;
  private highlighted = false;
  private model: pc.Entity;
  private highlightMark: pc.Entity;
  /** s restantes do "tremor" de hit */
  private shakeTimer = 0;

  constructor(spec: WorldObjectSpec) {
    this.id = spec.id;
    this.kind = spec.kind;
    this.def = WORLD_OBJECTS[spec.kind];
    this.entity = new pc.Entity(`${spec.kind}#${spec.id}`);
    this.entity.setLocalPosition(spec.x, 0, spec.z);
    this.entity.setLocalEulerAngles(0, spec.rotY, 0);
    const pool = VARIANTS[spec.kind];
    this.model = instantiateModel(pool[spec.id % pool.length]);
    // pequena variação de escala para quebrar a repetição
    const s = this.model.getLocalScale().x * (0.9 + ((spec.id >>> 8) % 100) / 500);
    this.model.setLocalScale(s, s, s);
    this.entity.addChild(this.model);
    this.highlightMark = makeGroundX('#e23c3c', MARK_SIZE[spec.kind]);
    this.highlightMark.enabled = false;
    this.entity.addChild(this.highlightMark);
  }

  get position(): pc.Vec3 {
    return this.entity.getPosition();
  }

  /** Raio de interação extra para objetos grandes. */
  get radius(): number {
    return this.def.radius;
  }

  /** Raio sólido pra colisão física (0 = não bloqueia, o player anda por cima). */
  get solidRadius(): number {
    return this.def.solidRadius;
  }

  get isNode(): boolean {
    return this.def.requiredTool !== null;
  }

  /** Feedback visual de hit confirmado pelo server (encolhe um pouco e treme). */
  setHits(hits: number): void {
    this.hits = hits;
    const s = 1 - 0.08 * hits;
    this.entity.setLocalScale(s, s, s);
    this.shakeTimer = 0.25;
  }

  /** Animação do tremor (chamado pelo World a cada frame; barato: só quando shakeTimer > 0). */
  update(dt: number): void {
    if (this.shakeTimer <= 0) return;
    this.shakeTimer -= dt;
    const k = Math.max(0, this.shakeTimer) / 0.25;
    const wobble = Math.sin(this.shakeTimer * 60) * 6 * k;
    this.model.setLocalEulerAngles(wobble, 0, wobble * 0.5);
    if (this.shakeTimer <= 0) this.model.setLocalEulerAngles(0, 0, 0);
  }

  /** Texto do prompt dado o estado (tem ferramenta, canalizando hits automáticos, etc). */
  promptLabel(hasTool: boolean, channeling = false): string {
    const d = this.def;
    if (!this.isNode) return `[E] ${d.verb} ${d.name}`;
    if (!hasTool) return `Equipe ${ItemDatabase.get(d.requiredTool!).name} (1-5) para ${d.verb.toLowerCase()} ${d.name}`;
    if (channeling) return `${d.verbing} ${d.name}... (${this.hits}/${d.hitsRequired})`;
    return `[E] ${d.verb} ${d.name} (${this.hits}/${d.hitsRequired})`;
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
