import type { EventBus } from '@/Core/EventBus';
import type { GameState } from '@/Core/GameState';
import type { NetworkClient } from '@/Net/NetworkClient';
import { iconHtml, itemIconHtml } from './ItemIcon';
import { towerRepairPrice, towerUpgradePrice } from '@shared/upgrades';
import { GAME } from '@shared/gameconfig';

/** Painel da torre de comunicação: colocar a bateria, reforçar e reparar (dinheiro da sala). Regras no server. */
export class TowerUI {
  private panel: HTMLElement;
  private unsubs: Array<() => void> = [];
  private _open = false;
  onOpenChanged: ((open: boolean) => void) | null = null;

  constructor(
    parent: HTMLElement,
    private bus: EventBus,
    private state: GameState,
    private net: NetworkClient,
  ) {
    this.panel = document.createElement('div');
    this.panel.className = 'inventory-panel shop-panel tower-panel';
    parent.appendChild(this.panel);
    this.unsubs.push(
      bus.on('tower:open', () => this.setOpen(true)),
      bus.on('input:closePanel', () => this.setOpen(false)),
      bus.on('inventory:changed', () => this.renderIfOpen()),
      bus.on('net:money', () => this.renderIfOpen()),
      bus.on('net:towerHp', () => this.renderIfOpen()),
      bus.on('wave:state', () => this.renderIfOpen()),
      bus.on('net:batteryPrice', () => this.renderIfOpen()),
    );
  }

  get open(): boolean {
    return this._open;
  }

  private setOpen(open: boolean): void {
    if (this._open === open) return;
    this._open = open;
    this.panel.classList.toggle('visible', open);
    this.panel.parentElement?.classList.toggle('shop-open', open);
    this.onOpenChanged?.(open);
    if (open) this.render();
  }

  private renderIfOpen(): void {
    if (this._open) this.render();
  }

  private render(): void {
    const money = this.state.money;
    const hasBattery = this.state.inventory.some((s) => s?.itemId === 'battery');
    const w = this.state.wave;
    const idle = w.phase === 'idle';
    const complete = w.phase === 'complete';
    const upPrice = towerUpgradePrice(this.state.towerLevel);
    const missing = this.state.towerMaxHp - this.state.towerHp;
    const repPrice = towerRepairPrice(missing);
    // uma bateria por wave: só aceita parada e com waves faltando
    const batteryRow =
      idle && w.wave < w.total
        ? `<div class="recipe feature"><span class="recipe-label">${itemIconHtml('battery', 22, 'shop-icon')}<b>Colocar bateria ${w.wave + 1}/${w.total}</b> <span class="lvl">${hasBattery ? `inicia a wave ${w.wave + 1}` : `compre no vendedor ($${this.state.batteryPrice})`}</span></span><button class="battery" ${hasBattery ? '' : 'disabled'}>${hasBattery ? 'ATIVAR' : 'SEM BATERIA'}</button></div>`
        : '';
    const status = complete ? 'Antena completa: fase concluída!' : idle ? (w.wave === 0 ? 'Sem bateria' : `Wave ${w.wave} concluída · aguardando a bateria ${w.wave + 1}`) : w.phase === 'boss' ? `Chefão da wave ${w.wave} em andamento` : `Wave ${w.wave} em andamento`;
    const cells = Array.from({ length: w.total }, (_, i) => `<i class="${i < w.wave ? 'on' : ''}" title="Bateria ${i + 1}">${itemIconHtml('battery', 18, 'cell-icon')}</i>`).join('');
    this.panel.innerHTML = `
      <button class="close" title="Fechar (Esc)">✕</button>
      <h2>Torre de Comunicação <span class="money-line">· Dinheiro: <b>$${money}</b></span></h2>
      <div class="tower-hp"><div class="bar"><div style="width:${Math.max(0, (100 * this.state.towerHp) / this.state.towerMaxHp).toFixed(1)}%;background:#4db8ff"></div></div><span>Vida <b>${Math.round(this.state.towerHp)}</b>/${this.state.towerMaxHp} · Lv ${this.state.towerLevel}</span></div>
      <div class="battery-slots"><span>Baterias <b>${w.wave}</b>/${w.total}</span><span class="cells">${cells}</span><span class="status">${status}</span></div>
      <div class="recipes">
        ${batteryRow}
        <div class="recipe feature"><span class="recipe-label">${iconHtml('tower', '#ffd34d', 22, 'shop-icon')}<b>Reforçar antena</b> <span class="lvl">+${GAME.towerUpgrade.HP_STEP} de vida máxima</span></span>${upPrice === null ? '<button disabled>MAX</button>' : `<button class="tower-upgrade" ${money >= upPrice ? '' : 'disabled'}>$${upPrice}</button>`}</div>
        <div class="recipe feature"><span class="recipe-label">${iconHtml('tower', '#4db8ff', 22, 'shop-icon')}<b>Reparar antena</b> <span class="lvl">${missing > 0 ? `${Math.round(missing)} de vida faltando` : 'vida cheia'}</span></span>${missing <= 0 ? '<button disabled>CHEIA</button>' : `<button class="tower-repair" ${money >= repPrice ? '' : 'disabled'}>$${repPrice}</button>`}</div>
      </div>`;
    this.panel.querySelector<HTMLButtonElement>('.close')!.onclick = () => this.setOpen(false);
    const battery = this.panel.querySelector<HTMLButtonElement>('.battery');
    if (battery)
      battery.onclick = () => {
        this.net.send({ type: 'activate_battery' });
        this.setOpen(false);
      };
    const up = this.panel.querySelector<HTMLButtonElement>('.tower-upgrade');
    if (up)
      up.onclick = () => {
        this.net.send({ type: 'tower_upgrade' });
        this.bus.emit('shop:transaction', { kind: 'upgrade' });
      };
    const rep = this.panel.querySelector<HTMLButtonElement>('.tower-repair');
    if (rep)
      rep.onclick = () => {
        this.net.send({ type: 'tower_repair' });
        this.bus.emit('shop:transaction', { kind: 'upgrade' });
      };
  }

  dispose(): void {
    this.unsubs.forEach((u) => u());
    this.panel.remove();
  }
}
