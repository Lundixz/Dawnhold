import { Application, Container, Graphics, Assets, Sprite, Text } from 'pixi.js';
import { soundManager } from './SoundManager';

let app = null;
let worldContainer = null;
let settlerSprites = []; // Cache of active settler visual sprites
let buildingSprites = []; // Cache of active building visual sprites
let lastTickTime = Date.now();

// Interactive Placement System State
let pendingBuildingType = null;
let onBuildingPlacedCallback = null;
let placementPreview = null;
let entityArrayGlobal = null;
let sharedTrafficMapGlobal = null;
let sharedTerritoryMapGlobal = null;
let boundaryGraphics = null;
let selectedFactionGlobal = 'solari';
let boundaryFrameCount = 0;
let dirtSpritesGlobal = [];

// World Resources and Wildlife State
let worldResourceSprites = []; // Cache of static trees, stones, coal, gold deposits
let wildlifeSprites = [];       // Cache of active rabbits and deer
let fishSprites = [];           // Cache of swimming fish
let resourceTextures = {};     // Loaded textures for world resources

let initSessionCounter = 0;

// Grid configuration
const TILE_WIDTH = 64;
const TILE_HEIGHT = 32;
const MAP_SIZE = 128;
const STRIDE = 9; // Slot size per entity matching SimWorker.js

// SharedArrayBuffer offsets
const ACTIVE_FLAG = 0;
const ENTITY_TYPE = 1;
const PREV_GRID_X = 2;
const PREV_GRID_Y = 3;
const NEXT_GRID_X = 4;
const NEXT_GRID_Y = 5;
const HEADING_DIR = 6;
const ANIMATION_FRAME = 7;
const CARRIED_RESOURCE = 8;

export async function initGame(canvasElement, sharedBuffer, maxEntities) {
  const sessionId = ++initSessionCounter;

  // Clear any existing cached sprites from previous hot-reloads to prevent memory and rendering leaks!
  settlerSprites.forEach(s => {
    try { s.destroy({ children: true }); } catch (e) {}
  });
  settlerSprites = [];

  buildingSprites.forEach(b => {
    if (b) {
      try { b.destroy({ children: true }); } catch (e) {}
    }
  });
  buildingSprites = [];

  worldResourceSprites.forEach(s => {
    try { s.destroy({ children: true }); } catch (e) {}
  });
  worldResourceSprites = [];

  wildlifeSprites.forEach(s => {
    try { s.destroy({ children: true }); } catch (e) {}
  });
  wildlifeSprites = [];

  fishSprites.forEach(s => {
    try { s.destroy({ children: true }); } catch (e) {}
  });
  fishSprites = [];

  activeParticles.forEach(p => {
    try { p.destroy(); } catch (e) {}
  });
  activeParticles = [];

  if (app) {
    try { app.destroy(true, { children: true }); } catch (e) {}
    app = null;
  }

  // 1. Initialize PixiJS (v8) asynchronously
  const newApp = new Application();
  await newApp.init({
    canvas: canvasElement,
    width: window.innerWidth,
    height: window.innerHeight,
    antialias: true,
    backgroundAlpha: 0, // Transparent background to show index.css background gradient
    resizeTo: window
  });

  // Check if we were superseded during the async init call!
  if (sessionId !== initSessionCounter) {
    try { newApp.destroy(true, { children: true }); } catch (e) {}
    return null;
  }

  console.log('🎮 PixiJS (v8): Initialized successfully and cleared stale instances.');
  app = newApp;

  // Wrap a Float32Array around our SharedArrayBuffer
  const entityArray = new Float32Array(sharedBuffer, 0, maxEntities * STRIDE);
  entityArrayGlobal = entityArray;

  // Map the traffic map and territory map byte arrays!
  const entityBufferBytes = maxEntities * STRIDE * Float32Array.BYTES_PER_ELEMENT;
  const trafficMapBytes = MAP_SIZE * MAP_SIZE;
  sharedTrafficMapGlobal = new Uint8Array(sharedBuffer, entityBufferBytes, MAP_SIZE * MAP_SIZE);
  sharedTerritoryMapGlobal = new Uint8Array(sharedBuffer, entityBufferBytes + trafficMapBytes, MAP_SIZE * MAP_SIZE);

  // 2. Set up the Camera Viewport container, centering on the island center (X: 64, Y: 64)
  worldContainer = new Container();
  worldContainer.x = window.innerWidth / 2;
  worldContainer.y = window.innerHeight / 2 - 2048;
  worldContainer.sortableChildren = true; // Enable dynamic isometric depth sorting!
  app.stage.addChild(worldContainer);

  // 3. Draw a mock isometric floor grid
  createIsometricFloor();

  // Draw glowing territory boundary outline container
  boundaryGraphics = new Graphics();
  boundaryGraphics.zIndex = -9998;
  worldContainer.addChild(boundaryGraphics);

  // 4. Create and cache visual representations for our entities
  createSettlerPool(maxEntities);

  // 5. Set up Interaktiv Camera Drag & Zoom Controls
  setupCameraControls(canvasElement);

  // 6. Hook into PixiJS Animation Loop (60 FPS Render Tick)
  app.ticker.add((ticker) => {
    renderLoop(entityArray, maxEntities);
  });

  return app;
}

export function updateTickTimestamp(timestamp) {
  lastTickTime = timestamp;
}


let activeParticles = [];

function spawnSmokeParticle(x, y) {
  const particle = new Graphics()
    .circle(0, 0, 2 + Math.random() * 4)
    .fill({ color: 0xdcdcdc, alpha: 0.6 });
  
  particle.x = x;
  particle.y = y;
  particle.vx = -0.2 + Math.random() * 0.4;
  particle.vy = -0.4 - Math.random() * 0.6;
  particle.life = 1.0;
  particle.decay = 0.01 + Math.random() * 0.008;
  particle.zIndex = y + 100;
  
  worldContainer.addChild(particle);
  activeParticles.push(particle);
}

function spawnDigParticle(x, y) {
  const particle = new Graphics()
    .circle(0, 0, 1.5 + Math.random() * 2)
    .fill({ color: 0x5c4033, alpha: 0.8 });
  
  particle.x = x;
  particle.y = y;
  particle.vx = -0.8 + Math.random() * 1.6;
  particle.vy = -1.2 - Math.random() * 1.2;
  particle.gravity = 0.12;
  particle.life = 1.0;
  particle.decay = 0.05;
  particle.zIndex = y + 5;
  
  worldContainer.addChild(particle);
  activeParticles.push(particle);
}

function spawnBuildParticle(x, y) {
  const particle = new Graphics()
    .circle(0, 0, 1.2 + Math.random() * 1.8)
    .fill({ color: 0xffd700, alpha: 0.9 });
  
  particle.x = x;
  particle.y = y;
  particle.vx = -1.0 + Math.random() * 2.0;
  particle.vy = -1.6 - Math.random() * 1.6;
  particle.gravity = 0.15;
  particle.life = 1.0;
  particle.decay = 0.06;
  particle.zIndex = y + 5;
  
  worldContainer.addChild(particle);
  activeParticles.push(particle);
}

function spawnSawdustParticle(x, y) {
  const particle = new Graphics()
    .circle(0, 0, 1.0 + Math.random() * 1.5)
    .fill({ color: 0xe5c158, alpha: 0.95 });
  
  particle.x = x;
  particle.y = y;
  particle.vx = -1.2 + Math.random() * 2.4;
  particle.vy = -1.5 - Math.random() * 1.0;
  particle.gravity = 0.12;
  particle.life = 1.0;
  particle.decay = 0.05 + Math.random() * 0.03;
  particle.zIndex = y + 10;
  
  worldContainer.addChild(particle);
  activeParticles.push(particle);
}

function spawnStoneDustParticle(x, y) {
  const particle = new Graphics()
    .circle(0, 0, 1.5 + Math.random() * 2.0)
    .fill({ color: 0xdcdcdc, alpha: 0.8 });
  
  particle.x = x;
  particle.y = y;
  particle.vx = -0.7 + Math.random() * 1.4;
  particle.vy = -0.8 - Math.random() * 0.8;
  particle.gravity = 0.05;
  particle.life = 1.0;
  particle.decay = 0.04 + Math.random() * 0.02;
  particle.zIndex = y + 10;
  
  worldContainer.addChild(particle);
  activeParticles.push(particle);
}

function spawnSmithSpark(x, y) {
  const particle = new Graphics()
    .rect(-1, -1, 2, 2)
    .fill({ color: 0xff9800, alpha: 1.0 }); // hot bright orange spark
  
  particle.x = x;
  particle.y = y;
  particle.vx = -2.5 + Math.random() * 5.0;
  particle.vy = -3.0 - Math.random() * 2.5;
  particle.gravity = 0.25; // falls quickly
  particle.life = 1.0;
  particle.decay = 0.05 + Math.random() * 0.03;
  particle.zIndex = y + 20;
  
  worldContainer.addChild(particle);
  activeParticles.push(particle);
}

function spawnMagicSpark(x, y) {
  const particle = new Graphics()
    .circle(0, 0, 1.2 + Math.random() * 1.2)
    .fill({ color: Math.random() < 0.5 ? 0xcc33ff : 0x00ffff, alpha: 0.9 }); // Cyan or Purple spark!
  
  particle.x = x;
  particle.y = y;
  particle.vx = -0.6 + Math.random() * 1.2;
  particle.vy = -0.5 - Math.random() * 1.0;
  particle.life = 1.0;
  particle.decay = 0.02 + Math.random() * 0.015;
  particle.zIndex = y + 10;
  
  worldContainer.addChild(particle);
  activeParticles.push(particle);
}

function updateParticles() {
  for (let i = activeParticles.length - 1; i >= 0; i--) {
    const p = activeParticles[i];
    p.life -= p.decay;
    
    if (p.life <= 0) {
      worldContainer.removeChild(p);
      p.destroy();
      activeParticles.splice(i, 1);
    } else {
      p.x += p.vx;
      p.y += p.vy;
      
      if (p.gravity) {
        p.vy += p.gravity;
      }
      
      p.alpha = p.life;
      
      if (!p.gravity) {
        p.scale.x = 1.0 + (1.0 - p.life) * 2;
        p.scale.y = 1.0 + (1.0 - p.life) * 2;
      }
    }
  }
}

export function isWalkableGrass(x, y) {
  if (x < 0 || x >= 128 || y < 0 || y >= 128) return false;
  const dx = x - 64;
  const dy = y - 64;
  const dist = Math.sqrt(dx * dx + dy * dy);
  
  const angle = Math.atan2(dy, dx);
  const noise = Math.sin(angle * 7) * 6 + Math.cos(angle * 13) * 3;
  const landEdge = 46 + noise;
  
  return dist < (landEdge - 4);
}

