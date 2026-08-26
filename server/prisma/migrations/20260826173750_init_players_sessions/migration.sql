-- CreateTable
CREATE TABLE "players" (
    "id" UUID NOT NULL,
    "name" VARCHAR(16) NOT NULL,
    "name_key" VARCHAR(16) NOT NULL,
    "hp" INTEGER NOT NULL DEFAULT 100,
    "kills" INTEGER NOT NULL DEFAULT 0,
    "pos_x" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pos_z" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "players_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_sessions" (
    "id" UUID NOT NULL,
    "player_id" UUID NOT NULL,
    "connected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disconnected_at" TIMESTAMP(3),
    "ip" VARCHAR(64),

    CONSTRAINT "player_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "players_name_key_key" ON "players"("name_key");

-- CreateIndex
CREATE INDEX "player_sessions_player_id_idx" ON "player_sessions"("player_id");

-- AddForeignKey
ALTER TABLE "player_sessions" ADD CONSTRAINT "player_sessions_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;
