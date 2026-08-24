import type { EventBus } from '@/Core/EventBus';
import { ItemDatabase } from '@/Items/ItemDatabase';
import { REFINE_RECIPES, type RefineOutput, type RefiningSystem } from '@/Systems/RefiningSystem';
import type { InventorySystem } from '@/Systems/InventorySystem';

/** Painel de refino da mesa de marceneiro: madeira -> tábua ou graveto, com timer. */
export class WorkbenchUI {
  private panel: HTMLElement;
  private woodCountEl: HTMLElement;
  private rows: Record<RefineOutput, { btn: HTMLButtonElement; bar: HTMLElement; barFill: HTMLElement; label: HTMLElement }>;
  private unsubs: Array<() => void> = [];
  private workbenchId: number | null = null;

  onOpenChanged: ((open: boolean) => void) | null = null;

  constructor(
    parent: HTMLElement,
    private bus: EventBus,
    private inventory: InventorySystem,
    private refining: RefiningSystem,
  ) {
    this.panel = document.createElement('div');
    this.panel.className = 'inventory-panel workbench-panel';
    this.panel.innerHTML = `
      <button class="close" title="Fechar (Esc)">✕</button>
      <h2>Mesa de Marceneiro</h2>
      <div class="wood-count"></div>
      <div class="recipes">
        <div class="recipe" data-output="plank">
          <span class="recipe-label"><b>Tábua</b> — 1× Tronco de Madeira (10s)</span>
          <div class="progress-bar"><div class="progress-fill"></div></div>
          <button>Refinar</button>
        </div>
        <div class="recipe" data-output="stick">
          <span class="recipe-label"><b>Graveto</b> — 1× Tronco de Madeira (20s)</span>
          <div class="progress-bar"><div class="progress-fill"></div></div>
          <button>Refinar</button>
        </div>
      </div>`;
    parent.appendChild(this.panel);
    this.panel.querySelector<HTMLButtonElement>('.close')!.onclick = () => this.close();
    this.woodCountEl = this.panel.querySelector('.wood-count')!;

    const row = (output: RefineOutput) => {
      const el = this.panel.querySelector<HTMLElement>(`.recipe[data-output="${output}"]`)!;
      return {
        btn: el.querySelector<HTMLButtonElement>('button')!,
        bar: el.querySelector<HTMLElement>('.progress-bar')!,
        barFill: el.querySelector<HTMLElement>('.progress-fill')!,
        label: el.querySelector<HTMLElement>('.recipe-label')!,
      };
    };
    this.rows = { plank: row('plank'), stick: row('stick') };
    this.rows.plank.btn.onclick = () => this.startRefine('plank');
    this.rows.stick.btn.onclick = () => this.startRefine('stick');

    this.unsubs.push(
      bus.on('workbench:interact', ({ workbenchId }) => this.openFor(workbenchId)),
      bus.on('input:toggleInventory', () => this.close()),
      bus.on('input:closePanel', () => this.close()),
      bus.on('inventory:changed', () => this.render()),
      bus.on('workbench:jobStarted', (p) => this.onJobEvent(p.workbenchId)),
      bus.on('workbench:jobProgress', (p) => this.onJobEvent(p.workbenchId)),
      bus.on('workbench:jobComplete', (p) => this.onJobEvent(p.workbenchId)),
    );
  }

  get open(): boolean {
    return this.workbenchId !== null;
  }

  private openFor(workbenchId: number): void {
    this.workbenchId = workbenchId;
    this.panel.classList.add('visible');
    this.onOpenChanged?.(true);
    this.render();
  }

  private close(): void {
    if (this.workbenchId === null) return;
    this.workbenchId = null;
    this.panel.classList.remove('visible');
    this.onOpenChanged?.(false);
  }

  private startRefine(output: RefineOutput): void {
    if (this.workbenchId === null) return;
    this.refining.start(this.workbenchId, output);
    this.render();
  }

  private onJobEvent(workbenchId: number): void {
    if (workbenchId === this.workbenchId) this.render();
  }

  private render(): void {
    if (this.workbenchId === null) return;
    this.woodCountEl.textContent = `Tronco de Madeira: ${this.inventory.count('wood')}`;

    for (const output of Object.keys(this.rows) as RefineOutput[]) {
      const { btn, bar, barFill, label } = this.rows[output];
      const recipe = REFINE_RECIPES[output];
      const job = this.refining.jobFor(this.workbenchId);
      const active = job !== undefined && job.output === output;

      bar.classList.toggle('visible', active);
      if (active) {
        const pct = ((job.total - job.remaining) / job.total) * 100;
        barFill.style.width = `${pct}%`;
        label.textContent = `Refinando ${ItemDatabase.get(recipe.output).name}... ${Math.ceil(job.remaining)}s`;
        btn.disabled = true;
      } else {
        label.innerHTML = `<b>${ItemDatabase.get(recipe.output).name}</b> — ${recipe.cost.count}× Tronco de Madeira (${recipe.duration}s)`;
        btn.disabled = !this.refining.canStart(this.workbenchId, output);
      }
    }
  }

  dispose(): void {
    this.unsubs.forEach((u) => u());
    this.panel.remove();
    void this.bus;
  }
}
