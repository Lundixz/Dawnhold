// Dawnhold Authoritative Background Simulation Web Worker (SimWorker.js)
// Runs the heavy physics, A* road pathfinding, and economy state updates at 10 Hz.
// Communicates with the main thread using SharedArrayBuffer (zero serialization lag).

let sharedBuffer = null;
let entityArray = null; // Flat Float32Array wrapper around SharedArrayBuffer
let maxEntities = 0;
let mapSize = 128;

// Typed Array Offset mapping per Entity (8 float slots per entity block)
// Slot 0: ACTIVE_FLAG (1.0 = active, 0.0 = pooled/inactive)
// Slot 1: ENTITY_TYPE (1.0 = carrier, 2.0 = digger, 3.0 = builder, 4.0 = soldier, 5.0 = building)
// Slot 2: PREV_GRID_X
// Slot 3: PREV_GRID_Y
// Slot 4: NEXT_GRID_X
// Slot 5: NEXT_GRID_Y
// Slot 6: HEADING_DIR (0 to 7 representing 8 isometric walking directions)
// Slot 7: ANIMATION_FRAME (0.0 to 4.0 loop for walk cycle / 0 to 100 for building progress)
const STRIDE = 8;

const ACTIVE_FLAG = 0;
const ENTITY_TYPE = 1;
const PREV_GRID_X = 2;
const PREV_GRID_Y = 3;
const NEXT_GRID_X = 4;
const NEXT_GRID_Y = 5;
const HEADING_DIR = 6;
const ANIMATION_FRAME = 7;

// Simulated grid maps (Flat Typed Arrays for high-performance memory footprint)
let terrainMap = null;
let occupancyMap = null;

// Internal private simulation tracking (holds pathing queues in worker RAM)
const settlerSimStates = [];

// Authoritative simulation parameters mirrored from React UI settings
const simSettings = {
  carrierRatio: 50,
  diggerRatio: 30,
  builderRatio: 20,
  autoGeologist: true,
  woodToSawmill: 80,
  woodToShipyard: 20,
  coalToIron: 60,
  coalToGold: 40,
  grainToBakery: 60,
  grainToPigs: 40,
  toolQueue: [],
  swordsmanRatio: 60,
  bowmanRatio: 30,
  medicRatio: 10,
  autoRecruit: true,
  selectedFaction: 'solari'
};

self.onmessage = function (event) {
  const { action, payload } = event.data;

  if (action === 'INIT') {
    const { sab, mapDimensions, maxUnits } = payload;
    sharedBuffer = sab;
    entityArray = new Float32Array(sharedBuffer);
    maxEntities = maxUnits;
    mapSize = mapDimensions;

    // Allocate internal simulation maps
    terrainMap = new Uint8Array(mapSize * mapSize);
    occupancyMap = new Uint16Array(mapSize * mapSize);

    console.log(`👷 SimWorker: Initialized simulation thread. Max Entities: ${maxEntities}. SAB Bytes: ${sab.byteLength}`);

    // Populate initial mock carrier settlers
    spawnInitialSettlers();

    // Start the Authoritative Game Tick Loop at 10 Hz (every 100ms)
    setInterval(gameTick, 100);
  }

  // UI Settings synchronizations
  if (action === 'UPDATE_SETTLER_RATIOS') {
    const { carrierRatio, diggerRatio, builderRatio, autoGeologist } = payload;
    simSettings.carrierRatio = carrierRatio;
    simSettings.diggerRatio = diggerRatio;
    simSettings.builderRatio = builderRatio;
    simSettings.autoGeologist = autoGeologist;
    console.log('👷 SimWorker: Updated Settler Occupational ratios in model:', simSettings);
  }

  if (action === 'UPDATE_ECONOMY_RATIOS') {
    const { woodToSawmill, woodToShipyard, coalToIron, coalToGold, grainToBakery, grainToPigs, toolQueue } = payload;
    simSettings.woodToSawmill = woodToSawmill;
    simSettings.woodToShipyard = woodToShipyard;
    simSettings.coalToIron = coalToIron;
    simSettings.coalToGold = coalToGold;
    simSettings.grainToBakery = grainToBakery;
    simSettings.grainToPigs = grainToPigs;
    simSettings.toolQueue = toolQueue;
    console.log('👷 SimWorker: Updated Economic priorities in model:', simSettings);
  }

  if (action === 'UPDATE_MILITARY_RATIOS') {
    const { swordsmanRatio, bowmanRatio, medicRatio, autoRecruit, selectedFaction } = payload;
    simSettings.swordsmanRatio = swordsmanRatio;
    simSettings.bowmanRatio = bowmanRatio;
    simSettings.medicRatio = medicRatio;
    simSettings.autoRecruit = autoRecruit;
    simSettings.selectedFaction = selectedFaction;
    console.log('👷 SimWorker: Updated Military distributions in model:', simSettings);
  }

  // Handle building placements or commands sent from the client (relayed by the server)
  if (action === 'COMMAND_VERIFY') {
    const { command } = payload;
    handleVerifiedCommand(command);
  }
};

