// 요나고미나미고등학교 설악고등학교 2026 국제교류 — 3D 갤러리
// Three.js 1인칭 미술관. WASD/SHIFT/SPACE + 모바일 터치 조작.
import * as THREE from 'three';
import * as Social from './social.js';
import { SECRET_QUIZ, REWARD_VIDEO } from './quiz-data.js';

/* ═══════════════════ 상수 ═══════════════════ */
const IS_TOUCH = ('ontouchstart' in window) || navigator.maxTouchPoints > 0
  || location.search.includes('touch=1');
const EYE = 1.7;              // 눈높이 (m)
const RADIUS = 0.38;          // 플레이어 충돌 반경
const WALK = 4.2, RUN = 8.4;  // 이동 속도 (m/s)
const GRAVITY = 22, JUMP_V = 7.6;
const WALL_H = 5;             // 벽 높이
const FLOOR_HEIGHT = 5.2;     // 층간 높이(슬래브 포함)
const PRIMARY_STAIR = Object.freeze({
  xMin: 3.35, xMax: 6.05,
  zBottom: 10.4, zTop: 1.8,
});
const stairways = [PRIMARY_STAIR];
const T = 0.4;                // 벽 두께
const HALL_W = 12;            // 전시실 폭
const DOOR_W = 4, DOOR_H = 3.2;
const SPACING = 1.7;          // 작품 간격 (m)
// 벽면에서 작품 하나가 차지하는 폭(간격 포함). 영상은 투사 화면이 넓다.
const widthNeedOf = (it) => it.type === 'video' ? (it.w >= it.h ? 3.6 : 2.0) : SPACING;
const MAX_TEX = IS_TOUCH ? 512 : 768;   // GPU 텍스처 최대 크기
const NEAR_VIDEO = 9;         // 비디오 자동재생 거리
const VIDEO_KEEP_DISTANCE = 13;
const ART_LOAD_DISTANCE = IS_TOUCH ? 16 : 22;
const ART_KEEP_DISTANCE = IS_TOUCH ? 22 : 30;
const ART_VISIBLE_DISTANCE = IS_TOUCH ? 30 : 42;
const MAX_LOADED_PHOTOS = IS_TOUCH ? 36 : 56;
const AUTO_SPEED = 1.1;       // 자동 관람 이동 속도 (m/s) — 아주 천천히
const AUTO_DWELL_PHOTO = 4;   // 사진 앞 감상 시간 (s)
const AUTO_DWELL_VIDEO = 9;   // 영상 앞 감상 시간 (s)

/* ═══════════════════ 비밀의 방 챌린지 (9와 3/4 승강장) ═══════════════════ */
// 2F 시네마 뒤쪽 표지 → 퀴즈 → 레이저 타이밍 점프맵 → 비밀의 방(보상 영상 + 기네스북).
const PORTAL_W = 3.0, PORTAL_H = 3.4;   // 시네마 동쪽 벽 표지(포털) 개구부 크기
const LAND_TOL = 0.28;                  // 발판 착지 허용 오차 (위에서만 착지)
const platforms = [];   // {minX,maxX,minZ,maxZ, topY} — 위에서만 착지하는 관대한 발판
const lasers = [];      // {x, zMin, zMax, onS, offS, phaseS, mesh, mat}
const challenge = {
  active: false,   // 퀴즈 통과 후 점프맵 활성
  solved: false,   // 퀴즈 통과 여부
  reached: false,  // 비밀의 방 도달 여부
  armed: true,     // 표지 접근 시 퀴즈 재오픈 가능 여부(존을 벗어나면 재장전)
  clock: 0,        // 레이저 타이밍용 누적 시간(s)
  pitY: 0,         // 낙사 판정 바닥(월드 Y)
  checkpoint: new THREE.Vector3(),
  checkpointYaw: -Math.PI / 2,   // +x(동쪽)를 바라봄
  bounds: null,        // {wallX, endX, zS, zN} 점프맵 영역
  roomTrigger: null,   // {minX,maxX,minZ,maxZ} 도달 판정 박스
};
let secretPortalColliders = [];  // 정답 시 통과 가능하도록 제거할 콜라이더
let secretPortalMesh = null;     // 표지(벽돌 포털) 메시 — 정답 시 열림 연출
let hofGroup = null, hofUnsub = null;   // 명예의 전당(3D 이름 벽)

// 한국어 요일 → 일본어 병기 ("(일)" → "(일·日)")
const WEEKDAY_JA = { '일': '日', '월': '月', '화': '火', '수': '水', '목': '木', '금': '金', '토': '土' };
const biDay = (label) => label.replace(/\(([일월화수목금토])\)/, (_, d) => `(${d}·${WEEKDAY_JA[d]})`);

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
    g.font = `${ln.weight || 300} ${(ln.size || 0.1) * scale}px "Helvetica Neue","Apple SD Gothic Neo","Hiragino Kaku Gothic ProN","Noto Sans KR","Noto Sans JP",sans-serif`;
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
const shadowGeo = new THREE.PlaneGeometry(1, 1);
const artworkPlaneGeo = new THREE.PlaneGeometry(1, 1);
const likeBadgeGeo = new THREE.PlaneGeometry(1, 1);
const likeBadgeMaterials = new Map();

// 3D 작품 아래에 붙는 작은 미술관 라벨형 하트 배지. 같은 숫자는 텍스처를
// 공유해서 작품 수만큼 캔버스/텍스처를 만들지 않는다.
function likeBadgeMaterial(count) {
  const label = count > 999 ? '999+' : String(Math.max(0, count | 0));
  if (likeBadgeMaterials.has(label)) return likeBadgeMaterials.get(label);
  const c = document.createElement('canvas'); c.width = 256; c.height = 96;
  const g = c.getContext('2d');
  const x = 4, y = 4, w = 248, h = 88, r = 44;
  g.beginPath();
  g.moveTo(x + r, y);
  g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
  g.fillStyle = 'rgba(246,244,240,.96)'; g.fill();
  g.strokeStyle = 'rgba(39,40,43,.22)'; g.lineWidth = 3; g.stroke();
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#e65e6d'; g.font = '700 48px "Helvetica Neue",sans-serif';
  g.fillText('♥', 72, 51);
  g.fillStyle = '#343438'; g.font = '600 39px "Helvetica Neue",sans-serif';
  g.fillText(label, 166, 50);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const mat = new THREE.MeshBasicMaterial({
    map: tex, transparent: true, depthWrite: false, toneMapped: false,
  });
  likeBadgeMaterials.set(label, mat);
  return mat;
}

function layoutLikeBadge(art) {
  if (!art.likeBadge) return;
  art.likeBadge.position.set(art.w / 2 - 0.20, -art.h / 2 - (art.isVideo ? 0.16 : 0.12), 0.11);
}

function setArtworkLikeCount(art, count, visible = true) {
  const value = Math.max(0, count | 0);
  art.likeCount = value;
  art.likeBadge.material = likeBadgeMaterial(value);
  art.likeBadge.visible = visible;
}
// 스크린 둘레의 사각 빛 번짐 — 프로젝터 빛이 벽면에 번진 느낌 (타원 글로우는 조명 얼룩처럼 보였음)
const projSpillTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  // 캔버스 밖에 사각형을 그리고 그림자만 남겨 부드러운 사각 글로우를 얻는다.
  g.shadowColor = 'rgba(255,250,238,0.9)';
  g.shadowBlur = 42;
  g.shadowOffsetX = 512;
  g.fillStyle = '#fff';
  g.fillRect(46 - 512, 46, 164, 164);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
})();
const projectionGlowMat = new THREE.MeshBasicMaterial({
  map: projSpillTex, transparent: true, opacity: 0.55, depthWrite: false,
  toneMapped: false, blending: THREE.AdditiveBlending,
});
const beamMat = new THREE.MeshBasicMaterial({
  color: 0xfff6e2, transparent: true, opacity: 0.03, depthWrite: false,
  side: THREE.DoubleSide, toneMapped: false, blending: THREE.AdditiveBlending,
});
const VIDEO_RAISE = 0.55;     // 영상은 사진 걸이선보다 높은 벽면에 투사
const PROJECTOR_DIST = 3.1;   // 벽면-프로젝터 거리
const PROJECTOR_Y = 2.2;      // 스크린 중심 기준 프로젝터 로컬 높이

// 프로젝터 렌즈에서 스크린 네 모서리로 퍼지는 광선 볼륨
function updateBeamGeometry(art) {
  const hw = art.pw / 2 + 0.12, hh = art.ph / 2 + 0.12;
  const a = [0, PROJECTOR_Y - 0.02, PROJECTOR_DIST - 0.22];
  const corners = [[-hw, -hh, 0.02], [hw, -hh, 0.02], [hw, hh, 0.02], [-hw, hh, 0.02]];
  const tris = [];
  // 아래 면은 빼서 밑에서 올려다볼 때 면들이 겹쳐 보이는 난반사를 줄인다.
  for (let i = 1; i < 4; i++) tris.push(a, corners[i], corners[(i + 1) % 4]);
  art.beamGeo.setAttribute('position', new THREE.Float32BufferAttribute(tris.flat(), 3));
  art.beamGeo.computeBoundingSphere();
}

function fitArtworkToAspect(art, aspect) {
  if (!Number.isFinite(aspect) || aspect <= 0) return;
  let pw, ph;
  if (aspect >= 1) { pw = art.maxDim; ph = art.maxDim / aspect; }
  else { ph = art.maxDim; pw = art.maxDim * aspect; }
  // 영상: 실제 화면비가 슬롯보다 넓으면 옆 작품과 겹치지 않게 축소한다.
  if (art.isVideo && art.slotW) {
    const limit = Math.max(1.1, art.slotW - 0.35);
    if (pw > limit) { ph *= limit / pw; pw = limit; }
  }

  const w = pw + art.matPad * 2;
  const h = ph + art.matPad * 2;
  art.aspect = aspect;
  art.pw = pw; art.ph = ph;
  art.w = w; art.h = h;
  if (art.frame) art.frame.scale.set(w + art.border * 2, h + art.border * 2, 0.055);
  if (art.shadow) art.shadow.scale.set((w + art.border * 2) * 1.45, (h + art.border * 2) * 1.45, 1);
  if (art.projectionGlow) art.projectionGlow.scale.set(pw + 0.7, ph + 0.7, 1);
  if (art.beamGeo) updateBeamGeometry(art);
  if (art.caption) art.caption.position.y = -ph / 2 - 0.2;
  layoutLikeBadge(art);

  // 사진 텍스처에는 매트가 합성되어 있고, 영상은 원본 화면 비율만 사용한다.
  art.plane.scale.set(art.isVideo ? pw : w, art.isVideo ? ph : h, 1);
}

function createArtwork(item, roomIdx, idxInDay, dayLabel) {
  const isVideo = item.type === 'video';
  const aspect = item.w / item.h;
  // 사진 영역 크기 (최대변 기준)
  const maxDim = isVideo ? 2.0 : 1.05;
  const mat = isVideo ? 0 : 0.16;           // 사진만 매트(여백) 사용
  const border = isVideo ? 0 : 0.045;       // 영상은 벽면 직접 투사

  const group = new THREE.Group();
  let shadow = null;
  let frame = null;
  let projectionGlow = null;
  let beam = null;
  let beamGeo = null;
  let caption = null;
  if (isVideo) {
    // 프로젝터가 벽에 직접 투사한 듯 화면 둘레에 부드러운 광량만 남긴다.
    projectionGlow = new THREE.Mesh(shadowGeo, projectionGlowMat);
    projectionGlow.position.z = 0.006;
    projectionGlow.renderOrder = 1;
    group.add(projectionGlow);
    // 천장 프로젝터 리그(봉+본체+렌즈): 영상이 꺼져 있어도 투사 지점임을 보여 준다.
    const ceilLocal = WALL_H - 1.6 - VIDEO_RAISE; // group은 yBase+1.6+VIDEO_RAISE 높이에 놓인다
    const rodH = ceilLocal - PROJECTOR_Y - 0.075;
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, rodH, 8), frameMat);
    rod.position.set(0, PROJECTOR_Y + 0.075 + rodH / 2, PROJECTOR_DIST);
    group.add(rod);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.15, 0.36), frameMat);
    body.position.set(0, PROJECTOR_Y, PROJECTOR_DIST);
    group.add(body);
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.06, 12), darkMat);
    lens.rotation.x = Math.PI / 2;
    lens.position.set(0, PROJECTOR_Y - 0.02, PROJECTOR_DIST - 0.2);
    group.add(lens);
    beamGeo = new THREE.BufferGeometry();
    beam = new THREE.Mesh(beamGeo, beamMat);
    beam.renderOrder = 3;
    beam.visible = false;
    group.add(beam);
    caption = textPlane([
      { text: 'PROJECTED FILM', size: 0.065, weight: 600, spacing: 0.025, color: '#6e6b65' },
      { text: `DAY ${item.day} · No.${String(idxInDay).padStart(3, '0')}`, size: 0.065, color: '#918e87' },
    ], 1.4, 0.3);
    caption.position.z = 0.012;
    group.add(caption);
  } else {
    // 사진 액자의 벽면 드롭섀도
    shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.position.set(0, -0.04, 0.004);
    shadow.renderOrder = 1;
    group.add(shadow);
    frame = new THREE.Mesh(frameGeo, frameMat);
    frame.position.z = 0.028;
    group.add(frame);
  }
  // 사진/매트 합성 플레인
  const plane = new THREE.Mesh(
    artworkPlaneGeo,
    new THREE.MeshBasicMaterial({ map: placeholderTex, toneMapped: false })
  );
  plane.position.z = isVideo ? 0.014 : 0.06;
  plane.renderOrder = isVideo ? 2 : 0;
  if (isVideo) {
    plane.visible = false;
    projectionGlow.visible = false;
  }
  group.add(plane);

  const likeBadge = new THREE.Mesh(likeBadgeGeo, likeBadgeMaterial(0));
  likeBadge.scale.set(0.50, 0.19, 1);
  likeBadge.renderOrder = 6;
  likeBadge.visible = false;
  group.add(likeBadge);

  const art = { item, group, plane, frame, shadow, projectionGlow, beam, beamGeo, caption, likeBadge,
                border, maxDim, matPad: mat, isVideo, roomIdx, idxInDay, dayLabel,
                likeCount: 0, loaded: false, loading: false, tex: null, video: null, vtex: null, pos: new THREE.Vector3() };
  fitArtworkToAspect(art, aspect);
  plane.userData.art = art;
  if (frame) frame.userData.art = art;
  artworks.push(art);
  return art;
}

