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
// Slot 8: CARRIED_RESOURCE (0.0 = none, 1.0 = log, 2.0 = stone, 3.0 = gold bar, 4.0 = iron bar)
const STRIDE = 9;

const ACTIVE_FLAG = 0;
const ENTITY_TYPE = 1;
const PREV_GRID_X = 2;
const PREV_GRID_Y = 3;
const NEXT_GRID_X = 4;
const NEXT_GRID_Y = 5;
const HEADING_DIR = 6;
const ANIMATION_FRAME = 7;
const CARRIED_RESOURCE = 8;

// Simulated grid maps (Flat Typed Arrays for high-performance memory footprint)
let terrainMap = null;
let occupancyMap = null;
let sharedTrafficMap = null;
let sharedTerritoryMap = null;

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

    // Map the shared traffic map and territory map starting after the entity Float32Array!
    const entityBufferBytes = maxEntities * STRIDE * Float32Array.BYTES_PER_ELEMENT;
    const trafficMapBytes = mapSize * mapSize;
    sharedTrafficMap = new Uint8Array(sharedBuffer, entityBufferBytes, mapSize * mapSize);
    sharedTerritoryMap = new Uint8Array(sharedBuffer, entityBufferBytes + trafficMapBytes, mapSize * mapSize);

    // Populate initial starting territory for Player 1 (Aureon Lord of Light / Solari)
    const halfMap = mapSize / 2;
    const spawnRadius = mapSize * 0.20; // 20% of mapSize
    for (let x = 0; x < mapSize; x++) {
      for (let y = 0; y < mapSize; y++) {
        const dx = x - halfMap;
        const dy = y - halfMap;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const index = y * mapSize + x;
        if (dist < spawnRadius && isWalkableGrass(x, y)) {
          sharedTerritoryMap[index] = 1; // Player 1 territory
        } else {
          sharedTerritoryMap[index] = 0; // Unowned territory
        }
      }
    }

    console.log(`裁 SimWorker: Initialized simulation thread. Max Entities: ${maxEntities}. SAB Bytes: ${sab.byteLength}`);

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

function isWalkableGrass(x, y) {
  if (x < 0 || x >= mapSize || y < 0 || y >= mapSize) return false;
  const halfMap = mapSize / 2;
  const dx = x - halfMap;
  const dy = y - halfMap;
  const dist = Math.sqrt(dx * dx + dy * dy);
  
  const angle = Math.atan2(dy, dx);
  const noise = Math.sin(angle * 7) * 6 + Math.cos(angle * 13) * 3;
  const landEdge = (mapSize * 0.36) + noise;
  
  return dist < (landEdge - 4);
}

function expandTerritoryAt(cx, cy, radius) {
  for (let x = Math.max(0, cx - radius); x <= Math.min(mapSize - 1, cx + radius); x++) {
    for (let y = Math.max(0, cy - radius); y <= Math.min(mapSize - 1, cy + radius); y++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= radius * radius) {
        if (isWalkableGrass(x, y)) {
          const index = y * mapSize + x;
          sharedTerritoryMap[index] = 1; // Claim tile for Player 1!
        }
      }
    }
  }
}

