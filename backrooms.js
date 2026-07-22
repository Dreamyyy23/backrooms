// Backrooms state, soundscape, and signal engine.
// Audio is generated in-browser so the game remains a self-contained static site.

let audioCtx = null;
let masterGain = null;
let ambienceGain = null;
let sfxGain = null;
let heartbeatGain = null;
let reverbGain = null;
let humOsc = null;
let humOsc2 = null;
let humGain = null;
let filterNode = null;
let audioGraphStarted = false;
let audioUnlocked = false;
let audioUnlockPromise = null;
let ambientBaseGain = 0.03;
let heartbeatTimer = null;
let anomalyTimer = null;
let audioMuted = sessionStorage.getItem('backrooms_audio_muted') === 'true';

const AUDIO_PROFILES = {
  yellow:    { roots: [58.27, 116.54], types: ['triangle', 'sine'], filter: 'lowpass', cutoff: 420, q: 0.8, hum: 0.032, air: 0.015, wobble: 0.31 },
  corridor:  { roots: [54.1, 108.2],   types: ['sawtooth', 'sine'], filter: 'lowpass', cutoff: 360, q: 1.1, hum: 0.027, air: 0.018, wobble: 0.43 },
  stairwell: { roots: [41.2, 82.4],    types: ['sine', 'triangle'], filter: 'lowpass', cutoff: 210, q: 1.5, hum: 0.046, air: 0.011, wobble: 0.19 },
  vent:      { roots: [96, 192],        types: ['sawtooth', 'sine'], filter: 'bandpass', cutoff: 980, q: 7, hum: 0.018, air: 0.036, wobble: 0.57 },
  office:    { roots: [49.7, 99.4],     types: ['square', 'sine'], filter: 'lowpass', cutoff: 510, q: 2.2, hum: 0.022, air: 0.013, wobble: 0.24 },
  nexus:     { roots: [73.42, 146.84],  types: ['sine', 'triangle'], filter: 'lowpass', cutoff: 860, q: 1.8, hum: 0.026, air: 0.009, wobble: 0.16 },
  ending:    { roots: [55, 82.5],       types: ['sine', 'sine'], filter: 'lowpass', cutoff: 1200, q: 0.7, hum: 0.024, air: 0.007, wobble: 0.11 }
};

function audioProfileName() {
  const page = window.location.pathname.split('/').pop() || 'index.html';
  if (page === 'signal-ending.html') return 'ending';
  if (page === 'legend-nexus.html') return 'nexus';
  if (page.startsWith('office')) return 'office';
  if (page.startsWith('vent')) return 'vent';
  if (page.startsWith('stairwell')) return 'stairwell';
  if (page.startsWith('hallway')) return 'corridor';
  return 'yellow';
}

function createAudioContextIfNeeded() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    audioCtx = new AudioContextClass({ latencyHint: 'interactive' });
  }
  if (!masterGain) buildAudioMixer();
  return audioCtx;
}

function buildAudioMixer() {
  const now = audioCtx.currentTime;
  masterGain = audioCtx.createGain();
  ambienceGain = audioCtx.createGain();
  sfxGain = audioCtx.createGain();
  heartbeatGain = audioCtx.createGain();
  reverbGain = audioCtx.createGain();
  const compressor = audioCtx.createDynamicsCompressor();
  const convolver = audioCtx.createConvolver();

  masterGain.gain.setValueAtTime(0.0001, now);
  ambienceGain.gain.setValueAtTime(0.72, now);
  sfxGain.gain.setValueAtTime(0.78, now);
  heartbeatGain.gain.setValueAtTime(0.7, now);
  reverbGain.gain.setValueAtTime(0.18, now);
  compressor.threshold.setValueAtTime(-18, now);
  compressor.knee.setValueAtTime(18, now);
  compressor.ratio.setValueAtTime(6, now);
  compressor.attack.setValueAtTime(0.004, now);
  compressor.release.setValueAtTime(0.18, now);

  const impulseLength = Math.floor(audioCtx.sampleRate * 1.25);
  const impulse = audioCtx.createBuffer(2, impulseLength, audioCtx.sampleRate);
  for (let channel = 0; channel < impulse.numberOfChannels; channel++) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < impulseLength; i++) {
      const decay = Math.pow(1 - i / impulseLength, 2.8);
      data[i] = (Math.random() * 2 - 1) * decay;
    }
  }
  convolver.buffer = impulse;

  ambienceGain.connect(masterGain);
  sfxGain.connect(masterGain);
  sfxGain.connect(convolver);
  heartbeatGain.connect(masterGain);
  convolver.connect(reverbGain);
  reverbGain.connect(masterGain);
  masterGain.connect(compressor);
  compressor.connect(audioCtx.destination);
}

function createNoiseBuffer(seconds = 2) {
  const length = Math.floor(audioCtx.sampleRate * seconds);
  const buffer = audioCtx.createBuffer(1, length, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    last = last * 0.985 + white * 0.015;
    data[i] = white * 0.42 + last * 0.58;
  }
  return buffer;
}

function startAmbientSoundscape() {
  if (audioGraphStarted || !audioCtx) return;
  const profile = AUDIO_PROFILES[audioProfileName()];
  const now = audioCtx.currentTime;
  ambientBaseGain = profile.hum;

  humOsc = audioCtx.createOscillator();
  humOsc2 = audioCtx.createOscillator();
  humGain = audioCtx.createGain();
  filterNode = audioCtx.createBiquadFilter();
  const airSource = audioCtx.createBufferSource();
  const airFilter = audioCtx.createBiquadFilter();
  const airGain = audioCtx.createGain();
  const lfo = audioCtx.createOscillator();
  const lfoGain = audioCtx.createGain();

  humOsc.type = profile.types[0];
  humOsc2.type = profile.types[1];
  humOsc.frequency.setValueAtTime(profile.roots[0], now);
  humOsc2.frequency.setValueAtTime(profile.roots[1], now);
  humOsc.detune.setValueAtTime(-5, now);
  humOsc2.detune.setValueAtTime(7, now);
  humGain.gain.setValueAtTime(0.0001, now);
  humGain.gain.exponentialRampToValueAtTime(profile.hum, now + 1.1);

  filterNode.type = profile.filter;
  filterNode.frequency.setValueAtTime(profile.cutoff, now);
  filterNode.Q.setValueAtTime(profile.q, now);
  lfo.type = 'sine';
  lfo.frequency.setValueAtTime(profile.wobble, now);
  lfoGain.gain.setValueAtTime(Math.max(18, profile.cutoff * 0.11), now);

  airSource.buffer = createNoiseBuffer(3);
  airSource.loop = true;
  airFilter.type = audioProfileName() === 'vent' ? 'bandpass' : 'lowpass';
  airFilter.frequency.setValueAtTime(audioProfileName() === 'vent' ? 1500 : 680, now);
  airFilter.Q.setValueAtTime(audioProfileName() === 'vent' ? 2.8 : 0.6, now);
  airGain.gain.setValueAtTime(0.0001, now);
  airGain.gain.exponentialRampToValueAtTime(profile.air, now + 1.4);

  lfo.connect(lfoGain);
  lfoGain.connect(filterNode.frequency);
  humOsc.connect(filterNode);
  humOsc2.connect(filterNode);
  filterNode.connect(humGain);
  humGain.connect(ambienceGain);
  airSource.connect(airFilter);
  airFilter.connect(airGain);
  airGain.connect(ambienceGain);

  humOsc.start(now);
  humOsc2.start(now);
  airSource.start(now);
  lfo.start(now);
  audioGraphStarted = true;

  runHeartbeatLoop();
  if (anomalyTimer) clearInterval(anomalyTimer);
  anomalyTimer = setInterval(triggerRandomAnomalies, 11000);
}

function setMasterLevel(immediate = false) {
  if (!audioCtx || !masterGain) return;
  const now = audioCtx.currentTime;
  const target = audioMuted ? 0.0001 : 0.82;
  masterGain.gain.cancelScheduledValues(now);
  if (immediate) masterGain.gain.setValueAtTime(target, now);
  else masterGain.gain.setTargetAtTime(target, now, 0.08);
}

function finishAudioUnlock(playBoot = true) {
  const firstUnlock = !audioUnlocked;
  audioUnlocked = true;
  sessionStorage.setItem('backrooms_audio_enabled', 'true');
  setMasterLevel();
  updateAudioPrompt('ENVIRONMENTAL FEED OPEN');
  updateHUD();
  if (firstUnlock && playBoot && !audioMuted) playBootGlitchSFX();
  document.body.classList.add('signal-boot');
  setTimeout(() => document.body.classList.remove('signal-boot'), 850);
}

async function initAudio(options = {}) {
  if (audioUnlocked && audioCtx?.state === 'running') return true;
  if (audioUnlockPromise) return audioUnlockPromise;

  updateAudioPrompt('OPENING ENVIRONMENTAL FEED…');

  audioUnlockPromise = (async () => {
    let context = null;
    try {
      context = createAudioContextIfNeeded();
    } catch (error) {
      console.warn('Audio context creation failed:', error);
      updateAudioPrompt('AUDIO DEVICE REFUSED THE SIGNAL — CLICK TO RETRY');
      return false;
    }
    if (!context) {
      updateAudioPrompt('AUDIO ENGINE UNAVAILABLE');
      return false;
    }

    startAmbientSoundscape();
    if (!context.__backroomsStateListener) {
      context.__backroomsStateListener = true;
      context.addEventListener('statechange', () => {
        if (context.state === 'running' && !audioUnlocked) finishAudioUnlock(options.playBoot !== false);
      });
    }
    if (context.state === 'suspended') {
      updateAudioPrompt('NEGOTIATING WITH BROWSER AUDIO POLICY…');
      try {
        await Promise.race([
          context.resume(),
          new Promise(resolve => setTimeout(resolve, 900))
        ]);
      } catch (error) { /* A fresh user gesture will retry. */ }
    }

    if (context.state === 'running') {
      finishAudioUnlock(options.playBoot !== false);
      return true;
    }

    updateAudioPrompt('CLICK / TAP TO OPEN THE FEED');
    return false;
  })();

  try {
    return await audioUnlockPromise;
  } finally {
    audioUnlockPromise = null;
  }
}

function updateAudioPrompt(message) {
  const prompt = document.getElementById('audio-prompt');
  if (!prompt) return;
  const status = prompt.querySelector('[data-audio-status]');
  if (status) status.textContent = message;
  if (audioUnlocked) {
    prompt.classList.add('is-open');
    prompt.setAttribute('aria-hidden', 'true');
    setTimeout(() => prompt.remove(), 1000);
  }
}

window.toggleSound = async function() {
  if (!audioUnlocked) {
    audioMuted = false;
    sessionStorage.setItem('backrooms_audio_muted', 'false');
    const opened = await initAudio();
    updateHUD();
    if (!opened) return;
    showNotification('ENVIRONMENTAL FEED RESTORED');
    return;
  }
  audioMuted = !audioMuted;
  sessionStorage.setItem('backrooms_audio_muted', String(audioMuted));
  setMasterLevel();
  updateHUD();
  showNotification(audioMuted ? 'ENVIRONMENTAL FEED MUTED' : 'ENVIRONMENTAL FEED RESTORED');
  if (!audioMuted) playInterfaceTone(440, 0.08, 0.045);
};

// Persist and manage sanity level
const storedSanity = parseInt(sessionStorage.getItem('backrooms_sanity'), 10);
let sanity = Number.isFinite(storedSanity) ? storedSanity : 100;

