# God Mode — Civilisation Simulator

A headless, tick-based Stone Age civilisation engine with a real-time telemetry
dashboard. The engine runs autonomously in the background on a Linux VPS; the
dashboard streams what is happening and lets you intervene as a god.

```
┌──────────────────────────────────────────────────────────────┐
│  Fastify process (one container, one port)                   │
│                                                              │
│   Simulation kernel ──► SSE hub ──► browser dashboard        │
│     tick loop            /api/stream                         │
│     typed-array grid                                         │
│     agent FSM          REST ◄──── god interventions          │
│     tribal dynamics      /api/god/*                          │
│          │                                                   │
│          └──► JSON snapshot ──► /data volume (survives boot) │
└──────────────────────────────────────────────────────────────┘
```

---

## Quick start

### Docker (what you want on a droplet)

```bash
git clone <your-repo> civilisation && cd civilisation
cp .env.example .env          # set ADMIN_TOKEN before exposing this publicly
docker compose up -d --build
```

Dashboard: `http://<host>:8080`

### Local development

```bash
npm run install:all
npm run dev:server            # engine + API on :8080
npm run dev:web               # dashboard on :5173, proxying /api to :8080
```

### Headless benchmark

Runs the engine with no server attached — the fastest way to sanity-check a
balance change or size a droplet:

```bash
npm run bench 3000
```

On one core of a modern laptop a 128×128 world sustains **~2,900 ticks/second**
with ~500 living agents, so real-time at 1 tick/second uses well under 1% CPU.

---

## Project structure

```
.
├── server/                     # engine + API (TypeScript, Fastify)
│   └── src/
│       ├── engine/
│       │   ├── types.ts        # domain types, biome profiles, tech tree
│       │   ├── rng.ts          # seeded PRNG + value-noise fBm
│       │   ├── world.ts        # tile grid (typed arrays) + terrain generation
│       │   ├── names.ts        # tribe identities, validated colour slots
│       │   ├── agents.ts       # agent lifecycle and needs-driven FSM
│       │   ├── tribes.ts       # territory, research, diplomacy, fission
│       │   ├── simulation.ts   # the tick loop and every god intervention
│       │   └── snapshot.ts     # atomic JSON persistence
│       ├── api/routes.ts       # REST + SSE endpoints
│       ├── stream/hub.ts       # SSE fan-out
│       ├── runner.ts           # tick scheduling, snapshot cadence, broadcast
│       ├── config.ts           # env-driven configuration
│       └── index.ts            # process entrypoint
├── web/                        # dashboard (React + Vite + Tailwind)
│   └── src/
│       ├── components/         # WorldMap, VitalsCard, TribeTable, EventLog,
│       │                       # GodConsole, TilePanel, OccupationBar
│       └── lib/                # SSE hook, REST client, wire types
├── Dockerfile                  # multi-stage build
├── docker-compose.yml
└── .env.example
```

---

## World model

A 2D grid (128×128 by default) held in flat typed arrays — a full world is
under 1 MB, and the per-tick regeneration sweep is a linear scan over
contiguous memory.

| Biome | Food | Water | Wood | Stone | Notes |
|---|---|---|---|---|---|
| Deep Water | — | — | — | — | impassable |
| River / Shallow | good | full | — | — | hydration, fishing bonus |
| Plains | best | low | low | low | ideal foraging and cultivation |
| Forest | good | low | **high** | low | fuel, lumber, hunting grounds |
| Hills | low | — | med | **high** | defensive, flint and stone |
| Mountain | poor | — | low | **highest** | slow to cross |
| Barren / Desert | poor | — | — | low | movement penalty |

Every tile tracks its own `food`, `water`, `wood`, `stone` and
`carrying_capacity`, all of which regenerate toward a biome- and
season-dependent cap when they are not being depleted.

Terrain is generated from two fBm noise fields (elevation, moisture) with a
radial falloff, then classified **by quantile rather than by absolute
threshold** — noise output is roughly Gaussian, so fixed cut-offs produced
worlds with no hills or mountains at all, and therefore no stone for
toolmaking. Ranking the tiles guarantees every seed yields a full spread of
terrain. Rivers are then carved by walking downhill from wet highlands.

