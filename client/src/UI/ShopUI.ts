import type { EventBus } from '@/Core/EventBus';
import type { GameState } from '@/Core/GameState';
import { ItemDatabase } from '@/Items/ItemDatabase';
import type { NetworkClient } from '@/Net/NetworkClient';
import { accuracyPercent, damageMultiplier, isMaxed, magSize, staminaMultiplier } from '@shared/upgrades';
import type { UpgradeKind } from '@shared/protocol';
import { GAME } from '@shared/gameconfig';

/** Painel do vendedor: vender todos os recursos da hotbar e comprar ferramentas/armas. Regras no server. */
export class ShopUI {
  private panel: HTMLElement;
  private unsubs: Array<() => void> = [];
  private _open = false;
  private tab: 'items' | 'upgrades' = 'items';
  onOpenChanged: ((open: boolean) => void) | null = null;

  constructor(
    parent: HTMLElement,
    bus: EventBus,
    private state: GameState,
    private net: NetworkClient,
  ) {
    this.panel = document.createElement('div');
    this.panel.className = 'inventory-panel shop-panel';
    parent.appendChild(this.panel);
    this.unsubs.push(
      bus.on('shop:open', () => this.setOpen(true)),
      bus.on('input:closePanel', () => this.setOpen(false)),
      bus.on('inventory:changed', () => this.renderIfOpen()),
      bus.on('net:money', () => this.renderIfOpen()),
      bus.on('net:upgrades', () => this.renderIfOpen()),
      bus.on('net:upgradePrices', () => this.renderIfOpen()),
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

  private sellTotal(): number {
    return this.state.inventory.reduce((n, s) => n + (s ? (ItemDatabase.get(s.itemId).sell ?? 0) * s.count : 0), 0);
  }

  private render(): void {
    const total = this.sellTotal();
    const money = this.state.money;
    const items = `
      <div class="recipe sell-row">
        <span class="recipe-label">Vender todos os recursos da hotbar</span>
        <button class="sell" ${total > 0 ? '' : 'disabled'}>+$${total}</button>
      </div>
      <div class="recipes">${ItemDatabase.shop()
        .map(
          (d) => `<div class="recipe"><span class="recipe-label"><span class="toast-icon" style="background:${d.color};display:inline-block;vertical-align:middle;margin-right:6px"></span><b>${d.name}</b></span><button class="buy" data-id="${d.id}" ${money >= (d.buy ?? 0) ? '' : 'disabled'}>$${d.buy}</button></div>`,
        )
        .join('')}</div>`;
    const upgrades = `
      <div class="recipes">${this.upgradeRows(money)}</div>`;
    this.panel.innerHTML = `
      <button class="close" title="Fechar (Esc)">✕</button>
      <h2>Vendedor <span class="money-line">· Dinheiro: <b>$${money}</b></span></h2>
      <div class="tabs">
        <button class="tab ${this.tab === 'items' ? 'active' : ''}" data-tab="items">ITENS</button>
        <button class="tab ${this.tab === 'upgrades' ? 'active' : ''}" data-tab="upgrades">UPGRADES</button>
      </div>
      <div class="tab-body">${this.tab === 'items' ? items : upgrades}</div>`;
    this.panel.querySelector<HTMLButtonElement>('.close')!.onclick = () => this.setOpen(false);
    this.panel.querySelectorAll<HTMLButtonElement>('.tab').forEach((b) => {
      b.onclick = () => {
        this.tab = b.dataset.tab as 'items' | 'upgrades';
        this.render();
      };
    });
    const sell = this.panel.querySelector<HTMLButtonElement>('.sell');
    if (sell) sell.onclick = () => this.net.send({ type: 'sell' });
    this.panel.querySelectorAll<HTMLButtonElement>('.buy').forEach((b) => {
      b.onclick = () => this.net.send({ type: 'buy', itemId: b.dataset.id as 'axe' });
    });
    this.panel.querySelectorAll<HTMLButtonElement>('.upgrade').forEach((b) => {
      b.onclick = () => this.net.send({ type: 'upgrade', kind: b.dataset.kind as UpgradeKind });
    });
  }

  private upgradeRows(money: number): string {
    const u = this.state.upgrades;
    const rows: Array<[UpgradeKind, string, string]> = [
      ['damage', 'Dano', `+${Math.round((damageMultiplier(u) - 1) * 100)}%`],
      ['ammo', 'Munição', `pente ${magSize(u)}`],
      ['recoil', 'Recoil', `precisão ${accuracyPercent(u)}%`],
      ['stamina', 'Vigor de corrida', `+${Math.round((staminaMultiplier(u) - 1) * 100)}%`],
      ['laser', 'Mira laser', u.laser ? 'ativa' : 'mostra a linha de tiro'],
    ];
    return rows
      .map(([kind, name, effect]) => {
        const price = this.state.upgradePrices[kind];
        const btn = isMaxed(kind, u[kind]) ? '<button disabled>MAX</button>' : `<button class="upgrade" data-kind="${kind}" ${money >= price ? '' : 'disabled'}>$${price}</button>`;
        const lvl = GAME.upgrades[kind].MAX_LEVEL > 1 ? `<span class="lvl">Lv ${u[kind]}/${GAME.upgrades[kind].MAX_LEVEL}</span> · ` : '';
        return `<div class="recipe"><span class="recipe-label"><b>${name}</b> ${lvl}${effect}</span>${btn}</div>`;
      })
      .join('');
  }

  dispose(): void {
    this.unsubs.forEach((u) => u());
    this.panel.remove();
  }
}