const currentPage = window.location.pathname.split('/').pop() || 'index.html';

const roomProfiles = {
  'index.html': {
    name: 'LEVEL 0 / YELLOW GARDEN',
    layer: 'entry chamber',
    threat: 'low, until the lights notice you',
    omen: 'the maze remembers what the wanderer forgets',
    sigil: 'FOX-00'
  },
  'hallway.html': {
    name: 'LEVEL 0.1 / SHIFTING CORRIDOR',
    layer: 'skin hallway',
    threat: 'medium: moving geometry',
    omen: 'left and right are both negotiations',
    sigil: 'FOX-01'
  },
  'hallway-left.html': {
    name: 'THE COPY ROOM',
    layer: 'identity mirror',
    threat: 'medium: duplicate voices',
    omen: 'if it answers in your voice, make it say no',
    sigil: 'COPY'
  },
  'hallway-right.html': {
    name: 'THE LONG ANIMAL',
    layer: 'pursuit corridor',
    threat: 'high: visible predator',
    omen: 'do not win the chase; make the chase confess',
    sigil: 'HUNT'
  },
  'stairwell.html': {
    name: 'LEVEL 1.5 / EIGENGRAU ASCENT',
    layer: 'concrete threshold',
    threat: 'medium: pressure drop',
    omen: 'the ward is below, but the key is under',
    sigil: 'IRON'
  },
  'stairwell-alcove.html': {
    name: 'THE FOUNDATION CRACK',
    layer: 'rust cache',
    threat: 'low: item room',
    omen: 'iron remembers the hands that hid it',
    sigil: 'KEY'
  },
  'stairwell-down.html': {
    name: 'THE WARD BELOW',
    layer: 'containment echo',
    threat: 'high: memory pressure',
    omen: 'a locked door can still be a mouth',
    sigil: 'WARD'
  },
  'stairwell-up.html': {
    name: 'CLOCKLESS LANDING',
    layer: 'timer refusal',
    threat: 'medium: deadline hallucination',
    omen: 'a deadline is not the same thing as fate',
    sigil: 'TIME'
  },
  'vent.html': {
    name: 'THE CRAWLSPACE',
    layer: 'metal lung',
    threat: 'medium: compression',
    omen: 'parallel sounds are rarely parallel',
    sigil: 'VENT'
  },
  'vent-deeper.html': {
    name: 'THE SWEET BOTTLE',
    layer: 'panic cache',
    threat: 'low: recovery item',
    omen: 'comfort is not the same thing as surrender',
    sigil: 'MILK'
  },
  'vent-grate.html': {
    name: 'OBSERVATION GRATE',
    layer: 'witness slit',
    threat: 'medium: seeing too much',
    omen: 'the observer is always also recorded',
    sigil: 'EYE'
  },
  'office.html': {
    name: 'THE OFFICE / GREEN TERMINAL',
    layer: 'archive interface',
    threat: 'variable: query-dependent',
    omen: 'every command is a confession with a cursor',
    sigil: 'CRT'
  },
  'office-archives.html': {
    name: 'THE RECEIPT VAULT',
    layer: 'paper labyrinth',
    threat: 'medium: overdocumentation',
    omen: 'proof without tenderness becomes another trap',
    sigil: 'DOC'
  },
  'legend-nexus.html': {
    name: 'LEGEND NEXUS',
    layer: 'secured pocket',
    threat: 'low inside, unknown outside',
    omen: 'trust is a resource; spend it like fire',
    sigil: '1963'
  },
  'signal-ending.html': {
    name: 'THE BACKCHANNEL / OUTSIDE MAP',
    layer: 'assembled signal',
    threat: 'none that can survive being named',
    omen: 'an exit is a relationship to the maze, not a hole in its wall',
    sigil: 'OPEN'
  },
  'lost-signal.html': {
    name: 'DEAD AIR / FALSE FLOOR',
    layer: 'collapsed receiver',
    threat: 'terminal: identity drift',
    omen: 'even dead air contains a direction home',
    sigil: 'NULL'
  },
  'example-room.html': {
    name: 'CREATOR ANNEX',
    layer: 'build doctrine',
    threat: 'low: unfinished energy',
    omen: 'meaning first; money after',
    sigil: 'MAKE'
  },
  'template.html': {
    name: 'ROOM TEMPLATE',
    layer: 'construction spell',
    threat: 'low: blank page',
    omen: 'make the room useful, strange, and playable',
    sigil: 'WIP'
  }
};

const ROOM_NAV = {
  'index.html':              { short: 'Yellow Garden',      icon: 'home',      x: 500, y: 260 },
  'hallway.html':            { short: 'Shifting Corridor',  icon: 'corridor',  x: 500, y: 105 },
  'hallway-left.html':       { short: 'Copy Room',           icon: 'mirror',    x: 315, y: 105 },
  'hallway-right.html':      { short: 'Long Animal',         icon: 'hunt',      x: 685, y: 105 },
  'stairwell.html':          { short: 'Eigengrau Stair',     icon: 'stairs',    x: 700, y: 260 },
  'stairwell-alcove.html':   { short: 'Foundation Crack',    icon: 'key',       x: 855, y: 260 },
  'stairwell-up.html':       { short: 'Clockless Landing',   icon: 'clock',     x: 700, y: 32 },
  'stairwell-down.html':     { short: 'Ward Below',          icon: 'ward',      x: 700, y: 415 },
  'vent.html':               { short: 'Crawlspace',          icon: 'vent',      x: 300, y: 260 },
  'vent-deeper.html':        { short: 'Sweet Bottle',        icon: 'bottle',    x: 145, y: 260 },
  'vent-grate.html':         { short: 'Observation Grate',   icon: 'eye',       x: 300, y: 415 },
  'office.html':             { short: 'Green Terminal',      icon: 'terminal',  x: 500, y: 415 },
  'office-archives.html':    { short: 'Receipt Vault',       icon: 'archive',   x: 340, y: 510 },
  'legend-nexus.html':       { short: 'Legend Nexus',        icon: 'portal',    x: 660, y: 510 },
  'signal-ending.html':      { short: 'Assembled Signal',    icon: 'exit',      x: 855, y: 510 }
};

const MAP_EDGES = [
  ['index.html', 'hallway.html'],
  ['index.html', 'stairwell.html'],
  ['index.html', 'vent.html'],
  ['index.html', 'office.html'],
  ['hallway.html', 'hallway-left.html'],
  ['hallway.html', 'hallway-right.html'],
  ['hallway.html', 'vent.html'],
  ['hallway-left.html', 'hallway-right.html'],
  ['hallway-left.html', 'office-archives.html'],
  ['hallway-right.html', 'vent.html'],
  ['hallway-right.html', 'stairwell-down.html'],
  ['stairwell.html', 'stairwell-alcove.html'],
  ['stairwell.html', 'stairwell-up.html'],
  ['stairwell.html', 'stairwell-down.html'],
  ['stairwell.html', 'office.html'],
  ['stairwell-up.html', 'office-archives.html'],
  ['stairwell-down.html', 'office.html'],
  ['vent.html', 'vent-deeper.html'],
  ['vent.html', 'vent-grate.html'],
  ['vent-deeper.html', 'vent-grate.html'],
  ['vent-grate.html', 'office.html'],
  ['office.html', 'office-archives.html'],
  ['office.html', 'legend-nexus.html'],
  ['office-archives.html', 'legend-nexus.html'],
  ['legend-nexus.html', 'signal-ending.html']
];

const ROUTE_GUIDES = {
  'index.html>hallway.html': ['N', 'NORTH', 'returnable'],
  'index.html>stairwell.html': ['E', 'EAST', 'returnable'],
  'index.html>vent.html': ['W', 'WEST', 'returnable'],
  'index.html>office.html': ['S', 'SOUTH', 'seam'],
  'hallway.html>hallway-left.html': ['W', 'WEST', 'returnable'],
  'hallway.html>hallway-right.html': ['E', 'EAST', 'returnable'],
  'hallway.html>vent.html': ['IN', 'INWARD', 'returnable'],
  'hallway.html>index.html': ['BACK', 'BACK', 'returnable'],
  'hallway-left.html>office-archives.html': ['IN', 'PAPER SEAM', 'returnable'],
  'hallway-left.html>hallway.html': ['BACK', 'BACK', 'returnable'],
  'hallway-left.html>hallway-right.html': ['E', 'EAST', 'returnable'],
  'hallway-right.html>vent.html': ['DROP', 'DROP', 'drop'],
  'hallway-right.html>hallway-left.html': ['W', 'WEST', 'returnable'],
  'hallway-right.html>stairwell-down.html': ['DOWN', 'DOWN', 'returnable'],
  'hallway-right.html>hallway.html': ['BACK', 'BACK', 'returnable'],
  'stairwell.html>stairwell-alcove.html': ['UNDER', 'UNDER', 'returnable'],
  'stairwell.html>stairwell-up.html': ['UP', 'UP', 'returnable'],
  'stairwell.html>stairwell-down.html': ['DOWN', 'DOWN', 'returnable'],
  'stairwell.html>office.html': ['SW', 'SERVICE SOUTH-WEST', 'returnable'],
  'stairwell.html>index.html': ['BACK', 'BACK', 'returnable'],
  'stairwell-alcove.html>stairwell.html': ['OUT', 'OUT / WEST', 'returnable'],
  'stairwell-down.html>stairwell.html': ['UP', 'UP', 'returnable'],
  'stairwell-down.html>office.html': ['IN', 'CABLE SEAM', 'seam'],
  'stairwell-down.html>hallway-right.html': ['UP', 'UP / PURSUIT', 'returnable'],
  'stairwell-up.html>stairwell.html': ['DOWN', 'DOWN', 'returnable'],
  'stairwell-up.html>office-archives.html': ['IN', 'HATCH EAST', 'seam'],
  'stairwell-up.html>index.html': ['LOOP', 'SPATIAL LOOP', 'loop'],
  'vent.html>vent-deeper.html': ['FWD', 'FORWARD', 'returnable'],
  'vent.html>vent-grate.html': ['DOWN', 'DOWN', 'returnable'],
  'vent.html>hallway.html': ['DROP', 'DROP', 'returnable'],
  'vent.html>index.html': ['BACK', 'BACK', 'returnable'],
  'vent-deeper.html>vent.html': ['BACK', 'BACK / UP', 'returnable'],
  'vent-grate.html>office.html': ['DROP', 'DROP', 'returnable'],
  'vent-grate.html>vent-deeper.html': ['FWD', 'FORWARD', 'seam'],
  'vent-grate.html>vent.html': ['BACK', 'BACK', 'returnable'],
  'office.html>legend-nexus.html': ['E', 'SECURED EAST', 'locked'],
  'office.html>office-archives.html': ['W', 'COPIER WEST', 'returnable'],
  'office.html>stairwell.html': ['NE', 'SERVICE NORTH-EAST', 'returnable'],
  'office.html>vent-grate.html': ['UP', 'UP', 'returnable'],
  'office.html>index.html': ['OUT', 'OAK DOOR OUT', 'returnable'],
  'office-archives.html>office.html': ['E', 'EAST / BACK', 'returnable'],
  'office-archives.html>hallway-left.html': ['UP', 'COPIER NORTH', 'returnable'],
  'office-archives.html>legend-nexus.html': ['E', 'SERVICE LIFT EAST', 'seam'],
  'legend-nexus.html>office.html': ['OUT', 'OUT / NORTH-WEST', 'returnable'],
  'signal-ending.html>index.html': ['LOOP', 'NEW LOOP', 'reset'],
  'signal-ending.html>legend-nexus.html': ['IN', 'REMAIN', 'returnable'],
  'lost-signal.html>index.html': ['LOOP', 'RESET LOOP', 'reset']
};