// 슬롯에 작품 배치: slot = {x, y, z, rotY} — 영상은 사진 걸이선보다 높이 투사한다.
function placeArtwork(art, slot) {
  const y = slot.y + (art.isVideo ? VIDEO_RAISE : 0);
  art.group.position.set(slot.x, y, slot.z);
  art.group.rotation.y = slot.rotY;
  art.pos.set(slot.x, y, slot.z);
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
      if (!art.isVideo) {
        g.strokeStyle = 'rgba(0,0,0,.18)'; g.lineWidth = 1;
        g.strokeRect(padX - .5, padY - .5, iw + 1, ih + 1);
      }
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
      if (!art.isVideo) {
        art.plane.material.map = tex;
      } else if (!art.video) {
        // 대기 중 프로젝션: 첫 프레임 포스터를 살짝 어둡게 투사해 둔다.
        art.plane.material.map = tex;
        art.plane.material.color.setHex(0xb4b2ae);
        art.plane.visible = true;
        art.projectionGlow.visible = true;
      }
      art.plane.material.needsUpdate = true;
      pumpLoads();
    };
    img.onerror = () => {
      if (!settle()) return;
      art.cancelLoad = null;
      art.retryAt = performance.now() + 10000;
      pumpLoads();
    };
    // 영상은 mp4를 <img>로 읽을 수 없으므로 반드시 썸네일만 사용한다.
    img.src = art.isVideo ? art.item.thumb : (art.item.thumb || art.item.file);
  }
}
// 영상 재생 리소스만 해제 — 포스터가 있으면 대기 화면으로 되돌린다.
function releaseVideoPlayback(art) {
  if (art.video) {
    art.video.pause(); art.video.removeAttribute('src'); art.video.load();
    if (art.vtex) art.vtex.dispose();
    art.video = null; art.vtex = null;
  }
  art.beam.visible = false;
  if (art.tex) {
    art.plane.material.map = art.tex;
    art.plane.material.color.setHex(0xb4b2ae);
    art.plane.material.needsUpdate = true;
  } else {
    art.plane.visible = false;
    art.projectionGlow.visible = false;
    art.loaded = false; // 포스터가 없으면 다음 갱신 때 썸네일을 로드한다.
  }
}

function unloadArt(art) {
  if (art.isVideo) releaseVideoPlayback(art);
  art.plane.material.map = placeholderTex;
  art.plane.material.color.setHex(0xffffff);
  art.plane.material.needsUpdate = true;
  if (art.tex) { art.tex.dispose(); art.tex = null; }
  if (art.isVideo) {
    art.plane.visible = false;
    art.projectionGlow.visible = false;
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
// 자동 관람 경로: {x, z, floor, art?} — art가 있으면 그 앞에 멈춰 감상한다.
const tourStops = [];

function cylinderBetween(a, b, radius, material) {
  const direction = new THREE.Vector3().subVectors(b, a);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, direction.length(), 10), material);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  scene.add(mesh);
  return mesh;
}

function stairOpening(stair) {
  return {
    xMin: stair.xMin - 0.12, xMax: stair.xMax + 0.12,
    zMin: stair.zTop - 0.25, zMax: stair.zBottom + 0.25,
  };
}

function rectsAroundOpenings(xMin, xMax, zMin, zMax, openings) {
  const clipped = openings.map(opening => ({
    xMin: Math.max(xMin, opening.xMin), xMax: Math.min(xMax, opening.xMax),
    zMin: Math.max(zMin, opening.zMin), zMax: Math.min(zMax, opening.zMax),
  })).filter(opening => opening.xMin < opening.xMax && opening.zMin < opening.zMax);
  const xs = [...new Set([xMin, xMax, ...clipped.flatMap(o => [o.xMin, o.xMax])])].sort((a, b) => a - b);
  const zs = [...new Set([zMin, zMax, ...clipped.flatMap(o => [o.zMin, o.zMax])])].sort((a, b) => a - b);
  const rects = [];
  for (let xi = 0; xi < xs.length - 1; xi++) {
    for (let zi = 0; zi < zs.length - 1; zi++) {
      const xa = xs[xi], xb = xs[xi + 1], za = zs[zi], zb = zs[zi + 1];
      const cx = (xa + xb) / 2, cz = (za + zb) / 2;
      if (clipped.some(o => cx > o.xMin && cx < o.xMax && cz > o.zMin && cz < o.zMax)) continue;
      rects.push([xa, xb, za, zb]);
    }
  }
  return rects;
}

function buildStaircase(stair) {
  const steps = 26;
  const width = stair.xMax - stair.xMin;
  const run = stair.zBottom - stair.zTop;
  const depth = run / steps;
  const rise = FLOOR_HEIGHT / steps;
  const centerX = (stair.xMin + stair.xMax) / 2;
  const stepMat = new THREE.MeshStandardMaterial({ color: 0xd8d5ce, roughness: 0.72, metalness: 0.03 });

  // 뜬 계단: 얇은 디딤판 + 양옆 경사 보(스트링거)만 남겨 계단 아래가 트여 보이게 한다.
  const treadT = 0.09;
  for (let i = 0; i < steps; i++) {
    const top = rise * (i + 1);
    const step = new THREE.Mesh(new THREE.BoxGeometry(width, treadT, depth + 0.06), stepMat);
    step.position.set(centerX, top - treadT / 2, stair.zBottom - depth * (i + 0.5));
    scene.add(step);
  }
  const slope = Math.atan2(FLOOR_HEIGHT, run);
  const beamLen = Math.hypot(FLOOR_HEIGHT, run) + 0.3;
  for (const x of [stair.xMin + 0.06, stair.xMax - 0.06]) {
    const stringer = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.34, beamLen), darkMat);
    stringer.rotation.x = slope;
    stringer.position.set(x, FLOOR_HEIGHT / 2 - 0.26, (stair.zBottom + stair.zTop) / 2);
    scene.add(stringer);
  }

  // 계단 양옆 난간과 손잡이
  const railMat = new THREE.MeshStandardMaterial({ color: 0x2b2d30, roughness: 0.35, metalness: 0.65 });
  for (const x of [stair.xMin, stair.xMax]) {
    cylinderBetween(
      new THREE.Vector3(x, 1.0, stair.zBottom),
      new THREE.Vector3(x, FLOOR_HEIGHT + 1.0, stair.zTop),
      0.045, railMat
    );
    for (let i = 0; i <= 6; i++) {
      const p = i / 6;
      const base = p * FLOOR_HEIGHT;
      const z = stair.zBottom - run * p;
      cylinderBetween(new THREE.Vector3(x, base + 0.05, z), new THREE.Vector3(x, base + 1.0, z), 0.028, railMat);
    }
  }

  // 중간에서 옆으로 떨어지지 않도록 층별 충돌 난간을 둔다.
  const railZ = (stair.zBottom + stair.zTop) / 2;
  for (const floor of [0, 1]) {
    addCollider(stair.xMin - 0.08, railZ, 0.16, run, floor);
    addCollider(stair.xMax + 0.08, railZ, 0.16, run, floor);
  }
  // 계단 뒤(높은 쪽)로 1층에서 파고들어 순간이동하지 못하게 막는다.
  addCollider(centerX, stair.zTop - 0.28, width + 0.2, 0.2, 0);

  const stairSign = textPlane([
    { text: stair.label || 'STAIRS · 2F', size: 0.14, weight: 600, spacing: 0.035, color: '#f1efe9' },
    { text: 'DAY 3 · DAY 4', size: 0.08, color: '#c8c4bb' },
  ], 1.5, 0.7, { bg: '#2b2d30' });
  const signX = stair.signSide === 'left' ? stair.xMin - 0.75 : stair.xMax + 0.75;
  stairSign.position.set(signX, 1.45, stair.zBottom + 0.04);
  scene.add(stairSign);
}

/* ═══════════════════ 2층 영상 상영실(시어터) ═══════════════════ */
// 우에다 쇼지 미술관의 영상실 오마주. 전체 사진·영상을 잔잔하게 순환 상영한다.
// 사진은 느린 줌(켄 번스)과 페이드, 영상은 중간 10초만 재생한다.
let cinemaCtl = null;   // 슬라이드쇼 컨트롤러
let cinemaInfo = null;  // {cz, screenX, screenY, viewX, roomIdx} — 자동 관람 경로용
const CINEMA_MIRROR = true;   // 서쪽 벽 스크린은 좌우 반전되어 보이므로 되돌린다
const CINEMA_MAX_TEX = IS_TOUCH ? 640 : 1024;