---

## Agents and tribes

Each agent carries age, health, hunger, thirst, stamina and morale, plus three
heritable traits — **aggression**, **inquisitiveness** and **hardiness** — that
are inherited from both parents with mutation.

The FSM runs in strict priority order:

```
Rest (exhausted) → Seek Water → Forage / Hunt / Fish → Fight (if mobilised)
  → Seek Shelter → Deposit at camp → Craft / Build → Reproduce
  → gather surplus for the tribe → Socialise / Explore
```

Deaths come from starvation, thirst, exposure, disease, hunting accidents,
combat and old age.

**Tribes** accumulate collective knowledge from every adult each tick, scaled by
curiosity:

| Technology | Effect |
|---|---|
| Fire Handling | fewer cold deaths, cooking raises calorie yield |
| Flint Knapping | better hunting and gathering yield, stronger in combat |
| Mud Huts | permanent dwellings, raises tile carrying capacity |
| Plant Domestication | converts fertile tiles into cultivated plots |
| Warfare & Palisades | weapons, fortification, larger war bands |

Tribes claim territory around their camp (radius grows with population),
relocate when the land is exhausted, and **fission** into daughter tribes when
they outgrow what their territory can feed. A splinter band only carries a
technique away if someone who knows it goes along, so tech levels stay uneven
across the map.

Neighbours drift toward **trade** (food for tools, plus technology diffusion)
when both are comfortable, and toward **war** when scarcity, aggression and
contested land pile up. A tribe bled down to a handful of survivors next to a
much larger enemy is **subjugated** — its people change allegiance rather than
dying, which is what actually happened to most groups that lost a territorial
war.

---

## Dashboard

Fixed-height layout: on a wide screen nothing scrolls, and every pane scrolls
internally, so the map, the tribal table, the ticker and the console are all on
screen at once.

- **World map** — a canvas painted from one `ImageData` write per frame:
  terrain, rivers, cultivated plots, huts, blessed/cursed ground, tribal
  territory washes and live agent positions. Click any tile to inspect it and
  to target god actions.
- **Global vitals** — population (with age structure), active tribes, birth and
  death counts and rates, current tick, season and temperature, elapsed time,
  observed ticks/second.
- **Tribal breakdown** — population by age band, food, territory, occupation
  distribution, unlocked technologies; expand a row for research progress,
  morale, aggression and diplomatic relations.
- **World event log** — settlements, discoveries, migrations, trade pacts, war
  declarations, skirmishes, disasters and divine acts, filterable, with
  click-to-locate coordinates.
- **God console** — every intervention below, targeted by clicking the map.

### Tactical map (`#/map`)

A second, full-screen view for watching people rather than statistics — reached
from the **⛶ Tactical map** button in the dashboard header.

- **Zoom and pan** — scroll to zoom at the cursor, drag to pan, `+` / `-` to
  zoom, `f` to re-frame the world. Ranges from the whole world in view to 40
  pixels per tile, where individual people are plainly visible.
- **Movement trails** — each person's recent positions are stitched together by
  id and drawn as a fading tail, so you can see foragers streaming toward a
  river or a war band converging on a camp. Toggle with `t`.
- **Heading ticks** — past ~8 px/tile each person shows a short line toward
  wherever they are currently walking.
- **Tile grid** — appears past 9 px/tile, so god actions can be aimed exactly.
- **Overlays** — *Terrain* (biomes with a light territorial wash), *Territory*
  (claims at full strength) and *Forage* (food saturation), which is the one to
  use when deciding where a blessing or a curse would actually land.
- **Hover readout** — biome, forage level, owning tribe, and how many people are
  on the tile and what they are each doing.
- **Docked god console** — the same console as the dashboard, targeted by
  clicking a tile; the selection ring previews the action radius before you fire.

The map opts into a heavier stream (`/api/stream?detail=1`) carrying agent ids,
states and targets plus the forage overlay. The dashboard never requests it, and
the server only builds that payload when a map view is actually attached — so
running a wall-mounted dashboard costs nothing extra.

### Tribal statistics (`#/tribes`)

Every figure the engine holds about every tribe, in one sortable table.

