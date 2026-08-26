import type { EventBus } from '@/Core/EventBus';
import type { PlayerSummary } from '@shared/protocol';

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Resultado da fase (aparece ao eliminar o chefão): abates de zumbis, abates humanos, mortes e tempo por jogador. */
export class SummaryUI {
  private panel: HTMLElement;
  private unsubs: Array<() => void> = [];

  constructor(parent: HTMLElement, bus: EventBus, private myId: string | null) {
    this.panel = document.createElement('div');
    this.panel.className = 'inventory-panel summary-panel';
    parent.appendChild(this.panel);
    this.unsubs.push(
      bus.on('phase:complete', ({ summary, duration }) => this.show(summary, duration)),
      bus.on('input:closePanel', () => this.panel.classList.remove('visible')),
    );
  }

  private show(summary: PlayerSummary[], duration: number): void {
    const rows = [...summary]
      .sort((a, b) => b.zombieKills - a.zombieKills)
      .map(
        (p) => `<tr class="${p.id === this.myId ? 'me' : ''}"><td class="name"></td><td>${p.zombieKills}</td><td>${p.humanKills}</td><td>${p.deaths}</td><td>${fmt(p.playtime)}</td></tr>`,
      )
      .join('');
    this.panel.innerHTML = `
      <button class="close" title="Fechar (Esc)">✕</button>
      <h2>FASE 1 CONCLUÍDA</h2>
      <p class="sub">Chefão eliminado em <b>${fmt(duration)}</b></p>
      <table class="summary">
        <thead><tr><th>Jogador</th><th>Zumbis</th><th>Humanos</th><th>Mortes</th><th>Tempo</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
    // nomes vêm de outros jogadores: textContent, nunca innerHTML
    const sorted = [...summary].sort((a, b) => b.zombieKills - a.zombieKills);
    this.panel.querySelectorAll<HTMLElement>('td.name').forEach((td, i) => (td.textContent = sorted[i].name));
    this.panel.querySelector<HTMLButtonElement>('.close')!.onclick = () => this.panel.classList.remove('visible');
    this.panel.classList.add('visible');
  }

  dispose(): void {
    this.unsubs.forEach((u) => u());
    this.panel.remove();
  }
}
