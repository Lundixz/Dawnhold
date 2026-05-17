# Classic Simulation Integration Plan for Dawnhold 👑

This document compiles architectural patterns and core game mechanics to establish a highly detailed, nostalgic, and optimized experience in **Dawnhold** without using proprietary branding. 

Our goal is to build an organic, highly-detailed strategy simulation focusing on fine-grained logistics, spatial atmosphere, and automated worker behaviors.

---

## 🗺️ 1. Eco-Sector Partitioning System
In traditional 2.5D colony sims, the player's territory is not just a visual boundary, but is split into distinct **Eco-Sectors** defined by border outposts. Building construction, logistics, and carrier paths are scoped specifically to the active sector they occupy. Starting a new detached colony (e.g., via a supply cart or sea ship) creates a new, independent Eco-Sector with its own isolated resource pool.

### Implementation in Dawnhold:
We can implement this inside the authoritative background worker thread (`SimWorker.js`) using a **Connected Components algorithm** on the territory ownership map.

```mermaid
graph TD
    TerritoryGrid[Territory Grid Map] --> FloodFill[Flood Fill Area Finder]
    FloodFill --> Sector1[Eco-Sector A: Main Base]
    FloodFill --> Sector2[Eco-Sector B: Mining Colony]
    
    Sector1 --> SupplyA[Carriers fetch local goods only]
    Sector2 --> SupplyB[Carriers fetch local ores only]
    
    Sector1 -- Logistic Supply Routes -- -> Sector2
```

#### Technical Design:
1.  **Sector Identification**: Whenever the territory boundaries shift (e.g., when a military outpost or border tower is manned or destroyed), we run a fast flood-fill algorithm on the territory map to assign a `sectorId` to each owned cell.
2.  **Logistical Scope**: When a carrier settler queries for a transportation task (e.g., "deliver logs to sawmill"), we restrict the search query to resources and buildings that share the exact same `sectorId` as the carrier's current location.
3.  **Pathfinding Optimization**: This drastically reduces A* pathfinding search times because carriers will never attempt to find paths across the entire map if they are cut off by hostile or water borders.

---

## 🎵 2. Spatial 3D Audio & Dynamic Ambient Atmosphere
Colony simulations rely heavily on audio-visual cues to make the environment feel organic and alive. By linking sound effect spatial panning and volume attenuation to the user's viewport camera, players can hear where construction, logging, and mining activities are taking place simply by panning their screen.

### Implementation in Dawnhold (`SoundManager.js`):
Using Howler.js, we manage dynamic volume transitions of faction soundtrack themes and process real-time spatial calculations for environment cues.

#### Spatial Attenuation Formula:
```javascript
// Calculate spatial panning (-1.0 to 1.0) and volume drop-off based on camera coordinates
const dx = screenX - cameraX;
const dy = screenY - cameraY;
const distance = Math.sqrt(dx * dx + dy * dy);

// Volume decreases linearly as distance to viewport center increases
let volume = Math.max(0, 1 - (distance / maxDistance));
volume *= cameraZoom; // Quieter when zoomed out

const pan = Math.min(1.0, Math.max(-1.0, dx / panThreshold));
```

---

## ⚙️ 3. Priority-Driven Goods Distribution & Production
The React user interface exposes fine-grained sliders governing resource allocations (e.g., *Coal: 60% to Iron Smelter vs 40% to Gold Smelter*) and an interactive tool priority queue. The simulation worker must enforce these values to dictate carrier behaviors.

### Implementation:
1.  **Resource Allocation (Sliders)**:
    When a carrier picks up a raw material (like Coal) from a mine, the worker reads the priority settings:
    *   If `coalToIron = 60` and `coalToGold = 40`, we use a simple counter-based distributor. Out of every 10 coal shipments, 6 are routed to the Iron Smelter and 4 to the Gold Smelter.
2.  **Tool Smithy Priority Queue**:
    When a toolmaker has access to steel and coal, it reads the re-orderable priority list `toolQueue`. It identifies the first tool request with `count > 0`, starts production, decrements its count, and pushes a real-time HUD update event back to the main thread.

---

## 🎨 4. Organic Bustle Factor & Dynamic Particle Pools
The charm of classic strategy games lies in their micro-animations and active visual feedback. We leverage a high-performance programmatic particle pool in PixiJS to render activities:

1.  **Chimney Smoke**: Active completed buildings puff grey smoke particles that float upwards, expand, and fade out.
2.  **Soil Splashes**: Diggers working on foundations emit brown soil particles around their boots.
3.  **Scaffold Sparks**: Builders working on active construction scaffolding spray golden wood shavings/particles around their hammers.
4.  **Completed Props**: Windmills have rotating white sails, sawmills have spinning circular blades, and woodcutters have log piles with detailed wood grains.

---

*Created by Dawnhold Systems Architecture Team.*
