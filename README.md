# WarZombie — monolito multiplayer

Jogo isométrico de sobrevivência (PlayCanvas) com servidor Node/Express + WebSocket, Postgres e Prisma,
tudo em um único repositório/deploy.

```
warzombie/
├─ client/            # View: frontend Vite + PlayCanvas (TypeScript)
│  └─ src/Net/        #   NetworkClient (WS tipado), Systems/NetworkSystem, Entities/Player/RemotePlayer
├─ server/            # API Node 24 + Express 5 + ws, arquitetura MVC
│  ├─ prisma/         #   schema.prisma (fonte da verdade do banco) + migrations/ (SQL versionado)
│  └─ src/
│     ├─ models/      #   acesso a dados via Prisma (PlayerModel, SessionModel)
│     ├─ services/    #   regras de negócio (PlayerService: join/leave/autosave)
│     ├─ controllers/ #   handlers HTTP (Health, Player)
│     ├─ routes/      #   /api/*
│     ├─ realtime/    #   GameServer (hub WebSocket em /ws) + validação zod das mensagens
│     ├─ middlewares/ #   404 / error handler
│     └─ app.ts       #   Express: /api + static do client/dist (a "View" em produção)
├─ shared/protocol.ts # contrato das mensagens WS usado pelos dois lados
├─ Dockerfile         # multi-stage: build client + server → runtime com migrate deploy
└─ docker-compose.yml # db (postgres 16) + app
```

## Rodando com Docker (teste completo)

```bash
cp .env.example .env      # ajuste portas se precisar
docker compose up --build # http://localhost:3000
```

O container `app` roda `prisma migrate deploy` (aplica as migrations versionadas) e sobe a API.
Postgres fica exposto no host em `POSTGRES_PORT` (padrão **5434**, para não colidir com outros Postgres locais).

## Desenvolvimento local

```bash
npm install
npm run db:up        # só o Postgres via compose
npm run db:migrate   # aplica migrations (e cria novas se o schema mudou)
npm run dev          # server (tsx watch, :3000) + client (Vite, :5173 com proxy de /api e /ws)
```

Abra http://localhost:5173, escolha um nome e entre. Abra outra aba/navegador com outro nome para ver o multiplayer.

## Fluxo de banco (sempre API → banco)

1. Edite `server/prisma/schema.prisma`.
2. `npm run db:migrate -- --name descricao_da_mudanca` → gera `server/prisma/migrations/<timestamp>_descricao/migration.sql` e aplica.
3. Commit do schema + migration. Em qualquer ambiente, `prisma migrate deploy` (feito automaticamente no container) deixa o banco igual.

Nunca altere o banco à mão: a migration é a documentação da mudança. `npm run db:studio` abre o Prisma Studio.

## API HTTP

| Rota | Descrição |
|---|---|
| `GET /api/health` | status da API e do banco, jogadores online |
| `GET /api/players/online` | jogadores conectados agora (em memória) |
| `GET /api/players?limit=50` | últimos jogadores vistos (banco) |

## Protocolo WebSocket (`/ws`) — ver `shared/protocol.ts`

Client → server: `join {name}`, `move {x,z,yaw,anim,crouching}` (20 Hz, só quando muda), `stats {hp,kills}`, `ping`.
Server → client: `welcome {you, players, seed, tickRate}`, `player_joined`, `player_left`, `state {players[]}` (broadcast a `WS_TICK_RATE` Hz), `error {code}`, `pong`.

Regras do passo 1:
- Identidade = nome (2–16 chars, único sem diferenciar maiúsculas). Se o nome está online, o join é recusado (`name_taken`).
- Client é autoritativo sobre a própria pose; o server valida formato (zod), guarda em memória, retransmite e persiste (ao sair + autosave a cada 15 s).
- Posição, HP e abates são restaurados ao entrar de novo com o mesmo nome.

## O que ainda NÃO é sincronizado (próximos passos)

- Zumbis (cada client roda a própria IA), loot/objetos coletados, construções e craft.
- Dano entre jogadores / zumbis compartilhados exigirá mover a simulação para o server (server-authoritative).
- Salas/instâncias: hoje todos entram no mesmo mundo (`WORLD_SEED`).
