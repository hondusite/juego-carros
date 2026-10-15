// Sin módulos ES: usa el THREE global del <script> clásico.
// Así el juego funciona abriendo index.html con doble clic (file://).
if (typeof THREE === 'undefined') {
  document.getElementById('overlay').innerHTML =
    '<div class="panel"><h1>⚠ Sin conexión</h1>' +
    '<p>No se pudo cargar Three.js desde el CDN.<br>Conéctate a internet y recarga la página.</p></div>';
  throw new Error('THREE no cargado (sin internet o CDN bloqueado)');
}

// ============ CONFIG ============
const ROAD_WIDTH = 14;
const ROAD_HALF = ROAD_WIDTH / 2;
const CHUNK_LENGTH = 100;
const CHUNKS_AHEAD = 6;
const MAX_SPEED = 55;        // m/s ~ 198 km/h
const ACCEL = 22;
const BRAKE = 32;
const FRICTION = 6;
const STEER_SPEED = 16;

// ============ ESTADO ============
let scene, camera, renderer, car, snow, clock;
let keys = {};
let speed = 0;
let distance = 0;
let startTime = 0;
let elapsed = 0;
let playing = false;
let crashed = false;
let chunks = [];      // { group, zStart, obstacles: [{mesh,x,z}] }
let nextChunkZ = 0;
let flashTime = 0;

const speedEl = document.getElementById('speed');
const distanceEl = document.getElementById('distance');
const timeEl = document.getElementById('time');
const overlay = document.getElementById('overlay');
const startBtn = document.getElementById('start-btn');
const warningEl = document.getElementById('damage-warning');

// ============ INIT ============
clock = new THREE.Clock();
init();

function init() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87aacc);
  scene.fog = new THREE.Fog(0x9db8d6, 60, 260);

  camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.1, 800);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.getElementById('game-container').appendChild(renderer.domElement);

  // ---- Luces ----
  const hemi = new THREE.HemisphereLight(0xcfe5ff, 0x6b7f99, 0.9);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff2dd, 1.6);
  sun.position.set(60, 100, 40);
  sun.castShadow = true;
  sun.shadow.camera.left = -60; sun.shadow.camera.right = 60;
  sun.shadow.camera.top = 60; sun.shadow.camera.bottom = -120;
  sun.shadow.camera.far = 400;
  sun.shadow.mapSize.set(2048, 2048);
  scene.add(sun);
  scene.add(sun.target);

  // Mantener el sol siguiendo al auto para que las sombras no se pierdan
  sun.target = new THREE.Object3D();
  scene.add(sun.target);
  window.__sun = sun;

  // ---- Suelo nevado infinito (se reposiciona bajo el auto) ----
  const groundGeo = new THREE.PlaneGeometry(600, 600);
  const groundMat = new THREE.MeshStandardMaterial({ color: 0xe8f1fa, roughness: 0.95 });
  window.__ground = new THREE.Mesh(groundGeo, groundMat);
  window.__ground.rotation.x = -Math.PI / 2;
  window.__ground.receiveShadow = true;
  scene.add(window.__ground);

  car = buildCar();
  scene.add(car);

  snow = buildSnowfall();
  scene.add(snow);

  // Chunks iniciales de carretera + montañas
  nextChunkZ = 60;
  for (let i = 0; i < CHUNKS_AHEAD; i++) addChunk();

  // ---- Controles: teclas de dirección ----
  window.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    if (e.code === 'KeyR') resetGame();
    if (e.code === 'Enter' && !playing) startGame();
  });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });

  window.addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  startBtn.addEventListener('click', startGame);

  animate();
}