function buildCinema(def, roomGroup) {
  const { W, L, zFrom, zTo } = def;
  const yBase = def.elevation;
  const cz = (zFrom + zTo) / 2;

  const wallMat = new THREE.MeshStandardMaterial({
    color: 0x191a1e, roughness: 0.92, metalness: 0.0, envMapIntensity: 0.25 });
  // 서쪽(스크린) 벽 — 스크린 뒤로 "비밀의 방" 포털 개구부를 남긴다.
  const gLo = cz - PORTAL_W / 2, gHi = cz + PORTAL_W / 2;
  const zLo = cz - (L + 0.2) / 2, zHi = cz + (L + 0.2) / 2;
  wallBox(-W / 2 - T / 2, yBase + WALL_H / 2, (zLo + gLo) / 2, T, WALL_H, gLo - zLo, wallMat, true, def.floor);
  wallBox(-W / 2 - T / 2, yBase + WALL_H / 2, (gHi + zHi) / 2, T, WALL_H, zHi - gHi, wallMat, true, def.floor);
  wallBox(-W / 2 - T / 2, yBase + (PORTAL_H + WALL_H) / 2, cz, T, WALL_H - PORTAL_H, PORTAL_W, wallMat, false, def.floor);
  // 동쪽 벽 (솔리드)
  wallBox(W / 2 + T / 2, yBase + WALL_H / 2, cz, T, WALL_H, L + 0.2, wallMat, true, def.floor);
  const innerMat = new THREE.MeshStandardMaterial({ color: 0x0e0f12, roughness: 0.95 });
  const westSeg = (segCz, segLen) => {
    if (segLen <= 0.02) return;
    const p = new THREE.Mesh(new THREE.PlaneGeometry(segLen, WALL_H), innerMat);
    p.position.set(-W / 2 + 0.02, yBase + WALL_H / 2, segCz); p.rotation.y = Math.PI / 2;
    scene.add(p);
  };
  westSeg((cz - L / 2 + gLo) / 2, gLo - (cz - L / 2));
  westSeg((gHi + cz + L / 2) / 2, (cz + L / 2) - gHi);
  const westLintel = new THREE.Mesh(new THREE.PlaneGeometry(PORTAL_W, WALL_H - PORTAL_H), innerMat);
  westLintel.position.set(-W / 2 + 0.02, yBase + (PORTAL_H + WALL_H) / 2, cz); westLintel.rotation.y = Math.PI / 2;
  scene.add(westLintel);
  const eastInner = new THREE.Mesh(new THREE.PlaneGeometry(L, WALL_H), innerMat);
  eastInner.position.set(W / 2 - 0.02, yBase + WALL_H / 2, cz); eastInner.rotation.y = -Math.PI / 2;
  scene.add(eastInner);
  baseboard(-W / 2 + 0.03, cz, L, false, yBase);
  baseboard(W / 2 - 0.03, cz, L, false, yBase);

  // ── 스크린 (서쪽 벽, 방을 향해 +x) ──
  const screenW = 6.8, screenH = screenW * 9 / 16;   // 16:9, ≈3.83
  const screenY = yBase + 0.95 + screenH / 2;
  const screenX = -W / 2 + 0.2;   // 스크린 면 (방을 향해 +x). 베젤은 이보다 뒤에 둔다.
  // 검은 베젤 프레임 — 스크린 뒤(서쪽)에 놓아 테두리만 보이게 한다
  const bezel = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, screenH + 0.34, screenW + 0.34),
    new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.5, metalness: 0.25 }));
  bezel.position.set(-W / 2 + 0.06, screenY, cz);
  scene.add(bezel);
  const screenBase = new THREE.Mesh(new THREE.PlaneGeometry(screenW, screenH),
    new THREE.MeshBasicMaterial({ color: 0x050608, toneMapped: false }));
  screenBase.position.set(screenX, screenY, cz); screenBase.rotation.y = Math.PI / 2;
  scene.add(screenBase);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(screenW, screenH),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, toneMapped: false }));
  screen.position.set(screenX + 0.02, screenY, cz); screen.rotation.y = Math.PI / 2;
  screen.renderOrder = 2;
  scene.add(screen);
  // 화면 빛 번짐 — 어두운 방을 은은히 비춘다
  const spill = new THREE.Mesh(new THREE.PlaneGeometry(screenW + 3.4, screenH + 3.4),
    new THREE.MeshBasicMaterial({ map: projSpillTex, transparent: true, opacity: 0,
      depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }));
  spill.position.set(screenX + 0.01, screenY, cz); spill.rotation.y = Math.PI / 2;
  spill.renderOrder = 1;
  scene.add(spill);

  // "9와 3/4 승강장" 표시 — 스크린 맨 아래에 걸쳐 입구 개구부(빈틈)를 덮는다. 비밀의 방 단서.
  // 영상과는 아주 살짝(≈0.03m)만 겹치고, 나머지는 스크린 하단~바닥의 빈틈을 가린다.
  const platLabel = textPlane([
    { text: 'PLATFORM 9¾', size: 0.2, weight: 700, spacing: 0.14, color: '#f2d675' },
    { text: '9와 3/4 승강장 · 9と3/4番線', size: 0.1, color: '#e8e6e1' },
  ], screenW, 1.05, { bg: '#0a0a0c' });
  platLabel.position.set(screenX + 0.05, screenY - screenH / 2 - 0.5, cz);
  platLabel.rotation.y = Math.PI / 2;
  platLabel.renderOrder = 3;
  scene.add(platLabel);
  challenge.signMesh = platLabel;

  // 상영실 안내판
  const sign = textPlane([
    { text: 'CINEMA · シアター', size: 0.2, weight: 600, spacing: 0.06, color: '#e8e6e1' },
    { text: '상영실 · 전체 기록 영상', size: 0.12, color: '#b6b2aa' },
  ], 3.2, 0.9, { bg: '#17181c' });
  sign.position.set(0, yBase + DOOR_H + 0.8, zFrom + T / 2 + 0.04);
  scene.add(sign);

  // ── 좌석: 스크린(서쪽)을 향한 벤치 3열, 중앙 통로는 비운다 ──
  const rowX = [1.4, 2.9, 4.4];
  const benchZ0 = cz - 3.2, benchZ1 = cz + 3.2;
  for (const bx of rowX) {
    for (const side of [-1, 1]) {
      const z0 = side < 0 ? benchZ0 : 0.9;
      const seatLen = side < 0 ? (0 - 0.9) - benchZ0 : benchZ1 - 0.9;
      if (seatLen <= 0.6) continue;
      const seatCz = z0 + seatLen / 2;
      const top = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.09, seatLen), woodMat);
      top.position.set(bx, yBase + 0.42, seatCz); scene.add(top);
      for (const dz of [-seatLen / 2 + 0.3, seatLen / 2 - 0.3]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.375, 0.08), darkMat);
        leg.position.set(bx, yBase + 0.1875, seatCz + dz); scene.add(leg);
      }
      addCollider(bx, seatCz, 0.5, seatLen, def.floor);
    }
  }

  cinemaInfo = { cz, screenX, screenY, viewX: 2.4, roomIdx: rooms.length,
    screen: new THREE.Vector3(screenX, screenY, cz) };

  /* ── 슬라이드쇼 컨트롤러 ── */
  const FADE = 0.9;
  const HOLD_PHOTO = 5.5, PLAY_VIDEO = 10;
  cinemaCtl = {
    items: def.items.slice(),
    i: -1, screen, spill, yBase,
    tex: null, video: null, vtex: null,
    pending: null,          // 프리페치된 다음 슬라이드
    phase: 'idle',          // idle | loading | in | hold | out
    t: 0, hold: 0, prefetched: false,
    near: false, wasNear: false,

    setScreenTex(tex, mirror) {
      // 좌우 반전 보정 (서쪽 벽 스크린)
      if (mirror && CINEMA_MIRROR) { tex.wrapS = THREE.ClampToEdgeWrapping; tex.repeat.x = -1; tex.offset.x = 1; }
      screen.material.map = tex;
      screen.material.color.setHex(0xffffff);
      screen.material.needsUpdate = true;
    },

    loadPhoto(item, cb) {
      const img = new Image();
      img.onload = () => {
        const ratio = Math.min(1, CINEMA_MAX_TEX / Math.max(img.width, img.height));
        const iw = Math.round(img.width * ratio), ih = Math.round(img.height * ratio);
        const cv = document.createElement('canvas');
        cv.width = iw; cv.height = ih;
        const g = cv.getContext('2d');
        g.fillStyle = '#000'; g.fillRect(0, 0, iw, ih);
        g.drawImage(img, 0, 0, iw, ih);
        const tex = new THREE.CanvasTexture(cv);
        tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
        tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
        // 화면비에 맞춰 플레인 스케일 (레터박스)
        cb({ type: 'photo', tex, aspect: iw / ih });
      };
      img.onerror = () => cb(null);
      img.src = item.file || item.thumb;
    },

    loadVideo(item, cb) {
      const v = document.createElement('video');
      v.src = item.file; v.muted = true; v.loop = true; v.playsInline = true;
      v.preload = 'auto'; v.crossOrigin = 'anonymous';
      let done = false;
      const ready = () => {
        if (done) return; done = true;
        const vtex = new THREE.VideoTexture(v);
        vtex.colorSpace = THREE.SRGBColorSpace;
        cb({ type: 'video', video: v, vtex, aspect: (v.videoWidth || 16) / (v.videoHeight || 9) });
      };
      v.addEventListener('loadeddata', () => {
        // 중간 지점에서 10초 재생
        const mid = Math.max(0, (v.duration || 20) / 2 - PLAY_VIDEO / 2);
        try { v.currentTime = mid; } catch (e) {}
        ready();
      }, { once: true });
      v.addEventListener('error', () => { if (!done) { done = true; cb(null); } });
    },

    loadNext(cb) {
      if (!this.items.length) { cb(null); return; }
      this.i = (this.i + 1) % this.items.length;
      const item = this.items[this.i];
      (item.type === 'video' ? this.loadVideo : this.loadPhoto).call(this, item, cb);
    },

    fitScreen(aspect) {
      // 스크린 프레임(16:9) 안에 레터박스로 맞춘다
      const frameA = screenW / screenH;
      let w = screenW, h = screenH;
      if (aspect > frameA) h = screenW / aspect; else w = screenH * aspect;
      screen.geometry.dispose();
      screen.geometry = new THREE.PlaneGeometry(w, h);
    },

    install(slot) {
      // 이전 리소스 해제
      this.disposeCurrent();
      if (slot.type === 'photo') {
        this.tex = slot.tex;
        this.setScreenTex(slot.tex, true);
        this.kb = { r0: 1.0, r1: 0.9, px: (this.i % 3) * 0.06, py: ((this.i % 2) ? 0.08 : -0.06) };
        this.hold = HOLD_PHOTO;
      } else {
        this.video = slot.video; this.vtex = slot.vtex;
        this.setScreenTex(slot.vtex, true);
        this.video.play().catch(() => {});
        this.kb = null;
        this.hold = PLAY_VIDEO;
      }
      this.fitScreen(slot.aspect);
      // 반전 보정은 setScreenTex에서 offset.x/repeat.x를 건드리므로 KB 기준값 저장
      const t = this.screen.material.map;
      this.kbBase = { rx: t.repeat.x, ry: t.repeat.y, ox: t.offset.x, oy: t.offset.y };
      this.phase = 'in'; this.t = 0; this.prefetched = false;
    },

    applyKenBurns(p) {
      if (!this.kb || !this.tex) return;
      const t = this.tex;
      const r = this.kb.r0 + (this.kb.r1 - this.kb.r0) * p;
      const sign = (this.kbBase.rx < 0) ? -1 : 1;   // 반전 스크린 보정 유지
      t.repeat.set(sign * r, r);
      t.offset.set((sign < 0 ? 1 : 0) + (sign < 0 ? -1 : 1) * ((1 - r) / 2 + this.kb.px * p),
                   (1 - r) / 2 + this.kb.py * p);
      // repeat/offset은 텍스처 매트릭스로 자동 반영된다(needsUpdate 건드리면 최초 업로드가 취소됨).
    },

    disposeCurrent() {
      if (this.video) { this.video.pause(); this.video.removeAttribute('src'); this.video.load(); this.video = null; }
      if (this.vtex) { this.vtex.dispose(); this.vtex = null; }
      if (this.tex) { this.tex.dispose(); this.tex = null; }
    },

    reset() {
      this.disposeCurrent();
      screen.material.opacity = 0; spill.material.opacity = 0;
      this.phase = 'idle'; this.pending = null;
    },

    update(dt) {
      // 근접 여부 (2층, 상영실 근처)
      const near = player.floor === 1 &&
        Math.abs(player.pos.z - cz) < L / 2 + 7 && Math.abs(player.pos.x) < W;
      this.near = near;
      if (!near) {
        if (this.wasNear) this.reset();
        this.wasNear = false;
        return;
      }
      this.wasNear = true;

      if (this.phase === 'idle') {
        this.phase = 'loading';
        this.loadNext((slot) => { if (slot && this.near) this.install(slot); else this.phase = 'idle'; });
        return;
      }
      if (this.phase === 'loading') return; // 콜백에서 install → 'in'

      this.t += dt;
      if (this.phase === 'in') {
        const p = Math.min(1, this.t / FADE);
        screen.material.opacity = p;
        spill.material.opacity = p * 0.42;
        if (this.kb) this.applyKenBurns(0);
        if (p >= 1) { this.phase = 'hold'; this.t = 0; }
      } else if (this.phase === 'hold') {
        const p = Math.min(1, this.t / this.hold);
        if (this.kb) this.applyKenBurns(p);
        // 종료 직전 다음 슬라이드 프리페치
        if (!this.prefetched && this.t > this.hold - 1.6) {
          this.prefetched = true;
          this.loadNext((slot) => { this.pending = slot || null; });
        }
        if (this.t >= this.hold) { this.phase = 'out'; this.t = 0; }
      } else if (this.phase === 'out') {
        const p = Math.min(1, this.t / FADE);
        screen.material.opacity = 1 - p;
        spill.material.opacity = (1 - p) * 0.42;
        if (p >= 1) {
          const slot = this.pending; this.pending = null;
          if (slot) this.install(slot);
          else { this.phase = 'loading'; this.loadNext((s) => { if (s && this.near) this.install(s); else this.phase = 'idle'; }); }
        }
      }
    },
  };
}

/* ═══════════════════ 비밀의 방 챌린지 빌드 (9와 3/4 승강장) ═══════════════════ */
// 시네마 동쪽 벽 포털(표지) → 어두운 통로 안의 레이저 타이밍 점프맵 → 비밀의 방.
function buildSecretEntrance(def) {
  const yBase = def.elevation;
  const cz = (def.zFrom + def.zTo) / 2;
  const wallX = -(def.W / 2 + T / 2);        // 시네마 서쪽(스크린) 벽면 x
  const zS = cz - 3.0, zN = cz + 3.0;        // 통로 z 경계
  const endX = -32.5;                         // 통로 서쪽 끝
  const topY = yBase;                         // 발판/도착 기준 높이
  const pitY = yBase - 4.0;                   // 낙사 바닥
  const ceilY = yBase + WALL_H;

  challenge.bounds = { wallX, endX, zS, zN, cz };
  challenge.pitY = pitY;
  challenge.checkpoint.set(wallX - 1.4, EYE + topY, cz);   // 스크린 통과 직후(서쪽)
  challenge.checkpointYaw = Math.PI / 2;     // -x(서쪽)를 향함
  challenge.roomTrigger = { minX: endX, maxX: -29.2, minZ: zS, maxZ: zN };

  const darkMatL = new THREE.MeshStandardMaterial({ color: 0x14151a, roughness: 0.96, metalness: 0.02, envMapIntensity: 0.2 });
  const platMat = new THREE.MeshStandardMaterial({ color: 0x9c978c, roughness: 0.72, metalness: 0.03,
    emissive: 0x14110c, emissiveIntensity: 0.12, envMapIntensity: 0.3 });

  // 포털(스크린) 콜라이더 — 정답 전에는 막혀 있다. 스크린 자체가 표지 역할.
  addCollider(wallX + 0.06, cz, 0.24, PORTAL_W, def.floor);
  secretPortalColliders.push(colliders[colliders.length - 1]);
  secretPortalMesh = null;   // 벽돌 없이 스크린이 곧 포털 (표지는 화면 하단 라벨)

  /* ── 어두운 통로 외곽(벽·천장·구덩이 바닥) — 스크린 뒤 서쪽으로 뻗는다 ── */
  const midX = (wallX + endX) / 2, corrLen = Math.abs(endX - wallX), corrW = zN - zS;
  wallBox(midX, yBase + WALL_H / 2, zS, corrLen, WALL_H, T, darkMatL, true, def.floor);   // 남쪽 벽
  wallBox(midX, yBase + WALL_H / 2, zN, corrLen, WALL_H, T, darkMatL, true, def.floor);   // 북쪽 벽
  wallBox(endX, yBase + WALL_H / 2, cz, T, WALL_H, corrW + T, darkMatL, true, def.floor); // 서쪽 끝 벽
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(corrLen, corrW), new THREE.MeshBasicMaterial({ color: 0x0c0d10, side: THREE.BackSide }));
  ceil.rotation.x = -Math.PI / 2; ceil.position.set(midX, ceilY - 0.02, cz); scene.add(ceil);
  const pit = new THREE.Mesh(new THREE.BoxGeometry(corrLen, 0.4, corrW), darkMatL);
  pit.position.set(midX, pitY - 0.2, cz); scene.add(pit);

  /* ── 발판 (서쪽으로 계단식) ── */
  const addPlatform = (minX, maxX, minZ, maxZ) => {
    platforms.push({ minX, maxX, minZ, maxZ, topY });
    const thick = 0.32;
    const m = new THREE.Mesh(new THREE.BoxGeometry(maxX - minX, thick, maxZ - minZ), platMat);
    m.position.set((minX + maxX) / 2, topY - thick / 2, (minZ + maxZ) / 2);
    scene.add(m);
  };
  addPlatform(-12.0, wallX, zS + 0.1, zN - 0.1);   // 시작 발판(스크린 벽 뒤 — 극장 바닥으로 튀어나오지 않게)
  const pZ0 = cz - 1.3, pZ1 = cz + 1.3;
  addPlatform(-16.5, -14.3, pZ0, pZ1);
  addPlatform(-20.7, -18.5, pZ0, pZ1);
  addPlatform(-24.9, -22.7, pZ0, pZ1);
  addPlatform(-29.1, -26.9, pZ0, pZ1);
  addPlatform(endX + 0.2, -29.0, zS + 0.1, zN - 0.1);    // 도착(비밀의 방) 바닥

  /* ── 레이저 빔 — 위아래로 부드럽게 움직인다. 높을 때 지나가거나 낮을 때 뛰어넘는다 ── */
  const addLaser = (x, phase, speed) => {
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.14, corrW - 0.1),
      new THREE.MeshBasicMaterial({ color: 0xff2f3d, toneMapped: false }));
    bar.position.set(x, topY + 1.9, cz); bar.renderOrder = 4;
    scene.add(bar);
    // 빔 주변 부드러운 붉은 광 번짐
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(corrW - 0.1, 0.7),
      new THREE.MeshBasicMaterial({ color: 0xff2f3d, transparent: true, opacity: 0.28,
        toneMapped: false, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    glow.rotation.y = Math.PI / 2; glow.position.copy(bar.position); glow.renderOrder = 3;
    scene.add(glow);
    lasers.push({ x, zMin: zS, zMax: zN, baseY: topY, phase, speed, bar, glow });
  };
  [-13.15, -17.5, -21.7, -25.9].forEach((x, i) => addLaser(x, i * 1.15, 1.25 + i * 0.12));

  /* ── 비밀의 방: 명예의 전당(3D 이름 벽) ── */
  hofGroup = new THREE.Group();
  hofGroup.position.set(endX + T / 2 + 0.12, yBase, cz);   // 서쪽 끝 벽면 앞(가려지지 않게)
  hofGroup.rotation.y = Math.PI / 2;   // +x(방 안쪽=플레이어)를 향함
  scene.add(hofGroup);
  renderHallOfFame([]);
}

