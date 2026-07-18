// 요나고미나미고등학교 설악고등학교 2026 국제교류 — 3D 갤러리
// Three.js 1인칭 미술관. WASD/SHIFT/SPACE + 모바일 터치 조작.
import * as THREE from 'three';

/* ═══════════════════ 상수 ═══════════════════ */
const IS_TOUCH = ('ontouchstart' in window) || navigator.maxTouchPoints > 0
  || location.search.includes('touch=1');
const EYE = 1.7;              // 눈높이 (m)
const RADIUS = 0.38;          // 플레이어 충돌 반경
const WALK = 4.2, RUN = 8.4;  // 이동 속도 (m/s)
const GRAVITY = 22, JUMP_V = 7.6;
const WALL_H = 5;             // 벽 높이
const FLOOR_HEIGHT = 5.2;     // 층간 높이(슬래브 포함)
const STAIR = Object.freeze({
  xMin: 3.35, xMax: 6.05,
  zBottom: 10.4, zTop: 1.8,
});
const T = 0.4;                // 벽 두께
const HALL_W = 12;            // 전시실 폭
const DOOR_W = 4, DOOR_H = 3.2;
const SPACING = 1.7;          // 작품 간격 (m)
const MAX_TEX = IS_TOUCH ? 512 : 768;   // GPU 텍스처 최대 크기
const NEAR_VIDEO = 9;         // 비디오 자동재생 거리
const VIDEO_KEEP_DISTANCE = 13;
const ART_LOAD_DISTANCE = IS_TOUCH ? 16 : 22;
const ART_KEEP_DISTANCE = IS_TOUCH ? 22 : 30;
const ART_VISIBLE_DISTANCE = IS_TOUCH ? 30 : 42;
const MAX_LOADED_PHOTOS = IS_TOUCH ? 36 : 56;

/* ═══════════════════ 기본 셋업 ═══════════════════ */
const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, IS_TOUCH ? 1.7 : 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xdfe3e8);
scene.fog = new THREE.Fog(0xdfe3e8, 70, 220);

const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.18, 400);
camera.rotation.order = 'YXZ';

scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a80, 0.75));
const sun = new THREE.DirectionalLight(0xfff4e0, 0.7);
sun.position.set(40, 60, 30);
scene.add(sun);

// 실내 환경맵 (반사·간접광 느낌) — 간단한 등장방형 캔버스 → PMREM
(function setupEnvironment() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, '#fbfaf7');
  grad.addColorStop(0.42, '#c3c1bc');
  grad.addColorStop(0.55, '#96948f');
  grad.addColorStop(1, '#35373a');
  g.fillStyle = grad; g.fillRect(0, 0, 256, 128);
  g.fillStyle = 'rgba(255,255,250,.95)';
  for (let i = 0; i < 4; i++) g.fillRect(i * 64 + 12, 8, 40, 9); // 천장 조명 스트립
  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromEquirectangular(tex).texture;
  tex.dispose(); pmrem.dispose();
})();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

/* ═══════════════════ 프로시저럴 텍스처 (콘크리트/바닥) ═══════════════════ */
function makeConcreteTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#bdbbb6'; g.fillRect(0, 0, 512, 512);
  // 큰 얼룩 (양생 자국)
  for (let i = 0; i < 14; i++) {
    const x = Math.random() * 512, y = Math.random() * 512, r = 50 + Math.random() * 110;
    const v = 165 + Math.random() * 35 | 0;
    const gr = g.createRadialGradient(x, y, r * 0.15, x, y, r);
    gr.addColorStop(0, `rgba(${v},${v},${v - 4},.20)`); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  }
  // 세로 물자국
  g.globalAlpha = 0.06;
  for (let i = 0; i < 22; i++) {
    const x = Math.random() * 512, w2 = 2 + Math.random() * 7;
    g.fillStyle = Math.random() > 0.5 ? '#8f8d89' : '#d0cec9';
    g.fillRect(x, Math.random() * 200, w2, 180 + Math.random() * 330);
  }
  g.globalAlpha = 1;
  // 얼룩 노이즈
  for (let i = 0; i < 2600; i++) {
    const v = 168 + Math.random() * 40 | 0;
    g.fillStyle = `rgba(${v},${v},${v - 3},${0.05 + Math.random() * 0.08})`;
    const r = 1 + Math.random() * 8;
    g.beginPath(); g.arc(Math.random() * 512, Math.random() * 512, r, 0, 7); g.fill();
  }
  // 패널 이음매
  g.strokeStyle = 'rgba(90,88,84,.5)'; g.lineWidth = 1.5;
  for (let p = 0; p <= 512; p += 256) {
    g.beginPath(); g.moveTo(p, 0); g.lineTo(p, 512); g.stroke();
    g.beginPath(); g.moveTo(0, p); g.lineTo(512, p); g.stroke();
  }
  // 폼타이(form-tie) 홀
  g.fillStyle = 'rgba(105,103,99,.85)';
  for (let x = 64; x < 512; x += 128) for (let y = 64; y < 512; y += 128) {
    g.beginPath(); g.arc(x, y, 5, 0, 7); g.fill();
    g.fillStyle = 'rgba(140,138,134,.5)';
    g.beginPath(); g.arc(x - 1, y - 1, 3, 0, 7); g.fill();
    g.fillStyle = 'rgba(105,103,99,.85)';
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function makeFloorTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#55585c'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 1800; i++) {
    const v = 78 + Math.random() * 22 | 0;
    g.fillStyle = `rgba(${v},${v + 2},${v + 5},${0.06 + Math.random() * 0.06})`;
    g.beginPath(); g.arc(Math.random() * 512, Math.random() * 512, 1 + Math.random() * 6, 0, 7); g.fill();
  }
  g.strokeStyle = 'rgba(40,42,45,.55)'; g.lineWidth = 2;
  g.strokeRect(1, 1, 510, 510);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const concreteTex = makeConcreteTexture();
const floorTex = makeFloorTexture();

function concreteMat(repeatX, repeatY) {
  const tex = concreteTex.clone();
  tex.needsUpdate = true; tex.repeat.set(repeatX, repeatY);
  return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, metalness: 0.03, envMapIntensity: 0.55 });
}
const whiteWallMat = new THREE.MeshStandardMaterial({ color: 0xf1efe9, roughness: 0.93, envMapIntensity: 0.9 });
const darkMat = new THREE.MeshStandardMaterial({ color: 0x2b2d30, roughness: 0.45, metalness: 0.35, envMapIntensity: 0.8 });
const woodMat = new THREE.MeshStandardMaterial({ color: 0x74604d, roughness: 0.55, envMapIntensity: 0.6 });

/* ── AO·그림자·워시용 공용 그라데이션 ── */
function alphaGradTex(draw) {
  const c = document.createElement('canvas'); c.width = 64; c.height = 64;
  draw(c.getContext('2d'), c);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}
// 아래쪽이 진한 세로 그라데이션 (벽-바닥 접합부 AO)
const vGradTex = alphaGradTex((g, c) => {
  const gr = g.createLinearGradient(0, c.height, 0, 0);
  gr.addColorStop(0, 'rgba(0,0,0,.42)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, c.width, c.height);
});
// 중앙이 진한 방사형 (액자 드롭섀도·가구 접지 그림자)
const rGradTex = alphaGradTex((g, c) => {
  const gr = g.createRadialGradient(32, 32, 4, 32, 32, 32);
  gr.addColorStop(0, 'rgba(0,0,0,.5)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, c.width, c.height);
});
// 조명 글로우 (중앙이 밝은 방사형 백색)
const glowTex = alphaGradTex((g, c) => {
  const gr = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,253,246,.55)'); gr.addColorStop(1, 'rgba(255,253,246,0)');
  g.fillStyle = gr; g.fillRect(0, 0, c.width, c.height);
});
const glowMat = new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending });
const aoMat = new THREE.MeshBasicMaterial({ map: vGradTex, transparent: true, depthWrite: false, toneMapped: false });
const shadowMat = new THREE.MeshBasicMaterial({ map: rGradTex, transparent: true, depthWrite: false, toneMapped: false, opacity: 0.8 });