// ============ AUTO (todo con Three.js, sin modelos externos) ============
function buildCar() {
  const g = new THREE.Group();

  const paint = new THREE.MeshStandardMaterial({ color: 0xd21f26, metalness: 0.5, roughness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x14181f, metalness: 0.2, roughness: 0.7 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x9fd4ff, metalness: 0.8, roughness: 0.15 });

  // Chasis
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.55, 4.4), paint);
  body.position.y = 0.65;
  body.castShadow = true;
  g.add(body);

  // Morro + alerón
  const nose = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.35, 0.9), paint);
  nose.position.set(0, 0.5, -2.5);
  nose.castShadow = true;
  g.add(nose);

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.55, 2.0), glass);
  cabin.position.set(0, 1.15, 0.3);
  cabin.castShadow = true;
  g.add(cabin);

  const spoiler = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.12, 0.5), dark);
  spoiler.position.set(0, 1.15, 2.2);
  spoiler.castShadow = true;
  g.add(spoiler);
  for (const sx of [-0.8, 0.8]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 0.3), dark);
    leg.position.set(sx, 0.9, 2.2);
    g.add(leg);
  }

  // Faros delanteros (emiten luz real)
  const headMat = new THREE.MeshStandardMaterial({ color: 0xfff6c0, emissive: 0xffedb0, emissiveIntensity: 1.2 });
  for (const sx of [-0.7, 0.7]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.2, 0.1), headMat);
    h.position.set(sx, 0.65, -2.96);
    g.add(h);
  }
  const beams = new THREE.SpotLight(0xfff3c4, 1.8, 60, 0.5, 0.5, 1);
  beams.position.set(0, 1, -2.5);
  beams.target.position.set(0, 0, -30);
  g.add(beams, beams.target);

  // Pilotos traseros
  const tailMat = new THREE.MeshStandardMaterial({ color: 0xaa0000, emissive: 0xff2222, emissiveIntensity: 0.9 });
  const tail = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.18, 0.1), tailMat);
  tail.position.set(0, 0.72, 2.21);
  g.add(tail);

  // Ruedas
  const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.35, 20);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x0c0e12, roughness: 0.9 });
  const hubMat = new THREE.MeshStandardMaterial({ color: 0xb9c4d4, metalness: 0.8, roughness: 0.3 });
  g.userData.wheels = [];
  for (const [x, z] of [[-1.15, -1.45], [1.15, -1.45], [-1.15, 1.45], [1.15, 1.45]]) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.position.set(x, 0.42, z);
    w.castShadow = true;
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.37, 12).rotateZ(Math.PI / 2), hubMat);
    w.add(hub);
    g.add(w);
    g.userData.wheels.push(w);
  }

  g.position.set(0, 0, 0);
  return g;
}

// ============ NIEVE CAYENDO ============
function buildSnowfall() {
  const COUNT = 1500;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(COUNT * 3);
  for (let i = 0; i < COUNT; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 120;
    pos[i * 3 + 1] = Math.random() * 50;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 120;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.25, transparent: true, opacity: 0.9 });
  return new THREE.Points(geo, mat);
}

