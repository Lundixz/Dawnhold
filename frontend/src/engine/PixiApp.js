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
let dirtSpritesGlobal = [];

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

  // Map the traffic map byte array after the entity float array!
  const entityBufferBytes = maxEntities * STRIDE * Float32Array.BYTES_PER_ELEMENT;
  sharedTrafficMapGlobal = new Uint8Array(sharedBuffer, entityBufferBytes, MAP_SIZE * MAP_SIZE);

  // 2. Set up the Camera Viewport container, centering on the island center (X: 64, Y: 64)
  worldContainer = new Container();
  worldContainer.x = window.innerWidth / 2;
  worldContainer.y = window.innerHeight / 2 - 2048;
  worldContainer.sortableChildren = true; // Enable dynamic isometric depth sorting!
  app.stage.addChild(worldContainer);

  // 3. Draw a mock isometric floor grid
  createIsometricFloor();

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
  const createTileTexture = (tileColor, strokeColor) => {
    const g = new Graphics()
      .moveTo(TILE_WIDTH / 2, 0)
      .lineTo(TILE_WIDTH, TILE_HEIGHT / 2)
      .lineTo(TILE_WIDTH / 2, TILE_HEIGHT)
      .lineTo(0, TILE_HEIGHT / 2)
      .closePath()
      .fill({ color: tileColor })
      .stroke({ width: 0.8, color: strokeColor });
    
    const tex = app.renderer.textureGenerator.generateTexture({ target: g });
    g.destroy();
    return tex;
  };

  // 2. Generate and cache textures exactly once for each of the 8 terrain styles
  const textures = {
    deepEven: createTileTexture(0x1f3c5c, 0x1a334f),
    deepOdd: createTileTexture(0x244569, 0x1a334f),
    shallowEven: createTileTexture(0x2d5d7b, 0x244d66),
    shallowOdd: createTileTexture(0x33688a, 0x244d66),
    sandEven: createTileTexture(0xdecba4, 0xcfbc95),
    sandOdd: createTileTexture(0xe3d2b0, 0xcfbc95),
    grassEven: createTileTexture(0x35682d, 0x2b5425),
    grassOdd: createTileTexture(0x3b7a33, 0x2b5425)
  };

  const dirtTex = createTileTexture(0x8b5a2b, 0x5c4033); // Brown worn dirt color

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

  const createWildflowersTexture = () => {
    const g = new Graphics()
      .circle(5, 12, 1.2).fill({ color: 0xffd700 })
      .circle(3, 12, 0.8).fill({ color: 0xffffff })
      .circle(7, 12, 0.8).fill({ color: 0xffffff });
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
    wildflowers: createWildflowersTexture(),
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
          const detailSprite = new Sprite(details.wildflowers);
          detailSprite.x = screenX - TILE_WIDTH / 2;
          detailSprite.y = screenY;
          floorContainer.addChild(detailSprite);
        } else if (tileSeed === 11) {
          const detailSprite = new Sprite(details.rock);
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
}

