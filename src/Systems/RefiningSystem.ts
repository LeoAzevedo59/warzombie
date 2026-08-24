import type { System } from '@/Core/GameLoop';
import type { EventBus } from '@/Core/EventBus';
import type { ItemId } from '@/Items/Item';
import type { InventorySystem } from './InventorySystem';

export type RefineOutput = 'plank' | 'stick';

interface RefineRecipe {
  output: ItemId;
  outputCount: number;
  duration: number; // segundos
  cost: { itemId: ItemId; count: number };
}

/** Receitas de refino na mesa de marceneiro: madeira -> tábua ou graveto. */
export const REFINE_RECIPES: Record<RefineOutput, RefineRecipe> = {
  plank: { output: 'plank', outputCount: 2, duration: 10, cost: { itemId: 'wood', count: 1 } },
  stick: { output: 'stick', outputCount: 4, duration: 20, cost: { itemId: 'wood', count: 1 } },
};

interface RefineJob {
  output: RefineOutput;
  remaining: number;
  total: number;
}

/** Processa um job de refino por vez em cada mesa de marceneiro (por id). */
export class RefiningSystem implements System {
  readonly name = 'Refining';
  private jobs = new Map<number, RefineJob>();

  constructor(
    private bus: EventBus,
    private inventory: InventorySystem,
  ) {}

  update(dt: number): void {
    for (const [workbenchId, job] of this.jobs) {
      job.remaining -= dt;
      if (job.remaining <= 0) {
        this.complete(workbenchId, job);
        continue;
      }
      this.bus.emit('workbench:jobProgress', { workbenchId, remaining: job.remaining, total: job.total });
    }
  }

  private complete(workbenchId: number, job: RefineJob): void {
    this.jobs.delete(workbenchId);
    const recipe = REFINE_RECIPES[job.output];
    const leftover = this.inventory.add(recipe.output, recipe.outputCount);
    const gained = recipe.outputCount - Math.max(0, leftover);
    if (gained > 0) this.bus.emit('item:collected', { itemId: recipe.output, count: gained });
    this.bus.emit('workbench:jobComplete', { workbenchId, output: recipe.output });
  }

  jobFor(workbenchId: number): Readonly<RefineJob> | undefined {
    return this.jobs.get(workbenchId);
  }

  canStart(workbenchId: number, output: RefineOutput): boolean {
    if (this.jobs.has(workbenchId)) return false;
    const cost = REFINE_RECIPES[output].cost;
    return this.inventory.has(cost.itemId, cost.count);
  }

  start(workbenchId: number, output: RefineOutput): boolean {
    if (!this.canStart(workbenchId, output)) return false;
    const recipe = REFINE_RECIPES[output];
    this.inventory.remove(recipe.cost.itemId, recipe.cost.count);
    this.jobs.set(workbenchId, { output, remaining: recipe.duration, total: recipe.duration });
    this.bus.emit('workbench:jobStarted', { workbenchId, output: recipe.output, duration: recipe.duration });
    return true;
  }
}