const ROUTE_KIND_LABELS = {
  returnable: 'RETURNABLE',
  seam: 'UNSTABLE SEAM',
  drop: 'ONE-WAY DROP',
  loop: 'SPATIAL LOOP',
  locked: 'SECURED ROUTE',
  reset: 'RESETS RUN'
};

const CANONICAL_ECHOES = [
  'yellow-garden',
  'copy-room',
  'long-animal',
  'foundation-crack',
  'ward-below',
  'clockless-landing',
  'observation-grate',
  'receipt-vault',
  'green-terminal',
  'legend-nexus'
];
const ECHO_TARGET = CANONICAL_ECHOES.length;

const whispers = [
  'the fox does not clarify',
  'someone is editing the hallway while you read it',
  'vixen is awake in the fluorescent ballast',
  'the carpet has a pulse count and it is not yours',
  'a terminal is only a mouth with stricter grammar',
  'do not confuse evidence with escape',
  'the garden remembers; the backrooms misfiles',
  'if you find a door twice, the second one found you'
];

const oracleLines = [
  'OROBAS CHECK: mostly true. the "mostly" is the knife.',
  'TOWER WARNING: the room is not collapsing. it is revealing its architecture.',
  'VIXEN TRACE: you are not alone; you are being cached.',
  'CLAIR/OBSCUR SPLIT: the bright path and the dark path share plumbing.',
  'FOXHOLE SIGNAL: do not worship the lock. use the key.',
  'LIMINAL CARTOGRAPHY: north is a mood. east is a rumor.'
];

// A run only resets when explicitly requested by the ending screen.
const currentPageName = currentPage;
const runParams = new URLSearchParams(window.location.search);
if (runParams.get('reset') === '1') {
  sanity = 100;
  [
    'backrooms_inventory',
    'backrooms_echoes',
    'backrooms_rooms_seen',
    'backrooms_signal_complete',
    'backrooms_stabilize_uses',
    'backrooms_collapse_shown',
    'backrooms_copy_solved',
    'backrooms_pursuit_solved',
    'backrooms_previous_room',
    'backrooms_route_log'
  ].forEach(key => sessionStorage.removeItem(key));
  history.replaceState({}, '', 'index.html');
}
sessionStorage.setItem('backrooms_sanity', sanity);

// Inventory Management
function getInventory() {
  return JSON.parse(sessionStorage.getItem('backrooms_inventory')) || [];
}

function addInventoryItem(item) {
  const inv = getInventory();
  if (!inv.includes(item)) {
    inv.push(item);
    sessionStorage.setItem('backrooms_inventory', JSON.stringify(inv));
    updateHUD();
    showNotification(`FOUND ITEM: [${item}]`);
  }
}

function hasInventoryItem(item) {
  return getInventory().includes(item);
}

function removeInventoryItem(item) {
  let inv = getInventory();
  inv = inv.filter(i => i !== item);
  sessionStorage.setItem('backrooms_inventory', JSON.stringify(inv));
  updateHUD();
}

function getRoomsSeen() {
  try {
    return JSON.parse(sessionStorage.getItem('backrooms_rooms_seen')) || [];
  } catch (e) {
    return [];
  }
}

function markRoomSeen() {
  const rooms = getRoomsSeen();
  if (!rooms.includes(currentPage)) {
    rooms.push(currentPage);
    sessionStorage.setItem('backrooms_rooms_seen', JSON.stringify(rooms));
  }
}

function getRouteLog() {
  try {
    return JSON.parse(sessionStorage.getItem('backrooms_route_log')) || [];
  } catch (error) {
    return [];
  }
}

function recordTravel(source, target, mode = 'threshold') {
  if (!source || !target || source === target) return;
  const log = getRouteLog();
  log.push({ source, target, mode, at: Date.now() });
  sessionStorage.setItem('backrooms_route_log', JSON.stringify(log.slice(-20)));
  sessionStorage.setItem('backrooms_previous_room', source);
}

function getPreviousRoom() {
  const previous = sessionStorage.getItem('backrooms_previous_room');
  return previous && ROOM_NAV[previous] ? previous : null;
}