function spawnInitialSettlers() {
  const halfMap = mapSize / 2;
  // Spawn 15 carriers inside the settler slots (0 to 99)
  for (let i = 0; i < 15; i++) {
    const offset = i * STRIDE;
    
    let startX = halfMap;
    let startY = halfMap;
    let found = false;
    let limit = 0;
    
    const rangeMin = Math.floor(halfMap * 0.78);
    const rangeSpan = Math.floor(halfMap * 0.44);
    
    while (!found && limit < 100) {
      startX = rangeMin + Math.floor(Math.random() * rangeSpan);
      startY = rangeMin + Math.floor(Math.random() * rangeSpan);
      if (isWalkableGrass(startX, startY)) {
        found = true;
      }
      limit++;
    }

    entityArray[offset + ACTIVE_FLAG] = 1.0; // Active
    entityArray[offset + ENTITY_TYPE] = 1.0; // Carrier
    entityArray[offset + PREV_GRID_X] = startX;
    entityArray[offset + PREV_GRID_Y] = startY;
    entityArray[offset + NEXT_GRID_X] = startX;
    entityArray[offset + NEXT_GRID_Y] = startY;
    entityArray[offset + HEADING_DIR] = Math.floor(Math.random() * 8);
    entityArray[offset + ANIMATION_FRAME] = 0.0;
    entityArray[offset + CARRIED_RESOURCE] = 0.0; // Start empty

    // Cache local state inside worker RAM
    settlerSimStates[i] = {
      type: 'settler',
      path: [],
      targetX: startX,
      targetY: startY,
      state: 'idle',
      targetBuildingIdx: -1,
      logisticsTask: null
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

  // Slow traffic decay: every 10 ticks (1 second), decay all non-zero traffic map cells by 2
  if (typeof gameTick.decayTimer === 'undefined') {
    gameTick.decayTimer = 0;
  }
  gameTick.decayTimer++;
  if (gameTick.decayTimer >= 10) {
    gameTick.decayTimer = 0;
    for (let idx = 0; idx < mapSize * mapSize; idx++) {
      if (sharedTrafficMap[idx] > 0) {
        sharedTrafficMap[idx] = Math.max(0, sharedTrafficMap[idx] - 2);
      }
    }
  }

  // 1. Identify all active buildings (under construction and completed)
  const activeBuildings = [];
  const completedBuildings = [];
  
  for (let i = 100; i < maxEntities; i++) {
    const offset = i * STRIDE;
    if (entityArray[offset + ACTIVE_FLAG] === 1.0 && entityArray[offset + ENTITY_TYPE] === 5.0) {
      const simState = settlerSimStates[i];
      if (simState && simState.type === 'building') {
        simState.progress = entityArray[offset + ANIMATION_FRAME];
        
        if (!simState.isCompleted) {
          activeBuildings.push({
            index: i,
            x: simState.x,
            y: simState.y,
            progress: simState.progress,
            simState: simState
          });
        } else {
          completedBuildings.push({
            index: i,
            type: simState.buildingType,
            x: simState.x,
            y: simState.y,
            simState: simState
          });
        }
      }
    }
  }

  // 2. Tick completed production buildings
  for (const b of completedBuildings) {
    const state = b.simState;
    if (!state.inventory) {
      state.inventory = { logs: 0, stones: 0, gold: 0, iron: 0 };
    }
    if (!state.productionTimer) {
      state.productionTimer = 0;
    }
    
    state.productionTimer++;
    
    // Woodcutter produces 1 Log every 80 ticks (8 seconds) if storage < 5
    if (b.type === 'Woodcutter') {
      if (state.productionTimer >= 80) {
        state.productionTimer = 0;
        if (state.inventory.logs < 5) {
          state.inventory.logs++;
          console.log(`🌲 SimWorker: Woodcutter at index ${b.index} produced a Log. Total logs: ${state.inventory.logs}`);
        }
      }
    }
    // Stonecutter produces 1 Stone every 90 ticks if storage < 5
    else if (b.type === 'Stonecutter') {
      if (state.productionTimer >= 90) {
        state.productionTimer = 0;
        if (state.inventory.stones < 5) {
          state.inventory.stones++;
          console.log(`🪨 SimWorker: Stonecutter at index ${b.index} produced a Stone. Total stones: ${state.inventory.stones}`);
        }
      }
    }
    // Mine production (Coal Mine / Iron Mine) every 100 ticks
    else if (b.type === 'Coal Mine' || b.type === 'Iron Mine') {
      if (state.productionTimer >= 100) {
        state.productionTimer = 0;
        const resKey = b.type === 'Coal Mine' ? 'gold' : 'iron';
        if (state.inventory[resKey] < 5) {
          state.inventory[resKey]++;
        }
      }
    }
    // Sawmill consumes Logs and produces planks (planks represent stones/bars here for simplicity)
    else if (b.type === 'Sawmill') {
      if (state.inventory.logs > 0 && state.productionTimer >= 100) {
        state.productionTimer = 0;
        state.inventory.logs--;
        state.inventory.stones++; // Planks produced
        console.log(`🪚 SimWorker: Sawmill at index ${b.index} processed 1 Log into Planks.`);
      }
    }
  }

  // 3. Generate logistics tasks based on resource availability
  const logisticsTasks = [];

  const woodcutters = completedBuildings.filter(b => b.type === 'Woodcutter');
  const sawmills = completedBuildings.filter(b => b.type === 'Sawmill');
  
  for (const wc of woodcutters) {
    const wcState = wc.simState;
    if (wcState.inventory && wcState.inventory.logs > 0) {
      // Look for a sawmill with logs < 4
      const targetSm = sawmills.find(sm => !sm.simState.inventory || sm.simState.inventory.logs < 4);
      if (targetSm) {
        logisticsTasks.push({
          resourceType: 1.0, // Log
          fromX: wc.x,
          fromY: wc.y,
          toX: targetSm.x,
          toY: targetSm.y,
          fromIdx: wc.index,
          toIdx: targetSm.index,
          claimed: false
        });
      }
    }
  }

  const stonecutters = completedBuildings.filter(b => b.type === 'Stonecutter');
  for (const sc of stonecutters) {
    const scState = sc.simState;
    if (scState.inventory && scState.inventory.stones > 0) {
      // Find building under construction requiring stones
      const targetBuilding = activeBuildings.find(ab => {
        const bState = ab.simState;
        if (!bState.inventory) bState.inventory = { logs: 0, stones: 0, gold: 0, iron: 0 };
        return ab.progress >= 40.0 && bState.inventory.stones < 3;
      });
      
      if (targetBuilding) {
        logisticsTasks.push({
          resourceType: 2.0, // Stone
          fromX: sc.x,
          fromY: sc.y,
          toX: targetBuilding.x,
          toY: targetBuilding.y,
          fromIdx: sc.index,
          toIdx: targetBuilding.index,
          claimed: false
        });
      }
    }
  }

  // 4. Loop through all settler slots (0 to 99)
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

      // I. Check for active logistics transport tasks
      const unclaimedTask = logisticsTasks.find(task => !task.claimed);
      if (unclaimedTask) {
        unclaimedTask.claimed = true;
        
        // Claim the resource immediately to avoid double-allocation
        const fromBState = settlerSimStates[unclaimedTask.fromIdx];
        if (fromBState && fromBState.inventory) {
          if (unclaimedTask.resourceType === 1.0) fromBState.inventory.logs = Math.max(0, fromBState.inventory.logs - 1);
          if (unclaimedTask.resourceType === 2.0) fromBState.inventory.stones = Math.max(0, fromBState.inventory.stones - 1);
        }

        simState.state = 'walk_to_fetch';
        simState.targetX = unclaimedTask.fromX;
        simState.targetY = unclaimedTask.fromY;
        simState.logisticsTask = unclaimedTask;
        simState.path = findPathAStar(prevX, prevY, unclaimedTask.fromX, unclaimedTask.fromY);
        
        entityArray[offset + ENTITY_TYPE] = 1.0; // Carrier
        entityArray[offset + CARRIED_RESOURCE] = 0.0; // Starts carrying nothing
        taskAssigned = true;
      }

      // II. Scan active buildings for digging or construction work
      if (!taskAssigned) {
        for (const building of activeBuildings) {
          if (building.progress < 40.0) {
            // Digging phase needs up to 2 diggers
            if (building.simState.diggersAssigned < 2) {
              building.simState.diggersAssigned++;
              simState.state = 'walk_to_dig';
              simState.targetBuildingIdx = building.index;
              simState.path = findPathAStar(prevX, prevY, building.x, building.y);
              entityArray[offset + ENTITY_TYPE] = 2.0; // Digger (Sea Green + Shovel)
              entityArray[offset + CARRIED_RESOURCE] = 0.0; // Drop bag/resources
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
              entityArray[offset + CARRIED_RESOURCE] = 0.0; // Drop bag/resources
              taskAssigned = true;
              break;
            }
          }
        }
      }

      // III. Wandering fallback
      if (!taskAssigned) {
        // Revert back to Carrier role if we don't have any tasks
        entityArray[offset + ENTITY_TYPE] = 1.0; // Carrier (Steel Blue + Bag)
        entityArray[offset + CARRIED_RESOURCE] = 0.0; // Empty bag when wandering
        
        // Standard random wandering walk inside grassy meadows
        let randX, randY;
        let isValid = false;
        let limit = 0;
        while (!isValid && limit < 50) {
          randX = 20 + Math.floor(Math.random() * 88);
          randY = 20 + Math.floor(Math.random() * 88);
          const index = randY * mapSize + randX;
          if (occupancyMap[index] === 0 && isWalkableGrass(randX, randY)) {
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
    if (
      simState.state === 'wandering' || 
      simState.state === 'walk_to_dig' || 
      simState.state === 'walk_to_build' ||
      simState.state === 'walk_to_fetch' ||
      simState.state === 'walk_to_deliver'
    ) {
      if (simState.path.length > 0) {
        const nextStep = simState.path.shift();
        const dx = nextStep.x - prevX;
        const dy = nextStep.y - prevY;

        entityArray[offset + NEXT_GRID_X] = nextStep.x;
        entityArray[offset + NEXT_GRID_Y] = nextStep.y;
        entityArray[offset + HEADING_DIR] = getHeadingDirection(dx, dy);
        entityArray[offset + ANIMATION_FRAME] = (entityArray[offset + ANIMATION_FRAME] + 1) % 4;
        
        // Soil wear: increase traffic heat on the target tile!
        const tileIdx = nextStep.y * mapSize + nextStep.x;
        if (sharedTrafficMap[tileIdx] < 255) {
          sharedTrafficMap[tileIdx] = Math.min(255, sharedTrafficMap[tileIdx] + 20); // 20x step increment!
        }
      } else {
        // Reached target destination coordinate
        if (simState.state === 'walk_to_dig') {
          simState.state = 'digging';
        } else if (simState.state === 'walk_to_build') {
          simState.state = 'building';
        } else if (simState.state === 'walk_to_fetch') {
          const task = simState.logisticsTask;
          if (task) {
            entityArray[offset + CARRIED_RESOURCE] = task.resourceType; // Show log/stone on back!
            
            // Re-route to delivery destination
            simState.state = 'walk_to_deliver';
            simState.targetX = task.toX;
            simState.targetY = task.toY;
            simState.path = findPathAStar(prevX, prevY, task.toX, task.toY);
          } else {
            simState.state = 'idle';
          }
        } else if (simState.state === 'walk_to_deliver') {
          const task = simState.logisticsTask;
          if (task) {
            const toBState = settlerSimStates[task.toIdx];
            if (toBState) {
              if (!toBState.inventory) toBState.inventory = { logs: 0, stones: 0, gold: 0, iron: 0 };
              if (task.resourceType === 1.0) toBState.inventory.logs++;
              if (task.resourceType === 2.0) toBState.inventory.stones++;
              console.log(`📦 SimWorker: Carrier delivered resource type ${task.resourceType} to building ${task.toIdx}`);
            }
          }
          
          entityArray[offset + CARRIED_RESOURCE] = 0.0; // Clear back
          simState.state = 'idle';
          simState.logisticsTask = null;
          entityArray[offset + NEXT_GRID_X] = prevX;
          entityArray[offset + NEXT_GRID_Y] = prevY;
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

            // Sentry Tower expands player territory immediately upon completion!
            if (bState.buildingType === 'Sentry Tower') {
              expandTerritoryAt(bState.x, bState.y, 16);
            }
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
    // 1. Check if coordinate is clear and is within the player's territory
    const index = y * mapSize + x;
    const isOwned = sharedTerritoryMap && sharedTerritoryMap[index] === 1;

    if (occupancyMap[index] === 0 && isOwned) {
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