// 벽 밑 AO (벽면에 세로로)
function aoWall(cx, cz, len, rotY, h = 0.6, yBase = 0) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(len, h), aoMat);
  m.position.set(cx, yBase + h / 2 + 0.002, cz); m.rotation.y = rotY;
  m.renderOrder = 2; scene.add(m); return m;
}
// 바닥 AO (벽에서 멀어지며 옅어짐) — rotZ: 진한 모서리 방향 (π/2=동, -π/2=서, 0=남, π=북)
function aoFloor(cx, cz, len, rotZ, d = 0.5, yBase = 0) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(len, d), aoMat);
  m.rotation.set(-Math.PI / 2, 0, rotZ);
  m.position.set(cx, yBase + 0.004, cz);
  m.renderOrder = 2; scene.add(m); return m;
}
// 걸레받이
function baseboard(cx, cz, len, alongX, yBase = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(alongX ? len : 0.05, 0.09, alongX ? 0.05 : len), darkMat);
  m.position.set(cx, yBase + 0.045, cz); scene.add(m); return m;
}

/* ═══════════════════ 텍스트 캔버스 플레인 ═══════════════════ */
function textPlane(lines, w, h, opt = {}) {
  const scale = 256;
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale); c.height = Math.round(h * scale);
  const g = c.getContext('2d');
  if (opt.bg) { g.fillStyle = opt.bg; g.fillRect(0, 0, c.width, c.height); }
  g.fillStyle = opt.color || '#3a3a38';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const n = lines.length;
  lines.forEach((ln, i) => {
    g.font = `${ln.weight || 300} ${(ln.size || 0.1) * scale}px "Helvetica Neue","Apple SD Gothic Neo",sans-serif`;
    if (ln.spacing) { try { g.letterSpacing = `${ln.spacing * scale}px`; } catch (e) {} }
    g.fillStyle = ln.color || opt.color || '#3a3a38';
    g.fillText(ln.text, c.width / 2, c.height * (i + 0.5) / n);
    try { g.letterSpacing = '0px'; } catch (e) {}
  });
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: tex, transparent: !opt.bg, toneMapped: false })
  );
  return m;
}

/* ═══════════════════ 충돌 ═══════════════════ */
const colliders = []; // {minX,maxX,minZ,maxZ}
function addCollider(cx, cz, sx, sz, floor = 0) {
  colliders.push({ minX: cx - sx / 2, maxX: cx + sx / 2, minZ: cz - sz / 2, maxZ: cz + sz / 2, floor });
}
function wallBox(cx, cy, cz, sx, sy, sz, mat, collide = true, floor = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
  m.position.set(cx, cy, cz);
  scene.add(m);
  if (collide) addCollider(cx, cz, sx, sz, floor);
  return m;
}
// 문(개구부) 있는 가로벽: z 위치에, x 범위 [xa, xb]
function dividerWall(z, xa, xb, mat, floor = 0, yBase = 0) {
  const doorL = -DOOR_W / 2, doorR = DOOR_W / 2;
  const segs = [];
  if (doorL - xa > 0.01) segs.push([xa, doorL]);
  if (xb - doorR > 0.01) segs.push([doorR, xb]);
  for (const [a, b] of segs) {
    wallBox((a + b) / 2, yBase + WALL_H / 2, z, b - a, WALL_H, T, mat, true, floor);
  }
  // 문 위 인방(lintel)
  wallBox(0, yBase + (DOOR_H + WALL_H) / 2, z, DOOR_W, WALL_H - DOOR_H, T, mat, false, floor);
  // 문틀(리빌): 벽면과 동일 평면이 생기지 않도록 벽을 1cm씩 파고들게 배치 (z-fighting 방지)
  for (const dx of [-1, 1]) {
    const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.16, DOOR_H + 0.07, T + 0.1), darkMat);
    jamb.position.set(dx * (DOOR_W / 2 + 0.07), yBase + (DOOR_H + 0.07) / 2, z);
    scene.add(jamb);
    addCollider(dx * (DOOR_W / 2 + 0.07), z, 0.16, T + 0.1, floor);
  }
  const head = new THREE.Mesh(new THREE.BoxGeometry(DOOR_W + 0.3, 0.16, T + 0.1), darkMat);
  head.position.set(0, yBase + DOOR_H + 0.03, z);
  scene.add(head);
}