function pageFromHref(href) {
  if (!href || href.startsWith('#')) return null;
  try {
    return new URL(href, window.location.href).pathname.split('/').pop() || 'index.html';
  } catch (error) {
    return href.split(/[?#]/)[0];
  }
}

function roomName(page) {
  return ROOM_NAV[page]?.short || roomProfiles[page]?.name || page?.replace('.html', '') || 'Unknown threshold';
}

function uiIcon(name, className = '') {
  return `<svg class="ui-icon ${className}" aria-hidden="true" focusable="false"><use href="assets/icons.svg#icon-${name || 'unknown'}"></use></svg>`;
}

function getAdjacentRooms(page) {
  const adjacent = [];
  MAP_EDGES.forEach(([a, b]) => {
    if (a === page) adjacent.push(b);
    if (b === page) adjacent.push(a);
  });
  return [...new Set(adjacent)];
}

function inferredBearing(source, target) {
  const from = ROOM_NAV[source];
  const to = ROOM_NAV[target];
  if (!from || !to) return ['OUT', 'THROUGH', 'seam'];
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const horizontal = Math.abs(dx) > Math.abs(dy) * 1.35;
  const vertical = Math.abs(dy) > Math.abs(dx) * 1.35;
  if (horizontal) return dx > 0 ? ['E', 'EAST', 'returnable'] : ['W', 'WEST', 'returnable'];
  if (vertical) return dy > 0 ? ['S', 'SOUTH', 'returnable'] : ['N', 'NORTH', 'returnable'];
  if (dx > 0 && dy > 0) return ['SE', 'SOUTH-EAST', 'returnable'];
  if (dx > 0) return ['NE', 'NORTH-EAST', 'returnable'];
  if (dy > 0) return ['SW', 'SOUTH-WEST', 'returnable'];
  return ['NW', 'NORTH-WEST', 'returnable'];
}

function getRouteGuide(source, target) {
  if (target === 'signal-ending.html') return ['OUT', 'SIGNAL EXIT', 'seam'];
  return ROUTE_GUIDES[`${source}>${target}`] || inferredBearing(source, target);
}

function routeRisk(link, target) {
  const requiredItem = link?.dataset?.key;
  if (requiredItem && !hasInventoryItem(requiredItem)) {
    return { label: `LOCKED / ${requiredItem.toUpperCase()}`, level: 'locked', icon: 'lock' };
  }
  const cost = parseInt(link?.dataset?.sanityCost || '0', 10);
  if (cost >= 10) return { label: `SEVERE -${cost}`, level: 'severe', icon: 'warning' };
  if (cost > 0) return { label: `DANGER -${cost}`, level: 'danger', icon: 'warning' };
  if (target === 'vent-deeper.html' || target === 'stairwell-alcove.html') {
    return { label: 'RECOVERY', level: 'recovery', icon: ROOM_NAV[target]?.icon };
  }
  if (target === 'office.html') return { label: 'UNKNOWN', level: 'unknown', icon: 'warning' };
  const threat = roomProfiles[target]?.threat || '';
  if (threat.startsWith('high')) return { label: 'HIGH THREAT', level: 'danger', icon: 'warning' };
  if (threat.startsWith('low')) return { label: 'LOW SIGNAL', level: 'low', icon: 'compass' };
  return { label: 'CAUTION', level: 'caution', icon: 'warning' };
}

function currentObjective() {
  if (currentPage === 'lost-signal.html') {
    return { label: 'FOXPRINT LOST', detail: 'Reassemble yourself at Level 0.', icon: 'return' };
  }
  if (currentPage === 'signal-ending.html') {
    return { label: 'THRESHOLD OPEN', detail: 'Choose whether to leave or remain with the signal.', icon: 'exit' };
  }
  const progress = getEchoProgress();
  const remaining = ECHO_TARGET - progress.length;
  if (hasCompleteSignal()) {
    return { label: 'EXIT COHERENT', detail: 'Open the assembled Backchannel.', icon: 'exit' };
  }

  const roomEcho = document.querySelector('.echo-node[data-echo]');
  if (roomEcho && !getEchoes().includes(roomEcho.dataset.echo)) {
    return { label: 'LOCAL SIGNAL', detail: `Recover the ${roomName(currentPage)} echo.`, icon: 'echo' };
  }
  if (!hasInventoryItem('Rusty Key') && !getRoomsSeen().includes('stairwell-alcove.html')) {
    return { label: 'FIELD OBJECTIVE', detail: 'Search beneath the stairwell for an iron cache.', icon: 'key' };
  }
  if (!progress.includes('green-terminal')) {
    return { label: 'CARRIER MISSING', detail: 'At the Green Terminal, type LISTEN.', icon: 'terminal' };
  }
  return { label: 'BACKCHANNEL ASSEMBLY', detail: `${remaining} canonical echo${remaining === 1 ? '' : 'es'} remain.`, icon: 'echo' };
}

function escapeUI(value) {
  const node = document.createElement('span');
  node.textContent = String(value == null ? '' : value);
  return node.innerHTML;
}

function decorateTravelChoices() {
  document.querySelectorAll('.choices').forEach(group => {
    const links = Array.from(group.children).filter(node => {
      if (!node.matches || !node.matches('a[href]')) return false;
      const href = node.getAttribute('href');
      return href && !href.startsWith('#') && pageFromHref(href);
    });
    if (!links.length) return;

    group.classList.add('travel-grid');
    if (!group.querySelector('.travel-section-head')) {
      const head = document.createElement('div');
      head.className = 'travel-section-head';
      head.innerHTML = '<span>' + uiIcon('compass') + 'LIVE EXITS</span><small>Directions stay true. The wording may not.</small>';
      group.insertBefore(head, links[0]);
    }

    links.forEach(link => {
      if (link.dataset.routeDecorated === 'true') return;
      const target = pageFromHref(link.getAttribute('href'));
      const guide = getRouteGuide(currentPage, target);
      const risk = routeRisk(link, target);
      const routeKind = ROUTE_KIND_LABELS[guide[2]] || 'UNMAPPED THRESHOLD';
      const visited = getRoomsSeen().includes(target);
      const action = link.textContent.replace(/^\s*>\s*/, '').trim();
      const destination = roomName(target);
      const icon = ROOM_NAV[target]?.icon || 'unknown';

      link.dataset.routeDecorated = 'true';
      link.dataset.routeTarget = target;
      link.dataset.routeKind = guide[2];
      link.dataset.routeAction = action;
      link.classList.add('travel-route', 'risk-' + risk.level);
      link.innerHTML = [
        '<span class="route-bearing" aria-hidden="true"><b>', escapeUI(guide[0]), '</b><small>', escapeUI(guide[1]), '</small></span>',
        '<span class="route-symbol">', uiIcon(icon), '</span>',
        '<span class="route-copy"><span class="route-kicker">', escapeUI(routeKind), ' / ', visited ? 'LOGGED' : 'UNSEEN', '</span>',
        '<strong class="route-destination">', escapeUI(destination), '</strong>',
        '<span class="route-action">', escapeUI(action), '</span></span>',
        '<span class="route-risk">', uiIcon(risk.icon || 'warning'), '<span>', escapeUI(risk.label), '</span></span>'
      ].join('');
      link.setAttribute('aria-label', guide[1] + ' to ' + destination + '. ' + action + '. ' + risk.label + '. ' + routeKind + '.');
    });
  });
}

let wayfinderReturnFocus = null;

function createTravelerDock() {
  if (document.getElementById('traveler-dock')) return;
  const profile = roomProfiles[currentPage] || { sigil: 'VOID' };
  const nav = ROOM_NAV[currentPage] || { short: roomName(currentPage), icon: 'unknown' };
  const dock = document.createElement('nav');
  dock.id = 'traveler-dock';
  dock.setAttribute('aria-label', 'Foxyverse travel controls');
  dock.innerHTML = [
    '<div class="dock-room">',
      '<span class="dock-emblem">', uiIcon(nav.icon), '</span>',
      '<span><small>FOX COMPASS / ', escapeUI(profile.sigil), '</small><strong>', escapeUI(nav.short), '</strong></span>',
    '</div>',
    '<div class="dock-objective">', uiIcon('eye'), '<span><small data-dock-objective-label>FIELD OBJECTIVE</small><strong data-dock-objective>Acquire signal...</strong></span></div>',
    '<div class="dock-vitals">',
      '<span><small>SANITY</small><b data-dock-sanity>100%</b><i><em data-dock-sanity-bar></em></i></span>',
      '<span><small>ECHOES</small><b data-dock-echoes>0/', ECHO_TARGET, '</b></span>',
    '</div>',
    '<div class="dock-actions">',
      '<button type="button" data-wayfinder-open>', uiIcon('map'), '<span>MAP</span></button>',
      '<button type="button" data-show-exits>', uiIcon('exit'), '<span>EXITS</span></button>',
      '<a class="dock-back" href="index.html" hidden>', uiIcon('return'), '<span>BACK</span></a>',
      '<button type="button" data-use-water hidden>', uiIcon('bottle'), '<span>DRINK</span></button>',
      '<button type="button" data-dock-sound>', uiIcon('sound'), '<span>SOUND</span></button>',
    '</div>'
  ].join('');

  const container = document.querySelector('.container');
  document.body.insertBefore(dock, container || document.body.firstChild);

  dock.querySelector('[data-wayfinder-open]').addEventListener('click', event => openWayfinder(event.currentTarget));
  dock.querySelector('[data-show-exits]').addEventListener('click', () => {
    const exits = document.querySelector('.choices.travel-grid');
    if (!exits) return;
    exits.scrollIntoView({ behavior: 'smooth', block: 'center' });
    exits.classList.remove('route-ping');
    requestAnimationFrame(() => exits.classList.add('route-ping'));
    setTimeout(() => exits.classList.remove('route-ping'), 1800);
  });
  dock.querySelector('[data-use-water]').addEventListener('click', () => window.drinkAlmondWater());
  dock.querySelector('[data-dock-sound]').addEventListener('click', () => window.toggleSound());
  updateTravelerDock();
}

function updateTravelerDock() {
  const dock = document.getElementById('traveler-dock');
  if (!dock) return;
  const objective = currentObjective();
  const sanityValue = Math.max(0, Math.ceil(sanity));
  const objectiveLabel = dock.querySelector('[data-dock-objective-label]');
  const objectiveDetail = dock.querySelector('[data-dock-objective]');
  const sanityText = dock.querySelector('[data-dock-sanity]');
  const sanityBar = dock.querySelector('[data-dock-sanity-bar]');
  const echoText = dock.querySelector('[data-dock-echoes]');
  const back = dock.querySelector('.dock-back');
  const sound = dock.querySelector('[data-dock-sound] span');
  const soundButton = dock.querySelector('[data-dock-sound]');
  const waterButton = dock.querySelector('[data-use-water]');
  const exitsButton = dock.querySelector('[data-show-exits]');
  const previous = getPreviousRoom();
  const terminalLock = currentPage === 'lost-signal.html';

  if (objectiveLabel) objectiveLabel.textContent = objective.label;
  if (objectiveDetail) objectiveDetail.textContent = objective.detail;
  if (sanityText) sanityText.textContent = sanityValue + '%';
  if (sanityBar) sanityBar.style.width = sanityValue + '%';
  if (echoText) echoText.textContent = getEchoProgress().length + '/' + ECHO_TARGET;
  dock.dataset.sanityState = sanityValue > 70 ? 'stable' : sanityValue > 40 ? 'fringe' : 'critical';

  if (back) {
    back.hidden = terminalLock || !previous || previous === currentPage;
    if (!terminalLock && previous && previous !== currentPage) {
      back.href = previous;
      back.dataset.routeTarget = previous;
      back.dataset.routeKind = 'backtrack';
      back.setAttribute('aria-label', 'Backtrack to ' + roomName(previous));
      back.title = 'Backtrack to ' + roomName(previous);
    }
  }
  if (sound) sound.textContent = audioMuted ? 'MUTED' : audioUnlocked ? 'LIVE' : 'ARM';
  if (soundButton) soundButton.setAttribute('aria-label', audioMuted ? 'Unmute environmental audio' : audioUnlocked ? 'Mute environmental audio' : 'Enable environmental audio');
  if (waterButton) {
    waterButton.hidden = !hasInventoryItem('Almond Water');
    waterButton.setAttribute('aria-label', 'Drink Almond Water and restore sanity');
  }
  if (exitsButton) exitsButton.disabled = !document.querySelector('.choices.travel-grid');
}

function createWayfinder() {
  if (document.getElementById('wayfinder')) return;
  const aside = document.createElement('aside');
  aside.id = 'wayfinder';
  aside.hidden = true;
  aside.setAttribute('role', 'dialog');
  aside.setAttribute('aria-modal', 'true');
  aside.setAttribute('aria-labelledby', 'wayfinder-title');
  aside.setAttribute('aria-hidden', 'true');
  aside.innerHTML = [
    '<div class="wayfinder-backdrop" data-wayfinder-close aria-hidden="true"></div>',
    '<section class="wayfinder-panel">',
      '<header class="wayfinder-header">',
        '<div><small>RECOVERED CARTOGRAPHY / DIRECTIONS VERIFIED</small><h2 id="wayfinder-title">THE FOX COMPASS</h2></div>',
        '<button type="button" class="wayfinder-close" data-wayfinder-close aria-label="Close Fox Compass">', uiIcon('close'), '<span>CLOSE</span></button>',
      '</header>',
      '<div class="wayfinder-objective" data-wayfinder-objective></div>',
      '<div class="wayfinder-layout">',
        '<div class="wayfinder-map" aria-label="Discovered room map"><div class="wayfinder-map-canvas" data-wayfinder-map></div></div>',
        '<aside class="wayfinder-journal">',
          '<section><small>CARRIED</small><div data-wayfinder-inventory></div></section>',
          '<section><small>RECENT THRESHOLDS</small><ol data-wayfinder-log></ol></section>',
          '<section class="map-legend"><small>MAP KEY</small>',
            '<span><i class="legend-current"></i>YOU ARE HERE</span>',
            '<span><i class="legend-route"></i>OPEN FROM HERE</span>',
            '<span><i class="legend-seen"></i>RECORDED</span>',
            '<span><i class="legend-unknown"></i>NO SIGNAL</span>',
          '</section>',
        '</aside>',
      '</div>',
      '<footer>Map geometry is stable. Route prose can hallucinate when sanity breaks.</footer>',
    '</section>'
  ].join('');
  document.body.appendChild(aside);

  aside.querySelectorAll('[data-wayfinder-close]').forEach(control => control.addEventListener('click', closeWayfinder));
  aside.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeWayfinder();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(aside.querySelectorAll('a[href], button:not([disabled])')).filter(node => node.tabIndex !== -1 && !node.hidden);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  updateWayfinder();
}

function openWayfinder(opener) {
  const aside = document.getElementById('wayfinder');
  if (!aside) return;
  wayfinderReturnFocus = opener || document.activeElement;
  updateWayfinder();
  aside.hidden = false;
  aside.setAttribute('aria-hidden', 'false');
  document.body.classList.add('wayfinder-open');
  requestAnimationFrame(() => {
    aside.querySelector('.wayfinder-close')?.focus();
    const map = aside.querySelector('.wayfinder-map');
    const current = aside.querySelector('.map-node.is-current');
    if (map && current && map.scrollWidth > map.clientWidth) {
      map.scrollLeft = Math.max(0, current.offsetLeft - map.clientWidth / 2);
    }
  });
}

function closeWayfinder() {
  const aside = document.getElementById('wayfinder');
  if (!aside || aside.hidden) return;
  aside.hidden = true;
  aside.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('wayfinder-open');
  if (wayfinderReturnFocus && document.contains(wayfinderReturnFocus)) wayfinderReturnFocus.focus();
  wayfinderReturnFocus = null;
}

function updateWayfinder() {
  const aside = document.getElementById('wayfinder');
  if (!aside) return;
  const seen = new Set(getRoomsSeen());
  seen.add(currentPage);
  const objective = currentObjective();
  const routeLinks = new Map();
  document.querySelectorAll('.travel-route[href], .signal-gate[href]:not([hidden])').forEach(link => {
    const target = pageFromHref(link.getAttribute('href'));
    if (target) routeLinks.set(target, link);
  });

  const visiblePages = Object.keys(ROOM_NAV).filter(page => page !== 'signal-ending.html' || hasCompleteSignal() || currentPage === page);
  const visibleSet = new Set(visiblePages);
  const lineMarkup = MAP_EDGES.filter(([a, b]) => visibleSet.has(a) && visibleSet.has(b)).map(([a, b]) => {
    const from = ROOM_NAV[a];
    const to = ROOM_NAV[b];
    const available = (a === currentPage && routeLinks.has(b)) || (b === currentPage && routeLinks.has(a));
    const known = seen.has(a) && seen.has(b);
    const traced = seen.has(a) || seen.has(b);
    const state = available ? 'is-open' : known ? 'is-known' : traced ? 'is-traced' : 'is-unknown';
    return '<line class="' + state + '" x1="' + from.x + '" y1="' + from.y + '" x2="' + to.x + '" y2="' + to.y + '"></line>';
  }).join('');

  const nodeMarkup = visiblePages.map(page => {
    const nav = ROOM_NAV[page];
    const sourceLink = routeLinks.get(page);
    const isCurrent = page === currentPage;
    const isAvailable = Boolean(sourceLink) && !isCurrent;
    const isSeen = seen.has(page);
    const revealed = isCurrent || isAvailable || isSeen;
    const guide = isAvailable ? getRouteGuide(currentPage, page) : null;
    const missingKey = Boolean(sourceLink?.classList.contains('locked-door') && !hasInventoryItem(sourceLink.dataset.key));
    const classes = ['map-node'];
    if (isCurrent) classes.push('is-current');
    else if (isAvailable) classes.push('is-available');
    else if (isSeen) classes.push('is-seen');
    else classes.push('is-unknown');
    if (missingKey) classes.push('is-locked');

    const label = revealed ? nav.short : 'UNMAPPED';
    const state = isCurrent ? 'YOU ARE HERE' : missingKey ? 'LOCKED' : isAvailable ? guide[1] : isSeen ? 'RECORDED' : 'NO SIGNAL';
    const inner = [
      '<span class="map-node-bearing">', isAvailable ? escapeUI(guide[0]) : isCurrent ? 'HERE' : isSeen ? 'LOG' : '??', '</span>',
      '<span class="map-node-icon">', uiIcon(revealed ? nav.icon : 'unknown'), '</span>',
      '<strong>', escapeUI(label), '</strong>',
      '<small>', escapeUI(state), '</small>'
    ].join('');
    const position = 'left:' + (nav.x / 10) + '%;top:' + (nav.y / 5.6) + '%;';

    if (isAvailable) {
      const lockAttrs = sourceLink.classList.contains('locked-door')
        ? ' class="' + classes.concat('locked-door').join(' ') + '" data-key="' + escapeUI(sourceLink.dataset.key || '') + '"'
        : ' class="' + classes.join(' ') + '"';
      const costAttr = sourceLink.dataset.sanityCost
        ? ' data-sanity-cost="' + escapeUI(sourceLink.dataset.sanityCost) + '"'
        : '';
      return '<a href="' + escapeUI(sourceLink.getAttribute('href')) + '"' + lockAttrs + costAttr + ' data-route-target="' + page + '" data-route-kind="' + escapeUI(sourceLink.dataset.routeKind || 'map') + '" style="' + position + '" aria-label="' + escapeUI(state + ' to ' + nav.short) + '">' + inner + '</a>';
    }
    return '<div class="' + classes.join(' ') + '" style="' + position + '" aria-label="' + escapeUI(label + ', ' + state) + '">' + inner + '</div>';
  }).join('');

  const map = aside.querySelector('[data-wayfinder-map]');
  if (map) {
    map.innerHTML = '<svg class="map-lines" viewBox="0 0 1000 560" preserveAspectRatio="none" aria-hidden="true">' + lineMarkup + '</svg>' + nodeMarkup;
  }

  const objectiveBox = aside.querySelector('[data-wayfinder-objective]');
  if (objectiveBox) {
    objectiveBox.innerHTML = uiIcon(objective.icon) + '<span><small>' + escapeUI(objective.label) + '</small><strong>' + escapeUI(objective.detail) + '</strong></span>';
  }

  const inventory = getInventory();
  const inventoryBox = aside.querySelector('[data-wayfinder-inventory]');
  if (inventoryBox) {
    inventoryBox.innerHTML = inventory.length
      ? inventory.map(item => '<span class="inventory-chip">' + uiIcon(item === 'Rusty Key' ? 'key' : 'bottle') + escapeUI(item) + '</span>').join('')
      : '<span class="inventory-empty">NOTHING BUT YOUR FOXPRINT</span>';
  }

  const log = getRouteLog().slice(-5).reverse();
  const logBox = aside.querySelector('[data-wayfinder-log]');
  if (logBox) {
    logBox.innerHTML = log.length
      ? log.map(entry => '<li><span>' + escapeUI(roomName(entry.source)) + '</span><b>&rarr;</b><strong>' + escapeUI(roomName(entry.target)) + '</strong></li>').join('')
      : '<li class="empty-log">No thresholds logged yet.</li>';
  }
}

function getEchoes() {
  try {
    return JSON.parse(sessionStorage.getItem('backrooms_echoes')) || [];
  } catch (e) {
    return [];
  }
}

function getEchoProgress() {
  const echoes = getEchoes();
  return CANONICAL_ECHOES.filter(id => echoes.includes(id));
}

function hasCompleteSignal() {
  return getEchoProgress().length >= ECHO_TARGET;
}

function addEcho(echoId, label) {
  const echoes = getEchoes();
  if (!echoes.includes(echoId)) {
    echoes.push(echoId);
    sessionStorage.setItem('backrooms_echoes', JSON.stringify(echoes));
    showNotification(`ECHO RECORDED: ${label || echoId}`);
    playPickupSFX();
    updateHUD();
    updateSignalPanel();
    updateEchoLedger();
    flashOracle(`ARCHIVE ACCEPTED: ${label || echoId}`);

    if (hasCompleteSignal() && sessionStorage.getItem('backrooms_signal_complete') !== 'true') {
      sessionStorage.setItem('backrooms_signal_complete', 'true');
      setTimeout(() => {
        playSignalCompleteSFX();
        flashOracle('TEN ECHOES ALIGNED // THE BACKCHANNEL HAS BECOME A DOOR');
        updateEchoLedger();
      }, 520);
    }
  }
}

function tuneSanity(delta, reason) {
  sanity = Math.max(0, Math.min(100, sanity + delta));
  sessionStorage.setItem('backrooms_sanity', sanity);
  updateHUD();
  if (reason) showNotification(reason);
}

window.drinkAlmondWater = function() {
  if (hasInventoryItem('Almond Water')) {
    removeInventoryItem('Almond Water');
    sanity = Math.min(100, sanity + 40);
    sessionStorage.setItem('backrooms_sanity', sanity);
    playDrinkSFX();
    showNotification("CONSUMED ALMOND WATER (+40 SANITY)");
    updateHUD();
    
    const container = document.querySelector('.container');
    if (container) {
      container.style.filter = 'none';
    }
  }
}

// HUD Rendering
function createHUD() {
  const hud = document.createElement('div');
  hud.id = 'backrooms-hud';
  hud.style.position = 'fixed';
  hud.style.bottom = '15px';
  hud.style.left = '15px';
  hud.style.background = 'rgba(0,0,0,0.9)';
  hud.style.color = '#a89f68';
  hud.style.fontFamily = "'VT323', monospace";
  hud.style.fontSize = '20px';
  hud.style.padding = '10px 20px';
  hud.style.border = '2px solid #8c2a2a';
  hud.style.zIndex = '990';
  hud.style.boxShadow = '0 0 20px rgba(0,0,0,0.8)';
  hud.style.lineHeight = '1.4';
  document.body.appendChild(hud);
  updateHUD();
}

function updateHUD() {
  queueMicrotask(updateTravelerDock);
  const hud = document.getElementById('backrooms-hud');
  if (!hud) return;
  
  const inv = getInventory();
  const invText = inv.length > 0 ? inv.join(', ') : 'EMPTY';
  const echoes = getEchoProgress();
  const rooms = getRoomsSeen();
  const status = sanity > 70 ? 'STABLE' : sanity > 40 ? 'FRINGE' : sanity > 15 ? 'BREACHING' : 'POSSESSED?';
  const soundLabel = audioMuted ? 'Unmute' : audioUnlocked ? 'Mute' : 'Enable';
  
  let useBtn = '';
  if (inv.includes('Almond Water')) {
    useBtn = `<button onclick="drinkAlmondWater()" style="margin-top: 5px; font-family:'VT323', monospace; font-size:16px; background:#8c2a2a; color:#fff; border:1px solid #ff003c; cursor:pointer; padding:2px 8px; width:100%; box-shadow: 0 0 5px #ff003c;">USE ALMOND WATER</button>`;
  }

  hud.innerHTML = `
    <div>FOXPRINT: ${roomProfiles[currentPage]?.sigil || 'VOID'} / ${status}</div>
    <div>SANITY: ${Math.ceil(sanity)}%</div>
    <div>INVENTORY: [${invText}]</div>
    <div>ECHOES: ${echoes.length}/${ECHO_TARGET} &nbsp; ROOMS: ${rooms.length}</div>
    <div class="hud-audio"><button type="button" onclick="toggleSound()" aria-label="${soundLabel} environmental audio">${audioMuted ? 'SOUND: OFF' : audioUnlocked ? 'SOUND: ON' : 'SOUND: ARM'}</button></div>
    ${useBtn}
  `;
}

function showNotification(text) {
  const note = document.createElement('div');
  note.className = 'backrooms-notification';
  note.setAttribute('role', 'status');
  note.setAttribute('aria-live', 'polite');
  note.style.position = 'fixed';
  note.style.top = '60px';
  note.style.left = '50%';
  note.style.transform = 'translateX(-50%)';
  note.style.background = '#8c2a2a';
  note.style.color = '#fff';
  note.style.padding = '10px 20px';
  note.style.fontFamily = "'VT323', monospace";
  note.style.fontSize = '22px';
  note.style.border = '2px solid #ff003c';
  note.style.zIndex = '1000';
  note.style.boxShadow = '0 0 20px rgba(255,0,60,0.6)';
  note.style.pointerEvents = 'none';
  note.style.transition = 'opacity 0.5s';
  document.body.appendChild(note);
  
  note.innerText = text;
  
  setTimeout(() => {
    note.style.opacity = '0';
    setTimeout(() => note.remove(), 500);
  }, 3000);
}

function updateSanity() {
  const isTerminalRoom = currentPage === 'signal-ending.html' || currentPage === 'lost-signal.html';
  if (!document.hidden && !isTerminalRoom && sanity > 0) {
    sanity -= 0.25; // Balanced drain rate
    sessionStorage.setItem('backrooms_sanity', sanity);
  }

  const distortion = (100 - sanity) / 100;
  
  // Apply visual distortion filters to the container
  const container = document.querySelector('.container');
  if (container) {
    const blurVal = sanity > 70 ? 0 : (distortion * 1.2);
    container.style.filter = `blur(${blurVal}px) contrast(${1 + distortion * 0.5}) brightness(${1 - distortion * 0.35})`;
  }

  // Modulate audio based on sanity
  if (humGain && audioCtx) {
    const target = ambientBaseGain * (0.9 + distortion * 0.7);
    humGain.gain.setTargetAtTime(target, audioCtx.currentTime, 0.35);
  }

  updateHUD();

  // Low Sanity visual disturbances (shaking and red flashing)
  if (sanity < 40) {
    if (Math.random() < 0.15) {
      triggerScreenDisturbance();
    }
  }

  // Text Glitching
  if (Math.random() < 0.08 + distortion * 0.22) {
    glitchText();
  }

  // Link Hallucinations
  if (sanity < 50 && Math.random() < 0.08) {
    triggerLinkHallucination();
  }

  if (sanity <= 0 && !isTerminalRoom) handleSanityCollapse();
}

function handleSanityCollapse() {
  if (sessionStorage.getItem('backrooms_collapse_shown') === 'true') return;
  sessionStorage.setItem('backrooms_collapse_shown', 'true');
  document.body.classList.add('sanity-collapse');
  playCollapseSFX();
  flashOracle('FOXPRINT LOST // THE MAZE IS NOW WEARING YOUR NAME');
  setTimeout(() => { window.location.href = 'lost-signal.html'; }, 2400);
}

// Low Sanity visual effects
function triggerScreenDisturbance() {
  const container = document.querySelector('.container');
  const flash = document.querySelector('.red-flash');

  if (container) {
    container.classList.add('screen-shake');
    if (flash) flash.classList.add('active');

    // Play static buzz distortion
    playStaticAnomalSFX();

    setTimeout(() => {
      container.classList.remove('screen-shake');
      if (flash) flash.classList.remove('active');
    }, 250 + Math.random() * 400);
  }
}

const glitchChars = "$@#%&!01?+=-_[]{}<>";
function glitchText() {
  const paragraphs = document.querySelectorAll('p');
  if (paragraphs.length === 0) return;
  const p = paragraphs[Math.floor(Math.random() * paragraphs.length)];
  
  if (!p.dataset.original) {
    p.dataset.original = p.innerText;
  }
  
  const text = p.dataset.original;
  let glitchedText = '';
  const distortion = (100 - sanity) / 100;
  
  for (let i = 0; i < text.length; i++) {
    if (Math.random() < distortion * 0.15 && text[i] !== ' ') {
      glitchedText += glitchChars[Math.floor(Math.random() * glitchChars.length)];
    } else {
      glitchedText += text[i];
    }
  }
  p.innerText = glitchedText;
  
  setTimeout(() => {
    p.innerText = p.dataset.original;
  }, 150 + Math.random() * 300);
}

// Hallucination texts replacing links
const horrorTexts = [
  "IT IS WATCHING",
  "DON'T LOOK BACK",
  "THE SKIN IS STOLEN",
  "ARE YOU REAL?",
  "Z WILL FIND YOU",
  "THE MEDICATION WAS REAL",
  "NO EXIT",
  "POSSESSION"
];

function triggerLinkHallucination() {
  const links = document.querySelectorAll('.choices a');
  if (links.length === 0) return;

  const link = links[Math.floor(Math.random() * links.length)];
  const action = link.querySelector('.route-action');
  if (!action || action.dataset.originalText) return;

  action.dataset.originalText = action.textContent;
  link.classList.add('is-hallucinating');
  link.style.color = '#ff003c';
  link.style.borderColor = '#ff003c';
  action.textContent = horrorTexts[Math.floor(Math.random() * horrorTexts.length)];

  setTimeout(() => {
    action.textContent = action.dataset.originalText;
    link.classList.remove('is-hallucinating');
    link.style.color = '';
    link.style.borderColor = '';
    delete action.dataset.originalText;
  }, 1200 + Math.random() * 800);
}

function createSignalPanel() {
  if (document.getElementById('foxy-signal')) return;

  const profile = roomProfiles[currentPage] || {
    name: 'UNMAPPED EIGENGRAU',
    layer: 'unwritten pocket',
    threat: 'unknown',
    omen: 'the blank page is not empty',
    sigil: 'VOID'
  };

  const panel = document.createElement('aside');
  panel.id = 'foxy-signal';
  panel.innerHTML = `
    <div class="signal-title">FOXYVERSE BACKCHANNEL</div>
    <div class="signal-room">${profile.name}</div>
    <div class="signal-grid">
      <span>LAYER</span><b>${profile.layer}</b>
      <span>THREAT</span><b>${profile.threat}</b>
      <span>SIGIL</span><b>${profile.sigil}</b>
      <span>ECHO</span><b id="signal-echo-count">0/${ECHO_TARGET}</b>
    </div>
    <div class="signal-omen" id="signal-omen">${profile.omen}</div>
  `;
  const container = document.querySelector('.container');
  document.body.insertBefore(panel, container || null);
  updateSignalPanel();
}

function updateSignalPanel() {
  const echoCount = document.getElementById('signal-echo-count');
  if (echoCount) echoCount.innerText = `${getEchoProgress().length}/${ECHO_TARGET}`;

  const omen = document.getElementById('signal-omen');
  if (omen && Math.random() < 0.25) {
    omen.innerText = whispers[Math.floor(Math.random() * whispers.length)];
  }
}

function createRoomIntel() {
  const container = document.querySelector('.container');
  if (!container || container.querySelector('.room-intel')) return;
  const profile = roomProfiles[currentPage];
  if (!profile) return;

  const intel = document.createElement('div');
  intel.className = 'room-intel';
  intel.innerHTML = `
    <div class="intel-kicker">live cartography</div>
    <div><strong>${profile.name}</strong></div>
    <div>${profile.omen}</div>
  `;
  container.insertBefore(intel, container.firstElementChild);
}

function createEchoLedger() {
  const container = document.querySelector('.container');
  const isEnding = currentPage === 'signal-ending.html' || currentPage === 'lost-signal.html';
  if (!container || isEnding || document.getElementById('echo-ledger')) return;

  const ledger = document.createElement('section');
  ledger.id = 'echo-ledger';
  ledger.className = 'echo-ledger';
  ledger.setAttribute('aria-label', 'Backchannel signal progress');
  ledger.innerHTML = `
    <div class="echo-ledger-head">
      <span>BACKCHANNEL ASSEMBLY</span>
      <b id="echo-ledger-count">0/${ECHO_TARGET}</b>
    </div>
    <div class="echo-track" aria-hidden="true">
      ${CANONICAL_ECHOES.map((id, index) => `<i data-echo-slot="${id}" title="Echo ${index + 1}: ${id}"></i>`).join('')}
    </div>
    <p id="echo-objective">Recover the room echoes. The terminal is listening too.</p>
    <a id="signal-gate" class="signal-gate" href="signal-ending.html" data-tag="exit" hidden>
      &gt; OPEN THE ASSEMBLED BACKCHANNEL
    </a>
  `;

  const choices = container.querySelector('.choices');
  if (choices) container.insertBefore(ledger, choices);
  else container.appendChild(ledger);
  updateEchoLedger();
}

function updateEchoLedger() {
  const progress = getEchoProgress();
  const count = document.getElementById('echo-ledger-count');
  const objective = document.getElementById('echo-objective');
  const gate = document.getElementById('signal-gate');
  if (count) count.textContent = `${progress.length}/${ECHO_TARGET}`;
  document.querySelectorAll('[data-echo-slot]').forEach(slot => {
    slot.classList.toggle('is-found', progress.includes(slot.dataset.echoSlot));
  });

  if (objective) {
    const remaining = ECHO_TARGET - progress.length;
    objective.textContent = remaining > 0
      ? `${remaining} echo${remaining === 1 ? '' : 'es'} remain. One of them only answers to a terminal command.`
      : 'Signal coherent. The maze can no longer pretend it has no exit.';
  }
  if (gate) gate.hidden = !hasCompleteSignal();
}

function flashOracle(message) {
  let oracle = document.getElementById('oracle-flash');
  if (!oracle) {
    oracle = document.createElement('div');
    oracle.id = 'oracle-flash';
    document.body.appendChild(oracle);
  }

  oracle.innerText = message || oracleLines[Math.floor(Math.random() * oracleLines.length)];
  oracle.classList.add('active');
  setTimeout(() => oracle.classList.remove('active'), 2600);
}

function sealEcho(node, reason) {
  if (!node || getEchoes().includes(node.dataset.echo)) return;
  node.dataset.sealed = 'true';
  node.classList.add('echo-sealed');
  node.setAttribute('aria-disabled', 'true');
  node.setAttribute('tabindex', '-1');
  node.title = reason;
}

function unsealEcho(node) {
  if (!node) return;
  delete node.dataset.sealed;
  node.classList.remove('echo-sealed');
  node.removeAttribute('aria-disabled');
  node.setAttribute('tabindex', '0');
  node.removeAttribute('title');
}

function setupCopyRoomChallenge() {
  const echo = document.querySelector('[data-echo="copy-room"]');
  const card = echo?.closest('.memory-card');
  if (!echo || !card) return;
  const solved = sessionStorage.getItem('backrooms_copy_solved') === 'true';
  const challenge = document.createElement('section');
  challenge.className = 'room-challenge identity-challenge';

  if (solved) {
    challenge.innerHTML = '<div class="challenge-status solved">IDENTITY CHECK: THE WORD “NO” STILL BELONGS TO YOU.</div>';
    card.insertBefore(challenge, echo);
    return;
  }

  sealEcho(echo, 'The identity mirror must be answered first.');
  challenge.innerHTML = `
    <div class="challenge-kicker">LIVE TEST // ONE VOICE IS YOURS</div>
    <div class="challenge-status">Every monitor asks: “Which of us is the original?”</div>
    <div class="challenge-actions">
      <button type="button" data-copy-answer="self">I AM THE ORIGINAL</button>
      <button type="button" data-copy-answer="copy">YOU ARE ME</button>
      <button type="button" data-copy-answer="no">NO</button>
    </div>
  `;
  card.insertBefore(challenge, echo);

  challenge.querySelectorAll('[data-copy-answer]').forEach(button => {
    button.addEventListener('click', () => {
      const status = challenge.querySelector('.challenge-status');
      if (button.dataset.copyAnswer === 'no') {
        sessionStorage.setItem('backrooms_copy_solved', 'true');
        unsealEcho(echo);
        playUnlockSFX();
        tuneSanity(4, 'IDENTITY BOUNDARY RESTORED (+4 SANITY)');
        challenge.classList.add('is-solved');
        challenge.innerHTML = '<div class="challenge-status solved">CORRECT. A COPY CAN STEAL A FACE. IT CANNOT STEAL A BOUNDARY.</div>';
      } else {
        button.disabled = true;
        playDeniedSFX();
        tuneSanity(-6, 'THE COPY ANSWERED AT THE SAME TIME (-6 SANITY)');
        if (status) status.textContent = button.dataset.copyAnswer === 'self'
          ? 'All the copies say that. They smile before you do.'
          : 'Every monitor replies: “then which one of us leaves?”';
        triggerScreenDisturbance();
      }
    });
  });
}

function setupLongAnimalChallenge() {
  const echo = document.querySelector('[data-echo="long-animal"]');
  const card = echo?.closest('.ritual-card');
  if (!echo || !card) return;
  const solved = sessionStorage.getItem('backrooms_pursuit_solved') === 'true';
  const challenge = document.createElement('section');
  challenge.className = 'room-challenge pursuit-challenge';

  if (solved) {
    challenge.innerHTML = '<div class="challenge-status solved">PURSUIT STATUS: NAMED THINGS HAVE EDGES.</div>';
    card.insertBefore(challenge, echo);
    return;
  }

  sealEcho(echo, 'The pursuit must be named before its echo can be taken.');
  challenge.innerHTML = `
    <div class="challenge-kicker">PROXIMITY EVENT // 8 SECONDS</div>
    <div class="challenge-status">The corridor is holding its breath. Begin when you are ready.</div>
    <div class="pursuit-meter" aria-hidden="true"><i></i></div>
    <button type="button" class="challenge-start">BEGIN LISTENING</button>
    <div class="challenge-actions" hidden>
      <button type="button" data-pursuit-answer="destiny">CALL IT DESTINY</button>
      <button type="button" data-pursuit-answer="animal">CALL IT AN ANIMAL</button>
      <button type="button" data-pursuit-answer="run">RUN WITHOUT NAMING IT</button>
    </div>
  `;
  card.insertBefore(challenge, echo);

  const startButton = challenge.querySelector('.challenge-start');
  const actions = challenge.querySelector('.challenge-actions');
  const status = challenge.querySelector('.challenge-status');
  const meter = challenge.querySelector('.pursuit-meter i');
  let timer = null;
  let deadline = 0;

  const failPursuit = message => {
    clearInterval(timer);
    timer = null;
    meter.style.width = '0%';
    actions.hidden = true;
    startButton.disabled = false;
    startButton.textContent = 'TRY LISTENING AGAIN';
    status.textContent = message;
    playDeniedSFX();
    tuneSanity(-10, 'THE LONG ANIMAL CLOSED THE DISTANCE (-10 SANITY)');
    triggerScreenDisturbance();
  };

  startButton.addEventListener('click', () => {
    startButton.disabled = true;
    actions.hidden = false;
    status.textContent = 'It approaches by becoming more inevitable. Name what is actually here.';
    deadline = Date.now() + 8000;
    meter.style.width = '100%';
    clearInterval(timer);
    timer = setInterval(() => {
      const remaining = Math.max(0, deadline - Date.now());
      meter.style.width = `${remaining / 80}%`;
      if (remaining <= 0) failPursuit('You waited for certainty. It used the time to become your whole horizon.');
    }, 80);
  });

  challenge.querySelectorAll('[data-pursuit-answer]').forEach(button => {
    button.addEventListener('click', () => {
      if (!timer) return;
      if (button.dataset.pursuitAnswer === 'animal') {
        clearInterval(timer);
        timer = null;
        sessionStorage.setItem('backrooms_pursuit_solved', 'true');
        unsealEcho(echo);
        playUnlockSFX();
        tuneSanity(3, 'THE CHASE ACQUIRED EDGES (+3 SANITY)');
        challenge.classList.add('is-solved');
        challenge.innerHTML = '<div class="challenge-status solved">CORRECT. NOT A GOD. NOT A DESTINY. AN ANIMAL WITH A HUNGER.</div>';
      } else if (button.dataset.pursuitAnswer === 'destiny') {
        deadline -= 2800;
        button.disabled = true;
        playDeniedSFX();
        status.textContent = 'It likes being called destiny. The hallway gets shorter.';
      } else {
        failPursuit('Running turns distance into food. The corridor swallows every meter you gain.');
      }
    });
  });
}

function setupRoomMechanics() {
  if (currentPage === 'hallway-left.html') setupCopyRoomChallenge();
  if (currentPage === 'hallway-right.html') setupLongAnimalChallenge();
}

function bindEchoNodes() {
  document.querySelectorAll('.echo-node').forEach(node => {
    const id = node.dataset.echo || node.textContent.trim().toLowerCase().replace(/\s+/g, '-');
    if (getEchoes().includes(id)) {
      node.classList.add('collected');
      node.setAttribute('aria-label', 'Echo already recorded');
      node.innerText = node.dataset.after || 'ECHO ALREADY RECORDED';
    }
    node.addEventListener('click', e => {
      e.preventDefault();
      if (node.dataset.sealed === 'true') {
        playDeniedSFX();
        showNotification('ECHO SEALED: COMPLETE THE ROOM PROTOCOL');
        return;
      }
      const label = node.dataset.label || node.textContent.trim();
      addEcho(id, label);
      node.classList.add('collected');
      node.innerText = node.dataset.after || 'ECHO ALREADY RECORDED';
    });
  });
}

function bindRiskyRoutes() {
  document.addEventListener('click', event => {
    const link = event.target.closest('a[data-sanity-cost]');
    const modified = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
    if (!link || event.defaultPrevented || modified) return;
    const cost = parseInt(link.dataset.sanityCost, 10);
    if (Number.isFinite(cost) && cost > 0) {
      sanity = Math.max(0, sanity - cost);
      sessionStorage.setItem('backrooms_sanity', sanity);
      updateHUD();
    }
  });
}

function startWhisperTicker() {
  setInterval(() => {
    updateSignalPanel();
    if (sanity < 55 && Math.random() < 0.35) {
      flashOracle();
    }
  }, 9000);
}

// Clipboard Copy
window.copyAddress = function(address) {
  navigator.clipboard.writeText(address).then(() => {
    showNotification("ADDRESS COPIED TO CLIPBOARD!");
  }).catch(err => {
    showNotification("COPY FAILED. PLEASE MANUALLY SELECT.");
  });
}

// ==========================================
// PROCEDURAL SOUND EFFECT SYNTHESIZERS
// ==========================================

function audioCanPlay() {
  return Boolean(audioCtx && audioCtx.state === 'running' && sfxGain && !audioMuted);
}

function connectWithPan(node, destination, pan = 0) {
  if (typeof audioCtx.createStereoPanner !== 'function') {
    node.connect(destination);
    return destination;
  }
  const panner = audioCtx.createStereoPanner();
  panner.pan.setValueAtTime(Math.max(-1, Math.min(1, pan)), audioCtx.currentTime);
  node.connect(panner);
  panner.connect(destination);
  return panner;
}

function envelope(gainParam, start, peak, attack, end, release) {
  gainParam.cancelScheduledValues(start);
  gainParam.setValueAtTime(0.0001, start);
  gainParam.exponentialRampToValueAtTime(Math.max(0.0002, peak), start + attack);
  gainParam.exponentialRampToValueAtTime(0.0001, end + release);
}

function playNoiseBurst({ duration = 0.18, volume = 0.08, cutoff = 2400, type = 'bandpass', pan = 0, delay = 0 } = {}) {
  if (!audioCanPlay()) return;
  const start = audioCtx.currentTime + delay;
  const source = audioCtx.createBufferSource();
  const filter = audioCtx.createBiquadFilter();
  const gain = audioCtx.createGain();
  source.buffer = createNoiseBuffer(Math.max(duration, 0.08));
  filter.type = type;
  filter.frequency.setValueAtTime(cutoff, start);
  filter.Q.setValueAtTime(type === 'bandpass' ? 1.8 : 0.7, start);
  envelope(gain.gain, start, volume, 0.006, start + duration, 0.035);
  source.connect(filter);
  filter.connect(gain);
  connectWithPan(gain, sfxGain, pan);
  source.start(start);
  source.stop(start + duration + 0.05);
}

function playInterfaceTone(frequency = 520, duration = 0.07, volume = 0.025, pan = 0) {
  if (!audioCanPlay()) return;
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(frequency, now);
  envelope(gain.gain, now, volume, 0.004, now + duration, 0.025);
  osc.connect(gain);
  connectWithPan(gain, sfxGain, pan);
  osc.start(now);
  osc.stop(now + duration + 0.04);
}

function playBootGlitchSFX() {
  if (!audioCanPlay()) return;
  const now = audioCtx.currentTime;
  const duration = 0.82;
  const source = audioCtx.createBufferSource();
  const filter = audioCtx.createBiquadFilter();
  const gain = audioCtx.createGain();
  const buffer = audioCtx.createBuffer(1, Math.floor(audioCtx.sampleRate * duration), audioCtx.sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < data.length; i++) {
    const t = i / audioCtx.sampleRate;
    const cut = (t > 0.09 && t < 0.15) || (t > 0.31 && t < 0.39) || (t > 0.58 && t < 0.64);
    const decay = Math.pow(1 - t / duration, 0.65);
    data[i] = cut ? 0 : (Math.random() * 2 - 1) * decay;
  }

  source.buffer = buffer;
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(260, now);
  filter.frequency.exponentialRampToValueAtTime(5200, now + 0.52);
  filter.frequency.exponentialRampToValueAtTime(900, now + duration);
  filter.Q.setValueAtTime(1.2, now);
  envelope(gain.gain, now, 0.16, 0.012, now + duration, 0.03);
  source.connect(filter);
  filter.connect(gain);
  connectWithPan(gain, sfxGain, -0.12);
  source.start(now);
  source.stop(now + duration + 0.04);

  [
    { f: 78, to: 43, at: 0, len: 0.58, vol: 0.13, type: 'sine', pan: 0 },
    { f: 622, to: 1244, at: 0.16, len: 0.23, vol: 0.055, type: 'square', pan: -0.4 },
    { f: 932, to: 466, at: 0.43, len: 0.27, vol: 0.045, type: 'triangle', pan: 0.45 }
  ].forEach(tone => {
    const start = now + tone.at;
    const osc = audioCtx.createOscillator();
    const toneGain = audioCtx.createGain();
    osc.type = tone.type;
    osc.frequency.setValueAtTime(tone.f, start);
    osc.frequency.exponentialRampToValueAtTime(tone.to, start + tone.len);
    envelope(toneGain.gain, start, tone.vol, 0.008, start + tone.len, 0.04);
    osc.connect(toneGain);
    connectWithPan(toneGain, sfxGain, tone.pan);
    osc.start(start);
    osc.stop(start + tone.len + 0.05);
  });
}

// Heartbeat Loop (speeds up as sanity drops)
function runHeartbeatLoop() {
  if (heartbeatTimer) clearTimeout(heartbeatTimer);

  if (!audioCanPlay() || sanity > 70) {
    // No heartbeat at high sanity
    heartbeatTimer = setTimeout(runHeartbeatLoop, 2000);
    return;
  }

  const distortion = (100 - sanity) / 100;
  playHeartbeatSFX(distortion);

  // Interval matches sanity level: lower sanity = faster heartbeat (0.6s to 1.6s)
  const interval = 1600 - (distortion * 1000);
  heartbeatTimer = setTimeout(runHeartbeatLoop, interval);
}

function playHeartbeatSFX(intensity) {
  if (!audioCanPlay()) return;
  const now = audioCtx.currentTime;

  // Double-thump beat
  const beats = [0, 0.22];

  beats.forEach(delay => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(55, now + delay); // Sub bass A1
    osc.frequency.exponentialRampToValueAtTime(0.01, now + delay + 0.15);

    // Gaining volume as sanity slips
    envelope(gain.gain, now + delay, 0.18 * intensity, 0.012, now + delay + 0.13, 0.04);

    osc.connect(gain);
    gain.connect(heartbeatGain);
    osc.start(now + delay);
    osc.stop(now + delay + 0.15);
  });
}

// Random horror sounds
function triggerRandomAnomalies() {
  if (!audioCanPlay()) return;

  const distortion = (100 - sanity) / 100;
  if (Math.random() < 0.22 + distortion * 0.4) {
    const choices = sanity < 55
      ? [playShriekAnomalSFX, playMetallicClangSFX, playDistantStepSFX]
      : [playFluorescentPopSFX, playDistantStepSFX];
    choices[Math.floor(Math.random() * choices.length)]();
  }
}

function playShriekAnomalSFX() {
  if (!audioCanPlay()) return;
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  const filter = audioCtx.createBiquadFilter();

  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(1000, now);
  // High-pitch frequency slide down (creepy shriek)
  osc.frequency.exponentialRampToValueAtTime(300, now + 0.8);

  filter.type = 'peaking';
  filter.frequency.setValueAtTime(1200, now);
  filter.Q.setValueAtTime(10, now);
  filter.gain.setValueAtTime(8, now);

  envelope(gain.gain, now, 0.035, 0.08, now + 0.74, 0.08);

  osc.connect(filter);
  filter.connect(gain);
  connectWithPan(gain, sfxGain, Math.random() * 1.4 - 0.7);

  osc.start(now);
  osc.stop(now + 0.8);
}

function playMetallicClangSFX() {
  if (!audioCanPlay()) return;
  const now = audioCtx.currentTime;
  playNoiseBurst({ duration: 0.07, volume: 0.11, cutoff: 2200, type: 'highpass', pan: 0.55 });
  [183, 271, 427, 691].forEach((frequency, index) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = index % 2 ? 'sine' : 'triangle';
    osc.frequency.setValueAtTime(frequency, now);
    osc.detune.setValueAtTime(index * 9, now);
    envelope(gain.gain, now, 0.055 / (index + 1), 0.004, now + 0.65 + index * 0.13, 0.2);
    osc.connect(gain);
    connectWithPan(gain, sfxGain, 0.48);
    osc.start(now);
    osc.stop(now + 1.4);
  });
}