function createIsometricFloor() {
  const MAP_SIZE = 128;

  // 1. Create a parent container to hold all floor sprites
  const floorContainer = new Container();
  floorContainer.zIndex = -10000; // Keep floor underneath all settlers and buildings
  floorContainer.interactiveChildren = false; // Disable event checks on static tiles
  floorContainer.sortableChildren = false; // Disable sorting checks on static tiles
  worldContainer.addChild(floorContainer);

  const dirtContainer = new Container();
  dirtContainer.zIndex = -9999; // Dirt sits right above the grass floor!
  dirtContainer.interactiveChildren = false;
  dirtContainer.sortableChildren = false;
  worldContainer.addChild(dirtContainer);

  // Helper to generate a sharp diamond tile texture using the PixiJS v8 texture generator
  const createTileTexture = (tileType, tileColor, strokeColor) => {
    const g = new Graphics();
    
    // Draw the main diamond base (only for base terrains, NOT dirt overlay tracks!)
    if (tileType !== 'dirt') {
      g.moveTo(TILE_WIDTH / 2, 0)
       .lineTo(TILE_WIDTH, TILE_HEIGHT / 2)
       .lineTo(TILE_WIDTH / 2, TILE_HEIGHT)
       .lineTo(0, TILE_HEIGHT / 2)
       .closePath()
       .fill({ color: tileColor });
    }

    // Draw procedural organic textures inside the diamond!
    if (tileType === 'grass') {
      // 1. Draw soft grass details (flecks of different greens)
      // We want to draw tiny dots and small grass blades inside the diamond bounds
      const greens = [0x3c7c34, 0x43863a, 0x33632b, 0x2e5a26];
      // Let's seed randomly but deterministically so they look natural
      for (let i = 0; i < 24; i++) {
        const rx = 10 + (i * 7 + 13) % (TILE_WIDTH - 20);
        const dy = TILE_HEIGHT / 2;
        const dx = TILE_WIDTH / 2;
        // Diamond equation: |x - dx| / (TILE_WIDTH/2) + |y - dy| / (TILE_HEIGHT/2) <= 1
        const maxH = (1.0 - Math.abs(rx - dx) / dx) * dy - 1.5;
        if (maxH > 1.5) {
          const ry = dy - maxH + (i * 11 + 5) % (maxH * 2);
          const col = greens[(i + rx) % greens.length];
          // Draw a small grass speck or blade
          g.moveTo(rx, ry)
           .lineTo(rx + 1 + (i % 2), ry - 2 - (i % 3))
           .stroke({ width: 1.0, color: col });
        }
      }
      
      // 2. Very subtle grass borders instead of harsh grid lines
      g.moveTo(TILE_WIDTH / 2, 0)
       .lineTo(TILE_WIDTH, TILE_HEIGHT / 2)
       .lineTo(TILE_WIDTH / 2, TILE_HEIGHT)
       .lineTo(0, TILE_HEIGHT / 2)
       .closePath()
       .stroke({ width: 0.6, color: strokeColor, alpha: 0.35 });
    }
    else if (tileType === 'sand') {
      // Draw sandy granular speckles (tiny sand grains of different beige/yellow shades)
      const sands = [0xe8d6b8, 0xd4c29c, 0xf0e2ca, 0xc2b18c];
      for (let i = 0; i < 30; i++) {
        const rx = 8 + (i * 9 + 17) % (TILE_WIDTH - 16);
        const dy = TILE_HEIGHT / 2;
        const dx = TILE_WIDTH / 2;
        const maxH = (1.0 - Math.abs(rx - dx) / dx) * dy - 1;
        if (maxH > 1) {
          const ry = dy - maxH + (i * 13 + 3) % (maxH * 2);
          const col = sands[(i + rx) % sands.length];
          g.circle(rx, ry, 0.6 + (i % 2) * 0.4).fill({ color: col });
        }
      }
      
      // Soft sand boundary stroke
      g.moveTo(TILE_WIDTH / 2, 0)
       .lineTo(TILE_WIDTH, TILE_HEIGHT / 2)
       .lineTo(TILE_WIDTH / 2, TILE_HEIGHT)
       .lineTo(0, TILE_HEIGHT / 2)
       .closePath()
       .stroke({ width: 0.6, color: strokeColor, alpha: 0.3 });
    }
    else if (tileType === 'deep' || tileType === 'shallow') {
      // Draw water ripples and shimmering waves!
      const rippleCol = tileType === 'deep' ? 0x2b5785 : 0x3d7e9e;
      const highlightCol = tileType === 'deep' ? 0x346b9c : 0x4ca1c4;
      
      // Draw winding horizontal wave curves inside the diamond
      // Ripple 1
      g.moveTo(12, 16)
       .bezierCurveTo(20, 12, 28, 20, 36, 14)
       .stroke({ width: 1.0, color: rippleCol, alpha: 0.6 });
      
      // Ripple 2
      g.moveTo(24, 20)
       .bezierCurveTo(32, 17, 40, 23, 48, 19)
       .stroke({ width: 1.0, color: highlightCol, alpha: 0.5 });
       
      // Ripple 3 (small light wave highlight)
      g.moveTo(18, 10)
       .bezierCurveTo(26, 7, 34, 12, 42, 9)
       .stroke({ width: 0.8, color: 0xffffff, alpha: 0.15 });

      // Soft water strokes
      g.moveTo(TILE_WIDTH / 2, 0)
       .lineTo(TILE_WIDTH, TILE_HEIGHT / 2)
       .lineTo(TILE_WIDTH / 2, TILE_HEIGHT)
       .lineTo(0, TILE_HEIGHT / 2)
       .closePath()
       .stroke({ width: 0.6, color: strokeColor, alpha: 0.2 });
    }
    else if (tileType === 'dirt') {
      // Worn dirt pathway texture - draw a soft, narrow organic winding trail down the center!
      // Draw a soft central dust/dirt footprint trail in the middle of the tile (1/4 width of tile)
      g.ellipse(TILE_WIDTH / 2, TILE_HEIGHT / 2, 14, 7)
       .fill({ color: 0x8b5a2b, alpha: 0.8 }); // Cozy brown central path core!
      
      // Cozy organic gravel particles inside the thin winding path
      const dirts = [0x784a22, 0x9b6b3c, 0x5c3c1e, 0xa67c4e];
      for (let i = 0; i < 10; i++) {
        // Distribute pebbles only near the central ellipse
        const rx = TILE_WIDTH / 2 - 6 + (i * 7 + 13) % 12;
        const ry = TILE_HEIGHT / 2 - 3 + (i * 11 + 5) % 6;
        const col = dirts[i % dirts.length];
        g.circle(rx, ry, 0.5 + (i % 2) * 0.4).fill({ color: col });
      }
    }
    else {
      // Standard fallback
      g.moveTo(TILE_WIDTH / 2, 0)
       .lineTo(TILE_WIDTH, TILE_HEIGHT / 2)
       .lineTo(TILE_WIDTH / 2, TILE_HEIGHT)
       .lineTo(0, TILE_HEIGHT / 2)
       .closePath()
       .stroke({ width: 0.8, color: strokeColor });
    }
    
    const tex = app.renderer.textureGenerator.generateTexture({ target: g });
    g.destroy();
    return tex;
  };

  // 2. Generate and cache textures exactly once for each of the 8 terrain styles
  const textures = {
    deepEven: createTileTexture('deep', 0x1f3c5c, 0x1a334f),
    deepOdd: createTileTexture('deep', 0x244569, 0x1a334f),
    shallowEven: createTileTexture('shallow', 0x2d5d7b, 0x244d66),
    shallowOdd: createTileTexture('shallow', 0x33688a, 0x244d66),
    sandEven: createTileTexture('sand', 0xdecba4, 0xcfbc95),
    sandOdd: createTileTexture('sand', 0xe3d2b0, 0xcfbc95),
    grassEven: createTileTexture('grass', 0x35682d, 0x2b5425),
    grassOdd: createTileTexture('grass', 0x3b7a33, 0x2b5425)
  };

  const dirtTex = createTileTexture('dirt', 0x8b5a2b, 0x5c4033); // Brown worn dirt color

  // Helper to generate textures for the various environmental grass details (Wuselfaktor)
  const createGrassBladesTexture = () => {
    const g = new Graphics()
      .moveTo(8, 16).lineTo(10, 8)
      .moveTo(8, 16).lineTo(6, 10)
      .stroke({ width: 1.2, color: 0x48963b });
    const tex = app.renderer.textureGenerator.generateTexture({ target: g });
    g.destroy();
    return tex;
  };

  const createYellowFlowersTexture = () => {
    const g = new Graphics()
      // Center stems
      .moveTo(5, 16).lineTo(5, 10).stroke({ color: 0x2e5c26, width: 1 })
      .moveTo(3, 16).lineTo(2, 12).stroke({ color: 0x2e5c26, width: 0.8 })
      .moveTo(7, 16).lineTo(8, 11).stroke({ color: 0x2e5c26, width: 0.8 })
      // Yellow blooms
      .circle(5, 9, 1.8).fill({ color: 0xffeb3b })
      .circle(2, 11, 1.4).fill({ color: 0xfff176 })
      .circle(8, 10, 1.5).fill({ color: 0xffd54f })
      // Center dots
      .circle(5, 9, 0.6).fill({ color: 0xe65100 })
      .circle(2, 11, 0.5).fill({ color: 0xe65100 });
    const tex = app.renderer.textureGenerator.generateTexture({ target: g });
    g.destroy();
    return tex;
  };

  const createPurpleFlowersTexture = () => {
    const g = new Graphics()
      // Green cluster base
      .ellipse(5, 15, 4, 2).fill({ color: 0x2e5c26 })
      // Stems
      .moveTo(3, 15).lineTo(2, 8).stroke({ color: 0x1b5e20, width: 0.8 })
      .moveTo(5, 15).lineTo(5, 6).stroke({ color: 0x1b5e20, width: 0.8 })
      .moveTo(7, 15).lineTo(8, 7).stroke({ color: 0x1b5e20, width: 0.8 })
      // Lush purple flower bulbs
      .circle(5, 6, 2.2).fill({ color: 0xba68c8 })
      .circle(2, 8, 1.8).fill({ color: 0x8e24aa })
      .circle(8, 7, 2.0).fill({ color: 0x9c27b0 })
      // Light purple highlights
      .circle(4.5, 5, 1.0).fill({ color: 0xe1bee7 })
      .circle(1.5, 7, 0.8).fill({ color: 0xe1bee7 })
      .circle(7.5, 6, 0.9).fill({ color: 0xe1bee7 });
    const tex = app.renderer.textureGenerator.generateTexture({ target: g });
    g.destroy();
    return tex;
  };

  const createRedFlowersTexture = () => {
    const g = new Graphics()
      .moveTo(5, 16).lineTo(5, 10).stroke({ color: 0x2e5c26, width: 1 })
      .moveTo(3, 16).lineTo(1, 11).stroke({ color: 0x2e5c26, width: 0.8 })
      .moveTo(7, 16).lineTo(9, 12).stroke({ color: 0x2e5c26, width: 0.8 })
      // Deep red poppies
      .circle(5, 9, 2.0).fill({ color: 0xd32f2f })
      .circle(1, 11, 1.6).fill({ color: 0xe53935 })
      .circle(9, 11, 1.7).fill({ color: 0xc62828 })
      // Dark centers
      .circle(5, 9, 0.7).fill({ color: 0x212121 })
      .circle(1, 11, 0.5).fill({ color: 0x212121 })
      .circle(9, 11, 0.6).fill({ color: 0x212121 });
    const tex = app.renderer.textureGenerator.generateTexture({ target: g });
    g.destroy();
    return tex;
  };

  const createRockTexture = () => {
    const g = new Graphics()
      .ellipse(5, 20, 2.5, 1.2).fill({ color: 0x808080 });
    const tex = app.renderer.textureGenerator.generateTexture({ target: g });
    g.destroy();
    return tex;
  };

  const details = {
    grassBlades: createGrassBladesTexture(),
    flowersYellow: createYellowFlowersTexture(),
    flowersPurple: createPurpleFlowersTexture(),
    flowersRed: createRedFlowersTexture(),
    rock: createRockTexture()
  };

  // 3. Draw the entire 128x128 grid by creating and caching quads (2 triangles) which bypasses complex triangulation!
  for (let x = 0; x < MAP_SIZE; x++) {
    for (let y = 0; y < MAP_SIZE; y++) {
      const dx = x - 64;
      const dy = y - 64;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      const angle = Math.atan2(dy, dx);
      const noise = Math.sin(angle * 7) * 6 + Math.cos(angle * 13) * 3;
      
      const landEdge = 46 + noise;
      const isEven = (x + y) % 2 === 0;
      
      let tex;
      
      if (dist >= landEdge + 4) {
        tex = isEven ? textures.deepEven : textures.deepOdd;
      } else if (dist >= landEdge) {
        tex = isEven ? textures.shallowEven : textures.shallowOdd;
      } else if (dist >= landEdge - 4) {
        tex = isEven ? textures.sandEven : textures.sandOdd;
      } else {
        tex = isEven ? textures.grassEven : textures.grassOdd;
      }

      // Convert isometric coordinate system to screen coordinate system
      const screenX = (x - y) * (TILE_WIDTH / 2);
      const screenY = (x + y) * (TILE_HEIGHT / 2);

      // Create a quad-based sprite using our pre-compiled texture
      const tileSprite = new Sprite(tex);
      tileSprite.x = screenX - TILE_WIDTH / 2; // Offset center horizontally to match diamond coordinates
      tileSprite.y = screenY;
      floorContainer.addChild(tileSprite);

      // Programmatically add micro-details (flowers, rocks, grass blades) on dry land
      if (dist < landEdge - 4) {
        const tileSeed = (x * 17 + y * 31) % 100;
        if (tileSeed > 85) {
          const detailSprite = new Sprite(details.grassBlades);
          detailSprite.x = screenX - TILE_WIDTH / 2;
          detailSprite.y = screenY;
          floorContainer.addChild(detailSprite);
        } else if (tileSeed === 7) {
          const detailSprite = new Sprite(details.flowersYellow);
          detailSprite.x = screenX - TILE_WIDTH / 2;
          detailSprite.y = screenY;
          floorContainer.addChild(detailSprite);
        } else if (tileSeed === 11) {
          const detailSprite = new Sprite(details.rock);
          detailSprite.x = screenX - TILE_WIDTH / 2;
          detailSprite.y = screenY;
          floorContainer.addChild(detailSprite);
        } else if (tileSeed === 19) {
          const detailSprite = new Sprite(details.flowersPurple);
          detailSprite.x = screenX - TILE_WIDTH / 2;
          detailSprite.y = screenY;
          floorContainer.addChild(detailSprite);
        } else if (tileSeed === 31) {
          const detailSprite = new Sprite(details.flowersRed);
          detailSprite.x = screenX - TILE_WIDTH / 2;
          detailSprite.y = screenY;
          floorContainer.addChild(detailSprite);
        }
        
        // Populate the dynamic dirt layer for soil wear (only on grass/land)
        const dirtSprite = new Sprite(dirtTex);
        dirtSprite.x = screenX - TILE_WIDTH / 2;
        dirtSprite.y = screenY;
        dirtSprite.alpha = 0; // Completely hidden initially
        dirtContainer.addChild(dirtSprite);
        dirtSpritesGlobal[y * MAP_SIZE + x] = dirtSprite;
      }
    }
  }

  // 4. Generate high-fidelity textures for our static and dynamic world resources (Forest, Stones, Wildlife, Fish, Minerals)
  resourceTextures.tree = createTreeTexture();
  resourceTextures.stone = createStoneDepositTexture();
  resourceTextures.rabbit = createRabbitTexture();
  resourceTextures.deer = createDeerTexture();
  resourceTextures.fish = createFishTexture();
  resourceTextures.coal = createCoalDepositTexture();
  resourceTextures.gold = createGoldDepositTexture();

  // 5. Populate and render these resources inside the world stage
  spawnWorldResources();
}

// Custom cozy isometric texture generators for world resources (Skog, Sten, Djur, Fisk, Minerals)
const createTreeTexture = () => {
  const g = new Graphics();
  g.ellipse(6, 2, 12, 4.5).fill({ color: 0x000000, alpha: 0.25 }); // S4-style slanted shadow!
  g.rect(-2.5, -16, 5, 16).fill({ color: 0x5c4033 })
   .stroke({ width: 0.8, color: 0x2e1a0e });
  g.circle(0, -22, 10).fill({ color: 0x2e5c1e })
   .circle(-6, -18, 7.5).fill({ color: 0x3b7a33 })
   .circle(6, -18, 7.5).fill({ color: 0x3b7a33 })
   .circle(0, -28, 8.5).fill({ color: 0x4caf50 })
   .stroke({ width: 0.8, color: 0x1b3c10 });
  g.circle(-3, -20, 1.2).fill({ color: 0xe53935 })
   .circle(4, -24, 1.2).fill({ color: 0xe53935 })
   .circle(-2, -26, 1.2).fill({ color: 0xffd54f });
  const tex = app.renderer.textureGenerator.generateTexture({ target: g });
  g.destroy();
  return tex;
};

const createStoneDepositTexture = () => {
  const g = new Graphics();
  g.ellipse(7, 3, 14, 5).fill({ color: 0x000000, alpha: 0.22 }); // S4-style slanted shadow!
  g.moveTo(-10, 2).lineTo(-12, -4).lineTo(-4, -10).lineTo(2, -2).closePath()
   .fill({ color: 0x7e8894 }).stroke({ width: 1.0, color: 0x484f59 });
  g.moveTo(-2, 2).lineTo(8, 2).lineTo(10, -5).lineTo(0, -8).closePath()
   .fill({ color: 0x8a95a5 }).stroke({ width: 1.0, color: 0x545d6a });
  g.moveTo(-6, -6).lineTo(4, -6).lineTo(2, -14).lineTo(-4, -12).closePath()
   .fill({ color: 0xa3b0c2 }).stroke({ width: 1.0, color: 0x626c7a });
  g.stroke({ color: 0xd9e2ec, width: 0.8 });
  g.moveTo(-4, -12).lineTo(-1, -8);
  g.moveTo(2, -14).lineTo(0, -8);
  g.moveTo(-10, -4).lineTo(-6, -6);
  const tex = app.renderer.textureGenerator.generateTexture({ target: g });
  g.destroy();
  return tex;
};

const createRabbitTexture = () => {
  const g = new Graphics()
    .ellipse(3, 1, 5, 2.2).fill({ color: 0x000000, alpha: 0.16 }) // S4-style slanted shadow!
    .ellipse(-1.5, -3, 3.5, 2.5).fill({ color: 0xf5f5f5 })
    .circle(2, -5, 2.0).fill({ color: 0xe0e0e0 })
    .ellipse(1.5, -9, 0.8, 2.8).fill({ color: 0xffcdd2 }).stroke({ width: 0.5, color: 0xe0e0e0 })
    .circle(-5, -4, 1.2).fill({ color: 0xffffff });
  const tex = app.renderer.textureGenerator.generateTexture({ target: g });
  g.destroy();
  return tex;
};