function renderHallOfFame(entries) {
  if (!hofGroup) return;
  hofGroup.clear();
  const title = textPlane([
    { text: '명예의 전당 · HALL OF FAME', size: 0.22, weight: 700, spacing: 0.05, color: '#f2d675' },
    { text: '비밀의 방 도전 성공자 · クリア者', size: 0.11, color: '#cfc9bb' },
  ], 4.6, 1.0, {});
  title.position.set(0, 3.1, 0);
  hofGroup.add(title);
  const names = entries.slice(0, 12);
  if (!names.length) {
    const empty = textPlane([{ text: '첫 도전자가 되어 보세요 · 最初のクリア者になろう', size: 0.12, color: '#8f8c85' }], 4.4, 0.4, {});
    empty.position.set(0, 2.2, 0); hofGroup.add(empty);
    return;
  }
  names.forEach((e, i) => {
    const label = (e.name || '익명') + (e.school ? '   ·   ' + e.school : '');
    const t = textPlane([{ text: label, size: 0.15, weight: 500, color: '#f0eee9' }], 4.4, 0.34, {});
    t.position.set(0, 2.5 - i * 0.34, 0);
    hofGroup.add(t);
  });
}

/* ═══════════════════ 마스코트 입간판(전신대) ═══════════════════ */
// 요나고미나미 · 설악 두 학교 마스코트를 실물 크기 컷아웃 입간판으로 세운다.
// assets/seolibeoli.png: 정사각(투명 배경), 내용은 하단 정렬(발끝이 이미지 밑변),
// 상단 22%가 여백 → 판 밑변을 바닥에 두면 캐릭터가 바닥에 서 있게 된다.
function buildStandee(x, z, floor, faceX, faceZ, charHeight = 1.5) {
  const yBase = floor * FLOOR_HEIGHT;
  const rotY = Math.atan2(faceX - x, faceZ - z);
  const group = new THREE.Group();
  group.position.set(x, yBase, z);
  group.rotation.y = rotY;
  scene.add(group);

  const CONTENT_FRAC = 390 / 500;          // 세로 내용 비율(측정값)
  const planeH = charHeight / CONTENT_FRAC;
  const planeW = planeH;                    // 정사각 이미지
  const bottomGap = 0.02;

  const tex = new THREE.TextureLoader().load('assets/seolibeoli.png', (t) => {
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  });
  const frontMat = new THREE.MeshStandardMaterial({
    map: tex, transparent: true, alphaTest: 0.5, side: THREE.FrontSide,
    roughness: 0.9, metalness: 0, envMapIntensity: 0.4,
  });
  const cutoutGeo = new THREE.PlaneGeometry(planeW, planeH);
  const cutout = new THREE.Mesh(cutoutGeo, frontMat);
  cutout.position.y = bottomGap + planeH / 2;
  cutout.position.z = 0.006;
  cutout.renderOrder = 2;
  group.add(cutout);

  // 투명 윤곽을 뒤로 여러 겹 쌓아 얇은 합판처럼 보이는 단면과 뒷면을 만든다.
  const standeeDepth = 0.06;
  const edgeLayers = 6;
  const edgeMat = new THREE.MeshStandardMaterial({
    map: tex, color: 0x5a5046, transparent: true, alphaTest: 0.5,
    side: THREE.DoubleSide, roughness: 0.96, metalness: 0,
  });
  for (let i = 1; i <= edgeLayers; i++) {
    const edge = new THREE.Mesh(cutoutGeo, edgeMat);
    edge.position.set(0, bottomGap + planeH / 2, -standeeDepth * i / edgeLayers);
    edge.renderOrder = 1;
    group.add(edge);
  }

  // 받침대(원형)
  const baseR = Math.max(0.44, charHeight * 0.34);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(baseR, baseR + 0.05, 0.07, 28),
    new THREE.MeshStandardMaterial({ color: 0x6f5c47, roughness: 0.6, metalness: 0.05 }));
  base.position.y = 0.035; group.add(base);
  // 뒤쪽 지지대(이젤 다리)
  const strut = new THREE.Mesh(new THREE.BoxGeometry(0.07, charHeight * 0.75, 0.045), darkMat);
  strut.position.set(0, charHeight * 0.38, -0.17);
  strut.rotation.x = -0.26; group.add(strut);
  // 바닥 접지 그림자
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(planeW * 0.92, baseR * 2.5), shadowMat);
  shadow.rotation.x = -Math.PI / 2; shadow.position.set(0, 0.006, 0.05);
  shadow.renderOrder = 2; group.add(shadow);

  addCollider(x, z, baseR * 1.8, baseR * 1.5, floor);
  return group;
}

