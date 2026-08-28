import type { EventBus } from '@/Core/EventBus';
import type { GameState } from '@/Core/GameState';
import { ItemDatabase } from '@/Items/ItemDatabase';
import { iconHtml, itemIconHtml } from './ItemIcon';
import type { NetworkClient } from '@/Net/NetworkClient';
import { accuracyPercent, damageMultiplier, isMaxed, magSize, maxWeight, staminaMultiplier } from '@shared/upgrades';
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
    private bus: EventBus,
    private state: GameState,
    private net: NetworkClient,
    /** nome de qualquer jogador da partida (medalha lista os eliminados) */
    private nameOf: (id: string) => string = (id) => id,
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
      bus.on('net:features', () => this.renderIfOpen()),
      bus.on('net:batteryPrice', () => this.renderIfOpen()),
      bus.on('net:revivePrice', () => this.renderIfOpen()),
      bus.on('net:eliminatedChanged', () => this.renderIfOpen()),
      bus.on('net:medals', () => this.renderIfOpen()),
      bus.on('net:bag', () => this.renderIfOpen()),
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
    return [...this.state.inventory, ...this.state.bag].reduce((n, s) => n + (s ? (ItemDatabase.get(s.itemId).sell ?? 0) * s.count : 0), 0);
  }

  private render(): void {
    // re-render preserva a rolagem da aba (comprar não pode voltar ao topo)
    const prevScroll = this.panel.querySelector<HTMLElement>('.tab-body')?.scrollTop ?? 0;
    const total = this.sellTotal();
    const money = this.state.money;
    const items = `
      <div class="recipe sell-row">
        <span class="recipe-label">Vender todos os recursos${this.state.hasBackpack ? ' (hotbar e mochila)' : ' da hotbar'}</span>
        <button class="sell" ${total > 0 ? '' : 'disabled'}>+$${total}</button>
      </div>
      <div class="recipes">${ItemDatabase.shop()
        .map((d) => {
          // bateria: preço da sala, sobe a cada compra (uma por wave)
          const price = d.id === 'battery' ? this.state.batteryPrice : (d.buy ?? 0);
          const note = d.id === 'battery' ? ` <span class="lvl">1 por wave · sobe a cada compra</span>` : d.heal ? ` <span class="lvl">+${d.heal} de vida · clique para usar</span>` : '';
          return `<div class="recipe"><span class="recipe-label">${itemIconHtml(d.id, 22, 'shop-icon')}<b>${d.name}</b>${note}</span><button class="buy" data-id="${d.id}" ${money >= price ? '' : 'disabled'}>$${price}</button></div>`;
        })
        .join('')}
        ${this.backpackRow(money)}
        ${this.reviveRows(money)}
        <div class="recipe feature"><span class="recipe-label">${iconHtml('minimap', '#4db8ff', 22, 'shop-icon')}<b>Minimapa</b> <span class="lvl">para a sala toda</span></span>${this.state.features.minimap ? '<button disabled>ATIVO</button>' : `<button class="buy-feature" data-feature="minimap" ${money >= GAME.features.MINIMAP_PRICE ? '' : 'disabled'}>$${GAME.features.MINIMAP_PRICE}</button>`}</div>
      </div>`;
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
    const body = this.panel.querySelector<HTMLElement>('.tab-body');
    if (body) body.scrollTop = prevScroll;
    this.panel.querySelector<HTMLButtonElement>('.close')!.onclick = () => this.setOpen(false);
    this.panel.querySelectorAll<HTMLButtonElement>('.tab').forEach((b) => {
      b.onclick = () => {
        this.tab = b.dataset.tab as 'items' | 'upgrades';
        this.render();
        const tb = this.panel.querySelector<HTMLElement>('.tab-body');
        if (tb) tb.scrollTop = 0;
      };
    });
    const sell = this.panel.querySelector<HTMLButtonElement>('.sell');
    if (sell)
      sell.onclick = () => {
        this.net.send({ type: 'sell' });
        this.bus.emit('shop:transaction', { kind: 'sell' });
      };
    this.panel.querySelectorAll<HTMLButtonElement>('.buy').forEach((b) => {
      b.onclick = () => {
        this.net.send({ type: 'buy', itemId: b.dataset.id as 'axe' });
        this.bus.emit('shop:transaction', { kind: 'buy' });
      };
    });
    this.panel.querySelectorAll<HTMLButtonElement>('.buy-medal').forEach((b) => {
      b.onclick = () => {
        this.net.send({ type: 'buy_medal' });
        this.bus.emit('shop:transaction', { kind: 'buy' });
      };
    });
    this.panel.querySelectorAll<HTMLButtonElement>('.use-medal').forEach((b) => {
      b.onclick = () => this.net.send({ type: 'use_medal', targetId: b.dataset.target! });
    });
    this.panel.querySelectorAll<HTMLButtonElement>('.buy-backpack').forEach((b) => {
      b.onclick = () => {
        this.net.send({ type: 'buy_backpack' });
        this.bus.emit('shop:transaction', { kind: 'buy' });
      };
    });
    this.panel.querySelectorAll<HTMLButtonElement>('.buy-feature').forEach((b) => {
      b.onclick = () => this.net.send({ type: 'buy_feature', feature: 'minimap' });
    });
    this.panel.querySelectorAll<HTMLButtonElement>('.upgrade').forEach((b) => {
      b.onclick = () => {
        this.net.send({ type: 'upgrade', kind: b.dataset.kind as UpgradeKind });
        this.bus.emit('shop:transaction', { kind: 'upgrade' });
      };
    });
  }

  /** Mochila: compra única por jogador (slots extras com I, itens nela pesam metade, +capacidade). */
  private backpackRow(money: number): string {
    const b = GAME.backpack;
    const label = `${iconHtml('backpack', '#c98a4b', 22, 'shop-icon')}<b>Mochila</b> <span class="lvl">+${b.SLOTS} slots (tecla I) · itens nela pesam ${Math.round(b.WEIGHT_FACTOR * 100)}% · +${b.EXTRA_CAPACITY} de capacidade</span>`;
    const btn = this.state.hasBackpack ? '<button disabled>ATIVA</button>' : `<button class="buy-backpack" ${money >= b.PRICE ? '' : 'disabled'}>$${b.PRICE}</button>`;
    return `<div class="recipe feature"><span class="recipe-label">${label}</span>${btn}</div>`;
  }

  /**
   * Medalha de Ressurreição: compra quantas quiser (ficam com você, sem ocupar slot; preço da sala
   * sobe a cada compra). Usa em um aliado eliminado daqui, ou em si mesmo na tela de eliminado.
   */
  private reviveRows(money: number): string {
    const price = this.state.revivePrice;
    const mine = this.state.medals;
    const label = `<span class="medal">🎖</span><b>Medalha de Ressurreição</b>`;
    const buyRow = `<div class="recipe feature revive"><span class="recipe-label">${label} <span class="lvl">você tem <b>${mine}</b> · revive um eliminado (ou você mesmo, sem vidas)</span></span><button class="buy-medal" ${money >= price ? '' : 'disabled'}>$${price}</button></div>`;
    const targets = [...this.state.eliminated].filter((id) => id !== this.state.playerId);
    const useRows = targets
      .map((id) => `<div class="recipe feature revive"><span class="recipe-label"><span class="medal">🎖</span>Reviver <b>${this.nameOf(id)}</b> <span class="lvl">usa 1 medalha</span></span><button class="use-medal" data-target="${id}" ${mine > 0 ? '' : 'disabled'}>USAR</button></div>`)
      .join('');
    return buyRow + useRows;
  }

  private upgradeRows(money: number): string {
    const u = this.state.upgrades;
    const rows: Array<[UpgradeKind, string, string]> = [
      ['damage', 'Dano', `+${Math.round((damageMultiplier(u) - 1) * 100)}%`],
      ['ammo', 'Munição', `pente ${magSize(u)}`],
      ['recoil', 'Recoil', `precisão ${accuracyPercent(u, 'idle')}% parado · ${accuracyPercent(u, 'walk')}% andando${isMaxed('recoil', u.recoil) ? ' · atira correndo' : ' · MAX libera atirar correndo'}`],
      ['stamina', 'Vigor de corrida', `+${Math.round((staminaMultiplier(u) - 1) * 100)}%`],
      ['laser', 'Mira laser', u.laser ? 'ativa' : 'mostra a linha de tiro'],
      ['weight', 'Peso', `capacidade ${maxWeight(u)}`],
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