const createDeerTexture = () => {
  const g = new Graphics()
    .ellipse(5, 2, 8, 3.2).fill({ color: 0x000000, alpha: 0.20 }) // S4-style slanted shadow!
    .rect(-4, -4, 1, 4).fill({ color: 0x8d6e63 })
    .rect(-2, -4, 1, 4).fill({ color: 0x8d6e63 })
    .rect(2, -4, 1, 4).fill({ color: 0x8d6e63 })
    .rect(4, -4, 1, 4).fill({ color: 0x8d6e63 })
    .ellipse(0, -6, 5.5, 3.2).fill({ color: 0xa1887f })
    .circle(-2, -7, 0.5).fill({ color: 0xffffff })
    .circle(1, -6, 0.5).fill({ color: 0xffffff })
    .circle(0, -8, 0.5).fill({ color: 0xffffff })
    .moveTo(3, -7).lineTo(5, -13).lineTo(7, -13).lineTo(4, -6).closePath().fill({ color: 0xa1887f })
    .circle(6, -14, 1.8).fill({ color: 0x8d6e63 })
    .moveTo(5.5, -15).lineTo(4.5, -18).stroke({ color: 0x5d4033, width: 0.8 })
    .moveTo(6.5, -15).lineTo(7.5, -18).stroke({ color: 0x5d4033, width: 0.8 });
  const tex = app.renderer.textureGenerator.generateTexture({ target: g });
  g.destroy();
  return tex;
};

const createFishTexture = () => {
  const g = new Graphics()
    .moveTo(-4, 0).bezierCurveTo(-2, -2, 2, -2, 4, 0).bezierCurveTo(2, 2, -2, 2, -4, 0).closePath()
    .fill({ color: 0x90caf9 })
    .moveTo(-2, -0.5).lineTo(2, -0.5).stroke({ color: 0xffffff, width: 0.6, alpha: 0.8 })
    .moveTo(-4, 0).lineTo(-6, -2.5).lineTo(-5, 0).lineTo(-6, 2.5).closePath()
    .fill({ color: 0x64b5f6 });
  const tex = app.renderer.textureGenerator.generateTexture({ target: g });
  g.destroy();
  return tex;
};

const createCoalDepositTexture = () => {
  const g = new Graphics()
    .ellipse(6, 2, 10, 4).fill({ color: 0x000000, alpha: 0.24 }) // S4-style slanted shadow!
    .moveTo(-7, 1).lineTo(-8, -5).lineTo(-2, -9).lineTo(1, -2).closePath()
    .fill({ color: 0x212121 }).stroke({ width: 0.9, color: 0x000000 })
    .moveTo(-1, 1).lineTo(6, 1).lineTo(7, -6).lineTo(0, -8).closePath()
    .fill({ color: 0x1a1a1a }).stroke({ width: 0.9, color: 0x000000 })
    .stroke({ color: 0x4f5d73, width: 0.8 })
    .moveTo(-5, -6).lineTo(-2, -8)
    .moveTo(3, -4).lineTo(5, -2);
  const tex = app.renderer.textureGenerator.generateTexture({ target: g });
  g.destroy();
  return tex;
};

const createGoldDepositTexture = () => {
  const g = new Graphics()
    .ellipse(6, 2, 11, 4).fill({ color: 0x000000, alpha: 0.22 }) // S4-style slanted shadow!
    .moveTo(-8, 2).lineTo(-9, -4).lineTo(-3, -8).lineTo(2, -2).closePath()
    .fill({ color: 0x5d4033 }).stroke({ width: 1.0, color: 0x3e2723 })
    .moveTo(-1, 2).lineTo(7, 2).lineTo(9, -5).lineTo(0, -7).closePath()
    .fill({ color: 0x6d4c41 }).stroke({ width: 1.0, color: 0x3e2723 })
    .circle(-5, -3, 1.8).fill({ color: 0xffeb3b })
    .circle(3, -2, 1.4).fill({ color: 0xffd54f })
    .circle(0, -6, 2.0).fill({ color: 0xffc107 })
    .circle(-5, -3.5, 0.5).fill({ color: 0xffffff })
    .circle(0, -7, 0.6).fill({ color: 0xffffff })
    .moveTo(1, -3).lineTo(4, -3).stroke({ color: 0xffd54f, width: 1 });
  const tex = app.renderer.textureGenerator.generateTexture({ target: g });
  g.destroy();
  return tex;
};

const spawnWorldResources = () => {
  // 1. Clear existing arrays if any
  worldResourceSprites.forEach(s => {
    try { s.destroy({ children: true }); } catch (e) {}
  });
  worldResourceSprites.length = 0;
  wildlifeSprites.forEach(s => {
    try { s.destroy({ children: true }); } catch (e) {}
  });
  wildlifeSprites.length = 0;
  fishSprites.forEach(s => {
    try { s.destroy({ children: true }); } catch (e) {}
  });
  fishSprites.length = 0;

  for (let x = 0; x < MAP_SIZE; x++) {
    for (let y = 0; y < MAP_SIZE; y++) {
      const dx = x - 64;
      const dy = y - 64;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx);
      const noise = Math.sin(angle * 7) * 6 + Math.cos(angle * 13) * 3;
      const landEdge = 46 + noise;

      const screenX = (x - y) * (TILE_WIDTH / 2);
      const screenY = (x + y) * (TILE_HEIGHT / 2);

      // Dry land grass check
      if (dist < landEdge - 4) {
        // A. Mountain Mineral Ridge (Coal & Gold)
        const isMountainRidge = (x >= 72 && x <= 88 && y >= 40 && y <= 56);
        if (isMountainRidge) {
          const seed = (x * 37 + y * 73) % 100;
          if (seed < 12) {
            const s = new Sprite(resourceTextures.coal);
            s.x = screenX;
            s.y = screenY;
            s.anchor.set(0.5, 1.0);
            s.zIndex = screenY;
            worldContainer.addChild(s);
            worldResourceSprites.push(s);
          } else if (seed >= 12 && seed < 24) {
            const s = new Sprite(resourceTextures.gold);
            s.x = screenX;
            s.y = screenY;
            s.anchor.set(0.5, 1.0);
            s.zIndex = screenY;
            worldContainer.addChild(s);
            worldResourceSprites.push(s);
          }
          continue;
        }

        // B. Dense Forest Sectors (Skog)
        const isForestSector = (x < 52 && y < 52) || (x > 76 && y > 76);
        const forestSeed = (x * 19 + y * 43) % 100;
        if (isForestSector && forestSeed < 25) {
          const s = new Sprite(resourceTextures.tree);
          s.x = screenX;
          s.y = screenY;
          s.anchor.set(0.5, 1.0);
          s.zIndex = screenY;
          worldContainer.addChild(s);
          worldResourceSprites.push(s);
          continue;
        }

        // C. Rich Stone Quarries (Sten)
        const isStoneSector = (x > 76 && y < 52) || (x < 52 && y > 76);
        const stoneSeed = (x * 23 + y * 31) % 100;
        if (isStoneSector && stoneSeed < 14) {
          const s = new Sprite(resourceTextures.stone);
          s.x = screenX;
          s.y = screenY;
          s.anchor.set(0.5, 1.0);
          s.zIndex = screenY;
          worldContainer.addChild(s);
          worldResourceSprites.push(s);
          continue;
        }

        // D. Wildlife (Djur)
        const wildlifeSeed = (x * 97 + y * 13) % 1000;
        if (wildlifeSeed === 9) {
          const s = new Sprite(resourceTextures.rabbit);
          s.x = screenX;
          s.y = screenY;
          s.anchor.set(0.5, 1.0);
          s.zIndex = screenY;
          s.customType = 'rabbit';
          s.customBaseX = screenX;
          s.customBaseY = screenY;
          s.customStateTime = Math.random() * 100;
          s.customPhase = Math.random() * Math.PI * 2;
          worldContainer.addChild(s);
          wildlifeSprites.push(s);
        } else if (wildlifeSeed === 17) {
          const s = new Sprite(resourceTextures.deer);
          s.x = screenX;
          s.y = screenY;
          s.anchor.set(0.5, 1.0);
          s.zIndex = screenY;
          s.customType = 'deer';
          s.customBaseX = screenX;
          s.customBaseY = screenY;
          s.customStateTime = Math.random() * 100;
          s.customPhase = Math.random() * Math.PI * 2;
          worldContainer.addChild(s);
          wildlifeSprites.push(s);
        }
      }
      // E. Fish in Water (Fisk)
      else if (dist >= landEdge) {
        const fishSeed = (x * 83 + y * 29) % 800;
        if (fishSeed === 11) {
          const s = new Sprite(resourceTextures.fish);
          s.x = screenX;
          s.y = screenY;
          s.anchor.set(0.5, 0.5);
          s.zIndex = screenY - 8;
          s.customBaseX = screenX;
          s.customBaseY = screenY;
          s.customPhase = Math.random() * Math.PI * 2;
          s.customSpeed = 0.5 + Math.random() * 0.7;
          worldContainer.addChild(s);
          fishSprites.push(s);
        }
      }
    }
  }
};

function createSettlerPool(maxEntities) {
  // Pre-allocate a pool of visual settler representations to avoid memory garbage collection pauses!
  for (let i = 0; i < maxEntities; i++) {
    const settlerContainer = new Container();

    // 1. Shadow (semi-transparent black ellipse - slanted to the bottom-right!)
    const shadow = new Graphics()
      .ellipse(4, 2, 9, 4)
      .fill({ color: 0x000000, alpha: 0.25 });

    // 2. Boots/Feet
    const leftFoot = new Graphics().circle(-5, 0, 3.5).fill({ color: 0x3e2723 });
    const rightFoot = new Graphics().circle(5, 0, 3.5).fill({ color: 0x3e2723 });

    // 3. Body Capsule (White body, tinted dynamically based on role)
    const body = new Graphics()
      .ellipse(0, -10, 10, 12)
      .fill({ color: 0xffffff });

    // 4. Brown Belt with Golden Buckle
    const belt = new Graphics()
      .rect(-10, -8, 20, 3).fill({ color: 0x3e2723 })
      .rect(-3, -9, 6, 5).fill({ color: 0xffd700 });

    // 5. Hands/Arms (Waddles during walks)
    const leftHand = new Graphics().circle(-11, -12, 3.5).fill({ color: 0xffdbac });
    const rightHand = new Graphics().circle(11, -12, 3.5).fill({ color: 0xffdbac });

    // 6. Carrier Resources
    const bag = new Graphics()
      .rect(-7, -19, 14, 10).fill({ color: 0x5c4033 })
      .moveTo(-5, -19).lineTo(-5, -9).stroke({ color: 0x8b4513, width: 2 })
      .moveTo(5, -19).lineTo(5, -9).stroke({ color: 0x8b4513, width: 2 });
      
    const carriedLog = new Graphics()
      .rect(-12, -16, 24, 6).fill({ color: 0x6d4c41 }) // brown log
      .circle(-12, -13, 3).fill({ color: 0xe5c158 }) // golden end
      .circle(12, -13, 3).fill({ color: 0xe5c158 });
      
    const carriedStone = new Graphics()
      .ellipse(0, -14, 8, 5).fill({ color: 0x8c8c8c }) // grey stone
      .ellipse(2, -15, 6, 3).fill({ color: 0xa9a9a9 }); // highlight
      
    const carriedGold = new Graphics()
      .rect(-6, -16, 12, 6).fill({ color: 0xffd700 }) // gold bar
      .moveTo(-6, -16).lineTo(6, -16).stroke({ color: 0xfff000, width: 1 });
      
    const carriedIron = new Graphics()
      .rect(-6, -16, 12, 6).fill({ color: 0xa1adc2 }) // iron bar
      .moveTo(-6, -16).lineTo(6, -16).stroke({ color: 0xd2dceb, width: 1 });

    // 7. Shovel tool (Digger only)
    const shovel = new Graphics()
      .rect(-1, -22, 2, 16).fill({ color: 0xa0522d }) // shaft
      .moveTo(-4, -26).lineTo(4, -26).lineTo(2, -22).lineTo(-2, -22).closePath().fill({ color: 0xc0c0c0 }); // steel blade
    shovel.x = -8;
    shovel.y = -4;

    // 8. Hammer tool (Builder only)
    const hammer = new Graphics()
      .rect(-1.5, -20, 3, 14).fill({ color: 0xa0522d }) // handle
      .rect(-6, -24, 12, 5).fill({ color: 0x4a4a4a }); // head
    hammer.x = -8;
    hammer.y = -4;

    // 9. Head & Cute Settler 4 Cap/Hat
    const head = new Graphics()
      .circle(0, -23, 6.5)
      .fill({ color: 0xffdbac })
      // Two cute, expressive eyes!
      .circle(-2, -24, 0.9)
      .fill({ color: 0x2d1a0e })
      .circle(2, -24, 0.9)
      .fill({ color: 0x2d1a0e })
      // Rosy blush cheeks (Settlers IV signature style)
      .circle(-4, -22, 1.2)
      .fill({ color: 0xff8a80, alpha: 0.65 })
      .circle(4, -22, 1.2)
      .fill({ color: 0xff8a80, alpha: 0.65 });

    const hat = new Graphics()
      .moveTo(-7, -24)
      .lineTo(0, -32)
      .lineTo(7, -24)
      .closePath()
      .fill({ color: 0x5c4033 }) // cap body
      .circle(0, -32, 2)
      .fill({ color: 0xffd700 }); // golden crest/pompom

    settlerContainer.addChild(shadow);
    settlerContainer.addChild(leftFoot);
    settlerContainer.addChild(rightFoot);
    settlerContainer.addChild(body);
    settlerContainer.addChild(belt);
    settlerContainer.addChild(leftHand);
    settlerContainer.addChild(rightHand);
    settlerContainer.addChild(bag);
    settlerContainer.addChild(carriedLog);
    settlerContainer.addChild(carriedStone);
    settlerContainer.addChild(carriedGold);
    settlerContainer.addChild(carriedIron);
    settlerContainer.addChild(shovel);
    settlerContainer.addChild(hammer);
    settlerContainer.addChild(head);
    settlerContainer.addChild(hat);

    // Active state managed by checking Float32Array directly
    settlerContainer.visible = false;

    // Cache nested nodes
    settlerContainer.customShadow = shadow;
    settlerContainer.customLeftFoot = leftFoot;
    settlerContainer.customRightFoot = rightFoot;
    settlerContainer.customBody = body;
    settlerContainer.customLeftHand = leftHand;
    settlerContainer.customRightHand = rightHand;
    settlerContainer.customBag = bag;
    settlerContainer.customLog = carriedLog;
    settlerContainer.customStone = carriedStone;
    settlerContainer.customGold = carriedGold;
    settlerContainer.customIron = carriedIron;
    settlerContainer.customShovel = shovel;
    settlerContainer.customHammer = hammer;
    settlerContainer.customHat = hat;

    // Cache the sprite reference
    settlerSprites.push(settlerContainer);
    worldContainer.addChild(settlerContainer);
  }
}

