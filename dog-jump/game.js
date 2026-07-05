const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const WIDTH = canvas.width;
const HEIGHT = canvas.height;
const GROUND_Y = 250;

const GRAVITY = 1500;
const JUMP_VELOCITY = 450;
const BOOST_VELOCITY = 110;
const MAX_UPWARD_VELOCITY = 800;
const MAX_PRESSES = 5;

const DOG_X = 100;
const DOG_WIDTH = 50;
const DOG_HEIGHT = 36;

const BASE_SPEED = 300;
const MAX_SPEED = 600;
const SPEED_RAMP = 8; // px/s gained per second survived

const OBSTACLE_TYPES = {
  wood: { width: 30, height: 35, color: '#8b5a2b', points: 5 },
  steel: { width: 40, height: 70, color: '#8a8f96', points: 10 },
};

const PLAYER_NAME_KEY = 'dogJumpPlayerName';
const PERSONAL_BESTS_KEY = 'dogJumpPersonalBests';
const MILESTONE_STEP = 100;
const HIT_FLASH_DURATION = 0.6;

const STATE = { START: 'start', PLAYING: 'playing', PAUSED: 'paused', VICTORY: 'victory', GAME_OVER: 'gameOver' };

let state = STATE.START;

let dogY, velocityY, isAirborne, jumpPressCount, hitTimer;
let obstacles, spawnTimer, gameSpeed, elapsed, distanceTraveled, score, lives, nextMilestone;

const pauseBtn = document.getElementById('pauseBtn');
const playerNameInput = document.getElementById('playerName');
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

function resetGame() {
  dogY = GROUND_Y;
  velocityY = 0;
  isAirborne = false;
  jumpPressCount = 0;
  hitTimer = 0;

  obstacles = [];
  spawnTimer = 1.2;
  gameSpeed = BASE_SPEED;
  elapsed = 0;
  distanceTraveled = 0;
  score = 0;
  lives = 3;
  nextMilestone = MILESTONE_STEP;

  pauseBtn.textContent = 'Pause';
  localStorage.setItem(PLAYER_NAME_KEY, getPlayerName());
  setInputLocked(true);
}

function startJump() {
  velocityY = -JUMP_VELOCITY;
  isAirborne = true;
  jumpPressCount = 1;
  playJumpSound();
}

function boostJump() {
  velocityY = Math.max(velocityY - BOOST_VELOCITY, -MAX_UPWARD_VELOCITY);
  jumpPressCount++;
  playJumpSound();
}

function handleJumpKey() {
  if (state !== STATE.PLAYING) return;
  ensureAudio();
  if (!isAirborne) {
    startJump();
  } else if (jumpPressCount < MAX_PRESSES) {
    boostJump();
  }
}

function handleConfirmKey() {
  ensureAudio();
  if (state === STATE.START) {
    resetGame();
    state = STATE.PLAYING;
    startMusic();
  } else if (state === STATE.GAME_OVER) {
    resetGame();
    state = STATE.PLAYING;
    startMusic();
  } else if (state === STATE.VICTORY) {
    nextMilestone += MILESTONE_STEP;
    state = STATE.PLAYING;
    startMusic();
  }
}

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    if (state !== STATE.PLAYING) return;
    e.preventDefault();
    if (e.repeat) return;
    handleJumpKey();
  } else if (e.code === 'Enter') {
    if (state === STATE.PLAYING || state === STATE.PAUSED) return;
    e.preventDefault();
    if (e.repeat) return;
    handleConfirmKey();
  }
});

pauseBtn.addEventListener('click', () => {
  ensureAudio();
  if (state === STATE.PLAYING) {
    state = STATE.PAUSED;
    stopMusic();
    pauseBtn.textContent = 'Resume';
  } else if (state === STATE.PAUSED) {
    state = STATE.PLAYING;
    startMusic();
    pauseBtn.textContent = 'Pause';
  }
});

function spawnObstacle() {
  const type = Math.random() < 0.5 ? 'wood' : 'steel';
  const def = OBSTACLE_TYPES[type];
  obstacles.push({
    type,
    x: WIDTH,
    width: def.width,
    height: def.height,
    color: def.color,
    points: def.points,
    scored: false,
    hit: false,
  });
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

let audioCtx = null;
let audioUnlocked = false;

function ensureAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();

  // iOS Safari can leave Web Audio silent even after resume() unless an actual
  // sound is started synchronously inside the gesture handler - this silent
  // buffer forces the audio hardware to fully unlock on the first tap/keypress.
  if (!audioUnlocked) {
    const silentBuffer = audioCtx.createBuffer(1, 1, 22050);
    const source = audioCtx.createBufferSource();
    source.buffer = silentBuffer;
    source.connect(audioCtx.destination);
    source.start(0);
    audioUnlocked = true;
  }
}

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

