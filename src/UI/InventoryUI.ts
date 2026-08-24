import { CONFIG } from '@/config';
import type { EventBus } from '@/Core/EventBus';
import type { ItemStack } from '@/Items/Item';
import { ItemDatabase } from '@/Items/ItemDatabase';
import { allRecipes } from '@/Items/Recipes';
import type { CraftingSystem } from '@/Systems/CraftingSystem';

/** Hotbar sempre visível + painel de inventário/craft (Tab). */
export class InventoryUI {
  private hotbar: HTMLElement;
  private panel: HTMLElement;
  private grid: HTMLElement;
  private recipes: HTMLElement;
  private prompt: HTMLElement;
  private stacks: ReadonlyArray<ItemStack | null> = [];
  private equippedSlot = 0;
  private unsubs: Array<() => void> = [];
  private _open = false;

  onOpenChanged: ((open: boolean) => void) | null = null;

  constructor(
    parent: HTMLElement,
    private bus: EventBus,
    private crafting: CraftingSystem,
  ) {
    this.hotbar = document.createElement('div');
    this.hotbar.className = 'hotbar';
    this.hotbar.onclick = (e) => {
      const slot = (e.target as HTMLElement).closest<HTMLElement>('.slot');
      const index = slot ? Number(slot.dataset.index) : NaN;
      if (!Number.isNaN(index)) this.bus.emit('input:selectSlot', { index });
    };
    parent.appendChild(this.hotbar);

    this.prompt = document.createElement('div');
    this.prompt.className = 'prompt';
    parent.appendChild(this.prompt);

    this.panel = document.createElement('div');
    this.panel.className = 'inventory-panel';
    this.panel.innerHTML = `<button class="close" title="Fechar (Esc)">✕</button><h2>Inventário</h2><div class="grid"></div><h2>Craft</h2><div class="recipes"></div>`;
    parent.appendChild(this.panel);
    this.panel.querySelector<HTMLButtonElement>('.close')!.onclick = () => this.toggle();
    this.grid = this.panel.querySelector('.grid')!;
    this.recipes = this.panel.querySelector('.recipes')!;

    this.unsubs.push(
      bus.on('inventory:changed', ({ stacks }) => {
        this.stacks = stacks;
        this.render();
      }),
      bus.on('input:toggleInventory', () => this.toggle()),
      bus.on('input:closePanel', () => {
        if (this._open) this.toggle();
      }),
      bus.on('workbench:interact', () => {
        if (this._open) this.toggle(); // evita sobrepor com o painel da mesa de marceneiro
      }),
      bus.on('interaction:targetChanged', ({ label }) => {
        this.prompt.textContent = label ?? '';
        this.prompt.classList.toggle('visible', !!label);
      }),
      bus.on('craft:jobStarted', () => this.renderIfOpen()),
      // progresso roda todo frame: patch pontual na linha ativa, nunca rebuild do painel
      bus.on('craft:jobProgress', ({ recipeId, remaining, total }) => this.patchProgress(recipeId, remaining, total)),
      bus.on('craft:jobComplete', () => this.renderIfOpen()),
      bus.on('equip:changed', ({ slotIndex }) => {
        this.equippedSlot = slotIndex;
        this.render();
      }),
    );
    this.render();
  }

  get open() {
    return this._open;
  }

  private renderIfOpen(): void {
    if (this._open) this.render();
  }

  /** Atualiza só o texto/barra da receita ativa (chamado a cada frame durante um craft). */
  private patchProgress(recipeId: string, remaining: number, total: number): void {
    if (!this._open) return;
    const row = this.recipes.querySelector<HTMLElement>(`[data-recipe-id="${recipeId}"]`);
    if (!row) {
      this.render(); // primeira vez que o painel vê este job: monta a linha em modo ativo
      return;
    }
    const secs = row.querySelector<HTMLElement>('.craft-secs');
    if (secs) secs.textContent = `${Math.ceil(remaining)}s`;
    const fill = row.querySelector<HTMLElement>('.progress-fill');
    if (fill) fill.style.width = `${((total - remaining) / total) * 100}%`;
  }

  toggle(): void {
    this._open = !this._open;
    this.panel.classList.toggle('visible', this._open);
    this.onOpenChanged?.(this._open);
    if (this._open) this.render();
  }

  private slotHtml(s: ItemStack | null, hotbarIndex?: number): string {
    const equipped = hotbarIndex === this.equippedSlot;
    const cls = `slot${equipped ? ' equipped' : ''}`;
    const idxAttr = hotbarIndex !== undefined ? ` data-index="${hotbarIndex}"` : '';
    const number = hotbarIndex !== undefined ? `<span class="slot-number">${hotbarIndex + 1}</span>` : '';
    if (!s) return `<div class="${cls}"${idxAttr}>${number}</div>`;
    const def = ItemDatabase.get(s.itemId);
    return `<div class="${cls}"${idxAttr} title="${def.name}">${number}<div class="icon" style="background:${def.color}"></div>${def.name}<span class="count">${s.count > 1 ? s.count : ''}</span></div>`;
  }

  private render(): void {
    const hot = this.stacks.slice(0, CONFIG.inventory.HOTBAR_SLOTS);
    this.hotbar.innerHTML = hot.map((s, i) => this.slotHtml(s, i)).join('');
    this.grid.innerHTML = this.stacks.map((s) => this.slotHtml(s)).join('');

    this.recipes.innerHTML = '';
    const activeJob = this.crafting.activeJob();
    for (const r of allRecipes()) {
      const out = ItemDatabase.get(r.output.itemId);
      const needs = r.inputs.map((i) => `${i.count}× ${ItemDatabase.get(i.itemId).name}`).join(' + ');
      const duration = r.duration ? ` (${r.duration}s)` : '';
      const active = activeJob?.recipeId === r.id;

      const row = document.createElement('div');
      row.className = 'recipe';
      row.dataset.recipeId = active ? r.id : '';
      const label = document.createElement('span');
      label.className = 'recipe-label';
      label.innerHTML = active
        ? `Criando <b>${out.name}</b>... <span class="craft-secs">${Math.ceil(activeJob.remaining)}s</span>`
        : `<b>${out.name}</b> — ${needs}${duration}`;
      row.appendChild(label);

      if (active) {
        const bar = document.createElement('div');
        bar.className = 'progress-bar visible';
        const fill = document.createElement('div');
        fill.className = 'progress-fill';
        fill.style.width = `${((activeJob.total - activeJob.remaining) / activeJob.total) * 100}%`;
        bar.appendChild(fill);
        row.appendChild(bar);
      }

      const btn = document.createElement('button');
      btn.textContent = 'Craftar';
      btn.disabled = !this.crafting.canCraft(r.id);
      btn.onclick = () => this.crafting.craft(r.id);
      row.appendChild(btn);
      this.recipes.appendChild(row);
    }
  }

  dispose(): void {
    this.unsubs.forEach((u) => u());
    this.hotbar.remove();
    this.panel.remove();
    this.prompt.remove();
    void this.bus;
  }
}