/* ═══════════════════ 작품(액자) ═══════════════════ */
// 공용 플레이스홀더 텍스처
const placeholderTex = (() => {
  const c = document.createElement('canvas'); c.width = 128; c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = '#f4f2ee'; g.fillRect(0, 0, 128, 96);
  g.fillStyle = '#dedbd5'; g.fillRect(12, 9, 104, 70);
  g.fillStyle = '#b5b2ac'; g.font = '10px sans-serif'; g.textAlign = 'center';
  g.fillText('· · ·', 64, 48);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();

const artworks = [];      // {item, mesh, group, size, loaded, loading, tex, roomIdx, pos, isVideo, video, vtex, idxInDay}
const frameGeo = new THREE.BoxGeometry(1, 1, 1);
const frameMat = new THREE.MeshStandardMaterial({ color: 0x17171a, roughness: 0.35, metalness: 0.2, envMapIntensity: 0.9 });
const bezelMat = new THREE.MeshStandardMaterial({ color: 0x0e0f11, roughness: 0.3, metalness: 0.4, envMapIntensity: 0.9 });
const shadowGeo = new THREE.PlaneGeometry(1, 1);
const artworkPlaneGeo = new THREE.PlaneGeometry(1, 1);

function fitArtworkToAspect(art, aspect) {
  if (!Number.isFinite(aspect) || aspect <= 0) return;
  let pw, ph;
  if (aspect >= 1) { pw = art.maxDim; ph = art.maxDim / aspect; }
  else { ph = art.maxDim; pw = art.maxDim * aspect; }

  const w = pw + art.matPad * 2;
  const h = ph + art.matPad * 2;
  art.aspect = aspect;
  art.pw = pw; art.ph = ph;
  art.w = w; art.h = h;
  art.frame.scale.set(w + art.border * 2, h + art.border * 2, 0.055);
  art.shadow.scale.set((w + art.border * 2) * 1.45, (h + art.border * 2) * 1.45, 1);

  // 사진 텍스처에는 매트가 합성되어 있고, 영상은 원본 화면 비율만 사용한다.
  art.plane.scale.set(art.isVideo ? pw : w, art.isVideo ? ph : h, 1);
}

function createArtwork(item, roomIdx, idxInDay, dayLabel) {
  const isVideo = item.type === 'video';
  const aspect = item.w / item.h;
  // 사진 영역 크기 (최대변 기준)
  const maxDim = isVideo ? 1.6 : 1.05;
  const mat = isVideo ? 0.05 : 0.16;        // 매트(여백) 폭
  const border = isVideo ? 0.06 : 0.045;    // 프레임 두께

  const group = new THREE.Group();
  // 벽면 드롭섀도
  const shadow = new THREE.Mesh(shadowGeo, shadowMat);
  shadow.position.set(0, -0.04, 0.004);
  shadow.renderOrder = 1;
  group.add(shadow);
  // 프레임(베젤)
  const frame = new THREE.Mesh(frameGeo, isVideo ? bezelMat : frameMat);
  frame.position.z = 0.028;
  group.add(frame);
  // 사진/매트 합성 플레인
  const plane = new THREE.Mesh(
    artworkPlaneGeo,
    new THREE.MeshBasicMaterial({ map: placeholderTex, toneMapped: false })
  );
  plane.position.z = 0.06;
  group.add(plane);

  const art = { item, group, plane, frame, shadow, border, maxDim, matPad: mat, isVideo, roomIdx, idxInDay, dayLabel,
                loaded: false, loading: false, tex: null, video: null, vtex: null, pos: new THREE.Vector3() };
  fitArtworkToAspect(art, aspect);
  plane.userData.art = art;
  frame.userData.art = art;
  artworks.push(art);
  return art;
}

// 슬롯에 작품 배치: slot = {x, y, z, rotY}
function placeArtwork(art, slot) {
  art.group.position.set(slot.x, slot.y, slot.z);
  art.group.rotation.y = slot.rotY;
  art.pos.set(slot.x, slot.y, slot.z);
  scene.add(art.group);
}

/* ── 사진 텍스처 로딩(매트+캡션 합성) ── */
const loadQueue = [];
let activeLoads = 0;
function pumpLoads() {
  while (activeLoads < 4 && loadQueue.length) {
    const art = loadQueue.shift();
    art.queued = false;
    if (art.loaded || art.loading || !art.wanted) continue;
    art.loading = true; activeLoads++;
    let settled = false;
    const settle = () => {
      if (settled) return false;
      settled = true; clearTimeout(watchdog);
      activeLoads--; art.loading = false;
      return true;
    };
    const img = new Image();
    const cancelLoad = (retry) => {
      if (!settle()) return;
      img.onload = null; img.onerror = null; img.src = '';
      art.cancelLoad = null;
      if (retry) art.retryAt = performance.now() + 10000;
      pumpLoads();
    };
    art.cancelLoad = () => cancelLoad(false);
    // 응답 없는 요청은 중단하고 잠시 뒤에만 재시도한다.
    const watchdog = setTimeout(() => cancelLoad(true), 20000);
    img.onload = () => {
      if (!settle()) return;
      art.cancelLoad = null;
      if (!art.wanted) { pumpLoads(); return; }
      // manifest의 메타데이터가 아니라 브라우저가 실제로 디코딩한 크기에 액자를 맞춘다.
      fitArtworkToAspect(art, img.naturalWidth / img.naturalHeight);
      // 다운스케일 + 매트/캡션 합성
      const ratio = Math.min(1, MAX_TEX / Math.max(img.width, img.height));
      const iw = Math.round(img.width * ratio), ih = Math.round(img.height * ratio);
      const padX = Math.round(iw * art.matPad / art.pw);
      const padY = Math.round(ih * art.matPad / art.ph);
      const c = document.createElement('canvas');
      c.width = iw + padX * 2; c.height = ih + padY * 2;
      const g = c.getContext('2d');
      g.fillStyle = '#f6f4f0'; g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, padX, padY, iw, ih);
      g.strokeStyle = 'rgba(0,0,0,.18)'; g.lineWidth = 1;
      g.strokeRect(padX - .5, padY - .5, iw + 1, ih + 1);
      if (!art.isVideo && padY > 14) {
        g.fillStyle = '#8d8a84';
        g.font = `${Math.max(10, padY * 0.3)}px "Helvetica Neue",sans-serif`;
        g.textAlign = 'center';
        g.fillText(`${art.dayLabel}  ·  No.${String(art.idxInDay).padStart(3, '0')}`,
          c.width / 2, ih + padY + padY * 0.58);
      }
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
      art.tex = tex; art.loaded = true; art.lastUsed = performance.now();
      art.plane.material.map = tex;
      art.plane.material.needsUpdate = true;
      pumpLoads();
    };
    img.onerror = () => {
      if (!settle()) return;
      art.cancelLoad = null;
      art.retryAt = performance.now() + 10000;
      pumpLoads();
    };
    img.src = art.item.thumb || art.item.file;
  }
}
function unloadArt(art) {
  art.plane.material.map = placeholderTex;
  art.plane.material.needsUpdate = true;
  if (art.tex) { art.tex.dispose(); art.tex = null; }
  if (art.video) {
    art.video.pause(); art.video.removeAttribute('src'); art.video.load();
    if (art.vtex) art.vtex.dispose();
    art.video = null; art.vtex = null;
  }
  art.loaded = false;
}

function enforcePhotoBudget() {
  const loaded = artworks.filter(a => !a.isVideo && a.loaded && a.tex);
  if (loaded.length <= MAX_LOADED_PHOTOS) return;
  loaded.sort((a, b) => {
    if (a.loadTarget !== b.loadTarget) return a.loadTarget ? 1 : -1;
    const da = a.pos.distanceToSquared(player.pos), db = b.pos.distanceToSquared(player.pos);
    if (da !== db) return db - da;
    return (a.lastUsed || 0) - (b.lastUsed || 0);
  });
  for (let i = 0; i < loaded.length - MAX_LOADED_PHOTOS; i++) unloadArt(loaded[i]);
}

/* ═══════════════════ 미술관 건축 ═══════════════════ */
const rooms = []; // {floor, elevation, label, zFrom(남,큰z), zTo(북,작은z), W, group}
let spawnPoint = new THREE.Vector3(0, EYE, 10);
const floorSpawnPoints = [];

function cylinderBetween(a, b, radius, material) {
  const direction = new THREE.Vector3().subVectors(b, a);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, direction.length(), 10), material);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  scene.add(mesh);
  return mesh;
}

function buildStaircase() {
  const steps = 26;
  const width = STAIR.xMax - STAIR.xMin;
  const run = STAIR.zBottom - STAIR.zTop;
  const depth = run / steps;
  const rise = FLOOR_HEIGHT / steps;
  const centerX = (STAIR.xMin + STAIR.xMax) / 2;
  const stepMat = new THREE.MeshStandardMaterial({ color: 0xd8d5ce, roughness: 0.72, metalness: 0.03 });

  for (let i = 0; i < steps; i++) {
    const top = rise * (i + 1);
    const step = new THREE.Mesh(new THREE.BoxGeometry(width, top, depth + 0.012), stepMat);
    step.position.set(centerX, top / 2, STAIR.zBottom - depth * (i + 0.5));
    scene.add(step);
  }

  // 계단 양옆 난간과 손잡이
  const railMat = new THREE.MeshStandardMaterial({ color: 0x2b2d30, roughness: 0.35, metalness: 0.65 });
  for (const x of [STAIR.xMin, STAIR.xMax]) {
    cylinderBetween(
      new THREE.Vector3(x, 1.0, STAIR.zBottom),
      new THREE.Vector3(x, FLOOR_HEIGHT + 1.0, STAIR.zTop),
      0.045, railMat
    );
    for (let i = 0; i <= 6; i++) {
      const p = i / 6;
      const base = p * FLOOR_HEIGHT;
      const z = STAIR.zBottom - run * p;
      cylinderBetween(new THREE.Vector3(x, base + 0.05, z), new THREE.Vector3(x, base + 1.0, z), 0.028, railMat);
    }
  }

  // 중간에서 옆으로 떨어지지 않도록 층별 충돌 난간을 둔다.
  const railZ = (STAIR.zBottom + STAIR.zTop) / 2;
  for (const floor of [0, 1]) {
    addCollider(STAIR.xMin - 0.08, railZ, 0.16, run, floor);
    addCollider(STAIR.xMax + 0.08, railZ, 0.16, run, floor);
  }

  const stairSign = textPlane([
    { text: 'STAIRS · 2F', size: 0.14, weight: 600, spacing: 0.035, color: '#f1efe9' },
    { text: 'DAY 3 · DAY 4', size: 0.08, color: '#c8c4bb' },
  ], 1.5, 0.7, { bg: '#2b2d30' });
  stairSign.position.set(STAIR.xMax + 0.75, 1.45, STAIR.zBottom + 0.04);
  scene.add(stairSign);
}