// ============ TRAMOS DE CARRETERA + MONTAÑAS ============
function addChunk() {
  const group = new THREE.Group();
  const zStart = nextChunkZ;
  const zCenter = zStart - CHUNK_LENGTH / 2; // avanzamos hacia -Z
  const obstacles = [];

  // Asfalto
  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(ROAD_WIDTH, CHUNK_LENGTH),
    new THREE.MeshStandardMaterial({ color: 0x2e3440, roughness: 0.9 })
  );
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0.02, zCenter);
  road.receiveShadow = true;
  group.add(road);

  // Arcenes nevados
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0xf4f8ff, roughness: 1 });
  for (const s of [-1, 1]) {
    const edge = new THREE.Mesh(new THREE.PlaneGeometry(3, CHUNK_LENGTH), edgeMat);
    edge.rotation.x = -Math.PI / 2;
    edge.position.set(s * (ROAD_HALF + 1.5), 0.015, zCenter);
    edge.receiveShadow = true;
    group.add(edge);
  }

  // Línea central discontinua
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xffd75e });
  for (let z = zStart - 5; z > zStart - CHUNK_LENGTH; z -= 12) {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 5), lineMat);
    line.rotation.x = -Math.PI / 2;
    line.position.set(0, 0.035, z);
    group.add(line);
  }

  // Postes laterales con reflectante
  const postGeo = new THREE.CylinderGeometry(0.09, 0.09, 1.4, 8);
  const postMat = new THREE.MeshStandardMaterial({ color: 0xdddddd });
  const reflMat = new THREE.MeshStandardMaterial({ color: 0xff3333, emissive: 0xff3333, emissiveIntensity: 0.8 });
  for (let z = zStart - 8; z > zStart - CHUNK_LENGTH; z -= 20) {
    for (const s of [-1, 1]) {
      const p = new THREE.Mesh(postGeo, postMat);
      p.position.set(s * (ROAD_HALF + 0.7), 0.7, z);
      p.castShadow = true;
      const r = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), reflMat);
      r.position.y = 0.55;
      p.add(r);
      group.add(p);
    }
  }

  // Montañas nevadas a ambos lados (conos + cima blanca)
  for (let i = 0; i < 7; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const mx = side * (28 + Math.random() * 55);
    const mz = zStart - Math.random() * CHUNK_LENGTH;
    const mh = 28 + Math.random() * 45;
    const mr = 18 + Math.random() * 22;

    const rock = new THREE.Mesh(
      new THREE.ConeGeometry(mr, mh, 6),
      new THREE.MeshStandardMaterial({ color: 0x5a6b84, roughness: 1, flatShading: true })
    );
    rock.position.set(mx, mh / 2 - 2, mz);
    group.add(rock);

    const capH = mh * 0.38;
    const cap = new THREE.Mesh(
      new THREE.ConeGeometry(mr * 0.38, capH, 6),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true })
    );
    cap.position.set(mx, mh - 2 - capH / 2, mz);
    group.add(cap);
  }

  // Pinos nevados cerca de la vía
  for (let i = 0; i < 14; i++) {
    const side = Math.random() < 0.5 ? -1 : 1;
    const tx = side * (ROAD_HALF + 4 + Math.random() * 18);
    const tz = zStart - Math.random() * CHUNK_LENGTH;
    group.add(buildPine(tx, tz));
  }

  // Obstáculos sobre la calzada: rocas + autos rivales
  const nObs = 2 + Math.floor(Math.random() * 2);
  for (let i = 0; i < nObs; i++) {
    const ox = (Math.random() - 0.5) * (ROAD_WIDTH - 3);
    const oz = zStart - 20 - Math.random() * (CHUNK_LENGTH - 30);
    if (Math.random() < 0.5) {
      const rock = new THREE.Mesh(
        new THREE.DodecahedronGeometry(0.7 + Math.random() * 0.5, 0),
        new THREE.MeshStandardMaterial({ color: 0x8a93a3, roughness: 1, flatShading: true })
      );
      rock.position.set(ox, 0.5, oz);
      rock.castShadow = true;
      group.add(rock);
      obstacles.push({ mesh: rock, x: ox, z: oz, r: 1.1 });
    } else {
      const rival = buildRival();
      rival.position.set(ox, 0, oz);
      group.add(rival);
      obstacles.push({ mesh: rival, x: ox, z: oz, r: 1.6 });
    }
  }

  scene.add(group);
  chunks.push({ group, zStart, obstacles });
  nextChunkZ -= CHUNK_LENGTH;
}

function buildPine(x, z) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.25, 0.35, 1.2, 8),
    new THREE.MeshStandardMaterial({ color: 0x5a3b26, roughness: 1 })
  );
  trunk.position.y = 0.6;
  trunk.castShadow = true;
  g.add(trunk);

  const greens = [0x2d5a3d, 0x35704a];
  let y = 1.6;
  for (let i = 0; i < 3; i++) {
    const r = 1.6 - i * 0.4;
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(r, 1.6, 8),
      new THREE.MeshStandardMaterial({ color: greens[i % 2], roughness: 1, flatShading: true })
    );
    cone.position.y = y;
    cone.castShadow = true;
    g.add(cone);
    const snowCap = new THREE.Mesh(
      new THREE.ConeGeometry(r * 0.55, 0.7, 8),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true })
    );
    snowCap.position.y = y + 0.45;
    g.add(snowCap);
    y += 1.1;
  }
  g.position.set(x, 0, z);
  const s = 0.8 + Math.random() * 0.9;
  g.scale.setScalar(s);
  return g;
}

