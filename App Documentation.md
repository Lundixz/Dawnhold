# App Documentation - Dawnhold

Welcome to **Dawnhold**, a modern, web-based, GPU-accelerated strategy game heavily inspired by the classic **Settlers 4** (Die Siedler IV). This document defines the comprehensive architecture, design principles, optimization strategies, and implementation plan for the project.

---

## 📖 Table of Contents
1. [Game Vision & Core Mechanics](#1-game-vision--core-mechanics)
2. [Technical Architecture & Libraries](#2-technical-architecture--libraries)
3. [Memory & CPU Optimization Strategy](#3-memory--cpu-optimization-strategy)
4. [Client-Server Workload Balancing](#4-client-server-workload-balancing)
5. [Database & Directory Structure](#5-database--directory-structure)
6. [Phased Implementation Roadmap](#6-phased-implementation-roadmap)

---

## 1. Game Vision & Core Mechanics

Dawnhold aims to recreate the rich, organic, and lively atmosphere of **Settlers 4**. The player manages a colony, sets up complex production chains, and expands their territory using automated settlers, eventually building a military to defeat rivals.

### A. Isometric 2.5D Grid & Terrains
*   **Tile-Based Map**: An isometric grid of tiles (e.g., 64x64, 128x128, or 256x256).
*   **Height Map (Deformable Terrains)**: Tiles have elevation levels. Elevation affects walking speed, construction viability, and ranged military units.
*   **Biomes**: Lush green meadows, dense forests, rocky mountains, sandy beaches, swampy lands, and desert areas.
*   **Territory Borders**: Visualized by custom-rendered boundary lines. Player territory expands dynamically when a military tower/castle is constructed and staffed.

### B. The Settler Automation System
Unlike typical RTS games (like Age of Empires), the player **does not directly control civilian settlers**.
*   **Path & Road Infrastructure**: The player lays down roads/paths. Carriers automatically walk along these paths to transport materials.
*   **Dynamic Role Allocation**: Settlers are automatically recruited from a pool of unemployed "free settlers" living in residences:
    *   **Carriers**: Move materials from production buildings to stockpiles or construction sites.
    *   **Diggers**: Flatten the isometric terrain at a construction site before construction starts.
    *   **Builders**: Construct the building once the land is flat and materials are delivered.
    *   **Specialists (Pioneers, Geologists, Thieves)**: Manually controlled or semi-automated units. Geologists search for ores; Pioneers expand borders by digging.
*   **Economy Chains (The Settlers 4 Standard)**:
    ```mermaid
    graph TD
        Wood[Wood] --> Woodcutter[Woodcutter] --> Log[Logs]
        Log --> Sawmill[Sawmill] --> Planks[Planks/Building Material]
        Log --> CharcoalBurner[Charcoal Burner] --> Charcoal[Coal]
        
        Stone[Stone Mountain] --> Stonecutter[Stonecutter] --> StoneBlocks[Stone Blocks]
        
        Water[Water Source] --> WaterProducer[Water Works] --> WaterBarrel[Water]
        Grain[Grain Farm] --> GrainMill[Grain Mill] --> Flour[Flour]
        Grain --> PigFarm[Pig Farm] --> Pigs[Pigs] --> Slaughterhouse[Meat]
        
        Flour & WaterBarrel --> Bakery[Bakery] --> Bread[Bread]
        
        Coal & IronOre --> IronSmelter[Iron Smelter] --> IronBars[Iron Bars]
        Coal & GoldOre --> GoldSmelter[Gold Smelter] --> GoldBars[Gold Bars]
        
        IronBars & Charcoal --> WeaponSmithy[Weapon Smithy] --> Swords_Bows[Swords, Bows, Armor]
        IronBars & Charcoal --> ToolSmithy[Tool Smithy] --> Tools[Axes, Pickaxes, Scythes, Shovels]
        
        Swords_Bows & GoldBars --> Barracks[Barracks] --> Soldiers[Soldiers]
    ```

### C. Combat & Territory Control
*   **Territory Rules**: Players can only build inside their territory.
*   **Towers and Castles**: Staffing a tower with a soldier claims a radius of land. If the enemy captures or destroys the tower, the territory reverts or changes ownership, disabling any enemy buildings in that area.
*   **Soldiers**: Divided into Swordsmen, Bowmen, and Spearmen, with tiered upgrades powered by Gold Bars.

### D. Settlers 4 Aesthetic & Audiovisual Polish
To capture the exact soul and beauty of Settlers 4, Dawnhold will implement several key features that went beyond simple mechanics to create the iconic "lively" experience:

1.  **The "Wuselfaktor" (Bustle Factor & Visual Life)**:
    *   **Ambient Wildlife**: Idle sprites of butterflies fluttering over meadows, rabbits hopping through forests, and fish leaping out of water bodies.
    *   **Activity Indicators**: Smoke puffing dynamically from building chimneys only when the building is active. Water wheels in watermills rotating. Wheat growing tall visually in fields before harvest.
    *   **Settler Micro-Animations**: Detailed idle behaviors where carriers wipe their sweat, diggers stretch their backs, or geologists jump with joy upon finding gold.

2.  **Dynamic Acoustic Ambience & Symphonic Soundtrack**:
    *   **Spatial Sound Effects**: Using the *Web Audio API (or Howler.js)*, sound effects will be panned and attenuated based on the camera position. Zooming in on a woodcutter plays clear axe chops; panning over a mountain plays clanking mines; moving near a bakery plays crackling ovens.
    *   **Dynamic Symphonic Music**: We will support dynamic audio crossfading. When the player is peacefully building, the soundtrack is warm and melodic (reminiscent of Haiko Ruttmann's symphonic compositions). If the camera pans near an active combat zone, the soundtrack dynamically fades into tense, dramatic orchestral themes.

3.  **The Unique Factions & The Dark Tribe (Mörka Stammen)**:
    *   **Faction Architecture**: Each faction (Romans, Vikings, Mayans) has its own distinct building designs, color highlights, and specialized units.
    *   **The Dark Tribe Mechanics**:
        *   **Corrupted Ground**: The Dark Tribe spreads dark, corrupted, purple soil that suffocates life, rendering the land barren and unbuildable.
        *   **Gardeners (Trädgårdsmästare)**: The antidote unit. Players recruit Gardeners who walk onto corrupted soil, planting flowers and restoring the soil to rich green grass step-by-step.
        *   **Spells & Mana**: Priests can channel mana accumulated from temple sacrifices to cast powerful miracles, like turning desert into lush grass or summoning resource chests.

4.  **The Classic Left-Side UI & HUD Architecture**:
    *   **The Left Sidebar (Control Center)**:
        *   **Circular Category Tabs**: Replicating the classic look, a row of beautiful circular tabs at the top of the sidebar allows the player to switch between:
            1.  *Construction*: Access to building menus.
            2.  *Settler Statistics*: Population distribution, occupations, and manual role overrides.
            3.  *Economy*: Resource distribution, tool/weapon queue priorities, and trade logs.
            4.  *Military & Magic*: Recruit soldiers, view mana levels, and cast spells.
        *   **Nested Building Menus**: Selecting the *Construction* tab opens four distinct categories matching the Settlers 4 classification:
            *   *Basic Materials*: Woodcutter, Sawmill, Forester, Stonecutter, Residences.
            *   *Food & Farming*: Grain Farm, Grain Mill, Bakery, Pig Farm, Slaughterhouse, Water Works, Fisher.
            *   *Mining & Smelting*: Coal, Iron, and Gold Mines, Iron and Gold Smelters, Weapon Smithy, Tool Smithy.
            *   *Military & Religion*: Towers, Castles, Barracks, Temples, decorative statues.
        *   **Bottom-Left Circular Minimap**: Seamlessly integrated into the bottom portion of the sidebar, framed in decorative stone/metal with surrounding buttons for zoom levels, map filters, and alert pings.
        *   **Context-Sensitive Entity Inspector**: Selecting a building or settler opens an elegant panel in the sidebar showing detailed data:
            *   *For Buildings*: Productivity efficiency percentage (%), active worker portrait, queue of required materials, and stock of finished goods.
            *   *For Settlers*: Name, current task (e.g., "Carrying Wood to Sawmill"), health bar, and home building.
    *   **The Top HUD (Resource & Population Bar)**:
        *   A horizontal bar running across the top screen edge with custom-crafted, glowing icons for critical assets:
            *   *Building Materials*: Wood and Stone.
            *   *Ores & Bars*: Coal, Iron Ore, Iron Bars, Gold Ore, Gold Bars.
            *   *Food*: Bread, Meat, Fish.
            *   *Demographics*: Active Carriers / Idle Free Settlers / Max Population Cap.
            *   *Military Strength*: Active combat power and army size.
    *   **Dynamic Faction UI Skins**:
        *   The UI frames, textures, and button borders dynamically shift based on the player's chosen faction:
            *   *Romans*: Classical polished white marble, red stone borders, and clean golden trims.
            *   *Vikings*: Dark oak wood planks, runic iron carvings, and chainmail textures.
            *   *Mayans*: Carved mossy stone blocks, jade green accents, and snake carvings.
            *   *Dark Tribe*: Pulsing obsidian stone, purple glowing cracks, and corrupted leaf motifs.
    *   **Economic Priority Controls**:
        *   *Resource Distribution Sliders*: Sliders to dictate resource flows. For instance, players can adjust priority sliders to distribute Coal: "60% to Iron Smelters, 40% to Gold Smelters".
        *   *Tool & Weapon Queue Priorities*: A queue slider where the player can configure the Weapon Smithy (e.g., "produce 3 swords, 1 bow, 1 armor, then repeat") and the Tool Smithy (e.g., "produce axes when woodcutters are short, scythes when farmers are short").

---

## 2. Technical Architecture & Libraries

To achieve Settlers 4 style visuals at a rock-solid 60 FPS in a web browser, we must leverage hardware acceleration and optimal networking frameworks. Below is the approved high-performance library stack:

### A. GPU Rendering & Visuals
*   **Primary Renderer: PixiJS (v8)**
    *   *Why PixiJS?* It is an ultra-fast HTML5 2D rendering engine with native **WebGL 2 and WebGPU** support. It handles automatic sprite batching, texture atlasing, and particle systems directly on the GPU, allowing us to render thousands of settlers, trees, and buildings at 60 FPS.
*   **Grid Rendering: `@pixi/tilemap`**
    *   *Why it's essential:* Instead of creating individual `PIXI.Sprite` objects for all 16,384 tiles (in a 128x128 map) which would crash the renderer, `@pixi/tilemap` builds a **single, dynamic GPU mesh** for the entire map. It draws the entire terrain in a **single GPU draw call**, achieving blazing-fast rendering speeds.
    *   *Isometric Projection:* The client engine maps isometric coordinates (`screenX = (isoX - isoY) * (tileWidth / 2)`, `screenY = (isoX + isoY) * (tileHeight / 2) - elevation`) before feeding the vertex buffer to the tilemap mesh.
*   **Animations**: Built using texture atlases (spritesheets) packed via tools like TexturePacker, ensuring all settler walk cycles (8 directions), mining, chopping, and idle animations share a single GPU texture bind.

### B. Spatially Panned Audio & Dynamic Music
*   **Audio Controller: Howler.js**
    *   *Why Howler.js?* It wraps the low-level HTML5 Web Audio API, resolving cross-browser compatibility headaches and unlocking advanced audio features easily.
    *   *Spatial 3D Audio:* Howler.js will be used to pan and attenuate sound effects. As the player pans the camera, woodcutting, mining, and blacksmith sounds are dynamically panned left/right and faded out based on distance.
    *   *Dynamic Crossfading Soundtrack:* Recreating the symphonic mastery of Settlers 4, Howler.js will manage dynamic volume crossfading of multi-channel stems (seamlessly crossfading peaceful building melodies to dramatic combat tracks when battle commands are active).

### C. Client HUD State Management
*   **HUD Store: Zustand**
    *   *Why Zustand?* It is an ultra-lightweight, high-performance state management library for React. 
    *   *Role:* When the simulation worker ticks and updates resource numbers (e.g., Wood, Bread, Gold), Zustand pushes these minimal state updates directly to the React HUD without forcing heavy re-renders of the main canvas or triggering heavy object lifecycles, maintaining a smooth 60 FPS UI overlay.

### D. Multi-Threaded Logic & Pathfinding
*   **Pathfinding Engine: `PathFinding.js` (with Jump Point Search / JPS)**
    *   *Why it's chosen:* A* pathfinding is heavily CPU-intensive. `PathFinding.js` provides an highly-optimized **Jump Point Search (JPS)** algorithm.
    *   *JPS Performance:* Instead of exploring every single grid cell sequentially like traditional A*, JPS "jumps" over flat, unobstructed tiles (like empty meadows) to find path intersections instantly.
    *   *Worker Integration:* This library will run entirely inside our background **Web Worker (`SimWorker.js`)**, keeping pathfinding calculations completely isolated from the UI thread.

### E. Backend & Real-time Communication
*   **Node.js + Express**: Serves the application, provides API endpoints, and connects to the database (aligned with monorepo rules).
*   **Socket.io**: Establishes a persistent, real-time, low-latency WebSocket connection between the clients and the server.
    *   *Why it works here:* Because we are using a **Deterministic Lockstep Simulation**, we do not need complex state diffing or heavy state synchronization frameworks (like Colyseus). Socket.io is perfect because we only transmit tiny, lightweight player command packets (clicks, building placements, less than 100 bytes) which Socket.io broadcasts instantly and reliably.
*   **MongoDB + Mongoose**: Manages user profiles, historical match data, custom map layouts, and ongoing lobby states.

---

---

## 3. Memory & CPU Optimization Strategy

A strategy game with 1,000+ units, large grids, and intricate pathfinding can quickly choke the browser. We will utilize the following techniques to keep Dawnhold highly optimized.

### A. Offloading to Web Workers (Multi-Threading)
The main JavaScript thread must be reserved strictly for **User Input** and **PixiJS Rendering**.
*   **The Simulation Worker**:
    *   All heavy game logic (pathfinding, economy ticks, unit state machines, collision detection) runs inside a background **Web Worker**.
    *   This ensures that even during a heavy A* pathfinding calculation for 50 carriers, the UI remains perfectly fluid at 60 FPS.
    *   The main thread and the simulation worker communicate via efficient `postMessage` calls, sending minimized state updates.

### B. Typed Arrays & Flat Buffers for Grid Data
*   Using complex JavaScript objects (`{ x: 10, y: 20, type: 'grass', height: 4 }`) for a 256x256 map (65,536 tiles) creates massive memory overhead and triggers heavy garbage collection.
*   **Solution**: We will store the grid state in flat **TypedArrays**:
    *   `terrainTypeMap = new Uint8Array(mapSize * mapSize)` (Grass, water, mountain, sand...)
    *   `heightMap = new Uint8Array(mapSize * mapSize)` (Elevation levels 0-15)
    *   `territoryMap = new Uint8Array(mapSize * mapSize)` (Owner ID: 0 for neutral, 1 for Player 1, etc.)
    *   `occupancyMap = new Uint16Array(mapSize * mapSize)` (Pointer to building or unit on tile)
*   *Benefits*: Instant array lookups, negligible memory footprint (less than 1MB for a huge map), and easy serialization.

### C. Object Pooling (Zero Garbage Collection)
*   Spawning and destroying hundreds of carriers, items, and projectiles causes heavy garbage collection pauses (GC stutter).
*   **Solution**: Implement an **Object Pool** for:
    *   Settler entities (`CarrierPool`, `SoldierPool`).
    *   Item entities (`Logs`, `Bread`, `Stone` sprites).
    *   Pathfinding nodes.
*   When a settler dies or an item is consumed, it is marked as `inactive` and returned to the pool instead of being deleted, to be reused later.

### D. Viewport Frustum Culling
*   We only render what is visible on the user's screen.
*   PixiJS container child objects that are outside the camera bounding box are marked as `renderable = false`. This dramatically reduces the GPU draw call count.

### E. Hybrid Pathfinding: Graph-Based Road Network + Jump Point Search (JPS)
Pathfinding is historically the primary CPU bottleneck in RTS games. To eliminate CPU spikes when 200 carriers are active, we implement a dual-mode pathing architecture:
1.  **The Road Network Graph (For Carriers)**:
    *   Like Settlers 4, carriers only walk along roads. Roads are not simulated as individual grid tiles; instead, they are abstracted into a mathematical **Directed Graph** of nodes (intersections/flags) and edges (road segments).
    *   *Performance:* Finding a path between two buildings along a road network of 100 intersections takes less than a microsecond using a lightweight A* search on the graph, compared to exploring thousands of grid tiles.
2.  **Jump Point Search (For Free-Roamers)**:
    *   Pioneers, Geologists, and Soldiers can walk anywhere. For these off-road units, we run **Jump Point Search (JPS)** over the grid. JPS exploits grid symmetries to jump past flat, unobstructed terrain (meadows) rather than checking every single cell, making it 5x-10x faster than standard A* on open grids.

### F. Zero-Allocation Threading via SharedArrayBuffer
Sending 1000+ unit positions, states, and coordinates from the Web Worker to the Main Thread 60 times a second using standard `postMessage` structural cloning creates severe serialization lag and triggers massive Garbage Collection (GC) pauses.
*   **The Shared Memory Solution**: Both the Main Thread (PixiJS) and the Simulation Worker (SimWorker.js) will share a single, pre-allocated **`SharedArrayBuffer`**.
*   **Flat Vector Array**:
    *   The `SharedArrayBuffer` acts as a raw binary buffer of float numbers (`Float32Array`).
    *   The worker writes settler states directly into pre-allocated byte blocks:
        `[EntityID, State, GridX, GridY, RenderX, RenderY, Direction, AnimationFrame, ...]`
    *   The Main Thread reads directly from this shared RAM buffer and updates the PixiJS sprites *without copying or allocating any new memory*.
*   *Security Header Requirement:* To enable `SharedArrayBuffer`, the Express server will be configured to serve these specific security headers:
    *   `Cross-Origin-Opener-Policy: same-origin`
    *   `Cross-Origin-Embedder-Policy: require-corp`

### G. Delta Position Rendering Interpolation (Sim Tick vs Render Loop)
*   Running the entire physics, economics, and AI simulation at 60 Hz is highly wasteful and drains mobile battery/laptop CPU quickly.
*   **The Dual-Rate Solution**:
    *   **The Simulation Loop** runs at a low frequency, e.g., **10 ticks per second (10 Hz)** inside the Web Worker. Speltillståndet uppdateras var 100:e millisekund.
    *   **The Render Loop** runs at **60 frames per second (60 Hz)** inside the main thread (PixiJS).
*   **Position Interpolation**:
    *   Between simulation ticks, the main renderer does not jump units abruptly.
    *   It reads the current tick position and the target next tick position from the `SharedArrayBuffer` and calculates the linear interpolation:
        `renderPos = currentTickPos + (nextTickPos - currentTickPos) * (elapsedTimeSinceLastTick / 100ms)`
    *   This delivers a incredibly smooth, visual **60 FPS sliding effect** for all settlers and items, while keeping the CPU simulation overhead extremely low!

---

## 4. Client-Server Workload Balancing

Multiplayer strategy games must handle network latency and prevent cheating while avoiding server CPU overload.

### A. The Hybrid Authoritative Simulation Model
To prevent the single-threaded Node.js server from burning out while pathfinding for hundreds of units across multiple games, we will employ a **Client-Side Simulation with Server Verification** model:

```
[Client 1 (Web Worker)] <--- Commands / Sync ---> [ Authoritative Server ] <--- Commands / Sync ---> [Client 2 (Web Worker)]
          |                                                   |                                                   |
(Runs Full Simulation)                                 (Validates Actions)                               (Runs Full Simulation)
```

1.  **Server is the Arbiter of Commands**:
    *   The server manages game metadata, lobby states, player joins, and registers building placements/commands.
    *   When a player places a building, the command is sent to the server: `CMD_PLACE_BUILDING { playerId, buildingType, x, y }`.
    *   The server checks: "Does this player own this territory? Do they have enough resources?"
    *   If valid, the server broadcasts the command to all connected clients with a synchronized **Simulation Tick Timestamp**.
2.  **Deterministic Local Simulation**:
    *   Each client runs the exact same simulation engine in their background Web Worker.
    *   Because the simulation is completely deterministic, given the exact same sequence of player commands at the exact same simulation ticks, all clients will compute identical results (settler movement, resources produced, territory boundaries).
    *   This eliminates the need to stream 1000+ unit positions over the network. Only player actions (clicks, commands) are sent.
3.  **Periodic State Verification (Anti-Cheat)**:
    *   Every 100 ticks, clients generate a small cryptographic hash of their critical game state (e.g., player resources + building counts) and send it to the server.
    *   If a client's hash mismatches the majority, a desync is detected, and the server can force-sync the client with the host's state.

---

## 5. Database & Directory Structure

Adhering to the **Zero-Config Railway Monorepo Pattern** specified in your rules, here is the architectural layout:

### A. Directory Tree
```text
Dawnhold/                  # Project Root
├── backend/               # Server logic
│   ├── server.js          # Entry point (serves Express, Socket.io, & static assets)
│   ├── models/            # Mongoose Schemas (User, GameSave, Lobby)
│   ├── routes/            # REST API (Authentication, Lobby management, Maps)
│   └── game/              # Authoritative game logic / command verifiers
├── frontend/              # Client SPA (Vite + React)
│   ├── src/
│   │   ├── components/    # HUD, Lobby overlays, Menu components
│   │   ├── engine/        # The Core Game Engine
│   │   │   ├── PixiApp.js     # PixiJS Canvas initialization
│   │   │   ├── Renderer.js    # Isometric rendering, depth sorting, culling
│   │   │   ├── Tilemap.js     # Grid rendering & terrain elevation
│   │   │   └── SpriteManager.js # Animations, texture atlas loading
│   │   ├── workers/
│   │   │   └── SimWorker.js   # Background Web Worker (A*, simulation ticks)
│   │   ├── App.jsx        # Root React component
│   │   └── main.jsx       # Entry point
│   ├── public/            # Assets (Sprite sheets, textures, audio)
│   ├── package.json       # Frontend dependencies (React, Vite, PixiJS)
│   └── vite.config.js     # Vite configuration
├── .env                   # Unified environment variables (shared)
├── package.json           # Root: Concurrently, Nodemon, Backend deps
└── .gitignore             # Ignored directories
```

### B. Core MongoDB Mongoose Schemas
*   **User Schema**: Holds username, password hash, rating, match history.
*   **Map Schema**: Saves custom maps (grid size, serialized heightmap, resource deposits).
*   **GameSave Schema**: Persists in-progress game states (a compressed JSON of the simulation state) allowing players to save and resume matches.

---

## 6. Phased Implementation Roadmap

To build this systematically without rushing into bugs, we will proceed in clear phases:

### Phase 1: High-Performance Isometric Grid (Client Rendering)
*   Initialize the PixiJS canvas and camera system (zoom, pan).
*   Implement isometric coordinate translation (`isometricX = (screenX - screenY) * (tileWidth / 2)`).
*   Draw a textured elevation-based tilemap with smooth shading.

### Phase 2: Simulation Worker & Pathfinding (Client Engine)
*   Create `SimWorker.js`. Establish a message protocol between Main Thread and Sim Worker.
*   Build the A* pathfinding algorithm inside the worker, optimized using flat TypedArrays.
*   Implement carriers walking along roads carrying dummy items.

### Phase 3: Building Economy Chains
*   Implement constructible buildings (Woodcutter, Sawmill, Residences).
*   Build the carrier automated logic: detecting resource demands, picking up logs, walking to sawmill, creating planks.
*   Add Diggers and Builders flattening the terrain and constructing.

### Phase 4: Multiplayer Backend & Lobby System
*   Set up Express, Socket.io, and Mongoose database.
*   Create a premium, glassmorphism-styled Lobby UI in React.
*   Implement server command broadcasting and synchronized tick management.

### Phase 5: Territory Expansion, Military & Polish
*   Territory boundary rendering.
*   Military towers, barracks recruitment, and simple soldier combat simulation.
*   Premium audio, visual overlays, and particle effects.

---

## 7. Branding, Original Lore & Legal Safety (Anti-Infringement Guidelines)

To respect intellectual property while delivering the absolute best RTS mechanics of the classic era, **Dawnhold** establishes a completely original fictional world, distinct visual styling, and legally safe terminology:

### A. Legally Safe terms & Nomenclature
All direct references to trademarked factions, spells, or trademarked characters from *The Settlers IV* are completely replaced by original branding:

| Settlers 4 Concept | Dawnhold Original Equivalent | Theme & Visual Identity |
| :--- | :--- | :--- |
| **Romans** | **Solari Empire (Solari)** | Ancient Greco-Roman solar empire. Marble towers, golden dome temples, solar shields, bright crimson and gold accents. |
| **Vikings** | **Njordic Clans (Njordic)** | Deep timber cabins, runic stone pillars, heavy axes, ironworks, runic blue and silver color palette. |
| **Mayans** | **Zapotec Tribelands (Zapotec)** | Mossy stepped stone pyramids, emerald jungle structures, jade spears, bird feather regalia, turquoise and emerald colors. |
| **Dark Tribe** | **The Voidborn (Voidborn)** | Extradimensional void swarm. Jagged obsidian spikes, pulsing violet energies, shadow crawlers, deep purple and black colors. |

### B. Original Lore and Deity-Based Spells
Rather than using pagan Roman/Norse gods or specific trademarked deities, Dawnhold features its own original mythology that influences the magical spells priests can cast:
*   **The Solari** worship **Aureon (Lord of Light)**. Their spells are theme-based around light, sun, gold, and growth.
*   **The Njordics** worship **Aegir (ruler of seas and storm)**. Spells center around storm strikes, woodcraft, and ocean harvests.
*   **The Zapotecs** worship **Kukulkan (the Great Plumed Serpent)**. Spells center around volcanic earthquakes, sun songs, and jungle mists.
*   **The Voidborn** follow the **Null Maw**. Spells revolve around corrupting grasslands, summoning dark shadow beasts, and warping space.

### C. Unique Mechanics Terminology
*   **Mana**: Retained as a generic fantasy term, but themed as *Solar Favor* (Solari), *Runic Echoes* (Njordics), *Jungle Essence* (Zapotecs), and *Void Animus* (Voidborn).
*   **Settlers**: Replaced in lore by **Dawnfolk** or **Clanfolk**, though the generic structural class names in code remain simple (`Carrier`, `Digger`, `Builder`) as they are common functional words.

---
*Created and maintained by the Dawnhold Architecture Team.*
