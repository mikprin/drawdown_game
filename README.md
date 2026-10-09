# Drawdown

Incremental oil-field management game (see [docs/IDEA.md](docs/IDEA.md)). TypeScript + Vite + PixiJS.

MVP documentation (mechanics, architecture, balance, roadmap): [docs/mvp/](docs/mvp/README.md).

```sh
npm install
npm run dev      # http://localhost:5173
npm test         # simulation tests (vitest)
npm run build    # typecheck + production bundle in dist/
```

## Deploy

```sh
docker compose up -d --build            # http://<server>:8080
PORT=80 docker compose up -d --build    # other host port
```

Multi-stage build: Node runs tests and `vite build`, nginx serves `dist/` (config in `deploy/nginx.conf`). To update: `git pull && docker compose up -d --build`.

Music tracks are not in git: run `scripts/music.sh` (encodes `resources/music/*` into `src/assets/music/`, needs ffmpeg) before building (the Docker build copies the working tree). Without them the game runs silently.

## Layout

- `src/game/` — pure simulation, no DOM. Seeded RNG lives in the state, so runs are deterministic.
  - `balance.ts` — every tunable number (time scale, costs, capacities, market).
  - `reservoir.ts` — pressure `(1 - x)^n` (Arps hyperbolic decline as a function of depletion), water cut sigmoid, P90/P50/P10 estimates.
  - `sim.ts` — one step: market → jobs → plant-constrained flows (separator / water / tanks) → cash → reservoir → wear.
  - `actions.ts` — player actions; `dry = true` validates without mutating (UI uses it for button state and reasons).
  - `explore.ts`, `newGame.ts` — regional map generation and what the player can see through the fog.
  - `save.ts` — localStorage save, offline catch-up (capped at one game year).
- `src/render/` — Pixi scene. `sprites.ts` bakes all art procedurally into textures; replace any baker with real sprites without touching `site.ts`.
- `src/ui/` — HTML/CSS panels around the canvas.
- `scripts/balance.ts` — greedy bot that plays layer 1 and prints a timeline, for pacing work:
  `npx rolldown scripts/balance.ts --file /tmp/b.mjs --platform node && node /tmp/b.mjs <seed> <days>`

In dev builds `window.__drawdown` exposes the state, actions and a `step(days)` helper.