function createBuildingSprite(typeCode) {
  const container = new Container();

  // Cozy S4-style diagonal drop shadow extending far down-right!
  const dropShadow = new Graphics();
  container.addChild(dropShadow);

  // 1. Cozy Shaded Cobblestone Foundation (sits perfectly on 64x32 tile)
  const foundation = new Graphics();
  
  // Layered Shadow Base
  foundation.moveTo(0, -18)
    .lineTo(34, 0)
    .lineTo(0, 18)
    .lineTo(-34, 0)
    .closePath()
    .fill({ color: 0x272727, alpha: 0.4 }); // soft foundation ambient shadow

  // Stone Base
  foundation.moveTo(0, -16)
    .lineTo(32, 0)
    .lineTo(0, 16)
    .lineTo(-32, 0)
    .closePath()
    .fill({ color: 0x4a4a4a }) // deep granite
    .stroke({ width: 1.5, color: 0x2b2b2b });

  // Textured Cobbles
  const cobbleColors = [0x5e5e5e, 0x6e6e6e, 0x555555];
  for (let j = 0; j < 12; j++) {
    const rx = -22 + Math.random() * 44;
    const ry = -10 + Math.random() * 20;
    const size = 1.5 + Math.random() * 2.5;
    const col = cobbleColors[j % cobbleColors.length];
    foundation.circle(rx, ry, size).fill({ color: col });
  }

  // Moss/Weeds Creep on Foundation
  foundation.ellipse(-22, 2, 5, 2.5).fill({ color: 0x2d5a27, alpha: 0.6 });
  foundation.ellipse(18, -4, 6, 3).fill({ color: 0x2d5a27, alpha: 0.6 });

  container.addChild(foundation);

  // 2. Main Building Container
  const completeBuilding = new Container();
  
  let buildingColor = 0xfdf5e6; // Warm cream plaster
  let roofColor = 0xb22222; // Terracotta Red (Roman/Solari theme)
  let detailType = 'standard';
  
  if (typeCode === 1.0) { // Woodcutter
    roofColor = 0xc5a033; // Yellow-gold straw thatch
    detailType = 'woodcutter';
  } else if (typeCode === 2.0) { // Sawmill
    roofColor = 0xcd5c5c; // Rose tiled
    detailType = 'sawmill';
  } else if (typeCode === 3.0) { // Stonecutter
    buildingColor = 0xe0e0e0; // Slate granite plaster
    roofColor = 0x4f5d73; // Slate-blue tiles
    detailType = 'stonecutter';
  } else if (typeCode === 4.0) { // Residence
    roofColor = 0xb22222; // Terracotta tiled
    detailType = 'residence';
  } else if (typeCode === 5.0) { // Grain Farm
    roofColor = 0xe5c158; // Straw thatch
    detailType = 'farm';
  } else if (typeCode === 6.0) { // Grain Mill
    buildingColor = 0xd7ccc8;
    roofColor = 0x8d6e63;
    detailType = 'mill';
  } else if (typeCode === 7.0) { // Bakery
    buildingColor = 0xf5f5dc;
    roofColor = 0xbf360c; // brick-orange roof
    detailType = 'bakery';
  } else if (typeCode === 8.0) { // Pig Farm
    buildingColor = 0xd7ccc8;
    roofColor = 0x8d6e63;
    detailType = 'pigfarm';
  } else if (typeCode === 9.0) { // Slaughterhouse
    buildingColor = 0xc0c0c0;
    roofColor = 0x5c4033;
    detailType = 'slaughterhouse';
  } else if (typeCode === 10.0) { // Coal Mine
    detailType = 'coalmine';
  } else if (typeCode === 11.0) { // Iron Mine
    detailType = 'ironmine';
  } else if (typeCode === 12.0) { // Gold Smelter
    buildingColor = 0xd7ccc8;
    roofColor = 0xd84315; // fiery orange roof
    detailType = 'goldsmelter';
  } else if (typeCode === 13.0) { // Weapon Smithy
    buildingColor = 0x8d6e63; // Dark soot bricks
    roofColor = 0x3e2723; // Dark charcoal tiles
    detailType = 'smithy';
  } else if (typeCode === 14.0) { // Sentry Tower
    detailType = 'tower';
  } else if (typeCode === 15.0) { // Barracks
    roofColor = 0x8b0000;
    detailType = 'barracks';
  } else if (typeCode === 16.0) { // Stone Temple
    detailType = 'temple';
  }

  // Draw the customized S4-style diagonal drop shadow based on building type!
  if (detailType === 'woodcutter') {
    dropShadow.moveTo(5, 5).lineTo(45, 20).lineTo(25, 35).lineTo(-10, 15).closePath().fill({ color: 0x000000, alpha: 0.23 });
  } else if (detailType === 'sawmill') {
    dropShadow.moveTo(5, 5).lineTo(50, 22).lineTo(28, 38).lineTo(-8, 15).closePath().fill({ color: 0x000000, alpha: 0.23 });
  } else if (detailType === 'stonecutter') {
    dropShadow.moveTo(5, 5).lineTo(42, 18).lineTo(24, 32).lineTo(-10, 12).closePath().fill({ color: 0x000000, alpha: 0.23 });
  } else if (detailType === 'residence') {
    dropShadow.moveTo(5, 5).lineTo(46, 20).lineTo(26, 36).lineTo(-10, 15).closePath().fill({ color: 0x000000, alpha: 0.23 });
  } else if (detailType === 'farm') {
    dropShadow.moveTo(5, 5).lineTo(52, 22).lineTo(30, 40).lineTo(-12, 18).closePath().fill({ color: 0x000000, alpha: 0.23 });
  } else if (detailType === 'mill') {
    dropShadow.moveTo(5, 5).lineTo(48, 20).lineTo(28, 36).lineTo(-10, 15).closePath().fill({ color: 0x000000, alpha: 0.23 });
  } else if (detailType === 'mine' || detailType === 'coalmine' || detailType === 'ironmine') {
    dropShadow.ellipse(12, 6, 18, 9).fill({ color: 0x000000, alpha: 0.23 });
  } else if (detailType === 'smithy') {
    dropShadow.moveTo(5, 5).lineTo(48, 20).lineTo(26, 36).lineTo(-12, 15).closePath().fill({ color: 0x000000, alpha: 0.23 });
  } else if (detailType === 'tower') {
    dropShadow.moveTo(5, 5).lineTo(45, 38).lineTo(32, 48).lineTo(-10, 15).closePath().fill({ color: 0x000000, alpha: 0.23 });
  } else if (detailType === 'barracks') {
    dropShadow.moveTo(5, 5).lineTo(60, 25).lineTo(35, 45).lineTo(-15, 18).closePath().fill({ color: 0x000000, alpha: 0.23 });
  } else if (detailType === 'temple') {
    dropShadow.ellipse(0, 4, 30, 15).fill({ color: 0x000000, alpha: 0.23 });
  } else {
    dropShadow.moveTo(5, 5).lineTo(45, 20).lineTo(25, 35).lineTo(-10, 15).closePath().fill({ color: 0x000000, alpha: 0.23 });
  }

  // MINES BRANCH
  if (detailType === 'mine' || detailType === 'coalmine' || detailType === 'ironmine') {
    const mineEntrance = new Container();
    
    const isCoal = detailType === 'coalmine';
    const isIron = detailType === 'ironmine';
    const earthCol = isCoal ? 0x212121 : (isIron ? 0x4e3d30 : 0x4e3629);
    const moundCol = isCoal ? 0x111111 : (isIron ? 0x3e2b20 : 0x3d2b20);
    const grassCol = isCoal ? 0x224422 : (isIron ? 0x335c26 : 0x2e5c26);
    const timberCol = isCoal ? 0x3e2723 : (isIron ? 0x8b5a2b : 0x5c4033);
    const highlightCol = isCoal ? 0x5c4033 : (isIron ? 0xb5845b : 0x8b5a2b);
    const lanternCol = isCoal ? 0xffa000 : (isIron ? 0xb3e5fc : 0xffd700);
    
    // Cozy Grass/Earth Mound
    const mound = new Graphics()
      .ellipse(0, -6, 26, 14).fill({ color: earthCol })
      .ellipse(0, -12, 18, 10).fill({ color: moundCol })
      .ellipse(-14, -8, 8, 4).fill({ color: grassCol })
      .ellipse(14, -10, 8, 4).fill({ color: grassCol });
    
    // Mine entrance hole
    const shaft = new Graphics()
      .moveTo(-10, 2)
      .lineTo(-10, -18)
      .bezierCurveTo(-10, -26, 10, -26, 10, -18)
      .lineTo(10, 2)
      .closePath()
      .fill({ color: 0x050505 });
      
    // Thick timber supporting frames
    const frame = new Graphics()
      .rect(-12, -20, 3.5, 22).fill({ color: timberCol })
      .rect(-11.5, -20, 1, 22).fill({ color: highlightCol })
      .rect(8.5, -20, 3.5, 22).fill({ color: timberCol })
      .rect(9, -20, 1, 22).fill({ color: highlightCol })
      .rect(-12, -23, 24, 4).fill({ color: timberCol })
      .rect(-12, -22.5, 24, 1).fill({ color: highlightCol })
      .moveTo(-9, -16).lineTo(-4, -20).stroke({ color: 0x3e2723, width: 2.5 })
      .moveTo(9, -16).lineTo(3, -20).stroke({ color: 0x3e2723, width: 2.5 });

    // Hanging lantern at entrance (will sway in renderLoop)
    const lanternContainer = new Container();
    lanternContainer.x = 0;
    lanternContainer.y = -20;
    const lantern = new Graphics()
      .rect(-0.5, 0, 1, 4).fill({ color: 0x2b2b2b }) // wire
      .circle(0, 5.5, 2.5).fill({ color: lanternCol }) // glow bulb
      .rect(-2, 3.5, 4, 1.5).fill({ color: 0x2b2b2b }); // cap
    lanternContainer.addChild(lantern);

    // Mine tracks coming out to the foundation edge
    const tracks = new Graphics()
      .moveTo(-4, 3).lineTo(-8, 14).stroke({ color: 0x8c8c8c, width: 2 })
      .moveTo(4, 3).lineTo(8, 14).stroke({ color: 0x8c8c8c, width: 2 })
      .moveTo(-5, 6).lineTo(5, 5).stroke({ color: 0x5c4033, width: 2 })
      .moveTo(-7, 10).lineTo(7, 9).stroke({ color: 0x5c4033, width: 2 });

    // Minecart filled with ore sitting on tracks (will roll in renderLoop)
    const cart = new Container();
    cart.x = 0;
    cart.y = 3;
    
    const cartBinCol = isCoal ? 0x4e3629 : (isIron ? 0x546e7a : 0x78909c);
    const cartStrokeCol = isCoal ? 0x271c15 : (isIron ? 0x263238 : 0x37474f);
    const cartOreCol = isCoal ? 0x111111 : (isIron ? 0xa1adc2 : 0xdcdcdc);
    
    const cartGraphic = new Graphics()
      .rect(-5, -6, 10, 5).fill({ color: cartBinCol })
      .stroke({ width: 0.8, color: cartStrokeCol })
      .ellipse(0, -6, 4.5, 2).fill({ color: cartOreCol })
      .circle(-3.5, 0, 1.8).fill({ color: 0x111111 })
      .circle(3.5, 0, 1.8).fill({ color: 0x111111 });
    cart.addChild(cartGraphic);

    // Draw stone piles outside
    const stonePile = new Graphics();
    if (isCoal) {
      stonePile.moveTo(-23, 6).lineTo(-18, 1).lineTo(-13, 6).closePath().fill({ color: 0x111111 }).stroke({ width: 0.8, color: 0x000000 })
                .circle(-21, 5, 1.2).fill({ color: 0x000000 });
    } else if (isIron) {
      stonePile.moveTo(13, 6).lineTo(18, 1).lineTo(23, 6).closePath().fill({ color: 0xa1adc2 }).stroke({ width: 0.8, color: 0x546e7a })
                .circle(16, 5, 1.2).fill({ color: 0xd84315 });
    }
    
    mineEntrance.addChild(mound);
    mineEntrance.addChild(shaft);
    mineEntrance.addChild(frame);
    mineEntrance.addChild(lanternContainer);
    mineEntrance.addChild(stonePile);
    mineEntrance.addChild(tracks);
    mineEntrance.addChild(cart);
    
    mineEntrance.visible = false;
    container.addChild(mineEntrance);
    container.customComplete = mineEntrance;
    mineEntrance.customLantern = lanternContainer;
    mineEntrance.customCart = cart;
  }
  // SENTRY TOWER BRANCH
  else if (detailType === 'tower') {
    const tower = new Container();
    
    // Stone tower base & brick accents
    const column = new Graphics()
      .rect(-11, -42, 22, 42).fill({ color: 0x6b6b6b })
      .stroke({ width: 1.8, color: 0x3a3a3a });
    
    // Draw stone mortar/brick patterns
    for (let k = 0; k < 5; k++) {
      column.rect(-9, -8 - k * 8, 4, 3).fill({ color: 0x4e4e4e });
      column.rect(5, -4 - k * 9, 4, 3).fill({ color: 0x4e4e4e });
      column.rect(-2, -12 - k * 7, 5, 2.5).fill({ color: 0x5a5a5a });
    }

    // Cozy arched window inside tower
    const windowCell = new Graphics()
      .moveTo(-3, -26)
      .lineTo(-3, -31)
      .bezierCurveTo(-3, -34, 3, -34, 3, -31)
      .lineTo(3, -26)
      .closePath()
      .fill({ color: 0xffd700 }) // glowing warm light
      .stroke({ color: 0x2b2b2b, width: 1 });

    // Wooden battlement deck & platforms
    const deck = new Graphics()
      .rect(-14, -46, 28, 5).fill({ color: 0x5c4033 }) // wood floor
      .rect(-13.5, -45, 27, 1).fill({ color: 0x8b5a2b }) // highlight edge
      .rect(-14, -55, 4, 9).fill({ color: 0x4e4e4e }) // stone crenellations
      .rect(10, -55, 4, 9).fill({ color: 0x4e4e4e })
      .rect(-4, -55, 8, 9).fill({ color: 0x4e4e4e });

    // Waving red faction flag on a tall timber pole
    const flagContainer = new Container();
    flagContainer.x = -8;
    flagContainer.y = -52;
    const flagGraphic = new Graphics()
      .rect(-1, -16, 2, 16).fill({ color: 0x8b5a2b }) // wood pole
      .moveTo(1, -16).lineTo(14, -12).lineTo(1, -8).closePath().fill({ color: 0xb22222 }) // banner body
      .moveTo(1, -13).lineTo(8, -11).stroke({ color: 0xffd700, width: 1.2 }); // golden pattern
    flagContainer.addChild(flagGraphic);

    // Guard soldier (Archer!) standing on deck! (Patrols deck)
    const guard = new Container();
    guard.x = 4;
    guard.y = -46;
    const guardBody = new Graphics()
      .ellipse(0, -6, 3.5, 4.5).fill({ color: 0xb22222 }) // red uniform
      .circle(0, -12, 3.2).fill({ color: 0xffdbac }) // head
      .rect(-4.5, -15, 9, 3).fill({ color: 0x757575 }) // iron helmet
      .moveTo(-3.5, -10).lineTo(3.5, -10).stroke({ color: 0xffd700, width: 1 }); // belt
    const bow = new Graphics()
      .moveTo(-2, -10).bezierCurveTo(-5, -6, -5, 2, -2, 6).stroke({ color: 0x8b5a2b, width: 1.2 }); // wood bow
    guard.addChild(guardBody);
    guard.addChild(bow);

    tower.addChild(column);
    tower.addChild(windowCell);
    tower.addChild(deck);
    tower.addChild(flagContainer);
    tower.addChild(guard);
    
    tower.visible = false;
    container.addChild(tower);
    container.customComplete = tower;
    tower.customFlag = flagContainer;
    tower.customGuard = guard;
  }
  // MYSTIC STONE TEMPLE BRANCH
  else if (detailType === 'temple') {
    const temple = new Container();
    
    // Mystical magic circle light glow
    const glow = new Graphics()
      .circle(0, 0, 16).fill({ color: 0x8a2be2, alpha: 0.15 })
      .circle(0, 0, 8).fill({ color: 0x00ffff, alpha: 0.1 });
    glow.scale.y = 0.5; // flat isometric
    glow.y = 0;

    // Mossy Stone Monolith Henge Base
    const henge = new Graphics()
      .rect(-16, -18, 5, 18).fill({ color: 0x757575 }).stroke({ width: 1.2, color: 0x424242 })
      .rect(11, -18, 5, 18).fill({ color: 0x757575 }).stroke({ width: 1.2, color: 0x424242 })
      .rect(-18, -22, 36, 4).fill({ color: 0x616161 }).stroke({ width: 1.2, color: 0x37474f })
      // moss overlays
      .ellipse(-14, -18, 3, 2).fill({ color: 0x2e7d32, alpha: 0.6 })
      .ellipse(13, -10, 2.5, 1.8).fill({ color: 0x2e7d32, alpha: 0.6 })
      .ellipse(0, -21, 6, 1.2).fill({ color: 0x2e7d32, alpha: 0.6 });
      
    // Altar pedestal in center
    const altar = new Graphics()
      .rect(-6, -8, 12, 8).fill({ color: 0x424242 }).stroke({ width: 1, color: 0x212121 })
      .rect(-5, -9, 10, 1.5).fill({ color: 0x9e9e9e });
      
    // Mystic Floating Diamond Crystal
    const crystalContainer = new Container();
    crystalContainer.x = 0;
    crystalContainer.y = -18;
    const crystal = new Graphics()
      .moveTo(0, -6)
      .lineTo(3.5, 0)
      .lineTo(0, 6)
      .lineTo(-3.5, 0)
      .closePath()
      .fill({ color: 0xcc33ff }) // glowing violet
      .stroke({ width: 0.8, color: 0xe0a0ff })
      .moveTo(0, -6).lineTo(0, 6).stroke({ width: 0.5, color: 0xffffff, alpha: 0.5 })
      .moveTo(-3.5, 0).lineTo(3.5, 0).stroke({ width: 0.5, color: 0xffffff, alpha: 0.5 });
    crystalContainer.addChild(crystal);
    
    temple.addChild(glow);
    temple.addChild(henge);
    temple.addChild(altar);
    temple.addChild(crystalContainer);
    
    temple.visible = false;
    container.addChild(temple);
    container.customComplete = temple;
    temple.customCrystal = crystalContainer;
    temple.customGlow = glow;
  }
  // BARRACKS BRANCH
  else if (detailType === 'barracks') {
    const barracks = new Container();
    
    // Plastered Walls
    const walls = new Graphics()
      .rect(-24, -24, 48, 24)
      .fill({ color: buildingColor })
      .stroke({ width: 2, color: 0x3e2723 });

    // Fachwerk Timber Beams
    const beams = new Graphics();
    beams.stroke({ width: 2.2, color: 0x3e2723 });
    beams.moveTo(-23, -23).lineTo(-23, 0);
    beams.moveTo(23, -23).lineTo(23, 0);
    beams.moveTo(-24, -12).lineTo(24, -12);
    beams.moveTo(-20, -24).lineTo(-10, -12);
    beams.moveTo(20, -24).lineTo(10, -12);
    walls.addChild(beams);
    barracks.addChild(walls);

    // Arched Oak Door
    const door = new Graphics()
      .moveTo(-5.5, 0)
      .lineTo(-5.5, -14)
      .bezierCurveTo(-5.5, -18, 5.5, -18, 5.5, -14)
      .lineTo(5.5, 0)
      .closePath()
      .fill({ color: 0x4e3629 }) // mahogany
      .stroke({ width: 1.5, color: 0x2b1e15 })
      .circle(3.5, -8, 1.2).fill({ color: 0xffd700 }); 
    barracks.addChild(door);
    
    // Windows
    const windowLeft = new Graphics()
      .rect(-17, -18, 6, 6).fill({ color: 0xffd700 })
      .stroke({ width: 1.5, color: 0x3e2723 })
      .moveTo(-14, -18).lineTo(-14, -12).stroke({ width: 0.8, color: 0x3e2723 });
    const windowRight = new Graphics()
      .rect(11, -18, 6, 6).fill({ color: 0xffd700 })
      .stroke({ width: 1.5, color: 0x3e2723 })
      .moveTo(14, -18).lineTo(14, -12).stroke({ width: 0.8, color: 0x3e2723 });
    barracks.addChild(windowLeft);
    barracks.addChild(windowRight);

    // Clay Tile Roof
    const roof = new Graphics()
      .moveTo(-27, -24)
      .lineTo(0, -45)
      .lineTo(27, -24)
      .closePath()
      .fill({ color: roofColor })
      .stroke({ width: 2, color: 0x3e2723 });
    barracks.addChild(roof);

    // Brick/Stone Chimney at the back
    const chimney = new Graphics()
      .rect(10, -41, 6, 12).fill({ color: 0xb22222 })
      .stroke({ width: 1.2, color: 0x3e2723 })
      .rect(9, -43, 8, 2.5).fill({ color: 0x3a3a3a });
    barracks.addChild(chimney);

    // Interactive details props
    const props = new Container();
    
    // Shields
    const shield1 = new Graphics().circle(-28, 2, 3.5).fill({ color: 0xb22222 }).stroke({ width: 1, color: 0xffd700 });
    const shield2 = new Graphics().circle(-24, 0, 3.5).fill({ color: 0x3e2723 }).stroke({ width: 1, color: 0xdcdcdc });
    
    // Spinning wooden training dummy
    const dummy = new Container();
    dummy.x = 22;
    dummy.y = 5;
    const post = new Graphics().rect(-1, -10, 2, 10).fill({ color: 0x8b5a2b });
    const arms = new Graphics()
      .rect(-6, -11, 12, 2.5).fill({ color: 0x5c4033 }) // crossbeam
      .circle(-6, -10, 2).fill({ color: 0xe5a93b }) // target
      .circle(6, -10, 2).fill({ color: 0xe5a93b });
    dummy.addChild(post);
    dummy.addChild(arms);
    
    props.addChild(shield1);
    props.addChild(shield2);
    props.addChild(dummy);
    barracks.addChild(props);

    barracks.customDummyArms = arms;
    
    barracks.visible = false;
    container.addChild(barracks);
    container.customComplete = barracks;
  }
  // STANDARD COZY BUILDINGS
  else {
    // 1. Plastered Walls (Beige / Slate / Cream)
    const walls = new Graphics()
      .rect(-20, -24, 40, 24)
      .fill({ color: buildingColor })
      .stroke({ width: 2, color: 0x3e2723 });

    // 2. Thick Shaded Fachwerk Timber Beams
    const beams = new Graphics();
    beams.stroke({ width: 2.2, color: 0x3e2723 });
    // Corner posts
    beams.moveTo(-19, -23).lineTo(-19, 0);
    beams.moveTo(19, -23).lineTo(19, 0);
    // Horizontal cross-beams
    beams.moveTo(-20, -12).lineTo(20, -12);
    // Diagonal supports
    beams.moveTo(-20, -24).lineTo(-10, -12);
    beams.moveTo(20, -24).lineTo(10, -12);
    beams.moveTo(-10, -12).lineTo(-20, 0);
    beams.moveTo(10, -12).lineTo(20, 0);
    
    // Highlight lines on timber beams to make them look 3D!
    const beamHighlights = new Graphics();
    beamHighlights.stroke({ width: 0.8, color: 0x8b5a2b });
    beamHighlights.moveTo(-18, -23).lineTo(-18, 0);
    beamHighlights.moveTo(18, -23).lineTo(18, 0);
    beamHighlights.moveTo(-19, -11).lineTo(19, -11);

    walls.addChild(beams);
    walls.addChild(beamHighlights);

    // 3. Arched Cozy Oak Door
    const door = new Graphics()
      .moveTo(-5.5, 0)
      .lineTo(-5.5, -12)
      .bezierCurveTo(-5.5, -16, 5.5, -16, 5.5, -12)
      .lineTo(5.5, 0)
      .closePath()
      .fill({ color: 0x4e3629 }) // dark mahogany
      .stroke({ width: 1.5, color: 0x2b1e15 })
      .circle(3.5, -7, 1.2).fill({ color: 0xffd700 }); // golden handle
    
    // 4. Windows with warm glow & leaded glass cross panes
    const windowLeft = new Graphics()
      .rect(-14, -18, 6, 6).fill({ color: 0xffd700 })
      .stroke({ width: 1.5, color: 0x3e2723 })
      .moveTo(-11, -18).lineTo(-11, -12).stroke({ width: 0.8, color: 0x3e2723 })
      .moveTo(-14, -15).lineTo(-8, -15).stroke({ width: 0.8, color: 0x3e2723 });

    const windowRight = new Graphics()
      .rect(8, -18, 6, 6).fill({ color: 0xffd700 })
      .stroke({ width: 1.5, color: 0x3e2723 })
      .moveTo(11, -18).lineTo(11, -12).stroke({ width: 0.8, color: 0x3e2723 })
      .moveTo(8, -15).lineTo(14, -15).stroke({ width: 0.8, color: 0x3e2723 });

    completeBuilding.addChild(walls);
    completeBuilding.addChild(door);
    completeBuilding.addChild(windowLeft);
    completeBuilding.addChild(windowRight);

    // 5. Layered Clay Tile Roofs or Organic Thatch straw
    const roof = new Graphics()
      .moveTo(-23, -24)
      .lineTo(0, -43)
      .lineTo(23, -24)
      .closePath()
      .fill({ color: roofColor })
      .stroke({ width: 2, color: 0x3e2723 });

    // Red/Slate Clay Tiles Layering
    if (detailType === 'residence' || detailType === 'sawmill' || detailType === 'stonecutter' || detailType === 'barracks' || detailType === 'smithy') {
      const tilePatterns = new Graphics();
      const shadowCol = roofColor === 0x4f5d73 ? 0x2c3b4e : 0x6b1414;
      const lightCol = roofColor === 0x4f5d73 ? 0x7687a1 : 0xe25454;
      
      // Horizontal layered tile lines
      tilePatterns.stroke({ width: 1.5, color: shadowCol });
      tilePatterns.moveTo(-17, -29).lineTo(17, -29);
      tilePatterns.moveTo(-12, -34).lineTo(12, -34);
      tilePatterns.moveTo(-7, -39).lineTo(7, -39);
      
      // Highlights on tile edges
      tilePatterns.stroke({ width: 0.8, color: lightCol });
      tilePatterns.moveTo(-17, -28).lineTo(17, -28);
      tilePatterns.moveTo(-12, -33).lineTo(12, -33);
      tilePatterns.moveTo(-7, -38).lineTo(7, -38);
      
      // Curved vertical joints
      tilePatterns.stroke({ width: 1.0, color: shadowCol });
      tilePatterns.moveTo(-9, -29).lineTo(-9, -24);
      tilePatterns.moveTo(9, -29).lineTo(9, -24);
      tilePatterns.moveTo(-5, -34).lineTo(-5, -29);
      tilePatterns.moveTo(5, -34).lineTo(5, -29);
      roof.addChild(tilePatterns);
    } 
    // Straw/Thatch Organic Overhangs
    else {
      const thatchPatterns = new Graphics();
      thatchPatterns.stroke({ width: 1.2, color: 0x9b7a1e }); // shadow color
      
      // Layered straw lines
      for (let s = 0; s < 6; s++) {
        thatchPatterns.moveTo(-20 + s * 4, -24).lineTo(-10 + s * 2, -33);
        thatchPatterns.moveTo(20 - s * 4, -24).lineTo(10 - s * 2, -33);
      }
      
      // Highlight straw blades
      thatchPatterns.stroke({ width: 0.8, color: 0xffeb3b });
      thatchPatterns.moveTo(-15, -26).lineTo(-8, -32.5);
      thatchPatterns.moveTo(15, -26).lineTo(8, -32.5);
      
      // Fluffy hanging straw eaves at roof edge
      const thatchEaves = new Graphics();
      thatchEaves.stroke({ width: 2, color: roofColor });
      thatchEaves.moveTo(-23, -24).bezierCurveTo(-23, -22, -18, -22, -18, -24)
                 .bezierCurveTo(-18, -22, -13, -22, -13, -24)
                 .bezierCurveTo(-13, -22, -8, -22, -8, -24)
                 .bezierCurveTo(-8, -22, -3, -22, -3, -24)
                 .bezierCurveTo(-3, -22, 2, -22, 2, -24)
                 .bezierCurveTo(2, -22, 7, -22, 7, -24)
                 .bezierCurveTo(7, -22, 12, -22, 12, -24)
                 .bezierCurveTo(12, -22, 17, -22, 17, -24)
                 .bezierCurveTo(17, -22, 23, -22, 23, -24);
      roof.addChild(thatchPatterns);
      roof.addChild(thatchEaves);
    }

    // 6. Brick/Stone Chimney at the back (puffing smoke)
    const chimney = new Graphics()
      .rect(8, -39, 6, 12).fill({ color: 0xb22222 }) // red clay brick
      .stroke({ width: 1.2, color: 0x3e2723 })
      .rect(7, -41, 8, 2.5).fill({ color: 0x3a3a3a }); // iron venting cap
    
    // Draw brick joints on chimney
    chimney.moveTo(8, -33).lineTo(14, -33).stroke({ color: 0xe0e0e0, width: 0.8 });
    chimney.moveTo(8, -36).lineTo(14, -36).stroke({ color: 0xe0e0e0, width: 0.8 });

    completeBuilding.addChild(chimney);
    completeBuilding.addChild(roof);

    // 7. Dynamic Architectural Detail Props
    if (detailType === 'woodcutter') {
      const props = new Container();
      
      // Beautiful Stacked Log Pile next to house
      const log1 = new Graphics().rect(-28, -2, 9, 4.5).fill({ color: 0x6d4c41 }).stroke({ width: 1, color: 0x3e2723 });
      const log2 = new Graphics().rect(-24, -5.5, 9, 4.5).fill({ color: 0x6d4c41 }).stroke({ width: 1, color: 0x3e2723 });
      const log3 = new Graphics().rect(-26, -9, 8, 4).fill({ color: 0x6d4c41 }).stroke({ width: 1, color: 0x3e2723 });
      
      // Golden End-Grain circles
      log1.circle(-28, 0, 2.25).fill({ color: 0xe5c158 });
      log1.circle(-19, 0, 2.25).fill({ color: 0xe5c158 });
      log2.circle(-24, -3.25, 2.25).fill({ color: 0xe5c158 });
      log2.circle(-15, -3.25, 2.25).fill({ color: 0xe5c158 });
      log3.circle(-26, -7, 2).fill({ color: 0xe5c158 });
      log3.circle(-18, -7, 2).fill({ color: 0xe5c158 });

      props.addChild(log1);
      props.addChild(log2);
      props.addChild(log3);
      completeBuilding.addChild(props);
    } 
    else if (detailType === 'sawmill') {
      const props = new Container();
      
      // Heavy wood workbench frame
      const workbench = new Graphics()
        .rect(20, -10, 11, 10).fill({ color: 0x5c4033 })
        .stroke({ width: 1.2, color: 0x3e2723 });
      
      // Glowing rotating steel saw blade
      const sawBlade = new Graphics()
        .circle(25.5, -10, 5.5).fill({ color: 0xdcdcdc })
        .stroke({ width: 1, color: 0x757575 });
      
      // Dynamic sharp teeth
      for (let a = 0; a < 8; a++) {
        const angle = (a / 8) * Math.PI * 2;
        sawBlade.moveTo(25.5 + Math.cos(angle) * 5.5, -10 + Math.sin(angle) * 5.5)
                 .lineTo(25.5 + Math.cos(angle + 0.15) * 7.5, -10 + Math.sin(angle + 0.15) * 7.5);
      }
      sawBlade.stroke({ width: 1, color: 0xa6a6a6 });
      
      props.addChild(workbench);
      props.addChild(sawBlade);
      completeBuilding.addChild(props);
      
      // Cache saw blade so we can spin it at 60 FPS in render loop!
      completeBuilding.customSaw = sawBlade;
    }
    else if (detailType === 'mill') {
      const props = new Container();
      props.x = 0;
      props.y = -34;
      
      const sails = new Graphics();
      // Heavy timber axle hub
      sails.circle(0, 0, 3.5).fill({ color: 0x5e35b1 }) // gear box
           .circle(0, 0, 1.5).fill({ color: 0xffd700 }); // brass pin
      
      // 4 Windmill Sail structures
      sails.stroke({ color: 0x3e2723, width: 2.2 });
      for (let s = 0; s < 4; s++) {
        const rot = (s / 4) * Math.PI * 2;
        const dx = Math.cos(rot);
        const dy = Math.sin(rot);
        
        // Spar arms
        sails.moveTo(0, 0).lineTo(dx * 19, dy * 19);
        
        // Cozy canvas sails lattice structure
        sails.moveTo(dx * 7, dy * 7)
             .lineTo(dx * 19 + Math.cos(rot + 0.5) * 5.5, dy * 19 + Math.sin(rot + 0.5) * 5.5)
             .stroke({ color: 0xf5f5dc, width: 1.5 }); // beige sail
      }
      props.addChild(sails);
      completeBuilding.addChild(props);
      
      // Cache sails to rotate it
      completeBuilding.customSails = sails;
    }
    else if (detailType === 'farm') {
      const props = new Container();
      
      // Fluffy golden-yellow haystacks
      const stack = new Graphics()
        .moveTo(-26, 0)
        .lineTo(-31, -11)
        .bezierCurveTo(-31, -16, -21, -16, -21, -11)
        .lineTo(-26, 0)
        .closePath()
        .fill({ color: 0xe5c158 })
        .stroke({ width: 1.2, color: 0x9b7a1e });
      
      // Highlight straws on stack
      stack.stroke({ width: 0.8, color: 0xffeb3b });
      stack.moveTo(-26, -12).lineTo(-28, -6);
      stack.moveTo(-24, -13).lineTo(-22, -8);

      props.addChild(stack);
      completeBuilding.addChild(props);
    }
    else if (detailType === 'smithy') {
      const props = new Container();
      
      // Outdoor Stone Anvil
      const anvil = new Graphics()
        .rect(20, -5, 8, 5).fill({ color: 0x424242 }) // base block
        .stroke({ width: 1, color: 0x212121 })
        .moveTo(17, -9).lineTo(26, -9).lineTo(23, -5).lineTo(20, -5).closePath().fill({ color: 0x757575 }); // anvil horn
      
      // Smith's Hammer (will swing!)
      const hammer = new Container();
      hammer.x = 21.5;
      hammer.y = -10;
      const hammerGraphic = new Graphics()
        .rect(-1, -7, 2, 7).fill({ color: 0x8b5a2b }) // wood handle
        .rect(-3, -10, 6, 3.5).fill({ color: 0x212121 }); // iron head
      hammer.addChild(hammerGraphic);
      
      // Forge Hearth furnace
      const hearth = new Graphics()
        .rect(-28, -10, 10, 10).fill({ color: 0x4e342e })
        .stroke({ width: 1.2, color: 0x3e2723 });
        
      // Glowing Hot Coals
      const coals = new Graphics()
        .circle(-23, -8, 3.5).fill({ color: 0xff3d00 })
        .circle(-23, -8, 1.8).fill({ color: 0xffab00 });
        
      // Weapon rack prop
      const rack = new Graphics()
        .rect(-14, -12, 1.5, 12).fill({ color: 0x5c4033 })
        .rect(-6, -12, 1.5, 12).fill({ color: 0x5c4033 })
        .rect(-14, -13, 9, 2).fill({ color: 0x5c4033 })
        .rect(-12, -10, 1.2, 10).fill({ color: 0x8c8c8c })
        .rect(-9, -11, 1.2, 11).fill({ color: 0x8c8c8c });

      props.addChild(anvil);
      props.addChild(hammer);
      props.addChild(hearth);
      props.addChild(coals);
      props.addChild(rack);
      completeBuilding.addChild(props);
      completeBuilding.customSmithHammer = hammer;
      completeBuilding.customSmithCoals = coals;
    }
    else if (detailType === 'stonecutter') {
      const props = new Container();
      const block1 = new Graphics().rect(-26, -2, 8, 5).fill({ color: 0x808080 }).stroke({ width: 1, color: 0x404040 });
      const block2 = new Graphics().rect(-20, -5, 8, 5).fill({ color: 0x909090 }).stroke({ width: 1, color: 0x404040 });
      const block3 = new Graphics().rect(-23, -8, 7, 4).fill({ color: 0xa0a0a0 }).stroke({ width: 1, color: 0x404040 });
      
      const hammer = new Graphics()
        .rect(-1, -12, 2, 8).fill({ color: 0x5c4033 })
        .rect(-3, -15, 6, 3).fill({ color: 0x505050 });
      hammer.x = -16;
      hammer.y = -6;
      
      props.addChild(block1);
      props.addChild(block2);
      props.addChild(block3);
      props.addChild(hammer);
      completeBuilding.addChild(props);
      completeBuilding.customChiselHammer = hammer;
    }
    else if (detailType === 'bakery') {
      const props = new Container();
      
      const oven = new Graphics()
        .rect(18, -12, 14, 12).fill({ color: 0x7e57c2 })
        .stroke({ width: 1.2, color: 0x4a148c })
        .ellipse(25, -12, 7, 4).fill({ color: 0x7e57c2 })
        .rect(23, -16, 4, 5).fill({ color: 0x37474f });
        
      const mouth = new Graphics()
        .moveTo(21, -2)
        .lineTo(21, -8)
        .bezierCurveTo(21, -11, 29, -11, 29, -8)
        .lineTo(29, -2)
        .closePath()
        .fill({ color: 0x1a0a05 })
        .stroke({ width: 1, color: 0x3e2723 });
        
      const fire = new Graphics()
        .circle(25, -4, 2.5).fill({ color: 0xff3d00 })
        .circle(25, -4, 1.2).fill({ color: 0xffea00 });
      
      const basket = new Graphics()
        .ellipse(-25, 0, 5, 3.5).fill({ color: 0xd7ccc8 })
        .stroke({ width: 1, color: 0x8d6e63 })
        .circle(-26, -2, 1.8).fill({ color: 0xe5a93b })
        .circle(-23, -2, 1.8).fill({ color: 0xe5a93b });
        
      props.addChild(oven);
      props.addChild(mouth);
      props.addChild(fire);
      props.addChild(basket);
      completeBuilding.addChild(props);
      completeBuilding.customOvenFire = fire;
    }
    else if (detailType === 'pigfarm') {
      const props = new Container();
      
      const fence = new Graphics()
        .moveTo(-28, 2).lineTo(-12, 10)
        .moveTo(-28, -4).lineTo(-12, 4)
        .stroke({ color: 0x5c4033, width: 1.5 })
        .rect(-29, -5, 2, 8).fill({ color: 0x3e2723 })
        .rect(-20, -1, 2, 8).fill({ color: 0x3e2723 })
        .rect(-12, 3, 2, 8).fill({ color: 0x3e2723 });
        
      const pig1 = new Container();
      pig1.x = -22;
      pig1.y = 3;
      const pigBody1 = new Graphics()
        .ellipse(0, -3, 4.5, 3).fill({ color: 0xff80ab })
        .circle(3, -4.5, 2).fill({ color: 0xff80ab })
        .circle(4, -4.5, 0.5).fill({ color: 0x000000 });
      const pigSnout1 = new Graphics().rect(4.5, -4, 1.2, 1.2).fill({ color: 0xff4081 });
      pig1.addChild(pigBody1);
      pig1.addChild(pigSnout1);
      
      const pig2 = new Container();
      pig2.x = -16;
      pig2.y = 6;
      const pigBody2 = new Graphics()
        .ellipse(0, -3, 4.5, 3).fill({ color: 0xff80ab })
        .circle(-3, -4.5, 2).fill({ color: 0xff80ab })
        .circle(-4, -4.5, 0.5).fill({ color: 0x000000 });
      const pigSnout2 = new Graphics().rect(-5.7, -4, 1.2, 1.2).fill({ color: 0xff4081 });
      pig2.addChild(pigBody2);
      pig2.addChild(pigSnout2);
      
      props.addChild(fence);
      props.addChild(pig1);
      props.addChild(pig2);
      completeBuilding.addChild(props);
      completeBuilding.customPig1 = pig1;
      completeBuilding.customPig2 = pig2;
    }
    else if (detailType === 'slaughterhouse') {
      const props = new Container();
      const frame = new Graphics()
        .rect(18, -14, 2, 14).fill({ color: 0x5c4033 })
        .rect(28, -14, 2, 14).fill({ color: 0x5c4033 })
        .rect(18, -15, 12, 2.2).fill({ color: 0x5c4033 });
        
      const ham1 = new Graphics().ellipse(21, -8, 2, 3.5).fill({ color: 0xd84315 }).rect(20, -11, 2, 3).fill({ color: 0x8d6e63 });
      const ham2 = new Graphics().ellipse(27, -9, 1.8, 3.2).fill({ color: 0xd84315 }).rect(26, -12, 2, 3).fill({ color: 0x8d6e63 });
      
      const signContainer = new Container();
      signContainer.x = -24;
      signContainer.y = -16;
      const sign = new Graphics()
        .rect(-1, 0, 2, 4).fill({ color: 0x424242 })
        .rect(-5, 4, 10, 6).fill({ color: 0x8d6e63 })
        .stroke({ width: 0.8, color: 0x3e2723 })
        .moveTo(-3, 7).lineTo(3, 7).stroke({ width: 1, color: 0xd84315 });
        
      signContainer.addChild(sign);
      props.addChild(frame);
      props.addChild(ham1);
      props.addChild(ham2);
      props.addChild(signContainer);
      completeBuilding.addChild(props);
      completeBuilding.customSwayingSign = signContainer;
    }
    else if (detailType === 'goldsmelter') {
      const props = new Container();
      
      const furnace = new Graphics()
        .rect(16, -16, 15, 16).fill({ color: 0x424242 })
        .stroke({ width: 1.2, color: 0x212121 })
        .rect(19, -22, 5, 8).fill({ color: 0x212121 })
        .rect(18, -24, 7, 2.5).fill({ color: 0x111111 });
        
      const windowArch = new Graphics()
        .moveTo(19, -3)
        .lineTo(19, -10)
        .bezierCurveTo(19, -13, 28, -13, 28, -10)
        .lineTo(28, -3)
        .closePath()
        .fill({ color: 0x1a0a00 });
        
      const liquidGold = new Graphics()
        .circle(23.5, -5, 3.5).fill({ color: 0xffd700 })
        .circle(23.5, -5, 1.8).fill({ color: 0xffea00 });
        
      const bars = new Graphics()
        .rect(-26, -1, 7, 3.2).fill({ color: 0xffd700 }).stroke({ width: 0.8, color: 0xb58900 })
        .rect(-22, -4, 7, 3.2).fill({ color: 0xffd700 }).stroke({ width: 0.8, color: 0xb58900 })
        .rect(-24, -7, 6, 3).fill({ color: 0xffd700 }).stroke({ width: 0.8, color: 0xb58900 });
        
      props.addChild(furnace);
      props.addChild(windowArch);
      props.addChild(liquidGold);
      props.addChild(bars);
      completeBuilding.addChild(props);
      completeBuilding.customSmelterGlow = liquidGold;
    }
    else if (detailType === 'residence') {
      const props = new Container();
      const chest = new Graphics()
        .rect(-28, -5, 6, 5).fill({ color: 0x8b5a2b })
        .stroke({ width: 1, color: 0x3e2723 })
        .circle(-25, -2.5, 0.6).fill({ color: 0xffd700 }); // lock
      
      const pot = new Graphics()
        .ellipse(25, 0, 3, 2).fill({ color: 0x8d6e63 }) // pot
        .circle(24, -3, 1.2).fill({ color: 0xe91e63 }) // red flower
        .circle(26, -3, 1.2).fill({ color: 0xffeb3b }); // yellow flower
      
      props.addChild(chest);
      props.addChild(pot);
      completeBuilding.addChild(props);
    }

    completeBuilding.visible = false;
    container.addChild(completeBuilding);
    container.customComplete = completeBuilding;
  }

  // 3. Realistic Scaffolding Planks & Beams (progress visual)
  const scaffold = new Graphics();
  scaffold.stroke({ color: 0x5c4033, width: 2.2 });
  
  // Scaffolding support structure
  scaffold.rect(-22, -28, 4, 28).fill({ color: 0x8b5a2b }) // left pillar
          .rect(18, -28, 4, 28).fill({ color: 0x8b5a2b }) // right pillar
          .rect(-22, -28, 44, 4).fill({ color: 0x8b5a2b }) // top rail
          .rect(-22, -14, 44, 3).fill({ color: 0x8b5a2b }) // mid plank
          // diagonal bracing
          .moveTo(-18, -24).lineTo(18, -4)
          .moveTo(18, -24).lineTo(-18, -4);
  
  // Highlight details on scaffold planks
  scaffold.stroke({ color: 0xa0522d, width: 0.8 });
  scaffold.moveTo(-21, -27).lineTo(-21, 0);
  scaffold.moveTo(19, -27).lineTo(19, 0);

  container.addChild(scaffold);

  // 4. Elegant Progress Text label (Medieval strategy font style)
  const progressText = new Text({
    text: "0%",
    style: {
      fontSize: 12,
      fill: 0xffeb3b, // warm yellow
      fontFamily: 'Outfit',
      fontWeight: 'bold',
      stroke: { color: 0x2e1e15, width: 3.5 } // dark outline
    }
  });
  progressText.x = -12;
  progressText.y = -45;
  container.addChild(progressText);

  // Cache nested object references
  container.customScaffold = scaffold;
  container.customProgressText = progressText;

  return container;
}

