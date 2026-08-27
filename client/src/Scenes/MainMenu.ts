import { BaseScene } from './BaseScene';
import { MenuDiorama } from './MenuDiorama';
import { MusicToggle } from '@/UI/MusicToggle';
import { audio } from '@/Assets/SoundAssets';
import { isValidName, NAME_MAX } from '@shared/protocol';

const NAME_STORAGE_KEY = 'warzombie:name';

/** Menu inicial em DOM: escolhe o nome e entra no servidor. */
export class MainMenu extends BaseScene {
  private el: HTMLElement | null = null;
  private diorama: MenuDiorama | null = null;
  private musicToggle: MusicToggle | null = null;

  enter(): void {
    this.diorama = new MenuDiorama(this.game.app, this.root, this.game.ensureModels());
    audio.setMusic('menu'); // começa no primeiro clique/tecla (política de autoplay do navegador)
    this.musicToggle = new MusicToggle(this.game.ui);
    this.el = document.createElement('div');
    this.el.className = 'menu';
    this.el.innerHTML = `
      <h1>WARZOMBIE</h1>
      <p>Sobreviva. Colete. Construa. <span class="mp">Multiplayer</span></p>
      <form class="join" autocomplete="off">
        <input id="name" type="text" maxlength="${NAME_MAX}" placeholder="Seu nome" spellcheck="false" />
        <button id="play" type="submit">Entrar</button>
      </form>
      <div class="status" id="status"></div>`;
    this.game.ui.appendChild(this.el);

    const form = this.el.querySelector<HTMLFormElement>('form.join')!;
    const input = this.el.querySelector<HTMLInputElement>('#name')!;
    const playBtn = this.el.querySelector<HTMLButtonElement>('#play')!;
    const status = this.el.querySelector<HTMLElement>('#status')!;
    input.value = localStorage.getItem(NAME_STORAGE_KEY) ?? '';
    input.focus();

    form.onsubmit = async (ev) => {
      ev.preventDefault();
      const name = input.value.trim();
      if (!isValidName(name)) {
        status.textContent = 'Nome deve ter 2–16 caracteres (letras, números, espaço, _ ou -).';
        status.classList.add('error');
        return;
      }
      status.classList.remove('error');
      playBtn.disabled = true;
      input.disabled = true;
      try {
        status.textContent = 'Carregando modelos...';
        await this.game.ensureModels();
        status.textContent = 'Conectando ao servidor...';
        const welcome = await this.game.net.connect(name);
        localStorage.setItem(NAME_STORAGE_KEY, name);

        const { state } = this.game;
        state.playerId = welcome.you.id;
        state.playerName = welcome.you.name;
        state.kills = welcome.you.kills;
        state.devCheats = welcome.devCheats;
        this.game.bus.emit('scene:change', { scene: 'lobby' });
      } catch (err) {
        console.error('Falha ao entrar:', err);
        status.textContent = err instanceof Error ? err.message : 'Erro ao entrar no jogo.';
        status.classList.add('error');
        playBtn.disabled = false;
        input.disabled = false;
        input.focus();
      }
    };
  }

  update(dt: number): void {
    this.diorama?.update(dt);
  }

  exit(): void {
    this.diorama?.dispose();
    this.diorama = null;
    this.musicToggle?.dispose();
    this.musicToggle = null;
    this.el?.remove();
    super.exit();
  }
}