function buildMuseum(manifest) {
  const byDay = [[], [], [], []];
  for (const it of manifest.items) byDay[it.day - 1].push(it);
  const dayShort = ['7/12', '7/13', '7/14', '7/15'];

  const dayDefs = byDay.map((items, i) => {
    const count = items.length;
    const usePartition = count > 34;
    const lines = usePartition ? 4 : 2;
    const L = Math.max(12, Math.ceil((count / lines) * SPACING + 6));
    const floor = i < 2 ? 0 : 1;
    return { type: 'hall', day: i + 1, floor, elevation: floor * FLOOR_HEIGHT,
      W: HALL_W, L, usePartition, label: `${floor + 1}F · ${manifest.days[i]}`, items };
  });

  /* ── 1층과 2층을 같은 평면 위에 쌓아 배치 ── */
  const floorDefs = [
    [{ type: 'lobby', floor: 0, elevation: 0, W: 16, L: 14, label: '1F · ENTRANCE HALL' },
      dayDefs[0], dayDefs[1]],
    [{ type: 'lobby', floor: 1, elevation: FLOOR_HEIGHT, upper: true,
       W: 16, L: 14, label: '2F · UPPER HALL' }, dayDefs[2], dayDefs[3]],
  ];
  for (const defs of floorDefs) {
    let floorZ = 14;
    for (const def of defs) {
      def.zFrom = floorZ;
      def.zTo = floorZ - def.L;
      floorZ = def.zTo;
    }
  }
  const roomDefs = floorDefs.flat();

  /* ── 층별 바닥과 2층 슬래브 ── */
  for (const defs of floorDefs) {
    const yBase = defs[0].elevation;
    const zEnd = defs[defs.length - 1].zTo;
    const totalL = 14 - zEnd;
    const floorTexI = floorTex.clone(); floorTexI.needsUpdate = true;
    floorTexI.repeat.set(16 / 4, totalL / 4);
    const floorMat = new THREE.MeshStandardMaterial({
      map: floorTexI, roughness: 0.3, metalness: 0.06, envMapIntensity: 0.85,
    });
    const fullZMin = zEnd - 4, fullZMax = 18;
    const opening = {
      xMin: STAIR.xMin - 0.12, xMax: STAIR.xMax + 0.12,
      zMin: STAIR.zTop - 0.25, zMax: STAIR.zBottom + 0.25,
    };
    const rects = defs[0].floor === 0 ? [[-12, 12, fullZMin, fullZMax]] : [
      [-12, opening.xMin, fullZMin, fullZMax],
      [opening.xMax, 12, fullZMin, fullZMax],
      [opening.xMin, opening.xMax, fullZMin, opening.zMin],
      [opening.xMin, opening.xMax, opening.zMax, fullZMax],
    ];
    const slabMat = defs[0].floor === 1 ? concreteMat(6, totalL / 4) : null;
    for (const [x1, x2, z1, z2] of rects) {
      const width = x2 - x1, depth = z2 - z1;
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), floorMat);
      floor.rotation.x = -Math.PI / 2;
      floor.position.set((x1 + x2) / 2, yBase + 0.001, (z1 + z2) / 2);
      scene.add(floor);
      if (slabMat) {
        const slab = new THREE.Mesh(new THREE.BoxGeometry(width, 0.2, depth), slabMat);
        slab.position.set((x1 + x2) / 2, yBase - 0.1, (z1 + z2) / 2);
        scene.add(slab);
      }
    }
  }

  // 외부 지면(모래 — 우에다 사구 오마주)
  const sand = new THREE.Mesh(
    new THREE.PlaneGeometry(600, 600),
    new THREE.MeshStandardMaterial({ color: 0xd9cfb8, roughness: 1 })
  );
  sand.rotation.x = -Math.PI / 2; sand.position.y = -0.02;
  scene.add(sand);

  buildStaircase();

  for (const def of roomDefs) {
    const { W, L, zFrom, zTo } = def;
    const yBase = def.elevation;
    const cz = (zFrom + zTo) / 2;
    const roomGroup = new THREE.Group();
    scene.add(roomGroup);
    def.group = roomGroup;

    // 1층 로비 천장에는 계단실 개구부를 남긴다.
    const ceilMat = new THREE.MeshBasicMaterial({ color: 0xdedcd7, side: THREE.BackSide });
    if (def.type === 'lobby' && def.floor === 0) {
      const xEdge = W / 2 + T;
      const x1 = STAIR.xMin - 0.12, x2 = STAIR.xMax + 0.12;
      const z1 = STAIR.zTop - 0.25, z2 = STAIR.zBottom + 0.25;
      const ceilingRects = [
        [-xEdge, x1, zTo, zFrom], [x2, xEdge, zTo, zFrom],
        [x1, x2, zTo, z1], [x1, x2, z2, zFrom],
      ];
      for (const [xa, xb, za, zb] of ceilingRects) {
        const ceil = new THREE.Mesh(new THREE.PlaneGeometry(xb - xa, zb - za), ceilMat);
        ceil.rotation.x = -Math.PI / 2;
        ceil.position.set((xa + xb) / 2, yBase + WALL_H - 0.005, (za + zb) / 2);
        scene.add(ceil);
      }
    } else {
      const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W + T * 2, L), ceilMat);
      ceil.rotation.x = -Math.PI / 2; ceil.position.set(0, yBase + WALL_H - 0.005, cz);
      scene.add(ceil);
    }
    // 천장 조명 스트립 (자체발광)
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.8, L - 2),
      new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
    strip.rotation.x = Math.PI / 2; strip.position.set(0, yBase + WALL_H - 0.05, cz);
    scene.add(strip);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(4.5, L - 2), glowMat);
    glow.rotation.x = Math.PI / 2; glow.position.set(0, yBase + WALL_H - 0.28, cz);
    glow.renderOrder = 3; scene.add(glow);

    if (def.type === 'lobby') {
      // 서쪽 벽(타이틀) — 양끝을 남쪽 벽/칸막이 속으로 살짝 밀어넣어 동일 평면 회피
      wallBox(-W / 2 - T / 2, yBase + WALL_H / 2, cz, T, WALL_H, L + 0.2,
        concreteMat(L / 4, WALL_H / 4), true, def.floor);
      // 남쪽 벽
      wallBox(0, yBase + WALL_H / 2, zFrom + T / 2, W + T * 2, WALL_H, T,
        concreteMat(W / 4, WALL_H / 4), true, def.floor);
      // 동쪽: 유리벽 (하단 60cm 콘크리트 + 유리)
      wallBox(W / 2 + T / 2, yBase + 0.3, cz, T, 0.6, L + 0.2,
        concreteMat(L / 4, 0.5), false, def.floor);
      const glass = new THREE.Mesh(new THREE.BoxGeometry(0.06, WALL_H - 0.6, L + 0.2),
        new THREE.MeshPhysicalMaterial({ color: 0xdfeef2, transparent: true, opacity: 0.14,
          roughness: 0.05, metalness: 0, side: THREE.DoubleSide }));
      glass.position.set(W / 2 + T / 2, yBase + (WALL_H - 0.6) / 2 + 0.6, cz);
      scene.add(glass);
      addCollider(W / 2 + T / 2, cz, T, L, def.floor);
      // 유리 멀리언(기둥)
      for (let i = 0; i <= 4; i++) {
        const mz = zTo + (L / 4) * i;
        wallBox(W / 2 + T / 2, yBase + WALL_H / 2, mz, 0.12, WALL_H, 0.12,
          darkMat, false, def.floor);
      }
      // 타이틀 벽 텍스트
      const titleLines = def.upper ? [
        { text: '2F GALLERY', size: 0.32, weight: 500, spacing: 0.08, color: '#2f2f2d' },
        { text: 'DAY 3 · DAY 4', size: 0.18, weight: 400, spacing: 0.05, color: '#55524d' },
        { text: '2026 국제교류', size: 0.15, color: '#77746e' },
      ] : [
        { text: '요나고미나미고등학교 × 설악고등학교', size: 0.24, weight: 300, spacing: 0.025, color: '#2f2f2d' },
        { text: '2026 국제교류', size: 0.22, weight: 500, spacing: 0.04, color: '#45423e' },
        { text: 'YONAGO MINAMI HIGH SCHOOL × SEORAK HIGH SCHOOL', size: 0.075, color: '#77746e' },
        { text: '2026. 7. 12 – 15', size: 0.12, color: '#55524d' },
      ];
      const title = textPlane(titleLines, 7, 2.4);
      title.position.set(-W / 2 + 0.01, yBase + 2.5, cz);
      title.rotation.y = Math.PI / 2;
      scene.add(title);

      if (!def.upper) {
        // 외부: 수면 (미술관 앞 수면 오마주)
        const water = new THREE.Mesh(new THREE.PlaneGeometry(26, L + 6),
          new THREE.MeshStandardMaterial({ color: 0xb9d3da, roughness: 0.04, metalness: 0.85, envMapIntensity: 1.3 }));
        water.rotation.x = -Math.PI / 2;
        water.position.set(W / 2 + 14, 0.06, cz);
        scene.add(water);

        // 외부: 다이센 배경 사진
        new THREE.TextureLoader().load('assets/backdrop.jpg', (t) => {
          t.colorSpace = THREE.SRGBColorSpace;
          const bp = new THREE.Mesh(new THREE.PlaneGeometry(84, 63),
            new THREE.MeshBasicMaterial({ map: t, fog: true, toneMapped: false }));
          bp.position.set(W / 2 + 88, 2.4, cz);
          bp.rotation.y = -Math.PI / 2;
          scene.add(bp);
        });
      }

      floorSpawnPoints[def.floor] = new THREE.Vector3(0, yBase + EYE, zFrom - 3);
      if (def.floor === 0) spawnPoint = floorSpawnPoints[0].clone();
    } else {
      // 전시실 좌우 외벽 — 칸막이 벽 중심선까지만 (끝면이 칸막이 내부에 묻히도록, z-fighting 방지)
      const defs = floorDefs[def.floor];
      const extS = (def === defs[defs.length - 1]) ? 0.3 : 0;
      wallBox(-W / 2 - T / 2, yBase + WALL_H / 2, cz - extS / 2, T, WALL_H, L + extS,
        concreteMat(L / 4, WALL_H / 4), true, def.floor);
      wallBox(W / 2 + T / 2, yBase + WALL_H / 2, cz - extS / 2, T, WALL_H, L + extS,
        concreteMat(L / 4, WALL_H / 4), true, def.floor);
      // 내측 흰 전시벽 (외벽 안쪽 면에서 2cm 띄움)
      const innerW1 = new THREE.Mesh(new THREE.PlaneGeometry(L, WALL_H), whiteWallMat);
      innerW1.position.set(-W / 2 + 0.02, yBase + WALL_H / 2, cz); innerW1.rotation.y = Math.PI / 2;
      scene.add(innerW1);
      const innerW2 = new THREE.Mesh(new THREE.PlaneGeometry(L, WALL_H), whiteWallMat);
      innerW2.position.set(W / 2 - 0.02, yBase + WALL_H / 2, cz); innerW2.rotation.y = -Math.PI / 2;
      scene.add(innerW2);

      // 벽-바닥 접합부: 걸레받이 + AO
      baseboard(-W / 2 + 0.03, cz, L, false, yBase);
      baseboard(W / 2 - 0.03, cz, L, false, yBase);
      aoWall(-W / 2 + 0.034, cz, L, Math.PI / 2, 0.6, yBase);
      aoWall(W / 2 - 0.034, cz, L, -Math.PI / 2, 0.6, yBase);
      aoFloor(-W / 2 + 0.26, cz, L, -Math.PI / 2, 0.5, yBase);
      aoFloor(W / 2 - 0.26, cz, L, Math.PI / 2, 0.5, yBase);

      /* 슬롯 라인 구성 */
      const pad = 2.4;
      const lineList = [];
      // 서쪽 벽: 남→북
      lineList.push({
        len: L - pad * 2,
        slot: (t) => ({ x: -W / 2 + 0.03, y: yBase + 1.6, z: zFrom - pad - t, rotY: Math.PI / 2 })
      });
      if (def.usePartition) {
        const pPad = 3.4;
        const pLen = L - pPad * 2;
        const pCz = cz;
        // 가벽 (중앙, 높이 3.4)
        const part = new THREE.Mesh(new THREE.BoxGeometry(0.34, 3.4, pLen), whiteWallMat);
        part.position.set(0, yBase + 1.7, pCz);
        scene.add(part);
        addCollider(0, pCz, 0.34, pLen, def.floor);
        // 가벽 상단 어두운 캡
        const cap = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.06, pLen + 0.08), darkMat);
        cap.position.set(0, yBase + 3.42, pCz); scene.add(cap);
        // 가벽 접합부 AO + 걸레받이
        baseboard(-0.2, pCz, pLen, false, yBase);
        baseboard(0.2, pCz, pLen, false, yBase);
        aoWall(-0.185, pCz, pLen, -Math.PI / 2, 0.6, yBase);
        aoWall(0.185, pCz, pLen, Math.PI / 2, 0.6, yBase);
        aoFloor(-0.43, pCz, pLen, Math.PI / 2, 0.5, yBase);
        aoFloor(0.43, pCz, pLen, -Math.PI / 2, 0.5, yBase);
        // 가벽 서쪽 면: 북→남 / 동쪽 면: 남→북 (관람 동선 순)
        lineList.push({ len: pLen - 0.8,
          slot: (t) => ({ x: -0.19, y: yBase + 1.6, z: (pCz - pLen / 2 + 0.4) + t, rotY: -Math.PI / 2 }) });
        lineList.push({ len: pLen - 0.8,
          slot: (t) => ({ x: 0.19, y: yBase + 1.6, z: (pCz + pLen / 2 - 0.4) - t, rotY: Math.PI / 2 }) });
      } else {
        // 가벽 없는 방: 중앙 벤치 (나무 상판 + 금속 다리)
        const benchTop = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.09, 2.6), woodMat);
        benchTop.position.set(0, yBase + 0.42, cz); scene.add(benchTop);
        for (const dz of [-1.1, 1.1]) {
          const leg = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.375, 0.08), darkMat);
          leg.position.set(0, yBase + 0.1875, cz + dz); scene.add(leg);
        }
        const bShadow = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 3.4), shadowMat);
        bShadow.rotation.x = -Math.PI / 2; bShadow.position.set(0, yBase + 0.006, cz);
        bShadow.renderOrder = 2; scene.add(bShadow);
        addCollider(0, cz, 0.55, 2.6, def.floor);
      }
      // 동쪽 벽: 북→남
      lineList.push({
        len: L - pad * 2,
        slot: (t) => ({ x: W / 2 - 0.03, y: yBase + 1.6, z: zTo + pad + t, rotY: -Math.PI / 2 })
      });

      /* 작품 분배 */
      const items = def.items;
      const totalLen = lineList.reduce((s, l) => s + l.len, 0);
      let assigned = 0;
      lineList.forEach((line, li) => {
        let n = (li === lineList.length - 1)
          ? items.length - assigned
          : Math.round(items.length * line.len / totalLen);
        n = Math.min(n, items.length - assigned);
        const step = line.len / Math.max(n, 1);
        for (let k = 0; k < n; k++) {
          const item = items[assigned + k];
          const art = createArtwork(item, rooms.length, assigned + k + 1, dayShort[def.day - 1]);
          art.floor = def.floor;
          placeArtwork(art, line.slot(step * (k + 0.5)));
          roomGroup.add(art.group);
        }
        assigned += n;
      });

      // 입구 위 방 이름
      const sign = textPlane([
        { text: `${def.floor + 1}F · DAY ${def.day}`, size: 0.27, weight: 600, spacing: 0.08, color: '#2f2f2d' },
        { text: def.label.replace(/^\dF · Day \d · /, ''), size: 0.15, color: '#77746e' },
      ], 3.4, 1.0);
      sign.position.set(0, yBase + DOOR_H + 0.85, zFrom + T / 2 + 0.04);
      sign.rotation.y = 0; // 남쪽(입구쪽)에서 보이게
      scene.add(sign);
    }

    rooms.push(def);
  }

  /* ── 각 층의 방 사이 칸막이와 북쪽 끝벽 ── */
  for (const defs of floorDefs) {
    for (let i = 1; i < defs.length; i++) {
      const z = defs[i].zFrom;
      const w = Math.max(defs[i - 1].W, defs[i].W);
      dividerWall(z, -w / 2 - T, w / 2 + T,
        concreteMat(w / 6, WALL_H / 4), defs[i].floor, defs[i].elevation);
    }
    const last = defs[defs.length - 1];
    wallBox(0, last.elevation + WALL_H / 2, last.zTo - T / 2,
      last.W + T * 2, WALL_H, T, concreteMat(last.W / 4, WALL_H / 4), true, last.floor);
  }
}