function playJumpSound() {
  playTone(500, 0.12, 'square', 0.12);
}

function playHitSound() {
  playTone(130, 0.3, 'sawtooth', 0.18);
}

function playScoreSound() {
  playTone(880, 0.15, 'sine', 0.12);
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

function update(dt) {
  elapsed += dt;
  gameSpeed = Math.min(BASE_SPEED + elapsed * SPEED_RAMP, MAX_SPEED);
  distanceTraveled += gameSpeed * dt;

  if (hitTimer > 0) hitTimer = Math.max(0, hitTimer - dt);

  velocityY += GRAVITY * dt;
  dogY += velocityY * dt;
  if (dogY >= GROUND_Y) {
    dogY = GROUND_Y;
    velocityY = 0;
    isAirborne = false;
    jumpPressCount = 0;
  }

  spawnTimer -= dt;
  if (spawnTimer <= 0) {
    spawnObstacle();
    spawnTimer = 1.2 + Math.random() * 1.0;
  }

  const dogRect = { x: DOG_X, y: dogY - DOG_HEIGHT, w: DOG_WIDTH, h: DOG_HEIGHT };

  for (const obs of obstacles) {
    obs.x -= gameSpeed * dt;

    if (!obs.hit) {
      const obsRect = { x: obs.x, y: GROUND_Y - obs.height, w: obs.width, h: obs.height };
      if (hitTimer <= 0 && rectsOverlap(dogRect, obsRect)) {
        obs.hit = true;
        obs.scored = true;
        lives--;
        hitTimer = HIT_FLASH_DURATION;
        playHitSound();
        if (lives <= 0) {
          recordScore(getPlayerName(), score);
          state = STATE.GAME_OVER;
          stopMusic();
          setInputLocked(false);
        }
      } else if (!obs.scored && obs.x + obs.width < DOG_X) {
        obs.scored = true;
        score += obs.points;
        playScoreSound();
        if (score >= nextMilestone) {
          playVictoryFanfare();
          state = STATE.VICTORY;
          stopMusic();
        }
      }
    }
  }

  obstacles = obstacles.filter((obs) => obs.x + obs.width > -10);
}

function drawBackground() {
  ctx.fillStyle = '#87ceeb';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.fillStyle = '#5a3a22';
  ctx.fillRect(0, GROUND_Y, WIDTH, HEIGHT - GROUND_Y);

  ctx.strokeStyle = '#3f2814';
  ctx.lineWidth = 2;
  const tickSpacing = 40;
  const offset = distanceTraveled % tickSpacing;
  ctx.beginPath();
  for (let x = -offset; x < WIDTH; x += tickSpacing) {
    ctx.moveTo(x, GROUND_Y);
    ctx.lineTo(x + 15, GROUND_Y);
  }
  ctx.stroke();
}

function drawDog() {
  const flashing = hitTimer > 0 && Math.floor(hitTimer * 10) % 2 === 0;
  const jitterX = hitTimer > 0 ? (Math.random() - 0.5) * 4 : 0;
  const bodyColor = flashing ? '#ff4d4d' : '#8b5a2b';

  ctx.save();
  ctx.translate(jitterX, 0);

  const top = dogY - DOG_HEIGHT;
  const legPhase = Math.floor(distanceTraveled / 20) % 2;
  const legOffset = isAirborne ? 4 : legPhase * 6;

  ctx.fillStyle = bodyColor;
  ctx.fillRect(DOG_X + 6, top + 10, DOG_WIDTH - 16, DOG_HEIGHT - 16);

  ctx.fillRect(DOG_X + 8 + legOffset, top + DOG_HEIGHT - 8, 6, 8);
  ctx.fillRect(DOG_X + DOG_WIDTH - 20 - legOffset, top + DOG_HEIGHT - 8, 6, 8);

  ctx.beginPath();
  ctx.arc(DOG_X + DOG_WIDTH - 8, top + 14, 13, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(DOG_X + DOG_WIDTH - 14, top + 2);
  ctx.lineTo(DOG_X + DOG_WIDTH - 4, top - 6);
  ctx.lineTo(DOG_X + DOG_WIDTH - 2, top + 6);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(DOG_X + 6, top + 14);
  ctx.lineTo(DOG_X - 8, top + 6);
  ctx.lineTo(DOG_X + 4, top + 20);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.arc(DOG_X + DOG_WIDTH - 2, top + 12, 2, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawObstacles() {
  for (const obs of obstacles) {
    ctx.fillStyle = obs.color;
    ctx.fillRect(obs.x, GROUND_Y - obs.height, obs.width, obs.height);
  }
}

function drawHUD() {
  ctx.fillStyle = '#000';
  ctx.font = 'bold 20px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`Lives: ${lives}`, 16, 30);
  ctx.textAlign = 'right';
  ctx.fillText(`Score: ${score}`, WIDTH - 16, 30);
}

function drawCenteredText(lines, startY, lineHeight) {
  ctx.textAlign = 'center';
  lines.forEach((line, i) => {
    ctx.fillText(line, WIDTH / 2, startY + i * lineHeight);
  });
}

function drawLeaderboardLines() {
  const leaderboard = getLeaderboard();
  return leaderboard.length === 0
    ? ['No scores yet - be the first!']
    : leaderboard.map((entry, i) => `${i + 1}. ${entry.name} - ${entry.score}`);
}

function drawStartScreen() {
  drawBackground();
  ctx.fillStyle = '#000';
  ctx.textAlign = 'center';

  let y = 35;
  ctx.font = 'bold 28px sans-serif';
  ctx.fillText('Dog Jump', WIDTH / 2, y);

  ctx.font = '14px sans-serif';
  for (const line of [
    'SPACE to jump - press again in the air to jump higher!',
    'Wooden logs need 1 jump, steel logs need 2',
    'You have 3 lives',
  ]) {
    y += 20;
    ctx.fillText(line, WIDTH / 2, y);
  }

  y += 24;
  ctx.font = 'bold 15px sans-serif';
  ctx.fillText('Leaderboard', WIDTH / 2, y);

  ctx.font = '14px sans-serif';
  for (const line of drawLeaderboardLines()) {
    y += 18;
    ctx.fillText(line, WIDTH / 2, y);
  }

  y += 22;
  ctx.fillText(`Your Best (${getPlayerName()}): ${getPersonalBest(getPlayerName())}`, WIDTH / 2, y);

  y += 30;
  ctx.font = 'bold 17px sans-serif';
  ctx.fillText('Press ENTER to start', WIDTH / 2, y);
}

function drawPauseOverlay() {
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 32px sans-serif';
  drawCenteredText(['Paused'], HEIGHT / 2, 36);
}

function drawVictoryScreen() {
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';

  let y = 45;
  ctx.font = 'bold 26px sans-serif';
  ctx.fillText(`\u{1F389} ${score} Points! \u{1F389}`, WIDTH / 2, y);

  y += 30;
  ctx.font = 'bold 15px sans-serif';
  ctx.fillText('Leaderboard', WIDTH / 2, y);

  ctx.font = '14px sans-serif';
  for (const line of drawLeaderboardLines()) {
    y += 18;
    ctx.fillText(line, WIDTH / 2, y);
  }

  y += 30;
  ctx.font = 'bold 17px sans-serif';
  ctx.fillText('Press ENTER to keep playing', WIDTH / 2, y);
}

function drawGameOverScreen() {
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';

  let y = 40;
  ctx.font = 'bold 28px sans-serif';
  ctx.fillText('Game Over', WIDTH / 2, y);

  y += 28;
  ctx.font = 'bold 16px sans-serif';
  ctx.fillText(`Score: ${score}`, WIDTH / 2, y);

  y += 26;
  ctx.font = 'bold 15px sans-serif';
  ctx.fillText('Leaderboard', WIDTH / 2, y);

  ctx.font = '14px sans-serif';
  for (const line of drawLeaderboardLines()) {
    y += 18;
    ctx.fillText(line, WIDTH / 2, y);
  }

  y += 22;
  ctx.fillText(`Your Best (${getPlayerName()}): ${getPersonalBest(getPlayerName())}`, WIDTH / 2, y);

  y += 30;
  ctx.font = 'bold 17px sans-serif';
  ctx.fillText('Press ENTER to restart', WIDTH / 2, y);
}

function render() {
  if (state === STATE.START) {
    drawStartScreen();
    return;
  }

  drawBackground();
  drawObstacles();
  drawDog();
  drawHUD();

  if (state === STATE.GAME_OVER) {
    drawGameOverScreen();
  } else if (state === STATE.PAUSED) {
    drawPauseOverlay();
  } else if (state === STATE.VICTORY) {
    drawVictoryScreen();
  }
}

let lastTime = null;
function loop(timestamp) {
  if (lastTime === null) lastTime = timestamp;
  const dt = Math.min((timestamp - lastTime) / 1000, 0.033);
  lastTime = timestamp;

  if (state === STATE.PLAYING) {
    update(dt);
  }
  render();

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