function buildRival() {
  const g = new THREE.Group();
  const colors = [0x2266cc, 0xe08800, 0x22aa88, 0x8833cc];
  const c = colors[Math.floor(Math.random() * colors.length)];
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(2.1, 0.6, 4.2),
    new THREE.MeshStandardMaterial({ color: c, metalness: 0.4, roughness: 0.4 })
  );
  body.position.y = 0.6;
  body.castShadow = true;
  g.add(body);
  const cab = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 0.5, 1.8),
    new THREE.MeshStandardMaterial({ color: 0x10151d, roughness: 0.3, metalness: 0.5 })
  );
  cab.position.set(0, 1.1, 0.2);
  g.add(cab);
  const wg = new THREE.CylinderGeometry(0.4, 0.4, 0.32, 14);
  wg.rotateZ(Math.PI / 2);
  const wm = new THREE.MeshStandardMaterial({ color: 0x0c0e12 });
  for (const [x, z] of [[-1.05, -1.4], [1.05, -1.4], [-1.05, 1.4], [1.05, 1.4]]) {
    const w = new THREE.Mesh(wg, wm);
    w.position.set(x, 0.4, z);
    g.add(w);
  }
  // Mira en dirección contraria (viene hacia el jugador visualmente parado)
  g.rotation.y = Math.PI;
  return g;
}

// ============ JUEGO ============
// Textos originales del panel (para restaurarlos al reiniciar)
const panelTitle = document.querySelector('#overlay .panel h1');
const panelTip = document.querySelector('#overlay .panel .tip');
const ORIG_TITLE = panelTitle.textContent;
const ORIG_TIP = panelTip.innerHTML;
const ORIG_BTN = startBtn.textContent;

function startGame() {
  if (crashed) { resetGame(); return; }
  overlay.classList.add('hidden');
  if (!playing) {
    playing = true;
    startTime = performance.now() - elapsed;
  }
}

function gameOver() {
  crashed = true;
  playing = false;
  speed = 0;
  renderer.domElement.style.filter = 'none';
  warningEl.style.display = 'none';
  panelTitle.textContent = '💥 ¡CHOCASTE! 🏔';
  panelTip.innerHTML = `Recorriste <b>${Math.round(distance)} m</b> en <b>${formatTime(elapsed)}</b>.<br>Pulsa el botón o <kbd>R</kbd> para intentarlo de nuevo.`;
  startBtn.textContent = 'JUGAR DE NUEVO';
  overlay.classList.remove('hidden');
}

function resetGame() {
  speed = 0; distance = 0; elapsed = 0;
  crashed = false;
  flashTime = 0;
  renderer.domElement.style.filter = 'none';
  car.position.set(0, 0, 0);
  car.rotation.set(0, 0, 0);
  for (const c of chunks) { scene.remove(c.group); }
  chunks = [];
  nextChunkZ = 60;
  for (let i = 0; i < CHUNKS_AHEAD; i++) addChunk();
  startTime = performance.now();
  panelTitle.textContent = ORIG_TITLE;
  panelTip.innerHTML = ORIG_TIP;
  startBtn.textContent = ORIG_BTN;
  overlay.classList.add('hidden');
  playing = true;
}

// ============ BUCLE ============
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

  if (playing) update(dt);
  updateSnow(dt);
  updateCamera(dt);

  // Suelo y sol siguen al auto
  window.__ground.position.set(car.position.x, 0, car.position.z - 40);
  window.__sun.position.set(car.position.x + 60, 100, car.position.z + 40);
  window.__sun.target.position.set(car.position.x, 0, car.position.z - 40);

  renderer.render(scene, camera);
}

