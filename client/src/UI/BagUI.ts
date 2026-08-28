import type { EventBus } from '@/Core/EventBus';
import type { GameState } from '@/Core/GameState';
import type { NetworkClient } from '@/Net/NetworkClient';
import type { ItemStack } from '@/Items/Item';
import { ItemDatabase } from '@/Items/ItemDatabase';
import { iconHtml, itemIconHtml } from './ItemIcon';
import { GAME } from '@shared/gameconfig';
import { canBag } from '@shared/items';

/**
 * Painel da mochila (tecla I): hotbar em cima, slots da mochila embaixo; clicar numa pilha manda
 * `bag_move` para o outro container. O que está na mochila pesa WEIGHT_FACTOR do normal. Regras no server.
 */
export class BagUI {
  private panel: HTMLElement;
  private unsubs: Array<() => void> = [];
  private _open = false;
  onOpenChanged: ((open: boolean) => void) | null = null;

  constructor(
    parent: HTMLElement,
    bus: EventBus,
    private state: GameState,
    private net: NetworkClient,
  ) {
    this.panel = document.createElement('div');
    this.panel.className = 'inventory-panel shop-panel bag-panel';
    parent.appendChild(this.panel);
    this.unsubs.push(
      bus.on('input:toggleBag', () => this.setOpen(!this._open)),
      bus.on('input:closePanel', () => this.setOpen(false)),
      bus.on('inventory:changed', () => this.renderIfOpen()),
      bus.on('net:bag', () => this.renderIfOpen()),
      bus.on('net:upgrades', () => this.renderIfOpen()),
      bus.on('player:died', () => this.setOpen(false)),
      bus.on('player:eliminated', () => this.setOpen(false)),
    );
  }

  get open(): boolean {
    return this._open;
  }

  private setOpen(open: boolean): void {
    if (this._open === open) return;
    this._open = open;
    this.panel.classList.toggle('visible', open);
    this.panel.parentElement?.classList.toggle('shop-open', open); // esconde o prompt de interação
    this.onOpenChanged?.(open);
    if (open) this.render();
  }

  private renderIfOpen(): void {
    if (this._open) this.render();
  }

  private slotHtml(s: ItemStack | null, from: 'hotbar' | 'bag', i: number, locked = false): string {
    const number = from === 'hotbar' ? `<span class="slot-number">${i + 1}</span>` : '';
    if (!s) return `<div class="slot${locked ? ' locked' : ''}">${number}</div>`;
    const def = ItemDatabase.get(s.itemId);
    const movable = from === 'bag' || canBag(s.itemId);
    const title = movable ? (from === 'hotbar' ? `${def.name} · clique para guardar na mochila` : `${def.name} · clique para levar à hotbar`) : `${def.name} fica na mão (não cabe na mochila)`;
    return `<div class="slot${movable ? ' filled' : ''}" data-from="${from}" data-index="${i}" title="${title}">${number}${itemIconHtml(s.itemId, 24, 'icon')}<span class="name">${def.name}</span><span class="count">${s.count > 1 ? s.count : ''}</span></div>`;
  }

  private render(): void {
    const b = GAME.backpack;
    const has = this.state.hasBackpack;
    const w = this.state.carriedWeight;
    const max = this.state.maxWeight;
    const heavy = w / max >= 0.8;
    const bagSlots = has ? this.state.bag : Array.from({ length: b.SLOTS }, () => null);
    this.panel.innerHTML = `
      <button class="close" title="Fechar (Esc / I)">✕</button>
      <h2>${iconHtml('backpack', '#c98a4b', 22, 'shop-icon')}Mochila <span class="weight-line${heavy ? ' heavy' : ''}">· Peso: <b>${w}/${max}</b></span></h2>
      <h3>Hotbar <span class="lvl">peso cheio</span></h3>
      <div class="slots">${this.state.inventory.map((s, i) => this.slotHtml(s, 'hotbar', i)).join('')}</div>
      <h3>Mochila <span class="lvl">${has ? `itens aqui pesam ${Math.round(b.WEIGHT_FACTOR * 100)}% · +${b.EXTRA_CAPACITY} de capacidade` : `compre no vendedor por $${b.PRICE}`}</span></h3>
      <div class="slots">${bagSlots.map((s, i) => this.slotHtml(s, 'bag', i, !has)).join('')}</div>
      <p class="hint">${has ? 'Clique numa pilha para movê-la para o outro lado. A bateria não entra na mochila; itens na mochila não ficam na mão.' : 'A mochila abre esses slots extras, deixa o que está nela mais leve e aumenta sua capacidade de peso.'}</p>`;
    this.panel.querySelector<HTMLButtonElement>('.close')!.onclick = () => this.setOpen(false);
    this.panel.querySelectorAll<HTMLElement>('.slot.filled').forEach((el) => {
      el.onclick = () => {
        if (!has) return;
        this.net.send({ type: 'bag_move', from: el.dataset.from as 'hotbar' | 'bag', index: Number(el.dataset.index) });
      };
    });
  }

  dispose(): void {
    this.unsubs.forEach((u) => u());
    this.panel.remove();
  }
}