function updateBuildingProgressVisual(buildingSprite, progress) {
  if (progress >= 100.0) {
    buildingSprite.customComplete.visible = true;
    buildingSprite.customScaffold.visible = false;
    buildingSprite.customProgressText.visible = false;
  } else {
    buildingSprite.customComplete.visible = false;
    buildingSprite.customScaffold.visible = true;
    buildingSprite.customProgressText.visible = true;
    buildingSprite.customProgressText.text = `${Math.floor(progress)}%`;
    // Scaffolding becomes increasingly transparent as complete building builds up underneath
    buildingSprite.customScaffold.alpha = 1.0 - (progress / 100.0) * 0.4;
  }
}

function renderLoop(entityArray, maxEntities) {
  if (!entityArray) return;

  // Sync camera state with soundManager to calculate 3D spatial pan and attenuation
  if (worldContainer) {
    soundManager.updateCameraState(worldContainer.x, worldContainer.y, worldContainer.scale.x);
  }

  const now = Date.now();

  // Dynamic Soil Wear: Update active dirt path alphas once per simulation tick (every 100ms)
  if (sharedTrafficMapGlobal && (now - lastTickTime) < 16) {
    for (let idx = 0; idx < dirtSpritesGlobal.length; idx++) {
      const dirtSprite = dirtSpritesGlobal[idx];
      if (dirtSprite) {
        // Map 0-255 traffic byte to 0.0-1.0 visual opacity with a gentle 1.5x boost for gradual organic roads!
        dirtSprite.alpha = Math.min(1.0, (sharedTrafficMapGlobal[idx] * 1.5) / 255.0);
      }
    }
  }

  // Calculate delta interpolation progress (ticks occur at 10 Hz, meaning every 100ms)
  const interpolationProgress = Math.min(1.0, (now - lastTickTime) / 100);

  // Animate dynamic environmental particles
  updateParticles();

  // Periodic debug logs (every ~2 seconds)
  if (Math.random() < 0.01) {
    let activeCount = 0;
    const coordinates = [];
    for (let i = 0; i < maxEntities; i++) {
      const offset = i * STRIDE;
      if (entityArray[offset + ACTIVE_FLAG] === 1.0) {
        activeCount++;
        if (activeCount <= 5) {
          coordinates.push(`#${i}: (${entityArray[offset + PREV_GRID_X].toFixed(1)}, ${entityArray[offset + PREV_GRID_Y].toFixed(1)})`);
        }
      }
    }
    console.log(`🎮 Main Thread Render: Active Settlers Count = ${activeCount}. Sample coords: ${coordinates.join(', ')}`);
  }

  for (let i = 0; i < maxEntities; i++) {
    const offset = i * STRIDE;
    const sprite = settlerSprites[i];

    if (!sprite) continue;

    const isActive = entityArray[offset + ACTIVE_FLAG] === 1.0;
    const entityType = entityArray[offset + ENTITY_TYPE];

    // --- BUILDING RENDERING BRANCH (Entity Type 5.0) ---
    if (entityType === 5.0) {
      // Hide standard settler visual for this index
      sprite.visible = false;

      if (!isActive) {
        const buildingSprite = buildingSprites[i];
        if (buildingSprite) buildingSprite.visible = false;
        continue;
      }

      let buildingSprite = buildingSprites[i];
      if (!buildingSprite) {
        buildingSprite = createBuildingSprite(entityArray[offset + HEADING_DIR]);
        buildingSprites[i] = buildingSprite;
        worldContainer.addChild(buildingSprite);
      }

      buildingSprite.visible = true;

      // Buildings do not interpolate (they stay statically positioned on grid)
      const gridX = entityArray[offset + NEXT_GRID_X];
      const gridY = entityArray[offset + NEXT_GRID_Y];
      
      const screenX = (gridX - gridY) * (TILE_WIDTH / 2);
      const screenY = (gridX + gridY) * (TILE_HEIGHT / 2);

      buildingSprite.x = screenX;
      buildingSprite.y = screenY;
      
      // Buildings are sorted slightly behind units walking on the exact same tile row
      buildingSprite.zIndex = screenY - 5;

      const progress = entityArray[offset + ANIMATION_FRAME];
      updateBuildingProgressVisual(buildingSprite, progress);

      // Animate completed buildings at 60 FPS!
      if (progress >= 100.0) {
        const comp = buildingSprite.customComplete;
        
        // 1. Sawmill saw blade spin + sawdust spraying particles!
        if (comp.customSaw) {
          comp.customSaw.rotation += 0.15;
          if (Math.random() < 0.15) {
            spawnSawdustParticle(screenX + 25.5, screenY - 10);
          }
        }
        
        // 2. Grain Mill sails gentle rotation!
        if (comp.customSails) {
          comp.customSails.rotation += 0.022;
        }
        
        // 3. Stonecutter hammer rhythmic tapping + dust puffs!
        if (comp.customChiselHammer) {
          comp.customChiselHammer.rotation = Math.sin(now * 0.015) * 0.45;
          if (Math.sin(now * 0.015) > 0.4 && Math.random() < 0.12) {
            spawnStoneDustParticle(screenX - 16, screenY - 6);
          }
        }
        
        // 4. Bakery oven fire glow + smoke particles
        if (comp.customOvenFire) {
          const ovenPulse = 1.0 + Math.sin(now * 0.02) * 0.18;
          comp.customOvenFire.scale.set(ovenPulse);
        }
        
        // 5. Pig Farm wiggling pig tails/ears & tiny waddling movements!
        if (comp.customPig1 && comp.customPig2) {
          comp.customPig1.scale.y = 1.0 + Math.sin(now * 0.008) * 0.08;
          comp.customPig1.x = -22 + Math.sin(now * 0.004) * 1.2;
          comp.customPig2.scale.y = 1.0 + Math.cos(now * 0.007) * 0.08;
          comp.customPig2.x = -16 + Math.cos(now * 0.003) * 1.2;
        }
        
        // 6. Slaughterhouse wind-swaying sign board!
        if (comp.customSwayingSign) {
          comp.customSwayingSign.rotation = Math.sin(now * 0.003) * 0.12;
        }
        
        // 7. Mines swaying entry lantern + rolling minecart hauling ore!
        if (comp.customLantern) {
          comp.customLantern.rotation = Math.sin(now * 0.004) * 0.18;
        }
        if (comp.customCart) {
          const cartCycle = (now % 3000) / 3000; // 3-second trip
          if (cartCycle < 0.35) {
            // Roll forward out of the mine shaft!
            comp.customCart.x = (cartCycle / 0.35) * 14;
            comp.customCart.y = 3 + (cartCycle / 0.35) * 6;
          } else if (cartCycle < 0.45) {
            // Stop at track edge to tip/unloaded
            comp.customCart.x = 14;
            comp.customCart.y = 9;
          } else if (cartCycle < 0.7) {
            // Roll back into the mine!
            const returnPhase = (cartCycle - 0.45) / 0.25;
            comp.customCart.x = 14 - returnPhase * 14;
            comp.customCart.y = 9 - returnPhase * 6;
          } else {
            // Resting inside deep mine entrance
            comp.customCart.x = 0;
            comp.customCart.y = 3;
          }
        }
        
        // 8. Gold Smelter molten-gold bubbling glow sparks!
        if (comp.customSmelterGlow) {
          const goldPulse = 1.0 + Math.sin(now * 0.02) * 0.2;
          comp.customSmelterGlow.scale.set(goldPulse);
        }
        
        // 9. Weapon Smithy striking anvil hammer + hot glowing orange sparks!
        if (comp.customSmithHammer && comp.customSmithCoals) {
          // Coals breathe glowing orange-red
          comp.customSmithCoals.alpha = 0.7 + Math.sin(now * 0.015) * 0.3;
          
          // Hammer striking rhythm
          const smithCycle = (now % 1500) / 1500; // 1.5s strike period
          if (smithCycle < 0.18) {
            // Hammer strikes the anvil!
            const hitPhase = smithCycle / 0.18;
            comp.customSmithHammer.rotation = -0.8 + hitPhase * 0.8;
            // On impact (smithCycle reaches near 0.18), spawn sparks!
            if (smithCycle > 0.15 && Math.random() < 0.35) {
              spawnSmithSpark(screenX + 21.5, screenY - 9);
            }
          } else if (smithCycle < 0.45) {
            // Hold down
            comp.customSmithHammer.rotation = 0;
          } else if (smithCycle < 0.75) {
            // Wind back up slowly
            const raisePhase = (smithCycle - 0.45) / 0.3;
            comp.customSmithHammer.rotation = -raisePhase * 0.8;
          } else {
            // Hold high
            comp.customSmithHammer.rotation = -0.8;
          }
        }
        
        // 10. Sentry Tower wind-waving flag + patrolling archer guard!
        if (comp.customFlag) {
          comp.customFlag.scale.x = 1.0 + Math.sin(now * 0.008) * 0.15;
        }
        if (comp.customGuard) {
          // Guard settler walks left and right on deck battlements
          comp.customGuard.x = 4 + Math.sin(now * 0.002) * 4.5;
          comp.customGuard.scale.x = (Math.cos(now * 0.002) < 0) ? -1.0 : 1.0;
        }
        
        // 11. Barracks training target dummy arms spin!
        if (comp.customDummyArms) {
          comp.customDummyArms.rotation += 0.035;
        }
        
        // 12. Stone Temple levitating, spinning diamond crystal + purple/cyan magic sparks!
        if (comp.customCrystal && comp.customGlow) {
          // levitation bobbing
          comp.customCrystal.y = -18 + Math.sin(now * 0.0035) * 3.5;
          comp.customCrystal.rotation += 0.015;
          
          // magic glow
          comp.customGlow.alpha = 0.15 + Math.sin(now * 0.005) * 0.06;
          
          // emit cyan/purple magic sparkles!
          if (Math.random() < 0.15) {
            spawnMagicSpark(screenX + (-6 + Math.random() * 12), screenY - 14 + Math.sin(now * 0.0035) * 3.5);
          }
        }
        
        // Puff chimney smoke occasionally!
        if (Math.random() < 0.05) {
          spawnSmokeParticle(screenX + 16, screenY - 58);
        }
      }
      continue;
    }

    // --- SETTLER RENDERING BRANCH ---
    const buildingSprite = buildingSprites[i];
    if (buildingSprite) {
      buildingSprite.visible = false;
    }

    if (!isActive) {
      sprite.visible = false;
      continue;
    }

    sprite.visible = true;

    // Toggle settler visuals/clothing based on role
    if (entityType === 1.0) { // Carrier
      sprite.customBody.tint = 0x4682b4; // Steel Blue tunic
      
      const resourceType = entityArray[offset + CARRIED_RESOURCE];
      sprite.customBag.visible = resourceType === 0.0;
      sprite.customLog.visible = resourceType === 1.0;
      sprite.customStone.visible = resourceType === 2.0;
      sprite.customGold.visible = resourceType === 3.0;
      sprite.customIron.visible = resourceType === 4.0;
      
      sprite.customShovel.visible = false;
      sprite.customHammer.visible = false;
    } else if (entityType === 2.0) { // Digger
      sprite.customBody.tint = 0x2e8b57; // Sea Green tunic
      sprite.customBag.visible = false;
      sprite.customLog.visible = false;
      sprite.customStone.visible = false;
      sprite.customGold.visible = false;
      sprite.customIron.visible = false;
      sprite.customShovel.visible = true;
      sprite.customHammer.visible = false;

      // Play spatial shoveling sound occasionally to increase the 'Wuselfaktor'
      if (Math.random() < 0.003) {
        const nextX = entityArray[offset + NEXT_GRID_X];
        const nextY = entityArray[offset + NEXT_GRID_Y];
        soundManager.playSpatialEffect('dig', nextX, nextY);
      }
    } else if (entityType === 3.0) { // Builder
      sprite.customBody.tint = 0xcd853f; // Orange-brown / Peru tunic
      sprite.customBag.visible = false;
      sprite.customLog.visible = false;
      sprite.customStone.visible = false;
      sprite.customGold.visible = false;
      sprite.customIron.visible = false;
      sprite.customShovel.visible = false;
      sprite.customHammer.visible = true;

      // Play spatial hammering sound occasionally to increase the 'Wuselfaktor'
      if (Math.random() < 0.003) {
        const nextX = entityArray[offset + NEXT_GRID_X];
        const nextY = entityArray[offset + NEXT_GRID_Y];
        soundManager.playSpatialEffect('hammer', nextX, nextY);
      }
    } else {
      sprite.customBody.tint = 0xffffff;
      sprite.customBag.visible = false;
      sprite.customLog.visible = false;
      sprite.customStone.visible = false;
      sprite.customGold.visible = false;
      sprite.customIron.visible = false;
      sprite.customShovel.visible = false;
      sprite.customHammer.visible = false;
    }

    // 1. Read coordinates
    const prevGridX = entityArray[offset + PREV_GRID_X];
    const prevGridY = entityArray[offset + PREV_GRID_Y];
    const nextGridX = entityArray[offset + NEXT_GRID_X];
    const nextGridY = entityArray[offset + NEXT_GRID_Y];

    // 2. Perform linear interpolation (sliding)
    const interpGridX = prevGridX + (nextGridX - prevGridX) * interpolationProgress;
    const interpGridY = prevGridY + (nextGridY - prevGridY) * interpolationProgress;

    // 3. Project grid coordinates to isometric screen coordinates
    const screenX = (interpGridX - interpGridY) * (TILE_WIDTH / 2);
    const screenY = (interpGridX + interpGridY) * (TILE_HEIGHT / 2);

    sprite.x = screenX;
    sprite.y = screenY;

    // 4. Dynamic sorting: lower on screen is in front
    sprite.zIndex = screenY;

    // 5. Dynamic animation wobble & walk step cycle
    const animFrame = entityArray[offset + ANIMATION_FRAME];
    const walkPhase = animFrame + interpolationProgress;
    
    // Wobble capsule scale
    sprite.scale.y = 1.0 + Math.sin(walkPhase * 1.5) * 0.05;
    
    // Flip sprite horizontally based on heading walking direction (heading 4 to 7 are walking left)
    const heading = entityArray[offset + HEADING_DIR];
    sprite.scale.x = (heading >= 4) ? -1.0 : 1.0;

    // Waddling animated feet
    if (sprite.customLeftFoot && sprite.customRightFoot) {
      sprite.customLeftFoot.y = Math.max(-2, Math.sin(walkPhase * 2.0) * 2.5);
      sprite.customRightFoot.y = Math.max(-2, -Math.sin(walkPhase * 2.0) * 2.5);
    }
    
    // Waddling animated hands
    if (sprite.customLeftHand && sprite.customRightHand) {
      sprite.customLeftHand.y = -12 + Math.cos(walkPhase * 2.0) * 2.0;
      sprite.customRightHand.y = -12 - Math.cos(walkPhase * 2.0) * 2.0;
    }

    // Spawn digging/building particles dynamically!
    if (entityType === 2.0 && Math.random() < 0.2) { // active digger
      spawnDigParticle(screenX + (-8 + Math.random() * 16), screenY);
    } else if (entityType === 3.0 && Math.random() < 0.2) { // active builder
      spawnBuildParticle(screenX + (-16 + Math.random() * 32), screenY - 12);
    }
  }

  // 6. Animate wildlife (rabbits hopping and deer grazing/walking)
  wildlifeSprites.forEach(sprite => {
    sprite.customStateTime += 0.016; // Increment elapsed time
    
    if (sprite.customType === 'rabbit') {
      const cycleTime = 4.0;
      const phase = (sprite.customStateTime % cycleTime) / cycleTime;
      
      if (phase < 0.25) {
        const hopPhase = (phase / 0.25) * Math.PI;
        const jumpY = Math.sin(hopPhase) * 7;
        const moveX = Math.cos(sprite.customPhase) * 0.45;
        
        sprite.x += moveX;
        sprite.y = sprite.customBaseY - jumpY;
        sprite.scale.x = (moveX < 0) ? -1.0 : 1.0;
        
        if (phase >= 0.24) {
          sprite.customBaseY = sprite.y;
          sprite.customBaseX = sprite.x;
        }
      } else {
        sprite.y = sprite.customBaseY;
        sprite.scale.y = 1.0 + Math.sin(sprite.customStateTime * 15.0) * 0.04; // Nose sniff!
        
        if (Math.random() < 0.005) {
          sprite.customPhase = Math.random() * Math.PI * 2;
        }
      }
      sprite.zIndex = sprite.y;
    } 
    else if (sprite.customType === 'deer') {
      const wanderPhase = sprite.customStateTime * 0.5;
      sprite.y = sprite.customBaseY + Math.sin(wanderPhase) * 2;
      sprite.x = sprite.customBaseX + Math.cos(wanderPhase) * 6;
      sprite.scale.x = (Math.sin(wanderPhase) < 0) ? -1.0 : 1.0;
      sprite.scale.y = 1.0 + Math.max(0, Math.sin(sprite.customStateTime * 2.0)) * 0.05;
      sprite.zIndex = sprite.y;
    }
  });

  // 7. Animate shimmering fish swimming in water
  fishSprites.forEach(sprite => {
    sprite.customPhase += 0.02 * sprite.customSpeed;
    sprite.x = sprite.customBaseX + Math.cos(sprite.customPhase) * 16;
    sprite.y = sprite.customBaseY + Math.sin(sprite.customPhase * 2.0) * 6;
    sprite.rotation = Math.sin(sprite.customPhase * 6.0) * 0.22;
    const swimDx = -Math.sin(sprite.customPhase);
    sprite.scale.x = (swimDx < 0) ? -1.0 : 1.0;
    sprite.alpha = 0.55 + Math.sin(sprite.customPhase * 3.0) * 0.25;
  });

  // 8. Isometric Depth Sorting: Sort worldContainer children by zIndex/screen Y
  worldContainer.sortChildren();

  // 9. Throttled update of glowing territory boundaries (runs at 2 Hz / 0.5s intervals)
  boundaryFrameCount++;
  if (boundaryFrameCount >= 30) {
    updateTerritoryBoundaries();
    boundaryFrameCount = 0;
  }
}