function spawnInitialSettlers() {
  // Spawn 15 carriers inside the settler slots (0 to 99)
  for (let i = 0; i < 15; i++) {
    const offset = i * STRIDE;
    
    const startX = 30 + Math.floor(Math.random() * 10);
    const startY = 30 + Math.floor(Math.random() * 10);

    entityArray[offset + ACTIVE_FLAG] = 1.0; // Active
    entityArray[offset + ENTITY_TYPE] = 1.0; // Carrier
    entityArray[offset + PREV_GRID_X] = startX;
    entityArray[offset + PREV_GRID_Y] = startY;
    entityArray[offset + NEXT_GRID_X] = startX;
    entityArray[offset + NEXT_GRID_Y] = startY;
    entityArray[offset + HEADING_DIR] = Math.floor(Math.random() * 8);
    entityArray[offset + ANIMATION_FRAME] = 0.0;

    // Cache local state inside worker RAM
    settlerSimStates[i] = {
      type: 'settler',
      path: [],
      targetX: startX,
      targetY: startY,
      state: 'idle',
      targetBuildingIdx: -1
    };
  }
}

// Highly optimized A* Pathfinder inside private Worker thread (manages 2.5D grid traversal)
function findPathAStar(startX, startY, endX, endY) {
  if (startX === endX && startY === endY) return [];

  const openList = [];
  const closedSet = new Set();

  const startNode = {
    x: startX,
    y: startY,
    g: 0,
    h: Math.abs(startX - endX) + Math.abs(startY - endY),
    f: 0,
    parent: null
  };
  startNode.f = startNode.g + startNode.h;
  openList.push(startNode);

  while (openList.length > 0) {
    // Find node with lowest f value
    openList.sort((a, b) => a.f - b.f);
    const currentNode = openList.shift();
    const currentKey = `${currentNode.x},${currentNode.y}`;
    closedSet.add(currentKey);

    // Reached target
    if (currentNode.x === endX && currentNode.y === endY) {
      const path = [];
      let temp = currentNode;
      while (temp.parent) {
        path.push({ x: temp.x, y: temp.y });
        temp = temp.parent;
      }
      return path.reverse(); // Path from start to end (excluding start)
    }

    // Neighbors (8 directions traversal)
    const directions = [
      { dx: 0, dy: -1 }, // N
      { dx: 1, dy: -1 }, // NE
      { dx: 1, dy: 0 },  // E
      { dx: 1, dy: 1 },  // SE
      { dx: 0, dy: 1 },  // S
      { dx: -1, dy: 1 }, // SW
      { dx: -1, dy: 0 }, // W
      { dx: -1, dy: -1 } // NW
    ];

    for (const dir of directions) {
      const nx = currentNode.x + dir.dx;
      const ny = currentNode.y + dir.dy;

      // Map bounds check
      if (nx < 0 || nx >= mapSize || ny < 0 || ny >= mapSize) continue;

      // Occupancy check (avoid obstacles/buildings)
      const index = ny * mapSize + nx;
      // Walkable terrain check: only allow walking where there are no complete buildings (value 1)
      if (occupancyMap[index] === 1) continue; 

      const neighborKey = `${nx},${ny}`;
      if (closedSet.has(neighborKey)) continue;

      // g cost: diagonal steps cost slightly more (1.4) than straight (1.0)
      const moveCost = (dir.dx !== 0 && dir.dy !== 0) ? 1.414 : 1.0;
      const gScore = currentNode.g + moveCost;
      const hScore = Math.abs(nx - endX) + Math.abs(ny - endY);
      const fScore = gScore + hScore;

      // Check if neighbor is already in open list with a lower score
      let existingNode = openList.find(n => n.x === nx && n.y === ny);
      if (existingNode) {
        if (gScore < existingNode.g) {
          existingNode.g = gScore;
          existingNode.f = fScore;
          existingNode.parent = currentNode;
        }
      } else {
        openList.push({
          x: nx,
          y: ny,
          g: gScore,
          h: hScore,
          f: fScore,
          parent: currentNode
        });
      }
    }
  }

  return []; // No path found
}