function playStaticAnomalSFX() {
  playNoiseBurst({ duration: 0.19, volume: 0.095, cutoff: 3100, type: 'bandpass', pan: Math.random() * 1.2 - 0.6 });
}

function playFluorescentPopSFX() {
  if (!audioCanPlay()) return;
  playNoiseBurst({ duration: 0.025, volume: 0.075, cutoff: 4800, type: 'highpass', pan: Math.random() * 1.6 - 0.8 });
  setTimeout(() => playInterfaceTone(118, 0.12, 0.025, Math.random() * 1.4 - 0.7), 38);
}

function playDistantStepSFX() {
  if (!audioCanPlay()) return;
  const pan = Math.random() > 0.5 ? 0.72 : -0.72;
  const now = audioCtx.currentTime;
  [0, 0.46].forEach((delay, index) => {
    const osc = audioCtx.createOscillator();
    const filter = audioCtx.createBiquadFilter();
    const gain = audioCtx.createGain();
    const start = now + delay;
    osc.type = 'sine';
    osc.frequency.setValueAtTime(index ? 52 : 58, start);
    osc.frequency.exponentialRampToValueAtTime(31, start + 0.18);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(120, start);
    envelope(gain.gain, start, 0.07, 0.012, start + 0.18, 0.11);
    osc.connect(filter);
    filter.connect(gain);
    connectWithPan(gain, sfxGain, pan);
    osc.start(start);
    osc.stop(start + 0.32);
  });
}

