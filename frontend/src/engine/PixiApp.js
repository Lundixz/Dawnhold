import { Application, Container, Graphics, Assets, Sprite, Text } from 'pixi.js';

let app = null;
let worldContainer = null;
let settlerSprites = []; // Cache of active settler visual sprites
let buildingSprites = []; // Cache of active building visual sprites
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

    // Body (white so we can tint it dynamically based on role)
    const body = new Graphics()
      .circle(0, -12, 10)
      .fill({ color: 0xffffff });

    // Small carrier bag representation (visible for carriers)
    const bag = new Graphics()
      .rect(-6, -6, 12, 12)
      .fill({ color: 0x8b4513 }); // Brown bag
    
    // Shovel representation (visible for diggers)
    const shovel = new Graphics()
      .rect(-2, -18, 4, 18) // handle
      .fill({ color: 0xa0522d })
      .rect(-5, -24, 10, 8) // blade
      .fill({ color: 0xc0c0c0 });
    shovel.x = -8;
    shovel.y = -10;

    // Hammer representation (visible for builders)
    const hammer = new Graphics()
      .rect(-2, -14, 4, 14) // handle
      .fill({ color: 0xa0522d })
      .rect(-7, -19, 14, 6) // head
      .fill({ color: 0x808080 });
    hammer.x = -8;
    hammer.y = -10;
    
    // Settler head
    const head = new Graphics()
      .circle(0, -26, 6)
      .fill({ color: 0xffdbac }); // Skin tone

    settlerContainer.addChild(bag);
    settlerContainer.addChild(shovel);
    settlerContainer.addChild(hammer);
    settlerContainer.addChild(body);
    settlerContainer.addChild(head);

    // Active state managed by checking Float32Array directly
    settlerContainer.visible = false;

    // Cache nested nodes
    settlerContainer.customBody = body;
    settlerContainer.customBag = bag;
    settlerContainer.customShovel = shovel;
    settlerContainer.customHammer = hammer;

    // Cache the sprite reference
    settlerSprites.push(settlerContainer);
    worldContainer.addChild(settlerContainer);
  }
}

function createBuildingSprite(typeCode) {
  const container = new Container();

  // 1. Draw foundation (a gray isometric stone diamond base)
  const foundation = new Graphics()
    .moveTo(0, 0)
    .lineTo(48, 24)
    .lineTo(0, 48)
    .lineTo(-48, 24)
    .closePath()
    .fill({ color: 0x808080 }); // stone gray
  container.addChild(foundation);

  // 2. Draw active complete building graphic (initially invisible)
  const completeBuilding = new Container();
  
  let buildingColor = 0xa0522d; // Woodcutter brown
  let roofColor = 0x2e8b57; // Green roof
  let iconText = "🪓";

  if (typeCode === 2.0) { // Sawmill
    buildingColor = 0xd2b48c;
    roofColor = 0xcd5c5c;
    iconText = "🪵";
  } else if (typeCode === 3.0) { // Stonecutter
    buildingColor = 0xa9a9a9;
    roofColor = 0x708090;
    iconText = "🪨";
  } else if (typeCode === 4.0) { // Residence
    buildingColor = 0xf5f5dc;
    roofColor = 0xb22222;
    iconText = "🏠";
  } else if (typeCode === 5.0) {
    buildingColor = 0xdeb887;
    roofColor = 0x228b22;
    iconText = "🌾";
  } else if (typeCode === 6.0) {
    buildingColor = 0xdeb887;
    roofColor = 0xb8860b;
    iconText = "💨";
  } else if (typeCode === 7.0) {
    buildingColor = 0xf4a460;
    roofColor = 0xcd853f;
    iconText = "🥖";
  } else if (typeCode === 8.0) {
    buildingColor = 0xffc0cb;
    roofColor = 0x8b5a2b;
    iconText = "🐖";
  } else if (typeCode === 10.0) {
    buildingColor = 0x4a4a4a;
    roofColor = 0x1a1a1a;
    iconText = "🌑";
  } else if (typeCode === 11.0) {
    buildingColor = 0x708090;
    roofColor = 0x4682b4;
    iconText = "⛓️";
  } else if (typeCode === 13.0) {
    buildingColor = 0xb22222;
    roofColor = 0x800000;
    iconText = "⚔️";
  } else if (typeCode === 14.0) {
    buildingColor = 0xbc8f8f;
    roofColor = 0x556b2f;
    iconText = "🏹";
  } else if (typeCode === 15.0) {
    buildingColor = 0xcd853f;
    roofColor = 0x8b0000;
    iconText = "🛡️";
  } else if (typeCode === 16.0) {
    buildingColor = 0x98fb98;
    roofColor = 0x4b0082;
    iconText = "🔮";
  }

  // Draw main house block
  const walls = new Graphics()
    .rect(-24, -40, 48, 40)
    .fill({ color: buildingColor })
    .stroke({ width: 2, color: 0x3e2723 });
  
  // Roof shape
  const roof = new Graphics()
    .moveTo(-28, -40)
    .lineTo(0, -60)
    .lineTo(28, -40)
    .closePath()
    .fill({ color: roofColor })
    .stroke({ width: 2, color: 0x3e2723 });

  // Door
  const door = new Graphics()
    .rect(-6, -16, 12, 16)
    .fill({ color: 0x5c4033 });

  // Icon sign above building
  const label = new Text({
    text: iconText,
    style: {
      fontSize: 18,
      fill: 0xffffff
    }
  });
  label.x = -9;
  label.y = -78;

  completeBuilding.addChild(walls);
  completeBuilding.addChild(roof);
  completeBuilding.addChild(door);
  completeBuilding.addChild(label);
  
  completeBuilding.visible = false;
  container.addChild(completeBuilding);

  // 3. Draw scaffolding/wooden frames (progress visual, initially visible)
  const scaffold = new Graphics()
    .rect(-26, -42, 6, 42).fill({ color: 0xd2b48c })
    .rect(20, -42, 6, 42).fill({ color: 0xd2b48c })
    .rect(-26, -42, 52, 6).fill({ color: 0xd2b48c })
    .rect(-26, -22, 52, 4).fill({ color: 0xd2b48c });

  // Add cross-bracing
  scaffold.moveTo(-20, -36).lineTo(20, -6).stroke({ color: 0x8b4513, width: 2 });
  scaffold.moveTo(20, -36).lineTo(-20, -6).stroke({ color: 0x8b4513, width: 2 });

  container.addChild(scaffold);

  // 4. Progress Text label above construction
  const progressText = new Text({
    text: "0%",
    style: {
      fontSize: 12,
      fill: 0x00ff00,
      fontWeight: 'bold',
      stroke: { color: 0x000000, width: 3 }
    }
  });
  progressText.x = -12;
  progressText.y = -62;
  container.addChild(progressText);

  // Cache sub-object references
  container.customComplete = completeBuilding;
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
      sprite.customBody.tint = 0x4682b4; // Steel Blue
      sprite.customBag.visible = true;
      sprite.customShovel.visible = false;
      sprite.customHammer.visible = false;
    } else if (entityType === 2.0) { // Digger
      sprite.customBody.tint = 0x2e8b57; // Sea Green
      sprite.customBag.visible = false;
      sprite.customShovel.visible = true;
      sprite.customHammer.visible = false;
    } else if (entityType === 3.0) { // Builder
      sprite.customBody.tint = 0xcd853f; // Orange-brown / Peru
      sprite.customBag.visible = false;
      sprite.customShovel.visible = false;
      sprite.customHammer.visible = true;
    } else {
      sprite.customBody.tint = 0xffffff;
      sprite.customBag.visible = false;
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
}