export function setSelectedFaction(faction) {
  selectedFactionGlobal = faction;
  boundaryFrameCount = 30; // Force immediate update!
}

function updateTerritoryBoundaries() {
  if (!sharedTerritoryMapGlobal || !boundaryGraphics) return;

  boundaryGraphics.clear();

  // Pick the glowing faction border color based on the active faction!
  let borderCol = 0xff4444; // Solari: Crimson Red
  if (selectedFactionGlobal === 'solari') borderCol = 0xff4444; 
  else if (selectedFactionGlobal === 'njordic') borderCol = 0x33a3ff; // Runeblue
  else if (selectedFactionGlobal === 'zapotec') borderCol = 0x33ff88; // Emerald Green
  else if (selectedFactionGlobal === 'voidborn') borderCol = 0xcc33ff; // Violet Swarm

  boundaryGraphics.beginPath();

  for (let y = 0; y < MAP_SIZE; y++) {
    for (let x = 0; x < MAP_SIZE; x++) {
      const idx = y * MAP_SIZE + x;
      if (sharedTerritoryMapGlobal[idx] === 1) {
        const screenX = (x - y) * (TILE_WIDTH / 2);
        const screenY = (x + y) * (TILE_HEIGHT / 2);

        // 1. Top-Left neighbor (x - 1, y)
        const leftOwned = (x > 0) && (sharedTerritoryMapGlobal[y * MAP_SIZE + (x - 1)] === 1);
        if (!leftOwned) {
          boundaryGraphics.moveTo(screenX - TILE_WIDTH / 2, screenY + TILE_HEIGHT / 2);
          boundaryGraphics.lineTo(screenX, screenY);
        }

        // 2. Top-Right neighbor (x, y - 1)
        const topOwned = (y > 0) && (sharedTerritoryMapGlobal[(y - 1) * MAP_SIZE + x] === 1);
        if (!topOwned) {
          boundaryGraphics.moveTo(screenX, screenY);
          boundaryGraphics.lineTo(screenX + TILE_WIDTH / 2, screenY + TILE_HEIGHT / 2);
        }

        // 3. Bottom-Right neighbor (x + 1, y)
        const rightOwned = (x < MAP_SIZE - 1) && (sharedTerritoryMapGlobal[y * MAP_SIZE + (x + 1)] === 1);
        if (!rightOwned) {
          boundaryGraphics.moveTo(screenX + TILE_WIDTH / 2, screenY + TILE_HEIGHT / 2);
          boundaryGraphics.lineTo(screenX, screenY + TILE_HEIGHT);
        }

        // 4. Bottom-Left neighbor (x, y + 1)
        const bottomOwned = (y < MAP_SIZE - 1) && (sharedTerritoryMapGlobal[(y + 1) * MAP_SIZE + x] === 1);
        if (!bottomOwned) {
          boundaryGraphics.moveTo(screenX - TILE_WIDTH / 2, screenY + TILE_HEIGHT / 2);
          boundaryGraphics.lineTo(screenX, screenY + TILE_HEIGHT);
        }
      }
    }
  }

  // Draw a sleek, semi-transparent glowing outline!
  boundaryGraphics.stroke({ width: 2.2, color: borderCol, alpha: 0.95 });
}