- **22 sortable columns** — population and its age structure, territory, food
  store, tools, technologies, morale, aggression, hardship, cumulative births
  and deaths, net growth, war kills, active wars and trade pacts, camp
  coordinates and live occupation mix. Click any header to sort; click again to
  reverse.
- **Derived per-head figures** are first-class: comparing tribes of different
  sizes by absolute food is misleading, and *food per head* is the number that
  actually predicts a famine.
- **Magnitude bars** behind population, territory and food, scaled to the
  current leader, so the pecking order reads without comparing digits.
- **Totals row** across whatever the filter currently shows.
- **Expandable rows** with research progress, the full occupation breakdown and
  named diplomatic relations.
- **CSV export** of the current sort and filter, for taking a run's numbers
  elsewhere.
**All-time records** (the *Records* tab) covers every tribe that has ever
existed, living and ended, in one sortable table: founding and final year,
lifespan, peak population and the year it was reached, peak territory, peak
food store, most technologies ever known, everyone ever born and died, enemies
slain, and how it ended — died out, or subjugated and by whom.

Peaks are high-water marks kept on the tribe itself, not derived from the
history buffer: that is a ring buffer, and a record that can age out of one is
not a record. A peak reached three centuries ago and never matched since is
exactly the thing worth seeing, so it has to survive the samples being dropped.
Peaks that predate tracking show as `—` rather than `0`, which would assert
something false. The engine keeps the last 80 tribes that ended.

### History (`#/history`)

The world's memory. Aggregates are sampled on a stride and kept in columnar
arrays, so you can ask when the population peaked, whether a drought actually
hurt, or which tribe was ascendant two centuries ago.

- **Population by age** as a stacked area — the shape of the age pyramid over time
- **Births and deaths** per sample; the crossing is the turn from growth to decline
- **Tribes alive and wars under way** — fission raises the count, conquest lowers it
- **Territory, communal food, temperature and technologies known**
- **Rise and fall of every tribe** — one line per people, in its own colour.
  Series for extinct tribes are kept and marked †; their arc is the most
  interesting part of the record.

A single crosshair tracks the same instant across every chart at once, with one
shared readout, which is what makes cause and effect legible — a temperature
trough lining up with a food collapse and a death spike.

History survives restarts, and older samples are dropped once the buffer is
full (1,200 samples by default, one per 8 ticks — roughly 100 simulated years).

### Tribe generations

Totems are freed for reuse when a tribe dies, so a long-running world produces
several unrelated peoples called "Tribe of the Wolverine". Every tribe therefore
carries a generation: **Tribe of the Wolverine III** is the third to bear that
totem, and a records table reads as a dynastic list — `Boar VI (alive)` back
through `Boar I (subjugated)`.

The counter lives on the simulation and is persisted, rather than being derived
from the fallen-tribe chronicle: that is capped at 80, so over a long run it
would undercount and start reissuing numbers already used.

### A note on the colours

Tribe identity is a categorical colour encoding on a dark surface, so the
palette was picked by search and checked with a validator rather than by eye.
Slots 1–6 pass every gate on the all-pairs list (worst CVD ΔE 9.2, worst
normal-vision ΔE 16.3, all ≥ 3:1 contrast against the map). That is the largest
set that *can* pass: red and green collapse into each other under deuteranopia
no matter how the hues are ordered.

Slots 7–14 extend the range for busy worlds and fall into the 6–8 CVD band,
which is only legal alongside secondary encoding — so every surface that shows
a tribe also shows its totem glyph and its name, and the map's tile inspector
names the owner outright. Simultaneous tribes are capped at 14 so a colour slot
is never recycled onto a different tribe.

---

## API

### Telemetry (open)

| Method | Path | Returns |
|---|---|---|
| `GET` | `/api/health` | liveness, tick, population, connected clients |
| `GET` | `/api/state` | full bootstrap payload (terrain, vitals, tribes, events) |
| `GET` | `/api/stream` | **SSE**: `init` once, then a `frame` per tick |
| `GET` | `/api/stream?detail=1` | as above plus agent ids/states/targets and the forage overlay |
| `GET` | `/api/vitals` | global vitals |
| `GET` | `/api/history?limit=` | recorded aggregates over time, columnar |
| `GET` | `/api/tribes` | tribal breakdown rows, plus the `fallen` chronicle |
| `GET` | `/api/events?limit=` | recent world events |
| `GET` | `/api/tile?x=&y=` | full detail for one tile |
| `GET` | `/api/world/terrain` | base64 terrain + ownership arrays |
| `GET` | `/api/tech` | technology definitions and costs |

