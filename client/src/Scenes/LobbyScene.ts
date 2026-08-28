import { BaseScene } from './BaseScene';
import { MenuDiorama } from './MenuDiorama';
import { MusicToggle } from '@/UI/MusicToggle';
import { audio } from '@/Assets/SoundAssets';
import { CHARACTER_NAMES, CHARACTERS, isValidRoomName, type CharacterId, type RankingEntry, type RoomDetail, type RoomMode, type RoomSummary, type ServerMessage } from '@shared/protocol';
import { applyGameStart } from '@/Core/GameStart';

const MODE_LABEL: Record<RoomMode, string> = { NORMAL: '🛡 Normal', HARDCORE: '💀 Hardcore' };
const MODE_HINT: Record<RoomMode, string> = {
  NORMAL: 'Normal: perder (todos eliminados / antena destruída) só zera as baterias da antena — dinheiro, itens e upgrades ficam',
  HARDCORE: 'Hardcore: perder reinicia a partida do zero',
};

/**
 * Lobby em DOM: lista de salas (criar/entrar) e, dentro de uma sala, a lista de membros com
 * as ações do owner (visibilidade, iniciar). `game_start` leva para a WorldScene.
 */
export class LobbyScene extends BaseScene {
  private el: HTMLElement | null = null;
  private diorama: MenuDiorama | null = null;
  private musicToggle: MusicToggle | null = null;
  private rooms: RoomSummary[] = [];
  private room: RoomDetail | null = null;
  private status = '';
  private unsubs: Array<() => void> = [];
  /** sala privada aguardando código antes do join */
  private pendingJoin: RoomSummary | null = null;
  private ranking: { topKills: RankingEntry[]; topHours: RankingEntry[] } | null = null;
  private rankingTimer: number | null = null;

  enter(): void {
    this.diorama = new MenuDiorama(this.game.app, this.root, this.game.ensureModels());
    audio.setMusic('menu'); // começa no primeiro clique/tecla (política de autoplay do navegador)
    this.musicToggle = new MusicToggle(this.game.ui);
    const { net, bus, ui } = this.game;
    this.el = document.createElement('div');
    this.el.className = 'menu lobby';
    ui.appendChild(this.el);

    this.unsubs.push(
      net.onMessage((m) => this.onMessage(m)),
      net.onClose((reason) => {
        this.setStatus(`Conexão perdida (${reason}).`, true);
        bus.emit('scene:change', { scene: 'menu' });
      }),
    );
    net.send({ type: 'room_list' });
    this.render();
    void this.loadRanking();
    this.rankingTimer = window.setInterval(() => void this.loadRanking(), 30_000);
  }

  private async loadRanking(): Promise<void> {
    try {
      const r = await fetch('/api/ranking');
      if (!r.ok) return;
      this.ranking = (await r.json()) as { topKills: RankingEntry[]; topHours: RankingEntry[] };
      if (!this.room) this.render();
    } catch {
      /* ranking é opcional */
    }
  }

  private onMessage(msg: ServerMessage): void {
    const { state, bus } = this.game;
    switch (msg.type) {
      case 'lobby_state':
        this.rooms = msg.rooms;
        break;
      case 'room_state':
        this.room = msg.room;
        this.pendingJoin = null;
        state.roomId = msg.room.id;
        state.isOwner = msg.room.ownerId === state.playerId;
        this.status = '';
        break;
      case 'room_left':
        this.room = null;
        state.roomId = null;
        state.isOwner = false;
        break;
      case 'game_start':
        applyGameStart(state, msg);
        bus.emit('scene:change', { scene: 'world' });
        return;
      case 'error':
        this.setStatus(msg.message, true);
        return;
      default:
        return;
    }
    this.render();
  }

  private setStatus(text: string, error = false): void {
    this.status = text;
    const s = this.el?.querySelector<HTMLElement>('#status');
    if (s) {
      s.textContent = text;
      s.classList.toggle('error', error);
    }
  }

  private render(): void {
    if (!this.el) return;
    this.el.innerHTML = this.room ? this.roomHtml(this.room) : this.listHtml();
    this.bind();
  }

