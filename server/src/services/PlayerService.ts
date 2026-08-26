import { isValidName } from '../../../shared/protocol.js';
import { PlayerModel, type Player } from '../models/PlayerModel.js';
import { SessionModel } from '../models/SessionModel.js';

export class PlayerServiceError extends Error {
  constructor(
    readonly code: 'invalid_name' | 'name_taken',
    message: string,
  ) {
    super(message);
  }
}

/**
 * Regras de negócio de jogador. Não sabe nada de WebSocket/HTTP:
 * quem chama decide como responder.
 */
export class PlayerService {
  /** ids de jogadores com conexão ativa — a fonte é o GameServer, injetada aqui. */
  constructor(private isOnline: (playerId: string) => boolean) {}

  /** Entrada no jogo: valida nome, cria/recupera o jogador e abre uma sessão. */
  async join(name: string, ip: string | null): Promise<{ player: Player; sessionId: string }> {
    if (!isValidName(name)) {
      throw new PlayerServiceError('invalid_name', 'Nome deve ter 2–16 caracteres (letras, números, espaço, _ ou -).');
    }
    const existing = await PlayerModel.findByName(name);
    if (existing && this.isOnline(existing.id)) {
      throw new PlayerServiceError('name_taken', `"${existing.name}" já está jogando agora. Escolha outro nome.`);
    }
    const player = await PlayerModel.upsertByName(name);
    const session = await SessionModel.open(player.id, ip);
    return { player, sessionId: session.id };
  }

  /** Persiste o último estado conhecido e fecha a sessão. */
  async leave(playerId: string, sessionId: string, state: { posX: number; posZ: number; hp: number; kills: number }): Promise<void> {
    await PlayerModel.saveState(playerId, state);
    await SessionModel.close(sessionId);
  }

  /** Salvamento periódico (o jogo pode cair sem `leave`). */
  saveState(playerId: string, state: { posX: number; posZ: number; hp: number; kills: number }): Promise<Player> {
    return PlayerModel.saveState(playerId, state);
  }

  listRecent(limit?: number): Promise<Player[]> {
    return PlayerModel.list(limit);
  }

  countRegistered(): Promise<number> {
    return PlayerModel.count();
  }
}