function buildMuseum(manifest) {
  const byDay = [[], [], [], []];
  for (const it of manifest.items) byDay[it.day - 1].push(it);
  const dayShort = ['7/12', '7/13', '7/14', '7/15'];
  const daySegments = []; // 자동 관람: 날짜별 관람 지점 목록 (1–4)

  // 방 길이: 작품별 필요 폭의 합이 벽면에 여유(6%) 있게 들어가도록 역산한다.
  // 벽면 길이(pad 2.4, pPad 3.4 기준): 서쪽 L-4.8, 가벽 양면 각 L-7.6, 동쪽 L-4.8.
  const SLACK = 1.06;
  const dayDefs = byDay.map((items, i) => {
    const count = items.length;
    const usePartition = count > 34;
    const need = items.reduce((s, it) => s + widthNeedOf(it), 0) * SLACK;
    const L = Math.max(12, Math.ceil(usePartition ? (need + 24.8) / 4 : (need + 9.6) / 2));
    const floor = i < 2 ? 0 : 1;
    return { type: 'hall', day: i + 1, floor, elevation: floor * FLOOR_HEIGHT,
      W: HALL_W, L, need, usePartition, label: `${floor + 1}F · ${biDay(manifest.days[i])}`, items };
  });
  // 2층 영상 상영실(시어터) — 우에다 쇼지 미술관의 영상실 오마주.
  // 전체 사진·영상을 잔잔하게 순환 상영하는 어두운 방. 로비와 Day 4 사이에 둔다.
  const cinemaDef = { type: 'cinema', floor: 1, elevation: FLOOR_HEIGHT,
    W: 14, L: 13, label: '2F · CINEMA · シアター', items: manifest.items };
  // Day 3은 동쪽 벽 일부가 계단 개구부에 잘리므로(동쪽 벽 L-12.6) 그만큼 방을 늘린다.
  if (dayDefs[2].usePartition) {
    dayDefs[2].L = Math.max(dayDefs[2].L, Math.ceil((dayDefs[2].need + 32.6) / 4));
  }
  // Day 2의 동쪽 벽은 계단 위쪽 끝(2층 평면 기준)까지만 사용 가능:
  // eastLen = L1 + L2 − (L3 + L4) − 0.6 이므로 필요 길이를 만족하는 L2를 역산.
  // 2층에 시어터를 끼워 넣어 평면이 길어진 만큼 Day 2도 계단까지 더 늘린다.
  if (dayDefs[1].usePartition) {
    dayDefs[1].L = Math.max(dayDefs[1].L, Math.ceil(
      (dayDefs[1].need + 20.6 + dayDefs[2].L + dayDefs[3].L + cinemaDef.L - dayDefs[0].L) / 4));
  }

  /* ── 1층과 2층을 같은 평면 위에 쌓아 배치 ── */
  // 2층은 Day 2 끝 계단으로 올라온 관람객이 북쪽에서 진입하므로 Day 3을 북쪽, Day 4를 남쪽에 둔다.
  // 전체 동선: 로비 → Day 1 → Day 2 → 계단 → Day 3 → Day 4 → 2층 로비 → 중앙 계단으로 하강.
  const floorDefs = [
    [{ type: 'lobby', floor: 0, elevation: 0, W: 16, L: 14, label: '1F · ENTRANCE HALL' },
      dayDefs[0], dayDefs[1]],
    [{ type: 'lobby', floor: 1, elevation: FLOOR_HEIGHT, upper: true,
       W: 16, L: 14, label: '2F · UPPER HALL' }, cinemaDef, dayDefs[3], dayDefs[2]],
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
  // Day 2 관람 동선의 끝(북쪽)에 계단을 두어 사진을 다 본 뒤 2층으로 오르게 한다.
  // 2층 평면은 1층보다 짧으므로, 랜딩이 2층(Day 3 북쪽 끝) 안에 놓이도록 z를 2층 기준으로 잡는다.
  stairways.length = 1;
  stairways.push({
    // 중앙 관람 통로를 비우고 동쪽 벽 쪽에 계단 전용 영역을 둔다.
    xMin: 3.0, xMax: 5.45,
    zBottom: dayDefs[2].zTo + 9.0,
    zTop: dayDefs[2].zTo + 2.0,
    label: 'NEXT · DAY 3',
    signSide: 'left',
  });

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
    const openings = stairways.map(stairOpening);
    const rects = defs[0].floor === 0
      ? [[-12, 12, fullZMin, fullZMax]]
      : rectsAroundOpenings(-12, 12, fullZMin, fullZMax, openings);
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

  for (const stair of stairways) buildStaircase(stair);

  for (const def of roomDefs) {
    const { W, L, zFrom, zTo } = def;
    const yBase = def.elevation;
    const cz = (zFrom + zTo) / 2;
    const roomGroup = new THREE.Group();
    scene.add(roomGroup);
    def.group = roomGroup;

    const isCinema = def.type === 'cinema';
    // 1층의 각 방 천장에는 겹치는 계단실 개구부를 남긴다. 시어터는 어두운 천장.
    const ceilMat = new THREE.MeshBasicMaterial({
      color: isCinema ? 0x14151a : 0xdedcd7, side: THREE.BackSide });
    const xEdge = W / 2 + T;
    const ceilingOpenings = def.floor === 0 ? stairways.map(stairOpening) : [];
    const ceilingRects = rectsAroundOpenings(-xEdge, xEdge, zTo, zFrom, ceilingOpenings);
    for (const [xa, xb, za, zb] of ceilingRects) {
      const ceil = new THREE.Mesh(new THREE.PlaneGeometry(xb - xa, zb - za), ceilMat);
      ceil.rotation.x = -Math.PI / 2;
      ceil.position.set((xa + xb) / 2, yBase + WALL_H - 0.005, (za + zb) / 2);
      scene.add(ceil);
    }
    if (!isCinema) {
      // 천장 조명 스트립 (자체발광)
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.8, L - 2),
        new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
      strip.rotation.x = Math.PI / 2; strip.position.set(0, yBase + WALL_H - 0.05, cz);
      scene.add(strip);
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(4.5, L - 2), glowMat);
      glow.rotation.x = Math.PI / 2; glow.position.set(0, yBase + WALL_H - 0.28, cz);
      glow.renderOrder = 3; scene.add(glow);
    }

    if (def.type === 'cinema') {
      buildCinema(def, roomGroup);
    } else if (def.type === 'lobby') {
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
        { text: '2026 국제교류 · 国際交流', size: 0.15, color: '#77746e' },
      ] : [
        { text: '요나고미나미고등학교 × 설악고등학교', size: 0.21, weight: 300, spacing: 0.02, color: '#2f2f2d' },
        { text: '米子南高等学校 × 雪嶽高等学校', size: 0.165, weight: 300, spacing: 0.05, color: '#45423e' },
        { text: '2026 국제교류 · 国際交流', size: 0.185, weight: 500, spacing: 0.04, color: '#45423e' },
        { text: 'YONAGO MINAMI HIGH SCHOOL × SEORAK HIGH SCHOOL', size: 0.075, color: '#77746e' },
        { text: '2026. 7. 12 – 15', size: 0.12, color: '#55524d' },
      ];
      const title = textPlane(titleLines, 7, def.upper ? 2.4 : 2.8);
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

        // 외부: 다이센 배경 사진 — 로비와 Day 2 창 모두에서 이어져 보이도록
        // 1층 동쪽 전체(로비~Day 2 남단)를 한 장으로 덮는다. 가로만 늘려 이음매를 없앤다.
        new THREE.TextureLoader().load('assets/backdrop.jpg', (t) => {
          t.colorSpace = THREE.SRGBColorSpace;
          // 유리벽에 바짝 붙어 비스듬히 볼 때도 끝이 드러나지 않게 남북으로 크게 연장한다.
          const zEnd0 = floorDefs[0][floorDefs[0].length - 1].zTo;
          const bpN = zEnd0 - 60, bpS = 30;
          const bp = new THREE.Mesh(new THREE.PlaneGeometry(bpS - bpN, 63),
            new THREE.MeshBasicMaterial({ map: t, fog: true, toneMapped: false }));
          bp.position.set(W / 2 + 58, 2.4, (bpS + bpN) / 2);
          bp.rotation.y = -Math.PI / 2;
          scene.add(bp);
        });

        // 마스코트 입간판 — 입장하는 관람객을 맞이하도록 로비에 세운다.
        buildStandee(-3.4, zFrom - 7, def.floor, 1, zFrom - 2.5, 1.5);
      }

      floorSpawnPoints[def.floor] = new THREE.Vector3(0, yBase + EYE, zFrom - 3);
      if (def.floor === 0) spawnPoint = floorSpawnPoints[0].clone();
    } else {
      // 전시실 좌우 외벽 — 칸막이 벽 중심선까지만 (끝면이 칸막이 내부에 묻히도록, z-fighting 방지)
      const defs = floorDefs[def.floor];
      const extS = (def === defs[defs.length - 1]) ? 0.3 : 0;
      wallBox(-W / 2 - T / 2, yBase + WALL_H / 2, cz - extS / 2, T, WALL_H, L + extS,
        concreteMat(L / 4, WALL_H / 4), true, def.floor);
      // 내측 흰 전시벽 (외벽 안쪽 면에서 2cm 띄움)
      const innerW1 = new THREE.Mesh(new THREE.PlaneGeometry(L, WALL_H), whiteWallMat);
      innerW1.position.set(-W / 2 + 0.02, yBase + WALL_H / 2, cz); innerW1.rotation.y = Math.PI / 2;
      scene.add(innerW1);

      const eastX = W / 2 + T / 2;
      const innerEast = (segCz, segLen) => {
        const p = new THREE.Mesh(new THREE.PlaneGeometry(segLen, WALL_H), whiteWallMat);
        p.position.set(W / 2 - 0.02, yBase + WALL_H / 2, segCz); p.rotation.y = -Math.PI / 2;
        scene.add(p);
      };
      if (def.day === 2) {
        // Day 2 동쪽 벽의 계단 앞 빈 구간은 로비처럼 전면 유리창으로 열어
        // 모래 언덕·수면·다이센 풍경이 들여다보이게 한다 (우에다 미술관 오마주).
        const bayN = stairways[1].zBottom + 1.2;
        const bayS = zFrom - 3.2;
        const bayLen = bayS - bayN;
        const bayCz = (bayN + bayS) / 2;
        // 남북 솔리드 구간
        const nLen = bayN - (zTo - extS);
        wallBox(eastX, yBase + WALL_H / 2, (bayN + zTo - extS) / 2, T, WALL_H, nLen,
          concreteMat(nLen / 4, WALL_H / 4), true, def.floor);
        innerEast((bayN + zTo) / 2, bayN - zTo);
        const sLen = zFrom - bayS;
        wallBox(eastX, yBase + WALL_H / 2, (zFrom + bayS) / 2, T, WALL_H, sLen,
          concreteMat(sLen / 4, WALL_H / 4), true, def.floor);
        innerEast((zFrom + bayS) / 2, sLen);
        // 창: 낮은 콘크리트 턱 + 유리 + 상부 인방
        wallBox(eastX, yBase + 0.375, bayCz, T, 0.75, bayLen,
          concreteMat(bayLen / 4, 0.6), false, def.floor);
        wallBox(eastX, yBase + (3.4 + WALL_H) / 2, bayCz, T, WALL_H - 3.4, bayLen,
          concreteMat(bayLen / 4, 1.2), false, def.floor);
        addCollider(eastX, bayCz, T, bayLen, def.floor);
        const bayGlass = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.65, bayLen),
          new THREE.MeshPhysicalMaterial({ color: 0xdfeef2, transparent: true, opacity: 0.14,
            roughness: 0.05, metalness: 0, side: THREE.DoubleSide }));
        bayGlass.position.set(eastX, yBase + 0.75 + 2.65 / 2, bayCz);
        scene.add(bayGlass);
        const posts = Math.max(2, Math.round(bayLen / 3.5));
        for (let i = 0; i <= posts; i++) {
          wallBox(eastX, yBase + WALL_H / 2, bayN + (bayLen / posts) * i, 0.12, WALL_H, 0.12,
            darkMat, false, def.floor);
        }
        // 외부: 수면과 다이센 배경 (로비 앞 풍경의 연장)
        const bayWater = new THREE.Mesh(new THREE.PlaneGeometry(26, bayLen + 10),
          new THREE.MeshStandardMaterial({ color: 0xb9d3da, roughness: 0.04, metalness: 0.85, envMapIntensity: 1.3 }));
        bayWater.rotation.x = -Math.PI / 2;
        bayWater.position.set(W / 2 + 14, 0.06, bayCz);
        scene.add(bayWater);
      } else {
        wallBox(eastX, yBase + WALL_H / 2, cz - extS / 2, T, WALL_H, L + extS,
          concreteMat(L / 4, WALL_H / 4), true, def.floor);
        innerEast(cz, L);
      }

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
      // 동쪽 벽: 계단실과 겹치는 구간은 비워 둔다.
      // Day 2는 북쪽 끝이 영상 투사 벽이 되므로 계단 바로 앞까지 최대한 길게 쓴다.
      // Day 3(2층)은 계단 개구부 남쪽까지만 사진을 건다.
      const stair2 = stairways[1];
      let eastStart = zTo + pad;
      let eastLen = L - pad * 2;
      if (def.day === 2) {
        eastStart = zTo + 1.6;
        eastLen = (stair2.zTop - 1.0) - eastStart;
      }
      if (def.day === 3) eastLen = (zFrom - pad) - (stair2.zBottom + 1.2);
      lineList.push({
        len: eastLen,
        slot: (t) => ({ x: W / 2 - 0.03, y: yBase + 1.6, z: eastStart + t, rotY: -Math.PI / 2 })
      });

      // 2층 전시실은 계단 랜딩(북쪽)에서 진입하므로 관람 동선을 남북 반전한다.
      if (def.floor === 1) {
        for (const line of lineList) {
          const baseSlot = line.slot;
          line.slot = (t) => { const s = baseSlot(t); s.z = zFrom + zTo - s.z; return s; };
        }
      }

      /* 작품 분배 — 영상은 투사 폭이 넓어 사진보다 넓은 간격이 필요하다 */
      const items = def.items;
      const totalLen = lineList.reduce((s, l) => s + l.len, 0);
      const totalNeed = items.reduce((s, it) => s + widthNeedOf(it), 0);
      const scale = totalLen / totalNeed;
      let assigned = 0;
      const lineStops = lineList.map(() => []); // 자동 관람: 라인별 감상 지점
      lineList.forEach((line, li) => {
        const isLast = li === lineList.length - 1;
        const placed = [];
        let cum = 0;
        while (assigned + placed.length < items.length) {
          const item = items[assigned + placed.length];
          const w = widthNeedOf(item) * scale;
          if (!isLast && cum + w > line.len + 0.01) break;
          placed.push({ item, center: cum + w / 2 });
          cum += w;
        }
        // 마지막 라인이 넘치면 압축하고, 남으면 가운데 정렬한다.
        const squeeze = cum > line.len ? line.len / cum : 1;
        const offset = Math.max(0, (line.len - cum) / 2);
        placed.forEach(({ item, center }, k) => {
          const art = createArtwork(item, rooms.length, assigned + k + 1, dayShort[def.day - 1]);
          art.floor = def.floor;
          // 실제 영상 화면비가 manifest와 달라도 옆 작품을 침범하지 않도록 슬롯 폭을 기억한다.
          art.slotW = widthNeedOf(item) * scale * squeeze;
          fitArtworkToAspect(art, art.aspect);
          const slot = line.slot(squeeze < 1 ? center * squeeze : offset + center);
          placeArtwork(art, slot);
          roomGroup.add(art.group);
          // 감상 지점: 벽면 법선 방향으로 물러난 위치 (영상은 화면이 커서 더 멀리)
          const viewDist = art.isVideo ? 3.2 : 2.2;
          lineStops[li].push({
            x: slot.x + Math.sin(slot.rotY) * viewDist,
            z: slot.z + Math.cos(slot.rotY) * viewDist,
            floor: def.floor, art,
          });
        });
        assigned += placed.length;
      });
      // 자동 관람 경로 조립: 가벽 서→동 면으로 넘어갈 때는 가벽 끝을 돌아간다.
      const seg = [];
      let prevLi = -1;
      lineList.forEach((line, li) => {
        const stops = lineStops[li];
        if (!stops.length) return;
        if (def.usePartition && prevLi === 1 && li === 2 && seg.length) {
          const prev = seg[seg.length - 1];
          seg.push({ x: 0, z: prev.z + Math.sign(prev.z - cz) * 1.9, floor: def.floor });
        }
        seg.push(...stops);
        prevLi = li;
      });
      daySegments[def.day] = seg;

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

  /* ── 자동 관람 전체 경로 ──
     1F 로비 → Day 1 → Day 2 → 계단(동측) → Day 3 → Day 4 → 2F 로비 → 중앙 계단 하강 → 반복.
     문과 계단 앞뒤에 경유지를 두어 가벽·난간 충돌체를 피해 다닌다. */
  const s2 = stairways[1], s1 = PRIMARY_STAIR;
  const sx2 = (s2.xMin + s2.xMax) / 2, sx1 = (s1.xMin + s1.xMax) / 2;
  const wp = (x, z, floor) => ({ x, z, floor });
  tourStops.length = 0;
  tourStops.push(
    // 1F 로비 → Day 1 입구
    wp(0, dayDefs[0].zFrom + 1.3, 0), wp(0, dayDefs[0].zFrom - 1.3, 0),
    ...daySegments[1],
    // Day 1 → Day 2 (동측 통로로 북상 후 중앙 문 통과)
    wp(2.9, dayDefs[0].zTo + 1.8, 0), wp(0, dayDefs[0].zTo + 1.2, 0), wp(0, dayDefs[0].zTo - 1.3, 0),
    ...daySegments[2],
    // Day 2 → 계단: 난간 서쪽으로 돌아 계단 하단으로 간 뒤 올라간다
    wp(1.5, s2.zTop - 1.0, 0), wp(1.5, s2.zBottom + 1.1, 0),
    wp(sx2, s2.zBottom + 0.85, 0), wp(sx2, s2.zTop - 1.1, 1),
    ...daySegments[3],
    // Day 3 → Day 4 (2층, 남쪽 문)
    wp(2.9, dayDefs[2].zFrom - 1.8, 1), wp(0, dayDefs[2].zFrom - 1.2, 1), wp(0, dayDefs[2].zFrom + 1.3, 1),
    ...daySegments[4],
    // Day 4 → 시어터(상영실): 남쪽 문으로 들어가 좌석 뒤(동측)에서 스크린을 감상
    wp(0, dayDefs[3].zFrom - 1.1, 1), wp(0, dayDefs[3].zFrom + 1.2, 1),
    wp(5.0, dayDefs[3].zFrom + 1.4, 1),
    { x: 5.5, z: cinemaInfo.cz, floor: 1, dwell: 45, look: cinemaInfo.screen },
    // 시어터 → 2F 로비: 좌석 남측으로 빠져 중앙 통로 → 남쪽 문
    wp(5.2, -0.5, 1), wp(0, -0.5, 1), wp(0, cinemaDef.zFrom + 1.3, 1),
    // 2F 로비 → 중앙 계단으로 1층 하강
    wp(sx1, s1.zTop - 0.8, 1), wp(sx1, s1.zBottom + 0.9, 0),
    // 난간을 피해 서쪽으로 빠져나와 처음(Day 1 입구)으로 순환
    wp(1.5, s1.zBottom + 1.2, 0)
  );

  // 비밀의 방 챌린지(9와 3/4 승강장) — 시네마 동쪽 벽 뒤에 짓는다.
  buildSecretEntrance(cinemaDef);
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

const AUTO_CANCEL_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'];
document.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'Space') e.preventDefault();
  if (!e.repeat && controlsActive && !viewerOpen && (e.code === 'Digit1' || e.code === 'Digit2')) {
    switchFloor(e.code === 'Digit1' ? 0 : 1);
  }
  if (controlsActive && !viewerOpen && autoTour.active && AUTO_CANCEL_KEYS.includes(e.code)) {
    stopAutoTour();
    if (!IS_TOUCH && !document.pointerLockElement) lockPointer(); // 직접 조작으로 복귀
  }
  if (!e.repeat && controlsActive && !viewerOpen && e.code === 'KeyT') {
    autoTour.active ? stopAutoTour() : startAutoTour();
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

// 하단 안내: 잠시 보여준 뒤 서서히 사라진다.
let hintFadeTimer = 0;
function showHint(html) {
  hintEl.style.transition = '';
  hintEl.style.opacity = '1';
  hintEl.innerHTML = html;
  clearTimeout(hintFadeTimer);
  hintFadeTimer = setTimeout(() => {
    hintEl.style.transition = 'opacity 2s';
    hintEl.style.opacity = '0';
  }, 5000);
}

function updateFloorNav(floor) {
  for (const button of floorNavEl.querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(Number(button.dataset.floor) === floor));
  }
}

function stairProgressAt(x, z) {
  const margin = 0.2;
  for (const stair of stairways) {
    if (x < stair.xMin - margin || x > stair.xMax + margin
        || z > stair.zBottom + margin || z < stair.zTop - margin) continue;
    return Math.max(0, Math.min(1,
      (stair.zBottom - z) / (stair.zBottom - stair.zTop)));
  }
  return null;
}

