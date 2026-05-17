import { Application, Container, Graphics, Assets, Sprite } from 'pixi.js';

let app = null;
let worldContainer = null;
let settlerSprites = []; // Cache of active settler visual sprites
let lastTickTime = Date.now();

// Grid configuration
const TILE_WIDTH = 64;
const TILE_HEIGHT = 32;
const MAP_SIZE = 128;
const STRIDE = 8; // Slot size per entity matching SimWorker.js

// SharedArrayBuffer offsets
const ACTIVE_FLAG = 0;
const ENTITY_TYPE = 1;
const PREV_GRID_X = 2;
const PREV_GRID_Y = 3;
const NEXT_GRID_X = 4;
const NEXT_GRID_Y = 5;
const HEADING_DIR = 6;
const ANIMATION_FRAME = 7;

export async function initGame(canvasElement, sharedBuffer, maxEntities) {
  // 1. Initialize PixiJS (v8) asynchronously
  app = new Application();
  await app.init({
    canvas: canvasElement,
    width: window.innerWidth,
    height: window.innerHeight,
    antialias: true,
    backgroundAlpha: 0, // Transparent background to show index.css background gradient
    resizeTo: window
  });

  console.log('🎮 PixiJS (v8): Initialized successfully.');

  // Wrap a Float32Array around our SharedArrayBuffer
  const entityArray = new Float32Array(sharedBuffer);

  // 2. Set up the Camera Viewport container, centering on the island center (X: 35, Y: 35)
  worldContainer = new Container();
  worldContainer.x = window.innerWidth / 2;
  worldContainer.y = window.innerHeight / 2 - 1120;
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

function createIsometricFloor() {
  // Draw a grid of grass tiles (represented by graphics objects) in the center
  const floorContainer = new Container();
  floorContainer.zIndex = -10000; // Always sort behind settlers/entities!
  worldContainer.addChild(floorContainer);

  const startTile = 20;
  const endTile = 50;

  for (let x = startTile; x < endTile; x++) {
    for (let y = startTile; y < endTile; y++) {
      const tileGraphic = new Graphics();
      
      // Draw isometric diamond shape
      tileGraphic.fill({ color: (x + y) % 2 === 0 ? 0x2e8b57 : 0x3cb371 }); // Alternating shades of green
      tileGraphic.moveTo(0, 0);
      tileGraphic.lineTo(TILE_WIDTH / 2, TILE_HEIGHT / 2);
      tileGraphic.lineTo(0, TILE_HEIGHT);
      tileGraphic.lineTo(-TILE_WIDTH / 2, TILE_HEIGHT / 2);
      tileGraphic.closePath();
      tileGraphic.fill();

      // Draw thin border to match S4 grid visual
      tileGraphic.stroke({ width: 1, color: 0x277a4a });

      // Convert isometric X/Y coordinates to screen X/Y coordinates
      const screenX = (x - y) * (TILE_WIDTH / 2);
      const screenY = (x + y) * (TILE_HEIGHT / 2);

      tileGraphic.x = screenX;
      tileGraphic.y = screenY;

      floorContainer.addChild(tileGraphic);
    }
  }
}

function createSettlerPool(maxEntities) {
  // Pre-allocate a pool of visual settler representations to avoid memory garbage collection pauses!
  for (let i = 0; i < maxEntities; i++) {
    const settlerContainer = new Container();

    // Draw a cute placeholder worker shape (since we don't have full textures yet)
    const body = new Graphics()
      .circle(0, -12, 10)
      .fill({ color: 0x4682b4 }); // Carrier steel blue

    // Small carrier bag representation
    const bag = new Graphics()
      .rect(-6, -6, 12, 12)
      .fill({ color: 0x8b4513 }); // Brown bag
    
    // Settler head
    const head = new Graphics()
      .circle(0, -26, 6)
      .fill({ color: 0xffdbac }); // Skin tone

    settlerContainer.addChild(bag);
    settlerContainer.addChild(body);
    settlerContainer.addChild(head);

    // Active state managed by checking Float32Array directly
    settlerContainer.visible = false;

    // Cache the sprite reference
    settlerSprites.push(settlerContainer);
    worldContainer.addChild(settlerContainer);
  }
}

function renderLoop(entityArray, maxEntities) {
  if (!entityArray) return;

  const now = Date.now();
  // Calculate delta interpolation progress (ticks occur at 10 Hz, meaning every 100ms)
  const interpolationProgress = Math.min(1.0, (now - lastTickTime) / 100);

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

    // Read active state directly from SharedArrayBuffer block
    const isActive = entityArray[offset + ACTIVE_FLAG] === 1.0;

    if (!isActive) {
      sprite.visible = false;
      continue;
    }

    sprite.visible = true;

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

    // 4. Dynamic scaling to simulate isometric depth overlaps (further away is smaller)
    // 2.5D sorting rule: lower on screen is in front
    sprite.zIndex = screenY;

    // Dynamic animation wobble
    const animFrame = entityArray[offset + ANIMATION_FRAME];
    sprite.scale.y = 1.0 + Math.sin(animFrame * 1.5) * 0.08; // wobble while walking
  }

  // 5. Isometric Depth Sorting: Sort worldContainer children by zIndex/screen Y
  worldContainer.sortChildren();
}

function setupCameraControls(canvas) {
  let isDragging = false;
  let lastX = 0;
  let lastY = 0;

  // Zoom scale
  let zoomLevel = 1.0;

  // Mouse Dragging to Pan the map
  canvas.addEventListener('mousedown', (e) => {
    isDragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;

    worldContainer.x += dx;
    worldContainer.y += dy;

    lastX = e.clientX;
    lastY = e.clientY;
  });

  window.addEventListener('mouseup', () => {
    isDragging = false;
  });

  // Mouse Scroll to Zoom the camera
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const zoomFactor = 1.1;
    
    // Zoom In
    if (e.deltaY < 0 && zoomLevel < 2.5) {
      zoomLevel *= zoomFactor;
      worldContainer.scale.set(zoomLevel);
    } 
    // Zoom Out
    else if (e.deltaY > 0 && zoomLevel > 0.4) {
      zoomLevel /= zoomFactor;
      worldContainer.scale.set(zoomLevel);
    }
  });
}
