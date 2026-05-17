import React, { useEffect, useRef, useState } from 'react';
import { initGame, updateTickTimestamp, setPendingBuilding } from './engine/PixiApp';
import { soundManager } from './engine/SoundManager';
import { 
  Hammer, 
  Users, 
  TrendingUp, 
  ShieldAlert, 
  MapPin, 
  Volume2, 
  VolumeX, 
  Flame, 
  Sparkles,
  Award
} from 'lucide-react';

export default function App() {
  const canvasRef = useRef(null);
  const workerRef = useRef(null);
  
  // Game Setup Configurations
  const MAX_UNITS = 1000;
  const STRIDE = 9;
  const MAP_SIZE = 128;
  
  // HUD UI State
  const [selectedFaction, setSelectedFaction] = useState('solari'); // 'solari', 'njordic', 'zapotec', 'voidborn'
  const [activeTab, setActiveTab] = useState('build'); // 'build', 'settlers', 'economy', 'military'
  const [buildSubCategory, setBuildSubCategory] = useState('basic'); // 'basic', 'food', 'mining', 'defense'
  const [muteAudio, setMuteAudio] = useState(false);
  const [gameTickCount, setGameTickCount] = useState(0);
  const [activeBuildingInfo, setActiveBuildingInfo] = useState(null);
  
  // Settlers Allocation States (S4-Style carriers vs diggers vs builders)
  const [carrierRatio, setCarrierRatio] = useState(50);
  const [diggerRatio, setDiggerRatio] = useState(30);
  const [builderRatio, setBuilderRatio] = useState(20);
  const [autoGeologist, setAutoGeologist] = useState(true);

  // Economy Priority Settings (S4-Style Goods distribution)
  const [economySubTab, setEconomySubTab] = useState('goods'); // 'goods', 'tools'
  const [coalToIron, setCoalToIron] = useState(60);
  const [coalToGold, setCoalToGold] = useState(40);
  const [woodToSawmill, setWoodToSawmill] = useState(80);
  const [woodToShipyard, setWoodToShipyard] = useState(20);
  const [grainToBakery, setGrainToBakery] = useState(60);
  const [grainToPigs, setGrainToPigs] = useState(40);

  // Tool Queue (Interactive S4-Style re-orderable priority list)
  const [toolQueue, setToolQueue] = useState([
    { id: 'axe', name: '🪓 Axe', count: 1 },
    { id: 'pickaxe', name: '⛏️ Pickaxe', count: 2 },
    { id: 'hammer', name: '🔨 Hammer', count: 0 },
    { id: 'scythe', name: '🌾 Scythe', count: 1 },
    { id: 'shovel', name: '🧹 Shovel', count: 0 }
  ]);

  // Military States (S4-Style recruit sliders)
  const [militarySubTab, setMilitarySubTab] = useState('recruits'); // 'recruits', 'spells'
  const [swordsmanRatio, setSwordsmanRatio] = useState(60);
  const [bowmanRatio, setBowmanRatio] = useState(30);
  const [medicRatio, setMedicRatio] = useState(10);
  const [autoRecruit, setAutoRecruit] = useState(true);
  
  useEffect(() => {
    if (!canvasRef.current) return;

    // 1. Allocate SharedArrayBuffer
    // Entity Buffer: 1000 units * 9 float properties per unit * 4 bytes per float
    // Traffic Map Buffer: 128 * 128 bytes (1 byte per tile for 0-255 traffic heat)
    const entityBufferSize = MAX_UNITS * STRIDE * Float32Array.BYTES_PER_ELEMENT;
    const trafficMapSize = MAP_SIZE * MAP_SIZE;
    const bufferSize = entityBufferSize + trafficMapSize;
    
    // We use a safe fallback if SharedArrayBuffer is not available locally
    // (though in modern browsers with proper Express headers it works flawlessly)
    let sharedBuffer;
    try {
      sharedBuffer = new SharedArrayBuffer(bufferSize);
      console.log('📁 Memory: Allocated SharedArrayBuffer successfully.');
    } catch (e) {
      console.warn('⚠️ SharedArrayBuffer fallback: Using standard ArrayBuffer (Multi-threading communication will fall back to message copying).');
      sharedBuffer = new ArrayBuffer(bufferSize);
    }

    // 2. Spawn Background Simulation Web Worker
    // Note: Vite supports Web Workers natively using new Worker(url, {type: 'module'})
    workerRef.current = new Worker(
      new URL('./workers/SimWorker.js', import.meta.url),
      { type: 'module' }
    );

    // 3. Initialize background worker simulation thread
    workerRef.current.postMessage({
      action: 'INIT',
      payload: {
        sab: sharedBuffer,
        mapDimensions: MAP_SIZE,
        maxUnits: MAX_UNITS
      }
    });

    // 4. Initialize PixiJS (v8) GPU Engine
    let isCancelled = false;
    let pixiApp = null;
    initGame(canvasRef.current, sharedBuffer, MAX_UNITS).then((app) => {
      if (isCancelled) {
        try { app.destroy(true, { children: true }); } catch (e) {}
        return;
      }
      pixiApp = app;
    });

    // 5. Receive messages from simulation Web Worker
    workerRef.current.onmessage = (event) => {
      const { action, timestamp, fallbackData } = event.data;
      if (action === 'TICK_COMPLETE') {
        if (isCancelled) return;
        if (fallbackData) {
          // If we had to fall back to message copying, copy the new data into our local buffer
          const localArray = new Float32Array(sharedBuffer);
          localArray.set(fallbackData);
        }
        // Push tick timestamp to the sliding interpolation loop in the canvas
        updateTickTimestamp(timestamp);
        setGameTickCount((prev) => prev + 1);
      }
    };

    return () => {
      isCancelled = true;
      if (workerRef.current) {
        workerRef.current.terminate();
      }
      if (pixiApp) {
        try { pixiApp.destroy(true, { children: true }); } catch (e) {}
      }
    };
  }, []);

  // Bridge helper to transmit settings changes to our background simulation thread
  const syncSettingsToWorker = (action, payload) => {
    if (workerRef.current) {
      workerRef.current.postMessage({ action, payload });
    }
  };

  // Sync Settlers Occupational Ratios and Geologist settings
  useEffect(() => {
    syncSettingsToWorker('UPDATE_SETTLER_RATIOS', {
      carrierRatio,
      diggerRatio,
      builderRatio,
      autoGeologist
    });
  }, [carrierRatio, diggerRatio, builderRatio, autoGeologist]);

  // Sync Economic Priorities and Tool quotas
  useEffect(() => {
    syncSettingsToWorker('UPDATE_ECONOMY_RATIOS', {
      woodToSawmill,
      woodToShipyard,
      coalToIron,
      coalToGold,
      grainToBakery,
      grainToPigs,
      toolQueue
    });
  }, [woodToSawmill, woodToShipyard, coalToIron, coalToGold, grainToBakery, grainToPigs, toolQueue]);

  // Sync Barracks Recruit distributions, auto-recruit state, and faction UI skins
  useEffect(() => {
    syncSettingsToWorker('UPDATE_MILITARY_RATIOS', {
      swordsmanRatio,
      bowmanRatio,
      medicRatio,
      autoRecruit,
      selectedFaction
    });
  }, [swordsmanRatio, bowmanRatio, medicRatio, autoRecruit, selectedFaction]);

  // Sync with high-fidelity symphonic Sound & Music Manager
  useEffect(() => {
    soundManager.setMute(muteAudio);
  }, [muteAudio]);

  useEffect(() => {
    soundManager.initMusic(selectedFaction);
  }, [selectedFaction]);

  // Send a verified command directly to our background authoritative worker
  const handlePlacementCommand = (buildingType) => {
    // Expose pending building to PixiApp, with a grid placement callback!
    setPendingBuilding(buildingType, (type, gridX, gridY) => {
      const command = {
        type: 'BUILD',
        building: type,
        x: gridX,
        y: gridY,
        playerId: 'player1',
        timestamp: Date.now()
      };

      if (workerRef.current) {
        workerRef.current.postMessage({
          action: 'COMMAND_VERIFY',
          payload: { command }
        });
      }

      setActiveBuildingInfo({
        name: type,
        x: gridX,
        y: gridY,
        progress: 0,
        productivity: 100
      });
    });
  };

  // Faction UI styling
  const getFactionSkinClass = () => {
    switch(selectedFaction) {
      case 'solari': return 'skin-solari';
      case 'njordic': return 'skin-njordic';
      case 'zapotec': return 'skin-zapotec';
      case 'voidborn': return 'skin-voidborn';
      default: return 'skin-solari';
    }
  };

  // Re-order tools in the Tool Smithy queue (Priority queue simulation)
  const moveToolInQueue = (index, direction) => {
    const newQueue = [...toolQueue];
    const targetIndex = index + direction;
    if (targetIndex >= 0 && targetIndex < newQueue.length) {
      const temp = newQueue[index];
      newQueue[index] = newQueue[targetIndex];
      newQueue[targetIndex] = temp;
      setToolQueue(newQueue);
    }
  };

  // Increment or decrement tool auto-production cap
  const adjustToolCount = (index, change) => {
    const newQueue = [...toolQueue];
    newQueue[index].count = Math.max(0, newQueue[index].count + change);
    setToolQueue(newQueue);
  };

  // Dynamically balance the Carrier / Digger / Builder ratios to sum to 100%
  const adjustSettlerRatio = (role, value) => {
    const num = parseInt(value);
    const remainder = 100 - num;

    if (role === 'carrier') {
      setCarrierRatio(num);
      // Split remainder: 60% diggers, 40% builders
      const digger = Math.round(remainder * 0.6);
      setDiggerRatio(digger);
      setBuilderRatio(remainder - digger);
    } else if (role === 'digger') {
      setDiggerRatio(num);
      // Split remainder: 70% carriers, 30% builders
      const carrier = Math.round(remainder * 0.7);
      setCarrierRatio(carrier);
      setBuilderRatio(remainder - carrier);
    } else if (role === 'builder') {
      setBuilderRatio(num);
      // Split remainder: 60% carriers, 40% diggers
      const carrier = Math.round(remainder * 0.6);
      setCarrierRatio(carrier);
      setDiggerRatio(remainder - carrier);
    }
  };

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', overflow: 'hidden' }}>
      
      {/* 1. Fully Fullscreen GPU Game Viewport Canvas */}
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 }} />

      {/* 2. Top resource bar (HUD) */}
      <div className={`glass-panel ${getFactionSkinClass()}`} style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: '48px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 20px',
        borderBottom: '2px solid rgba(255,255,255,0.08)',
        zIndex: 10
      }}>
        {/* Left Side: Logo & Dynamic Faction Status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <span style={{ fontSize: '20px', fontWeight: 800, fontFamily: 'Outfit', letterSpacing: '0.05em', background: 'linear-gradient(to right, #ffd700, #ff8c00)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            DAWNHOLD
          </span>
          <div style={{ fontSize: '12px', background: 'rgba(255,255,255,0.1)', padding: '2px 8px', borderRadius: '4px', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.05em', color: 'var(--accent-color)' }}>
            Faction: {selectedFaction === 'solari' ? 'Solari Empire' : selectedFaction === 'njordic' ? 'Njordic Clans' : selectedFaction === 'zapotec' ? 'Zapotec Tribelands' : 'The Voidborn'}
          </div>
          <div style={{ fontSize: '12px', color: '#a0aec0', fontFamily: 'monospace' }}>
            Tick: {gameTickCount} (10 Hz)
          </div>
        </div>

        {/* Center Section: Classic Economy Resource Counters */}
        <div style={{ display: 'flex', gap: '20px', fontSize: '13px', fontWeight: 600, fontFamily: 'Outfit' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>🪵 <span style={{ color: '#e2e8f0' }}>Wood: 45</span></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>🪨 <span style={{ color: '#e2e8f0' }}>Stone: 28</span></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>🥖 <span style={{ color: '#e2e8f0' }}>Bread: 12</span></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>🥩 <span style={{ color: '#e2e8f0' }}>Meat: 8</span></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>🐟 <span style={{ color: '#e2e8f0' }}>Fish: 15</span></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>🌑 <span style={{ color: '#cbd5e0' }}>Coal: 18</span></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>🪙 <span style={{ color: '#ffd700' }}>Gold: 5</span></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>⚔️ <span style={{ color: '#e53e3e' }}>Soldiers: 24</span></div>
        </div>

        {/* Right Section: Population counters and audio toggles */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '13px', color: '#cbd5e0' }}>
            <Users size={16} />
            <span>Settlers: 52 / 100</span>
          </div>
          <button 
            onClick={() => setMuteAudio(!muteAudio)} 
            style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
          >
            {muteAudio ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
        </div>
      </div>

      {/* 3. Classic Left Sidebar (Control Center) */}
      <div className={`glass-panel ${getFactionSkinClass()}`} style={{
        position: 'absolute',
        top: '60px',
        left: '12px',
        bottom: '12px',
        width: '280px',
        borderRadius: 'var(--border-radius-lg)',
        display: 'flex',
        flexDirection: 'column',
        padding: '15px',
        gap: '15px',
        zIndex: 10
      }}>
        
        {/* Sidebar Header: Circular category navigation tabs */}
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 5px' }}>
          <button 
            className="btn-circle" 
            onClick={() => setActiveTab('build')}
            style={{ filter: activeTab === 'build' ? 'brightness(1.2) drop-shadow(0 0 6px #ffd700)' : 'none' }}
            title="Construction Tab"
          >
            <Hammer size={20} />
          </button>
          <button 
            className="btn-circle" 
            onClick={() => setActiveTab('settlers')}
            style={{ filter: activeTab === 'settlers' ? 'brightness(1.2) drop-shadow(0 0 6px #ffd700)' : 'none' }}
            title="Settlers Distribution"
          >
            <Users size={20} />
          </button>
          <button 
            className="btn-circle" 
            onClick={() => setActiveTab('economy')}
            style={{ filter: activeTab === 'economy' ? 'brightness(1.2) drop-shadow(0 0 6px #ffd700)' : 'none' }}
            title="Economic Priorities"
          >
            <TrendingUp size={20} />
          </button>
          <button 
            className="btn-circle" 
            onClick={() => setActiveTab('military')}
            style={{ filter: activeTab === 'military' ? 'brightness(1.2) drop-shadow(0 0 6px #ffd700)' : 'none' }}
            title="Military & Magic"
          >
            <ShieldAlert size={20} />
          </button>
        </div>

        {/* Sidebar Content Area (Parchment Scroll Panel) */}
        <div className="parchment-scroll" style={{ flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          
          {/* Tab 1: Construction Catalog */}
          {activeTab === 'build' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {/* Build Categories */}
              <div style={{ display: 'flex', gap: '5px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' }}>
                <span onClick={() => setBuildSubCategory('basic')} style={{ cursor: 'pointer', padding: '3px 6px', background: buildSubCategory === 'basic' ? 'var(--primary-color)' : 'rgba(0,0,0,0.15)', borderRadius: '4px', color: buildSubCategory === 'basic' ? '#fff' : '#2b1f15' }}>Base</span>
                <span onClick={() => setBuildSubCategory('food')} style={{ cursor: 'pointer', padding: '3px 6px', background: buildSubCategory === 'food' ? 'var(--primary-color)' : 'rgba(0,0,0,0.15)', borderRadius: '4px', color: buildSubCategory === 'food' ? '#fff' : '#2b1f15' }}>Food</span>
                <span onClick={() => setBuildSubCategory('mining')} style={{ cursor: 'pointer', padding: '3px 6px', background: buildSubCategory === 'mining' ? 'var(--primary-color)' : 'rgba(0,0,0,0.15)', borderRadius: '4px', color: buildSubCategory === 'mining' ? '#fff' : '#2b1f15' }}>Mine</span>
                <span onClick={() => setBuildSubCategory('defense')} style={{ cursor: 'pointer', padding: '3px 6px', background: buildSubCategory === 'defense' ? 'var(--primary-color)' : 'rgba(0,0,0,0.15)', borderRadius: '4px', color: buildSubCategory === 'defense' ? '#fff' : '#2b1f15' }}>Def</span>
              </div>

              {/* Nested Building Cards */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '5px' }}>
                {buildSubCategory === 'basic' && (
                  <>
                    <button className="faction-btn btn-primary" onClick={() => handlePlacementCommand('Woodcutter')} style={{ textAlign: 'left', display: 'flex', justifyContent: 'space-between' }}>
                      <span>🪓 Woodcutter Hut</span>
                      <span style={{ color: '#ffd700' }}>Log</span>
                    </button>
                    <button className="faction-btn btn-primary" onClick={() => handlePlacementCommand('Sawmill')} style={{ textAlign: 'left', display: 'flex', justifyContent: 'space-between' }}>
                      <span>🪵 Sawmill</span>
                      <span style={{ color: '#ffd700' }}>Plank</span>
                    </button>
                    <button className="faction-btn btn-primary" onClick={() => handlePlacementCommand('Stonecutter')} style={{ textAlign: 'left', display: 'flex', justifyContent: 'space-between' }}>
                      <span>🪨 Stonecutter Quarry</span>
                      <span style={{ color: '#ffd700' }}>Stone</span>
                    </button>
                    <button className="faction-btn btn-primary" onClick={() => handlePlacementCommand('Residence')} style={{ textAlign: 'left', display: 'flex', justifyContent: 'space-between' }}>
                      <span>🏠 Small Residence</span>
                      <span style={{ color: '#ffd700' }}>Pop</span>
                    </button>
                  </>
                )}

                {buildSubCategory === 'food' && (
                  <>
                    <button className="faction-btn btn-primary" onClick={() => handlePlacementCommand('Grain Farm')} style={{ textAlign: 'left' }}>🌾 Grain Farm</button>
                    <button className="faction-btn btn-primary" onClick={() => handlePlacementCommand('Grain Mill')} style={{ textAlign: 'left' }}>💨 Grain Mill</button>
                    <button className="faction-btn btn-primary" onClick={() => handlePlacementCommand('Bakery')} style={{ textAlign: 'left' }}>🥖 Bakery (Bread)</button>
                    <button className="faction-btn btn-primary" onClick={() => handlePlacementCommand('Pig Farm')} style={{ textAlign: 'left' }}>🐖 Pig Farm</button>
                    <button className="faction-btn btn-primary" onClick={() => handlePlacementCommand('Slaughterhouse')} style={{ textAlign: 'left' }}>🥩 Slaughterhouse</button>
                  </>
                )}

                {buildSubCategory === 'mining' && (
                  <>
                    <button className="faction-btn btn-primary" onClick={() => handlePlacementCommand('Coal Mine')} style={{ textAlign: 'left' }}>🌑 Coal Mine</button>
                    <button className="faction-btn btn-primary" onClick={() => handlePlacementCommand('Iron Mine')} style={{ textAlign: 'left' }}>⛓️ Iron Mine</button>
                    <button className="faction-btn btn-primary" onClick={() => handlePlacementCommand('Gold Smelter')} style={{ textAlign: 'left' }}>🪙 Gold Smelter</button>
                    <button className="faction-btn btn-primary" onClick={() => handlePlacementCommand('Weapon Smithy')} style={{ textAlign: 'left' }}>⚔️ Weapon Smithy</button>
                  </>
                )}

                {buildSubCategory === 'defense' && (
                  <>
                    <button className="faction-btn btn-primary" onClick={() => handlePlacementCommand('Sentry Tower')} style={{ textAlign: 'left' }}>🏹 Sentry Tower</button>
                    <button className="faction-btn btn-primary" onClick={() => handlePlacementCommand('Barracks')} style={{ textAlign: 'left' }}>🛡️ Barracks</button>
                    <button className="faction-btn btn-primary" onClick={() => handlePlacementCommand('Stone Temple')} style={{ textAlign: 'left' }}>🔮 Stone Temple</button>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Tab 2: Settler Occupational Status (S4-Style Balanced Allocation) */}
          {activeTab === 'settlers' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div className="hud-label" style={{ borderBottom: '1.5px solid var(--parchment-dark)', paddingBottom: '5px', color: '#5c402d', textShadow: 'none' }}>
                Arbetarfördelning (Totalt: 52)
              </div>
              
              {/* Carriers Slider */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ display: 'flex', justifySelf: 'stretch', justifyContent: 'space-between', fontSize: '11px', fontWeight: 700, color: '#3d2716' }}>
                  <span>📦 Bärare (Carriers)</span>
                  <span style={{ color: '#b22222', fontWeight: 800 }}>{carrierRatio}%</span>
                </div>
                <input 
                  type="range" min="0" max="100" value={carrierRatio}
                  onChange={(e) => adjustSettlerRatio('carrier', e.target.value)}
                  style={{ width: '100%' }}
                />
              </div>

              {/* Diggers Slider */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ display: 'flex', justifySelf: 'stretch', justifyContent: 'space-between', fontSize: '11px', fontWeight: 700, color: '#3d2716' }}>
                  <span>⛏️ Grävare (Diggers)</span>
                  <span style={{ color: '#b22222', fontWeight: 800 }}>{diggerRatio}%</span>
                </div>
                <input 
                  type="range" min="0" max="100" value={diggerRatio}
                  onChange={(e) => adjustSettlerRatio('digger', e.target.value)}
                  style={{ width: '100%' }}
                />
              </div>

              {/* Builders Slider */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ display: 'flex', justifySelf: 'stretch', justifyContent: 'space-between', fontSize: '11px', fontWeight: 700, color: '#3d2716' }}>
                  <span>🔨 Byggare (Builders)</span>
                  <span style={{ color: '#b22222', fontWeight: 800 }}>{builderRatio}%</span>
                </div>
                <input 
                  type="range" min="0" max="100" value={builderRatio}
                  onChange={(e) => adjustSettlerRatio('builder', e.target.value)}
                  style={{ width: '100%' }}
                />
              </div>

              <div className="hud-label" style={{ borderBottom: '1.5px solid var(--parchment-dark)', paddingBottom: '3px', marginTop: '5px', color: '#5c402d', textShadow: 'none' }}>
                Yrkesroller & Specialister
              </div>

              {/* Geologist auto search checkbox */}
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', cursor: 'pointer', color: '#2b1f15', fontWeight: 600 }}>
                <input 
                  type="checkbox" checked={autoGeologist} 
                  onChange={() => setAutoGeologist(!autoGeologist)}
                />
                <span>🔎 Geologer letar malm</span>
              </label>

              {/* Pioneer Recruitment */}
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', cursor: 'pointer', color: '#2b1f15', fontWeight: 600 }}>
                <input type="checkbox" />
                <span>🚩 Rekrytera Pionjärer</span>
              </label>

              <div style={{ marginTop: '5px', fontSize: '10px', color: '#5c402d', fontStyle: 'italic', lineHeight: '1.2' }}>
                💡 Sliders balanserar automatiskt. Arbetare rekryteras automatiskt till roller utifrån lediga gubbar.
              </div>
            </div>
          )}

          {/* Tab 3: Economy Sliders & Interactive Tool Queue */}
          {activeTab === 'economy' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {/* Economy sub-tabs navigation */}
              <div style={{ display: 'flex', gap: '4px', borderBottom: '1.5px solid var(--parchment-dark)', paddingBottom: '5px' }}>
                <button 
                  onClick={() => setEconomySubTab('goods')}
                  className="faction-btn btn-primary"
                  style={{ flex: 1, fontSize: '10px', padding: '4px', border: 'none', borderRadius: '4px', fontWeight: 700, cursor: 'pointer' }}
                >
                  📦 Varor
                </button>
                <button 
                  onClick={() => setEconomySubTab('tools')}
                  className="faction-btn btn-primary"
                  style={{ flex: 1, fontSize: '10px', padding: '4px', border: 'none', borderRadius: '4px', fontWeight: 700, cursor: 'pointer' }}
                >
                  🔨 Verktygsprioritet
                </button>
              </div>

              {economySubTab === 'goods' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {/* Wood allocation */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#2b1f15', fontWeight: 600 }}>
                      <span>🪵 Trä: Sågverk ({woodToSawmill}%)</span>
                    </div>
                    <input 
                      type="range" min="0" max="100" value={woodToSawmill} 
                      onChange={(e) => {
                        const sawmill = parseInt(e.target.value);
                        setWoodToSawmill(sawmill);
                        setWoodToShipyard(100 - sawmill);
                      }}
                      style={{ width: '100%' }}
                    />
                  </div>

                  {/* Coal allocation */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#2b1f15', fontWeight: 600 }}>
                      <span>🌑 Kol: Järnsmälta ({coalToIron}%)</span>
                    </div>
                    <input 
                      type="range" min="0" max="100" value={coalToIron} 
                      onChange={(e) => {
                        const iron = parseInt(e.target.value);
                        setCoalToIron(iron);
                        setCoalToGold(100 - iron);
                      }}
                      style={{ width: '100%' }}
                    />
                  </div>

                  {/* Grain allocation */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#2b1f15', fontWeight: 600 }}>
                      <span>🌾 Säd: Bageri ({grainToBakery}%)</span>
                    </div>
                    <input 
                      type="range" min="0" max="100" value={grainToBakery} 
                      onChange={(e) => {
                        const bakery = parseInt(e.target.value);
                        setGrainToBakery(bakery);
                        setGrainToPigs(100 - bakery);
                      }}
                      style={{ width: '100%' }}
                    />
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ fontSize: '11px', color: '#5c402d', fontStyle: 'italic', marginBottom: '2px' }}>
                    Sortera listan för tillverkning:
                  </div>
                  {toolQueue.map((tool, idx) => (
                    <div key={tool.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(0,0,0,0.06)', padding: '6px 10px', borderRadius: '4px', fontSize: '12px', color: '#2b1f15' }}>
                      <span style={{ fontWeight: 700 }}>{tool.name}</span>
                      
                      {/* Priority Controls */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {/* Up / Down arrows */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                          <button 
                            onClick={() => moveToolInQueue(idx, -1)} 
                            disabled={idx === 0}
                            style={{ background: 'none', border: 'none', color: '#2b1f15', cursor: idx === 0 ? 'not-allowed' : 'pointer', fontSize: '9px', opacity: idx === 0 ? 0.3 : 0.8 }}
                          >
                            ▲
                          </button>
                          <button 
                            onClick={() => moveToolInQueue(idx, 1)} 
                            disabled={idx === toolQueue.length - 1}
                            style={{ background: 'none', border: 'none', color: '#2b1f15', cursor: idx === toolQueue.length - 1 ? 'not-allowed' : 'pointer', fontSize: '9px', opacity: idx === toolQueue.length - 1 ? 0.3 : 0.8 }}
                          >
                            ▼
                          </button>
                        </div>
                        
                        {/* Cap quota controls */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'rgba(0,0,0,0.1)', padding: '2px 6px', borderRadius: '4px' }}>
                          <button onClick={() => adjustToolCount(idx, -1)} style={{ background: 'none', border: 'none', color: '#2b1f15', cursor: 'pointer', fontWeight: 'bold' }}>-</button>
                          <span style={{ minWidth: '12px', textAlign: 'center', fontWeight: 'bold', color: '#b22222' }}>{tool.count}</span>
                          <button onClick={() => adjustToolCount(idx, 1)} style={{ background: 'none', border: 'none', color: '#2b1f15', cursor: 'pointer', fontWeight: 'bold' }}>+</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Tab 4: Faction Selection Skin Switcher, Barracks, & Magic Spells */}
          {activeTab === 'military' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              
              {/* Military Sub-tabs navigation */}
              <div style={{ display: 'flex', gap: '4px', borderBottom: '1.5px solid var(--parchment-dark)', paddingBottom: '5px' }}>
                <button 
                  onClick={() => setMilitarySubTab('recruits')}
                  className="faction-btn btn-primary"
                  style={{ flex: 1, fontSize: '10px', padding: '4px', border: 'none', borderRadius: '4px', fontWeight: 700, cursor: 'pointer' }}
                >
                  ⚔️ Rekrytering
                </button>
                <button 
                  onClick={() => setMilitarySubTab('spells')}
                  className="faction-btn btn-primary"
                  style={{ flex: 1, fontSize: '10px', padding: '4px', border: 'none', borderRadius: '4px', fontWeight: 700, cursor: 'pointer' }}
                >
                  🔮 Magi & Spells
                </button>
              </div>

              {militarySubTab === 'recruits' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {/* Combat Power (Kampkraft) based on gold bars */}
                  <div style={{ background: 'rgba(178,34,34,0.08)', border: '1px solid rgba(178,34,34,0.3)', padding: '8px', borderRadius: '6px', textAlign: 'center' }}>
                    <div style={{ fontSize: '10px', textTransform: 'uppercase', color: '#b22222', fontWeight: 750 }}>⚔️ Arméns Kampkraft (Combat Power)</div>
                    <div style={{ fontSize: '20px', fontWeight: 800, color: '#2b1f15', fontFamily: 'Outfit' }}>115%</div>
                    <div style={{ fontSize: '9px', color: '#5c402d', fontStyle: 'italic', marginTop: '2px' }}>🛡️ +15% från 5 guld i skattkammaren</div>
                  </div>

                  {/* Auto recruit barracks toggle */}
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', cursor: 'pointer', marginTop: '2px', color: '#2b1f15', fontWeight: 600 }}>
                    <input 
                      type="checkbox" checked={autoRecruit} 
                      onChange={() => setAutoRecruit(!autoRecruit)}
                    />
                    <span>🛡️ Automatisk rekrytering</span>
                  </label>

                  {/* Swordsman recruit ratio */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#2b1f15', fontWeight: 600 }}>
                      <span>🗡️ Svärdskämpar: {swordsmanRatio}%</span>
                    </div>
                    <input 
                      type="range" min="0" max="100" value={swordsmanRatio} 
                      onChange={(e) => {
                        const swords = parseInt(e.target.value);
                        setSwordsmanRatio(swords);
                        const rem = 100 - swords;
                        const bow = Math.round(rem * 0.75);
                        setBowmanRatio(bow);
                        setMedicRatio(rem - bow);
                      }}
                      style={{ width: '100%' }}
                    />
                  </div>

                  {/* Bowman recruit ratio */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#2b1f15', fontWeight: 600 }}>
                      <span>🏹 Bågskyttar: {bowmanRatio}%</span>
                    </div>
                    <input 
                      type="range" min="0" max="100" value={bowmanRatio} 
                      onChange={(e) => {
                        const bow = parseInt(e.target.value);
                        setBowmanRatio(bow);
                        const rem = 100 - bow;
                        const swords = Math.round(rem * 0.8);
                        setSwordsmanRatio(swords);
                        setMedicRatio(rem - swords);
                      }}
                      style={{ width: '100%' }}
                    />
                  </div>

                  {/* Faction selector UI switcher */}
                  <div className="hud-label" style={{ borderBottom: '1.5px solid var(--parchment-dark)', paddingBottom: '3px', marginTop: '5px', color: '#5c402d', textShadow: 'none' }}>
                    Byt Factions UI Skin
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                    <button className="faction-btn btn-primary" onClick={() => setSelectedFaction('solari')} style={{ fontSize: '9px', padding: '6px', borderWidth: selectedFaction === 'solari' ? '2.5px' : '1px' }}>🏛️ Solari</button>
                    <button className="faction-btn btn-primary" onClick={() => setSelectedFaction('njordic')} style={{ fontSize: '9px', padding: '6px', borderWidth: selectedFaction === 'njordic' ? '2.5px' : '1px' }}>🪓 Njordic</button>
                    <button className="faction-btn btn-primary" onClick={() => setSelectedFaction('zapotec')} style={{ fontSize: '9px', padding: '6px', borderWidth: selectedFaction === 'zapotec' ? '2.5px' : '1px' }}>🐍 Zapotec</button>
                    <button className="faction-btn btn-primary" onClick={() => setSelectedFaction('voidborn')} style={{ fontSize: '9px', padding: '6px', borderWidth: selectedFaction === 'voidborn' ? '2.5px' : '1px' }}>🔮 Voidborn</button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ fontSize: '11px', color: '#5c402d', fontStyle: 'italic' }}>
                    Prästernas formler drivs av guldgåvor i Templen. Mana: 45%.
                  </div>
                  
                  {/* Dynamic magical spells list based on the chosen original faction! */}
                  {selectedFaction === 'solari' && (
                    <>
                      <button className="faction-btn btn-primary" style={{ fontSize: '11px', textAlign: 'left', display: 'flex', justifyContent: 'space-between' }}>
                        <span>🌻 Aureons sken (Hela mark)</span>
                        <span style={{ color: '#ffd700' }}>10% mana</span>
                      </button>
                      <button className="faction-btn btn-primary" style={{ fontSize: '11px', textAlign: 'left', display: 'flex', justifyContent: 'space-between' }}>
                        <span>🪙 Aureum Forge (Sten till guld)</span>
                        <span style={{ color: '#ffd700' }}>30% mana</span>
                      </button>
                      <button className="faction-btn btn-primary" style={{ fontSize: '11px', textAlign: 'left', display: 'flex', justifyContent: 'space-between' }}>
                        <span>🌳 Soltillväxt (Skogsanrop)</span>
                        <span style={{ color: '#ffd700' }}>20% mana</span>
                      </button>
                    </>
                  )}

                  {selectedFaction === 'njordic' && (
                    <>
                      <button className="faction-btn btn-primary" style={{ fontSize: '11px', textAlign: 'left', display: 'flex', justifyContent: 'space-between' }}>
                        <span>⚡ Aegirs storm (Skada fiender)</span>
                        <span style={{ color: '#ffd700' }}>25% mana</span>
                      </button>
                      <button className="faction-btn btn-primary" style={{ fontSize: '11px', textAlign: 'left', display: 'flex', justifyContent: 'space-between' }}>
                        <span>🪓 Yggdrasils gåva (Kalla vedhuggare)</span>
                        <span style={{ color: '#ffd700' }}>15% mana</span>
                      </button>
                      <button className="faction-btn btn-primary" style={{ fontSize: '11px', textAlign: 'left', display: 'flex', justifyContent: 'space-between' }}>
                        <span>🐟 Aegirs skörd (Skapa fiskar)</span>
                        <span style={{ color: '#ffd700' }}>20% mana</span>
                      </button>
                    </>
                  )}

                  {selectedFaction === 'zapotec' && (
                    <>
                      <button className="faction-btn btn-primary" style={{ fontSize: '11px', textAlign: 'left', display: 'flex', justifyContent: 'space-between' }}>
                        <span>🌾 Kukulkans sång (Skörda säd)</span>
                        <span style={{ color: '#ffd700' }}>15% mana</span>
                      </button>
                      <button className="faction-btn btn-primary" style={{ fontSize: '11px', textAlign: 'left', display: 'flex', justifyContent: 'space-between' }}>
                        <span>💥 Tektoniskt gap (Jordbävning)</span>
                        <span style={{ color: '#ffd700' }}>40% mana</span>
                      </button>
                      <button className="faction-btn btn-primary" style={{ fontSize: '11px', textAlign: 'left', display: 'flex', justifyContent: 'space-between' }}>
                        <span>🍃 Andens slöja (Dimmans sköld)</span>
                        <span style={{ color: '#ffd700' }}>20% mana</span>
                      </button>
                    </>
                  )}

                  {selectedFaction === 'voidborn' && (
                    <>
                      <button className="faction-btn btn-primary" style={{ fontSize: '11px', textAlign: 'left', display: 'flex', justifyContent: 'space-between' }}>
                        <span>🥀 Nihil Sunder (Skapa ödemark)</span>
                        <span style={{ color: '#ffd700' }}>10% mana</span>
                      </button>
                      <button className="faction-btn btn-primary" style={{ fontSize: '11px', textAlign: 'left', display: 'flex', justifyContent: 'space-between' }}>
                        <span>🕷️ Chitin Spawn (Kalla monster)</span>
                        <span style={{ color: '#ffd700' }}>35% mana</span>
                      </button>
                      <button className="faction-btn btn-primary" style={{ fontSize: '11px', textAlign: 'left', display: 'flex', justifyContent: 'space-between' }}>
                        <span>🌀 Void Slip (Teleportera enhet)</span>
                        <span style={{ color: '#ffd700' }}>50% mana</span>
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

        </div>

        {/* Selected Entity Inspector Panel */}
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '10px' }}>
          {activeBuildingInfo ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px' }}>
              <div className="hud-label" style={{ color: 'var(--accent-color)' }}>🛠️ Under konstruktion</div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Typ: {activeBuildingInfo.name}</span>
                <span>Effektivitet: {activeBuildingInfo.productivity}%</span>
              </div>
              <div>Position: X: {activeBuildingInfo.x}, Y: {activeBuildingInfo.y}</div>
              <div style={{ height: '6px', background: 'rgba(255,255,255,0.1)', borderRadius: '3px', marginTop: '5px', overflow: 'hidden' }}>
                <div style={{ width: '35%', height: '100%', background: 'linear-gradient(to right, #38b2ac, #319795)' }}></div>
              </div>
            </div>
          ) : (
            <div style={{ fontSize: '11px', color: '#a0aec0', fontStyle: 'italic', textAlign: 'center' }}>
              Välj en byggnad eller settler på kartan för att inspektera.
            </div>
          )}
        </div>

        {/* Bottom Circular Minimap Panel */}
        <div style={{ height: '120px', width: '100%', position: 'relative', overflow: 'hidden', borderRadius: 'var(--border-radius-md)', border: '1px solid rgba(255,255,255,0.1)' }}>
          {/* Styled Minimap graphic representation */}
          <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', background: 'radial-gradient(circle, #2e8b57 60%, #1a202c 95%)', opacity: 0.85 }} />
          
          <div style={{ position: 'absolute', top: '45px', left: '105px', width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#fff', boxShadow: '0 0 10px #fff' }} title="Camera center" />
          
          {/* Mock dots of settlers moving */}
          <div style={{ position: 'absolute', top: '35px', left: '85px', width: '4px', height: '4px', borderRadius: '50%', backgroundColor: 'var(--accent-color)' }} />
          <div style={{ position: 'absolute', top: '65px', left: '120px', width: '4px', height: '4px', borderRadius: '50%', backgroundColor: 'var(--accent-color)' }} />
          <div style={{ position: 'absolute', top: '55px', left: '145px', width: '4px', height: '4px', borderRadius: '50%', backgroundColor: 'var(--accent-color)' }} />

          <div style={{ position: 'absolute', bottom: '4px', left: '4px', fontSize: '9px', fontWeight: 600, color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            🗺️ Mini-Map (128x128)
          </div>
        </div>

      </div>

      {/* 4. Spatial sound effects controller panel overlay */}
      <div className={`glass-panel ${getFactionSkinClass()}`} style={{
        position: 'absolute',
        bottom: '12px',
        right: '12px',
        padding: '10px 15px',
        borderRadius: 'var(--border-radius-md)',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        fontSize: '11px',
        zIndex: 10
      }}>
        <Flame size={14} style={{ color: 'var(--accent-color)', animation: 'pulseGlow 2s infinite' }} />
        <span>GPU Acceleration Active (WebGPU)</span>
      </div>

    </div>
  );
}
