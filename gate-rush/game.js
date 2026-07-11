// Real JFK stats (terminals, gates, staff, flights/day, passengers) scaled into
// game parameters - see the project plan for the exact formulas used:
//   gates = max(3, round(real_gates / 4))
//   points = round(avg_passengers_per_day / 200)
//   turnaround (s) = 8 + 8 * (1 - total_staff / max_total_staff)
//   spawnWeight = flights/day rounded to a small integer ratio
const TERMINALS = [
  {
    id: 't1',
    name: 'Terminal 1',
    color: '#e6633d',
    gateCount: 3,
    spawnWeight: 1,
    points: 80,
    turnaround: 13,
    airlines: ['Air France', 'Lufthansa', 'Korean Air', 'Turkish', 'Air China', 'Air New Zealand', 'Air Serbia', 'SWISS'],
  },
  {
    id: 't4',
    name: 'Terminal 4',
    color: '#3a7ca5',
    gateCount: 12,
    spawnWeight: 4,
    points: 350,
    turnaround: 8,
    airlines: ['Delta', 'Emirates', 'Virgin Atlantic', 'LATAM', 'Etihad', 'Singapore', 'Air India', 'Avianca', 'Aeromexico'],
  },
  {
    id: 't5',
    name: 'Terminal 5',
    color: '#4caf50',
    gateCount: 7,
    spawnWeight: 3,
    points: 200,
    turnaround: 12,
    airlines: ['JetBlue', 'Cape Air', 'Sun Country'],
  },
  {
    id: 't7',
    name: 'Terminal 7',
    color: '#e8a33d',
    gateCount: 3,
    spawnWeight: 1,
    points: 50,
    turnaround: 15,
    airlines: ['Air Canada', 'Aer Lingus', 'ANA', 'Alaska'],
  },
  {
    id: 't8',
    name: 'Terminal 8',
    color: '#9c5fc0',
    gateCount: 8,
    spawnWeight: 3,
    points: 150,
    turnaround: 10,
    airlines: ['American Airlines', 'British Airways', 'Iberia', 'Qatar Airways', 'Alaska Airlines', 'Finnair'],
  },
];

const GATE_SIZE_RANK = { small: 1, medium: 2, large: 3 };
const SIZE_WEIGHTS = [
  ['small', 0.4],
  ['medium', 0.35],
  ['large', 0.25],
];