window.playPickupSFX = function() {
  if (!audioCanPlay()) return;

  const now = audioCtx.currentTime;
  
  const osc1 = audioCtx.createOscillator();
  const gain1 = audioCtx.createGain();
  osc1.type = 'sine';
  osc1.frequency.setValueAtTime(587.33, now); // D5
  osc1.frequency.exponentialRampToValueAtTime(880, now + 0.15); // A5
  envelope(gain1.gain, now, 0.09, 0.006, now + 0.28, 0.08);
  
  osc1.connect(gain1);
  connectWithPan(gain1, sfxGain, -0.2);
  osc1.start(now);
  osc1.stop(now + 0.3);

  const osc2 = audioCtx.createOscillator();
  const gain2 = audioCtx.createGain();
  osc2.type = 'sine';
  osc2.frequency.setValueAtTime(1174.66, now + 0.1); // D6
  envelope(gain2.gain, now + 0.1, 0.06, 0.006, now + 0.36, 0.08);

  osc2.connect(gain2);
  connectWithPan(gain2, sfxGain, 0.2);
  osc2.start(now + 0.1);
  osc2.stop(now + 0.4);
}

window.playUnlockSFX = function() {
  if (!audioCanPlay()) return;

  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  const filter = audioCtx.createBiquadFilter();

  osc.type = 'triangle';
  osc.frequency.setValueAtTime(150, now);
  osc.frequency.exponentialRampToValueAtTime(450, now + 0.4);

  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(200, now);
  filter.frequency.exponentialRampToValueAtTime(1200, now + 0.4);
  filter.Q.setValueAtTime(5, now);

  envelope(gain.gain, now, 0.12, 0.008, now + 0.48, 0.12);

  osc.connect(filter);
  filter.connect(gain);
  connectWithPan(gain, sfxGain, 0.1);

  osc.start(now);
  osc.stop(now + 0.5);
}

