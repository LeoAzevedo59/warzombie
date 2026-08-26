import type { System } from '@/Core/GameLoop';
import type { EventBus } from '@/Core/EventBus';
import { RECIPES, type RecipeId } from '@/Items/Recipes';
import type { InventorySystem } from './InventorySystem';

interface CraftJob {
  recipeId: RecipeId;
  remaining: number;
  total: number;
}

/**
 * Valida e executa receitas contra o inventário. Receitas com `duration` (ex.: machado,
 * picareta) só entregam o item após o tempo passar; só um craft roda por vez.
 */
export class CraftingSystem implements System {
  readonly name = 'Crafting';
  private job: CraftJob | null = null;

  constructor(
    private bus: EventBus,
    private inventory: InventorySystem,
  ) {}

  update(dt: number): void {
    const job = this.job;
    if (!job) return;
    job.remaining -= dt;
    if (job.remaining <= 0) {
      this.job = null;
      this.finish(job.recipeId);
      return;
    }
    this.bus.emit('craft:jobProgress', { recipeId: job.recipeId, remaining: job.remaining, total: job.total });
  }

  activeJob(): Readonly<CraftJob> | null {
    return this.job;
  }

  canCraft(id: RecipeId): boolean {
    if (this.job) return false; // só um craft por vez
    return RECIPES[id].inputs.every((i) => this.inventory.has(i.itemId, i.count));
  }

  craft(id: RecipeId): boolean {
    if (!this.canCraft(id)) return false;
    const r = RECIPES[id];
    for (const i of r.inputs) this.inventory.remove(i.itemId, i.count);

    const duration = r.duration ?? 0;
    if (duration <= 0) {
      this.finish(id);
      return true;
    }
    this.job = { recipeId: id, remaining: duration, total: duration };
    this.bus.emit('craft:jobStarted', { recipeId: id, duration });
    return true;
  }

  private finish(id: RecipeId): void {
    const r = RECIPES[id];
    const leftover = this.inventory.add(r.output.itemId, r.output.count);
    if (leftover > 0) {
      // sem espaço: devolve ingredientes e avisa; jobComplete SEMPRE sai pra UI não ficar presa
      for (const i of r.inputs) this.inventory.add(i.itemId, i.count);
      this.inventory.notify(); // garante re-render mesmo se nada coube de volta
      this.bus.emit('ui:toast', { text: 'Inventário cheio — craft cancelado, ingredientes devolvidos' });
      this.bus.emit('craft:jobComplete', { recipeId: id });
      return;
    }
    this.bus.emit('item:crafted', { itemId: r.output.itemId });
    this.bus.emit('craft:jobComplete', { recipeId: id });
  }
}
