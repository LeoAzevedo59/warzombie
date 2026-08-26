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

## Lobby e salas (M1)

Depois do `welcome` o jogador cai no **lobby**: cria uma sala (pública ou privada com código de 4 dígitos)
ou entra numa existente (máx. 10). O dono inicia a partida (`room_start`) e todos os membros recebem `game_start`.
`state`/`player_joined`/`player_left` circulam **só dentro da sala**. Dono sai → o membro mais antigo herda.
Sala vazia → `rooms` é deletada com cascade (membros e tudo o que referenciar a sala); no boot todas as salas são apagadas.

Tabelas: `rooms` (name, visibility, code, owner_id, status, money, wave) e `room_members` (room_id, player_id único).

## Economia, hotbar e combate (M2)

- **Sem craft e sem inventário**: só a hotbar de 5 slots, que pertence ao servidor (`hotbar` é enviada a cada mudança).
- **Mundo compartilhado**: `shared/worldgen.ts` gera os objetos deterministicamente a partir da seed; o server valida
  `pickup`/`hit_node` por distância e ferramenta equipada e faz broadcast de `object_removed`/`node_hit`.
- **Centro do mapa**: vendedor (E abre a loja: vender todos os recursos da hotbar / comprar machado, picareta, Glock, bateria)
  e a torre (bateria → waves, M3). Preços e valores em `shared/items.ts`; regras em `server/src/game/Economy.ts`.
- **Dinheiro é da sala** (`rooms.money`), broadcast em `money` para todos.
- **Glock** com pente de 10, recarga (R) de 1,5 s; `fire {dx,dz}` → o server faz o raycast (`shared/math.ts`) contra
  outros jogadores (**fire friends**) e responde `shot` a todos (traçante) + `hp`/`player_died`/`player_respawned`.
- **Morte**: respawn automático no centro após 5 s; morto não se move nem interage.
- Simulação em `server/src/game/Match.ts` (uma por sala); testes em `server/test/` (`npm test -w server`).

## API HTTP

| Rota | Descrição |
|---|---|
| `GET /api/health` | status da API e do banco, jogadores online |
| `GET /api/players/online` | jogadores conectados agora (em memória) |
| `GET /api/players?limit=50` | últimos jogadores vistos (banco) |
| `GET /api/rooms` | salas abertas agora |

## Protocolo WebSocket (`/ws`) — ver `shared/protocol.ts`

Client → server: `join {name}`, `room_list`, `room_create {name, visibility}`, `room_join {roomId, code?}`, `room_leave`, `room_set_visibility`, `room_start`, `move {x,z,yaw,anim,crouching}` (20 Hz, só quando muda), `pickup`, `hit_node`, `select_slot`, `sell`, `buy {itemId}`, `fire {dx,dz}`, `reload`, `activate_battery`, `ping`.
Server → client: `welcome {you, tickRate}`, `lobby_state {rooms[]}`, `room_state {room}` (código só para o dono), `game_start {seed, players[], removedObjects[], money, hotbar, equipped}`, `room_left`, `player_joined`, `player_left`, `state {players[], zombies[]}` (por sala, a `WS_TICK_RATE` Hz), `hotbar`, `money`, `item_gained`, `object_removed`, `node_hit`, `shot`, `ammo`, `hp`, `player_died`, `player_respawned`, `knockback`, `wave_state`, `wave_started`, `boss_spawned`, `boss_slam`, `zombie_died`, `phase_complete`, `error {code}`, `pong`.

Regras:
- Identidade = nome (2–16 chars, único sem diferenciar maiúsculas). Se o nome está online, o join é recusado (`name_taken`).
- Client é autoritativo só sobre a própria **pose** (posição/rotação/animação); tudo o mais (hotbar, HP, dinheiro, tiros, objetos do mundo) é decidido no server.
- Abates são restaurados ao entrar de novo com o mesmo nome.

## Waves e boss (M3)

- Compre a **Bateria da Torre** ($150) e coloque na torre (E): primeira wave em 5 s, depois **5 waves** ([8, 12, 16, 22, 30] zumbis). Cada wave tem **90 s para ser limpa** (chefão: 180 s); limpou → próxima em 8 s; **estourou o tempo → a horda some, a bateria é perdida e tudo recomeça da wave 1** com outra bateria.
- **Upgrades** no vendedor (dano +20%/nível, munição +4/nível, recoil −2°/nível, vigor de corrida +25%/nível; 5 níveis): o nível é por jogador, mas o **preço é da sala** — cada compra de um tipo multiplica o próximo preço por 1.35 para todos. A Glock vem com **5 balas** (pente 10; recarregue com R).
- Quantidade, vida e dano escalam ×1.5 por jogador online (`GAME.waves` / `GAME.zombie` em `shared/gameconfig.ts`).
- Zumbis correm a 5.2 (andar do jogador = 4, correr = 7.5): **é preciso correr para fugir**. ~35% da horda são **cuspidores** (roxos): lançam um projétil à distância que dá dano e **lentidão de 50% por 2,5 s**.
- Wave 5 limpa → **chefão** (30× a vida, corre a 6.8, **rajada de 3 cuspes** à distância com lentidão, **investida** com knockback, **pancada em área** com aviso no chão e **invoca 3 zumbis** a cada 20 s). Chefão morto → `phase_complete`, sala vira `FINISHED`.
- Toda a IA roda no servidor (`server/src/game/ZombieSim.ts`, `WaveDirector.ts`); o client só renderiza os `zombies` do `state`
  (`client/src/Systems/ZombieSystem.ts`). Abates contam para quem deu o tiro final.
- `hit_node` tem cadência mínima no server (não dá para derrubar uma árvore mandando 3 hits de uma vez).

## Balanceamento atual

Gravetos e pedras do mapa somam ~$130: o loop esperado é vender → machado ($30) → cortar árvores (3 troncos × $5) → bateria/Glock.