/* ═══════════════════ 플레이어 / 컨트롤 ═══════════════════ */
const player = {
  pos: new THREE.Vector3(0, EYE, 10),
  floor: 0,
  velY: 0, onGround: true,
  yaw: 0, pitch: 0,   // 북쪽(-z)을 바라보고 시작
  running: false,
};
const keys = {};
let controlsActive = false;

document.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'Space') e.preventDefault();
  if (!e.repeat && controlsActive && !viewerOpen && (e.code === 'Digit1' || e.code === 'Digit2')) {
    switchFloor(e.code === 'Digit1' ? 0 : 1);
  }
});
document.addEventListener('keyup', (e) => { keys[e.code] = false; });

/* 데스크톱: 포인터 락 */
const startEl = document.getElementById('start');
const enterBtn = document.getElementById('enterBtn');
const crosshairEl = document.getElementById('crosshair');
const roomLabelEl = document.getElementById('roomLabel');
const hintEl = document.getElementById('hint');
const touchUIEl = document.getElementById('touchUI');
const floorNavEl = document.getElementById('floorNav');

function updateFloorNav(floor) {
  for (const button of floorNavEl.querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(Number(button.dataset.floor) === floor));
  }
}

function stairProgressAt(x, z) {
  const margin = 0.2;
  if (x < STAIR.xMin - margin || x > STAIR.xMax + margin
      || z > STAIR.zBottom + margin || z < STAIR.zTop - margin) return null;
  return Math.max(0, Math.min(1, (STAIR.zBottom - z) / (STAIR.zBottom - STAIR.zTop)));
}

