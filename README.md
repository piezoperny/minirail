<div align="center">

<img src="assets/favicon.svg" width="96" height="96" alt="Mini Rail Icon" />

# Mini Rail

**Minimalist octilinear railway & supply-chain strategy in the browser — zero build step, zero dependencies.**

[![Play Live](https://img.shields.io/badge/PLAY_LIVE-minirail-FF5A3D?style=for-the-badge&logo=googlechrome&logoColor=white)](https://piezoperny.github.io/minirail/)
[![Zero Dependencies](https://img.shields.io/badge/Zero_Build-HTML5_Canvas_%2B_ES6-2563EB?style=for-the-badge)](#architecture--local-development)

</div>

---

## Fleet & Supply-Chain Guide

Mini Rail pairs **Passenger** transit with **Industrial Freight** logistics on a shared octilinear network:

| Service | Silhouette | Role & Route | Terrain & Handling |
| :--- | :--- | :--- | :--- |
| **Passenger** (`Bullet`) | Streamlined rounded capsule with panoramic windshield & glowing windows | Carries **Commuters** (`Hamlets / Towns → Cities`), **Local Travelers** (`Cities → Towns`), and color-coded **Intercity Tickets** (`City ↔ City`). | Fast (`155 u/s`) on flat ground; slows on un-tunneled Hills (`0.60×`). |
| **Freight** (`Hopper`) | Squared dark-steel chassis with heavy side-girders & 3 ribbed cargo bays | Hauls **Raw Materials** (`Forest / Mine → Factory`) and **Manufactured Goods** (`Factory → Hamlets & Towns`) to grow settlements into Cities. | Steady (`100 u/s`) with minimal Hill grade penalty (`0.90×`). |

### Geography & Infrastructure
- **Rivers & Lakes (Bridges):** Track segments crossing rivers or lake basins automatically consume **1 Bridge** token (reclaimed when the segment is removed).
- **Alpine Mountains (Tunnels):** Bold faceted mountain massifs cannot be built on directly. Routing a track through a Mountain automatically consumes **1 Tunnel** token (reclaimed on removal).
- **Rolling Hills:** Contoured foothills can be climbed freely with a grade slowdown, or upgraded by dragging a **Tunnel** token onto the hill segment for full-speed passage.
- **Double-Track & Interchanges:** Drag **Double-Track** onto busy corridors for two-way passing & overtaking, **+Carriage** onto any train (up to 4 cars), and **Interchange** onto congested stations (`+6` capacity & `2.5×` faster boarding).

---

## Controls & Gestures

| Action | Gesture / Shortcut |
| :--- | :--- |
| **One-Stroke Line Building** | Left-click & drag from any station or line T-bar across `A → B → C → D` to connect hops live in a single sweep; sweep back over the previous station to unwind. |
| **Pull-Back T-Bar Shortening** | Grab a line's T-bar end and pull backward past the endpoint (`≥ 34u`) to pop it off live; release in empty space to shorten, or sweep onward to reroute. |
| **Pull-Out Middle-City Unhook** | Drag an interior station on an active line outward (`≥ 28u`) into empty paper to bypass it (`A–B–C → A–C`), or drop onto another station to reroute. |
| **Remove Station / Clear Line** | Right-click a station to unhook it from a line, or right-click a line pill in the bottom dock to clear the entire route. |
| **Deploy & Upgrade** | Drag **Passenger**, **Freight**, **+Carriage**, **Double-Track**, **Tunnel**, or **Interchange** tokens from the bottom dock directly onto tracks, trains, or stations. |
| **Zoom & Pan** | Scroll wheel or pinch to zoom (`0.45×–2.50×`) around the cursor. Drag empty paper, middle-drag, or hold `Space` + drag to pan. |
| **Line Spotlighting** | Hover or select a line pill in the bottom dock to spotlight its route and trains. |
| **Fit Map** | `F` or `0` |
| **Day / Night Mode** | `N` (or click `☾` in the top-right HUD) |
| **Speed & Pause** | `Space` (Pause/Resume), `1` (1×), `2` (2×) |
| **Mute Audio** | `M` |

---

## Map Archetypes & Endless Mode

Every new game generates a fresh procedural seed (shareable via `?seed=<number>`) across **4 distinct map archetypes**:

1. **Confluence** — A Y-fork river confluence splitting around a central peninsula.
2. **Mountain Pass** — A central Alpine Mountain Range dividing two valleys with a narrow natural saddle pass.
3. **Lake Basin** — A broad organic central lake & island basin fed by valley tributaries.
4. **Canyon Gorge** — A dramatic S-bend canyon river flanked by alternating mountain crags and rolling hills.

**Endless Mode:** If a station overflows and ends service, click **Continue in Endless** on the Game Over modal to clear overflow timers and keep expanding your railway indefinitely without overcrowding game-overs.

---

## Architecture & Local Development

Mini Rail is built with **Vanilla HTML5 Canvas, CSS3, and native ES6 modules** — no bundler, transpiler, or `npm install` required.

```text
minirail/
├── index.html          # App shell, HUD, dock, modals, and OpenGraph metadata
├── style.css           # Day/Night themes, glassmorphic HUD, responsive layout
├── assets/
│   ├── favicon.svg     # Transit Junction vector emblem
│   └── og-card.png     # 1200×630 social preview card
└── src/
    ├── main.js         # Bootstrap, ?seed= parsing, fixed-timestep game loop
    ├── state.js        # Config, Day/Night palettes, camera & state schema
    ├── mapGen.js       # 4 map archetypes, rivers/lakes/mountains, octilinear spines
    ├── simulation.js   # Supply chain, multi-train spacing, bridges/tunnels, Endless
    ├── renderer.js     # Layered Canvas renderer (terrain, tracks, bullet/hopper trains)
    ├── input.js        # One-stroke sweep, pull-out gestures, zoom/pan, drag-and-drop
    ├── ui.js           # Dock, weekly draft modal, audio chimes, Endless & Help modals
    └── fx.js           # Particle & pulse effects
```

### Run Locally

Serve the repository root with any static HTTP server:

```bash
python3 -m http.server 8000
```

Then open [http://localhost:8000](http://localhost:8000) in your browser.