window.playDeniedSFX = function() {
  if (!audioCanPlay()) return;

  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(90, now);
  osc.frequency.setValueAtTime(80, now + 0.1);
  
  envelope(gain.gain, now, 0.1, 0.008, now + 0.24, 0.06);

  osc.connect(gain);
  gain.connect(sfxGain);

  osc.start(now);
  osc.stop(now + 0.25);
}

window.playDrinkSFX = function() {
  if (!audioCanPlay()) return;

  const now = audioCtx.currentTime;

  for (let i = 0; i < 3; i++) {
    const timeOffset = i * 0.15;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(200 + Math.random() * 50, now + timeOffset);
    osc.frequency.exponentialRampToValueAtTime(450 + Math.random() * 100, now + timeOffset + 0.12);

    envelope(gain.gain, now + timeOffset, 0.055, 0.006, now + timeOffset + 0.12, 0.05);

    osc.connect(gain);
    connectWithPan(gain, sfxGain, -0.3 + i * 0.3);

    osc.start(now + timeOffset);
    osc.stop(now + timeOffset + 0.12);
  }
}

function playSignalCompleteSFX() {
  if (!audioCanPlay()) return;
  const now = audioCtx.currentTime;
  playNoiseBurst({ duration: 0.42, volume: 0.075, cutoff: 3600, type: 'bandpass', pan: 0 });
  [146.83, 220, 293.66, 440, 587.33].forEach((frequency, index) => {
    const start = now + index * 0.105;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = index < 2 ? 'sine' : 'triangle';
    osc.frequency.setValueAtTime(frequency, start);
    osc.detune.setValueAtTime(index % 2 ? 5 : -4, start);
    envelope(gain.gain, start, 0.065 - index * 0.006, 0.012, start + 0.5, 0.42);
    osc.connect(gain);
    connectWithPan(gain, sfxGain, -0.55 + index * 0.275);
    osc.start(start);
    osc.stop(start + 0.95);
  });
}

