import * as THREE from './lib/three.module.js';

// 같은 좌표와 질감을 사용해 조명·벤치·충돌 영역이 서로 어긋나지 않게 한다.
export const LOBBY_BENCHES = Object.freeze([
  Object.freeze({ x: -5.5, z: 4.1, width: 0.74, length: 2.9 }),
  Object.freeze({ x: -5.5, z: 10.3, width: 0.74, length: 2.9 }),
]);

function randomSource(seed) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296; };
}
function canvas(width, height = width) {
  const image = document.createElement('canvas'); image.width = width; image.height = height;
  return [image, image.getContext('2d')];
}
function texture(image, color = false) {
  const tex = new THREE.CanvasTexture(image);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  if (color) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function concreteMaps() {
  const random = randomSource(20260712);
  const [color, g] = canvas(512);
  const [height, h] = canvas(512);
  g.fillStyle = '#c5c2b9'; g.fillRect(0, 0, 512, 512);
  h.fillStyle = '#aaa'; h.fillRect(0, 0, 512, 512);
  // 작은 기공과 낮은 명도 차이: 멀리서는 차분하고 가까이서는 요철이 보인다.
  for (let i = 0; i < 9000; i++) {
    const x = random() * 512, y = random() * 512, r = 0.25 + random() * 1.2;
    g.fillStyle = `rgba(90,85,76,${0.02 + random() * 0.085})`;
    g.fillRect(x, y, r, r);
    h.fillStyle = `rgba(40,40,40,${0.1 + random() * 0.3})`;
    h.fillRect(x, y, r, r);
  }
  for (let p = 0; p <= 512; p += 256) {
    g.fillStyle = 'rgba(73,68,59,.24)'; h.fillStyle = '#656565';
    g.fillRect(p, 0, 1.2, 512); g.fillRect(0, p, 512, 1.2);
    h.fillRect(p, 0, 1.5, 512); h.fillRect(0, p, 512, 1.5);
    g.fillStyle = 'rgba(255,253,239,.24)';
    g.fillRect(p + 1.4, 0, 1, 512); g.fillRect(0, p + 1.4, 512, 1);
  }
  for (const x of [64, 192, 320, 448]) for (const y of [64, 192, 320, 448]) {
    g.fillStyle = '#a5a195'; g.beginPath(); g.arc(x, y, 2.8, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#d4d0c5'; g.fillRect(x - 1.5, y + 1.4, 3, 0.7);
    h.fillStyle = '#454545'; h.beginPath(); h.arc(x, y, 2.8, 0, Math.PI * 2); h.fill();
  }
  return { color: texture(color, true), height: texture(height) };
}

function stoneMaterial() {
  const random = randomSource(140814);
  const [image, g] = canvas(512);
  const [relief, h] = canvas(512);
  g.fillStyle = '#777972'; g.fillRect(0, 0, 512, 512);
  h.fillStyle = '#b8b8b8'; h.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 12000; i++) {
    const x = random() * 512, y = random() * 512, size = 0.4 + random() * 1.3;
    const light = random() > 0.5;
    g.fillStyle = light ? 'rgba(221,220,208,.13)' : 'rgba(40,44,40,.12)';
    g.fillRect(x, y, size, size);
    h.fillStyle = light ? '#bcbcbc' : '#aaa'; h.fillRect(x, y, size, size);
  }
  g.strokeStyle = '#66685f'; g.lineWidth = 1.5; g.strokeRect(0.75, 0.75, 510.5, 510.5);
  h.strokeStyle = '#777'; h.lineWidth = 1.5; h.strokeRect(0.75, 0.75, 510.5, 510.5);
  const map = texture(image, true), bump = texture(relief);
  map.repeat.set(16 / 1.6, 14 / 1.6); bump.repeat.copy(map.repeat);
  return new THREE.MeshStandardMaterial({ map, bumpMap: bump, bumpScale: 0.009,
    roughness: 0.48, metalness: 0, envMapIntensity: 0.65 });
}

function oakMaterial() {
  const random = randomSource(717);
  const [image, g] = canvas(128, 512);
  g.fillStyle = '#947652'; g.fillRect(0, 0, 128, 512);
  for (let i = 0; i < 200; i++) {
    const x = random() * 128;
    g.strokeStyle = `rgba(48,32,17,${0.025 + random() * 0.12})`;
    g.lineWidth = 0.3 + random() * 1.1;
    g.beginPath(); g.moveTo(x, 0);
    g.bezierCurveTo(x + 6, 170, x - 5, 350, x, 512); g.stroke();
  }
  return new THREE.MeshStandardMaterial({ map: texture(image, true), roughness: 0.58, metalness: 0 });
}

// 고정된 햇빛을 바닥에 투영한다. 프레임마다 그림자 맵을 렌더링하지 않는다.
// y에 대한 x/z 이동량을 사용해 창틀·계단의 실제 좌표와 그림자를 맞춘다.
export function intersectsSunRay(x, z, box, dx, dz) {
  let near = Math.max(0, box.minY), far = box.maxY;
  for (const [origin, slope, min, max] of [[x, dx, box.minX, box.maxX], [z, dz, box.minZ, box.maxZ]]) {
    if (Math.abs(slope) < 1e-9) { if (origin < min || origin > max) return false; continue; }
    const a = (min - origin) / slope, b = (max - origin) / slope;
    near = Math.max(near, Math.min(a, b)); far = Math.min(far, Math.max(a, b));
  }
  return far >= near;
}
function sunlightTexture(sun, stair, mobile) {
  const width = mobile ? 384 : 640, height = Math.round(width * 14 / 16);
  const [image, g] = canvas(width, height);
  const pixels = g.createImageData(width, height);
  const dx = sun.x / sun.y, dz = sun.z / sun.y;
  const blockers = [];
  const steps = 26;
  for (let i = 0; i < steps; i++) {
    const y = 5.2 * (i + 1) / steps;
    const z = stair.zBottom - (stair.zBottom - stair.zTop) * (i + 0.5) / steps;
    const depth = (stair.zBottom - stair.zTop) / steps + 0.06;
    blockers.push({ minX: stair.xMin, maxX: stair.xMax, minY: y - 0.09, maxY: y, minZ: z - depth / 2, maxZ: z + depth / 2 });
  }
  // 난간 기둥: 계단과 동일한 7개 지지점.
  for (const x of [stair.xMin, stair.xMax]) for (let i = 0; i <= 6; i++) {
    const p = i / 6, z = stair.zBottom - (stair.zBottom - stair.zTop) * p;
    blockers.push({ minX: x - 0.028, maxX: x + 0.028, minZ: z - 0.028, maxZ: z + 0.028, minY: p * 5.2 + 0.05, maxY: p * 5.2 + 1 });
  }
  for (let py = 0; py < height; py++) for (let px = 0; px < width; px++) {
    const x = -8 + (px + 0.5) / width * 16, z = (py + 0.5) / height * 14;
    const offset = (py * width + px) * 4;
    const wallDistance = Math.min(x + 8, 8 - x, 14 - z, Math.abs(x) > 2.1 ? z : 100);
    pixels.data[offset] = 29; pixels.data[offset + 1] = 31; pixels.data[offset + 2] = 26;
    pixels.data[offset + 3] = Math.round(65 * Math.exp(-wallDistance * 7));
    const windowY = (8.2 - x) / dx, windowZ = z + windowY * dz;
    const edge = Math.min(windowY - 0.65, 4.92 - windowY, windowZ, 14 - windowZ);
    if (edge <= 0) continue;
    const mullionDistance = Math.abs(windowZ - Math.round(windowZ / 3.5) * 3.5);
    if (mullionDistance < 0.07 || blockers.some(box => intersectsSunRay(x, z, box, dx, dz))) continue;
    pixels.data[offset] = 255; pixels.data[offset + 1] = 240; pixels.data[offset + 2] = 207;
    pixels.data[offset + 3] = Math.round(115 * Math.min(1, edge / 0.14));
  }
  g.putImageData(pixels, 0, 0);
  // 픽셀 경계와 창틀 그림자를 아주 조금 부드럽게 한다.
  const [soft, s] = canvas(width, height);
  s.filter = 'blur(1px)'; s.drawImage(image, 0, 0);
  const tex = texture(soft, true); tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

export function createLobbyFinish({ sun, stair, mobile }) {
  const concrete = concreteMaps();
  const group = new THREE.Group(); group.name = 'lobby-atmosphere';
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(16, 14), stoneMaterial());
  floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0.007, 7); group.add(floor);
  const light = new THREE.Mesh(new THREE.PlaneGeometry(16, 14), new THREE.MeshBasicMaterial({
    map: sunlightTexture(sun, stair, mobile), transparent: true, depthWrite: false, toneMapped: false,
  }));
  light.rotation.x = -Math.PI / 2; light.position.set(0, 0.012, 7); light.renderOrder = 1; group.add(light);

  // 모든 벤치가 목재·프레임을 공유한다. 좌판 6개, 다리 4개를 각각 한 번에 그린다.
  const plankShape = new THREE.Shape();
  plankShape.moveTo(-0.105, -1.43); plankShape.lineTo(0.105, -1.43);
  plankShape.lineTo(0.105, 1.43); plankShape.lineTo(-0.105, 1.43); plankShape.closePath();
  const plank = new THREE.ExtrudeGeometry(plankShape, { depth: 0.052, bevelEnabled: true,
    bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2, steps: 1 });
  plank.rotateX(-Math.PI / 2); plank.center();
  const seats = new THREE.InstancedMesh(plank, oakMaterial(), 6);
  const steel = new THREE.MeshStandardMaterial({ color: 0x333831, roughness: 0.62, metalness: 0.4 });
  const legs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.61, 0.365, 0.085), steel, 4);
  const braces = new THREE.InstancedMesh(new THREE.BoxGeometry(0.07, 0.08, 2.42), steel, 2);
  const matrix = new THREE.Matrix4();
  LOBBY_BENCHES.forEach((bench, i) => {
    for (let j = 0; j < 3; j++) seats.setMatrixAt(i * 3 + j, matrix.makeTranslation(bench.x + (j - 1) * 0.248, 0.425, bench.z));
    for (let j = 0; j < 2; j++) legs.setMatrixAt(i * 2 + j, matrix.makeTranslation(bench.x, 0.19, bench.z + (j ? 1.12 : -1.12)));
    braces.setMatrixAt(i, matrix.makeTranslation(bench.x, 0.23, bench.z));
  });
  group.add(seats, legs, braces);
  const [shade, s] = canvas(128, 256);
  s.filter = 'blur(10px)'; s.fillStyle = 'rgba(20,24,19,.30)'; s.fillRect(30, 27, 68, 202);
  const shadow = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.5, 3.6), new THREE.MeshBasicMaterial({
    map: texture(shade), transparent: true, depthWrite: false, toneMapped: false,
  }), 2);
  const transform = new THREE.Object3D(); transform.rotation.x = -Math.PI / 2;
  LOBBY_BENCHES.forEach((bench, i) => {
    transform.position.set(bench.x, 0.016, bench.z); transform.updateMatrix(); shadow.setMatrixAt(i, transform.matrix);
  });
  shadow.renderOrder = 2; group.add(shadow);
  return {
    group,
    concreteMaterial(width, height) {
      const map = concrete.color.clone(), bump = concrete.height.clone();
      map.repeat.set(width / 3.6, height / 3.6); bump.repeat.copy(map.repeat);
      return new THREE.MeshStandardMaterial({ map, bumpMap: bump, bumpScale: 0.014,
        roughness: 0.88, metalness: 0, envMapIntensity: 0.5 });
    },
    addColliders(add) {
      for (const b of LOBBY_BENCHES) add(b.x, b.z, b.width, b.length, 0);
    },
  };
}