function switchFloor(floor, announce = true) {
  const target = floorSpawnPoints[floor];
  if (!target || player.floor === floor && player.pos.distanceToSquared(target) < 0.01) return;
  player.floor = floor;
  player.pos.copy(target);
  player.velY = 0; player.onGround = true;
  camera.position.copy(player.pos);
  camera.rotation.set(player.pitch, player.yaw, 0);
  updateFloorNav(floor);
  lastRoomCheck = -1e9;
  updateRooms(performance.now());
  if (announce) {
    hintEl.textContent = floor === 0 ? '1층 · Day 1–2 전시' : '2층 · Day 3–4 전시';
    hintEl.style.opacity = '1';
  }
}

for (const button of floorNavEl.querySelectorAll('button')) {
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    switchFloor(Number(button.dataset.floor));
  });
}

function lockPointer() {
  try {
    const request = renderer.domElement.requestPointerLock();
    if (request && typeof request.catch === 'function') request.catch(() => {});
  } catch {
    // 지원하지 않는 환경에서는 아래의 마우스 드래그 폴백을 사용한다.
  }
}

let wasLocked = false;
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === renderer.domElement;
  if (!IS_TOUCH) {
    if (locked) { controlsActive = true; wasLocked = true; }
    else if (wasLocked && !viewerOpen) {
      // 락 해제(ESC) → 시작 화면으로
      controlsActive = false;
      startEl.classList.remove('hidden');
      startEl.setAttribute('aria-hidden', 'false');
      startEl.inert = false;
      touchUIEl.setAttribute('aria-hidden', 'true');
      btnJump.disabled = true; btnRun.disabled = true;
      enterBtn.textContent = '3D 계속';
    }
  }
});
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== renderer.domElement) return;
  player.yaw -= e.movementX * 0.0022;
  player.pitch -= e.movementY * 0.0022;
  player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch));
});
/* 포인터 락이 안 되는 환경 폴백: 드래그로 시점 회전 */
const drag = { on: false, x: 0, y: 0, moved: 0 };
renderer.domElement.addEventListener('mousedown', (e) => {
  if (IS_TOUCH || document.pointerLockElement || !controlsActive) return;
  drag.on = true; drag.x = e.clientX; drag.y = e.clientY; drag.moved = 0;
});
window.addEventListener('mousemove', (e) => {
  if (!drag.on) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.moved += Math.abs(dx) + Math.abs(dy);
  player.yaw -= dx * 0.0035;
  player.pitch -= dy * 0.0035;
  player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch));
  drag.x = e.clientX; drag.y = e.clientY;
});
window.addEventListener('mouseup', (e) => {
  if (drag.on && drag.moved < 6 && controlsActive) tryViewAt(e.clientX, e.clientY);
  drag.on = false;
});

/* 모바일: 조이스틱 + 시점 드래그 + 버튼 */
const joy = { active: false, id: null, cx: 0, cy: 0, dx: 0, dy: 0 };
const look = { active: false, id: null, lx: 0, ly: 0, moved: 0, t0: 0, sx: 0, sy: 0 };
const joyBase = document.getElementById('joyBase');
const joyStick = document.getElementById('joyStick');
const btnJump = document.getElementById('btnJump');
const btnRun = document.getElementById('btnRun');

if (IS_TOUCH) {
  document.body.classList.add('touch');
  document.getElementById('helpDesktop').style.display = 'none';
  document.getElementById('helpTouch').style.display = 'block';

  btnJump.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    if (player.onGround && controlsActive) { player.velY = JUMP_V; player.onGround = false; }
  });
  btnRun.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    player.running = !player.running;
    btnRun.classList.toggle('on', player.running);
    btnRun.setAttribute('aria-pressed', String(player.running));
  });

  renderer.domElement.addEventListener('touchstart', (e) => {
    if (!controlsActive) return;
    for (const t of e.changedTouches) {
      if (t.clientX < window.innerWidth * 0.45 && t.clientY > window.innerHeight * 0.35 && !joy.active) {
        joy.active = true; joy.id = t.identifier;
        joy.cx = t.clientX; joy.cy = t.clientY; joy.dx = joy.dy = 0;
        joyBase.style.display = 'block';
        joyBase.style.left = (t.clientX - 59) + 'px';
        joyBase.style.top = (t.clientY - 59) + 'px';
        joyBase.style.bottom = 'auto';
        joyStick.style.left = '33px'; joyStick.style.top = '33px';
      } else if (!look.active) {
        look.active = true; look.id = t.identifier;
        look.lx = t.clientX; look.ly = t.clientY;
        look.sx = t.clientX; look.sy = t.clientY;
        look.moved = 0; look.t0 = performance.now();
      }
    }
  }, { passive: true });

  renderer.domElement.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      if (joy.active && t.identifier === joy.id) {
        let dx = t.clientX - joy.cx, dy = t.clientY - joy.cy;
        const d = Math.hypot(dx, dy), max = 48;
        if (d > max) { dx *= max / d; dy *= max / d; }
        joy.dx = dx / max; joy.dy = dy / max;
        joyStick.style.left = (33 + dx) + 'px';
        joyStick.style.top = (33 + dy) + 'px';
      } else if (look.active && t.identifier === look.id) {
        const mx = t.clientX - look.lx, my = t.clientY - look.ly;
        look.moved += Math.abs(mx) + Math.abs(my);
        player.yaw -= mx * 0.0042;
        player.pitch -= my * 0.0042;
        player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch));
        look.lx = t.clientX; look.ly = t.clientY;
      }
    }
  }, { passive: true });

  const endTouch = (e) => {
    for (const t of e.changedTouches) {
      if (joy.active && t.identifier === joy.id) {
        joy.active = false; joy.dx = joy.dy = 0;
        joyBase.style.display = 'none';
      } else if (look.active && t.identifier === look.id) {
        // 짧은 탭 → 사진 감상
        if (look.moved < 12 && performance.now() - look.t0 < 350) {
          tryViewAt(look.sx, look.sy);
        }
        look.active = false;
      }
    }
  };
  renderer.domElement.addEventListener('touchend', endTouch, { passive: true });
  renderer.domElement.addEventListener('touchcancel', endTouch, { passive: true });
}

/* 입장 버튼 */
enterBtn.addEventListener('click', () => {
  document.body.classList.add('playing');
  startEl.classList.add('hidden');
  startEl.setAttribute('aria-hidden', 'true');
  startEl.inert = true;
  crosshairEl.style.display = IS_TOUCH ? 'none' : 'block';
  roomLabelEl.style.display = 'block';
  hintEl.style.display = 'block';
  hintEl.textContent = IS_TOUCH ? '사진을 탭하면 크게 볼 수 있습니다' : '사진을 클릭하면 크게 볼 수 있습니다';
  setTimeout(() => { hintEl.style.opacity = '0'; hintEl.style.transition = 'opacity 2s'; }, 5000);
  controlsActive = true;
  touchUIEl.setAttribute('aria-hidden', String(!IS_TOUCH));
  btnJump.disabled = !IS_TOUCH; btnRun.disabled = !IS_TOUCH;
  if (!IS_TOUCH) lockPointer();
});

/* ═══════════════════ 사진 확대 뷰어 ═══════════════════ */
const viewerEl = document.getElementById('viewer');
const viewerBody = document.getElementById('viewerBody');
const viewerCap = document.getElementById('viewerCap');
const viewerCloseBtn = document.getElementById('viewerClose');
let viewerOpen = false;
let controlsBeforeViewer = false;
let viewerReturnFocus = null;