  private listHtml(): string {
    const rows = this.rooms.length
      ? this.rooms
          .map(
            (r) => `<li class="room" data-id="${r.id}">
              <span class="vis" title="${r.visibility === 'PRIVATE' ? 'Privada' : 'Pública'}">${r.visibility === 'PRIVATE' ? '🔒' : '🌐'}</span>
              <span class="mode ${r.mode === 'HARDCORE' ? 'hard' : ''}" title="${MODE_HINT[r.mode]}">${MODE_LABEL[r.mode]}</span>
              <span class="rname"></span>
              <span class="meta">${r.members}/${r.max} · ${r.status === 'LOBBY' ? 'aguardando' : r.status === 'PLAYING' ? '🔒 em jogo' : 'encerrada'}</span>
              <button class="join" ${r.members >= r.max ? 'disabled' : ''} title="${r.locked ? 'Partida em andamento: só quem estava na sala pode voltar' : ''}">${r.locked ? 'Voltar' : 'Entrar'}</button>
            </li>`,
          )
          .join('')
      : '<li class="empty">Nenhuma sala aberta. Crie a primeira!</li>';
    const pj = this.pendingJoin;
    return `
      <h1>LOBBY</h1>
      <p>Olá, <b class="me"></b>. Escolha uma sala ou crie a sua.</p>
      <div class="lobby-grid">
        <section class="panel">
          <h2>Salas</h2>
          <ul class="rooms">${rows}</ul>
          ${pj ? `<form class="code-form"><label>Código da sala "<span class="pj"></span>":</label><input id="code" inputmode="numeric" maxlength="4" placeholder="0000" autocomplete="off" /><button type="submit">Entrar</button><button type="button" class="cancel">Cancelar</button></form>` : ''}
        </section>
        <section class="panel">
          <h2>Criar sala</h2>
          <form class="create-form">
            <input id="rname" maxlength="24" placeholder="Nome da sala" autocomplete="off" />
            <div class="vis">
              <label><input type="radio" name="vis" value="PUBLIC" checked /> 🌐 Pública</label>
              <label><input type="radio" name="vis" value="PRIVATE" /> 🔒 Privada (código)</label>
            </div>
            <div class="vis">
              <label><input type="radio" name="mode" value="NORMAL" checked /> ${MODE_LABEL.NORMAL}</label>
              <label><input type="radio" name="mode" value="HARDCORE" /> ${MODE_LABEL.HARDCORE}</label>
            </div>
            <p class="mode-hint">${MODE_HINT.NORMAL} · ${MODE_HINT.HARDCORE}</p>
            <button type="submit">Criar</button>
          </form>
        </section>
        <section class="panel ranking">
          <h2>Top Ranking</h2>
          <div class="rank-cols">
            <div><h4>🧟 Top Kill</h4><ol class="rank-kills"></ol></div>
            <div><h4>⏱ Top Hours</h4><ol class="rank-hours"></ol></div>
          </div>
        </section>
      </div>
      <div class="status" id="status"></div>
      <button class="back">Trocar de nome</button>`;
  }