function update(dt) {
  // ---- Aceleración / freno ----
  const offRoad = Math.abs(car.position.x) > ROAD_HALF + 0.4;
  if (keys['ArrowUp']) speed += ACCEL * dt;
  else if (keys['ArrowDown']) speed -= (speed > 1 ? BRAKE : ACCEL * 0.6) * dt;
  else {
    // fricción natural
    speed -= Math.sign(speed) * FRICTION * dt;
    if (Math.abs(speed) < 0.3) speed = 0;
  }
  if (offRoad && Math.abs(speed) > 8) speed -= Math.sign(speed) * 18 * dt; // la nieve frena
  speed = THREE.MathUtils.clamp(speed, -12, MAX_SPEED);

  // ---- Dirección (solo se gira bien en movimiento) ----
  const steerFactor = THREE.MathUtils.clamp(Math.abs(speed) / 12, 0, 1);
  let steer = 0;
  if (keys['ArrowLeft']) steer -= 1;
  if (keys['ArrowRight']) steer += 1;
  car.position.x += steer * STEER_SPEED * steerFactor * dt * (speed >= 0 ? 1 : -1);
  car.position.x = THREE.MathUtils.clamp(car.position.x, -60, 60);
  // Inclinación visual al girar
  const targetTilt = -steer * 0.12 * steerFactor;
  car.rotation.z += (targetTilt - car.rotation.z) * 8 * dt;
  car.rotation.y = -steer * 0.18 * steerFactor;

  // ---- Avance ----
  car.position.z -= speed * dt;
  distance += Math.max(0, speed * dt);

  // Ruedas giran con la velocidad
  for (const w of car.userData.wheels) w.rotation.x -= speed * dt * 1.8;

  // ---- Reciclar chunks ----
  while (car.position.z < nextChunkZ + CHUNK_LENGTH * (CHUNKS_AHEAD - 2)) addChunk();
  while (chunks.length && chunks[0].zStart - CHUNK_LENGTH > car.position.z + 80) {
    const old = chunks.shift();
    scene.remove(old.group);
  }

  // ---- Colisiones: chocar detiene el juego ----
  flashTime = Math.max(0, flashTime - dt);
  for (const c of chunks) {
    for (const o of c.obstacles) {
      const dx = car.position.x - o.x;
      const dz = car.position.z - o.z;
      if (Math.abs(dx) < o.r + 1 && Math.abs(dz) < o.r + 2) {
        gameOver();
        return;
      }
    }
  }

  // ---- HUD ----
  speedEl.textContent = Math.round(Math.abs(speed) * 3.6);
  distanceEl.textContent = Math.round(distance);
  elapsed = performance.now() - startTime;
  timeEl.textContent = formatTime(elapsed);
  warningEl.style.display = offRoad && Math.abs(speed) > 2 ? 'block' : 'none';

  // Parpadeo rojo al chocar
  renderer.domElement.style.filter = flashTime > 0 && Math.floor(flashTime * 10) % 2 === 0
    ? 'brightness(1.6) saturate(0.4)'
    : 'none';
}

function updateSnow(dt) {
  const p = snow.geometry.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let y = p.getY(i) - (8 + (i % 5)) * dt;
    let x = p.getX(i) + Math.sin(performance.now() * 0.001 + i) * dt * 2;
    if (y < 0) y = 50;
    p.setY(i, y);
    p.setX(i, x);
  }
  p.needsUpdate = true;
  // La nevada acompaña al auto
  snow.position.set(car.position.x, 0, car.position.z - 30);
}

function updateCamera(dt) {
  const target = new THREE.Vector3(
    car.position.x * 0.55,
    5.2,
    car.position.z + 9.5
  );
  camera.position.lerp(target, 1 - Math.pow(0.001, dt));
  camera.lookAt(car.position.x * 0.8, 1.2, car.position.z - 12);
}

function formatTime(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
