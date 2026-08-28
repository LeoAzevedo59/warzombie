import type { Room, RoomMember, RoomMode, RoomStatus, RoomVisibility } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

export type { Room, RoomMember };

/** Acesso a dados de `rooms` / `room_members`. Regras (limite, código, owner) ficam no RoomService. */
export const RoomModel = {
  create(data: { name: string; visibility: RoomVisibility; mode: RoomMode; code: string | null; ownerId: string }): Promise<Room> {
    return prisma.room.create({ data: { ...data, members: { create: { playerId: data.ownerId } } } });
  },

  findById(id: string): Promise<Room | null> {
    return prisma.room.findUnique({ where: { id } });
  },

  codeExists(code: string): Promise<boolean> {
    return prisma.room.count({ where: { code } }).then((n) => n > 0);
  },

  addMember(roomId: string, playerId: string): Promise<RoomMember> {
    return prisma.roomMember.create({ data: { roomId, playerId } });
  },

  removeMember(playerId: string): Promise<number> {
    return prisma.roomMember.deleteMany({ where: { playerId } }).then((r) => r.count);
  },

  update(id: string, data: Partial<Pick<Room, 'ownerId' | 'visibility' | 'mode' | 'code' | 'status' | 'money' | 'wave'>>): Promise<Room> {
    return prisma.room.update({ where: { id }, data });
  },

  /** Cascade apaga membros e tudo o que referenciar a sala. */
  delete(id: string): Promise<void> {
    return prisma.room.delete({ where: { id } }).then(() => undefined);
  },

  /** Salas são efêmeras: ao reiniciar o servidor nenhuma sobrevive. */
  deleteAll(): Promise<number> {
    return prisma.room.deleteMany({}).then((r) => r.count);
  },

  list(): Promise<Array<Room & { _count: { members: number }; owner: { name: string } }>> {
    return prisma.room.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { members: true } }, owner: { select: { name: true } } },
    });
  },
};

export type { RoomMode, RoomStatus, RoomVisibility };