  private roomHtml(r: RoomDetail): string {
    const { isOwner: owner, playerId, character } = this.game.state;
    const me = r.memberList.find((m) => m.id === playerId);
    const readyCount = r.memberList.filter((m) => m.ready).length;
    const allReady = readyCount === r.memberList.length;
    const members = r.memberList
      .map(
        (m) =>
          `<li class="${m.id === r.ownerId ? 'owner' : ''} ${m.ready ? 'ready' : ''}"><span class="mname"></span>${m.trophies > 0 ? `<span class="trophy" title="Fases zeradas">🏆${m.trophies > 1 ? `×${m.trophies}` : ''}</span>` : ''}<span class="char">${CHARACTER_NAMES[m.character]}</span>${m.id === r.ownerId ? ' <em>dono</em>' : ''}<span class="ready-badge">${m.ready ? '✔ PRONTO' : '… esperando'}</span></li>`,
      )
      .join('');
    const picker = CHARACTERS.map((c) => `<button class="char-pick ${c === character ? 'active' : ''}" data-char="${c}" title="Jogar com ${CHARACTER_NAMES[c]}">${CHARACTER_NAMES[c]}</button>`).join('');
    const readyBtn = me?.ready ? '<button class="ready-btn off">Cancelar PRONTO</button>' : '<button class="ready-btn on">PRONTO</button>';
    const startBtn = owner
      ? `<button class="start" ${allReady ? '' : 'disabled'} title="${allReady ? '' : 'Todos precisam marcar PRONTO'}">Iniciar partida${allReady ? '' : ` (${readyCount}/${r.memberList.length} prontos)`}</button><button class="toggle-vis">${r.visibility === 'PRIVATE' ? 'Tornar pública' : 'Tornar privada'}</button><button class="toggle-mode" title="${MODE_HINT[r.mode === 'HARDCORE' ? 'NORMAL' : 'HARDCORE']}">Modo: ${MODE_LABEL[r.mode]} → trocar</button>`
      : `<p class="hint">${allReady ? 'Todos prontos! Aguardando o dono iniciar…' : `Prontos: ${readyCount}/${r.memberList.length}. O dono só inicia com todos prontos.`}</p>`;
    return `
      <h1 class="rtitle"></h1>
      <p>${r.visibility === 'PRIVATE' ? '🔒 Sala privada' : '🌐 Sala pública'}${r.code ? ` · código <b class="code">${r.code}</b>` : ''} · <b title="${MODE_HINT[r.mode]}">${MODE_LABEL[r.mode]}</b> · ${r.members}/${r.max} jogadores · ${r.status === 'LOBBY' ? 'aguardando início' : 'em jogo'}</p>
      <p class="mode-hint">${MODE_HINT[r.mode]}</p>
      <div class="lobby-grid">
        <section class="panel">
          <h2>Jogadores</h2>
          <ul class="members">${members}</ul>
        </section>
        <div class="col">
          <div class="char-preview" title="${CHARACTER_NAMES[character]}"><span class="char-name">${CHARACTER_NAMES[character]}</span></div>
          <section class="panel">
            <h2>Seu personagem</h2>
            <div class="char-picker">${picker}</div>
            <h2 class="actions-title">Ações</h2>
            ${readyBtn}
            ${startBtn}
            <button class="leave">Sair da sala</button>
          </section>
        </div>
      </div>
      <div class="status" id="status"></div>`;
  }

