# WarZombie

Jogo de sobrevivência isométrico, **multiplayer e cooperativo** (até 10 por sala), feito com PlayCanvas + TypeScript.

Você entra com um nome, cria ou escolhe uma sala no lobby (pública ou privada com código) e cai num mapa com um
**vendedor** e uma **torre** no centro. Colete gravetos e pedras, venda, compre machado e picareta para derrubar
árvores e rochas e junte dinheiro — que é **compartilhado por toda a sala**. Com uma **Glock** na mão (e upgrades de
dano, munição, recoil, vigor e mira laser), compre a **Bateria da Antena** e coloque na torre: cada bateria dispara **uma wave** de zumbis
(alguns cospem à distância e deixam você lento) com tempo limite e, no fim dela, um **chefão** com investida,
pancada em área, rajada de cuspes e reforços. Quanto mais jogadores, mais forte a horda. Fogo amigo está ligado — e
quem morre para outro jogador **vira zumbi por 30 s** caçando o assassino. Morreu para zumbi? Volta em 5 s com escudo.
Perdeu o tempo de uma wave? A bateria daquela wave se foi — farme outra (cada vez mais cara) e tente de novo.
Derrube os 5 chefões para concluir a fase 1.

Tecnicamente é um **monolito**: servidor Node/Express + WebSocket autoritativo (toda a simulação roda nele),
Postgres via Prisma e o client Vite servido pelo mesmo processo — um `docker compose up` sobe tudo.

## Arquitetura

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
cp .env.example .env      # preencha a senha do Postgres (e portas, se precisar)
docker compose up --build # http://localhost:3000
```

## Commits

Este repositório usa [Conventional Commits](https://www.conventionalcommits.org/pt-br/): `feat:`, `fix:`, `docs:`,
`refactor:`, `perf:`, `test:`, `build:`, `ci:`, `chore:` — com escopo opcional (`feat(waves): ...`) e `!` para
mudanças incompatíveis. Exemplo: `feat(shop): upgrade de mira laser`.

**Segredos**: todo valor sensível vive só no `.env` (ignorado pelo git). O `docker-compose.yml` não tem senhas padrão —
se faltar variável ele falha com uma mensagem dizendo qual. Nunca escreva chaves/senhas em código, README ou commits.

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
Server → client: `welcome {you, tickRate}`, `lobby_state {rooms[]}`, `room_state {room}` (código só para o dono), `game_start {seed, players[], removedObjects[], money, hotbar, equipped}`, `room_left`, `player_joined`, `player_left`, `state {players[], zombies[]}` (por sala, a `WS_TICK_RATE` Hz), `hotbar`, `money`, `item_gained`, `object_removed`, `node_hit`, `shot`, `ammo`, `hp`, `player_died`, `player_respawned`, `knockback`, `wave_state`, `wave_started`, `boss_incoming`, `boss_spawned`, `boss_slam`, `wave_cleared`, `wave_failed`, `zombie_died`, `phase_complete`, `battery_price`, `player_infected`, `error {code}`, `pong`.

Regras:
- Identidade = nome (2–16 chars, único sem diferenciar maiúsculas). Se o nome está online, o join é recusado (`name_taken`).
- Client é autoritativo só sobre a própria **pose** (posição/rotação/animação); tudo o mais (hotbar, HP, dinheiro, tiros, objetos do mundo) é decidido no server.
- Abates são restaurados ao entrar de novo com o mesmo nome.

## Waves e chefões (M3)

- Compre a **Bateria da Antena** ($150; **o preço sobe ×1.35 a cada compra** na sala) e coloque na torre (E): **cada bateria dispara UMA wave** — a antena precisa das **5 baterias, uma por wave**. Horda em 5 s ([8, 12, 16, 22, 30] zumbis, **90 s** para limpar) → horda limpa → **chefão da wave** em 5 s (**180 s**) → chefão morto → a antena para e **espera a próxima bateria** (nada vem sozinho). A 5ª wave tem o chefão insano; matou → `phase_complete`, sala vira `FINISHED`.
- **Estourou o tempo** (horda ou chefão) → a horda some e a **bateria daquela wave é perdida**: a antena volta a n‑1 baterias e é preciso outra bateria para tentar a mesma wave.
- Dificuldade: quantidade/vida/dano ×1.5 por jogador online; vida ×1.2 e dano ×1.12 por wave; chefão por wave (`GAME.boss.TIER`): vida 8/12/18/26/42× a de um zumbi, dano 0.6→1.3× e 2→6 zumbis invocados por vez. Tudo em `shared/gameconfig.ts`.
- Chefão: corre a 6.8, **rajada de 3 cuspes** à distância com lentidão, **investida** com knockback, **pancada em área** com aviso no chão e **invoca zumbis** a cada 20 s.
- Toda a IA roda no servidor (`server/src/game/ZombieSim.ts`, `WaveDirector.ts`); o client só renderiza os `zombies` do `state`
  (interpolação + animação por estado). Painel ⚙ (`DEV_CHEATS=1`) pula etapas: "Próxima wave" inicia a horda / pula para o chefão / mata o chefão.

## Fogo amigo → modo zumbi

- Matar outro jogador (tiro/faca) transforma a vítima num **zumbi infectado por 30 s** onde ela caiu: modelo do próprio personagem (verde), **3× a vida, 1.5× o dano e velocidade 6.5** (entre andar e correr). O jogador **não controla**: só assiste (câmera segue o zumbi).
- O zumbi **caça quem o matou** a qualquer distância; se ele mata o assassino, **o assassino também vira zumbi** (caçando quem sobrou) — até todos caírem. Zumbi abatido → o dono renasce em 5 s; passados 30 s → volta ao normal na hora, com escudo. Regras em `Match.damagePlayer`/`infect` e `ZombieSim.spawnInfected`.

## Balanceamento atual

Gravetos e pedras do mapa somam ~$130: o loop esperado é vender → machado ($30) → cortar árvores (3 troncos × $5) → bateria/Glock.