function openViewer(art, trigger = null) {
  viewerOpen = true;
  controlsBeforeViewer = controlsActive;
  viewerReturnFocus = trigger || document.activeElement;
  controlsActive = false;
  touchUIEl.inert = true;
  if (!galleryPanel.hidden) {
    galleryPanel.inert = true;
    galleryPanel.setAttribute('aria-hidden', 'true');
  }
  if (document.pointerLockElement) document.exitPointerLock();
  viewerBody.innerHTML = '';
  if (art.isVideo) {
    if (art.video) art.video.pause();
    const v = document.createElement('video');
    v.src = art.item.file; v.controls = true; v.autoplay = true; v.playsInline = true;
    v.setAttribute('aria-label', `${art.dayLabel} 영상 No.${String(art.idxInDay).padStart(3, '0')}`);
    viewerBody.appendChild(v);
  } else {
    const im = document.createElement('img');
    im.src = art.item.file;
    im.alt = `${art.dayLabel} 사진 No.${String(art.idxInDay).padStart(3, '0')}`;
    viewerBody.appendChild(im);
  }
  viewerCap.textContent = `${art.dayLabel}  ·  No.${String(art.idxInDay).padStart(3, '0')}`;
  viewerEl.classList.add('show');
  viewerEl.setAttribute('aria-hidden', 'false');
  viewerCloseBtn.focus();
}
function closeViewer() {
  viewerOpen = false;
  const media = viewerBody.querySelector('video');
  if (media) { media.pause(); media.removeAttribute('src'); media.load(); }
  viewerBody.innerHTML = '';
  viewerEl.classList.remove('show');
  viewerEl.setAttribute('aria-hidden', 'true');
  controlsActive = controlsBeforeViewer;
  touchUIEl.inert = !controlsActive;
  if (!galleryPanel.hidden) {
    galleryPanel.inert = false;
    galleryPanel.setAttribute('aria-hidden', 'false');
  }
  if (!IS_TOUCH && controlsActive) lockPointer();
  else if (viewerReturnFocus && typeof viewerReturnFocus.focus === 'function') viewerReturnFocus.focus();
  viewerReturnFocus = null;
}
viewerCloseBtn.addEventListener('click', closeViewer);
viewerEl.addEventListener('click', (e) => { if (e.target === viewerEl) closeViewer(); });
document.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && viewerOpen) { e.preventDefault(); closeViewer(); return; }
  if (e.code !== 'Tab' || !viewerOpen) return;
  const focusable = [...viewerEl.querySelectorAll('button, video[controls]')];
  if (!focusable.length) return;
  const index = focusable.indexOf(document.activeElement);
  const next = e.shiftKey
    ? focusable[(index <= 0 ? focusable.length : index) - 1]
    : focusable[(index + 1) % focusable.length];
  e.preventDefault(); next.focus();
});

/* ═══════════════════ 접근 가능한 2D 작품 목록 ═══════════════════ */
const galleryBtn = document.getElementById('galleryBtn');
const galleryPanel = document.getElementById('galleryPanel');
const galleryClose = document.getElementById('galleryClose');
const galleryFilters = document.getElementById('galleryFilters');
const galleryGrid = document.getElementById('galleryGrid');
let galleryReturnFocus = null;
let galleryOpenedFromStart = true;

function openGallery() {
  galleryReturnFocus = document.activeElement;
  galleryOpenedFromStart = !startEl.classList.contains('hidden');
  controlsActive = false;
  if (document.pointerLockElement) document.exitPointerLock();
  startEl.setAttribute('aria-hidden', 'true');
  startEl.inert = true;
  touchUIEl.setAttribute('aria-hidden', 'true');
  galleryPanel.hidden = false;
  galleryPanel.setAttribute('aria-hidden', 'false');
  galleryClose.focus();
}

function closeGallery() {
  galleryPanel.hidden = true;
  galleryPanel.setAttribute('aria-hidden', 'true');
  if (galleryOpenedFromStart) {
    startEl.setAttribute('aria-hidden', 'false');
    startEl.inert = false;
  }
  if (galleryReturnFocus && typeof galleryReturnFocus.focus === 'function') galleryReturnFocus.focus();
  galleryReturnFocus = null;
}

function build2DGallery(manifest) {
  galleryFilters.replaceChildren();
  galleryGrid.replaceChildren();
  const filterDefs = [{ day: 0, label: '전체' }, ...manifest.days.map((label, i) => ({
    day: i + 1, label: `${i < 2 ? '1F' : '2F'} · ${label}`,
  }))];
  for (const def of filterDefs) {
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = def.label;
    button.dataset.day = String(def.day);
    button.setAttribute('aria-pressed', String(def.day === 0));
    button.addEventListener('click', () => {
      for (const filter of galleryFilters.querySelectorAll('button')) {
        filter.setAttribute('aria-pressed', String(filter === button));
      }
      for (const card of galleryGrid.children) {
        card.hidden = def.day !== 0 && Number(card.dataset.day) !== def.day;
      }
    });
    galleryFilters.appendChild(button);
  }

  for (const art of artworks) {
    const itemWrap = document.createElement('div');
    itemWrap.setAttribute('role', 'listitem');
    itemWrap.dataset.day = String(art.item.day);
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'galleryCard';
    const image = document.createElement('img');
    image.loading = 'lazy'; image.decoding = 'async';
    image.src = art.item.thumb || art.item.file;
    image.alt = `${art.dayLabel} ${art.isVideo ? '영상' : '사진'} No.${String(art.idxInDay).padStart(3, '0')}`;
    const meta = document.createElement('span');
    meta.className = 'galleryCardMeta';
    const label = document.createElement('span');
    label.textContent = `${art.dayLabel} · No.${String(art.idxInDay).padStart(3, '0')}`;
    const type = document.createElement('span');
    type.className = 'galleryCardType'; type.textContent = art.isVideo ? 'VIDEO' : 'PHOTO';
    meta.append(label, type); button.append(image, meta); itemWrap.appendChild(button);
    button.addEventListener('click', () => openViewer(art, button));
    galleryGrid.appendChild(itemWrap);
  }
}

galleryBtn.addEventListener('click', openGallery);
galleryClose.addEventListener('click', closeGallery);
galleryPanel.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && !viewerOpen) { e.preventDefault(); closeGallery(); }
});

