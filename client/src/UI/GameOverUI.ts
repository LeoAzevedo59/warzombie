import type { EventBus } from '@/Core/EventBus';

/**
 * Derrota. HARDCORE: tela cheia "Você perdeu" até o servidor reiniciar a partida do zero.
 * NORMAL (match_reset): "Wave perdida" — a antena zerou, mas dinheiro/itens ficam; some quando você renasce.
 */
export class GameOverUI {
  private el: HTMLElement;
  private unsubs: Array<() => void> = [];
  /** modo Normal: some sozinha quando o respawn chega (mesmo para quem estava vivo) */
  private hideTimer: number | null = null;

  constructor(parent: HTMLElement, bus: EventBus) {
    this.el = document.createElement('div');
    this.el.className = 'game-over';
    this.el.innerHTML = `<h1>Você perdeu</h1><p class="why"></p><p class="restart">A partida está sendo reiniciada.</p><p class="keep"></p>`;
    parent.appendChild(this.el);
    this.unsubs.push(
      bus.on('net:gameOver', ({ reason }) => {
        this.clearTimer();
        this.el.classList.remove('soft');
        this.el.querySelector('h1')!.textContent = 'Você perdeu';
        this.el.querySelector('.why')!.textContent = reason === 'all_dead' ? 'Todos os sobreviventes caíram.' : 'A torre de comunicação foi destruída.';
        this.el.querySelector('.restart')!.textContent = 'A partida está sendo reiniciada do zero.';
        this.el.querySelector('.keep')!.textContent = '';
        this.el.classList.add('visible');
      }),
      bus.on('net:matchReset', ({ reason, respawnIn }) => {
        this.el.classList.add('soft');
        this.el.querySelector('h1')!.textContent = 'Wave perdida';
        this.el.querySelector('.why')!.textContent = reason === 'all_dead' ? 'Todos os sobreviventes caíram.' : 'A torre de comunicação foi destruída.';
        this.el.querySelector('.restart')!.textContent = `A antena perdeu todas as baterias. Renascendo em ${respawnIn}s…`;
        this.el.querySelector('.keep')!.textContent = 'Dinheiro, itens e upgrades continuam com você.';
        this.el.classList.add('visible');
        // quem estava vivo não recebe player_respawned: a tela some por tempo
        this.clearTimer();
        this.hideTimer = window.setTimeout(() => this.hideSoft(), respawnIn * 1000);
      }),
      bus.on('player:respawned', () => this.hideSoft()),
    );
  }

  private hideSoft(): void {
    if (!this.el.classList.contains('soft')) return;
    this.clearTimer();
    this.el.classList.remove('visible', 'soft');
  }

  private clearTimer(): void {
    if (this.hideTimer !== null) clearTimeout(this.hideTimer);
    this.hideTimer = null;
  }

  dispose(): void {
    this.clearTimer();
    this.unsubs.forEach((u) => u());
    this.el.remove();
  }
}