function playCollapseSFX() {
  if (!audioCanPlay()) return;
  const now = audioCtx.currentTime;
  playNoiseBurst({ duration: 1.25, volume: 0.14, cutoff: 1700, type: 'lowpass', pan: 0 });
  [74, 51, 36].forEach((frequency, index) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const start = now + index * 0.18;
    osc.type = index === 0 ? 'sawtooth' : 'sine';
    osc.frequency.setValueAtTime(frequency, start);
    osc.frequency.exponentialRampToValueAtTime(18, start + 1.15);
    envelope(gain.gain, start, 0.11 / (index + 1), 0.02, start + 1.05, 0.18);
    osc.connect(gain);
    gain.connect(sfxGain);
    osc.start(start);
    osc.stop(start + 1.3);
  });
}

function playRouteTransitionSFX() {
  if (!audioCanPlay()) return;
  const now = audioCtx.currentTime;
  playNoiseBurst({ duration: 0.24, volume: 0.07, cutoff: 950, type: 'bandpass', pan: 0 });
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(240, now);
  osc.frequency.exponentialRampToValueAtTime(52, now + 0.28);
  envelope(gain.gain, now, 0.045, 0.006, now + 0.26, 0.04);
  osc.connect(gain);
  gain.connect(sfxGain);
  osc.start(now);
  osc.stop(now + 0.32);
}

function bindSoundInteractions() {
  const controlSelector = '.choices a, .signal-gate, .echo-node, .key-item, button, .dock-back, .map-node[href]';
  let toneCursor = 0;
  document.addEventListener('pointerover', event => {
    const control = event.target.closest(controlSelector);
    if (!control || (event.relatedTarget && control.contains(event.relatedTarget))) return;
    if (audioUnlocked) {
      const toneIndex = Number(control.dataset.toneIndex || toneCursor++);
      control.dataset.toneIndex = String(toneIndex);
      playInterfaceTone(360 + (toneIndex % 5) * 34, 0.035, 0.012, toneIndex % 2 ? 0.18 : -0.18);
    }
  });
  document.addEventListener('focusin', event => {
    if (event.target.closest(controlSelector) && audioUnlocked) {
      playInterfaceTone(440, 0.045, 0.015);
    }
  });

  document.addEventListener('click', event => {
      const link = event.target.closest('.choices a[href], .signal-gate[href], .map-node[href], .dock-back[href]');
      if (!link) return;
      const href = link.getAttribute('href');
      const modified = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
      const locked = link.classList.contains('locked-door') && !hasInventoryItem(link.dataset.key);
      if (event.defaultPrevented || modified || locked || !href || href.startsWith('#')) return;
      event.preventDefault();
      const target = pageFromHref(href);
      recordTravel(currentPage, target, link.dataset.routeKind || (link.classList.contains('dock-back') ? 'backtrack' : 'threshold'));
      playRouteTransitionSFX();
      document.body.classList.add('room-exit');
      setTimeout(() => { window.location.href = link.href; }, audioCanPlay() ? 260 : 80);
  });

  const terminalInput = document.getElementById('terminal-input');
  if (terminalInput) {
    terminalInput.addEventListener('keydown', event => {
      if (event.key === 'Enter') playInterfaceTone(180, 0.08, 0.04);
      else if (event.key.length === 1) playInterfaceTone(520 + Math.random() * 90, 0.018, 0.008, Math.random() * 0.5 - 0.25);
    });
  }
}

// Intercept Locked Doors
document.addEventListener('click', (e) => {
  const link = e.target.closest('a');
  if (link && link.classList.contains('locked-door')) {
    const requiredItem = link.dataset.key;
    if (!hasInventoryItem(requiredItem)) {
      e.preventDefault();
      playDeniedSFX();
      showNotification(`ACCESS DENIED: REQUIRES [${requiredItem.toUpperCase()}]`);
      
      const termHistory = document.getElementById('terminal-history');
      if (termHistory) {
        const line = document.createElement('div');
        line.className = 'terminal-line';
        line.style.color = '#ff3333';
        line.innerText = `>> LOCK TRIGGERED. ACCESS DENIED. KEY: ${requiredItem.toUpperCase()} NOT FOUND.`;
        termHistory.appendChild(line);
        termHistory.scrollTop = termHistory.scrollHeight;
      }
    } else {
      playUnlockSFX();
    }
  }
});

// Set up event listeners
document.addEventListener('DOMContentLoaded', () => {
  markRoomSeen();

  // Create red flash overlay
  const flash = document.createElement('div');
  flash.className = 'red-flash';
  document.body.appendChild(flash);

  const prompt = document.createElement('div');
  prompt.id = 'audio-prompt';
  prompt.setAttribute('role', 'dialog');
  prompt.setAttribute('aria-label', 'Environmental audio activation');
  prompt.innerHTML = `
    <button type="button" id="audio-enter">
      <span class="audio-kicker">FOXYVERSE // LIMINAL RECEIVER</span>
      <strong data-audio-status>CLICK ANYWHERE TO OPEN THE ENVIRONMENTAL FEED</strong>
      <span class="audio-wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span>
      <small>headphones recommended · sound can be muted from the HUD</small>
    </button>
    <button type="button" id="audio-skip">CONTINUE SILENTLY</button>
  `;
  document.body.appendChild(prompt);
  const activateAudioGate = event => {
    if (event?.target?.closest?.('#audio-skip')) return;
    if (!audioUnlocked) updateAudioPrompt('OPENING ENVIRONMENTAL FEED…');
    initAudio();
  };
  prompt.addEventListener('pointerdown', activateAudioGate, { capture: true });
  prompt.addEventListener('click', activateAudioGate, { capture: true });
  document.getElementById('audio-skip').addEventListener('click', event => {
    event.stopPropagation();
    audioMuted = true;
    sessionStorage.setItem('backrooms_audio_muted', 'true');
    prompt.classList.add('is-open');
    prompt.setAttribute('aria-hidden', 'true');
    setTimeout(() => prompt.remove(), 760);
    updateHUD();
  });

  createHUD();
  createSignalPanel();
  createRoomIntel();
  createEchoLedger();
  setupRoomMechanics();
  bindEchoNodes();
  bindRiskyRoutes();
  decorateTravelChoices();
  createTravelerDock();
  createWayfinder();
  bindSoundInteractions();
  startWhisperTicker();

  // Pointer-down runs before click handlers, satisfying browser autoplay rules
  // even when the first interaction is an inventory item or locked door.
  const unlockFromGesture = activateAudioGate;
  document.addEventListener('pointerdown', unlockFromGesture, { capture: true });
  document.addEventListener('click', unlockFromGesture, { capture: true });
  document.addEventListener('keydown', event => {
    if (!audioUnlocked && (event.key === 'Enter' || event.key === ' ')) initAudio();
  }, { capture: true });

  // Once this origin has already been armed, try to restore audio after room
  // navigation. Browsers that still require a gesture keep the prompt visible.
  if (audioMuted) {
    prompt.classList.add('is-open');
    prompt.setAttribute('aria-hidden', 'true');
    setTimeout(() => prompt.remove(), 50);
  } else if (sessionStorage.getItem('backrooms_audio_enabled') === 'true') {
    prompt.classList.add('audio-resume');
    initAudio({ playBoot: false });
  }

  setInterval(updateSanity, 1000);
});