export function setPendingBuilding(buildingType, callback) {
  pendingBuildingType = buildingType;
  onBuildingPlacedCallback = callback;
  
  if (!buildingType) {
    if (placementPreview) placementPreview.visible = false;
    return;
  }
  
  if (!placementPreview) {
    placementPreview = new Container();
    placementPreview.zIndex = 10000;
    worldContainer.addChild(placementPreview);
  }
  
  placementPreview.removeChildren();
  
  // Map building type to its internal render type code
  let typeCode = 1.0; // Woodcutter
  if (buildingType === 'Sawmill') typeCode = 2.0;
  else if (buildingType === 'Stonecutter') typeCode = 3.0;
  else if (buildingType === 'Residence') typeCode = 4.0;
  else if (buildingType === 'Grain Farm') typeCode = 5.0;
  else if (buildingType === 'Grain Mill') typeCode = 6.0;
  else if (buildingType === 'Bakery') typeCode = 7.0;
  else if (buildingType === 'Pig Farm') typeCode = 8.0;
  else if (buildingType === 'Slaughterhouse') typeCode = 9.0;
  else if (buildingType === 'Coal Mine') typeCode = 10.0;
  else if (buildingType === 'Iron Mine') typeCode = 11.0;
  else if (buildingType === 'Gold Smelter' || buildingType === 'Gold Mine') typeCode = 12.0;
  else if (buildingType === 'Weapon Smithy') typeCode = 13.0;
  else if (buildingType === 'Sentry Tower') typeCode = 14.0;
  else if (buildingType === 'Barracks') typeCode = 15.0;
  else if (buildingType === 'Stone Temple') typeCode = 16.0;
  
  const ghost = createBuildingSprite(typeCode);
  ghost.alpha = 0.55;
  
  // Hide scaffolding and text for preview, show completed visual
  if (ghost.customComplete) {
    ghost.customComplete.visible = true;
  }
  if (ghost.customScaffold) {
    ghost.customScaffold.visible = false;
  }
  if (ghost.customProgressText) {
    ghost.customProgressText.visible = false;
  }
  
  placementPreview.addChild(ghost);
  placementPreview.visible = true;
  console.log(`🎮 PixiApp: Pending building selected: ${buildingType}`);
}

