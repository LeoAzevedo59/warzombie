import type { EventBus } from '@/Core/EventBus';
import type { GameState } from '@/Core/GameState';
import type { NetworkClient } from '@/Net/NetworkClient';
import type { DevAction } from '@shared/protocol';

/** Painel ⚙ de cheats (só quando o servidor está com DEV_CHEATS): acelera o teste das fases. */
export class DevPanel {
  private button: HTMLButtonElement;
  private panel: HTMLElement;
  private unsubs: Array<() => void> = [];

  constructor(
    parent: HTMLElement,
    bus: EventBus,
    private state: GameState,
    private net: NetworkClient,
  ) {
    this.button = document.createElement('button');
    this.button.className = 'dev-toggle';
    this.button.title = 'Cheats de desenvolvimento';
    this.button.textContent = '⚙';
    this.button.onclick = () => this.panel.classList.toggle('visible');
    parent.appendChild(this.button);

    this.panel = document.createElement('div');
    this.panel.className = 'dev-panel';
    parent.appendChild(this.panel);
    this.render();
    this.unsubs.push(bus.on('input:closePanel', () => this.panel.classList.remove('visible')));
  }

  private send(a: DevAction): void {
    this.net.send({ type: 'dev', ...a });
  }

  private render(): void {
    const rows: Array<[string, Array<[string, DevAction]>]> = [
      ['Dinheiro', [['+$100', { action: 'money', amount: 100 }], ['+$500', { action: 'money', amount: 500 }], ['+$5000', { action: 'money', amount: 5000 }]]],
      ['Itens', [['Bateria', { action: 'give', itemId: 'battery' }], ['Glock', { action: 'give', itemId: 'glock' }], ['Machado', { action: 'give', itemId: 'axe' }], ['Picareta', { action: 'give', itemId: 'pickaxe' }], ['Bandagem', { action: 'give', itemId: 'bandage' }], ['Analgésico', { action: 'give', itemId: 'painkiller' }]]],
      ['Dano', [['×1', { action: 'damage_mult', value: 1 }], ['×5', { action: 'damage_mult', value: 5 }], ['×20', { action: 'damage_mult', value: 20 }], ['×100', { action: 'damage_mult', value: 100 }]]],
      ['Jogador', [['Vida cheia', { action: 'heal' }]]],
      ['Waves', [['Matar zumbis', { action: 'kill_zombies' }], ['Próxima wave', { action: 'next_wave' }], ['Chamar chefão', { action: 'spawn_boss' }]]],
    ];
    this.panel.innerHTML = '<h3>⚙ Dev</h3>' + rows.map(([label]) => `<div class="dev-row"><span>${label}</span><div class="dev-btns"></div></div>`).join('');
    const containers = this.panel.querySelectorAll<HTMLElement>('.dev-btns');
    rows.forEach(([, btns], i) => {
      for (const [text, action] of btns) {
        const b = document.createElement('button');
        b.textContent = text;
        b.onclick = () => this.send(action);
        containers[i].appendChild(b);
      }
    });
    void this.state;
  }

  dispose(): void {
    this.unsubs.forEach((u) => u());
    this.button.remove();
    this.panel.remove();
  }
}
