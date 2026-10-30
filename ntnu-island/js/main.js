import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { THEMES, ISLETS, SOURCES, INTRO, ICONS } from './data.js?v=28';

// ---------- renderer / scene ----------
const canvas = document.getElementById('scene');
const stage = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xcfe6ea, 90, 220);
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 600);
// phones get a farther, higher overview so the whole archipelago fits the tall viewport
const NARROW = window.innerWidth <= 760;
const HOME = { pos: NARROW ? new THREE.Vector3(0, 120, 105) : new THREE.Vector3(0, 70, 92), target: new THREE.Vector3(0, 0, NARROW ? 6 : 2) };
const BIRD = { pos: new THREE.Vector3(0, 125, 8), target: new THREE.Vector3(0, 0, 0) };
camera.position.copy(HOME.pos);

const controls = new OrbitControls(camera, canvas);
controls.target.copy(HOME.target);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.maxPolarAngle = Math.PI * 0.44;
controls.minDistance = 10;
controls.maxDistance = 170;
controls.autoRotateSpeed = 0.5;

const hemi = new THREE.HemisphereLight(0xfff4e2, 0x6fa3a8, 1.0);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 2.0);
sun.position.set(45, 70, 30);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -75, right: 75, top: 75, bottom: -75, near: 1, far: 220 });
sun.shadow.bias = -0.0005;
scene.add(sun);

// ---------- helpers ----------
const C = {
  sand: 0xf3e2c0, grass: 0xaecb8a, grass2: 0x95bd77, rock: 0xd9c7a8, rockDark: 0xb9a586,
  brick: 0xc65f3d, brickDark: 0xa64c30, trim: 0xf6eee2, roof: 0x6c5b55, slate: 0x5f6f7f,
  wood: 0x9b6b45, leaf: 0x7fb069, leaf2: 0x5f9e5c, leaf3: 0xb5d17a, blossom: 0xf4b6b0,
  white: 0xfbf7ef, glass: 0x8fc3d9, gold: 0xf1b73b, blue: 0x3d5a80, navy: 0x2b3a55,
  water: 0x79c3c4, shallow: 0xa9e0d6, path: 0xead7b8,
};
const mats = new Map();
function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!mats.has(key)) mats.set(key, new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, ...opts }));
  return mats.get(key);
}
// window glass that glows at night
const windowMat = new THREE.MeshStandardMaterial({ color: 0x7fa9c4, emissive: 0xffc46b, emissiveIntensity: 0, flatShading: true, roughness: 0.4 });
windowMat.side = THREE.DoubleSide;
const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff1c9, emissive: 0xffd27a, emissiveIntensity: 0.2 });

function mesh(geo, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// wobble a cylinder outline with integer-frequency noise so the seam stays closed
function wobbleK(a, amp, seed) {
  return 1 + amp * (Math.sin(a * 2 + seed) * 0.5 + Math.sin(a * 3 + seed * 1.7) * 0.35 + Math.sin(a * 5 + seed * 2.3) * 0.15);
}
function wobble(geo, amp, seed) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const k = wobbleK(Math.atan2(z, x), amp, seed);
    p.setX(i, x * k); p.setZ(i, z * k);
  }
  geo.computeVertexNormals();
  return geo;
}
function prism(w, h, len) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(0, h); s.lineTo(-w / 2, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: false });
  g.translate(0, 0, -len / 2);
  return g;
}
const TOP = 0.75; // grass surface height
const animators = [];
const solids = []; // props (besides layered buildings) the walking avatar can't pass through
const platforms = []; // low boxes the avatar can step onto (stands, podium, plinth)