function getHeadingDirection(dx, dy) {
  if (dx === 0 && dy === -1) return 0;
  if (dx === 1 && dy === -1) return 1;
  if (dx === 1 && dy === 0) return 2;
  if (dx === 1 && dy === 1) return 3;
  if (dx === 0 && dy === 1) return 4;
  if (dx === -1 && dy === 1) return 5;
  if (dx === -1 && dy === 0) return 6;
  if (dx === -1 && dy === -1) return 7;
  return 0;
}

// 10 Hz Spelsimulerings-loop
function gameTick() {
  if (!entityArray) return;

  // 1. Identify all active buildings under construction (Indices 100 to 999)
  const activeBuildings = [];
  for (let i = 100; i < maxEntities; i++) {
    const offset = i * STRIDE;
    if (entityArray[offset + ACTIVE_FLAG] === 1.0 && entityArray[offset + ENTITY_TYPE] === 5.0) {
      const simState = settlerSimStates[i];
      if (simState && simState.type === 'building' && !simState.isCompleted) {
        // Fetch current progress directly from the shared array buffer block
        simState.progress = entityArray[offset + ANIMATION_FRAME];
        
        activeBuildings.push({
          index: i,
          x: simState.x,
          y: simState.y,
          progress: simState.progress,
          simState: simState
        });
      }
    }
  }

  // 2. Loop through all settler slots (0 to 99)
  for (let i = 0; i < 100; i++) {
    const offset = i * STRIDE;
    if (entityArray[offset + ACTIVE_FLAG] !== 1.0) continue;

    const simState = settlerSimStates[i];
    if (!simState || simState.type !== 'settler') continue;

    // Shift target coordinates to become the previous coordinates
    const prevX = entityArray[offset + NEXT_GRID_X];
    const prevY = entityArray[offset + NEXT_GRID_Y];
    entityArray[offset + PREV_GRID_X] = prevX;
    entityArray[offset + PREV_GRID_Y] = prevY;

    // A. Idle state role assignment check
    if (simState.state === 'idle') {
      let taskAssigned = false;

      // Scan active buildings for digging or construction work
      for (const building of activeBuildings) {
        if (building.progress < 40.0) {
          // Digging phase needs up to 2 diggers
          if (building.simState.diggersAssigned < 2) {
            building.simState.diggersAssigned++;
            simState.state = 'walk_to_dig';
            simState.targetBuildingIdx = building.index;
            simState.path = findPathAStar(prevX, prevY, building.x, building.y);
            entityArray[offset + ENTITY_TYPE] = 2.0; // Digger (Sea Green + Shovel)
            taskAssigned = true;
            break;
          }
        } else if (building.progress < 100.0) {
          // Building phase needs up to 2 builders
          if (building.simState.buildersAssigned < 2) {
            building.simState.buildersAssigned++;
            simState.state = 'walk_to_build';
            simState.targetBuildingIdx = building.index;
            simState.path = findPathAStar(prevX, prevY, building.x, building.y);
            entityArray[offset + ENTITY_TYPE] = 3.0; // Builder (Orange-brown + Hammer)
            taskAssigned = true;
            break;
          }
        }
      }

      if (!taskAssigned) {
        // Revert back to Carrier role if we don't have any tasks
        entityArray[offset + ENTITY_TYPE] = 1.0; // Carrier (Steel Blue + Bag)
        
        // Standard random wandering walk inside grassy meadows
        let randX, randY;
        let isValid = false;
        let limit = 0;
        while (!isValid && limit < 10) {
          randX = 20 + Math.floor(Math.random() * 30);
          randY = 20 + Math.floor(Math.random() * 30);
          const index = randY * mapSize + randX;
          if (occupancyMap[index] === 0) {
            isValid = true;
          }
          limit++;
        }

        if (isValid) {
          simState.targetX = randX;
          simState.targetY = randY;
          simState.path = findPathAStar(prevX, prevY, randX, randY);
          simState.state = 'wandering';
        }
      }
    }

    // B. Walk along the planned path step-by-step
    if (simState.state === 'wandering' || simState.state === 'walk_to_dig' || simState.state === 'walk_to_build') {
      if (simState.path.length > 0) {
        const nextStep = simState.path.shift();
        const dx = nextStep.x - prevX;
        const dy = nextStep.y - prevY;

        entityArray[offset + NEXT_GRID_X] = nextStep.x;
        entityArray[offset + NEXT_GRID_Y] = nextStep.y;
        entityArray[offset + HEADING_DIR] = getHeadingDirection(dx, dy);
        entityArray[offset + ANIMATION_FRAME] = (entityArray[offset + ANIMATION_FRAME] + 1) % 4;
      } else {
        // Reached target destination coordinate
        if (simState.state === 'walk_to_dig') {
          simState.state = 'digging';
        } else if (simState.state === 'walk_to_build') {
          simState.state = 'building';
        } else {
          simState.state = 'idle';
          entityArray[offset + NEXT_GRID_X] = prevX;
          entityArray[offset + NEXT_GRID_Y] = prevY;
        }
      }
    }

    // C. Perform active work state
    if (simState.state === 'digging' || simState.state === 'building') {
      const b_idx = simState.targetBuildingIdx;
      const b_offset = b_idx * STRIDE;
      
      // Verify building is still active
      if (entityArray[b_offset + ACTIVE_FLAG] === 1.0) {
        let currentProgress = entityArray[b_offset + ANIMATION_FRAME];
        
        if (currentProgress < 100.0) {
          // Increment building progress (1% per tick per active settler)
          currentProgress = Math.min(100.0, currentProgress + 1.0);
          entityArray[b_offset + ANIMATION_FRAME] = currentProgress;
          
          // Play a cute wobble frame for the worker
          entityArray[offset + ANIMATION_FRAME] = (entityArray[offset + ANIMATION_FRAME] + 1) % 4;
          
          // Handle transition from digging to building phase in model
          if (currentProgress >= 40.0 && simState.state === 'digging') {
            // Digging phase complete, release and let it become builder
            const bState = settlerSimStates[b_idx];
            if (bState) {
              bState.diggersAssigned = Math.max(0, bState.diggersAssigned - 1);
            }
            
            simState.state = 'idle';
            simState.targetBuildingIdx = -1;
            entityArray[offset + NEXT_GRID_X] = prevX;
            entityArray[offset + NEXT_GRID_Y] = prevY;
          }
        } else {
          // Building is 100% complete! Mark it and release the worker
          const bState = settlerSimStates[b_idx];
          if (bState) {
            bState.diggersAssigned = 0;
            bState.buildersAssigned = 0;
            bState.isCompleted = true;
            // Write block to occupancy map (1 = Complete obstacle)
            const mapIndex = bState.y * mapSize + bState.x;
            occupancyMap[mapIndex] = 1;
          }
          
          simState.state = 'idle';
          simState.targetBuildingIdx = -1;
          entityArray[offset + NEXT_GRID_X] = prevX;
          entityArray[offset + NEXT_GRID_Y] = prevY;
        }
      } else {
        // Building was destroyed or is invalid
        simState.state = 'idle';
        simState.targetBuildingIdx = -1;
        entityArray[offset + NEXT_GRID_X] = prevX;
        entityArray[offset + NEXT_GRID_Y] = prevY;
      }
    }
  }

  // Notify main thread that a simulation tick has finished
  if (typeof SharedArrayBuffer !== 'undefined' && sharedBuffer instanceof SharedArrayBuffer) {
    self.postMessage({ action: 'TICK_COMPLETE', timestamp: Date.now() });
  } else {
    self.postMessage({ 
      action: 'TICK_COMPLETE', 
      timestamp: Date.now(), 
      fallbackData: entityArray 
    });
  }
}