function weightedRandomSize() {
  let r = Math.random();
  for (const [size, weight] of SIZE_WEIGHTS) {
    if (r < weight) return size;
    r -= weight;
  }
  return 'large';
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function assignGateSizes(gateCount) {
  const sizes = ['small', 'medium', 'large']; // every terminal is guaranteed one of each
  while (sizes.length < gateCount) {
    sizes.push(weightedRandomSize());
  }
  return shuffleArray(sizes);
}

const CLASS_RANK = { regional: 1, domestic: 2, international: 3 };
const GATE_CLASS_ICON = { regional: '🛩️', domestic: '🏠', international: '🌍' };
const CLASS_WEIGHTS = [
  ['regional', 0.4],
  ['domestic', 0.35],
  ['international', 0.25],
];

function weightedRandomClass() {
  let r = Math.random();
  for (const [flightClass, weight] of CLASS_WEIGHTS) {
    if (r < weight) return flightClass;
    r -= weight;
  }
  return 'international';
}

function assignGateClasses(gateCount) {
  const classes = ['regional', 'domestic', 'international']; // every terminal is guaranteed one of each
  while (classes.length < gateCount) {
    classes.push(weightedRandomClass());
  }
  return shuffleArray(classes);
}

for (const terminal of TERMINALS) {
  const sizes = assignGateSizes(terminal.gateCount);
  const classes = assignGateClasses(terminal.gateCount);
  const gates = sizes.map((size, i) => ({ status: 'open', timer: 0, size, class: classes[i] }));

  // Size and class are rolled independently, so it's possible no single gate is
  // both large and international - guarantee one "fits anything" gate per terminal
  // so a large+international flight is never permanently unplaceable.
  if (!gates.some((g) => g.size === 'large' && g.class === 'international')) {
    const patched = gates[Math.floor(Math.random() * gates.length)];
    patched.size = 'large';
    patched.class = 'international';
  }

  terminal.gates = gates;
  terminal.gateEls = [];
}

const LIVES_START = 3;
const MILESTONE_STEP = 1000;
const MAX_QUEUE = 5;

const SPAWN_INTERVAL_BASE = 2.6;
const SPAWN_INTERVAL_MIN = 1.3;
const SPAWN_RAMP_RATE = 0.008;

const FLIGHT_COUNTDOWN_BASE = 12;
const FLIGHT_COUNTDOWN_MIN = 6;
const FLIGHT_RAMP_RATE = 0.02;

const EVENT_GRACE_PERIOD = 20;

const GATE_CLOSURE_INTERVAL_MIN = 18;
const GATE_CLOSURE_INTERVAL_MAX = 28;
const GATE_CLOSURE_DURATION_MIN = 8;
const GATE_CLOSURE_DURATION_MAX = 14;

const WEATHER_INTERVAL_MIN = 22;
const WEATHER_INTERVAL_MAX = 35;
const WEATHER_DURATION = 18;
const WEATHER_TURNAROUND_MULTIPLIER = 1.75;

const VIP_CHANCE = 0.18;
const VIP_COUNTDOWN_MULTIPLIER = 0.6;
const VIP_POINTS_MULTIPLIER = 2;

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

const PLAYER_NAME_KEY = 'gateRushPlayerName';
const PERSONAL_BESTS_KEY = 'gateRushPersonalBests';

const STATE = { START: 'start', PLAYING: 'playing', PAUSED: 'paused', VICTORY: 'victory', GAME_OVER: 'gameOver' };

let state = STATE.START;
let score = 0;
let lives = LIVES_START;
let nextMilestone, elapsed, spawnTimer, flightIdCounter, selectedFlightId;
let flights = [];
let closureTimer, weatherSpawnTimer, weatherTimer, weatherTerminalId;

const pauseBtn = document.getElementById('pauseBtn');
const playerNameInput = document.getElementById('playerName');
const livesDisplay = document.getElementById('livesDisplay');
const scoreDisplay = document.getElementById('scoreDisplay');
const terminalsContainer = document.getElementById('terminals');
const queueContainer = document.getElementById('queue');

playerNameInput.value = localStorage.getItem(PLAYER_NAME_KEY) || '';

function getPlayerName() {
  return playerNameInput.value.trim() || 'Player';
}

function getPersonalBests() {
  try {
    return JSON.parse(localStorage.getItem(PERSONAL_BESTS_KEY)) || {};
  } catch {
    return {};
  }
}

function getPersonalBest(name) {
  return getPersonalBests()[name] || 0;
}

function recordScore(name, finalScore) {
  const bests = getPersonalBests();
  if (finalScore > (bests[name] || 0)) {
    bests[name] = finalScore;
    localStorage.setItem(PERSONAL_BESTS_KEY, JSON.stringify(bests));
  }
}

function getLeaderboard() {
  return Object.entries(getPersonalBests())
    .map(([name, best]) => ({ name, score: best }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

function setInputLocked(locked) {
  playerNameInput.disabled = locked;
  if (locked) playerNameInput.blur();
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function renderLeaderboardHTML() {
  const leaderboard = getLeaderboard();
  const title = '<div class="leaderboard-title">Leaderboard</div>';
  if (leaderboard.length === 0) {
    return `${title}No scores yet - be the first!`;
  }
  return title + leaderboard.map((entry, i) => `${i + 1}. ${escapeHtml(entry.name)} - ${entry.score}`).join('<br>');
}

function buildBoard() {
  for (const terminal of TERMINALS) {
    const row = document.createElement('div');
    row.className = 'terminal-row';
    row.style.setProperty('--terminal-color', terminal.color);
    terminal.rowEl = row;

    const label = document.createElement('div');
    label.className = 'terminal-label';
    label.textContent = terminal.name;
    row.appendChild(label);

    const weatherBadge = document.createElement('span');
    weatherBadge.className = 'weather-badge';
    weatherBadge.textContent = '⛅ Weather delay';
    row.appendChild(weatherBadge);
    terminal.weatherBadgeEl = weatherBadge;

    const gatesEl = document.createElement('div');
    gatesEl.className = 'gates';
    for (let i = 0; i < terminal.gateCount; i++) {
      const gateEl = document.createElement('div');
      gateEl.className = `gate size-${terminal.gates[i].size}`;
      gateEl.style.setProperty('--terminal-color', terminal.color);
      gateEl.addEventListener('click', () => handleGateClick(terminal, i));
      gatesEl.appendChild(gateEl);
      terminal.gateEls.push(gateEl);
    }
    row.appendChild(gatesEl);
    terminalsContainer.appendChild(row);
  }
}

buildBoard();

function showOverlay(id) {
  for (const overlayId of ['startOverlay', 'victoryOverlay', 'gameOverOverlay', 'pauseOverlay']) {
    document.getElementById(overlayId).classList.toggle('hidden', overlayId !== id);
  }
}

function hideAllOverlays() {
  for (const overlayId of ['startOverlay', 'victoryOverlay', 'gameOverOverlay', 'pauseOverlay']) {
    document.getElementById(overlayId).classList.add('hidden');
  }
}

function currentSpawnInterval() {
  return Math.max(SPAWN_INTERVAL_MIN, SPAWN_INTERVAL_BASE - elapsed * SPAWN_RAMP_RATE);
}

function currentFlightCountdown() {
  return Math.max(FLIGHT_COUNTDOWN_MIN, FLIGHT_COUNTDOWN_BASE - elapsed * FLIGHT_RAMP_RATE);
}

function resetGame() {
  score = 0;
  lives = LIVES_START;
  nextMilestone = MILESTONE_STEP;
  elapsed = 0;
  spawnTimer = currentSpawnInterval();
  selectedFlightId = null;
  flightIdCounter = 0;

  for (const flight of flights || []) flight.el.remove();
  flights = [];

  for (const terminal of TERMINALS) {
    for (const gate of terminal.gates) {
      gate.status = 'open';
      gate.timer = 0;
    }
  }

  closureTimer = randomBetween(GATE_CLOSURE_INTERVAL_MIN, GATE_CLOSURE_INTERVAL_MAX);
  weatherSpawnTimer = randomBetween(WEATHER_INTERVAL_MIN, WEATHER_INTERVAL_MAX);
  weatherTimer = 0;
  weatherTerminalId = null;

  pauseBtn.textContent = 'Pause';
  localStorage.setItem(PLAYER_NAME_KEY, getPlayerName());
  setInputLocked(true);

  hideAllOverlays();
  updateSelectionVisuals();
}

function pickWeightedTerminal() {
  const totalWeight = TERMINALS.reduce((sum, t) => sum + t.spawnWeight, 0);
  let r = Math.random() * totalWeight;
  for (const terminal of TERMINALS) {
    r -= terminal.spawnWeight;
    if (r <= 0) return terminal;
  }
  return TERMINALS[TERMINALS.length - 1];
}

const SIZE_BADGE_LABEL = { small: 'S', medium: 'M', large: 'L' };
const CLASS_BADGE_LABEL = { regional: '🛩️ Reg', domestic: '🏠 Dom', international: '🌍 Intl' };

function spawnFlight() {
  const terminal = pickWeightedTerminal();
  const airline = terminal.airlines[Math.floor(Math.random() * terminal.airlines.length)];
  const isVIP = Math.random() < VIP_CHANCE;
  const size = weightedRandomSize();
  const flightClass = weightedRandomClass();
  const maxCountdown = isVIP ? currentFlightCountdown() * VIP_COUNTDOWN_MULTIPLIER : currentFlightCountdown();
  const points = isVIP ? terminal.points * VIP_POINTS_MULTIPLIER : terminal.points;

  const el = document.createElement('div');
  el.className = isVIP ? 'flight-card vip' : 'flight-card';

  if (isVIP) {
    const vipBadge = document.createElement('div');
    vipBadge.className = 'vip-badge';
    vipBadge.textContent = '⭐ VIP';
    el.appendChild(vipBadge);
  }

  const tag = document.createElement('div');
  tag.className = 'terminal-tag';
  tag.textContent = terminal.name.replace('Terminal ', 'T');
  tag.style.background = terminal.color;
  el.appendChild(tag);

  const sizeBadge = document.createElement('span');
  sizeBadge.className = `size-badge size-${size}`;
  sizeBadge.textContent = SIZE_BADGE_LABEL[size];
  tag.appendChild(sizeBadge);

  const airlineEl = document.createElement('div');
  airlineEl.className = 'airline';
  airlineEl.textContent = airline;
  el.appendChild(airlineEl);

  const classBadge = document.createElement('div');
  classBadge.className = `class-badge class-${flightClass}`;
  classBadge.textContent = CLASS_BADGE_LABEL[flightClass];
  el.appendChild(classBadge);

  const track = document.createElement('div');
  track.className = 'countdown-track';
  const fill = document.createElement('div');
  fill.className = 'countdown-fill';
  track.appendChild(fill);
  el.appendChild(track);

  const flight = { id: flightIdCounter++, terminal, airline, points, isVIP, size, class: flightClass, countdown: maxCountdown, maxCountdown, el, fill };
  el.addEventListener('click', () => handleFlightClick(flight));

  flights.push(flight);
  queueContainer.appendChild(el);
}

function removeFlight(flight) {
  flights = flights.filter((f) => f.id !== flight.id);
  flight.el.remove();
}

function handleFlightClick(flight) {
  if (state !== STATE.PLAYING) return;
  ensureAudio();
  selectedFlightId = selectedFlightId === flight.id ? null : flight.id;
  updateSelectionVisuals();
}

function handleGateClick(terminal, index) {
  if (state !== STATE.PLAYING) return;
  ensureAudio();
  if (selectedFlightId === null) return;
  const flight = flights.find((f) => f.id === selectedFlightId);
  if (!flight) return;
  if (flight.terminal.id !== terminal.id) return;
  const gate = terminal.gates[index];
  if (gate.status !== 'open') return;
  if (GATE_SIZE_RANK[gate.size] < GATE_SIZE_RANK[flight.size]) return;
  if (CLASS_RANK[gate.class] < CLASS_RANK[flight.class]) return;

  const isWeather = weatherTerminalId === terminal.id;
  gate.status = 'occupied';
  gate.timer = isWeather ? terminal.turnaround * WEATHER_TURNAROUND_MULTIPLIER : terminal.turnaround;
  score += flight.points;
  playAssignSound();
  removeFlight(flight);
  selectedFlightId = null;
  updateSelectionVisuals();

  if (score >= nextMilestone) {
    playVictoryFanfare();
    state = STATE.VICTORY;
    stopMusic();
    showOverlay('victoryOverlay');
  }
}

function updateSelectionVisuals() {
  for (const flight of flights) {
    flight.el.classList.toggle('selected', flight.id === selectedFlightId);
  }

  const selectedFlight = flights.find((f) => f.id === selectedFlightId);
  for (const terminal of TERMINALS) {
    terminal.gateEls.forEach((gateEl, i) => {
      const gate = terminal.gates[i];
      const isOpen = gate.status === 'open';
      const isBigEnough = !!selectedFlight && GATE_SIZE_RANK[gate.size] >= GATE_SIZE_RANK[selectedFlight.size];
      const hasClearance = !!selectedFlight && CLASS_RANK[gate.class] >= CLASS_RANK[selectedFlight.class];
      const isTargetable =
        !!selectedFlight && selectedFlight.terminal.id === terminal.id && isOpen && isBigEnough && hasClearance;
      gateEl.classList.toggle('targetable', isTargetable);
      gateEl.classList.toggle('dimmed', !!selectedFlight && !isTargetable);
    });
  }
}

function missFlight(flight) {
  playMissSound();
  removeFlight(flight);
  if (selectedFlightId === flight.id) selectedFlightId = null;
  lives--;
  if (lives <= 0) {
    recordScore(getPlayerName(), score);
    state = STATE.GAME_OVER;
    stopMusic();
    setInputLocked(false);
    showOverlay('gameOverOverlay');
  }
}

function update(dt) {
  elapsed += dt;

  for (const flight of flights.slice()) {
    flight.countdown -= dt;
    if (flight.countdown <= 0) {
      missFlight(flight);
    }
  }

  for (const terminal of TERMINALS) {
    for (const gate of terminal.gates) {
      if (gate.status === 'open') continue;
      gate.timer = Math.max(0, gate.timer - dt);
      if (gate.timer <= 0) {
        gate.status = 'open';
      }
    }
  }

  spawnTimer -= dt;
  if (spawnTimer <= 0) {
    if (flights.length < MAX_QUEUE) {
      spawnFlight();
    }
    spawnTimer = currentSpawnInterval();
  }

  if (elapsed > EVENT_GRACE_PERIOD) {
    closureTimer -= dt;
    if (closureTimer <= 0) {
      tryCloseRandomGate();
      closureTimer = randomBetween(GATE_CLOSURE_INTERVAL_MIN, GATE_CLOSURE_INTERVAL_MAX);
    }

    if (weatherTimer > 0) {
      weatherTimer = Math.max(0, weatherTimer - dt);
      if (weatherTimer <= 0) weatherTerminalId = null;
    } else {
      weatherSpawnTimer -= dt;
      if (weatherSpawnTimer <= 0) {
        startWeatherEvent();
        weatherSpawnTimer = randomBetween(WEATHER_INTERVAL_MIN, WEATHER_INTERVAL_MAX);
      }
    }
  }
}

function tryCloseRandomGate() {
  const eligible = TERMINALS.filter((t) => t.gates.filter((g) => g.status === 'open').length >= 2);
  if (eligible.length === 0) return;

  const totalWeight = eligible.reduce((sum, t) => sum + t.gateCount, 0);
  let r = Math.random() * totalWeight;
  let chosenTerminal = eligible[eligible.length - 1];
  for (const terminal of eligible) {
    r -= terminal.gateCount;
    if (r <= 0) {
      chosenTerminal = terminal;
      break;
    }
  }

  const openIndices = chosenTerminal.gates
    .map((gate, i) => (gate.status === 'open' ? i : -1))
    .filter((i) => i !== -1);
  const gateIndex = openIndices[Math.floor(Math.random() * openIndices.length)];
  const gate = chosenTerminal.gates[gateIndex];
  gate.status = 'closed';
  gate.timer = randomBetween(GATE_CLOSURE_DURATION_MIN, GATE_CLOSURE_DURATION_MAX);
}

function startWeatherEvent() {
  const terminal = TERMINALS[Math.floor(Math.random() * TERMINALS.length)];
  weatherTerminalId = terminal.id;
  weatherTimer = WEATHER_DURATION;
}

function render() {
  livesDisplay.textContent = `Lives: ${lives}`;
  scoreDisplay.textContent = `Score: ${score}`;

  for (const flight of flights) {
    const frac = Math.max(0, flight.countdown / flight.maxCountdown);
    flight.fill.style.width = `${frac * 100}%`;
    flight.fill.style.background = frac < 0.25 ? '#e53935' : frac < 0.5 ? '#fb8c00' : '#4caf50';
  }

  for (const terminal of TERMINALS) {
    const isWeather = weatherTerminalId === terminal.id;
    terminal.rowEl.classList.toggle('weather', isWeather);
    terminal.weatherBadgeEl.style.display = isWeather ? 'inline' : 'none';

    terminal.gateEls.forEach((gateEl, i) => {
      const gate = terminal.gates[i];
      gateEl.classList.toggle('occupied', gate.status === 'occupied');
      gateEl.classList.toggle('closed', gate.status === 'closed');
      gateEl.textContent =
        gate.status === 'occupied' ? '✈️' : gate.status === 'closed' ? '🚧' : GATE_CLASS_ICON[gate.class];
    });
  }

  updateSelectionVisuals();

  if (state === STATE.START) {
    document.getElementById('leaderboardStart').innerHTML = renderLeaderboardHTML();
    document.getElementById('yourBestStart').textContent = `Your Best (${getPlayerName()}): ${getPersonalBest(getPlayerName())}`;
  } else if (state === STATE.VICTORY) {
    document.getElementById('victoryScore').textContent = score;
    document.getElementById('leaderboardVictory').innerHTML = renderLeaderboardHTML();
  } else if (state === STATE.GAME_OVER) {
    document.getElementById('finalScore').textContent = score;
    document.getElementById('leaderboardGameOver').innerHTML = renderLeaderboardHTML();
    document.getElementById('yourBestGameOver').textContent = `Your Best (${getPlayerName()}): ${getPersonalBest(getPlayerName())}`;
  }
}

document.getElementById('startBtn').addEventListener('click', () => {
  ensureAudio();
  resetGame();
  state = STATE.PLAYING;
  startMusic();
});

document.getElementById('restartBtn').addEventListener('click', () => {
  ensureAudio();
  resetGame();
  state = STATE.PLAYING;
  startMusic();
});

document.getElementById('continueBtn').addEventListener('click', () => {
  ensureAudio();
  nextMilestone += MILESTONE_STEP;
  state = STATE.PLAYING;
  hideAllOverlays();
  startMusic();
});

pauseBtn.addEventListener('click', () => {
  ensureAudio();
  if (state === STATE.PLAYING) {
    state = STATE.PAUSED;
    stopMusic();
    pauseBtn.textContent = 'Resume';
    showOverlay('pauseOverlay');
  } else if (state === STATE.PAUSED) {
    state = STATE.PLAYING;
    startMusic();
    pauseBtn.textContent = 'Pause';
    hideAllOverlays();
  }
});

let audioCtx = null;
let audioUnlocked = false;

function ensureAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();

  // iOS Safari can leave Web Audio silent even after resume() unless an actual
  // sound is started synchronously inside the gesture handler - this silent
  // buffer forces the audio hardware to fully unlock on the first tap/click.
  if (!audioUnlocked) {
    const silentBuffer = audioCtx.createBuffer(1, 1, 22050);
    const source = audioCtx.createBufferSource();
    source.buffer = silentBuffer;
    source.connect(audioCtx.destination);
    source.start(0);
    audioUnlocked = true;
  }
}

['touchstart', 'touchend', 'mousedown', 'click'].forEach((eventName) => {
  window.addEventListener(eventName, ensureAudio, { once: true });
});

function playTone(freq, duration, type, volume) {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(volume, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + duration + 0.02);
}

function playAssignSound() {
  playTone(880, 0.15, 'sine', 0.12);
}

function playMissSound() {
  playTone(130, 0.3, 'sawtooth', 0.18);
}

function playVictoryFanfare() {
  playTone(523.25, 0.15, 'triangle', 0.15);
  setTimeout(() => playTone(659.25, 0.15, 'triangle', 0.15), 150);
  setTimeout(() => playTone(783.99, 0.3, 'triangle', 0.15), 300);
}

const MELODY = [523.25, 587.33, 659.25, 523.25, 659.25, 587.33, 523.25, 392.0];
let musicTimer = null;
let musicIndex = 0;

function playMelodyNote() {
  playTone(MELODY[musicIndex % MELODY.length], 0.25, 'triangle', 0.06);
  musicIndex++;
}

function startMusic() {
  stopMusic();
  musicIndex = 0;
  musicTimer = setInterval(playMelodyNote, 300);
}

function stopMusic() {
  if (musicTimer) {
    clearInterval(musicTimer);
    musicTimer = null;
  }
}

let lastTime = null;
function loop(timestamp) {
  if (lastTime === null) lastTime = timestamp;
  const dt = Math.min((timestamp - lastTime) / 1000, 0.05);
  lastTime = timestamp;

  if (state === STATE.PLAYING) {
    update(dt);
  }
  render();

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