function switchFloor(floor, announce = true) {
  const target = floorSpawnPoints[floor];
  if (!target || player.floor === floor && player.pos.distanceToSquared(target) < 0.01) return;
  if (autoTour.active) stopAutoTour(true); // 층 바로 이동은 수동 조작이므로 자동 관람 해제
  player.floor = floor;
  player.pos.copy(target);
  player.velY = 0; player.onGround = true;
  camera.position.copy(player.pos);
  camera.rotation.set(player.pitch, player.yaw, 0);
  updateFloorNav(floor);
  lastRoomCheck = -1e9;
  updateRooms(performance.now());
  if (announce) {
    showHint(floor === 0
      ? '1층 · Day 1–2 전시<br>1階 · Day 1–2 展示'
      : '2층 · Day 3–4 전시<br>2階 · Day 3–4 展示');
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
    else if (wasLocked && !viewerOpen && !autoTour.active) {
      // 락 해제(ESC) → 시작 화면으로 (자동 관람 중에는 락 없이 계속 관람)
      controlsActive = false;
      startEl.classList.remove('hidden');
      startEl.setAttribute('aria-hidden', 'false');
      startEl.inert = false;
      touchUIEl.setAttribute('aria-hidden', 'true');
      btnJump.disabled = true; btnRun.disabled = true;
      enterBtn.textContent = '3D 계속 · 続ける';
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
  if (autoTour.active && drag.moved > 24) stopAutoTour(); // 시점 조작 → 자동 관람 해제
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
        if (autoTour.active) stopAutoTour(); // 조이스틱 조작 → 자동 관람 해제
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
        if (autoTour.active && look.moved > 24) stopAutoTour(); // 시점 드래그 → 자동 관람 해제
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

/* ═══════════════════ 배경 음악 ═══════════════════ */
// 두 곡(assets/bgm.mp3, assets/bhm3.mp3)을 번갈아 무한 반복 재생. 없으면 버튼도 나타나지 않는다.
const BGM_VOLUME = 0.14;
const BGM_TRACKS = ['assets/bgm.mp3', 'assets/bhm3.mp3'];
const bgmBtn = document.getElementById('bgmBtn');
let bgmTrack = 0;
const bgm = new Audio(BGM_TRACKS[0]);
bgm.loop = false;   // 한 곡이 끝나면 다음 곡으로 넘어간다(아래 'ended' 참조)
bgm.preload = 'auto'; bgm.volume = 0;
let bgmAvailable = false, bgmOn = false, bgmTarget = 0;
bgm.addEventListener('canplaythrough', () => {
  bgmAvailable = true;
  document.body.classList.add('has-bgm');
  // 음원이 늦게 준비돼도 이미 입장해 있으면 바로 시작한다.
  if (document.body.classList.contains('playing')) startBgm();
}, { once: true });
// 곡이 끝나면 다음 곡으로 전환해 두 곡을 순환 재생한다.
bgm.addEventListener('ended', () => {
  bgmTrack = (bgmTrack + 1) % BGM_TRACKS.length;
  bgm.src = BGM_TRACKS[bgmTrack]; bgm.load();
  if (bgmOn) bgm.play().catch(() => {});
});
bgm.addEventListener('error', () => {
  if (!bgmAvailable) return;   // 초기 로드 실패 → BGM 비활성
  // 재생 중 특정 곡 오류 → 다음 곡으로 건너뛴다
  bgmTrack = (bgmTrack + 1) % BGM_TRACKS.length;
  bgm.src = BGM_TRACKS[bgmTrack]; bgm.load();
  if (bgmOn) bgm.play().catch(() => {});
});

function startBgm() {
  if (!bgmAvailable || bgmOn) return;
  bgmOn = true; bgmTarget = BGM_VOLUME;
  bgm.play().catch(() => { bgmOn = false; bgmTarget = 0; });
  bgmBtn.setAttribute('aria-pressed', 'true');
}
function stopBgm() {
  bgmOn = false; bgmTarget = 0;
  bgmBtn.setAttribute('aria-pressed', 'false');
}
bgmBtn.addEventListener('click', () => (bgmOn ? stopBgm() : startBgm()));

// 페이드 인·아웃과 뷰어 영상 감상 중 자동 덕킹(볼륨 낮춤)
function updateBgm(dt) {
  if (!bgmAvailable) return;
  const ducked = viewerOpen && viewerBody.querySelector('video');
  const target = bgmTarget * (ducked ? 0.2 : 1);
  bgm.volume = Math.max(0, Math.min(1, bgm.volume + (target - bgm.volume) * Math.min(1, dt * 1.6)));
  if (!bgmOn && bgm.volume < 0.004 && !bgm.paused) bgm.pause();
}

/* ═══════════════════ 자동 관람 모드 ═══════════════════ */
// 관람 동선을 따라 아주 천천히 이동하며 작품마다 멈춰 감상한다. 조작하면 해제.
const autoTour = { active: false, idx: 0, wait: 0, stuck: 0 };
const autoBtn = document.getElementById('autoBtn');
const autoEnterBtn = document.getElementById('autoEnterBtn');

function angleLerp(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function setAutoButtonUI() {
  autoBtn.setAttribute('aria-pressed', String(autoTour.active));
  autoBtn.textContent = autoTour.active ? '⏸ 자동 · 自動' : '▶ 자동 · 自動';
}

function startAutoTour() {
  if (!tourStops.length || autoTour.active) return;
  // 현재 위치에서 가장 가까운(같은 층) 지점부터 이어서 관람한다.
  let best = 0, bestD = Infinity;
  tourStops.forEach((s, i) => {
    if (s.floor !== player.floor) return;
    const d = (s.x - player.pos.x) ** 2 + (s.z - player.pos.z) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  });
  autoTour.active = true;
  autoTour.idx = best; autoTour.wait = 0; autoTour.stuck = 0;
  setAutoButtonUI();
  if (document.pointerLockElement) document.exitPointerLock(); // 자동 관람 중에는 마우스 락 불필요
  showHint('자동 관람 중 · 조작하면 해제됩니다<br>自動観覧中 · 操作すると解除されます');
}

function stopAutoTour(silent = false) {
  if (!autoTour.active) return;
  autoTour.active = false;
  setAutoButtonUI();
  if (!silent) showHint('자동 관람 해제 · 自動観覧を解除しました');
}

function updateAutoTour(dt) {
  const stop = tourStops[autoTour.idx];
  if (!stop) { stopAutoTour(true); return; }
  const dx = stop.x - player.pos.x, dz = stop.z - player.pos.z;
  const dist = Math.hypot(dx, dz);
  let targetYaw = player.yaw, targetPitch = 0;

  const dwells = stop.art || stop.dwell;   // 감상하며 멈추는 지점인가
  if (dist <= (dwells ? 0.15 : 0.5)) {
    if (dwells) {
      autoTour.wait += dt;
      const need = stop.dwell || (stop.art.isVideo ? AUTO_DWELL_VIDEO : AUTO_DWELL_PHOTO);
      if (autoTour.wait >= need) {
        autoTour.wait = 0;
        autoTour.idx = (autoTour.idx + 1) % tourStops.length;
      }
    } else {
      autoTour.idx = (autoTour.idx + 1) % tourStops.length;
    }
  } else {
    const step = Math.min(dist, AUTO_SPEED * dt);
    const px = player.pos.x, pz = player.pos.z;
    player.pos.x += dx / dist * step;
    player.pos.z += dz / dist * step;
    resolveCollisions();
    // 안전장치: 벽에 걸려 2.5초 이상 못 움직이면 목표 지점으로 옮긴다.
    const moved = Math.hypot(player.pos.x - px, player.pos.z - pz);
    if (step > 1e-6 && moved < step * 0.25) {
      autoTour.stuck += dt;
      if (autoTour.stuck > 2.5) {
        player.pos.x = stop.x; player.pos.z = stop.z;
        player.floor = stop.floor;
        player.pos.y = EYE + player.floor * FLOOR_HEIGHT;
        player.velY = 0;
        updateFloorNav(player.floor);
        autoTour.stuck = 0;
      }
    } else autoTour.stuck = 0;
    targetYaw = Math.atan2(-dx, -dz); // 걷는 방향을 바라본다
  }
  // 작품·스크린 근처에서는 그쪽으로 시선을 돌린다.
  const lookAt = stop.art ? stop.art.pos : stop.look;
  if (lookAt && dist < (stop.look ? 6.5 : 2.4)) {
    const ax = lookAt.x - player.pos.x, az = lookAt.z - player.pos.z;
    const ah = Math.hypot(ax, az);
    if (ah > 1e-4) {
      targetYaw = Math.atan2(-ax, -az);
      targetPitch = Math.atan2(lookAt.y - player.pos.y, ah);
    }
  }
  const t = Math.min(1, dt * 2.2);
  player.yaw = angleLerp(player.yaw, targetYaw, t);
  player.pitch += (targetPitch - player.pitch) * t;
}

autoBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  autoTour.active ? stopAutoTour() : startAutoTour();
});

/* 입장 버튼 */
function enterMuseum(auto = false) {
  startBgm(); // 사용자 제스처 시점이라 자동재생 정책에 걸리지 않는다.
  document.body.classList.add('playing');
  startEl.classList.add('hidden');
  startEl.setAttribute('aria-hidden', 'true');
  startEl.inert = true;
  crosshairEl.style.display = IS_TOUCH ? 'none' : 'block';
  roomLabelEl.style.display = 'block';
  hintEl.style.display = 'block';
  showHint(IS_TOUCH
    ? '사진을 탭하면 크게 볼 수 있습니다<br>写真をタップすると拡大できます'
    : '사진을 클릭하면 크게 볼 수 있습니다<br>写真をクリックすると拡大できます');
  controlsActive = true;
  touchUIEl.setAttribute('aria-hidden', String(!IS_TOUCH));
  btnJump.disabled = !IS_TOUCH; btnRun.disabled = !IS_TOUCH;
  if (auto) startAutoTour();
  else if (!IS_TOUCH) lockPointer();
}
enterBtn.addEventListener('click', () => enterMuseum(false));
autoEnterBtn.addEventListener('click', () => enterMuseum(true));

/* ═══════════════════ 사진 확대 뷰어 ═══════════════════ */
const viewerEl = document.getElementById('viewer');
const viewerBody = document.getElementById('viewerBody');
const viewerCap = document.getElementById('viewerCap');
const viewerCloseBtn = document.getElementById('viewerClose');
const viewerLike = document.getElementById('viewerLike');
const viewerLikeCount = document.getElementById('viewerLikeCount');
const photoCommentForm = document.getElementById('photoCommentForm');
const photoCommentName = document.getElementById('photoCommentName');
const photoCommentSchool = document.getElementById('photoCommentSchool');
const photoCommentMessage = document.getElementById('photoCommentMessage');
const photoCommentCount = document.getElementById('photoCommentCount');
const photoCommentSubmit = document.getElementById('photoCommentSubmit');
const photoCommentStatus = document.getElementById('photoCommentStatus');
const photoCommentMode = document.getElementById('photoCommentMode');
const photoCommentList = document.getElementById('photoCommentList');
const photoCommentEmpty = document.getElementById('photoCommentEmpty');
let viewerOpen = false;
let controlsBeforeViewer = false;
let viewerReturnFocus = null;

/* ── 사진/영상 좋아요 ── */
// 파일 경로(쿼리 제외)를 안정적인 문서 ID로 사용한다.
function photoIdOf(art) {
  return String(art.item.file).split('?')[0].replace(/[^a-zA-Z0-9]+/g, '_');
}
const likeCountById = Object.create(null);
const likeCountRequestedIds = new Set();

function updateLikeCountEverywhere(id, count) {
  const value = Math.max(0, count | 0);
  likeCountById[id] = value;
  likeCountRequestedIds.add(id);
  for (const art of artworks) {
    if (photoIdOf(art) === id) setArtworkLikeCount(art, value, true);
  }
}

function load3DLikeCountsFor(arts) {
  const ids = [...new Set(arts.map(photoIdOf).filter((id) => !likeCountRequestedIds.has(id)))];
  if (!ids.length) return;
  ids.forEach((id) => likeCountRequestedIds.add(id));
  Social.initSocial()
    .then(() => Social.getLikeCounts(ids))
    .then((counts) => {
      Object.assign(likeCountById, counts);
      for (const art of arts) setArtworkLikeCount(art, counts[photoIdOf(art)] | 0, true);
    })
    .catch((err) => {
      console.warn('3D 좋아요 수 불러오기 실패', err);
    });
}
let likeUnsub = null;
let likeBusy = false;
let currentLikeId = null;
function refreshLikeHeart(id) {
  viewerLike.setAttribute('aria-pressed', String(Social.hasLiked(id)));
}
function bindLike(art) {
  const id = photoIdOf(art);
  currentLikeId = id;
  refreshLikeHeart(id);
  viewerLikeCount.textContent = '·';
  if (likeUnsub) { likeUnsub(); likeUnsub = null; }
  viewerLike.onclick = async () => {
    if (likeBusy) return;
    likeBusy = true; viewerLike.disabled = true;
    const willLike = !Social.hasLiked(id);
    try {
      await Social.initSocial();          // Firebase 지연 로딩(최초 1회)
      await Social.toggleLike(id);
      refreshLikeHeart(id);
      // 낙관적 카운트 갱신 (로컬 모드엔 실시간 콜백이 없고, Firebase는 스냅샷이 곧 확정한다)
      const cur = parseInt(viewerLikeCount.textContent, 10);
      if (Number.isFinite(cur)) {
        const next = Math.max(0, cur + (willLike ? 1 : -1));
        viewerLikeCount.textContent = String(next);
        updateLikeCountEverywhere(id, next);
      }
    } catch (err) { console.warn('좋아요 실패', err); }
    finally { likeBusy = false; viewerLike.disabled = false; }
  };
  // Firebase는 필요할 때 로드한다. 준비되면 실시간 좋아요 수를 구독한다.
  Social.initSocial().then(() => {
    if (!viewerOpen || currentLikeId !== id) return;   // 그 사이 뷰어가 닫히거나 바뀜
    likeUnsub = Social.watchLikes(id, (count) => {
      updateLikeCountEverywhere(id, count);
      if (currentLikeId === id) viewerLikeCount.textContent = count;
    });
  });
}
function unbindLike() {
  currentLikeId = null;
  if (likeUnsub) { likeUnsub(); likeUnsub = null; }
  viewerLike.onclick = null;
}

/* ── 사진/영상별 코멘트 ── */
let commentUnsub = null;
let currentCommentPhotoId = null;
let commentOpenSeq = 0;

function renderPhotoComments(entries) {
  photoCommentList.replaceChildren();
  photoCommentEmpty.hidden = entries.length > 0;
  for (const entry of entries) {
    const li = document.createElement('li');
    const head = document.createElement('div'); head.className = 'photoCommentHead';
    const name = document.createElement('span'); name.className = 'photoCommentName';
    name.textContent = entry.name || '익명 · 匿名'; head.appendChild(name);
    if (entry.school) {
      const school = document.createElement('span'); school.className = 'photoCommentSchool';
      school.textContent = entry.school; head.appendChild(school);
    }
    const time = document.createElement('span'); time.className = 'photoCommentTime';
    time.textContent = fmtTime(entry.createdAt); head.appendChild(time);
    const message = document.createElement('div'); message.className = 'photoCommentMessage';
    message.textContent = entry.message;
    li.append(head, message); photoCommentList.appendChild(li);
  }
}

async function bindPhotoComments(art) {
  const id = photoIdOf(art);
  const seq = ++commentOpenSeq;
  currentCommentPhotoId = id;
  if (commentUnsub) { commentUnsub(); commentUnsub = null; }
  photoCommentList.replaceChildren();
  photoCommentEmpty.hidden = true;
  photoCommentStatus.className = '';
  photoCommentStatus.textContent = '';
  photoCommentMode.textContent = '연결하는 중… · 接続中…';
  photoCommentSubmit.disabled = true;
  await Social.initSocial();
  if (!viewerOpen || currentCommentPhotoId !== id || seq !== commentOpenSeq) return;
  photoCommentMode.textContent = Social.photoCommentsAreShared()
    ? '이 사진을 연 동안만 최근 코멘트를 불러옵니다 · この写真だけ読み込みます'
    : '지금은 이 기기에만 저장됩니다 · この端末のみに保存中';
  commentUnsub = Social.watchPhotoComments(id, renderPhotoComments);
  photoCommentSubmit.disabled = false;
}

function unbindPhotoComments() {
  commentOpenSeq++;
  currentCommentPhotoId = null;
  if (commentUnsub) { commentUnsub(); commentUnsub = null; }
  photoCommentSubmit.disabled = true;
}

photoCommentMessage.addEventListener('input', () => {
  photoCommentCount.textContent = `${photoCommentMessage.value.length} / 300`;
});

photoCommentForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = currentCommentPhotoId;
  if (!id || !photoCommentMessage.value.trim()) {
    photoCommentStatus.className = 'warn';
    photoCommentStatus.textContent = '코멘트를 입력해 주세요 · コメントを入力してください';
    return;
  }
  const wait = Social.postCooldownLeft();
  if (wait > 0) {
    photoCommentStatus.className = 'warn';
    photoCommentStatus.textContent = `잠시 후 다시 시도해 주세요 (${Math.ceil(wait / 1000)}초) · 少し待ってから`;
    return;
  }
  photoCommentSubmit.disabled = true;
  try {
    await Social.initSocial();
    await Social.addPhotoComment({
      photoId: id,
      name: photoCommentName.value,
      school: photoCommentSchool.value,
      message: photoCommentMessage.value,
    });
    photoCommentMessage.value = '';
    photoCommentCount.textContent = '0 / 300';
    photoCommentStatus.className = '';
    photoCommentStatus.textContent = '코멘트를 남겼습니다 · コメントを投稿しました';
    if (!Social.photoCommentsAreShared() && currentCommentPhotoId === id) {
      if (commentUnsub) commentUnsub();
      commentUnsub = Social.watchPhotoComments(id, renderPhotoComments);
    }
  } catch (err) {
    photoCommentStatus.className = 'warn';
    photoCommentStatus.textContent = err.message === 'COOLDOWN'
      ? '잠시 후 다시 시도해 주세요 · 少し待ってから'
      : '저장에 실패했습니다 · 保存に失敗しました';
    console.warn('사진 코멘트 저장 실패', err);
  } finally {
    if (currentCommentPhotoId === id) photoCommentSubmit.disabled = false;
  }
});

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
    v.setAttribute('aria-label', `${art.dayLabel} 영상·映像 No.${String(art.idxInDay).padStart(3, '0')}`);
    viewerBody.appendChild(v);
  } else {
    const im = document.createElement('img');
    im.src = art.item.file;
    im.alt = `${art.dayLabel} 사진·写真 No.${String(art.idxInDay).padStart(3, '0')}`;
    viewerBody.appendChild(im);
  }
  viewerCap.textContent = `${art.dayLabel}  ·  No.${String(art.idxInDay).padStart(3, '0')}`;
  bindLike(art);
  viewerEl.classList.add('show');
  viewerEl.setAttribute('aria-hidden', 'false');
  bindPhotoComments(art);
  viewerCloseBtn.focus();
}
function closeViewer() {
  viewerOpen = false;
  unbindLike();
  unbindPhotoComments();
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
  if (!IS_TOUCH && controlsActive && !autoTour.active) lockPointer();
  else if (viewerReturnFocus && typeof viewerReturnFocus.focus === 'function') viewerReturnFocus.focus();
  viewerReturnFocus = null;
}
viewerCloseBtn.addEventListener('click', closeViewer);
viewerEl.addEventListener('click', (e) => { if (e.target === viewerEl) closeViewer(); });
document.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && viewerOpen) { e.preventDefault(); closeViewer(); return; }
  if (e.code !== 'Tab' || !viewerOpen) return;
  const focusable = [...viewerEl.querySelectorAll('button, input, select, textarea, video[controls]')]
    .filter((el) => !el.disabled);
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
  const filterDefs = [{ day: 0, label: '전체 · すべて' }, ...manifest.days.map((label, i) => ({
    day: i + 1, label: `${i < 2 ? '1F' : '2F'} · ${biDay(label)}`,
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
    image.alt = `${art.dayLabel} ${art.isVideo ? '영상·映像' : '사진·写真'} No.${String(art.idxInDay).padStart(3, '0')}`;
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

/* ═══════════════════ 방명록 ═══════════════════ */
const guestbookBtn = document.getElementById('guestbookBtn');
const guestbookHudBtn = document.getElementById('guestbookHudBtn');
const guestbookPanel = document.getElementById('guestbookPanel');
const guestbookClose = document.getElementById('guestbookClose');
const guestbookForm = document.getElementById('guestbookForm');
const guestbookList = document.getElementById('guestbookList');
const gbName = document.getElementById('gbName');
const gbMessage = document.getElementById('gbMessage');
const gbSubmit = document.getElementById('gbSubmit');
const gbCount = document.getElementById('gbCount');
const gbStatus = document.getElementById('gbStatus');
const gbMode = document.getElementById('gbMode');
const gbEmpty = document.getElementById('gbEmpty');
let gbReturnFocus = null, gbFromStart = true, gbControlsBefore = false, gbUnsub = null;
let gbOpenSeq = 0;

function fmtTime(ms) {
  const d = new Date(ms); const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 사용자 입력은 textContent로만 넣어 XSS를 원천 차단한다.
function renderGuestbook(entries) {
  guestbookList.replaceChildren();
  gbEmpty.hidden = entries.length > 0;
  for (const e of entries) {
    const li = document.createElement('li');
    const head = document.createElement('div'); head.className = 'gbEntryHead';
    const name = document.createElement('span'); name.className = 'gbEntryName';
    name.textContent = e.name || '익명 · 匿名'; head.appendChild(name);
    if (e.badge === 'secret') {
      const badge = document.createElement('span'); badge.className = 'gbBadge';
      badge.textContent = '🏆 기네스북 · クリア'; head.appendChild(badge);
    }
    if (e.school) {
      const sc = document.createElement('span'); sc.className = 'gbEntrySchool';
      sc.textContent = e.school; head.appendChild(sc);
    }
    const time = document.createElement('span'); time.className = 'gbEntryTime';
    time.textContent = fmtTime(e.createdAt); head.appendChild(time);
    const msg = document.createElement('div'); msg.className = 'gbEntryMsg';
    msg.textContent = e.message;
    li.append(head, msg); guestbookList.appendChild(li);
  }
}

async function openGuestbook() {
  const openSeq = ++gbOpenSeq;
  gbReturnFocus = document.activeElement;
  gbFromStart = !startEl.classList.contains('hidden');
  gbControlsBefore = controlsActive;
  controlsActive = false;
  if (document.pointerLockElement) document.exitPointerLock();
  if (gbFromStart) { startEl.setAttribute('aria-hidden', 'true'); startEl.inert = true; }
  touchUIEl.setAttribute('aria-hidden', 'true');
  guestbookPanel.hidden = false;
  guestbookPanel.setAttribute('aria-hidden', 'false');
  if (gbUnsub) { gbUnsub(); gbUnsub = null; }
  gbSubmit.disabled = true;
  gbMode.textContent = '방명록에 연결하는 중… · ゲストブックに接続中…';
  guestbookClose.focus();

  await Social.initSocial();
  if (guestbookPanel.hidden || openSeq !== gbOpenSeq) return;
  gbMode.textContent = Social.getMode() === 'firebase'
    ? '모든 관람객과 실시간으로 공유됩니다 · みんなとリアルタイムで共有されます'
    : '지금은 이 브라우저에만 저장됩니다 · この端末のみに保存中';
  gbUnsub = Social.watchGuestbook(renderGuestbook);
  gbSubmit.disabled = false;
}

function closeGuestbook() {
  gbOpenSeq++;
  if (gbUnsub) { gbUnsub(); gbUnsub = null; }
  guestbookPanel.hidden = true;
  guestbookPanel.setAttribute('aria-hidden', 'true');
  if (gbFromStart) { startEl.setAttribute('aria-hidden', 'false'); startEl.inert = false; }
  else { controlsActive = gbControlsBefore; if (!IS_TOUCH && controlsActive && !autoTour.active) lockPointer(); }
  if (gbReturnFocus && typeof gbReturnFocus.focus === 'function') gbReturnFocus.focus();
  gbReturnFocus = null;
}

gbMessage.addEventListener('input', () => { gbCount.textContent = `${gbMessage.value.length} / 500`; });

guestbookForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = gbName.value;
  const school = guestbookForm.querySelector('input[name="gbSchool"]:checked')?.value || '';
  const message = gbMessage.value;
  if (!message.trim()) {
    gbStatus.className = 'warn';
    gbStatus.textContent = '메시지를 입력해 주세요 · メッセージを入力してください';
    return;
  }
  const wait = Social.postCooldownLeft();
  if (wait > 0) {
    gbStatus.className = 'warn';
    gbStatus.textContent = `잠시 후 다시 시도해 주세요 (${Math.ceil(wait / 1000)}초) · 少し待ってから`;
    return;
  }
  gbSubmit.disabled = true;
  try {
    await Social.initSocial();
    await Social.addGuestbookEntry({ name, school, message });
    gbMessage.value = ''; gbCount.textContent = '0 / 500';
    gbStatus.className = '';
    gbStatus.textContent = '남겨 주셔서 감사합니다 · ありがとうございました';
    // 로컬 모드는 실시간 스냅샷이 없으므로 목록을 즉시 다시 불러온다.
    if (Social.getMode() !== 'firebase') {
      if (gbUnsub) gbUnsub();
      gbUnsub = Social.watchGuestbook(renderGuestbook);
    }
  } catch (err) {
    gbStatus.className = 'warn';
    gbStatus.textContent = err.message === 'COOLDOWN'
      ? '잠시 후 다시 시도해 주세요 · 少し待ってから'
      : '저장에 실패했습니다 · 保存に失敗しました';
    console.warn('방명록 저장 실패', err);
  } finally {
    gbSubmit.disabled = false;
  }
});

guestbookBtn.addEventListener('click', openGuestbook);
guestbookHudBtn.addEventListener('click', (e) => { e.stopPropagation(); openGuestbook(); });
guestbookClose.addEventListener('click', closeGuestbook);
guestbookPanel.addEventListener('keydown', (e) => {
  if (e.code === 'Escape') { e.preventDefault(); closeGuestbook(); }
});

/* ═══════════════════ 비밀의 방 챌린지: 퀴즈 · 보상 UI ═══════════════════ */
const quizPanel = document.getElementById('quizPanel');
const quizClose = document.getElementById('quizClose');
const quizWarn = document.getElementById('quizWarn');
const quizQuestion = document.getElementById('quizQuestion');
const quizOptions = document.getElementById('quizOptions');
const quizStatus = document.getElementById('quizStatus');
let quizOpen = false, quizReturnFocus = null, quizControlsBefore = false;

function openQuiz() {
  if (quizOpen) return;
  quizOpen = true;
  quizReturnFocus = document.activeElement;
  quizControlsBefore = controlsActive;
  controlsActive = false;
  if (document.pointerLockElement) document.exitPointerLock();
  touchUIEl.setAttribute('aria-hidden', 'true'); touchUIEl.inert = true;
  quizWarn.innerHTML = SECRET_QUIZ.redWarning || '';
  quizQuestion.innerHTML = SECRET_QUIZ.question;
  quizStatus.className = ''; quizStatus.textContent = '';
  quizOptions.replaceChildren();
  SECRET_QUIZ.options.forEach((opt, i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = opt;
    b.addEventListener('click', () => answerQuiz(i, b));
    quizOptions.appendChild(b);
  });
  quizPanel.hidden = false;
  quizPanel.setAttribute('aria-hidden', 'false');
  quizClose.focus();
  showHint(SECRET_QUIZ.gateHint);
}

function closeQuiz() {
  if (!quizOpen) return;
  quizOpen = false;
  quizPanel.hidden = true;
  quizPanel.setAttribute('aria-hidden', 'true');
  controlsActive = quizControlsBefore;
  touchUIEl.inert = !controlsActive;
  touchUIEl.setAttribute('aria-hidden', controlsActive ? 'false' : 'true');
  if (!IS_TOUCH && controlsActive && !autoTour.active) lockPointer();
  else if (quizReturnFocus && typeof quizReturnFocus.focus === 'function') quizReturnFocus.focus();
  quizReturnFocus = null;
}

function answerQuiz(i, btn) {
  for (const bt of quizOptions.querySelectorAll('button')) bt.disabled = true;
  if (i === SECRET_QUIZ.answer) {
    quizStatus.className = ''; quizStatus.textContent = SECRET_QUIZ.correct;
    setTimeout(() => { closeQuiz(); solveChallenge(); }, 750);
  } else {
    // 오답 → 로비로 추방, 처음부터 다시
    quizStatus.className = 'warn'; quizStatus.textContent = SECRET_QUIZ.wrong;
    setTimeout(() => { closeQuiz(); sendToLobby(); }, 1500);
  }
}

// 로비 소환: 1층 로비 입구로 돌려보낸다. 다시 도전할 수 있도록 표지 트리거를 재장전한다.
function sendToLobby(msg) {
  challenge.armed = true;
  switchFloor(0);
  showHint(msg || '처음부터 다시! 로비로 돌아왔습니다<br>最初からやり直し！ロビーに戻りました');
}

quizClose.addEventListener('click', closeQuiz);
quizPanel.addEventListener('keydown', (e) => { if (e.code === 'Escape') { e.preventDefault(); closeQuiz(); } });

function solveChallenge() {
  if (challenge.active) return;
  challenge.solved = true;
  challenge.active = true;
  // 포털 콜라이더 제거 → 통과 가능
  for (const c of secretPortalColliders) {
    const idx = colliders.indexOf(c);
    if (idx >= 0) colliders.splice(idx, 1);
  }
  secretPortalColliders = [];
  // 벽돌 표지 열림 연출: 위로 사라지며 페이드
  const mesh = secretPortalMesh, sign = challenge.signMesh;
  if (mesh) {
    mesh.material.transparent = true;
    const t0 = performance.now();
    const anim = () => {
      const p = Math.min(1, (performance.now() - t0) / 900);
      mesh.material.opacity = 1 - p;
      mesh.position.y += 0.025;
      if (sign) sign.material.opacity = 1 - p;
      if (p < 1) requestAnimationFrame(anim);
      else { mesh.visible = false; if (sign) sign.visible = false; }
    };
    anim();
  }
  showHint('스크린이 열렸어요! 화면 속으로 들어가 레이저를 피해 발판을 건너세요<br>スクリーンが開いた！画面の中へ入り、レーザーを避けて渡ろう');
  startHofWatch();
}

function startHofWatch() {
  if (hofUnsub) return;
  Social.initSocial().then(() => {
    hofUnsub = Social.watchGuestbook((entries) => {
      renderHallOfFame(entries.filter((e) => e.badge === 'secret'));
    });
  });
}

/* ── 비밀의 방 보상: 영상 + 기네스북 기록 ── */
const secretPanel = document.getElementById('secretPanel');
const secretClose = document.getElementById('secretClose');
const secretVideoWrap = document.getElementById('secretVideoWrap');
const secretForm = document.getElementById('secretForm');
const secretStatus = document.getElementById('secretStatus');
const sfName = document.getElementById('sfName');
const sfMessage = document.getElementById('sfMessage');
const sfSubmit = document.getElementById('sfSubmit');
const sfCount = document.getElementById('sfCount');
let secretReturnFocus = null, secretControlsBefore = false;

function openSecret() {
  secretReturnFocus = document.activeElement;
  secretControlsBefore = controlsActive;
  controlsActive = false;
  if (document.pointerLockElement) document.exitPointerLock();
  touchUIEl.setAttribute('aria-hidden', 'true'); touchUIEl.inert = true;
  secretVideoWrap.replaceChildren();
  if (REWARD_VIDEO) {
    const v = document.createElement('video');
    v.src = REWARD_VIDEO; v.controls = true; v.autoplay = true; v.playsInline = true;
    v.setAttribute('aria-label', '비밀 영상 · 秘密の映像');
    secretVideoWrap.appendChild(v);
  }
  secretStatus.className = ''; secretStatus.textContent = '';
  secretPanel.hidden = false;
  secretPanel.setAttribute('aria-hidden', 'false');
  secretClose.focus();
  startHofWatch();
}

function closeSecret() {
  const v = secretVideoWrap.querySelector('video');
  if (v) { v.pause(); v.removeAttribute('src'); v.load(); }
  secretVideoWrap.replaceChildren();
  secretPanel.hidden = true;
  secretPanel.setAttribute('aria-hidden', 'true');
  controlsActive = secretControlsBefore;
  touchUIEl.inert = !controlsActive;
  touchUIEl.setAttribute('aria-hidden', controlsActive ? 'false' : 'true');
  if (!IS_TOUCH && controlsActive && !autoTour.active) lockPointer();
  else if (secretReturnFocus && typeof secretReturnFocus.focus === 'function') secretReturnFocus.focus();
  secretReturnFocus = null;
}

secretClose.addEventListener('click', closeSecret);
secretPanel.addEventListener('keydown', (e) => { if (e.code === 'Escape') { e.preventDefault(); closeSecret(); } });
sfMessage.addEventListener('input', () => { sfCount.textContent = `${sfMessage.value.length} / 500`; });

secretForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = sfName.value;
  const school = secretForm.querySelector('input[name="sfSchool"]:checked')?.value || '';
  const message = sfMessage.value;
  if (!message.trim()) {
    secretStatus.className = 'warn';
    secretStatus.textContent = '소감을 입력해 주세요 · 感想を入力してください';
    return;
  }
  const wait = Social.postCooldownLeft();
  if (wait > 0) {
    secretStatus.className = 'warn';
    secretStatus.textContent = `잠시 후 다시 시도해 주세요 (${Math.ceil(wait / 1000)}초) · 少し待ってから`;
    return;
  }
  sfSubmit.disabled = true;
  try {
    await Social.initSocial();
    await Social.addGuestbookEntry({ name, school, message, badge: 'secret' });
    sfMessage.value = ''; sfCount.textContent = '0 / 500';
    secretStatus.className = '';
    secretStatus.textContent = '기네스북에 기록되었습니다! · 記帳しました！';
    // 로컬 모드는 실시간 스냅샷이 없으므로 명예의 전당을 즉시 다시 그린다.
    if (Social.getMode() !== 'firebase') {
      Social.watchGuestbook((entries) => renderHallOfFame(entries.filter((x) => x.badge === 'secret')));
    }
  } catch (err) {
    secretStatus.className = 'warn';
    secretStatus.textContent = err.message === 'COOLDOWN'
      ? '잠시 후 다시 시도해 주세요 · 少し待ってから'
      : '저장에 실패했습니다 · 保存に失敗しました';
    console.warn('기네스북 저장 실패', err);
  } finally {
    sfSubmit.disabled = false;
  }
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
    .filter(art => (!art.isVideo || art.item.thumb)
      && art.floor === player.floor
      && Math.abs(art.roomIdx - currentRoomIdx) <= 1
      && art.distanceFromPlayer <= ART_LOAD_DISTANCE)
    .sort((a, b) => a.distanceFromPlayer - b.distanceFromPlayer)
    .slice(0, MAX_LOADED_PHOTOS));

  if (document.body.classList.contains('playing')) {
    load3DLikeCountsFor(artworks.filter((art) => art.floor === player.floor
      && Math.abs(art.roomIdx - currentRoomIdx) <= 1
      && art.distanceFromPlayer <= ART_VISIBLE_DISTANCE));
  }

  for (const art of artworks) {
    const nearRoom = art.floor === player.floor && Math.abs(art.roomIdx - currentRoomIdx) <= 1;
    const distance = art.distanceFromPlayer;
    const shouldLoad = loadTargets.has(art);
    const shouldKeep = nearRoom && distance <= ART_KEEP_DISTANCE;
    art.loadTarget = shouldLoad;
    art.wanted = art.isVideo ? shouldKeep : (shouldLoad || (art.loaded && shouldKeep));
    if (art.loaded && shouldKeep) art.lastUsed = now;
    if (shouldLoad && !art.loaded && !art.loading && (!art.isVideo || art.item.thumb)
        && !art.queued && (!art.retryAt || now >= art.retryAt)) {
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
        // 첫 프레임이 준비되면 포스터에서 실시간 화면으로 교체한다 (검은 화면 노출 방지).
        const swapToLive = () => {
          if (a.video !== v) return;
          a.plane.material.map = vt;
          a.plane.material.color.setHex(0xffffff);
          a.plane.material.needsUpdate = true;
        };
        if (a.tex) v.addEventListener('loadeddata', swapToLive, { once: true });
        else swapToLive();
        a.plane.visible = true;
        a.projectionGlow.visible = true;
        a.loaded = true;
      }
      a.video.play().catch(() => {});
      a.beam.visible = true;
    } else if (a.video) {
      // 멀어지면 재생 리소스를 놓고 포스터(대기 화면)로 되돌린다.
      if (d > VIDEO_KEEP_DISTANCE) releaseVideoPlayback(a);
      // 일시정지된 프로젝션은 화면만 남기고 광선은 꺼서 겹치는 빔 난반사를 줄인다.
      else { a.video.pause(); a.beam.visible = false; }
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
  if (autoTour.active) {
    // 자동 관람: 경로를 따라 천천히 이동·감상 (수평 이동과 시선은 여기서 처리)
    updateAutoTour(dt);
  } else {
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

    // 점프
    if ((keys['Space']) && player.onGround) {
      player.velY = JUMP_V; player.onGround = false;
    }
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
  let groundEye = EYE + groundBase;
  // 비밀의 방 점프맵: 기본 층 바닥 대신 발판/구덩이 높이를 쓴다.
  if (inSecretZone(player)) groundEye = EYE + secretGroundY(player.pos);
  if (player.pos.y <= groundEye) {
    player.pos.y = groundEye; player.velY = 0; player.onGround = true;
  }

  camera.position.copy(player.pos);
  camera.rotation.set(player.pitch, player.yaw, 0);
}

/* ═══════════════════ 비밀의 방 점프맵 로직 ═══════════════════ */
function inSecretZone(p) {
  const b = challenge.bounds;
  return challenge.active && b && p.floor === 1
    && p.pos.x < b.wallX + 0.2 && p.pos.x > b.endX - 0.5
    && p.pos.z > b.zS - 0.5 && p.pos.z < b.zN + 0.5;
}

// 플레이어 발밑의 지면 높이(월드 Y): 위에서 착지 가능한 가장 높은 발판, 없으면 구덩이.
function secretGroundY(pos) {
  const feet = pos.y - EYE;
  let g = challenge.pitY;
  for (const pf of platforms) {
    if (pos.x >= pf.minX - RADIUS && pos.x <= pf.maxX + RADIUS
        && pos.z >= pf.minZ - RADIUS && pos.z <= pf.maxZ + RADIUS
        && pf.topY <= feet + LAND_TOL && pf.topY > g) {
      g = pf.topY;
    }
  }
  return g;
}

function respawnChallenge(msg) {
  player.pos.copy(challenge.checkpoint);
  player.yaw = challenge.checkpointYaw;
  player.pitch = 0;
  player.velY = 0; player.onGround = true;
  camera.position.copy(player.pos);
  camera.rotation.set(player.pitch, player.yaw, 0);
  if (msg) showHint(msg);
}

function updateChallenge(dt) {
  const b = challenge.bounds;
  if (!b) return;

  // 표지 접근 → 퀴즈 (미해결 상태에서 시네마 안쪽에서 벽으로 다가설 때)
  if (!challenge.solved && controlsActive && !quizOpen && player.floor === 1) {
    const nearPortal = player.pos.x < b.wallX + 1.4 && player.pos.x > b.wallX
      && player.pos.z > b.cz - PORTAL_W / 2 - 0.3 && player.pos.z < b.cz + PORTAL_W / 2 + 0.3;
    if (nearPortal && challenge.armed) { challenge.armed = false; openQuiz(); }
    // 존을 충분히 벗어나면 다시 장전
    if (player.pos.x > b.wallX + 3.0) challenge.armed = true;
  }

  if (!challenge.active) return;
  challenge.clock += dt;

  // 레이저 부드러운 상하 이동 + 접촉 판정
  const inZone = inSecretZone(player);
  for (const L of lasers) {
    // 빔 높이: topY+0.2 ~ topY+3.6 사이를 부드럽게 왕복
    const y = L.baseY + 1.9 + 1.7 * Math.sin(challenge.clock * L.speed + L.phase);
    L.bar.position.y = y; L.glow.position.y = y;
    // 몸통[발~머리]이 빔 밴드[y-0.28, y+0.28]와 겹치면 접촉
    if (!challenge.reached && inZone
        && Math.abs(player.pos.x - L.x) < 0.45
        && player.pos.z > L.zMin && player.pos.z < L.zMax
        && (player.pos.y + 0.1) > y - 0.28 && (player.pos.y - EYE) < y + 0.28) {
      respawnChallenge('레이저에 닿았어요! 다시 · レーザーに触れました！もう一度');
      return;
    }
  }

  // 낙사 → 로비로 소환 (처음부터 다시 걸어 올라와야 한다)
  if (!challenge.reached && inZone && (player.pos.y - EYE) <= challenge.pitY + 0.2) {
    sendToLobby('떨어졌어요! 로비로 소환되었습니다<br>落ちました！ロビーに召喚されました');
    return;
  }

  // 비밀의 방 도달 → 보상
  if (!challenge.reached && inZone && challenge.roomTrigger) {
    const r = challenge.roomTrigger;
    if (player.pos.x >= r.minX && player.pos.x <= r.maxX
        && player.pos.z >= r.minZ && player.pos.z <= r.maxZ) {
      challenge.reached = true;
      openSecret();
    }
  }
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
    // 시각 검수용: ?preview=video 또는 ?preview=day2-stair로 시작 위치를 바꾼다.
    const preview = new URLSearchParams(location.search).get('preview');
    if (preview === 'video') {
      const previewArt = artworks.find(art => art.isVideo);
      if (previewArt) {
        const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(previewArt.group.quaternion);
        player.floor = previewArt.floor;
        spawnPoint.copy(previewArt.pos).addScaledVector(normal, 2.8);
        spawnPoint.y = EYE + player.floor * FLOOR_HEIGHT;
        player.yaw = Math.atan2(normal.x, normal.z);
        updateFloorNav(player.floor);
      }
    } else if (preview === 'day2-stair') {
      const stair = stairways[1];
      if (stair) {
        player.floor = 0;
        spawnPoint.set((stair.xMin + stair.xMax) / 2, EYE, stair.zBottom + 0.45);
        player.yaw = 0;
        updateFloorNav(0);
      }
    }
    player.pos.copy(spawnPoint);
    camera.position.copy(player.pos);
    camera.rotation.set(0, player.yaw, 0);
    const nPhoto = manifest.items.filter(i => i.type === 'photo').length;
    const nVideo = manifest.items.filter(i => i.type === 'video').length;
    loadNote.textContent = `사진 ${nPhoto}점 · 영상 ${nVideo}점 전시 중 · 写真${nPhoto}点・映像${nVideo}点を展示中`;
    enterBtn.disabled = false;
    galleryBtn.disabled = false;
    autoEnterBtn.disabled = false;
    lastRoomCheck = -1e9;
    updateRooms(performance.now()); // 초기 로딩 킥
  } catch (err) {
    loadNote.textContent = '전시 준비 중입니다 — 새로고침해 주세요 · 展示準備中です — 再読み込みしてください (' + err.message + ')';
    console.error(err);
  }
}

const clock = new THREE.Clock();
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);
  updatePlayer(dt);
  updateChallenge(dt);
  updateRooms(performance.now());
  updateBgm(dt);
  if (cinemaCtl) cinemaCtl.update(dt);
  renderer.render(scene, camera);
}

init();
loop();

// 개발용 디버그 핸들
window.__m = { player, rooms, artworks, keys, joy, drag, renderer, scene, camera,
  tourStops, autoTour, startAutoTour, stopAutoTour,
  challenge,
  get cinema() { return cinemaCtl; },
  get room() { return currentRoomIdx; },
  tp(x, z, yaw) { player.pos.set(x, EYE + player.floor * FLOOR_HEIGHT, z); player.yaw = yaw; player.pitch = 0; },
  floor(n) { switchFloor(Math.max(0, Math.min(1, n))); },
  step(n = 1) { // rAF가 멈춘 환경에서 수동 프레임 진행 (테스트용)
    for (let i = 0; i < n; i++) { updatePlayer(1 / 60); if (cinemaCtl) cinemaCtl.update(1 / 60); }
    lastRoomCheck = -1e9;
    updateRooms(performance.now());
    camera.position.copy(player.pos);
    camera.rotation.set(player.pitch, player.yaw, 0);
    renderer.render(scene, camera);
  } };
