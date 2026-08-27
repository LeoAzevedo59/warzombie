import type { EventBus } from '@/Core/EventBus';

/** Derrota (torre destruída / todos eliminados): tela cheia "Você perdeu" até o servidor reiniciar a partida. */
export class GameOverUI {
  private el: HTMLElement;
  private unsubs: Array<() => void> = [];

  constructor(parent: HTMLElement, bus: EventBus) {
    this.el = document.createElement('div');
    this.el.className = 'game-over';
    this.el.innerHTML = `<h1>Você perdeu</h1><p class="why"></p><p class="restart">A partida está sendo reiniciada.</p>`;
    parent.appendChild(this.el);
    this.unsubs.push(
      bus.on('net:gameOver', ({ reason }) => {
        this.el.querySelector('.why')!.textContent = reason === 'all_dead' ? 'Todos os sobreviventes caíram.' : 'A torre de comunicação foi destruída.';
        this.el.classList.add('visible');
      }),
    );
  }

  dispose(): void {
    this.unsubs.forEach((u) => u());
    this.el.remove();
  }
}
