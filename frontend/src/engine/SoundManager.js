import { Howl, Howler } from 'howler';

class SoundManager {
  constructor() {
    this.musicTracks = {};
    this.currentMusicState = 'settle'; // 'settle', 'combat', 'sea'
    this.currentFaction = null;
    this.mute = false;
    this.cameraX = 0;
    this.cameraY = 0;
    this.cameraZoom = 1.0;
  }

  // 1. Initialize music for a specific faction with dynamic stems/tracks
  initMusic(faction) {
    if (this.currentFaction === faction) return;
    this.stopAllMusic();
    this.currentFaction = faction;

    console.log(`🎵 SoundManager: Initializing music stems for faction: ${faction}`);

    // Standard high-quality symphonic themes matching the classic strategy faction vibe
    // Stems are initially started in a synchronized loop
    this.musicTracks.settle = new Howl({
      src: [`/audio/music/${faction}_settle.mp3`],
      loop: true,
      volume: this.mute ? 0.0 : 0.45,
      autoplay: false
    });

    this.musicTracks.combat = new Howl({
      src: [`/audio/music/${faction}_fight.mp3`],
      loop: true,
      volume: 0.0,
      autoplay: false
    });

    // Start all tracks simultaneously so they run in lockstep for seamless crossfading
    try {
      this.musicTracks.settle.play();
      this.musicTracks.combat.play();
    } catch (e) {
      console.warn('🎵 SoundManager: Autoplay blocked or audio assets not yet populated.', e);
    }
  }

  stopAllMusic() {
    Object.values(this.musicTracks).forEach(track => {
      if (track) {
        track.stop();
        track.unload();
      }
    });
    this.musicTracks = {};
  }

  // 2. Crossfade smoothly between peaceful building and high-tension combat music
  transitionTo(state) {
    if (this.currentMusicState === state) return;
    if (!this.musicTracks.settle || !this.musicTracks.combat) return;

    console.log(`🎵 SoundManager: Crossfading soundtrack to state: ${state}`);
    const fadeDuration = 2000; // 2 seconds high-fidelity crossfade matching classic strategy games
    
    const fromTrack = this.musicTracks[this.currentMusicState];
    const toTrack = this.musicTracks[state];

    if (fromTrack && toTrack) {
      const currentFromVol = fromTrack.volume();
      fromTrack.fade(currentFromVol, 0.0, fadeDuration);
      
      const targetVol = this.mute ? 0.0 : 0.45;
      toTrack.fade(0.0, targetVol, fadeDuration);
      
      this.currentMusicState = state;
    }
  }

  // Update central viewport camera coordinates for spatial sound calculations
  updateCameraState(x, y, zoom) {
    this.cameraX = x;
    this.cameraY = y;
    this.cameraZoom = zoom;
  }

  // 3. Play a fully spatiered 3D stereo sound effect (axe chops, smithy hammers, geologists jumping)
  playSpatialEffect(effectName, gridX, gridY, customMaxDistance = 1200) {
    if (this.mute) return;

    // Project grid coordinates to isometric pixels to calculate screen distances
    const TILE_WIDTH = 64;
    const TILE_HEIGHT = 32;
    const screenX = (gridX - gridY) * (TILE_WIDTH / 2);
    const screenY = (gridX + gridY) * (TILE_HEIGHT / 2);

    // Calculate relative delta distance from the camera viewport center
    const dx = screenX - this.cameraX;
    const dy = screenY - this.cameraY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance > customMaxDistance) return; // Completely out of spatial range

    // Volume Attenuation: Closer sounds are louder.
    // Attenuation falls off linearly to the boundary edge
    let volume = Math.max(0, 1 - (distance / customMaxDistance));
    
    // Zoom Attenuation: Zooming out makes the environment quieter
    volume *= Math.max(0.3, this.cameraZoom); 
    
    // Global clamp
    volume = Math.min(0.8, volume * 0.7);

    // Stereo Pan: -1.0 (Full Left) to 1.0 (Full Right)
    // Map the horizontal delta distance. If it is 400px to the left, it pans full left.
    const pan = Math.min(1.0, Math.max(-1.0, dx / 500));

    const sound = new Howl({
      src: [`/audio/effects/${effectName}.mp3`, `/audio/effects/${effectName}.ogg`],
      volume: volume,
      onloaderror: () => {},
      onplayerror: () => {}
    });

    const soundId = sound.play();
    sound.stereo(pan, soundId);
  }

  // 4. Mute / Unmute controls tied directly to React HUD
  setMute(isMuted) {
    this.mute = isMuted;
    Howler.mute(isMuted);
    console.log(`🎵 SoundManager: Muted state set to: ${isMuted}`);
  }
}

export const soundManager = new SoundManager();