function clampCameraBounds(canvas) {
  if (!worldContainer) return;
  const zoom = worldContainer.scale.x;
  
  const canvasWidth = canvas.clientWidth || window.innerWidth;
  const canvasHeight = canvas.clientHeight || window.innerHeight;
  
  // Center of projection is at local x: 0, y: 2048 (island center)
  // Let's constrain worldContainer.x and worldContainer.y to keep the island centered
  const initialCenterX = canvasWidth / 2;
  const initialCenterY = canvasHeight / 2 - 2048 * zoom;
  
  // Allow panning within 3500px horizontally and 2500px vertically
  const limitX = 3500 * zoom;
  const limitY = 2500 * zoom;
  
  worldContainer.x = Math.max(initialCenterX - limitX, Math.min(initialCenterX + limitX, worldContainer.x));
  worldContainer.y = Math.max(initialCenterY - limitY, Math.min(initialCenterY + limitY, worldContainer.y));
}

function setupCameraControls(canvas) {
  let isDragging = false;
  let hasMoved = false;
  let lastX = 0;
  let lastY = 0;

  // Track hover snapping and ghost updating
  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Convert canvas screen point back to local coordinates relative to camera worldContainer
    const localX = (mouseX - worldContainer.x) / worldContainer.scale.x;
    const localY = (mouseY - worldContainer.y) / worldContainer.scale.y;

    // Invert the isometric equations to solve for grid coords:
    // screenX = (gridX - gridY) * 32, screenY = (gridX + gridY) * 16
    const gridX = Math.round((localX / TILE_WIDTH) + (localY / TILE_HEIGHT));
    const gridY = Math.round((localY / TILE_HEIGHT) - (localX / TILE_WIDTH));

    if (pendingBuildingType && placementPreview) {
      // Snapped preview positions
      const screenX = (gridX - gridY) * (TILE_WIDTH / 2);
      const screenY = (gridX + gridY) * (TILE_HEIGHT / 2);
      
      placementPreview.x = screenX;
      placementPreview.y = screenY;
      placementPreview.zIndex = screenY + 10;
      worldContainer.sortChildren();

      // Check if location is inside our lush green grass map bounds
      const inBounds = isWalkableGrass(gridX, gridY);
      
      // Check if there is already an active building at this coordinate
      let isOccupied = false;
      for (let i = 100; i < 1000; i++) {
        const offset = i * STRIDE;
        if (entityArrayGlobal && entityArrayGlobal[offset + ACTIVE_FLAG] === 1.0) {
          const bx = entityArrayGlobal[offset + NEXT_GRID_X];
          const by = entityArrayGlobal[offset + NEXT_GRID_Y];
          if (bx === gridX && by === gridY) {
            isOccupied = true;
            break;
          }
        }
      }

      // Check if location is inside our player's owned territory
      const mapIdx = gridY * MAP_SIZE + gridX;
      const isOwned = sharedTerritoryMapGlobal && sharedTerritoryMapGlobal[mapIdx] === 1;

      const isValid = inBounds && !isOccupied && isOwned;
      
      // Visual indicator: solid/faint ghost depending on suitability
      if (isValid) {
        placementPreview.alpha = 0.85;
      } else {
        placementPreview.alpha = 0.3; // Fades out if invalid
      }
    }

    if (isDragging) {
      hasMoved = true;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;

      worldContainer.x += dx;
      worldContainer.y += dy;

      clampCameraBounds(canvas);

      lastX = e.clientX;
      lastY = e.clientY;
    }
  });

  canvas.addEventListener('mousedown', (e) => {
    // Only handle left-clicks
    if (e.button === 0) {
      isDragging = true;
      hasMoved = false;
      lastX = e.clientX;
      lastY = e.clientY;
    }
  });

  // Dynamic Scroll Zoom Control
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const zoomIntensity = 0.08;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    // Zoom centering relative to mouse hover coordinates
    const localX = (mouseX - worldContainer.x) / worldContainer.scale.x;
    const localY = (mouseY - worldContainer.y) / worldContainer.scale.y;
    
    let newZoom = worldContainer.scale.x - e.deltaY * zoomIntensity * 0.01;
    newZoom = Math.min(2.0, Math.max(0.4, newZoom)); // Clamp zoom between 40% and 200%
    
    worldContainer.scale.x = newZoom;
    worldContainer.scale.y = newZoom;
    
    worldContainer.x = mouseX - localX * newZoom;
    worldContainer.y = mouseY - localY * newZoom;
    
    clampCameraBounds(canvas);
  });

  canvas.addEventListener('click', (e) => {
    // If the user was dragging the camera, do not trigger building placement!
    if (hasMoved) {
      isDragging = false;
      return;
    }

    if (e.button === 0 && pendingBuildingType) {
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const localX = (mouseX - worldContainer.x) / worldContainer.scale.x;
      const localY = (mouseY - worldContainer.y) / worldContainer.scale.y;

      const gridX = Math.round((localX / TILE_WIDTH) + (localY / TILE_HEIGHT));
      const gridY = Math.round((localY / TILE_HEIGHT) - (localX / TILE_WIDTH));

      const inBounds = isWalkableGrass(gridX, gridY);
      
      let isOccupied = false;
      for (let i = 100; i < 1000; i++) {
        const offset = i * STRIDE;
        if (entityArrayGlobal && entityArrayGlobal[offset + ACTIVE_FLAG] === 1.0) {
          const bx = entityArrayGlobal[offset + NEXT_GRID_X];
          const by = entityArrayGlobal[offset + NEXT_GRID_Y];
          if (bx === gridX && by === gridY) {
            isOccupied = true;
            break;
          }
        }
      }

      const mapIdx = gridY * MAP_SIZE + gridX;
      const isOwned = sharedTerritoryMapGlobal && sharedTerritoryMapGlobal[mapIdx] === 1;

      if (inBounds && !isOccupied && isOwned) {
        // Place building exactly on this coordinate!
        if (onBuildingPlacedCallback) {
          onBuildingPlacedCallback(pendingBuildingType, gridX, gridY);
        }
        
        // Clear pending building
        pendingBuildingType = null;
        onBuildingPlacedCallback = null;
        if (placementPreview) placementPreview.visible = false;
      } else {
        console.warn('🚫 Cannot build at selected grid tile: occupied, out of boundary, or outside player territory!');
        soundManager.playSpatialEffect('hammer', gridX, gridY); // Plays feedback
      }
    }
  });

  window.addEventListener('mouseup', () => {
    isDragging = false;
  });
}
