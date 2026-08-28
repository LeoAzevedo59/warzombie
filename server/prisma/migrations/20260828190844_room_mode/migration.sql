-- CreateEnum
CREATE TYPE "RoomMode" AS ENUM ('NORMAL', 'HARDCORE');

-- AlterTable
ALTER TABLE "rooms" ADD COLUMN     "mode" "RoomMode" NOT NULL DEFAULT 'NORMAL';