The stream sends terrain **once**, then per-tick diffs of only the tiles that
changed, plus agent positions packed as base64 `Int16` triples. Frames are
capped at ~10/second, so fast-forwarding the simulation never floods a browser.

### God interventions (gated by `ADMIN_TOKEN`)

All are `POST` with a JSON body; send the token as an `X-Admin-Token` header.

| Path | Body | Effect |
|---|---|---|
| `/api/god/pause` | `{paused?}` | halt or resume time (toggles if omitted) |
| `/api/god/speed` | `{tickMs}` | set tick rate (20 ms – 60 s) |
| `/api/god/terraform` | `{x,y,radius,biome}` | `river`, `plains`, `forest`, `hills`, `mountain`, `desert`, `deep_water` |
| `/api/god/bless` | `{x,y,radius,ticks}` | rapid resource replenishment |
| `/api/god/curse` | `{x,y,radius,ticks}` | drought and resource decay |
| `/api/god/disaster` | `{kind,x,y,radius,ticks,magnitude}` | `flood`, `long_winter`, `pestilence`, `famine`, `megafauna` |
| `/api/god/food` | `{amount, tribeId? \| x,y,radius}` | spontaneous food cache |
| `/api/god/inspire` | `{tribeId, tech?}` | instant technology unlock |
| `/api/god/births` | `{count, tribeId?}` | spontaneous birth wave |
| `/api/god/smite` | `{x,y,radius} \| {tribeId,percent?} \| {percent}` | targeted, tribal or global cull |
| `/api/god/tribe` | `{x,y,size}` | found a new tribe |
| `/api/god/decree` | `{a,b,rel}` | force `war`, `trade` or `neutral` |
| `/api/god/reset` | `{seed?}` | destroy the world, generate a new one |

```bash
# Flood the eastern basin
curl -X POST http://localhost:8080/api/god/disaster \
  -H 'Content-Type: application/json' -H "X-Admin-Token: $ADMIN_TOKEN" \
  -d '{"kind":"flood","x":90,"y":64,"radius":8}'
```

---

## Checks

```bash
npm run bench 3000        # throughput and an end-of-run summary
npm --prefix server run check    # 17 invariant and outcome assertions
```

`check` runs a seeded world and asserts both the things that must hold at every
instant — agents inside the world and belonging to a living tribe, tile
ownership agreeing with tribal territory, no negative stores, unique tribe
colours, an unlocked technology being fully researched — and the things that
must be true of a run worth looking at: humanity survives, every biome exists,
technology advances, people are both born and dying, and no single occupation
swallows the population.

Every balance bug this project hit was mechanically detectable and was instead
found by reading bench output and squinting at screenshots. Pass a seed as the
second argument (`npm --prefix server run check -- 3000 42`) to check that a
change holds up beyond one lucky world.

Balance constants all live in `server/src/engine/tunables.ts` — a tuning pass is
a diff against one file rather than a hunt through the behaviour code.

## Persistence

World state lives in memory for tick throughput and is snapshotted to
`$DATA_DIR/world.json` every `SNAPSHOT_EVERY_TICKS` ticks, and once more on
`SIGTERM`. Writes go to a temporary file and are `rename`d into place, so a
reboot mid-write cannot corrupt the snapshot. On boot the engine resumes from
it unless `RESUME=false`.

Typed arrays are base64-encoded, so a 128×128 world with ~500 agents is about
780 KB on disk.

---

## Configuration