function handleVerifiedCommand(command) {
  // Command validator (Anti-Cheat check)
  const { type, x, y, building } = command;
  console.log(`👷 SimWorker: Authoritative check on command [${type}] at X: ${x}, Y: ${y}`);
  
  if (type === 'BUILD') {
    // 1. Check if coordinate is clear
    const index = y * mapSize + x;
    if (occupancyMap[index] === 0) {
      occupancyMap[index] = 2; // 2 = Building construction site / foundation

      // 2. Find free slot for building from 100 to 999
      let b_idx = -1;
      for (let i = 100; i < maxEntities; i++) {
        const offset = i * STRIDE;
        if (entityArray[offset + ACTIVE_FLAG] === 0.0) {
          b_idx = i;
          break;
        }
      }

      if (b_idx !== -1) {
        const offset = b_idx * STRIDE;
        entityArray[offset + ACTIVE_FLAG] = 1.0; // Active
        entityArray[offset + ENTITY_TYPE] = 5.0; // Building
        entityArray[offset + PREV_GRID_X] = x;
        entityArray[offset + PREV_GRID_Y] = y;
        entityArray[offset + NEXT_GRID_X] = x;
        entityArray[offset + NEXT_GRID_Y] = y;
        
        // Map building type to float code
        let typeCode = 1.0; // Woodcutter
        if (building === 'Sawmill') typeCode = 2.0;
        else if (building === 'Stonecutter') typeCode = 3.0;
        else if (building === 'Residence') typeCode = 4.0;
        else if (building === 'Grain Farm') typeCode = 5.0;
        else if (building === 'Grain Mill') typeCode = 6.0;
        else if (building === 'Bakery') typeCode = 7.0;
        else if (building === 'Pig Farm') typeCode = 8.0;
        else if (building === 'Slaughterhouse') typeCode = 9.0;
        else if (building === 'Coal Mine') typeCode = 10.0;
        else if (building === 'Iron Mine') typeCode = 11.0;
        else if (building === 'Gold Smelter') typeCode = 12.0;
        else if (building === 'Weapon Smithy') typeCode = 13.0;
        else if (building === 'Sentry Tower') typeCode = 14.0;
        else if (building === 'Barracks') typeCode = 15.0;
        else if (building === 'Stone Temple') typeCode = 16.0;

        entityArray[offset + HEADING_DIR] = typeCode;
        entityArray[offset + ANIMATION_FRAME] = 0.0; // 0% progress

        settlerSimStates[b_idx] = {
          type: 'building',
          buildingType: building,
          x: x,
          y: y,
          progress: 0,
          diggersAssigned: 0,
          buildersAssigned: 0,
          isCompleted: false
        };

        console.log(`👷 SimWorker: Spawned building ${building} at slot ${b_idx} coordinates (${x}, ${y})`);
      }
    }
  }
}
