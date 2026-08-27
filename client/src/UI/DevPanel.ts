import type { EventBus } from '@/Core/EventBus';
import type { GameState } from '@/Core/GameState';
import type { NetworkClient } from '@/Net/NetworkClient';
import type { DevAction, UpgradeKind } from '@shared/protocol';
import { GAME } from '@shared/gameconfig';

/** Painel ⚙ de cheats (só quando o servidor está com DEV_CHEATS): acelera o teste das fases. */
export class DevPanel {
  private button: HTMLButtonElement;
  private panel: HTMLElement;
  private unsubs: Array<() => void> = [];
  private infinite = false;

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
    this.unsubs.push(
      bus.on('input:closePanel', () => this.panel.classList.remove('visible')),
      // níveis mudam: os botões mostram o nível atual
      bus.on('net:upgrades', () => this.render()),
      bus.on('net:towerHp', () => this.render()),
    );
  }

  private send(a: DevAction): void {
    this.net.send({ type: 'dev', ...a });
  }

  private render(): void {
    const up = (kind: UpgradeKind, label: string): [string, DevAction] => [`${label} +1 (${this.state.upgrades[kind]}/${GAME.upgrades[kind].MAX_LEVEL})`, { action: 'upgrade', kind }];
    const rows: Array<[string, Array<[string, DevAction]>]> = [
      ['Dinheiro', [['+$100', { action: 'money', amount: 100 }], ['+$500', { action: 'money', amount: 500 }], ['+$5000', { action: 'money', amount: 5000 }]]],
      ['Itens', [['Bateria', { action: 'give', itemId: 'battery' }], ['Glock', { action: 'give', itemId: 'glock' }], ['Faca', { action: 'give', itemId: 'knife' }], ['Machado', { action: 'give', itemId: 'axe' }], ['Picareta', { action: 'give', itemId: 'pickaxe' }], ['Bandagem ×5', { action: 'give', itemId: 'bandage' }], ['Analgésico ×5', { action: 'give', itemId: 'painkiller' }], ['Coração ×5', { action: 'give', itemId: 'boss_heart' }]]],
      ['Construções', [['Madeira ×5', { action: 'give', itemId: 'wall_wood' }], ['Pedra ×5', { action: 'give', itemId: 'wall_stone' }], ['Ferro ×5', { action: 'give', itemId: 'wall_iron' }], ['Porteira ×5', { action: 'give', itemId: 'gate' }], [this.infinite ? '∞ Infinito: LIGADO' : '∞ Infinito: desligado', { action: 'infinite_items', on: !this.infinite }]]],
      ['Habilidades', [up('damage', 'Dano'), up('ammo', 'Munição'), up('recoil', 'Recoil'), up('stamina', 'Vigor'), up('laser', 'Laser'), up('weight', 'Peso'), [`Antena +1 (Lv ${this.state.towerLevel})`, { action: 'tower_upgrade' }]]],
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
        if (action.action === 'infinite_items') b.classList.toggle('on', this.infinite);
        b.onclick = () => {
          this.send(action);
          if (action.action === 'infinite_items') {
            this.infinite = action.on;
            this.render();
          }
        };
        containers[i].appendChild(b);
      }
    });
  }

  dispose(): void {
    this.unsubs.forEach((u) => u());
    this.button.remove();
    this.panel.remove();
  }
}