// ---------- props ----------
function tree(kind = 0, s = 1) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.8, 5), mat(C.wood), 0, 0.4, 0));
  if (kind === 0) {
    g.add(mesh(new THREE.ConeGeometry(0.75, 1.5, 6), mat(C.leaf2), 0, 1.3, 0));
    g.add(mesh(new THREE.ConeGeometry(0.55, 1.1, 6), mat(C.leaf2), 0, 1.95, 0));
  } else if (kind === 1) {
    g.add(mesh(new THREE.IcosahedronGeometry(0.8, 0), mat(C.leaf), 0, 1.35, 0));
  } else if (kind === 2) {
    g.add(mesh(new THREE.IcosahedronGeometry(0.7, 0), mat(C.leaf3), 0, 1.25, 0));
    g.add(mesh(new THREE.IcosahedronGeometry(0.45, 0), mat(C.leaf3), 0.35, 1.75, 0.1));
  } else {
    g.add(mesh(new THREE.IcosahedronGeometry(0.75, 0), mat(C.blossom), 0, 1.35, 0));
  }
  g.scale.setScalar(s);
  g.rotation.y = Math.random() * Math.PI;
  return g;
}
function scatterTrees(group, r, n, seed, avoid = []) {
  const rand = rng(seed);
  let placed = 0, tries = 0;
  while (placed < n && tries < n * 30) {
    tries++;
    const a = rand() * Math.PI * 2, d = r * (0.45 + rand() * 0.42);
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (avoid.some(([ax, az, ar]) => (x - ax) ** 2 + (z - az) ** 2 < ar * ar)) continue;
    const t = tree(Math.floor(rand() * 4), 0.7 + rand() * 0.6);
    t.position.set(x, TOP, z);
    group.add(t);
    placed++;
  }
}
function person(color, s = 1) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.5, 6), mat(color), 0, 0.25, 0));
  g.add(mesh(new THREE.SphereGeometry(0.15, 8, 6), mat(0xf2c9a0), 0, 0.64, 0));
  g.add(mesh(new THREE.SphereGeometry(0.155, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x3b2a20), 0, 0.68, 0));
  g.scale.setScalar(s);
  return g;
}
// standing students who chat and look around (see crowd system below)
function people(group, spots, seed) {
  const rand = rng(seed);
  spots.forEach(([x, z]) => addPerson({ kind: 'idle', anchor: group, x, z, yaw: rand() * Math.PI * 2, seed: seed * 101 + x * 7 + z }));
}
function chatGroup(group, cx, cz, n, seed, y = TOP) {
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + seed;
    addPerson({ kind: 'idle', anchor: group, x: cx + Math.cos(a) * 0.45, z: cz + Math.sin(a) * 0.45, face: [cx, cz], y, seed: seed * 31 + k });
  }
}
function wanderers(group, cx, cz, R, n, seed) {
  const rand = rng(seed);
  for (let k = 0; k < n; k++) {
    const a = rand() * Math.PI * 2, rr = Math.sqrt(rand()) * R;
    addPerson({ kind: 'wander', anchor: group, cx, cz, R, x: cx + Math.cos(a) * rr, z: cz + Math.sin(a) * rr, seed: seed * 17 + k });
  }
}
function walkers(group, ax, az, bx, bz, n, seed, opts = {}) {
  for (let k = 0; k < n; k++) {
    addPerson({ kind: 'line', anchor: group, ax, az, bx, bz, lane: opts.lane ?? 0.3, speed: 0.55 + ((k * 37) % 10) * 0.04, ph: (k / n) * 2 + seed * 0.13, yAt: opts.yAt, seed: seed * 13 + k });
  }
}
function textTexture(text, { w = 1024, h = 160, bg = '#f6eee2', fg = '#a64c30', weight = 900 } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const draw = () => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = fg;
    g.font = `${weight} ${Math.round(h * 0.6)}px "Noto Sans TC", "PingFang TC", sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + h * 0.03, w * 0.94);
    tex.needsUpdate = true;
  };
  draw();
  // the web font may arrive after the scene is built: redraw once it has loaded
  document.fonts?.load(`${weight} 40px "Noto Sans TC"`, text).then(draw).catch(() => {});
  return tex;
}
function bunting(group, a, b, n, sag = 0.4) {
  const cols = [0xd6643c, 0xf1b73b, 0x3d5a80, 0x6aa36f, 0xfaf6ee];
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const p = new THREE.Vector3().lerpVectors(A, B, u);
    p.y -= Math.sin(u * Math.PI) * sag;
    pts.push(p);
  }
  group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x4a4038 })));
  const tri = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.13, 0, 0), new THREE.Vector3(0.13, 0, 0), new THREE.Vector3(0, -0.3, 0)]);
  tri.computeVertexNormals();
  const ry = -Math.atan2(B.z - A.z, B.x - A.x);
  const flags = [];
  for (let i = 1; i < n; i++) {
    const f = new THREE.Mesh(tri, mat(cols[i % cols.length], { side: THREE.DoubleSide }));
    f.position.copy(pts[i]);
    f.rotation.set(0, ry, 0, 'YXZ');
    group.add(f);
    flags.push(f);
  }
  animators.push((t) => flags.forEach((f, i) => { f.rotation.x = Math.sin(t * 3 + i * 0.7) * 0.35; }));
}
function pole(group, x, z, h, color = C.trim) {
  group.add(mesh(new THREE.CylinderGeometry(0.05, 0.06, h, 5), mat(color), x, TOP + h / 2, z));
  return [x, TOP + h, z];
}
function lion(s = 1) {
  const g = new THREE.Group();
  const fur = mat(0xe8ac4c), mane = mat(0xb9622f), dark = mat(0x3a2a20);
  g.add(mesh(new THREE.BoxGeometry(1.6, 0.95, 0.95), fur, 0, 0.95, 0));
  [[0.55, 0.3], [0.55, -0.3], [-0.55, 0.3], [-0.55, -0.3]].forEach(([x, z]) =>
    g.add(mesh(new THREE.BoxGeometry(0.3, 0.7, 0.3), fur, x, 0.35, z)));
  const head = new THREE.Group();
  head.position.set(0.95, 1.55, 0);
  head.add(mesh(new THREE.IcosahedronGeometry(0.78, 0), mane, -0.1, 0, 0));
  head.add(mesh(new THREE.BoxGeometry(0.72, 0.66, 0.7), fur, 0.22, -0.05, 0));
  head.add(mesh(new THREE.BoxGeometry(0.22, 0.16, 0.26), dark, 0.6, -0.08, 0));
  head.add(mesh(new THREE.BoxGeometry(0.06, 0.12, 0.1), dark, 0.59, 0.14, 0.17));
  head.add(mesh(new THREE.BoxGeometry(0.06, 0.12, 0.1), dark, 0.59, 0.14, -0.17));
  head.add(mesh(new THREE.BoxGeometry(0.18, 0.2, 0.18), fur, 0.0, 0.55, 0.32));
  head.add(mesh(new THREE.BoxGeometry(0.18, 0.2, 0.18), fur, 0.0, 0.55, -0.32));
  g.add(head);
  const tail = mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.9, 5), fur, -1.05, 1.25, 0);
  tail.rotation.z = 0.9;
  g.add(tail);
  g.add(mesh(new THREE.IcosahedronGeometry(0.2, 0), mane, -1.42, 1.55, 0));
  g.scale.setScalar(s);
  g.userData.head = head;
  return g;
}
function flag(color, h = 2.4) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, h, 5), mat(C.trim), 0, h / 2, 0));
  const f = mesh(new THREE.PlaneGeometry(0.9, 0.55, 4, 1), mat(color, { side: THREE.DoubleSide }), 0.45, h - 0.3, 0);
  g.add(f);
  const ph = Math.random() * 5;
  animators.push((t) => { f.rotation.y = Math.sin(t * 2.2 + ph) * 0.35; });
  return g;
}
function lamp() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.3, 5), mat(C.navy), 0, 0.65, 0));
  g.add(mesh(new THREE.SphereGeometry(0.13, 8, 6), lampMat, 0, 1.35, 0));
  return g;
}

// ---------- crowd (students) ----------
// Every student shares six InstancedMeshes, so ~150 animated people cost a handful of draw calls.
// A person is plain state ({kind, anchor, x, z, ...}); BEHAVE[kind] updates it each frame and
// stepCrowd() turns it into instance matrices. Positions are local to `anchor` (an island group, or world if null).
const MAXP = 360;
const SHIRTS = [0xd6643c, 0x3d5a80, 0xf1b73b, 0x6aa36f, 0xfaf6ee, 0x9b6bb0, 0xe8705a, 0x4fa3a5];
const PACKS = [0x2b3a55, 0x6b4a3a, 0xd6643c, 0x3d5a80, 0x556b2f, 0xf1b73b];
const HAIRS = [0x2a1d16, 0x3b2a20, 0x14100d, 0x5a3b28];
const armGeo = new THREE.BoxGeometry(0.07, 0.36, 0.07).translate(0, -0.17, 0);
const parts = {};
[
  ['body', new THREE.CylinderGeometry(0.15, 0.19, 0.48, 6).translate(0, 0.24, 0), 0xffffff],
  ['head', new THREE.SphereGeometry(0.15, 8, 6).translate(0, 0.64, 0), 0xf2c9a0],
  ['hair', new THREE.SphereGeometry(0.158, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.67, 0), 0xffffff],
  ['armL', armGeo, 0xffffff],
  ['armR', armGeo, 0xffffff],
  ['pack', new THREE.BoxGeometry(0.24, 0.28, 0.12).translate(0, 0.3, -0.19), 0xffffff],
].forEach(([k, geo, color]) => {
  const m = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85 }), MAXP);
  m.castShadow = true;
  m.frustumCulled = false; // instances span the whole archipelago
  m.count = 0;
  scene.add(m);
  parts[k] = m;
});
const crowd = [];
function addPerson(o) {
  if (crowd.length >= MAXP) return null;
  const i = crowd.length;
  const r = rng(Math.floor((o.seed ?? i) * 7919) + 13);
  const p = { anchor: null, x: 0, z: 0, y: TOP, yaw: 0, bob: 0, aL: 0, aR: 0, ph: r() * 10, speed: 0.5 + r() * 0.4, scale: 1.05 + r() * 0.2, pack: r() < 0.6, wait: 0, rand: r, ...o };
  if (p.kind === 'wander') { p.tx = p.x; p.tz = p.z; }
  const shirt = new THREE.Color(o.shirt ?? SHIRTS[Math.floor(r() * SHIRTS.length)]);
  parts.body.setColorAt(i, shirt);
  parts.armL.setColorAt(i, shirt);
  parts.armR.setColorAt(i, shirt);
  parts.hair.setColorAt(i, new THREE.Color(HAIRS[Math.floor(r() * HAIRS.length)]));
  parts.pack.setColorAt(i, new THREE.Color(PACKS[Math.floor(r() * PACKS.length)]));
  crowd.push(p);
  for (const k in parts) {
    parts[k].count = crowd.length;
    if (parts[k].instanceColor) parts[k].instanceColor.needsUpdate = true;
  }
  return p;
}
function face(p, dx, dz, k = 0.2) {
  if (dx * dx + dz * dz < 1e-6) return;
  const d = Math.atan2(dx, dz) - p.yaw;
  p.yaw += Math.atan2(Math.sin(d), Math.cos(d)) * k;
}
function walkAnim(p, t, k = 1) {
  const w = t * 7 * k + p.ph;
  p.bob = Math.abs(Math.sin(w)) * 0.05 * k;
  p.aL = Math.sin(w) * 0.6 * k; // negative = forward
  p.aR = -p.aL;
}
const BEHAVE = {
  // chatting / looking around; occasionally gestures with one hand
  idle(p, t) {
    p.bob = 0;
    const g = Math.sin(t * 1.1 + p.ph);
    p.aL = g > 0.75 ? -1.3 - Math.sin(t * 6 + p.ph) * 0.35 : 0.06;
    p.aR = 0.06;
    if (p.face) face(p, p.face[0] - p.x, p.face[1] - p.z, 0.1);
    else p.yaw += Math.sin(t * 0.4 + p.ph) * 0.004;
  },
  // stroll to random points inside a circle, pausing now and then
  wander(p, t, dt) {
    if (p.wait > 0) { p.wait -= dt; p.bob = 0; p.aL = p.aR = 0.06; return; }
    const dx = p.tx - p.x, dz = p.tz - p.z, d = Math.hypot(dx, dz);
    if (d < 0.08) {
      const a = p.rand() * Math.PI * 2, rr = Math.sqrt(p.rand()) * p.R;
      p.tx = p.cx + Math.cos(a) * rr; p.tz = p.cz + Math.sin(a) * rr;
      p.wait = p.rand() < 0.35 ? 0.8 + p.rand() * 2.5 : 0;
      return;
    }
    const s = Math.min(d, p.speed * dt);
    p.x += (dx / d) * s; p.z += (dz / d) * s;
    face(p, dx, dz);
    walkAnim(p, t);
  },
  // back and forth between A and B, keeping to the right-hand lane
  line(p, t) {
    const L = Math.hypot(p.bx - p.ax, p.bz - p.az);
    const u0 = (((t * p.speed) / L + p.ph) % 2 + 2) % 2;
    const fwd = u0 < 1, u = fwd ? u0 : 2 - u0, sgn = fwd ? 1 : -1;
    const nx = -(p.bz - p.az) / L, nz = (p.bx - p.ax) / L;
    p.x = p.ax + (p.bx - p.ax) * u + nx * p.lane * sgn;
    p.z = p.az + (p.bz - p.az) * u + nz * p.lane * sgn;
    p.y = p.yAt ? p.yAt(u) : TOP;
    face(p, (p.bx - p.ax) * sgn, (p.bz - p.az) * sgn, 0.3);
    walkAnim(p, t);
  },
  // laps around an ellipse (stadium track)
  run(p, t) {
    const a = p.ph + t * p.speed;
    p.x = p.cx + Math.cos(a) * p.rx; p.z = p.cz + Math.sin(a) * p.rz;
    face(p, -Math.sin(a) * p.rx, Math.cos(a) * p.rz, 0.5);
    walkAnim(p, t, 1.8);
  },
  // jumping fans in the stands
  cheer(p, t) {
    const j = Math.sin(t * 5 + p.ph);
    p.bob = Math.max(0, j) * 0.2;
    p.aL = -2.7 + Math.sin(t * 9 + p.ph) * 0.35;
    p.aR = p.ph % 2 > 1 ? -2.7 - Math.sin(t * 9 + p.ph) * 0.35 : 0.1;
  },
  // tug-of-war: everyone sways with the shared rope offset
  tug(p, t) {
    p.x = p.bx + Math.sin(t * 1.3) * 0.3 + Math.sin(t * 7 + p.ph) * 0.02;
    p.bob = Math.abs(Math.sin(t * 7 + p.ph)) * 0.03;
    p.aL = p.aR = -1.35;
  },
};
const _b = new THREE.Matrix4(), _a = new THREE.Matrix4(), _m = new THREE.Matrix4();
const _p = new THREE.Vector3(), _s = new THREE.Vector3(), _q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
function stepCrowd(t, dt) {
  for (let i = 0; i < crowd.length; i++) {
    const p = crowd[i];
    BEHAVE[p.kind](p, t, dt);
    // anchors can be nested (a storey inside a rotated or scaled building on an island), so go through the full world matrix
    _p.set(p.x, p.y + p.bob, p.z);
    let sc = p.scale;
    if (p.anchor) { _p.applyMatrix4(p.anchor.matrixWorld); sc *= p.anchor.matrixWorld.getMaxScaleOnAxis(); }
    _q.setFromAxisAngle(UP, p.yaw);
    _b.compose(_p, _q, _s.setScalar(sc));
    parts.body.setMatrixAt(i, _b);
    parts.head.setMatrixAt(i, _b);
    parts.hair.setMatrixAt(i, _b);
    parts.pack.setMatrixAt(i, p.pack ? _b : ZERO);
    _a.makeRotationX(p.aL).setPosition(0.21, 0.44, 0);
    parts.armL.setMatrixAt(i, _m.multiplyMatrices(_b, _a));
    _a.makeRotationX(p.aR).setPosition(-0.21, 0.44, 0);
    parts.armR.setMatrixAt(i, _m.multiplyMatrices(_b, _a));
  }
  for (const k in parts) parts[k].instanceMatrix.needsUpdate = true;
}
animators.push(stepCrowd);

// ---------- layered buildings (exploded floor view) ----------
// A layered building is a group whose userData.levels = [{ obj, base, name }] lists its storeys
// bottom-up (roof last). registerLayers() puts it in `layered`; each frame the levels slide apart
// (explode) when their island is focused or the 剖面 toggle is on, and floor tags follow them.
const FH = 1.2; // storey height in scene units
const layered = [];
let explodeAll = false;
function registerLayers(island, group, { gap = 1.3, labelX = -2, storey = 3.6, labels = true } = {}) {
  layered.push({ group, island, levels: group.userData.levels, gap, labelX, storey, labels, e: 0, tags: [] });
}
// Merge a static group's meshes into one mesh per material: a storey made of ~100 boxes
// becomes a handful of draw calls. Meshes flagged userData.keep (animated parts) are left alone.
function bake(group) {
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const buckets = new Map();
  const victims = [];
  group.traverse((o) => { if (o.isMesh && !o.userData.keep) victims.push(o); });
  for (const o of victims) {
    const geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal') geo.deleteAttribute(k);
    geo.clearGroups();
    geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    if (!buckets.has(o.material)) buckets.set(o.material, []);
    buckets.get(o.material).push(geo);
    o.parent.remove(o);
  }
  // plain flat-coloured materials collapse into one vertex-coloured mesh (one draw call per storey);
  // glowing, metallic or double-sided ones keep their own material so night lighting still works
  const plain = [];
  for (const [m, list] of buckets) {
    const special = m === windowMat || m === lampMat || m.side !== THREE.FrontSide || m.metalness > 0 || (m.emissive && m.emissive.getHex() !== 0);
    if (special) { group.add(mesh(mergeGeometries(list), m)); continue; }
    for (const geo of list) {
      const n = geo.attributes.position.count, col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) col.set([m.color.r, m.color.g, m.color.b], i * 3);
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      plain.push(geo);
    }
  }
  if (plain.length) group.add(mesh(mergeGeometries(plain), bakedMat));
  return group;
}
const bakedMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85 });
const partMat = mat(0xf4f1ea), floorMat = mat(0xebe5da);
const FURN = { desk: mat(0xc9a27a), seat: mat(0x6f9fb0), bench: mat(0xdfe4e8) };
// One storey of a box-shaped building, open at the top so its rooms show when floors separate:
// slab, outer walls with windows, a corridor along x with door gaps, cross partitions, furniture.
function boxFloor(o) {
  const { W, D, H = FH, wallM, edgeM = mat(C.trim), winXs = [], winW = 0.44, winH = 0.6, frames = null,
    partX = [], corZ = 0, corW = 0.8, furn = 'class', gapX = null, sideWins = 0 } = o;
  const L = new THREE.Group();
  const T = 0.14, F = D / 2, wh = H - 0.1, wy = 0.1 + wh / 2, gy = wy + 0.04;
  L.add(mesh(new THREE.BoxGeometry(W + 0.04, 0.1, D + 0.04), edgeM, 0, 0.05, 0));
  L.add(mesh(new THREE.BoxGeometry(W - 0.1, 0.012, D - 0.1), floorMat, 0, 0.106, 0));
  const wallX = (x0, x1, z) => L.add(mesh(new THREE.BoxGeometry(x1 - x0, wh, T), wallM, (x0 + x1) / 2, wy, z));
  if (gapX) { wallX(-W / 2, gapX[0], F - T / 2); wallX(gapX[1], W / 2, F - T / 2); } else wallX(-W / 2, W / 2, F - T / 2);
  wallX(-W / 2, W / 2, -F + T / 2);
  for (const s of [-1, 1]) L.add(mesh(new THREE.BoxGeometry(T, wh, D - 2 * T), wallM, s * (W / 2 - T / 2), wy, 0));
  const inGap = (x) => gapX && x > gapX[0] - 0.2 && x < gapX[1] + 0.2;
  for (const x of winXs) {
    for (const s of [1, -1]) {
      if (s === 1 && inGap(x)) continue;
      const z = s * (F + 0.012);
      if (frames && s === 1) {
        L.add(mesh(new THREE.BoxGeometry(winW + 0.12, winH + 0.12, 0.05), frames, x, gy, z));
        L.add(mesh(new THREE.BoxGeometry(0.04, winH, 0.08), frames, x, gy, z + 0.02));
        L.add(mesh(new THREE.BoxGeometry(winW, 0.04, 0.08), frames, x, gy + winH * 0.22, z + 0.02));
      }
      L.add(mesh(new THREE.BoxGeometry(winW, winH, 0.06), windowMat, x, gy, z + s * 0.004));
    }
  }
  for (let k = 0; k < sideWins; k++) {
    const z = -F + ((k + 1) * D) / (sideWins + 1);
    for (const s of [-1, 1]) L.add(mesh(new THREE.BoxGeometry(0.06, winH, winW), windowMat, s * (W / 2 + 0.012), gy, z));
  }
  // corridor walls with a door at the left end of each room, and cross partitions
  const ph = wh * 0.9, py = 0.1 + ph / 2;
  const zf = corZ + corW / 2, zb = corZ - corW / 2;
  const xs = [-W / 2 + T, ...partX, W / 2 - T];
  for (let k = 0; k < xs.length - 1; k++) {
    const a = xs[k] + 0.55, b = xs[k + 1];
    if (b - a > 0.1) {
      if (!(gapX && (xs[k] + xs[k + 1]) / 2 > gapX[0] && (xs[k] + xs[k + 1]) / 2 < gapX[1])) L.add(mesh(new THREE.BoxGeometry(b - a, ph, 0.07), partMat, (a + b) / 2, py, zf));
      L.add(mesh(new THREE.BoxGeometry(b - a, ph, 0.07), partMat, (a + b) / 2, py, zb));
    }
  }
  for (const x of partX) {
    L.add(mesh(new THREE.BoxGeometry(0.07, ph, F - T - zf), partMat, x, py, (zf + F - T) / 2));
    L.add(mesh(new THREE.BoxGeometry(0.07, ph, zb + F - T), partMat, x, py, (zb - F + T) / 2));
  }
  // furniture per room ('none' leaves the storey empty for custom fit-out)
  if (furn !== 'none') for (let k = 0; k < xs.length - 1; k++) {
    const a = xs[k], b = xs[k + 1], cx = (a + b) / 2, rw = b - a;
    for (const [z0, z1, front] of [[zf, F - T, true], [-F + T, zb, false]]) {
      const rd = z1 - z0, cz = (z0 + z1) / 2;
      if (rd < 0.45 || rw < 0.6) continue;
      if (front && gapX && cx > gapX[0] && cx < gapX[1]) continue;
      if (furn === 'class' && front) {
        const nx = Math.max(1, Math.floor((rw - 0.3) / 0.45)), nz = Math.max(1, Math.floor((rd - 0.35) / 0.42));
        for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
          const x = a + 0.3 + (i + 0.5) * ((rw - 0.45) / nx), z = z0 + 0.25 + (j + 0.5) * ((rd - 0.45) / nz);
          L.add(mesh(new THREE.BoxGeometry(0.28, 0.2, 0.18), FURN.desk, x, 0.2, z));
          L.add(mesh(new THREE.BoxGeometry(0.16, 0.12, 0.14), FURN.seat, x, 0.16, z + 0.17));
        }
        L.add(mesh(new THREE.BoxGeometry(Math.min(1.2, rw * 0.6), 0.4, 0.04), mat(0x3e5a4a), cx, 0.55, z1 - 0.03));
      } else if (furn === 'lab') {
        L.add(mesh(new THREE.BoxGeometry(rw - 0.4, 0.24, 0.3), FURN.bench, cx, 0.22, cz));
        L.add(mesh(new THREE.BoxGeometry(rw - 0.5, 0.06, 0.32), mat(0x2f3a4a), cx, 0.36, cz));
      } else {
        L.add(mesh(new THREE.BoxGeometry(Math.min(0.9, rw * 0.5), 0.2, 0.3), FURN.desk, cx, 0.2, cz));
        L.add(mesh(new THREE.BoxGeometry(0.16, 0.12, 0.14), FURN.seat, cx, 0.16, cz + (front ? -0.24 : 0.24)));
        L.add(mesh(new THREE.BoxGeometry(0.3, 0.5, 0.2), mat(0x8a6b52), a + 0.25, 0.35, front ? z1 - 0.12 : z0 + 0.12));
      }
    }
  }
  return L;
}
function stackLevels(group, levels) {
  group.userData.levels = levels.map(([obj, name], i) => {
    group.add(obj);
    return { obj, base: obj.position.y, name };
  });
  return group;
}

// Red-brick administration building, modelled on the user's photo of the Heping campus landmark:
// three storeys, white stone quoins and string courses, a central bay rising above the parapet
// with a white oriel window over an arched entrance, topped by a small gable.
// Built as three open storeys + roof so it can explode into a floor diagram.
function adminBuilding() {
  const g = new THREE.Group();
  const brick = mat(C.brick), stone = mat(C.trim), base = mat(0xe4dccd);
  const W = 10, D = 3.6, F = D / 2, T = 0.14, bw = 2.9, bz = F + 0.6, oz = bz + 0.22;
  const cols = [-4.45, -3.75, -2.75, -1.95, 1.95, 2.75, 3.75, 4.45];
  const levels = [];
  for (let i = 0; i < 3; i++) {
    const L = boxFloor({
      W, D, wallM: brick, edgeM: i === 0 ? base : stone, winXs: cols, winW: 0.44, winH: i === 0 ? 0.56 : 0.66, frames: stone,
      partX: [-3.3, -1.45, 1.45, 3.3], corZ: -0.45, corW: 0.8, furn: i === 0 ? 'office' : 'class', gapX: [-bw / 2 + T, bw / 2 - T], sideWins: 2,
    });
    const wh = FH - 0.1, wy = 0.1 + wh / 2;
    if (i === 0) {
      L.add(mesh(new THREE.BoxGeometry(W + 0.1, 0.3, 0.12), base, 0, 0.15, F + 0.02));
      L.add(mesh(new THREE.BoxGeometry(W + 0.1, 0.3, 0.12), base, 0, 0.15, -F - 0.02));
    }
    // quoins on the pilasters
    for (const x of [-4.86, -3.3, 3.3, 4.86]) for (const y of [0.32, 0.8]) L.add(mesh(new THREE.BoxGeometry(0.34, 0.24, 0.1), stone, x, y, F + 0.03));
    for (const x of [-2.4, 2.4]) if (i === 2) L.add(mesh(new THREE.BoxGeometry(0.22, 0.22, 0.06), stone, x, FH - 0.2, F + 0.03).rotateZ(Math.PI / 4));
    // central bay: hollow (front + sides) so the stair hall shows
    L.add(mesh(new THREE.BoxGeometry(bw, 0.1, 1.2), i === 0 ? base : stone, 0, 0.05, F));
    L.add(mesh(new THREE.BoxGeometry(bw, wh, T), brick, 0, wy, bz - T / 2));
    for (const s of [-1, 1]) L.add(mesh(new THREE.BoxGeometry(T, wh, 1.2), brick, s * (bw / 2 - T / 2), wy, F));
    for (const s of [-1, 1]) for (const y of [0.32, 0.8]) L.add(mesh(new THREE.BoxGeometry(0.3, 0.24, 0.1), stone, s * (bw / 2 - 0.02), y, bz + 0.03));
    for (let k = 0; k < 4; k++) L.add(mesh(new THREE.BoxGeometry(0.9, 0.12, 0.22), partMat, 0.6, 0.16 + k * 0.24, F + 0.35 - k * 0.22));
    if (i === 0) {
      // arched entrance
      const ez = bz + 0.02;
      L.add(mesh(new THREE.BoxGeometry(1.06, 0.62, 0.05), stone, 0, 0.66, ez));
      L.add(mesh(new THREE.CylinderGeometry(0.53, 0.53, 0.05, 14, 1, false, -Math.PI / 2, Math.PI).rotateX(-Math.PI / 2), stone, 0, 0.97, ez));
      L.add(mesh(new THREE.BoxGeometry(0.8, 0.55, 0.06), mat(0x3a2a22), 0, 0.66, ez + 0.01));
      L.add(mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.06, 14, 1, false, -Math.PI / 2, Math.PI).rotateX(-Math.PI / 2), mat(0x3a2a22), 0, 0.93, ez + 0.01));
      L.add(mesh(new THREE.SphereGeometry(0.09, 8, 6), lampMat, 0, 1.12, ez + 0.1));
    } else {
      // faceted white oriel: flat centre face + two angled sides, carved panel above the windows
      L.add(mesh(new THREE.BoxGeometry(1.1, wh, 0.5), stone, 0, wy, oz));
      for (const s of [-1, 1]) {
        const side = new THREE.Group();
        side.position.set(s * 0.55, wy, oz + 0.25);
        side.rotation.y = s * 0.7;
        side.add(mesh(new THREE.BoxGeometry(0.62, wh, 0.12), stone, s * 0.31, 0, -0.06));
        side.add(mesh(new THREE.BoxGeometry(0.4, 0.6, 0.04), windowMat, s * 0.31, -0.06, 0.01));
        L.add(side);
      }
      for (const x of [-0.3, 0.3]) {
        L.add(mesh(new THREE.BoxGeometry(0.42, 0.6, 0.04), windowMat, x, wy - 0.06, oz + 0.26));
        L.add(mesh(new THREE.BoxGeometry(0.03, 0.6, 0.06), stone, x, wy - 0.06, oz + 0.27));
        L.add(mesh(new THREE.BoxGeometry(0.3, 0.16, 0.04), mat(0xe8dfd0), x, FH - 0.12, oz + 0.27));
        L.add(mesh(new THREE.BoxGeometry(0.09, 0.09, 0.04), stone, x, FH - 0.12, oz + 0.29).rotateZ(Math.PI / 4));
      }
      if (i === 1) {
        L.add(mesh(new THREE.BoxGeometry(1.4, 0.2, 0.5), stone, 0, 0.02, oz - 0.04));
        L.add(mesh(new THREE.BoxGeometry(0.9, 0.18, 0.36), stone, 0, -0.16, oz - 0.1));
      }
    }
    L.position.y = i * FH;
    levels.push([bake(L), `${i + 1}F`]);
  }
  // roof level: cornice, flat roof, parapet, bay top with gable, rooftop plant
  const R = new THREE.Group();
  const H0 = 0.16;
  R.add(mesh(new THREE.BoxGeometry(W + 0.3, 0.16, D + 0.3), stone, 0, 0.08, 0));
  R.add(mesh(new THREE.BoxGeometry(W - 0.3, 0.03, D - 0.3), mat(C.slate), 0, H0 + 0.015, 0));
  const ring = (h, t, y, m, grow) => {
    R.add(mesh(new THREE.BoxGeometry(W + grow, h, t), m, 0, y, F - t / 2 + grow / 2));
    R.add(mesh(new THREE.BoxGeometry(W + grow, h, t), m, 0, y, -F + t / 2 - grow / 2));
    R.add(mesh(new THREE.BoxGeometry(t, h, D + grow), m, W / 2 - t / 2 + grow / 2, y, 0));
    R.add(mesh(new THREE.BoxGeometry(t, h, D + grow), m, -W / 2 + t / 2 - grow / 2, y, 0));
  };
  ring(0.34, 0.2, H0 + 0.17, brick, 0);
  ring(0.08, 0.3, H0 + 0.38, stone, 0.1);
  const bh = 1.0;
  R.add(mesh(new THREE.BoxGeometry(bw, bh, 1.2), brick, 0, bh / 2, F));
  for (const s of [-1, 1]) for (const y of [0.3, 0.78]) R.add(mesh(new THREE.BoxGeometry(0.3, 0.24, 0.1), stone, s * (bw / 2 - 0.02), y, bz + 0.03));
  R.add(mesh(new THREE.BoxGeometry(bw + 0.2, 0.18, 1.4), stone, 0, bh + 0.02, F));
  R.add(mesh(new THREE.BoxGeometry(2.0, 0.42, 1.2), brick, 0, bh + 0.32, F));
  R.add(mesh(new THREE.BoxGeometry(2.1, 0.08, 1.3), stone, 0, bh + 0.56, F));
  R.add(mesh(prism(1.6, 0.55, 1.2), brick, 0, bh + 0.6, F));
  R.add(mesh(new THREE.BoxGeometry(0.42, 0.42, 0.05), stone, 0, bh + 0.34, bz + 0.03));
  R.add(mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.06, 12).rotateX(Math.PI / 2), mat(C.brickDark), 0, bh + 0.34, bz + 0.06));
  R.add(mesh(new THREE.BoxGeometry(2.0, 0.16, 0.7), stone, 0, 0.08, oz - 0.05));
  R.add(mesh(new THREE.BoxGeometry(1.3, 0.6, 1.0), brick, 3.6, H0 + 0.3, -0.7));
  R.add(mesh(new THREE.BoxGeometry(0.5, 0.3, 0.5), mat(C.white), -3.2, H0 + 0.15, -0.6));
  R.add(mesh(new THREE.BoxGeometry(0.5, 0.3, 0.5), mat(C.white), -2.4, H0 + 0.15, -0.6));
  R.position.y = 3 * FH;
  levels.push([bake(R), 'RF']);
  return stackLevels(g, levels);
}

// observatory: drum with the telescope pier inside; the dome (and its moving telescope) is the roof level
function observatory() {
  const g = new THREE.Group();
  const L = new THREE.Group();
  L.add(mesh(new THREE.CylinderGeometry(1.6, 1.6, 0.1, 18), mat(0xd5dde3), 0, 0.05, 0));
  L.add(mesh(new THREE.CylinderGeometry(1.5, 1.6, 1.7, 18, 1, true), mat(C.white, { side: THREE.DoubleSide }), 0, 0.95, 0));
  L.add(mesh(new THREE.CylinderGeometry(1.52, 1.52, 0.3, 18, 1, true), windowMat, 0, 1.1, 0));
  L.add(mesh(new THREE.CylinderGeometry(0.25, 0.3, 0.9, 8), mat(0x9aa7b2), 0, 0.55, 0));
  L.add(mesh(new THREE.BoxGeometry(0.6, 0.25, 0.3), FURN.desk, 0.8, 0.22, -0.6));
  bake(L);
  const R = new THREE.Group();
  R.position.y = 1.8;
  R.add(mesh(new THREE.SphereGeometry(1.55, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xdfe6ec)));
  const scope = mesh(new THREE.CylinderGeometry(0.2, 0.28, 2, 8), mat(C.navy), 0.7, 1.1, 0.4);
  scope.rotation.z = -0.8;
  R.add(scope);
  animators.push((t) => { scope.rotation.y = Math.sin(t * 0.3) * 0.5; });
  return stackLevels(g, [[L, '1F'], [R, 'RF']]);
}
// round glass tower: five open storeys around a lift core, gold spire on the roof level
function glassTower() {
  const g = new THREE.Group();
  const levels = [];
  const N = 5, H = 1.25;
  for (let i = 0; i < N; i++) {
    const L = new THREE.Group();
    const r = 1.3 - i * 0.04;
    L.add(mesh(new THREE.CylinderGeometry(r + 0.04, r + 0.04, 0.1, 10), mat(C.white), 0, 0.05, 0));
    L.add(mesh(new THREE.CylinderGeometry(r - 0.06, r - 0.06, H - 0.1, 10, 1, true), windowMat, 0, 0.1 + (H - 0.1) / 2, 0));
    L.add(mesh(new THREE.BoxGeometry(0.42, H - 0.1, 0.42), mat(C.slate), 0, 0.1 + (H - 0.1) / 2, 0));
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + 0.4;
      L.add(mesh(new THREE.BoxGeometry(0.42, 0.2, 0.26), FURN.desk, Math.cos(a) * 0.8, 0.2, Math.sin(a) * 0.8).rotateY(-a));
    }
    L.position.y = i * H;
    levels.push([bake(L), `${i + 1}F`]);
  }
  const R = new THREE.Group();
  R.add(mesh(new THREE.CylinderGeometry(1.14, 1.14, 0.14, 10), mat(C.white), 0, 0.07, 0));
  R.add(mesh(new THREE.TorusGeometry(0.9, 0.05, 4, 20).rotateX(Math.PI / 2), mat(C.gold), 0, 0.3, 0));
  R.add(mesh(new THREE.ConeGeometry(0.2, 1.4, 6), mat(C.gold), 0, 0.85, 0));
  R.position.y = N * H;
  levels.push([bake(R), 'RF']);
  return stackLevels(g, levels);
}
// small house: open single storey (walls, door, window, table) + pitched roof level
function house(color, roofColor, s = 1) {
  const g = new THREE.Group();
  const L = new THREE.Group();
  const wm = mat(color), T = 0.1, W = 1.4, D = 1.2, H = 1.1;
  L.add(mesh(new THREE.BoxGeometry(W, 0.08, D), floorMat, 0, 0.04, 0));
  L.add(mesh(new THREE.BoxGeometry(W, H, T), wm, 0, H / 2, D / 2 - T / 2));
  L.add(mesh(new THREE.BoxGeometry(W, H, T), wm, 0, H / 2, -D / 2 + T / 2));
  for (const sx of [-1, 1]) L.add(mesh(new THREE.BoxGeometry(T, H, D - 2 * T), wm, sx * (W / 2 - T / 2), H / 2, 0));
  L.add(mesh(new THREE.BoxGeometry(0.3, 0.3, 0.02), windowMat, 0.35, 0.65, D / 2 + 0.01));
  L.add(mesh(new THREE.BoxGeometry(0.28, 0.55, 0.02), mat(C.wood), -0.3, 0.28, D / 2 + 0.01));
  L.add(mesh(new THREE.BoxGeometry(0.5, 0.25, 0.4), FURN.desk, 0.1, 0.2, -0.1));
  L.add(mesh(new THREE.BoxGeometry(0.3, 0.45, 0.25), mat(0x8a6b52), -0.45, 0.3, -0.38));
  bake(L);
  const R = new THREE.Group();
  R.position.y = H;
  const roof = mesh(prism(1.6, 0.8, 1.4), mat(roofColor));
  roof.rotation.y = Math.PI / 2;
  R.add(roof);
  stackLevels(g, [[L, '1F'], [R, 'RF']]);
  g.scale.setScalar(s);
  return g;
}
// The three heritage buildings below follow 師大百寶箱 C 系列「校園風貌」(pr.ntnu.edu.tw, id 13365 / 13362 / 13350):
// only features those pages describe are modelled; anything they leave open is kept plain.
const washM = mat(0xd9d4cb); // 洗石子 trim
// 普字樓: long one-bar block, brick with washed-stone bands, 3 storeys (3F added 1954), two-slope black-tile roof
function puziBuilding() {
  const g = new THREE.Group();
  const W = 9, D = 2.2, levels = [];
  for (let i = 0; i < 3; i++) {
    const L = boxFloor({ W, D, wallM: mat(C.brick), edgeM: washM, winXs: [-3.8, -2.7, -1.6, -0.5, 0.5, 1.6, 2.7, 3.8], winW: 0.5, winH: 0.62, frames: mat(C.white), partX: [-2.2, 0, 2.2], corZ: -0.5, corW: 0.55, furn: 'class' });
    // washed-stone pilasters between the bays
    for (const x of [-4.5, -2.2, 0, 2.2, 4.5]) L.add(mesh(new THREE.BoxGeometry(0.16, FH - 0.1, 0.06), washM, x, FH / 2 + 0.05, D / 2 + 0.03));
    if (i === 0) L.add(mesh(new THREE.BoxGeometry(1.2, 0.95, 0.5), washM, 0, 0.55, D / 2 + 0.25)); // central porch
    L.position.y = i * FH;
    levels.push([bake(L), `${i + 1}F`]);
  }
  const R = new THREE.Group();
  R.add(mesh(new THREE.BoxGeometry(W + 0.1, 0.1, D + 0.1), washM, 0, 0.05, 0));
  const roof = mesh(prism(D + 0.5, 1.0, W + 0.4), mat(0x34343a), 0, 0.1, 0);
  roof.rotation.y = Math.PI / 2;
  R.add(roof);
  R.position.y = 3 * FH;
  levels.push([bake(R), 'RF']);
  return stackLevels(g, levels);
}
// 文薈廳: one-storey brick hall split in two rooms, light-grey cement-tile gable roof, round (six-pointed-star) window in each gable
function wenhuiHall() {
  const g = new THREE.Group();
  const W = 3.2, D = 1.7;
  const L = boxFloor({ W, D, wallM: mat(C.brick), edgeM: washM, winXs: [-1.0, 0.25, 1.0], winW: 0.42, winH: 0.6, frames: mat(C.white), partX: [-0.2], corZ: -0.62, corW: 0.3, furn: 'office' });
  bake(L);
  const R = new THREE.Group();
  R.position.y = FH;
  const roof = mesh(prism(D + 0.35, 0.85, W + 0.2), mat(0xb9bcbf));
  roof.rotation.y = Math.PI / 2;
  R.add(roof);
  for (const s of [-1, 1]) {
    R.add(mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.06, 12).rotateZ(Math.PI / 2), mat(C.wood), s * (W / 2 + 0.12), 0.32, 0));
    R.add(mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.08, 6).rotateZ(Math.PI / 2), windowMat, s * (W / 2 + 0.13), 0.32, 0));
  }
  bake(R);
  return stackLevels(g, [[L, '1F'], [R, 'RF']]);
}
// 禮堂 (原臺北高等學校講堂): 2 storeys, dark-red tile with washed stone, guard towers flanking the entrance,
// crenellated parapet, tall front gable, rear round-arched apse
function auditorium() {
  const g = new THREE.Group();
  const W = 2.8, D = 3.8, H = 1.4, wallM = mat(C.brickDark), levels = [];
  for (let i = 0; i < 2; i++) {
    const L = boxFloor({ W, D, H, wallM, edgeM: washM, sideWins: 3, winW: 0.4, winH: 0.75, partX: [], corZ: -1.2, corW: 0.3, furn: 'class' });
    for (const s of [-1, 1]) L.add(mesh(new THREE.BoxGeometry(0.6, H, 0.6), wallM, s * (W / 2 + 0.05), H / 2, D / 2 + 0.05)); // guard towers
    for (const s of [-1, 1]) L.add(mesh(new THREE.BoxGeometry(0.1, 0.6, 0.2), windowMat, s * (W / 2 + 0.05), H * 0.55, D / 2 + 0.36));
    L.add(mesh(new THREE.CylinderGeometry(0.9, 0.9, H - 0.1, 10, 1, false, Math.PI / 2, Math.PI), wallM, 0, H / 2 + 0.05, -D / 2)); // apse
    if (i === 0) {
      L.add(mesh(new THREE.BoxGeometry(0.6, 0.8, 0.06), mat(C.wood), 0, 0.5, D / 2 + 0.02));
      L.add(mesh(prism(0.6, 0.3, 0.06), washM, 0, 0.9, D / 2 + 0.02)); // pointed arch over the door
    }
    L.position.y = i * H;
    levels.push([bake(L), `${i + 1}F`]);
  }
  const R = new THREE.Group();
  R.position.y = 2 * H;
  R.add(mesh(new THREE.BoxGeometry(W + 0.1, 0.12, D + 0.1), washM, 0, 0.06, 0));
  // battlement merlons along the parapet and on both towers
  for (let x = -W / 2 + 0.15; x <= W / 2 - 0.1; x += 0.42) for (const z of [-D / 2, D / 2]) R.add(mesh(new THREE.BoxGeometry(0.22, 0.28, 0.12), wallM, x, 0.26, z));
  for (let z = -D / 2 + 0.3; z <= D / 2 - 0.2; z += 0.42) for (const x of [-W / 2, W / 2]) R.add(mesh(new THREE.BoxGeometry(0.12, 0.28, 0.22), wallM, x, 0.26, z));
  for (const s of [-1, 1]) {
    R.add(mesh(new THREE.BoxGeometry(0.66, 0.25, 0.66), washM, s * (W / 2 + 0.05), 0.12, D / 2 + 0.05));
    for (const [dx, dz] of [[-0.22, -0.22], [0.22, -0.22], [-0.22, 0.22], [0.22, 0.22]]) R.add(mesh(new THREE.BoxGeometry(0.16, 0.3, 0.16), wallM, s * (W / 2 + 0.05) + dx, 0.4, D / 2 + 0.05 + dz));
  }
  R.add(mesh(prism(W - 0.6, 1.4, 0.16), wallM, 0, 0.1, D / 2 - 0.05)); // tall front gable
  R.add(mesh(prism(W - 0.9, 1.0, 0.18), washM, 0, 0.2, D / 2 - 0.04));
  R.add(mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.1, 10, 1, false, Math.PI / 2, Math.PI), washM, 0, 0.05, -D / 2));
  bake(R);
  levels.push([R, 'RF']);
  return stackLevels(g, levels);
}
// 林口校區: no building above 4 storeys (flight path), red-tile pitched roofs; clock tower by the auditorium is the landmark
function linkouBlock() {
  const g = new THREE.Group();
  const W = 3.0, D = 1.4, levels = [];
  for (let i = 0; i < 3; i++) {
    const L = boxFloor({ W, D, wallM: mat(0xf1e6d2), winXs: [-1.0, 0, 1.0], winW: 0.5, winH: 0.55, partX: [-0.5, 0.5], corZ: -0.35, corW: 0.3, furn: 'class' });
    L.position.y = i * FH;
    levels.push([bake(L), `${i + 1}F`]);
  }
  const R = new THREE.Group();
  R.position.y = 3 * FH;
  const roof = mesh(prism(D + 0.4, 0.7, W + 0.3), mat(0xb5462e));
  roof.rotation.y = Math.PI / 2;
  R.add(roof);
  levels.push([bake(R), 'RF']);
  return stackLevels(g, levels);
}
function clockTower() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(0.7, 3.2, 0.7), mat(0xf1e6d2), 0, 1.6, 0));
  for (const r of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const face = mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.04, 14).rotateX(Math.PI / 2), mat(C.white), Math.sin(r) * 0.37, 2.7, Math.cos(r) * 0.37);
    face.rotation.y = r;
    g.add(face);
  }
  const cap = mesh(new THREE.ConeGeometry(0.62, 0.7, 4), mat(0xb5462e), 0, 3.55, 0);
  cap.rotation.y = Math.PI / 4;
  g.add(cap);
  return g;
}
// The four buildings below follow Google Maps Street View (使用者 2026-10-29 指示); storey counts that NTNU's own pages
// give (圖書館 8 層、體育館地上 5 層、4F 看台) win over what the street photos suggest.
// 圖書館校區總館: 8-storey brown-tile slab, recessed ribbon windows, solid stair towers at both ends;
// the old library's classical columns and pediment were kept at the entrance (pr.ntnu.edu.tw id 19424)
function libraryBuilding() {
  const g = new THREE.Group();
  const W = 4.4, D = 2.4, N = 8, tileM = mat(0xa9654c), levels = [];
  for (let i = 0; i < N; i++) {
    const L = boxFloor({ W, D, wallM: tileM, edgeM: mat(0x8e5440), winXs: [-1.55, -0.78, 0, 0.78, 1.55], winW: 0.74, winH: 0.42, partX: [-1.1, 1.1], corZ: -0.45, corW: 0.5, furn: 'office' });
    for (const s of [-1, 1]) L.add(mesh(new THREE.BoxGeometry(0.6, FH, D * 0.7), tileM, s * (W / 2 + 0.28), FH / 2, 0)); // stair towers
    if (i === 0) {
      for (const x of [-0.75, -0.25, 0.25, 0.75]) L.add(mesh(new THREE.CylinderGeometry(0.08, 0.09, 0.95, 8), mat(C.white), x, 0.58, D / 2 + 0.35));
      L.add(mesh(new THREE.BoxGeometry(1.9, 0.1, 0.5), mat(C.white), 0, 1.1, D / 2 + 0.3));
      L.add(mesh(prism(1.9, 0.35, 0.5), mat(C.white), 0, 1.15, D / 2 + 0.3)); // pediment
    }
    L.position.y = i * FH;
    levels.push([bake(L), `${i + 1}F`]);
  }
  const R = new THREE.Group();
  R.position.y = N * FH;
  R.add(mesh(new THREE.BoxGeometry(W + 1.3, 0.16, D + 0.1), mat(0x8e5440), 0, 0.08, 0));
  R.add(mesh(new THREE.BoxGeometry(1.2, 0.5, 0.9), tileM, 1.2, 0.4, -0.3));
  levels.push([bake(R), 'RF']);
  return stackLevels(g, levels);
}
// 體育館 (1992): red-brick box with big blank walls, recessed glass entrance bay between two red round columns,
// a row of small square windows near the top; 4F holds the fixed stands around the court (pr.ntnu.edu.tw id 13377)
function gymBuilding() {
  const g = new THREE.Group();
  const W = 4.2, D = 3.0, brickM = mat(C.brick), levels = [];
  for (let i = 0; i < 5; i++) {
    const top = i === 4, hall = i === 3;
    const L = boxFloor({ W, D, wallM: brickM, edgeM: mat(C.brickDark), winXs: top ? [-1.7, -1.2, -0.7, -0.2, 0.3, 0.8, 1.3, 1.8] : [-0.45, 0.45], winW: top ? 0.22 : 0.8, winH: top ? 0.22 : 0.85, frames: top ? null : mat(C.white), partX: hall ? [] : [-0.9, 0.9], corZ: hall ? -D / 2 + 0.3 : -0.6, corW: 0.3, furn: hall ? 'none' : 'office' });
    if (i < 3) for (const x of [-1.05, 1.05]) L.add(mesh(new THREE.CylinderGeometry(0.12, 0.12, FH, 10), mat(0xa8423a), x, FH / 2, D / 2 + 0.25));
    if (i === 0) for (let k = 0; k < 3; k++) L.add(mesh(new THREE.BoxGeometry(2.2, 0.08, 0.25), mat(0xc8c3bb), 0, 0.04 + k * 0.08, D / 2 + 0.75 - k * 0.22)); // entrance stairs
    if (hall) {
      L.add(mesh(new THREE.BoxGeometry(2.4, 0.03, 1.4), mat(0x6aa36f), 0, 0.12, 0.1));
      L.add(mesh(new THREE.BoxGeometry(2.0, 0.035, 1.0), mat(0xd9774f), 0, 0.125, 0.1));
      for (let k = 0; k < 3; k++) for (const s of [-1, 1]) L.add(mesh(new THREE.BoxGeometry(2.6, 0.12 + k * 0.12, 0.22), mat(k % 2 ? 0x6f9fb0 : 0x3d5a80), 0, 0.17 + k * 0.06, s * (0.95 + k * 0.2) + 0.1));
    }
    L.position.y = i * FH;
    levels.push([bake(L), `${i + 1}F`]);
  }
  const R = new THREE.Group();
  R.position.y = 5 * FH;
  R.add(mesh(new THREE.BoxGeometry(W + 0.2, 0.18, D + 0.2), mat(C.brickDark), 0, 0.09, 0));
  R.add(mesh(new THREE.BoxGeometry(2.6, 0.12, 1.8), mat(0xc8c3bb), 0, 0.22, 0));
  levels.push([bake(R), 'RF']);
  return stackLevels(g, levels);
}
// 綜合大樓: tall red-brick tower with white vertical pilasters, white two-storey podium, dark crown band on top
function zongheBuilding() {
  const g = new THREE.Group();
  const W = 3.2, D = 2.0, N = 11, levels = [];
  for (let i = 0; i < N; i++) {
    const podium = i < 2;
    const L = boxFloor({ W, D, wallM: mat(podium ? C.white : C.brick), edgeM: mat(C.white), winXs: [-1.15, -0.4, 0.4, 1.15], winW: podium ? 0.6 : 0.36, winH: podium ? 0.75 : 0.5, partX: [-0.8, 0.8], corZ: -0.3, corW: 0.4, furn: 'office' });
    if (!podium) for (const x of [-1.6, -0.78, 0, 0.78, 1.6]) L.add(mesh(new THREE.BoxGeometry(0.12, FH, 0.08), mat(C.white), x, FH / 2, D / 2 + 0.04));
    L.position.y = i * FH;
    levels.push([bake(L), `${i + 1}F`]);
  }
  const R = new THREE.Group();
  R.position.y = N * FH;
  R.add(mesh(new THREE.BoxGeometry(W + 0.1, 0.5, D + 0.1), mat(0x4a3c38), 0, 0.25, 0));
  levels.push([bake(R), 'RF']);
  return stackLevels(g, levels);
}
// 公館校區行政大樓: four storeys of grey exposed concrete, horizontal floor bands, vertical fins over the entrance
function gongguanAdmin() {
  const g = new THREE.Group();
  const W = 3.4, D = 1.8, concM = mat(0xb9b8b2), levels = [];
  for (let i = 0; i < 4; i++) {
    const L = boxFloor({ W, D, wallM: concM, edgeM: mat(0xd6d5cf), winXs: [-1.2, -0.6, 0.6, 1.2], winW: 0.5, winH: 0.5, partX: [-0.3, 0.3], corZ: -0.3, corW: 0.35, furn: 'office' });
    for (const x of [-0.3, -0.1, 0.1, 0.3]) L.add(mesh(new THREE.BoxGeometry(0.06, FH, 0.3), mat(0xd6d5cf), x, FH / 2, D / 2 + 0.15));
    L.position.y = i * FH;
    levels.push([bake(L), `${i + 1}F`]);
  }
  const R = new THREE.Group();
  R.position.y = 4 * FH;
  R.add(mesh(new THREE.BoxGeometry(W + 0.15, 0.2, D + 0.15), mat(0xd6d5cf), 0, 0.1, 0));
  levels.push([bake(R), 'RF']);
  return stackLevels(g, levels);
}
// Norfolk pine (南洋杉) as lining the 公館 entrance avenue
function araucaria(h = 3) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.07, 0.11, h, 5), mat(C.wood), 0, h / 2, 0));
  for (let k = 0; k < 5; k++) g.add(mesh(new THREE.ConeGeometry(0.55 - k * 0.08, 0.35, 7), mat(C.leaf2), 0, h * 0.35 + k * h * 0.14, 0));
  return g;
}

// The big red "NTNU" letters on a white plinth, as in the photo. Letters are built from boxes
// (no font file needed); U's bowl is half a torus.
function ntnuSign() {
  const g = new THREE.Group();
  const red = mat(0xd8343c, { roughness: 0.55 });
  const Hh = 1.7, S = 0.34, Wl = 1.25, gap = 0.22, dep = 0.32, y0 = 0.16;
  const total = Wl * 4 + gap * 3;
  g.add(mesh(new THREE.BoxGeometry(total + 0.5, y0, 0.9), mat(0xc4beb4), 0, y0 / 2, 0));
  const bar = (w, h, x, y, rz = 0) => { const m = mesh(new THREE.BoxGeometry(w, h, dep), red, x, y0 + y, 0); m.rotation.z = rz; g.add(m); };
  const N = (x0) => {
    bar(S, Hh, x0 + S / 2, Hh / 2);
    bar(S, Hh, x0 + Wl - S / 2, Hh / 2);
    bar(S * 1.08, Math.hypot(Wl - S, Hh), x0 + Wl / 2, Hh / 2, Math.atan2(Wl - S, Hh));
  };
  const T = (x0) => {
    bar(Wl, S, x0 + Wl / 2, Hh - S / 2);
    bar(S, Hh - S, x0 + Wl / 2, (Hh - S) / 2);
  };
  const U = (x0) => {
    const R = (Wl - S) / 2;
    bar(S, Hh - R, x0 + S / 2, R + (Hh - R) / 2);
    bar(S, Hh - R, x0 + Wl - S / 2, R + (Hh - R) / 2);
    const bowl = mesh(new THREE.TorusGeometry(R, S / 2, 6, 14, Math.PI), red, x0 + Wl / 2, y0 + R, 0);
    bowl.rotation.z = Math.PI;
    bowl.scale.z = dep / S;
    g.add(bowl);
  };
  [N, T, N, U].forEach((fn, k) => fn(-total / 2 + k * (Wl + gap)));
  return g;
}
function palm(h = 3) {
  const g = new THREE.Group();
  const trunk = mesh(new THREE.CylinderGeometry(0.1, 0.16, h, 6), mat(0x9b7b55), 0, h / 2, 0);
  trunk.rotation.z = 0.08;
  g.add(trunk);
  for (let k = 0; k < 7; k++) {
    const leaf = new THREE.Group();
    leaf.position.set(h * 0.08, h, 0);
    leaf.rotation.y = (k / 7) * Math.PI * 2;
    const blade = mesh(new THREE.BoxGeometry(1.4, 0.04, 0.32), mat(C.leaf2), 0.65, -0.18, 0);
    blade.rotation.z = -0.35;
    leaf.add(blade);
    g.add(leaf);
  }
  return g;
}

// ---------- islands ----------
function islandBase(r, seed, grassColor = C.grass) {
  const g = new THREE.Group();
  const cliff = wobble(new THREE.CylinderGeometry(r * 0.98, r * 0.7, 3.2, 11, 2), 0.1, seed);
  g.add(mesh(cliff, mat(C.rock), 0, -1.4, 0));
  const sand = wobble(new THREE.CylinderGeometry(r * 1.04, r * 1.1, 0.5, 11), 0.1, seed);
  g.add(mesh(sand, mat(C.sand), 0, 0.05, 0));
  const top = wobble(new THREE.CylinderGeometry(r * 0.9, r * 0.96, 0.5, 11), 0.1, seed);
  g.add(mesh(top, mat(grassColor), 0, 0.5, 0));
  // shallow-water halo
  const halo = new THREE.Mesh(new THREE.CircleGeometry(r * 1.55, 28), new THREE.MeshStandardMaterial({ color: C.shallow, transparent: true, opacity: 0.55, depthWrite: false, roughness: 1 }));
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = -0.38;
  g.add(halo);
  Object.assign(g.userData, { halo, r, seed }); // r + seed let walk mode rebuild the grass outline
  return g;
}
function pathDisc(g, x, z, r, color = C.path) {
  const d = mesh(new THREE.CylinderGeometry(r, r, 0.06, 18), mat(color), x, TOP + 0.03, z);
  d.castShadow = false;
  g.add(d);
}

const BUILDERS = {
  // 01 百年本島：紅磚行政大樓 + 紅色 NTNU 大字 + 大獅子 + 書堆
  core(g, r) {
    pathDisc(g, 0, 0.5, 5.4);
    const hall = adminBuilding();
    hall.position.set(0, TOP, -1.8);
    g.add(hall);
    registerLayers(g, hall, { gap: 1.5, labelX: -5.6, storey: 3.6 });
    // staff and students inside each storey (visible when the floors separate)
    hall.userData.levels.slice(0, 3).forEach(({ obj }, i) => {
      walkers(obj, -4.3, -0.45, 4.3, -0.45, 2, 20 + i, { lane: 0.15, yAt: () => 0.11 });
      chatGroup(obj, -2.4, 0.95, 2, 30 + i, 0.11);
      people(obj, [[2.4, 1.2], [-4.1, -1.25]], 40 + i);
      crowd.slice(-2).forEach((p) => { p.y = 0.11; });
    });
    // heritage buildings around it, set in the gaps between bridge landings so every boardwalk can be walked onto:
    // 普字樓 back-left (porch facing out), 禮堂 back-right (side-on, entrance toward the 師生榮耀 bridge), 文薈廳 on the east rim
    const puzi = puziBuilding();
    puzi.position.set(-3.95, TOP, -6.49);
    puzi.rotation.y = -2.595;
    puzi.scale.setScalar(0.65);
    g.add(puzi);
    registerLayers(g, puzi, { gap: 1.2, labels: false });
    puzi.userData.levels.slice(0, 3).forEach(({ obj }, i) => { people(obj, [[-3.3, 0.5], [1.2, 0.6], [3.4, -0.6]], 60 + i); crowd.slice(-3).forEach((p) => { p.y = 0.11; }); });
    const wen = wenhuiHall();
    wen.position.set(7.39, TOP, 1.3);
    wen.rotation.y = -1.745;
    g.add(wen);
    registerLayers(g, wen, { gap: 1.0, labels: false });
    const aud = auditorium();
    aud.position.set(3.91, TOP, -6.51);
    aud.rotation.y = -2.112;
    g.add(aud);
    registerLayers(g, aud, { gap: 1.3, labels: false });
    aud.userData.levels.slice(0, 2).forEach(({ obj }, i) => { people(obj, [[-0.6, 0.6], [0.5, 0.2], [0, -0.6]], 70 + i); crowd.slice(-3).forEach((p) => { p.y = 0.11; }); });
    // lion statue on plinth
    const plinth = mesh(new THREE.BoxGeometry(2.6, 0.6, 1.6), mat(C.trim), 3.8, TOP + 0.3, 4.6);
    g.add(plinth);
    platforms.push(plinth);
    const L = lion(1.15);
    L.position.set(3.8, TOP + 0.6, 4.6);
    L.rotation.y = -0.5;
    g.add(L);
    animators.push((t) => { L.userData.head.rotation.y = Math.sin(t * 0.8) * 0.35; L.userData.head.rotation.z = Math.sin(t * 1.6) * 0.06; });
    // giant books (師範 = teaching)
    const bc = [0xd6643c, 0x3d5a80, 0xf1b73b, 0x6aa36f];
    bc.forEach((c, i) => {
      const b = mesh(new THREE.BoxGeometry(1.9 - i * 0.15, 0.32, 1.4 - i * 0.08), mat(c), -4.2, TOP + 0.16 + i * 0.32, 4.4);
      b.rotation.y = i * 0.22 - 0.3;
      g.add(b);
    });
    [[-2.4, 3.3], [2.4, 3.4], [-6.5, 0.5], [5.6, -1.6]].forEach(([x, z]) => { const l = lamp(); l.position.set(x, TOP, z); g.add(l); });
    const f = flag(0xd6643c, 3); f.position.set(6.2, TOP, 4.2); g.add(f);
    // NTNU letters with a hedge behind and a flower bed in front, palms either side
    const sign = ntnuSign();
    sign.position.set(0, TOP, 6.3);
    g.add(sign);
    solids.push(sign);
    g.add(mesh(new THREE.BoxGeometry(7.2, 0.55, 0.7), mat(C.leaf2), 0, TOP + 0.27, 5.4));
    g.add(mesh(new THREE.BoxGeometry(7.4, 0.12, 0.8), mat(0x8a5a3c), 0, TOP + 0.06, 7.3));
    const fr = rng(99), fc = [0xe8475a, 0xf4b6b0, 0xfaf6ee, 0xd8343c, 0xf1b73b];
    for (let k = 0; k < 46; k++) {
      g.add(mesh(new THREE.IcosahedronGeometry(0.1 + fr() * 0.05, 0), mat(fc[k % fc.length]), -3.5 + fr() * 7, TOP + 0.17, 6.98 + fr() * 0.64));
    }
    // palms on the left, a round tree on the right, as in the photo
    [[-5.0, 6.6, 3.2], [-6.2, 3.6, 2.6], [-5.9, 5.3, 2.9]].forEach(([x, z, h]) => { const p = palm(h); p.position.set(x, TOP, z); g.add(p); });
    const rt = tree(1, 1.6); rt.position.set(5.3, TOP, 6.6); g.add(rt);
    const walk = (w, d, x, z) => { const s = mesh(new THREE.BoxGeometry(w, 0.06, d), mat(C.path), x, TOP + 0.03, z); s.castShadow = false; g.add(s); };
    walk(13, 1.3, 0, 2.6);    // in front of the building
    walk(3.6, 1.1, -1.2, -5.4); // behind the building, between 普字樓 and 禮堂
    bunting(g, [-2.4, TOP + 1.45, 3.3], [2.4, TOP + 1.45, 3.4], 10, 0.25);
    walkers(g, -6.2, 2.6, 6.2, 2.6, 9, 2, { lane: 0.35 });
    walkers(g, -2.2, 4.2, 2.2, 4.2, 3, 4, { lane: 0.2 });
    walkers(g, -2.8, -5.4, 0.4, -5.4, 2, 3, { lane: 0.3 });
    people(g, [[-1.5, 8.2], [0.1, 8.3], [1.5, 8.1]], 12); // taking photos with the letters
    crowd.slice(-3).forEach((p) => { p.face = [0, 6.3]; });
    chatGroup(g, -5.6, -3.4, 3, 7);
    chatGroup(g, 6.0, -3.0, 3, 5);
    people(g, [[3.4, 6.3], [4.3, 6.4]], 8); // posing with the lion
    scatterTrees(g, r, 20, 11, [[-3.95, -6.49, 4.4], [7.39, 1.3, 2.2], [3.91, -6.51, 3.2], [0, -1.8, 6.4],[3.8, 4.6, 2.2], [-4.2, 4.4, 1.8], [0, 6.4, 5], [-5.5, 2.6, 1.6], [5.5, 2.6, 1.6], [-1.2, -5.4, 2.2], [-5.6, -3.4, 1], [6.0, -3.0, 1], [-6.2, 3.6, 1]]);
  },
  // 02 研究：天文台 + 實驗大樓 + 漂浮原子
  research(g, r) {
    pathDisc(g, 0, 0, 3.2);
    const obs = observatory();
    obs.position.set(-1.6, TOP, -1.2);
    g.add(obs);
    registerLayers(g, obs, { gap: 1.6, labels: false });
    const lib = libraryBuilding();
    lib.position.set(2.3, TOP, -0.9);
    lib.rotation.y = -2.0; // entrance faces the default camera, which looks in from outside the archipelago
    lib.scale.setScalar(0.6);
    g.add(lib);
    registerLayers(g, lib, { gap: 1.0, labelX: 2.4, storey: 3.6 });
    lib.userData.levels.slice(0, 8).forEach(({ obj }, i) => {
      people(obj, [[-1.4, 0.6], [1.2, 0.7]], 50 + i);
      crowd.slice(-2).forEach((p) => { p.y = 0.11; });
    });
    // floating atom
    const atom = new THREE.Group();
    atom.add(mesh(new THREE.IcosahedronGeometry(0.45, 1), mat(0xd6643c, { emissive: 0xd6643c, emissiveIntensity: 0.3 })));
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.05, 6, 40), mat(C.navy));
      ring.rotation.set(Math.PI / 2, (i * Math.PI) / 3, 0);
      const e = mesh(new THREE.SphereGeometry(0.13, 8, 6), mat(C.gold, { emissive: C.gold, emissiveIntensity: 0.5 }), 1.2, 0, 0);
      ring.add(e);
      atom.add(ring);
    }
    atom.position.set(0.4, TOP + 6, 2.2);
    g.add(atom);
    animators.push((t) => {
      atom.rotation.y = t * 0.6; atom.rotation.x = Math.sin(t * 0.4) * 0.3;
      atom.position.y = TOP + 6 + Math.sin(t * 1.2) * 0.35;
      atom.children.slice(1).forEach((ring, i) => { ring.rotation.z = t * (1 + i * 0.4); });
    });
    chatGroup(g, -0.3, 2.9, 3, 3);
    wanderers(g, 0.7, 2.5, 1.3, 5, 31);
    scatterTrees(g, r, 9, 21, [[-1.6, -1.2, 2.4], [2.3, -0.9, 2.6], [0.5, 2.6, 1.6]]);
  },
  // 03 社會貢獻：小村落 + 學童 + 書車
  social(g, r) {
    pathDisc(g, 0, 0.6, 3.4);
    const palette = [[0xfff1dc, 0xd6643c], [0xe8f1f2, 0x3d5a80], [0xfde7c8, 0x6aa36f], [0xf7e0e0, 0xb9622f], [0xffffff, 0x5f6f7f]];
    [[-3.2, -2.2, 0.3], [-0.6, -3.4, 0], [2.3, -2.6, -0.4], [3.6, 0.4, -1.2], [-3.8, 1.2, 1.3]].forEach(([x, z, ry], i) => {
      const h = house(...palette[i], 1 + (i % 2) * 0.2);
      h.position.set(x, TOP, z);
      h.rotation.y = ry;
      g.add(h);
      registerLayers(g, h, { gap: 1.0, labels: false });
    });
    // mobile classroom bus
    const bus = new THREE.Group();
    bus.add(mesh(new THREE.BoxGeometry(2.2, 1.0, 1.0), mat(C.gold), 0, 0.75, 0));
    bus.add(mesh(new THREE.BoxGeometry(1.6, 0.35, 1.02), windowMat, -0.2, 0.95, 0));
    [[-0.7, 0.5], [0.7, 0.5], [-0.7, -0.5], [0.7, -0.5]].forEach(([x, z]) => bus.add(mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.12, 10), mat(0x2b2b2b), x, 0.25, z).rotateX(Math.PI / 2)));
    bus.position.set(0.8, TOP, 2.6);
    g.add(bus);
    animators.push((t) => { bus.position.x = 0.8 + Math.sin(t * 0.5) * 1.6; bus.rotation.y = Math.cos(t * 0.5) > 0 ? 0 : Math.PI; });
    // heart balloon cluster
    const heart = new THREE.Group();
    [[0, 0], [0.5, 0.35], [-0.5, 0.35]].forEach(([x, y]) => heart.add(mesh(new THREE.SphereGeometry(0.42, 10, 8), mat(0xe8705a), x, y, 0)));
    heart.position.set(-1.2, TOP + 5, 1.6);
    g.add(heart);
    animators.push((t) => { heart.position.y = TOP + 5 + Math.sin(t * 1.1) * 0.3; heart.rotation.y = t * 0.4; });
    chatGroup(g, -1.2, 0.2, 4, 9);
    chatGroup(g, 1.2, 0.0, 3, 10);
    wanderers(g, -0.1, 0.6, 2.1, 7, 51);
    scatterTrees(g, r, 10, 31, [[0, 0.6, 3.6], [0.8, 2.6, 2.4]]);
  },
  // 04 永續：風車 + 太陽能板 + 濕地 + 森林
  sustain(g, r) {
    const pond = mesh(wobble(new THREE.CylinderGeometry(2.3, 2.3, 0.08, 14), 0.15, 4), mat(0x6fc0c8, { roughness: 0.3 }), 2, TOP + 0.02, 1.8);
    g.add(pond);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      g.add(mesh(new THREE.ConeGeometry(0.06, 0.8, 4), mat(0x7f9a4c), 2 + Math.cos(a) * 2.4, TOP + 0.4, 1.8 + Math.sin(a) * 2.4));
    }
    // egret
    const bird = new THREE.Group();
    const egret = mesh(new THREE.SphereGeometry(0.22, 8, 6), mat(C.white), 0, 0.55, 0);
    egret.scale.set(1.4, 1, 1);
    bird.add(egret);
    bird.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 4), mat(0x333333), 0, 0.25, 0));
    bird.add(mesh(new THREE.ConeGeometry(0.05, 0.3, 4), mat(C.gold), 0.4, 0.7, 0).rotateZ(-Math.PI / 2));
    bird.position.set(2.6, TOP, 1.2);
    g.add(bird);
    const turbines = [];
    [[-3, -2.4, 4.2], [-0.6, -3.6, 3.6], [-4.2, 0.6, 3.2]].forEach(([x, z, h]) => {
      const t = new THREE.Group();
      t.add(mesh(new THREE.CylinderGeometry(0.1, 0.18, h, 6), mat(C.white), 0, h / 2, 0));
      const hub = new THREE.Group();
      hub.position.set(0, h, 0.2);
      hub.add(mesh(new THREE.SphereGeometry(0.16, 8, 6), mat(C.white)));
      for (let i = 0; i < 3; i++) {
        const b = mesh(new THREE.BoxGeometry(0.14, 1.6, 0.04), mat(C.white), 0, 0.8, 0);
        const arm = new THREE.Group();
        arm.rotation.z = (i * Math.PI * 2) / 3;
        arm.add(b);
        hub.add(arm);
      }
      t.add(hub);
      t.position.set(x, TOP, z);
      t.rotation.y = 0.5;
      g.add(t);
      solids.push(t);
      turbines.push(hub);
    });
    animators.push((t, dt) => turbines.forEach((h, i) => { h.rotation.z -= dt * (1.4 + i * 0.3); }));
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
      const p = mesh(new THREE.BoxGeometry(1.1, 0.06, 0.7), mat(C.navy, { roughness: 0.3, metalness: 0.3 }), 2.6 + i * 1.25, TOP + 0.5, -2.6 + j * 1.0);
      p.rotation.x = -0.45;
      g.add(p);
      g.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 4), mat(0x999999), 2.6 + i * 1.25, TOP + 0.25, -2.6 + j * 1.0));
    }
    // birdwatchers at the pond and a stroll through the woods
    people(g, [[-0.6, 2.6], [-0.5, 1.3]], 41);
    crowd.slice(-2).forEach((p) => { p.face = [2, 1.8]; });
    wanderers(g, -1.7, 3.3, 1.2, 6, 71);
    scatterTrees(g, r, 22, 41, [[2, 1.8, 2.8], [3.85, -2.1, 2.2], [-1.7, 3.3, 1.8], [-0.6, 2, 1]]);
  },
  // 05 未來：燈塔 + 玻璃塔 + 起重機 + 熱氣球
  future(g, r) {
    pathDisc(g, 0, 0, 3);
    const lh = new THREE.Group();
    for (let i = 0; i < 5; i++) lh.add(mesh(new THREE.CylinderGeometry(0.75 - i * 0.08, 0.8 - i * 0.08, 1, 10), mat(i % 2 ? C.brick : C.white), 0, 0.5 + i, 0));
    lh.add(mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.7, 10), lampMat, 0, 5.35, 0));
    lh.add(mesh(new THREE.ConeGeometry(0.7, 0.8, 10), mat(C.navy), 0, 6.1, 0));
    const beam = new THREE.Mesh(new THREE.ConeGeometry(1.3, 9, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff1b8, transparent: true, opacity: 0.0, depthWrite: false, side: THREE.DoubleSide }));
    beam.rotation.z = Math.PI / 2;
    beam.position.x = 4.5;
    const beamPivot = new THREE.Group();
    beamPivot.position.y = 5.35;
    beamPivot.add(beam);
    lh.add(beamPivot);
    lh.position.set(-3, TOP, 2.2);
    g.add(lh);
    solids.push(lh); // the beam is transparent, so it is left out of the footprint
    animators.push((t) => { beamPivot.rotation.y = t * 0.8; });
    world.beam = beam;
    // glass tower with rings
    const tw = glassTower();
    tw.position.set(1.4, TOP, -1.6);
    g.add(tw);
    registerLayers(g, tw, { gap: 0.95, labelX: -1.7, storey: 3.6 });
    tw.userData.levels.slice(0, 5).forEach(({ obj }, i) => {
      people(obj, [[0.75, -0.35], [-0.6, 0.55]], 60 + i);
      crowd.slice(-2).forEach((p) => { p.y = 0.1; p.scale *= 0.9; });
    });
    // crane
    const cr = new THREE.Group();
    cr.add(mesh(new THREE.BoxGeometry(0.3, 5.5, 0.3), mat(C.gold), 0, 2.75, 0));
    const jib = new THREE.Group();
    jib.position.y = 5.5;
    jib.add(mesh(new THREE.BoxGeometry(4.2, 0.22, 0.22), mat(C.gold), 1.2, 0, 0));
    jib.add(mesh(new THREE.BoxGeometry(0.6, 0.5, 0.5), mat(C.slate), -0.9, -0.1, 0));
    const cable = mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.6, 3), mat(0x333333), 2.8, -0.8, 0);
    jib.add(cable);
    jib.add(mesh(new THREE.BoxGeometry(0.5, 0.4, 0.5), mat(C.brick), 2.8, -1.7, 0));
    cr.add(jib);
    cr.position.set(3.8, TOP, 1.4);
    g.add(cr);
    animators.push((t) => { jib.rotation.y = Math.sin(t * 0.25) * 1.2; });
    // hot-air balloon "100"
    const bl = new THREE.Group();
    bl.add(mesh(new THREE.SphereGeometry(1.1, 10, 8), mat(C.brick)));
    bl.add(mesh(new THREE.SphereGeometry(1.12, 10, 8, 0, Math.PI * 2, 0.9, 0.6), mat(C.white)));
    bl.add(mesh(new THREE.ConeGeometry(0.6, 0.8, 10), mat(C.brick), 0, -1.1, 0).rotateX(Math.PI));
    bl.add(mesh(new THREE.BoxGeometry(0.4, 0.35, 0.4), mat(C.wood), 0, -1.75, 0));
    bl.position.set(-0.5, TOP + 9, -2);
    g.add(bl);
    animators.push((t) => { bl.position.y = TOP + 9 + Math.sin(t * 0.7) * 0.6; bl.position.x = -0.5 + Math.sin(t * 0.2) * 1.2; });
    chatGroup(g, -0.6, 1.4, 3, 11);
    wanderers(g, 0.2, 0.8, 1.4, 5, 91);
    const zh = zongheBuilding();
    zh.position.set(4.0, TOP, -2.4);
    zh.rotation.y = 0.5;
    zh.scale.setScalar(0.5);
    g.add(zh);
    registerLayers(g, zh, { gap: 0.6, labels: false });
    zh.userData.levels.slice(0, 11).forEach(({ obj }, i) => { if (i % 2 === 0) { people(obj, [[-1.1, 0.5], [1.0, -0.8]], 760 + i); crowd.slice(-2).forEach((p) => { p.y = 0.11; }); } });
    scatterTrees(g, r, 9, 51, [[-3, 2.2, 1.6], [1.4, -1.6, 2], [3.8, 1.4, 1.2], [0, 0.8, 2.4], [4.0, -2.4, 1.8]]);
  },
  // 06 師生榮耀：運動會操場（跑道接力、拔河、加油看台、終點拱門）+ 頒獎台 + 單槓
  honors(g, r) {
    const cx = 0, cz = 0.6;
    const track = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.5, 3, 32), mat(0xd9774f));
    track.rotation.x = Math.PI / 2;
    track.scale.set(1.35, 1, 0.12);
    track.position.set(cx, TOP + 0.05, cz);
    track.receiveShadow = true;
    g.add(track);
    const field = mesh(new THREE.CylinderGeometry(1.95, 1.95, 0.06, 28), mat(0x8ccf6e), cx, TOP + 0.04, cz);
    field.scale.set(1.35, 1, 1);
    g.add(field);
    // inflatable finish arch across the track's east bend
    const arch = mesh(new THREE.TorusGeometry(0.85, 0.13, 6, 16, Math.PI), mat(C.brick), cx + 3.24, TOP, cz);
    g.add(arch);
    g.add(mesh(new THREE.BoxGeometry(0.16, 0.28, 1.1), mat(C.white), cx + 3.24, TOP + 0.98, cz).rotateY(Math.PI / 2));
    // relay runners
    for (let k = 0; k < 8; k++) {
      const lane = ((k % 4) - 1.5) * 0.16;
      addPerson({ kind: 'run', anchor: g, cx, cz, rx: (2.4 + lane) * 1.35, rz: 2.4 + lane, speed: 0.75 + (k % 4) * 0.06, ph: k * 0.8, pack: false, shirt: SHIRTS[k % 4], seed: 600 + k });
    }
    // tug-of-war in the infield
    const rope = mesh(new THREE.CylinderGeometry(0.035, 0.035, 3.6, 5), mat(0xd8c49a), cx, TOP + 0.42, cz);
    rope.rotation.z = Math.PI / 2;
    g.add(rope);
    animators.push((t) => { rope.position.x = cx + Math.sin(t * 1.3) * 0.3; });
    for (let k = 0; k < 4; k++) {
      addPerson({ kind: 'tug', anchor: g, bx: cx - 0.6 - k * 0.38, x: cx - 0.6 - k * 0.38, z: cz + (k % 2 ? 0.12 : -0.12), yaw: Math.PI / 2, pack: false, shirt: 0xd6643c, seed: 620 + k });
      addPerson({ kind: 'tug', anchor: g, bx: cx + 0.6 + k * 0.38, x: cx + 0.6 + k * 0.38, z: cz + (k % 2 ? -0.12 : 0.12), yaw: -Math.PI / 2, pack: false, shirt: 0x3d5a80, seed: 630 + k });
    }
    addPerson({ kind: 'idle', anchor: g, x: cx, z: cz + 0.9, face: [cx, cz], pack: false, shirt: 0x222222, seed: 640 });
    // grandstand with cheering classmates
    for (let k = 0; k < 3; k++) {
      const h = 0.3 * (k + 1);
      const tier = mesh(new THREE.BoxGeometry(5.6, h, 0.55), mat(k % 2 ? 0xe9e1d3 : C.white), cx, TOP + h / 2, 4.35 + k * 0.55);
      g.add(tier);
      platforms.push(tier);
      for (let j = 0; j < 7; j++) {
        addPerson({ kind: 'cheer', anchor: g, x: cx - 2.4 + j * 0.8 + (k % 2) * 0.2, z: 4.35 + k * 0.55, y: TOP + h, yaw: Math.PI, pack: false, ph: j * 1.7 + k, seed: 650 + k * 10 + j });
      }
    }
    const pl = pole(g, -2.9, 5.75, 2.7), pr = pole(g, 2.9, 5.75, 2.7);
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 0.8), new THREE.MeshStandardMaterial({ map: textTexture('師大運動會　加油！', { bg: '#d6643c', fg: '#fffaf3' }), side: THREE.DoubleSide, roughness: 0.9 }));
    banner.position.set(cx, pl[1] - 0.45, 5.75);
    banner.rotation.y = Math.PI;
    g.add(banner);
    // bunting strung over the track
    const p1 = pole(g, -4.4, -1.6, 2.8), p2 = pole(g, 4.4, -1.4, 2.8), p3 = pole(g, -4.3, 2.9, 2.8), p4 = pole(g, 4.3, 3.0, 2.8);
    bunting(g, p1, p2, 18, 0.5);
    bunting(g, p3, p4, 18, 0.5);
    bunting(g, pl, pr, 10, 0.2);
    // podium with winners, floating trophy
    const steps = [[0, 1.1], [-0.9, 0.75], [0.9, 0.5]];
    steps.forEach(([x, h], k) => {
      const step = mesh(new THREE.BoxGeometry(0.9, h, 0.9), mat(C.white), x + 3.0, TOP + h / 2, -3.6);
      g.add(step);
      platforms.push(step);
      addPerson({ kind: 'cheer', anchor: g, x: x + 3.0, z: -3.6, y: TOP + h, yaw: Math.PI, pack: false, shirt: [C.gold, 0xc0c4c8, 0xc98a52][k], ph: k * 2.1, seed: 680 + k });
    });
    const trophy = new THREE.Group();
    const gold = mat(C.gold, { metalness: 0.6, roughness: 0.3, emissive: 0x6b4a00, emissiveIntensity: 0.25 });
    trophy.add(mesh(new THREE.CylinderGeometry(0.35, 0.2, 0.55, 10), gold, 0, 0.6, 0));
    trophy.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 6), gold, 0, 0.2, 0));
    trophy.add(mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.1, 10), gold, 0, 0.05, 0));
    trophy.position.set(3.0, TOP + 2.4, -3.6);
    g.add(trophy);
    animators.push((t) => { trophy.rotation.y = t; trophy.position.y = TOP + 2.4 + Math.sin(t * 2) * 0.1; });
    chatGroup(g, 3.0, -2.3, 3, 690);
    crowd.slice(-3).forEach((p) => { p.face = [3.0, -3.6]; p.x = 2.2 + (crowd.indexOf(p) % 3) * 0.8; p.z = -2.5; });
    // balloon bunch by the podium
    const balloons = new THREE.Group();
    [[0, 0, 0xd6643c], [0.35, 0.25, C.gold], [-0.3, 0.3, 0x3d5a80], [0.1, 0.55, 0x6aa36f], [-0.1, -0.3, 0xe8705a]].forEach(([x, y, c]) => {
      balloons.add(mesh(new THREE.SphereGeometry(0.28, 10, 8), mat(c, { roughness: 0.4 }), x, y, 0));
      balloons.add(mesh(new THREE.CylinderGeometry(0.008, 0.008, 1.6, 3), mat(0x777777), x * 0.5, y - 0.9, 0));
    });
    balloons.position.set(4.9, TOP + 2.2, -1.9);
    g.add(balloons);
    animators.push((t) => { balloons.position.y = TOP + 2.2 + Math.sin(t * 1.4) * 0.12; balloons.rotation.y = Math.sin(t * 0.6) * 0.4; });
    // high bar (gymnastics)
    const hb = new THREE.Group();
    hb.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 5), mat(C.slate), -0.9, 1.3, 0));
    hb.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 5), mat(C.slate), 0.9, 1.3, 0));
    hb.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.9, 6), mat(0xdddddd, { metalness: 0.7 }), 0, 2.6, 0).rotateZ(Math.PI / 2));
    const gym = new THREE.Group();
    gym.position.y = 2.6;
    const body = person(0xd6643c, 1.2);
    body.rotation.z = Math.PI;
    body.position.y = -0.1;
    gym.add(body);
    hb.add(gym);
    hb.position.set(-3.4, TOP, -3.4);
    hb.rotation.y = 0.4;
    g.add(hb);
    animators.push((t) => { gym.rotation.x = t * 2.4; });
    const gymB = gymBuilding();
    gymB.position.set(-0.2, TOP, -4.6);
    gymB.rotation.y = Math.PI;
    gymB.scale.setScalar(0.55);
    g.add(gymB);
    registerLayers(g, gymB, { gap: 1.6, labelX: 1.6, storey: 3.6 });
    gymB.userData.levels.slice(0, 5).forEach(({ obj }, i) => {
      if (i === 3) for (let j = 0; j < 6; j++) addPerson({ kind: 'cheer', anchor: obj, x: -1.0 + j * 0.4, z: 1.15, y: 0.3, yaw: Math.PI, pack: false, ph: j * 1.3, seed: 720 + j });
      else { people(obj, [[-1.4, 0.7], [1.3, -0.9]], 730 + i); crowd.slice(-2).forEach((p) => { p.y = 0.11; }); }
    });
    scatterTrees(g, r, 6, 61, [[cx, cz, 4.6], [0, 5, 3.4], [3.0, -3.4, 2.2], [-3.4, -3.4, 1.6], [4.9, -1.9, 1], [-0.2, -4.6, 2.2]]);
  },
};

// ---------- world assembly ----------
const world = { islands: [], pins: [], hoverables: [] };
const islandRoot = new THREE.Group();
scene.add(islandRoot);

THEMES.forEach((th, i) => {
  const g = islandBase(th.r, i * 3.1 + 1, th.id === 'sustain' ? C.grass2 : C.grass);
  g.position.set(th.pos[0], 0, th.pos[1]);
  BUILDERS[th.id]?.(g, th.r);
  g.userData.theme = th;
  g.traverse((o) => { if (o.isMesh) o.userData.island = g; });
  islandRoot.add(g);
  world.islands.push(g);
  world.hoverables.push(g);
  g.userData.baseY = 0;
  g.userData.lift = 0;
});

ISLETS.forEach((it, i) => {
  const g = islandBase(it.r, 40 + i * 2.7);
  g.position.set(it.pos[0], 0, it.pos[1]);
  scatterTrees(g, it.r, it.trees ?? 4, 70 + i, [[0, 0, it.r * 0.5]]);
  if (it.name === '林口校區') {
    const b = linkouBlock(); b.position.set(-0.5, TOP, -0.3); b.scale.setScalar(0.85); g.add(b); registerLayers(g, b, { gap: 0.9, labels: false });
    const ct = clockTower(); ct.position.set(1.7, TOP, 0.6); ct.scale.setScalar(0.8); g.add(ct); solids.push(ct);
  } else if (it.name === '公館校區') {
    const b = gongguanAdmin(); b.position.set(-0.3, TOP, -0.4); b.scale.setScalar(0.75); g.add(b); registerLayers(g, b, { gap: 0.8, labels: false });
    for (const [x, z, h] of [[1.7, 0.9, 3.2], [-1.9, 1.1, 2.8]]) { const a = araucaria(h); a.position.set(x, TOP, z); g.add(a); }
  } else if (it.house) { const h = house(0xfff1dc, C.brick, 1.2); h.position.set(0, TOP, 0); g.add(h); registerLayers(g, h, { gap: 1.0, labels: false }); }
  if (it.house) chatGroup(g, 0.2, 1.7, 3, 700 + i);
  g.userData.islet = it;
  islandRoot.add(g);
  it.group = g;
});

// boardwalk bridges from the core island to each theme island (and to the two campus islets, so walk mode reaches them)
const bridges = []; // { sx, sz, dx, dz, span }: plank run from the start point along the unit direction
function bridge(a, b, ra, rb) {
  const g = new THREE.Group();
  const dir = new THREE.Vector3(b.x - a.x, 0, b.z - a.z);
  const len = dir.length();
  dir.normalize();
  const start = new THREE.Vector3(a.x, 0, a.z).addScaledVector(dir, ra * 0.92);
  const span = len - ra * 0.92 - rb * 0.92;
  const n = Math.max(4, Math.round(span / 0.55));
  for (let i = 0; i < n; i++) {
    const p = start.clone().addScaledVector(dir, (i + 0.5) * (span / n));
    const arch = Math.sin(((i + 0.5) / n) * Math.PI) * 0.5;
    const plank = mesh(new THREE.BoxGeometry(0.42, 0.12, 1.3), mat(i % 2 ? C.wood : 0xb07d52), p.x, 0.35 + arch, p.z);
    plank.rotation.y = Math.atan2(dir.x, dir.z) + Math.PI / 2;
    g.add(plank);
    if (i % 3 === 0) {
      for (const s of [-1, 1]) {
        const off = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(0.62 * s);
        g.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.6, 4), mat(C.wood), p.x + off.x, -0.2 + arch, p.z + off.z));
      }
    }
  }
  // students crossing, following the arch of the planks
  const end = start.clone().addScaledVector(dir, span);
  walkers(null, start.x, start.z, end.x, end.z, 4, Math.round(b.x + b.z), { lane: 0.3, yAt: (u) => 0.41 + Math.sin(u * Math.PI) * 0.5 });
  bridges.push({ sx: start.x, sz: start.z, dx: dir.x, dz: dir.z, span });
  return g;
}
const core = THEMES[0];
[...THEMES.slice(1), ...ISLETS].forEach((th) => {
  islandRoot.add(bridge({ x: core.pos[0], z: core.pos[1] }, { x: th.pos[0], z: th.pos[1] }, core.r, th.r));
});

// ocean
const oceanGeo = new THREE.PlaneGeometry(460, 460, 90, 90);
oceanGeo.rotateX(-Math.PI / 2);
const oceanMat = new THREE.MeshStandardMaterial({ color: C.water, flatShading: true, roughness: 0.35, metalness: 0.05, transparent: true, opacity: 0.94 });
const ocean = new THREE.Mesh(oceanGeo, oceanMat);
ocean.position.y = -0.55;
ocean.receiveShadow = true;
scene.add(ocean);
const oceanBase = oceanGeo.attributes.position.array.slice();
animators.push((t) => {
  const p = oceanGeo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = oceanBase[i * 3], z = oceanBase[i * 3 + 2];
    p.array[i * 3 + 1] = Math.sin(x * 0.12 + t * 0.9) * 0.22 + Math.cos(z * 0.1 + t * 0.7) * 0.2;
  }
  p.needsUpdate = true;
  world.islands.concat(ISLETS.map((i) => i.group)).forEach((g, i) => {
    const h = g.userData.halo;
    if (h) { const s = 1 + Math.sin(t * 1.2 + i) * 0.03; h.scale.set(s, s, 1); }
  });
});

// boats
function boat(color) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(1.8, 0.4, 0.7), mat(C.white), 0, 0.2, 0));
  g.add(mesh(new THREE.BoxGeometry(1.5, 0.12, 0.72), mat(color), 0, 0.05, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.8, 4), mat(C.wood), 0.1, 1.1, 0));
  const sail = mesh(prism(1.1, 1.5, 0.04), mat(C.white), 0.1, 0.4, 0);
  sail.rotation.y = Math.PI / 2;
  g.add(sail);
  return g;
}
[[46, 0.05, 0xd6643c, 0], [38, -0.07, 0x3d5a80, 2.5], [55, 0.04, 0xf1b73b, 4.4]].forEach(([R, w, c, ph]) => {
  const b = boat(c);
  scene.add(b);
  animators.push((t) => {
    const a = t * w + ph;
    b.position.set(Math.cos(a) * R, -0.45 + Math.sin(t * 1.5 + ph) * 0.12, Math.sin(a) * R * 0.8);
    b.rotation.y = -a + (w > 0 ? -Math.PI / 2 : Math.PI / 2);
    b.rotation.z = Math.sin(t * 1.3 + ph) * 0.06;
  });
});

// clouds
const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, transparent: true, opacity: 0.92, roughness: 1 });
const clouds = [];
for (let i = 0; i < 9; i++) {
  const c = new THREE.Group();
  const n = 3 + (i % 3);
  for (let k = 0; k < n; k++) {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1.4 + Math.random() * 1.2, 0), cloudMat);
    m.position.set(k * 1.8 - n, Math.random() * 0.8, Math.random() * 1.5);
    c.add(m);
  }
  c.position.set(-110 + i * 26, 36 + (i % 4) * 5, -70 + ((i * 37) % 60));
  scene.add(c);
  clouds.push(c);
}
animators.push((t, dt) => clouds.forEach((c) => { c.position.x += dt * 1.6; if (c.position.x > 120) c.position.x = -120; }));

// birds
const birds = new THREE.Group();
for (let i = 0; i < 5; i++) {
  const b = new THREE.Group();
  const wingL = mesh(new THREE.BoxGeometry(0.7, 0.04, 0.22), mat(0x4a4038), -0.35, 0, 0);
  const wingR = mesh(new THREE.BoxGeometry(0.7, 0.04, 0.22), mat(0x4a4038), 0.35, 0, 0);
  const pl = new THREE.Group(); pl.add(wingL);
  const pr = new THREE.Group(); pr.add(wingR);
  b.add(pl, pr);
  b.position.set(i * 1.4 - 2.8, Math.abs(i - 2) * 0.5, -Math.abs(i - 2) * 1.2);
  birds.add(b);
  animators.push((t) => { const f = Math.sin(t * 8 + i) * 0.5; pl.rotation.z = f; pr.rotation.z = -f; });
}
scene.add(birds);
animators.push((t) => {
  const a = t * 0.12;
  birds.position.set(Math.cos(a) * 30, 18 + Math.sin(t * 0.5) * 1.5, Math.sin(a) * 26);
  birds.rotation.y = -a;
});

// ---------- time of day ----------
const TIMES = {
  morning: { bg: 0xf6dccb, sun: 0xffd2a6, si: 1.5, hemi: 0.95, sky: 0xfff0e0, ground: 0x7aa8a6, water: 0x86c4c2, pos: [80, 30, 40], glow: 0.0, theme: 'light' },
  day: { bg: 0xcfe6ea, sun: 0xffffff, si: 2.0, hemi: 1.0, sky: 0xfff4e2, ground: 0x6fa3a8, water: 0x79c3c4, pos: [45, 70, 30], glow: 0.0, theme: 'light' },
  dusk: { bg: 0xf1b79f, sun: 0xff9a66, si: 1.4, hemi: 0.75, sky: 0xffc8a8, ground: 0x6a7f9c, water: 0x6ea3b3, pos: [-70, 22, 30], glow: 0.6, theme: 'light' },
  night: { bg: 0x1b2640, sun: 0x9fb2ff, si: 0.55, hemi: 0.35, sky: 0x40507a, ground: 0x10182a, water: 0x2d4a66, pos: [-30, 60, -40], glow: 1.4, theme: 'dark' },
};
let timeTween = null;
function setTime(name, instant = false) {
  const T = TIMES[name];
  document.querySelectorAll('#time-seg button').forEach((b) => b.classList.toggle('on', b.dataset.time === name));
  document.documentElement.dataset.theme = T.theme;
  const from = {
    bg: scene.background ? scene.background.clone() : new THREE.Color(T.bg),
    sun: sun.color.clone(), si: sun.intensity, hemi: hemi.intensity,
    sky: hemi.color.clone(), ground: hemi.groundColor.clone(), water: oceanMat.color.clone(),
    pos: sun.position.clone(), glow: windowMat.emissiveIntensity,
  };
  const to = {
    bg: new THREE.Color(T.bg), sun: new THREE.Color(T.sun), sky: new THREE.Color(T.sky),
    ground: new THREE.Color(T.ground), water: new THREE.Color(T.water), pos: new THREE.Vector3(...T.pos),
  };
  if (!scene.background) scene.background = new THREE.Color(T.bg);
  timeTween = { t0: performance.now(), dur: instant ? 1 : 1200, from, to, T };
}
function stepTime(now) {
  if (!timeTween) return;
  const { t0, dur, from, to, T } = timeTween;
  const k = Math.min(1, (now - t0) / dur);
  const e = k * k * (3 - 2 * k);
  scene.background.copy(from.bg).lerp(to.bg, e);
  scene.fog.color.copy(scene.background);
  sun.color.copy(from.sun).lerp(to.sun, e);
  sun.intensity = from.si + (T.si - from.si) * e;
  hemi.intensity = from.hemi + (T.hemi - from.hemi) * e;
  hemi.color.copy(from.sky).lerp(to.sky, e);
  hemi.groundColor.copy(from.ground).lerp(to.ground, e);
  oceanMat.color.copy(from.water).lerp(to.water, e);
  sun.position.copy(from.pos).lerp(to.pos, e);
  windowMat.emissiveIntensity = from.glow + (T.glow - from.glow) * e;
  lampMat.emissiveIntensity = 0.2 + windowMat.emissiveIntensity;
  if (world.beam) world.beam.material.opacity = Math.min(0.35, windowMat.emissiveIntensity * 0.25);
  if (k >= 1) timeTween = null;
}

// ---------- labels ----------
const labelsEl = document.getElementById('labels');
THEMES.forEach((th, i) => {
  const el = document.createElement('button');
  el.className = 'pin';
  el.innerHTML = `<span class="no">${th.no}</span>${th.name}`;
  el.addEventListener('click', (e) => { e.stopPropagation(); stopTour(); focusTheme(i); });
  labelsEl.appendChild(el);
  world.pins.push({ el, anchor: new THREE.Vector3(th.pos[0], th.labelY ?? 8, th.pos[1]), idx: i });
});
ISLETS.forEach((it) => {
  const el = document.createElement('button');
  el.className = 'pin mini';
  el.textContent = it.name;
  el.title = it.note ?? '';
  el.addEventListener('click', (e) => {
    e.stopPropagation(); stopTour();
    if (walk.on) { arriveOn(it.group); renderDetail(0, it.item); } else focusTheme(0, it.item);
  });
  labelsEl.appendChild(el);
  world.pins.push({ el, anchor: new THREE.Vector3(it.pos[0], 4, it.pos[1]), mini: true });
});
// floor tags (RF / 3F … FL +x.xx) for every layered building that has labels
layered.forEach((b) => {
  if (!b.labels) return;
  b.tags = b.levels.map((L, k) => {
    const el = document.createElement('div');
    el.className = 'fl-tag';
    el.title = '示意標高（以統一層高推算，非實測）';
    el.innerHTML = `<b>${L.name}</b><span>FL +${(0.3 + k * b.storey).toFixed(2)}</span>`;
    labelsEl.appendChild(el);
    return el;
  });
});
// slide storeys apart for the focused island (or everywhere when 剖面 is on)
function stepLayers(dt) {
  const focusIsland = current >= 0 ? world.islands[current] : null;
  for (const b of layered) {
    const want = explodeAll || b.island === focusIsland ? 1 : 0;
    b.e += (want - b.e) * Math.min(1, dt * 2.5);
    const k = b.e * b.e * (3 - 2 * b.e);
    b.levels.forEach((L, i) => { L.obj.position.y = L.base + i * b.gap * k; });
    const lift = (b.levels.length - 1) * b.gap * k * b.group.scale.y;
    b.island.userData.explodeLift = Math.max(b.island.userData.explodeLift || 0, lift);
  }
}
const v = new THREE.Vector3(), camRight = new THREE.Vector3();
function updatePins() {
  const w = stage.clientWidth, h = stage.clientHeight;
  const focusIsland = current >= 0 ? world.islands[current] : null;
  const labelsOn = !labelsEl.classList.contains('off');
  camRight.setFromMatrixColumn(camera.matrixWorld, 0);
  for (const b of layered) {
    if (!b.tags.length) continue;
    let show = labelsOn && b.island === focusIsland && b.e > 0.5;
    // offset toward screen-left so the tags stay beside the stack whichever way the camera turns
    const pts = b.levels.map((L) => {
      v.setFromMatrixPosition(L.obj.matrixWorld).addScaledVector(camRight, -Math.abs(b.labelX));
      v.y += 0.55;
      v.project(camera);
      return [(v.x * 0.5 + 0.5) * w, (-v.y * 0.5 + 0.5) * h];
    });
    // too far away to read: hide rather than stack the tags on top of each other
    if (show && (pts[0][1] - pts[pts.length - 1][1]) / (pts.length - 1) < (w < 760 ? 18 : 30)) show = false;
    b.tags.forEach((el, k) => {
      if (!show) { el.style.visibility = 'hidden'; return; }
      el.style.visibility = 'visible';
      el.style.opacity = String(Math.min(1, (b.e - 0.5) * 2.5));
      el.style.transform = `translate(${pts[k][0]}px, ${pts[k][1]}px) translate(-100%, -50%)`;
    });
  }
  world.pins.forEach((p) => {
    v.copy(p.anchor);
    if (p.idx != null) v.y += world.islands[p.idx].userData.explodeLift || 0;
    v.project(camera);
    const vis = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
    p.el.style.visibility = vis ? 'visible' : 'hidden';
    if (!vis) return;
    const x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h;
    p.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
    p.el.style.zIndex = String(1000 - Math.round(v.z * 1000));
  });
}

// ---------- camera tween ----------
let camTween = null;
function flyTo(pos, target, dur = 1400) {
  camTween = { t0: performance.now(), dur, p0: camera.position.clone(), t0v: controls.target.clone(), p1: pos.clone(), t1v: target.clone() };
}
function stepCam(now) {
  if (!camTween) return;
  const { t0, dur, p0, t0v, p1, t1v } = camTween;
  const k = Math.min(1, (now - t0) / dur);
  const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
  camera.position.copy(p0).lerp(p1, e);
  camera.position.y += Math.sin(k * Math.PI) * 6; // gentle arc
  controls.target.copy(t0v).lerp(t1v, e);
  if (k >= 1) camTween = null;
}
function themeView(th) {
  // the island's buildings explode when it is focused: aim at the middle of the opened-up stack
  const isl = world.islands[THEMES.indexOf(th)];
  const lift = layered.reduce((m, b) => (b.island === isl ? Math.max(m, (b.levels.length - 1) * b.gap * b.group.scale.y) : m), 0);
  const target = new THREE.Vector3(th.pos[0], 1.5 + lift * 0.7, th.pos[1]);
  // look at the island from the outside of the archipelago toward the center, slightly offset
  const out = new THREE.Vector3(th.pos[0], 0, th.pos[1]);
  if (out.lengthSq() < 1) out.set(0, 0, 1);
  out.normalize();
  const d = th.r * 3 + 13;
  const side = new THREE.Vector3(-out.z, 0, out.x).multiplyScalar(d * 0.35);
  const pos = target.clone().addScaledVector(out, d * 0.85).add(side).add(new THREE.Vector3(0, d * 0.75, 0));
  // on narrow screens the detail sheet covers the bottom: aim a bit lower so the island sits higher
  if (stage.clientWidth < 760) {
    const toCam = new THREE.Vector3(pos.x - target.x, 0, pos.z - target.z).normalize().multiplyScalar(th.r * 2.2);
    target.add(toCam);
    pos.add(toCam).add(new THREE.Vector3(0, 6, 0));
  }
  else { // shift target right of center so the left detail card doesn't cover the island
    const right = new THREE.Vector3().subVectors(target, pos).cross(new THREE.Vector3(0, 1, 0)).normalize();
    target.addScaledVector(right, -th.r * 0.55);
    pos.addScaledVector(right, -th.r * 0.55);
  }
  return { pos, target };
}

// ---------- UI: detail card ----------
const detailEl = document.getElementById('detail');
let current = -1;
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function renderDetail(i, openItem = -1) {
  const th = THEMES[i];
  detailEl.hidden = false;
  detailEl.innerHTML = `
    <div class="d-head">
      <button class="d-close" aria-label="關閉">✕</button>
      <div class="d-top">
        <div class="d-icon">${ICONS[th.icon] ?? ''}</div>
        <div>
          <div class="d-kicker">ISLAND ${th.no} · ${esc(th.en.toUpperCase())}</div>
          <h2 class="d-title">${esc(th.title)}</h2>
        </div>
      </div>
      <p class="d-tagline">${esc(th.tagline)}</p>
      ${th.quote ? `<blockquote class="d-quote">${esc(th.quote)}</blockquote>` : ''}
      <div class="d-chips">${(th.chips ?? []).map((c, k) => `<span class="d-chip ${k === 0 ? 'hot' : ''}">${esc(c)}</span>`).join('')}<span class="d-chip">${th.items.length} 個亮點</span></div>
      <div class="d-sub">島上亮點</div>
    </div>
    <div class="d-body">
      ${th.items.map((it, k) => `
        <div class="item ${k === openItem ? 'open' : ''}" data-k="${k}">
          <button><span class="dot"></span><span class="it">${it.big ? `<span class="big">${esc(it.big)}</span>` : ''}${esc(it.t)}</span><span class="tag">${esc(it.tag ?? '')}</span><span class="chev">›</span></button>
          <div class="more">${esc(it.d)}${it.src ? `<br /><a href="${esc(it.src)}" target="_blank" rel="noopener">來源：${esc(it.srcName ?? '臺師大官網')} ↗</a>` : ''}</div>
        </div>`).join('')}
    </div>
    <div class="d-foot">
      <button data-nav="-1">← ${esc(THEMES[(i - 1 + THEMES.length) % THEMES.length].name)}</button>
      <button data-nav="1">${esc(THEMES[(i + 1) % THEMES.length].name)} →</button>
    </div>`;
  detailEl.querySelector('.d-close').onclick = () => { stopTour(); closeDetail(); };
  detailEl.querySelectorAll('.item > button').forEach((b) => b.addEventListener('click', () => b.parentElement.classList.toggle('open')));
  detailEl.querySelectorAll('[data-nav]').forEach((b) => b.addEventListener('click', () => { stopTour(); focusTheme((i + +b.dataset.nav + THEMES.length) % THEMES.length); }));
  if (openItem >= 0) detailEl.querySelector(`.item[data-k="${openItem}"]`)?.scrollIntoView({ block: 'center' });
}
function focusTheme(i, openItem = -1) {
  const th = THEMES[i];
  if (walk.on) walkTo(i); // walking: the avatar hops onto the island instead of the camera flying there
  else {
    current = i;
    const { pos, target } = themeView(th);
    flyTo(pos, target);
  }
  renderDetail(i, openItem);
  world.pins.forEach((p) => p.el.classList.toggle('active', p.idx === i));
  document.querySelectorAll('#theme-list button').forEach((b, k) => b.classList.toggle('on', k === i));
  indexEl.classList.remove('open');
  history.replaceState(null, '', '#' + th.id);
  hideHint();
}
function closeDetail() {
  current = -1;
  detailEl.hidden = true;
  world.pins.forEach((p) => p.el.classList.remove('active'));
  document.querySelectorAll('#theme-list button').forEach((b) => b.classList.remove('on'));
  history.replaceState(null, '', location.pathname);
  if (!walk.on) flyTo(HOME.pos, HOME.target);
}

// ---------- UI: index panel ----------
const indexEl = document.getElementById('index');
const listEl = document.getElementById('theme-list');
const total = THEMES.reduce((s, t) => s + t.items.length, 0);
document.getElementById('index-meta').innerHTML = `${THEMES.length} 座主題島 / ${total} 個亮點<br />一座島是一個面向，走進大獅園的百年風景。`;
listEl.innerHTML = THEMES.map((th) => `
  <li><button>
    <span class="tl-no">${th.no}</span>
    <span><div class="tl-name">${esc(th.title)}</div><div class="tl-en">${esc(th.en)}</div></span>
    <span class="tl-count">${th.items.length} ↗</span>
  </button></li>`).join('');
listEl.querySelectorAll('button').forEach((b, i) => b.addEventListener('click', () => { stopTour(); focusTheme(i); }));

const srcEl = document.getElementById('source-list');
srcEl.innerHTML = SOURCES.map((s) => `<a class="src" href="${esc(s.url)}" target="_blank" rel="noopener"><b>${esc(s.name)}</b>${esc(s.url)}</a>`).join('');

const searchEl = document.getElementById('search');
const resultsEl = document.getElementById('search-results');
let tab = 'themes';
function showTab(name) {
  tab = name;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === name));
  const q = searchEl.value.trim();
  listEl.hidden = name !== 'themes' || !!q;
  resultsEl.hidden = name !== 'themes' || !q;
  srcEl.hidden = name !== 'sources';
}
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));
function hl(s, q) { const e = esc(s); return q ? e.split(esc(q)).join(`<mark>${esc(q)}</mark>`) : e; }
searchEl.addEventListener('input', () => {
  const q = searchEl.value.trim();
  if (tab !== 'themes') showTab('themes');
  showTab('themes');
  if (!q) return;
  const ql = q.toLowerCase();
  const hits = [];
  THEMES.forEach((th, i) => th.items.forEach((it, k) => {
    if ((it.t + it.d + (it.tag ?? '')).toLowerCase().includes(ql)) hits.push({ i, k, th, it });
  }));
  resultsEl.innerHTML = hits.length
    ? hits.map((h) => `<button class="sr" data-i="${h.i}" data-k="${h.k}"><div class="sr-t">${hl(h.it.t, q)}</div><div class="sr-m">${h.th.no} ${esc(h.th.title)}</div></button>`).join('')
    : `<div class="empty">找不到「${esc(q)}」，換個關鍵字試試。</div>`;
  resultsEl.querySelectorAll('.sr').forEach((b) => b.addEventListener('click', () => { stopTour(); focusTheme(+b.dataset.i, +b.dataset.k); }));
});
document.getElementById('index-grip').addEventListener('click', () => indexEl.classList.toggle('open'));
document.getElementById('btn-list').addEventListener('click', () => {
  if (window.innerWidth <= 760) indexEl.classList.toggle('open');
  else { searchEl.focus(); }
});

// ---------- toolbar ----------
document.querySelectorAll('#time-seg button').forEach((b) => b.addEventListener('click', () => setTime(b.dataset.time)));
const btnLabels = document.getElementById('btn-labels');
btnLabels.addEventListener('click', () => { btnLabels.classList.toggle('on'); labelsEl.classList.toggle('off', !btnLabels.classList.contains('on')); });
const btnSpin = document.getElementById('btn-spin');
btnSpin.addEventListener('click', () => { controls.autoRotate = !controls.autoRotate; btnSpin.classList.toggle('on', controls.autoRotate); });
const btnExplode = document.getElementById('btn-explode');
btnExplode.addEventListener('click', () => { explodeAll = !explodeAll; btnExplode.classList.toggle('on', explodeAll); });
document.getElementById('btn-bird').addEventListener('click', () => { stopTour(); if (walk.on) exitWalk(); detailEl.hidden = true; current = -1; flyTo(BIRD.pos, BIRD.target); });
document.getElementById('btn-overview').addEventListener('click', () => { stopTour(); if (walk.on) exitWalk(); else closeDetail(); });

// guided tour
let tourTimer = null;
const btnTour = document.getElementById('btn-tour');
function startTour() {
  if (walk.on) exitWalk();
  let i = 0;
  btnTour.classList.add('on');
  const step = () => { focusTheme(i); i = (i + 1) % THEMES.length; };
  step();
  tourTimer = setInterval(step, 7000);
}
function stopTour() { if (tourTimer) { clearInterval(tourTimer); tourTimer = null; btnTour.classList.remove('on'); } }
btnTour.addEventListener('click', () => (tourTimer ? stopTour() : startTour()));
document.getElementById('tour-card').addEventListener('click', () => { stopTour(); startTour(); });

// intro modal
const intro = document.getElementById('intro');
let introStep = 0;
function renderIntro() {
  const s = INTRO[introStep];
  document.getElementById('intro-kicker').textContent = `HELLO, NTNU / ${String(introStep + 1).padStart(2, '0')}`;
  document.getElementById('intro-title').textContent = s.title;
  document.getElementById('intro-body').textContent = s.body;
  document.getElementById('intro-next').textContent = introStep === INTRO.length - 1 ? '開始探索 →' : '下一步 →';
}
document.getElementById('intro-next').addEventListener('click', () => {
  if (introStep < INTRO.length - 1) { introStep++; renderIntro(); } else intro.hidden = true;
});
document.getElementById('intro-skip').addEventListener('click', () => { intro.hidden = true; });
document.getElementById('btn-help').addEventListener('click', () => { introStep = 0; renderIntro(); intro.hidden = false; });
renderIntro();

const hintEl = document.getElementById('hint');
function hideHint() { hintEl.style.opacity = '0'; }

// ---------- picking ----------
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let hovered = null;
let downAt = null;
function pick(e) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObjects(world.hoverables, true).find((h) => h.object.userData.island);
  return hit ? hit.object.userData.island : null;
}
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse' || walk.on) return;
  const g = pick(e);
  if (g !== hovered) {
    hovered = g;
    canvas.style.cursor = g ? 'pointer' : '';
    world.pins.forEach((p) => p.el.classList.toggle('active', p.idx === current || (g && THEMES[p.idx] === g.userData.theme)));
  }
});
canvas.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; stopTour(); hideHint(); });
canvas.addEventListener('pointerup', (e) => {
  if (walk.on || !downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return;
  const g = pick(e);
  if (g) focusTheme(THEMES.indexOf(g.userData.theme));
});
controls.addEventListener('start', () => { camTween = null; });

// ---------- walk mode (first-person avatar, WASD) ----------
// Ground = each island's grass top (same wobble outline as islandBase) plus the boardwalks, with short
// ramps where planks meet grass. Layered buildings and `solids` block the avatar; each footprint is a box
// in the object's own space, so rotated or scaled buildings collide where they actually stand.
// While walking, OrbitControls is off and stepWalk() places the camera (first person, or behind the avatar).
const EYE = 1.0, WALK_SPEED = 5, RUN_SPEED = 10, RAMP = 1.8;
const walkables = world.islands.concat(ISLETS.map((it) => it.group));
scene.updateMatrixWorld(true);
const _bm = new THREE.Matrix4(), _bb = new THREE.Box3();
function footprint(obj) {
  const inv = new THREE.Matrix4().copy(obj.matrixWorld).invert();
  const box = new THREE.Box3();
  obj.traverse((o) => {
    if (!o.isMesh || o.material.transparent) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    box.union(_bb.copy(o.geometry.boundingBox).applyMatrix4(_bm.multiplyMatrices(inv, o.matrixWorld)));
  });
  return { obj, box };
}
const colliders = [...layered.map((b) => b.group), ...solids].map(footprint);
const steps = platforms.map(footprint);
const _lp = new THREE.Vector3(), _li = new THREE.Matrix4();
// is (x, z) inside obj's footprint box, grown by `pad` world units?
function inside({ obj, box }, x, z, pad) {
  _li.copy(obj.matrixWorld).invert();
  _lp.set(x, obj.matrixWorld.elements[13], z).applyMatrix4(_li);
  const m = pad / obj.matrixWorld.getMaxScaleOnAxis();
  return _lp.x > box.min.x - m && _lp.x < box.max.x + m && _lp.z > box.min.z - m && _lp.z < box.max.z + m;
}
function groundAt(x, z) {
  for (const g of walkables) {
    const dx = x - g.position.x, dz = z - g.position.z;
    const R = g.userData.r * 0.9 * wobbleK(Math.atan2(dz, dx), 0.1, g.userData.seed) - 0.25;
    if (dx * dx + dz * dz >= R * R) continue;
    let y = g.position.y + TOP;
    for (const s of steps) if (inside(s, x, z, 0.05)) y = Math.max(y, _lp.set(0, s.box.max.y, 0).applyMatrix4(s.obj.matrixWorld).y);
    return { y, g };
  }
  for (const b of bridges) {
    const rx = x - b.sx, rz = z - b.sz;
    const s = rx * b.dx + rz * b.dz;
    if (Math.abs(rz * b.dx - rx * b.dz) > 0.5 || s < -RAMP || s > b.span + RAMP) continue;
    const u = Math.min(1, Math.max(0, s / b.span));
    const ramp = s < 0 ? -s / RAMP : s > b.span ? (s - b.span) / RAMP : 0;
    return { y: 0.41 + Math.sin(u * Math.PI) * 0.5 + (TOP - 0.41) * ramp, g: 'bridge' };
  }
  return null;
}
function blocked(x, z) {
  return colliders.some((c) => inside(c, x, z, 0.25));
}

// the avatar: a student in an NTNU-orange shirt with a lion-ear cap; faces +z like the crowd
function avatarModel() {
  const g = new THREE.Group();
  const shirt = mat(0xd6643c), skin = mat(0xf2c9a0), jeans = mat(C.blue);
  const limb = (w, h, m, x, y) => {
    const p = new THREE.Group();
    p.position.set(x, y, 0);
    p.add(mesh(new THREE.BoxGeometry(w, h, w), m, 0, -h / 2, 0));
    g.add(p);
    return p;
  };
  const legL = limb(0.13, 0.42, jeans, 0.09, 0.42), legR = limb(0.13, 0.42, jeans, -0.09, 0.42);
  g.add(mesh(new THREE.BoxGeometry(0.36, 0.42, 0.22), shirt, 0, 0.63, 0));
  const armL = limb(0.09, 0.4, shirt, 0.23, 0.82), armR = limb(0.09, 0.4, shirt, -0.23, 0.82);
  g.add(mesh(new THREE.SphereGeometry(0.17, 10, 8), skin, 0, 1.0, 0));
  g.add(mesh(new THREE.SphereGeometry(0.178, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x2a1d16), 0, 1.03, 0));
  for (const s of [-1, 1]) {
    g.add(mesh(new THREE.SphereGeometry(0.06, 6, 4), mat(0xe8ac4c), s * 0.12, 1.17, 0));
    g.add(mesh(new THREE.BoxGeometry(0.035, 0.035, 0.02), mat(0x2a1d16), s * 0.06, 1.01, 0.165));
  }
  g.add(mesh(new THREE.BoxGeometry(0.26, 0.3, 0.12), mat(C.navy), 0, 0.66, -0.17));
  g.userData = { legL, legR, armL, armR };
  return g;
}
const avatar = avatarModel();
avatar.visible = false;
scene.add(avatar);

const walk = { on: false, fp: true, started: false, x: 0, z: 0, y: TOP, yaw: Math.PI, pitch: -0.05, step: 0, here: undefined };
const keys = new Set();
const walkHud = document.getElementById('walk-hud'), walkWhere = document.getElementById('walk-where');
const btnWalk = document.getElementById('btn-walk');
// put the avatar on island group g at the free spot (0.5-unit grid) nearest the preferred local spot
function placeAvatar(g, [px, pz]) {
  const r = g.userData.r;
  let best = [0, 0], bd = Infinity;
  for (let lx = -r; lx <= r; lx += 0.5) for (let lz = -r; lz <= r; lz += 0.5) {
    const d = (lx - px) ** 2 + (lz - pz) ** 2;
    if (d >= bd) continue;
    const gnd = groundAt(g.position.x + lx, g.position.z + lz);
    if (gnd && gnd.g === g && !blocked(g.position.x + lx, g.position.z + lz)) { best = [lx, lz]; bd = d; }
  }
  const [lx, lz] = best;
  Object.assign(walk, { x: g.position.x + lx, z: g.position.z + lz, y: g.position.y + TOP, yaw: Math.atan2(-lx, -lz), pitch: -0.05 });
}
// arrive on an island where its bridge from the core lands (facing inland); on the core, in front of the NTNU letters
function arriveOn(g) {
  const { x, z } = g.position, d = Math.hypot(x, z), k = (g.userData.r * 0.8) / d;
  placeAvatar(g, d < 1 ? [2.6, 8.6] : [-x * k, -z * k]);
}
function walkTo(i) { arriveOn(world.islands[i]); }
function hereInfo() {
  const g = walk.here;
  if (!g || g === 'bridge') return null;
  if (g.userData.theme) { const th = g.userData.theme; return { i: THEMES.indexOf(th), k: -1, label: `<span class="no">${th.no}</span>${esc(th.name)}` }; }
  return { i: 0, k: g.userData.islet.item, label: esc(g.userData.islet.name) };
}
function openHere() {
  const h = hereInfo();
  if (!h) return;
  renderDetail(h.i, h.k);
  history.replaceState(null, '', '#' + THEMES[h.i].id);
}
function setView(fp) {
  walk.fp = fp;
  avatar.visible = walk.on && !fp;
  walkHud.classList.toggle('tp', !fp);
}
function enterWalk() {
  stopTour();
  if (controls.autoRotate) btnSpin.click();
  closeDetail();
  current = -1; hovered = null; camTween = null;
  canvas.style.cursor = '';
  if (!walk.started) { walkTo(0); walk.started = true; }
  walk.on = true; walk.here = undefined;
  controls.enabled = false;
  btnWalk.classList.add('on');
  walkHud.hidden = false;
  document.getElementById('app').classList.add('walking');
  setView(walk.fp);
  resize();
  hideHint();
}
function exitWalk() {
  walk.on = false;
  keys.clear();
  avatar.visible = false;
  btnWalk.classList.remove('on');
  walkHud.hidden = true;
  document.getElementById('app').classList.remove('walking');
  // hand the current view to OrbitControls, then fly back to the overview
  controls.target.copy(camera.position).add(camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(8));
  controls.enabled = true;
  resize();
  closeDetail();
}
const _dir = new THREE.Vector3(), _eye = new THREE.Vector3();
function stepWalk(dt) {
  const k = (c) => (keys.has(c) ? 1 : 0);
  walk.yaw += (k('ArrowLeft') - k('ArrowRight')) * dt * 2.2;
  const fw = Math.sign(k('KeyW') + k('ArrowUp') - k('KeyS') - k('ArrowDown')), st = k('KeyD') - k('KeyA');
  const sy = Math.sin(walk.yaw), cy = Math.cos(walk.yaw);
  const mx = sy * fw - cy * st, mz = cy * fw + sy * st, len = Math.hypot(mx, mz);
  const run = keys.has('ShiftLeft') || keys.has('ShiftRight');
  if (len > 0) {
    const sp = ((run ? RUN_SPEED : WALK_SPEED) * dt) / len;
    const stuck = blocked(walk.x, walk.z); // never trap the avatar inside a footprint
    const here = groundAt(walk.x, walk.z)?.y ?? walk.y;
    // walkable, not inside a building, and no taller than one step up (stands and podium are climbed tier by tier)
    const free = (x, z) => { const gn = groundAt(x, z); return gn && gn.y - here < 0.55 && (stuck || !blocked(x, z)); };
    // try each axis separately so the avatar slides along walls and shorelines
    if (free(walk.x + mx * sp, walk.z)) walk.x += mx * sp;
    if (free(walk.x, walk.z + mz * sp)) walk.z += mz * sp;
  }
  const gnd = groundAt(walk.x, walk.z);
  if (gnd) walk.y += (gnd.y - walk.y) * Math.min(1, dt * 10);
  if (gnd && gnd.g !== walk.here) {
    walk.here = gnd.g;
    const h = hereInfo();
    walkWhere.innerHTML = h ? `${h.label}<span class="walk-e">按 E 看亮點</span>` : '木棧橋';
  }
  // swing arms and legs while moving
  walk.step += len > 0 ? dt * (run ? 13 : 9) : 0;
  const sw = len > 0 ? Math.sin(walk.step) * 0.7 : 0;
  const { legL, legR, armL, armR } = avatar.userData;
  legL.rotation.x = sw; legR.rotation.x = -sw; armL.rotation.x = -sw * 0.8; armR.rotation.x = sw * 0.8;
  avatar.position.set(walk.x, walk.y + (len > 0 ? Math.abs(Math.sin(walk.step)) * 0.04 : 0), walk.z);
  avatar.rotation.y = walk.yaw;
  const cp = Math.cos(walk.pitch);
  _dir.set(sy * cp, Math.sin(walk.pitch), cy * cp);
  _eye.set(walk.x, walk.y + EYE, walk.z);
  if (walk.fp) {
    camera.position.copy(_eye);
    camera.lookAt(_eye.add(_dir));
  } else {
    camera.position.copy(_eye).addScaledVector(_dir, -3.6);
    camera.position.y = Math.max(camera.position.y + 0.5, walk.y + 0.4);
    camera.lookAt(_eye);
  }
}
const typing = (e) => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
window.addEventListener('keydown', (e) => {
  if (!walk.on || typing(e) || e.metaKey || e.ctrlKey) return;
  if (e.code === 'Escape') { if (!detailEl.hidden) closeDetail(); else exitWalk(); return; }
  if (e.code === 'KeyV' && !e.repeat) setView(!walk.fp);
  if (e.code === 'KeyE' && !e.repeat) openHere();
  keys.add(e.code);
  if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());
// drag to look around (mouse or touch)
let look = null;
canvas.addEventListener('pointerdown', (e) => {
  if (!walk.on) return;
  look = { x: e.clientX, y: e.clientY };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (!walk.on || !look) return;
  walk.yaw -= (e.clientX - look.x) * 0.005;
  walk.pitch = Math.min(0.9, Math.max(-1.1, walk.pitch - (e.clientY - look.y) * 0.004));
  look.x = e.clientX; look.y = e.clientY;
});
for (const ev of ['pointerup', 'pointercancel']) canvas.addEventListener(ev, () => { look = null; });
// on-screen pad (touch) and HUD buttons
walkHud.querySelectorAll('[data-key]').forEach((b) => {
  const code = b.dataset.key;
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); keys.add(code); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => keys.delete(code));
});
document.getElementById('walk-open').addEventListener('click', openHere);
document.getElementById('walk-view').addEventListener('click', () => setView(!walk.fp));
document.getElementById('walk-exit').addEventListener('click', exitWalk);
btnWalk.addEventListener('click', () => (walk.on ? exitWalk() : enterWalk()));

// ---------- loop ----------
function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = walk.on ? 70 : w < 760 ? 52 : 38;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();
setTime('day', true);

const clock = new THREE.Clock();
function frame(now) {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  animators.forEach((f) => f(t, dt));
  world.islands.forEach((g) => {
    const want = g === hovered || g.userData.theme === THEMES[current] ? 0.35 : 0;
    g.userData.lift += (want - g.userData.lift) * Math.min(1, dt * 6);
    g.position.y = g.userData.lift + Math.sin(t * 0.6 + g.position.x) * 0.06;
    g.userData.explodeLift = 0;
  });
  stepLayers(dt);
  stepTime(now);
  if (walk.on) stepWalk(dt); // after the island bob above, so the avatar stands on this frame's ground
  else { stepCam(now); controls.update(); }
  renderer.render(scene, camera);
  updatePins();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// deep link (#research etc.) and loading screen
const fromHash = THEMES.findIndex((t) => '#' + t.id === location.hash);
setTimeout(() => {
  document.getElementById('loading').classList.add('done');
  if (fromHash >= 0) { intro.hidden = true; focusTheme(fromHash); }
}, 400);
