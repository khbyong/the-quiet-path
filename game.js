// test game — game boy-ish micro-journey
// no external assets, no network. just canvas.

(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const noteEl = document.getElementById('note');

  // Game Boy-ish palette
  const PAL = {
    0: '#0f1a13',
    1: '#2b3f2e',
    2: '#6b8f4e',
    3: '#cfe4a8'
  };

  const W = canvas.width;
  const H = canvas.height;
  const TILE = 16;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const keys = new Set();
  let muted = false;

  // touch controls
  const btnA = document.getElementById('btnA');
  const btnRun = document.getElementById('btnRun');
  const dpad = document.getElementById('dpad');

  function touchHold(key, el) {
    if (!el) return;
    const down = (e) => { e.preventDefault(); keys.add(key); };
    const up = (e) => { e.preventDefault(); keys.delete(key); };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', up);
  }

  if (dpad) {
    dpad.querySelectorAll('button[data-dir]').forEach((b) => {
      const dir = b.getAttribute('data-dir');
      const key = 'arrow' + dir;
      touchHold(key, b);
    });
  }

  if (btnRun) {
    touchHold('z', btnRun);
  }

  if (btnA) {
    // A is a tap (space)
    btnA.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      keys.add('space');
      setTimeout(() => keys.delete('space'), 30);
    });
  }

  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (['arrowup','arrowdown','arrowleft','arrowright',' ','z','m','r'].includes(k) || e.code === 'Space') e.preventDefault();
    if (e.code === 'Space') keys.add('space');
    else keys.add(k);

    if (k === 'm') { muted = !muted; beep(0, 0); showNote(muted ? 'muted' : 'sound on'); }
    if (k === 'r') { reset(); }
  }, { passive: false });

  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (e.code === 'Space') keys.delete('space');
    else keys.delete(k);
  });

  // Tiny synthesizer
  let audio;
  function ensureAudio() {
    if (audio) return;
    audio = new (window.AudioContext || window.webkitAudioContext)();
  }

  function beep(freq = 440, durMs = 50, type = 'square', gain = 0.02) {
    if (muted) return;
    try {
      ensureAudio();
      const t0 = audio.currentTime;
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.type = type;
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain, t0 + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + durMs / 1000);
      o.connect(g);
      g.connect(audio.destination);
      o.start(t0);
      o.stop(t0 + durMs / 1000);
    } catch {}
  }

  function chord() {
    beep(523.25, 70, 'square', 0.02);
    setTimeout(() => beep(659.25, 70, 'square', 0.02), 25);
    setTimeout(() => beep(783.99, 70, 'square', 0.02), 50);
  }

  // Map tiles
  // 0 grass, 1 path, 2 water, 3 stone, 4 fence, 5 flowers, 6 door
  const TILE_COL = {
    0: 1,
    1: 2,
    2: 0,
    3: 2,
    4: 1,
    5: 3,
    6: 3
  };

  const SOLID = new Set([2,4,3]);

  function makeMap() {
    const cols = Math.floor(W / TILE);
    const rows = Math.floor(H / TILE);
    const m = Array.from({ length: rows }, () => Array(cols).fill(0));

    // water band top-ish
    for (let y = 2; y <= 3; y++) {
      for (let x = 2; x < cols - 2; x++) m[y][x] = 2;
    }

    // village fences
    for (let x = 3; x < cols - 3; x++) {
      m[rows - 6][x] = 4;
    }

    // path up to hill
    const px = Math.floor(cols / 2);
    for (let y = rows - 2; y >= 1; y--) {
      m[y][px] = 1;
      if (y % 3 === 0) {
        m[y][px - 1] = 1;
        m[y][px + 1] = 1;
      }
    }

    // stones near water
    m[4][px - 2] = 3;
    m[4][px + 2] = 3;

    // flowers by path
    for (let i = 0; i < 16; i++) {
      const x = clamp(px + (Math.random() < 0.5 ? -2 : 2) + (Math.random() < 0.25 ? (Math.random() < 0.5 ? -1 : 1) : 0), 1, cols - 2);
      const y = clamp(rows - 3 - Math.floor(Math.random() * 10), 5, rows - 3);
      if (m[y][x] === 0) m[y][x] = 5;
    }

    // little door (a home)
    m[rows - 5][px - 5] = 6;

    return m;
  }

  const NAMES = { a: 'kai', b: 'june' };

  // Story + triggers
  const story = {
    phase: 0,
    dialogQueue: [],
    inDialog: false,
    currentLine: '',
    ended: false,
    endFade: 0,
    flags: {
      met: false,
      byDoor: false,
      atBridge: false,
      atHill: false,
      ending: false
    }
  };

  const player = {
    x: W / 2,
    y: H - 40,
    w: 10,
    h: 12,
    dir: 'up',
    speed: 1.2
  };

  const companion = {
    x: player.x - 18,
    y: player.y + 6,
    w: 10,
    h: 12,
    speed: 1.1,
    active: true
  };

  let map = makeMap();

  // UI
  function showNote(text) {
    noteEl.hidden = false;
    noteEl.textContent = text;
    clearTimeout(showNote._t);
    showNote._t = setTimeout(() => (noteEl.hidden = true), 1400);
  }

  function queueDialog(lines) {
    story.dialogQueue = lines.slice();
    story.inDialog = true;
    chord();
  }

  function nextDialog() {
    if (!story.inDialog) return;
    if (story.dialogQueue.length === 0) {
      story.inDialog = false;
      // if we just finished the final sequence, fade out
      if (story.flags.ending && !story.ended) startEnding();
      return;
    }
    story.currentLine = story.dialogQueue.shift();
    beep(587.33, 40, 'square', 0.015);
  }

  function start() {
    queueDialog([
      'you step out quietly.',
      'the air is cool — like the day is holding its breath.',
      'someone is waiting by the path.'
    ]);
    nextDialog();
  }

  function reset() {
    map = makeMap();
    player.x = W / 2;
    player.y = H - 40;
    player.dir = 'up';
    companion.x = player.x - 18;
    companion.y = player.y + 6;
    story.phase = 0;
    story.inDialog = false;
    story.dialogQueue = [];
    story.currentLine = '';
    story.flags = { met:false, byDoor:false, atBridge:false, atHill:false, ending:false };
    showNote('restarted');
    start();
  }

  // Physics
  function rectsOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function tileAt(px, py) {
    const tx = Math.floor(px / TILE);
    const ty = Math.floor(py / TILE);
    if (ty < 0 || tx < 0 || ty >= map.length || tx >= map[0].length) return 3;
    return map[ty][tx];
  }

  function canMoveTo(nx, ny, ent) {
    const pts = [
      [nx, ny],
      [nx + ent.w, ny],
      [nx, ny + ent.h],
      [nx + ent.w, ny + ent.h]
    ];
    for (const [x, y] of pts) {
      const t = tileAt(x, y);
      if (SOLID.has(t)) return false;
    }
    return true;
  }

  // Draw helpers
  function fill(c) {
    ctx.fillStyle = c;
    ctx.fillRect(0, 0, W, H);
  }

  function drawTile(t, x, y) {
    const px = x * TILE;
    const py = y * TILE;

    // base
    ctx.fillStyle = PAL[1];
    ctx.fillRect(px, py, TILE, TILE);

    if (t === 0) {
      // grass speckle
      ctx.fillStyle = PAL[2];
      if (((x + y) % 3) === 0) ctx.fillRect(px + 2, py + 10, 2, 2);
      if (((x * 2 + y) % 5) === 0) ctx.fillRect(px + 11, py + 4, 2, 2);
    }

    if (t === 1) {
      // path
      ctx.fillStyle = PAL[2];
      ctx.fillRect(px, py, TILE, TILE);
      ctx.fillStyle = PAL[1];
      if (x % 2 === 0) ctx.fillRect(px + 1, py + 6, 2, 2);
      if (y % 2 === 1) ctx.fillRect(px + 12, py + 11, 2, 2);
    }

    if (t === 2) {
      // water
      ctx.fillStyle = PAL[0];
      ctx.fillRect(px, py, TILE, TILE);
      ctx.fillStyle = PAL[1];
      if ((x + y) % 2 === 0) ctx.fillRect(px + 2, py + 6, 12, 2);
      if ((x + y) % 3 === 0) ctx.fillRect(px + 4, py + 10, 8, 1);
    }

    if (t === 3) {
      // stones
      ctx.fillStyle = PAL[0];
      ctx.fillRect(px, py, TILE, TILE);
      ctx.fillStyle = PAL[1];
      ctx.fillRect(px + 2, py + 3, 12, 10);
      ctx.fillStyle = PAL[0];
      ctx.fillRect(px + 4, py + 5, 2, 2);
      ctx.fillRect(px + 10, py + 9, 3, 2);
    }

    if (t === 4) {
      // fence
      ctx.fillStyle = PAL[1];
      ctx.fillRect(px, py, TILE, TILE);
      ctx.fillStyle = PAL[0];
      ctx.fillRect(px + 1, py + 7, 14, 2);
      ctx.fillRect(px + 3, py + 3, 2, 10);
      ctx.fillRect(px + 11, py + 3, 2, 10);
    }

    if (t === 5) {
      // flowers
      ctx.fillStyle = PAL[1];
      ctx.fillRect(px, py, TILE, TILE);
      ctx.fillStyle = PAL[2];
      ctx.fillRect(px + 4, py + 10, 8, 3);
      ctx.fillStyle = PAL[3];
      ctx.fillRect(px + 6, py + 8, 2, 2);
      ctx.fillRect(px + 9, py + 7, 2, 2);
    }

    if (t === 6) {
      // door / home marker
      ctx.fillStyle = PAL[2];
      ctx.fillRect(px, py, TILE, TILE);
      ctx.fillStyle = PAL[0];
      ctx.fillRect(px + 5, py + 4, 6, 10);
      ctx.fillStyle = PAL[3];
      ctx.fillRect(px + 9, py + 9, 1, 1);
    }
  }

  function drawMap() {
    for (let y = 0; y < map.length; y++) {
      for (let x = 0; x < map[0].length; x++) {
        drawTile(map[y][x], x, y);
      }
    }

    // tiny bridge over water (visual only)
    const cols = map[0].length;
    const px = Math.floor(cols / 2);
    const by = 2;
    ctx.fillStyle = PAL[2];
    ctx.fillRect(px * TILE - 8, by * TILE + 6, 32, 4);
    ctx.fillStyle = PAL[1];
    ctx.fillRect(px * TILE - 8, by * TILE + 5, 32, 1);
    ctx.fillRect(px * TILE - 8, by * TILE + 10, 32, 1);
  }

  function drawPerson(ent, style = 0) {
    // style 0: player, 1: companion
    const x = Math.round(ent.x);
    const y = Math.round(ent.y);

    // shadow
    ctx.fillStyle = PAL[0];
    ctx.globalAlpha = 0.25;
    ctx.fillRect(x - 1, y + ent.h + 1, ent.w + 2, 2);
    ctx.globalAlpha = 1;

    // body
    ctx.fillStyle = style === 0 ? PAL[3] : PAL[2];
    ctx.fillRect(x, y, ent.w, ent.h);

    // face
    ctx.fillStyle = PAL[1];
    ctx.fillRect(x + 2, y + 2, ent.w - 4, 3);

    // hair / accent
    ctx.fillStyle = PAL[0];
    ctx.fillRect(x + 1, y, ent.w - 2, 2);

    // feet
    ctx.fillStyle = PAL[0];
    ctx.fillRect(x + 2, y + ent.h - 1, 2, 1);
    ctx.fillRect(x + ent.w - 4, y + ent.h - 1, 2, 1);
  }

  function drawDialogBox(text) {
    const pad = 10;
    const boxH = 72;
    const x = 12;
    const y = H - boxH - 12;
    const w = W - 24;
    const h = boxH;

    ctx.fillStyle = PAL[0];
    ctx.globalAlpha = 0.86;
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 1;

    ctx.strokeStyle = PAL[2];
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);

    ctx.fillStyle = PAL[3];
    ctx.font = '12px ui-monospace, monospace';

    const lines = wrap(text, 38);
    for (let i = 0; i < Math.min(lines.length, 3); i++) {
      ctx.fillText(lines[i], x + pad, y + 22 + i * 16);
    }

    // prompt
    ctx.fillStyle = PAL[2];
    ctx.fillText('space', x + w - 62, y + h - 14);
  }

  function wrap(str, max) {
    const words = String(str || '').split(' ');
    const out = [];
    let line = '';
    for (const w of words) {
      const t = line ? line + ' ' + w : w;
      if (t.length > max) {
        out.push(line);
        line = w;
      } else {
        line = t;
      }
    }
    if (line) out.push(line);
    return out;
  }

  // Triggers
  function updateStory() {
    const cols = map[0].length;
    const px = Math.floor(cols / 2);

    const nearDoor = tileAt(player.x, player.y) === 6 || tileAt(player.x + player.w, player.y + player.h) === 6;

    // meet companion
    if (!story.flags.met && player.y > H - 80) {
      story.flags.met = true;
      queueDialog([
        `“hey.”`,
        `“morning, ${NAMES.a}.”`,
        '“couldn’t sleep?”',
        `“not really.”`,
        `“ok. walk with me.”`
      ]);
      nextDialog();
    }

    if (!story.flags.byDoor && nearDoor) {
      story.flags.byDoor = true;
      queueDialog([
        'the door sticks for a second, then gives.',
        'a scrap of paper is caught underneath:',
        '“go easy. it’s still you.”'
      ]);
      nextDialog();
    }

    // bridge (water band)
    if (!story.flags.atBridge && player.y < TILE * 5) {
      story.flags.atBridge = true;
      queueDialog([
        'you pause at the bridge.',
        'the water keeps moving like it has somewhere to be.',
        `“do you ever feel like we’re… late?”`,
        `“late for what?”`,
        `“for the version of us that had more time.”`,
        `“hey.” ${NAMES.b} bumps your shoulder. “we’re here.”`
      ]);
      nextDialog();
    }

    // hill top
    if (!story.flags.atHill && player.y < TILE * 2) {
      story.flags.atHill = true;
      queueDialog([
        'at the hill, the town looks small enough to forgive you.',
        `“${NAMES.a}… if we come back, it won’t be like this.”`,
        '“i know.”',
        `“and if we don’t come back?”`,
        `you breathe in. “then this counts.”`,
        `${NAMES.b} nods like they’re memorising your face.`
      ]);
      nextDialog();
    }

    // ending: walk back down a bit after hill
    if (!story.flags.ending && story.flags.atHill && player.y > TILE * 6) {
      story.flags.ending = true;
      queueDialog([
        'on the way back, you don’t talk as much.',
        'it’s not awkward. it’s careful.',
        `${NAMES.b} reaches for your hand — just once. just enough.`,
        '“text me when you get home.”',
        '“i will.”',
        'the promise lands softly, like a coat over your shoulders.'
      ]);
      nextDialog();
    }
  }

  function startEnding() {
    story.ended = true;
    story.endFade = 0;
    chord();
  }

  // Movement
  function update(dt) {
    // dialog control
    if (keys.has('space')) {
      keys.delete('space');
      if (story.inDialog) {
        nextDialog();
      } else {
        // small interaction beep
        beep(440, 35, 'square', 0.01);
      }
    }

    if (story.ended) {
      story.endFade = clamp(story.endFade + dt * 0.55, 0, 1);
      return;
    }

    const run = keys.has('z');
    const sp = (run ? 1.8 : 1) * player.speed;

    if (!story.inDialog) {
      let vx = 0, vy = 0;
      if (keys.has('arrowleft')) { vx = -sp; player.dir = 'left'; }
      if (keys.has('arrowright')) { vx = sp; player.dir = 'right'; }
      if (keys.has('arrowup')) { vy = -sp; player.dir = 'up'; }
      if (keys.has('arrowdown')) { vy = sp; player.dir = 'down'; }

      const nx = player.x + vx;
      const ny = player.y + vy;

      if (canMoveTo(nx, player.y, player)) player.x = nx;
      if (canMoveTo(player.x, ny, player)) player.y = ny;

      player.x = clamp(player.x, 2, W - player.w - 2);
      player.y = clamp(player.y, 2, H - player.h - 2);

      // companion follows
      if (companion.active) {
        const tx = player.x - 14;
        const ty = player.y + 6;
        const dx = tx - companion.x;
        const dy = ty - companion.y;
        const d = Math.hypot(dx, dy);
        if (d > 1) {
          const sx = (dx / d) * companion.speed;
          const sy = (dy / d) * companion.speed;
          const cnx = companion.x + sx;
          const cny = companion.y + sy;
          if (canMoveTo(cnx, companion.y, companion)) companion.x = cnx;
          if (canMoveTo(companion.x, cny, companion)) companion.y = cny;
        }
      }

      updateStory();
    }
  }

  function render() {
    fill(PAL[0]);
    drawMap();

    // draw folks (companion first)
    drawPerson(companion, 1);
    drawPerson(player, 0);

    // vignette
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, 12);
    ctx.fillRect(0, 0, 12, H);
    ctx.fillRect(W - 12, 0, 12, H);
    ctx.fillRect(0, H - 12, W, 12);
    ctx.globalAlpha = 1;

    if (story.inDialog && story.currentLine) {
      drawDialogBox(story.currentLine);
    }

    // ending overlay
    if (story.ended) {
      const a = clamp(story.endFade, 0, 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = PAL[0];
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = a;
      ctx.fillStyle = PAL[3];
      ctx.font = '12px ui-monospace, monospace';

      const lines = [
        `thanks for walking with ${NAMES.a} & ${NAMES.b}.`,
        '',
        'some things don’t become official.',
        'they just become real.',
        '',
        'press r to restart'
      ];
      const startY = 96;
      lines.forEach((ln, i) => {
        const w = ctx.measureText(ln).width;
        ctx.fillText(ln, (W - w) / 2, startY + i * 18);
      });
      ctx.globalAlpha = 1;
    }

    // tiny HUD
    ctx.fillStyle = PAL[2];
    ctx.font = '10px ui-monospace, monospace';
    ctx.fillText(muted ? 'm: muted' : 'm: sound', 10, 14);
  }

  // Loop
  let last = performance.now();
  function loop(t) {
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    update(dt);
    render();
    requestAnimationFrame(loop);
  }

  // boot
  function boot() {
    showNote('space to talk');
    start();
    requestAnimationFrame(loop);
  }

  boot();
})();