function createSettlerPool(maxEntities) {
  // Pre-allocate a pool of visual settler representations to avoid memory garbage collection pauses!
  for (let i = 0; i < maxEntities; i++) {
    const settlerContainer = new Container();

    // 1. Shadow (semi-transparent black ellipse)
    const shadow = new Graphics()
      .ellipse(0, 0, 12, 5)
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
      .fill({ color: 0xffdbac });

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

  // 1. Cozy Shaded Cobblestone Foundation (sits perfectly on 64x32 tile)
  const foundation = new Graphics();
  
  // Layered Shadow Base
  foundation.moveTo(0, -18)
    .lineTo(34, 0)
    .lineTo(0, 18)
    .lineTo(-34, 0)
    .closePath()
    .fill({ color: 0x272727, alpha: 0.4 }); // soft shadow

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
  } else if (typeCode === 10.0 || typeCode === 11.0 || typeCode === 12.0) { // Mines
    detailType = 'mine';
  } else if (typeCode === 13.0) { // Weapon Smithy
    buildingColor = 0x8d6e63; // Dark soot bricks
    roofColor = 0x3e2723; // Dark charcoal tiles
    detailType = 'smithy';
  } else if (typeCode === 14.0) { // Sentry Tower
    detailType = 'tower';
  } else if (typeCode === 15.0) { // Barracks
    roofColor = 0x8b0000;
    detailType = 'barracks';
  }

  // MINES BRANCH
  if (detailType === 'mine') {
    const mineEntrance = new Container();
    
    // Cozy Grass/Earth Mound
    const mound = new Graphics()
      .ellipse(0, -6, 26, 14).fill({ color: 0x4e3629 })
      .ellipse(0, -12, 18, 10).fill({ color: 0x3d2b20 })
      .ellipse(-14, -8, 8, 4).fill({ color: 0x2e5c26 }) // grass patch
      .ellipse(14, -10, 8, 4).fill({ color: 0x2e5c26 });
    
    // Mine entrance hole (Deep black isometric arch)
    const shaft = new Graphics()
      .moveTo(-10, 2)
      .lineTo(-10, -18)
      .bezierCurveTo(-10, -26, 10, -26, 10, -18)
      .lineTo(10, 2)
      .closePath()
      .fill({ color: 0x111111 });
      
    // Thick timber supporting frames with highlights
    const frame = new Graphics()
      .rect(-12, -20, 3.5, 22).fill({ color: 0x5c4033 }) // left post
      .rect(-11.5, -20, 1, 22).fill({ color: 0x8b5a2b }) // left highlight
      .rect(8.5, -20, 3.5, 22).fill({ color: 0x5c4033 }) // right post
      .rect(9, -20, 1, 22).fill({ color: 0x8b5a2b }) // right highlight
      .rect(-12, -23, 24, 4).fill({ color: 0x5c4033 }) // lintel
      .rect(-12, -22.5, 24, 1).fill({ color: 0x8b5a2b }) // lintel highlight
      // diagonal support braces
      .moveTo(-9, -16).lineTo(-4, -20).stroke({ color: 0x3e2723, width: 2.5 })
      .moveTo(9, -16).lineTo(3, -20).stroke({ color: 0x3e2723, width: 2.5 });

    // Hanging lantern at entrance
    const lantern = new Graphics()
      .rect(-1, -20, 2, 4).fill({ color: 0x2b2b2b }) // wire
      .circle(0, -15, 2.5).fill({ color: 0xffd700 }) // glow bulb
      .rect(-2, -17, 4, 1.5).fill({ color: 0x2b2b2b }); // cap
    lantern.x = 0;

    // Mine tracks coming out to the foundation edge
    const tracks = new Graphics()
      .moveTo(-4, 3).lineTo(-8, 14).stroke({ color: 0x8c8c8c, width: 2 })
      .moveTo(4, 3).lineTo(8, 14).stroke({ color: 0x8c8c8c, width: 2 })
      // wooden sleepers
      .moveTo(-5, 6).lineTo(5, 5).stroke({ color: 0x5c4033, width: 2 })
      .moveTo(-7, 10).lineTo(7, 9).stroke({ color: 0x5c4033, width: 2 });

    mineEntrance.addChild(mound);
    mineEntrance.addChild(shaft);
    mineEntrance.addChild(frame);
    mineEntrance.addChild(lantern);
    mineEntrance.addChild(tracks);
    
    mineEntrance.visible = false;
    container.addChild(mineEntrance);
    container.customComplete = mineEntrance;
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
    const flag = new Graphics()
      .rect(-1, -68, 2, 16).fill({ color: 0x8b5a2b }) // wood pole
      .moveTo(1, -68).lineTo(14, -64).lineTo(1, -60).closePath().fill({ color: 0xb22222 }) // banner body
      .moveTo(1, -65).lineTo(8, -63).stroke({ color: 0xffd700, width: 1.2 }); // golden pattern

    tower.addChild(column);
    tower.addChild(windowCell);
    tower.addChild(deck);
    tower.addChild(flag);
    
    tower.visible = false;
    container.addChild(tower);
    container.customComplete = tower;
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
      props.addChild(anvil);
      completeBuilding.addChild(props);
    }
    else if (detailType === 'residence') {
      const props = new Container();
      // Cozy wooden storage chest and flower pot at door
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

      // Animate active saw blades and mill sails inside the completed building
      if (progress >= 100.0) {
        if (buildingSprite.customComplete.customSaw) {
          buildingSprite.customComplete.customSaw.rotation += 0.15; // Fast spin sawmill
        }
        if (buildingSprite.customComplete.customSails) {
          buildingSprite.customComplete.customSails.rotation += 0.025; // Gentle rotate wind mill sails
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

    // Fade in dirt tracks dynamically based on traffic map!
    if (sharedTrafficMapGlobal) {
      const tileIdx = Math.round(interpGridY) * MAP_SIZE + Math.round(interpGridX);
      const dirtSprite = dirtSpritesGlobal[tileIdx];
      if (dirtSprite) {
        // Map 0-255 traffic byte to 0.0-1.0 visual opacity
        dirtSprite.alpha = sharedTrafficMapGlobal[tileIdx] / 255.0;
      }
    }

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

  // 6. Isometric Depth Sorting: Sort worldContainer children by zIndex/screen Y
  worldContainer.sortChildren();
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
  else if (buildingType === 'Gold Mine') typeCode = 12.0;
  else if (buildingType === 'Weapon Smithy') typeCode = 13.0;
  else if (buildingType === 'Sentry Tower') typeCode = 14.0;
  else if (buildingType === 'Barracks') typeCode = 15.0;
  
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

      const isValid = inBounds && !isOccupied;
      
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

      if (inBounds && !isOccupied) {
        // Place building exactly on this coordinate!
        if (onBuildingPlacedCallback) {
          onBuildingPlacedCallback(pendingBuildingType, gridX, gridY);
        }
        
        // Clear pending building
        pendingBuildingType = null;
        onBuildingPlacedCallback = null;
        if (placementPreview) placementPreview.visible = false;
      } else {
        console.warn('🚫 Cannot build at selected grid tile: occupied or out of boundary!');
        soundManager.playSpatialEffect('hammer', gridX, gridY); // Plays feedback
      }
    }
  });

  window.addEventListener('mouseup', () => {
    isDragging = false;
  });
}