  /** textContent para nomes vindos de outros jogadores (nunca innerHTML). */
  private bind(): void {
    const el = this.el!;
    const { net, state, bus } = this.game;
    el.querySelector<HTMLElement>('.me')?.replaceChildren(state.playerName);
    const fill = (sel: string, list: RankingEntry[] | undefined, fmt: (v: number) => string) => {
      const ol = el.querySelector<HTMLElement>(sel);
      if (!ol) return;
      ol.replaceChildren();
      if (!list?.length) {
        const li = document.createElement('li');
        li.className = 'empty';
        li.textContent = 'ainda sem dados';
        ol.appendChild(li);
        return;
      }
      list.forEach((e, i) => {
        const li = document.createElement('li');
        const pos = document.createElement('span');
        pos.className = 'pos';
        pos.textContent = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`;
        li.appendChild(pos);
        const name = document.createElement('span');
        name.className = 'rname';
        name.textContent = e.name; // nome de outro jogador: textContent
        if (e.name === state.playerName) li.classList.add('me');
        const val = document.createElement('b');
        val.textContent = fmt(e.value);
        li.append(name, val);
        ol.appendChild(li);
      });
    };
    fill('.rank-kills', this.ranking?.topKills, (v) => String(v));
    fill('.rank-hours', this.ranking?.topHours, (v) => `${v}h`);
    el.querySelectorAll<HTMLElement>('li.room').forEach((li) => {
      const r = this.rooms.find((x) => x.id === li.dataset.id)!;
      li.querySelector('.rname')!.textContent = r.name;
      li.querySelector<HTMLButtonElement>('.join')!.onclick = () => {
        if (r.visibility === 'PRIVATE') {
          this.pendingJoin = r;
          this.render();
          el.querySelector<HTMLInputElement>('#code')?.focus();
        } else net.send({ type: 'room_join', roomId: r.id });
      };
    });
    const codeForm = el.querySelector<HTMLFormElement>('.code-form');
    if (codeForm) {
      el.querySelector('.pj')!.textContent = this.pendingJoin!.name;
      codeForm.onsubmit = (e) => {
        e.preventDefault();
        const code = el.querySelector<HTMLInputElement>('#code')!.value.trim();
        if (!/^\d{4}$/.test(code)) return this.setStatus('Código deve ter 4 dígitos.', true);
        net.send({ type: 'room_join', roomId: this.pendingJoin!.id, code });
      };
      codeForm.querySelector<HTMLButtonElement>('.cancel')!.onclick = () => {
        this.pendingJoin = null;
        this.render();
      };
    }
    const createForm = el.querySelector<HTMLFormElement>('.create-form');
    if (createForm) {
      createForm.onsubmit = (e) => {
        e.preventDefault();
        const name = el.querySelector<HTMLInputElement>('#rname')!.value.trim();
        if (!isValidRoomName(name)) return this.setStatus('Nome da sala: 2–24 caracteres (letras, números, espaço, _ ou -).', true);
        const visibility = (createForm.querySelector<HTMLInputElement>('input[name=vis]:checked')?.value ?? 'PUBLIC') as 'PUBLIC' | 'PRIVATE';
        const mode = (createForm.querySelector<HTMLInputElement>('input[name=mode]:checked')?.value ?? 'NORMAL') as RoomMode;
        net.send({ type: 'room_create', name, visibility, mode });
      };
    }
    el.querySelector<HTMLButtonElement>('.back')?.addEventListener('click', () => {
      net.disconnect();
      bus.emit('scene:change', { scene: 'menu' });
    });

    // dentro da sala
    if (this.room) {
      el.querySelector('.rtitle')!.textContent = this.room.name;
      el.querySelectorAll<HTMLElement>('.members li').forEach((li, i) => {
        li.querySelector('.mname')!.textContent = this.room!.memberList[i].name;
      });
      el.querySelector<HTMLButtonElement>('.start')?.addEventListener('click', () => net.send({ type: 'room_start' }));
      el.querySelector<HTMLButtonElement>('.ready-btn')?.addEventListener('click', (e) => net.send({ type: 'room_ready', ready: (e.currentTarget as HTMLElement).classList.contains('on') }));
      el.querySelectorAll<HTMLButtonElement>('.char-pick').forEach((b) => {
        b.onclick = () => {
          const c = b.dataset.char as CharacterId;
          state.character = c; // previsão local; o room_state confirma para todos
          net.send({ type: 'set_character', character: c });
          this.render();
        };
      });
      el.querySelector<HTMLButtonElement>('.toggle-vis')?.addEventListener('click', () =>
        net.send({ type: 'room_set_visibility', visibility: this.room!.visibility === 'PRIVATE' ? 'PUBLIC' : 'PRIVATE' }),
      );
      el.querySelector<HTMLButtonElement>('.toggle-mode')?.addEventListener('click', () => net.send({ type: 'room_set_mode', mode: this.room!.mode === 'HARDCORE' ? 'NORMAL' : 'HARDCORE' }));
      el.querySelector<HTMLButtonElement>('.leave')!.onclick = () => net.send({ type: 'room_leave' });
    }
    const s = el.querySelector<HTMLElement>('#status');
    if (s && this.status) s.textContent = this.status;
  }

  update(dt: number): void {
    // janela 3D do personagem escolhido alinhada ao quadro do painel (só dentro da sala)
    const box = this.el?.querySelector<HTMLElement>('.char-preview');
    this.diorama?.setPreview(box ? this.game.state.character : null, box ? box.getBoundingClientRect() : null);
    this.diorama?.update(dt);
  }

  exit(): void {
    this.diorama?.dispose();
    this.diorama = null;
    this.musicToggle?.dispose();
    this.musicToggle = null;
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    if (this.rankingTimer) clearInterval(this.rankingTimer);
    this.el?.remove();
    super.exit();
  }
}
