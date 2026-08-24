import { BaseScene } from './BaseScene';

/** Menu inicial em DOM. */
export class MainMenu extends BaseScene {
  private el: HTMLElement | null = null;

  enter(): void {
    this.el = document.createElement('div');
    this.el.className = 'menu';
    this.el.innerHTML = `
      <h1>WARZOMBIE</h1>
      <p>Sobreviva. Colete. Construa.</p>
      <button id="play">Jogar</button>
      <div class="controls">
        WASD / Setas — mover · Shift — correr · Ctrl — agachar<br/>
        Mouse — mirar · Clique — atirar (com pistola equipada) · E — coletar/usar · B — colocar mesa · Tab — inventário<br/>
        1-5 — equipar item da hotbar (machado/picareta precisam estar equipados)
      </div>`;
    this.game.ui.appendChild(this.el);
    const playBtn = this.el.querySelector<HTMLButtonElement>('#play')!;
    playBtn.onclick = async () => {
      playBtn.disabled = true;
      playBtn.textContent = 'Carregando...';
      try {
        await this.game.ensureModels();
      } catch (err) {
        console.error('Falha ao carregar modelos:', err);
        playBtn.disabled = false;
        playBtn.textContent = 'Tentar novamente';
        const p = this.el?.querySelector('p');
        if (p) p.textContent = 'Erro ao carregar os modelos 3D. Verifique a conexão e tente de novo.';
        return;
      }
      this.game.bus.emit('scene:change', { scene: 'world' });
    };
  }

  update(): void {}

  exit(): void {
    this.el?.remove();
    super.exit();
  }
}