/* 레이캐스트로 작품 찾기 */
const raycaster = new THREE.Raycaster();
function tryViewAt(sx, sy) {
  const ndc = new THREE.Vector2((sx / window.innerWidth) * 2 - 1, -(sy / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  raycaster.far = 7;
  const meshes = [];
  for (const a of artworks) if (a.group.parent && a.pos.distanceTo(player.pos) < 8) meshes.push(a.plane);
  const hits = raycaster.intersectObjects(meshes, false);
  if (hits.length) openViewer(hits[0].object.userData.art);
}
renderer.domElement.addEventListener('click', () => {
  if (!IS_TOUCH && document.pointerLockElement === renderer.domElement) {
    tryViewAt(window.innerWidth / 2, window.innerHeight / 2);
  }
});

/* ═══════════════════ 룸 매니저 (지연 로딩/컬링/비디오) ═══════════════════ */
let currentRoomIdx = 0;
function roomIndexAt(z, floor) {
  for (let i = 0; i < rooms.length; i++) {
    if (rooms[i].floor === floor && z <= rooms[i].zFrom + 0.5 && z >= rooms[i].zTo - 0.5) return i;
  }
  // 현재 층에서 가장 가까운 방을 폴백으로 사용한다.
  let best = 0, bestD = Infinity;
  for (let i = 0; i < rooms.length; i++) {
    if (rooms[i].floor !== floor) continue;
    const c = (rooms[i].zFrom + rooms[i].zTo) / 2;
    const d = Math.abs(z - c);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}
let lastRoomCheck = 0;
function updateRooms(now) {
  if (now - lastRoomCheck < 400) return;
  lastRoomCheck = now;
  currentRoomIdx = roomIndexAt(player.pos.z, player.floor);
  roomLabelEl.textContent = rooms[currentRoomIdx] ? rooms[currentRoomIdx].label : '';

  for (const art of artworks) art.distanceFromPlayer = art.pos.distanceTo(player.pos);
  const loadTargets = new Set(artworks
    .filter(art => !art.isVideo
      && art.floor === player.floor
      && Math.abs(art.roomIdx - currentRoomIdx) <= 1
      && art.distanceFromPlayer <= ART_LOAD_DISTANCE)
    .sort((a, b) => a.distanceFromPlayer - b.distanceFromPlayer)
    .slice(0, MAX_LOADED_PHOTOS));

  for (const art of artworks) {
    const nearRoom = art.floor === player.floor && Math.abs(art.roomIdx - currentRoomIdx) <= 1;
    const distance = art.distanceFromPlayer;
    const shouldLoad = loadTargets.has(art);
    const shouldKeep = nearRoom && distance <= ART_KEEP_DISTANCE;
    art.loadTarget = shouldLoad;
    art.wanted = art.isVideo ? shouldKeep : (shouldLoad || (art.loaded && shouldKeep));
    if (art.loaded && shouldKeep) art.lastUsed = now;
    if (shouldLoad && !art.loaded && !art.loading && !art.isVideo && !art.queued
        && (!art.retryAt || now >= art.retryAt)) {
      art.queued = true;
      loadQueue.push(art);
    }
    if (!shouldKeep && art.cancelLoad) art.cancelLoad();
    if (!shouldKeep && (art.loaded || art.video)) unloadArt(art);
    // 인접 방이라도 멀리 있는 작품은 렌더하지 않아 드로우콜을 제한한다.
    const visible = nearRoom && distance <= ART_VISIBLE_DISTANCE;
    if (art.group.visible !== visible) art.group.visible = visible;
  }
  // 가까운 것부터 로드 (현재 방 우선)
  loadQueue.sort((a, b) => a.pos.distanceToSquared(player.pos) - b.pos.distanceToSquared(player.pos));
  pumpLoads();
  enforcePhotoBudget();

  /* 비디오: 현재 방에서 가까운 2개만 재생 */
  const vids = artworks
    .filter(a => a.isVideo && a.floor === player.floor && Math.abs(a.roomIdx - currentRoomIdx) <= 1)
    .map(a => ({ a, d: a.pos.distanceTo(player.pos) }))
    .sort((p, q) => p.d - q.d);
  let playing = 0;
  for (const { a, d } of vids) {
    if (d < NEAR_VIDEO && playing < 2 && !viewerOpen) {
      playing++;
      if (!a.video) {
        const v = document.createElement('video');
        v.src = a.item.file; v.muted = true; v.loop = true; v.playsInline = true;
        v.preload = 'auto'; v.crossOrigin = 'anonymous';
        v.addEventListener('loadedmetadata', () => {
          if (a.video === v) fitArtworkToAspect(a, v.videoWidth / v.videoHeight);
        }, { once: true });
        a.video = v;
        const vt = new THREE.VideoTexture(v);
        vt.colorSpace = THREE.SRGBColorSpace;
        a.vtex = vt;
        a.plane.material.map = vt;
        a.plane.material.needsUpdate = true;
        a.loaded = true;
      }
      a.video.play().catch(() => {});
    } else if (a.video) {
      if (d > VIDEO_KEEP_DISTANCE) unloadArt(a);
      else a.video.pause();
    }
  }
}

/* ═══════════════════ 물리 & 이동 ═══════════════════ */
function resolveCollisions() {
  const p = player.pos;
  for (let iter = 0; iter < 2; iter++) {
    for (const b of colliders) {
      if (b.floor !== player.floor) continue;
      const cx = Math.max(b.minX, Math.min(p.x, b.maxX));
      const cz = Math.max(b.minZ, Math.min(p.z, b.maxZ));
      const dx = p.x - cx, dz = p.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < RADIUS * RADIUS) {
        if (d2 > 1e-9) {
          const d = Math.sqrt(d2), push = (RADIUS - d) / d;
          p.x += dx * push; p.z += dz * push;
        } else {
          // 박스 내부: 최소 침투 축으로 밀어냄
          const pushL = p.x - b.minX + RADIUS, pushR = b.maxX - p.x + RADIUS;
          const pushU = p.z - b.minZ + RADIUS, pushD = b.maxZ - p.z + RADIUS;
          const m = Math.min(pushL, pushR, pushU, pushD);
          if (m === pushL) p.x = b.minX - RADIUS;
          else if (m === pushR) p.x = b.maxX + RADIUS;
          else if (m === pushU) p.z = b.minZ - RADIUS;
          else p.z = b.maxZ + RADIUS;
        }
      }
    }
  }
}

function updatePlayer(dt) {
  if (!controlsActive) return;
  // 입력 → 이동 방향
  let ix = 0, iz = 0;
  if (keys['KeyW'] || keys['ArrowUp']) iz -= 1;
  if (keys['KeyS'] || keys['ArrowDown']) iz += 1;
  if (keys['KeyA'] || keys['ArrowLeft']) ix -= 1;
  if (keys['KeyD'] || keys['ArrowRight']) ix += 1;
  if (joy.active) { ix += joy.dx; iz += joy.dy; }

  const len = Math.hypot(ix, iz);
  if (len > 1) { ix /= len; iz /= len; }

  const running = keys['ShiftLeft'] || keys['ShiftRight'] || player.running;
  const speed = running ? RUN : WALK;

  const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
  // 카메라 기준 이동 (yaw만 적용)
  const mx = (ix * cos + iz * sin) * speed * dt;
  const mz = (iz * cos - ix * sin) * speed * dt;
  player.pos.x += mx;
  player.pos.z += mz;
  resolveCollisions();

  // 점프 / 중력
  if ((keys['Space']) && player.onGround) {
    player.velY = JUMP_V; player.onGround = false;
  }
  player.velY -= GRAVITY * dt;
  player.pos.y += player.velY * dt;
  const stairProgress = stairProgressAt(player.pos.x, player.pos.z);
  let groundBase = player.floor * FLOOR_HEIGHT;
  if (stairProgress !== null) {
    groundBase = stairProgress * FLOOR_HEIGHT;
    const stairFloor = stairProgress >= 0.5 ? 1 : 0;
    if (stairFloor !== player.floor) {
      player.floor = stairFloor;
      updateFloorNav(player.floor);
      lastRoomCheck = -1e9;
    }
  }
  const groundEye = EYE + groundBase;
  if (player.pos.y <= groundEye) {
    player.pos.y = groundEye; player.velY = 0; player.onGround = true;
  }

  camera.position.copy(player.pos);
  camera.rotation.set(player.pitch, player.yaw, 0);
}

/* ═══════════════════ 시작 ═══════════════════ */
const loadNote = document.getElementById('loadNote');

async function init() {
  try {
    const res = await fetch('manifest.json');
    if (!res.ok) throw new Error('manifest.json not found');
    const manifest = await res.json();
    buildMuseum(manifest);
    build2DGallery(manifest);
    player.pos.copy(spawnPoint);
    camera.position.copy(player.pos);
    camera.rotation.set(0, player.yaw, 0);
    loadNote.textContent = `사진 ${manifest.items.filter(i => i.type === 'photo').length}점 · 영상 ${manifest.items.filter(i => i.type === 'video').length}점 전시 중`;
    enterBtn.disabled = false;
    galleryBtn.disabled = false;
    lastRoomCheck = -1e9;
    updateRooms(performance.now()); // 초기 로딩 킥
  } catch (err) {
    loadNote.textContent = '전시 준비 중입니다 — 에셋 변환이 끝나면 새로고침해 주세요. (' + err.message + ')';
    console.error(err);
  }
}

const clock = new THREE.Clock();
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);
  updatePlayer(dt);
  updateRooms(performance.now());
  renderer.render(scene, camera);
}

init();
loop();

// 개발용 디버그 핸들
window.__m = { player, rooms, artworks, keys, joy, drag, renderer, scene, camera,
  get room() { return currentRoomIdx; },
  tp(x, z, yaw) { player.pos.set(x, EYE + player.floor * FLOOR_HEIGHT, z); player.yaw = yaw; player.pitch = 0; },
  floor(n) { switchFloor(Math.max(0, Math.min(1, n))); },
  step() { // rAF가 멈춘 환경에서 수동 프레임 진행 (테스트용)
    updatePlayer(1 / 60);
    lastRoomCheck = -1e9;
    updateRooms(performance.now());
    camera.position.copy(player.pos);
    camera.rotation.set(player.pitch, player.yaw, 0);
    renderer.render(scene, camera);
  } };
