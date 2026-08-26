import { PROTOCOL_VERSION, type ClientMessage, type ServerMessage, type WelcomeMessage } from '@shared/protocol';

type Listener = (msg: ServerMessage) => void;

/** URL do WebSocket: mesmo host da página (em dev o Vite faz proxy de /ws para o server). */
export function defaultWsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

/**
 * Cliente WebSocket tipado. Uma conexão por sessão de jogo: `connect()` faz o join e
 * resolve com o `welcome`; depois disso `send()` e `onMessage()` cobrem o resto.
 */
export class NetworkClient {
  private socket: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private closeListeners = new Set<(reason: string) => void>();
  welcome: WelcomeMessage | null = null;

  constructor(private url = defaultWsUrl()) {}

  get connected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN && this.welcome !== null;
  }

  /** Abre a conexão e envia `join`. Rejeita com a mensagem do servidor se o nome for recusado. */
  connect(name: string): Promise<WelcomeMessage> {
    this.disconnect();
    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(this.url);
      this.socket = ws;

      ws.onopen = () => this.raw({ type: 'join', version: PROTOCOL_VERSION, name });
      ws.onmessage = (ev) => {
        let msg: ServerMessage;
        try {
          msg = JSON.parse(ev.data as string) as ServerMessage;
        } catch {
          return;
        }
        if (!settled) {
          if (msg.type === 'welcome') {
            settled = true;
            this.welcome = msg;
            resolve(msg);
            return;
          }
          if (msg.type === 'error') {
            settled = true;
            reject(new Error(msg.message));
            ws.close();
            return;
          }
        }
        for (const l of this.listeners) l(msg);
      };
      ws.onerror = () => {
        if (!settled) {
          settled = true;
          reject(new Error('Não foi possível conectar ao servidor.'));
        }
      };
      ws.onclose = (ev) => {
        if (!settled) {
          settled = true;
          reject(new Error(ev.reason || 'Conexão fechada antes de entrar.'));
        }
        const wasConnected = this.welcome !== null;
        this.welcome = null;
        if (this.socket === ws) this.socket = null;
        if (wasConnected) for (const l of this.closeListeners) l(ev.reason || `código ${ev.code}`);
      };
    });
  }

  send(msg: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.raw(msg);
  }

  private raw(msg: ClientMessage): void {
    this.socket?.send(JSON.stringify(msg));
  }

  onMessage(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onClose(listener: (reason: string) => void): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  disconnect(): void {
    const ws = this.socket;
    this.socket = null;
    this.welcome = null;
    if (ws && ws.readyState <= WebSocket.OPEN) ws.close(1000, 'client disconnect');
  }
}