Every value has a working default; see `.env.example`.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` / `HOST` | `8080` / `0.0.0.0` | listen address |
| `WORLD_WIDTH` / `WORLD_HEIGHT` | `128` | grid dimensions |
| `WORLD_SEED` | `20260908` | deterministic world seed |
| `TICK_MS` | `1000` | ms per tick (changeable live) |
| `STARTING_TRIBES` / `STARTING_AGENTS` | `6` / `12` | initial seeding |
| `MAX_AGENTS` | `6000` | hard population ceiling |
| `DATA_DIR` | `/data` | snapshot directory |
| `SNAPSHOT_EVERY_TICKS` | `60` | persistence cadence |
| `RESUME` | `true` | resume from snapshot on boot |
| `ADMIN_TOKEN` | *(empty)* | **required header for `/api/god/*` when set** |
| `CORS_ORIGIN` | `*` | comma-separated allowed origins |
| `EVENT_LOG_SIZE` | `600` | event ring-buffer size |
| `HISTORY_STRIDE` | `8` | ticks between history samples |
| `HISTORY_MAX_SAMPLES` | `1200` | history samples retained |
| `HISTORY_MAX_TRIBE_SERIES` | `40` | per-tribe history series retained |

World-generation variables only apply when there is no snapshot to resume (or
`RESUME=false`) — otherwise the persisted world wins.

---

## Deploying to a fresh Ubuntu droplet

```bash
# 1. Install Docker (official convenience script)
ssh root@YOUR_DROPLET_IP
apt-get update && apt-get install -y ca-certificates curl git
curl -fsSL https://get.docker.com | sh

# 2. Get the project onto the droplet
#    (a) from a git remote, if you have one:
git clone <your-repo> /opt/civilisation

#    (b) or copy it straight from your machine — run this LOCALLY, not on the
#        droplet. node_modules is excluded deliberately: it holds native
#        binaries built for your laptop's OS, which will not run on Linux.
#    rsync -avz --delete \
#      --exclude node_modules --exclude dist --exclude server/public \
#      --exclude .localdata --exclude .idea --exclude .git --exclude .env \
#      ./ root@YOUR_DROPLET_IP:/opt/civilisation/

cd /opt/civilisation

# 3. Configure — set a real admin token, or anyone can wipe your civilisation
cp .env.example .env
sed -i "s/^ADMIN_TOKEN=.*/ADMIN_TOKEN=$(openssl rand -hex 24)/" .env
grep ADMIN_TOKEN .env

# 4. Launch
docker compose up -d --build

# 5. Open the firewall
ufw allow OpenSSH && ufw allow 8080/tcp && ufw --force enable
```

Then open `http://YOUR_DROPLET_IP:8080`, paste the token into the console's
**Admin token** field, and the god powers unlock.

```bash
docker compose logs -f civ-engine     # watch the engine
docker compose restart civ-engine     # restart (resumes from snapshot)
docker compose down                   # stop; the world volume persists
docker volume rm civilisation_civ-data  # delete the world for good
```

`restart: unless-stopped` brings the engine back after a droplet reboot, and
`dumb-init` forwards `SIGTERM` so a final snapshot is written before the
container stops.

### Putting TLS in front of it

Set `BIND_ADDR=127.0.0.1` in `.env` so the port is not exposed publicly, then
point a reverse proxy at it. SSE needs buffering disabled:

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Connection '';
    proxy_buffering off;          # required — SSE must not be buffered
    proxy_read_timeout 24h;
}
```

---

## Sizing

| Droplet | World | Comfortable population |
|---|---|---|
| 1 vCPU / 1 GB | 128×128 | ~2,000 agents at 1 tick/s |
| 2 vCPU / 2 GB | 192×192 | ~6,000 agents, fast-forward usable |

The runtime image is ~250 MB and the engine holds a 128×128 world in well
under 100 MB of heap, so the compose file's 900 MB cap is headroom rather than
a constraint.

The engine is single-threaded by design: one tick is one deterministic pass, so
throughput scales with clock speed rather than core count. Run `npm run bench`
on the target box to measure before raising `MAX_AGENTS`.

---

## Security

`ADMIN_TOKEN` is empty by default so local development needs no setup — which
means **an unconfigured public deployment lets any visitor trigger plagues,
floods and population wipes.** Set it before exposing the port. The token is
sent as a header (never a query parameter, so it stays out of proxy logs) and
stored in the browser's `localStorage`. Telemetry endpoints stay open; only
`/api/god/*` is gated.
