import * as THREE from './lib/three.module.js';

// 원본의 윗부분 56%만 배경으로 읽는다. 산의 비율을 유지하고 하단 표지판은 제외한다.
export const DAISEN_VIEW = Object.freeze({ cropBottom: 0.44, cropHeight: 0.56,
  horizontalAngle: Math.PI * 0.60, imageAspect: 2048 / 1536, centerU: 0.56, horizon: -0.015 });

export function terrainHeight(x, z) {
  const bank = Math.min(1, Math.max(0, (x - 27) / 7));
  return 0.035 + bank * (0.16 + Math.exp(-(((x - 43) / 18) ** 2))
    * (0.7 + 0.16 * Math.sin(z * 0.12) + 0.12 * Math.sin(z * 0.29 + x * 0.1)));
}

// 하늘과 물이 같은 방향의 풍경을 읽으므로 시점을 옮겨도 반사가 일치한다.
const landscapeGLSL = `
  uniform sampler2D backdrop;
  uniform float imageReady;
  uniform float span;
  uniform float verticalScale;
  uniform vec3 horizonColor;
  uniform vec3 skyColor;
  vec3 landscape(vec3 ray) {
    ray = normalize(ray);
    float elevation = ray.y / max(length(ray.xz), 0.001);
    float u = atan(ray.z, ray.x) / span + ${DAISEN_VIEW.centerU};
    float v = (elevation - ${DAISEN_VIEW.horizon}) / verticalScale;
    vec3 sky = mix(horizonColor, skyColor, smoothstep(0.0, 0.85, elevation));
    // 중앙 사진은 그대로 유지하고 양끝의 낮은 능선·하늘만 바깥으로 이어 준다.
    float extendedU = u < 0.0 ? min(-u, 0.16) : (u > 1.0 ? max(1.0 - (u - 1.0), 0.84) : u);
    float heightBlend = 1.0 - smoothstep(0.91, 1.0, v);
    vec2 uv = vec2(clamp(extendedU, 0.001, 0.999), ${DAISEN_VIEW.cropBottom} + clamp(v, 0.0, 1.0) * ${DAISEN_VIEW.cropHeight});
    vec3 photo = texture2D(backdrop, uv).rgb;
    // 사진 자체의 구름과 명암을 살리고 지평선 근처에만 옅은 대기감을 더한다.
    photo = mix(photo, horizonColor, 0.055 + 0.08 * (1.0 - smoothstep(0.0, 0.35, v)));
    return mix(sky, photo, heightBlend * imageReady);
  }
`;

function randomSource(seed) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296; };
}

function groundTexture() {
  const image = document.createElement('canvas'); image.width = image.height = 256;
  const ctx = image.getContext('2d'), random = randomSource(714);
  ctx.fillStyle = '#eeeeea'; ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 8000; i++) {
    ctx.fillStyle = `rgba(90,88,58,${0.04 + random() * 0.18})`;
    ctx.fillRect(random() * 256, random() * 256, 0.5 + random(), 1 + random() * 3);
  }
  const map = new THREE.CanvasTexture(image); map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping; map.anisotropy = 4;
  return map;
}

export function createDaisenLandscape({ scene, camera, zEnd, mobile }) {
  const group = new THREE.Group(); group.name = 'daisen-landscape'; scene.add(group);
  const placeholder = new THREE.DataTexture(new Uint8Array([185, 200, 208, 255]), 1, 1);
  placeholder.colorSpace = THREE.SRGBColorSpace; placeholder.needsUpdate = true;
  const shared = {
    backdrop: { value: placeholder }, imageReady: { value: 0 },
    span: { value: DAISEN_VIEW.horizontalAngle },
    verticalScale: { value: DAISEN_VIEW.horizontalAngle * DAISEN_VIEW.cropHeight / DAISEN_VIEW.imageAspect },
    horizonColor: { value: new THREE.Color(0xb6c3c9) }, skyColor: { value: new THREE.Color(0xe1e6e6) },
  };
  const sky = new THREE.Mesh(new THREE.SphereGeometry(190, mobile ? 32 : 64, mobile ? 16 : 32),
    new THREE.ShaderMaterial({ uniforms: shared, side: THREE.BackSide, depthWrite: false, toneMapped: false,
      vertexShader: `varying vec3 direction;
        void main() { direction = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying vec3 direction; ${landscapeGLSL}
        void main() {
          gl_FragColor = vec4(landscape(direction),1.0);
          #include <colorspace_fragment>
        }`,
    }));
  sky.name = 'daisen-distant-sky'; sky.renderOrder = -20; sky.frustumCulled = false;
  // 카메라를 따라가는 먼 배경은 창가에 다가가도 커지거나 평면의 끝이 드러나지 않는다.
  scene.add(sky);

  const poolZMin = zEnd - 10, poolZMax = 20, poolLength = poolZMax - poolZMin;
  const poolCenterZ = (poolZMin + poolZMax) / 2;
  const waterUniforms = { ...shared, time: { value: 0 } };
  const water = new THREE.Mesh(new THREE.PlaneGeometry(18, poolLength), new THREE.ShaderMaterial({
    uniforms: waterUniforms, toneMapped: false,
    vertexShader: `varying vec3 worldPoint;
      void main() { vec4 world = modelMatrix * vec4(position,1.0); worldPoint = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world; }`,
    fragmentShader: `varying vec3 worldPoint; uniform float time; ${landscapeGLSL}
      void main() {
        vec3 normal = normalize(vec3(
          0.0035 * sin(worldPoint.x * 3.8 + worldPoint.z * 1.7 + time * 0.6),
          1.0, 0.0025 * sin(worldPoint.z * 5.1 - worldPoint.x * 1.3 - time * 0.45)));
        vec3 incident = normalize(worldPoint - cameraPosition);
        vec3 reflected = reflect(incident, normal);
        vec3 reflection = landscape(reflected);
        reflection += landscape(normalize(reflected + vec3(0.002,0.003,0.002)));
        reflection += landscape(normalize(reflected - vec3(0.002,0.003,0.002)));
        reflection /= 3.0;
        float fresnel = 0.06 + 0.79 * pow(1.0 - max(dot(-incident,normal),0.0), 3.0);
        vec3 waterColor = vec3(0.075,0.115,0.12);
        gl_FragColor = vec4(mix(waterColor,reflection,fresnel),1.0);
        #include <colorspace_fragment>
      }`,
  }));
  water.name = 'daisen-reflecting-pool'; water.rotation.x = -Math.PI / 2;
  water.position.set(18.2, 0.04, poolCenterZ); group.add(water);

  // 얇은 연못 테두리와 먼 둔덕을 다른 거리에 놓아 창밖의 시차를 만든다.
  const curbMaterial = new THREE.MeshStandardMaterial({ color: 0x9c9d92, roughness: 0.86 });
  for (const x of [8.75, 27.45]) {
    const curb = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.18, poolLength + 1.0), curbMaterial);
    curb.position.set(x, 0.04, poolCenterZ); group.add(curb);
  }
  for (const z of [poolZMin - 0.22, poolZMax + 0.22]) {
    const curb = new THREE.Mesh(new THREE.BoxGeometry(18, 0.18, 0.45), curbMaterial);
    curb.position.set(18.2, 0.04, z); group.add(curb);
  }

  const landMinZ = zEnd - 400, landMaxZ = 400;
  const ground = new THREE.PlaneGeometry(473, landMaxZ - landMinZ, mobile ? 48 : 80, mobile ? 64 : 96);
  ground.rotateX(-Math.PI / 2); ground.translate((27 + 500) / 2, 0, (landMinZ + landMaxZ) / 2);
  const pos = ground.attributes.position, colors = [];
  const uv = ground.attributes.uv;
  const nearColor = new THREE.Color(0x676d4e), farColor = new THREE.Color(0x737b68), color = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, terrainHeight(x, z));
    uv.setXY(i, x / 7, z / 7);
    const haze = Math.min(0.75, (x - 27) / 270);
    color.copy(nearColor).lerp(farColor, haze);
    color.multiplyScalar(0.94 + 0.045 * Math.sin(z * 0.7 + x * 0.2) + 0.035 * Math.cos(z * 0.17 - x * 0.55));
    colors.push(color.r, color.g, color.b);
  }
  ground.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); ground.computeVertexNormals();
  const land = new THREE.Mesh(ground, new THREE.MeshStandardMaterial({ map: groundTexture(), vertexColors: true, roughness: 1, envMapIntensity: 0.45, fog: false }));
  land.name = 'daisen-low-bank'; group.add(land);

  // 낮은 풀 군락은 한 번에 렌더링한다. 개별 메시와 투명 텍스처를 늘리지 않는다.
  const blades = [];
  for (let i = 0; i < 3; i++) {
    const angle = i * Math.PI / 3, dx = Math.cos(angle) * 0.055, dz = Math.sin(angle) * 0.055;
    blades.push(-dx,0,-dz, dx,0,dz, dx*0.7,0.35,dz*0.7);
  }
  const grassGeo = new THREE.BufferGeometry();
  grassGeo.setAttribute('position', new THREE.Float32BufferAttribute(blades, 3)); grassGeo.computeVertexNormals();
  const count = mobile ? 180 : 360;
  const grass = new THREE.InstancedMesh(grassGeo, new THREE.MeshStandardMaterial({ color: 0xa3a07a,
    roughness: 1, side: THREE.DoubleSide }), count);
  const random = randomSource(713), transform = new THREE.Object3D();
  for (let i = 0; i < count; i++) {
    const x = 29 + random() * 22, z = poolZMin - 5 + random() * (poolLength + 10);
    transform.position.set(x, terrainHeight(x, z), z); transform.rotation.y = random() * Math.PI;
    transform.scale.setScalar(0.45 + random() * 0.9); transform.updateMatrix();
    grass.setMatrixAt(i, transform.matrix);
  }
  group.add(grass);

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let elapsed = 0;
  new THREE.TextureLoader().load('assets/backdrop.jpg', photo => {
    photo.colorSpace = THREE.SRGBColorSpace;
    photo.anisotropy = mobile ? 2 : 4;
    shared.backdrop.value = photo;
    // 실제로 불러온 사진의 비율을 사용한다.
    shared.verticalScale.value = DAISEN_VIEW.horizontalAngle * DAISEN_VIEW.cropHeight / (photo.image.width / photo.image.height);
    shared.imageReady.value = 1; placeholder.dispose();
  }, undefined, err => console.warn('다이센 사진 로드 실패 — 기본 하늘을 표시합니다.', err));
  return {
    group, sky, water,
    update(dt, active = true) {
      sky.position.copy(camera.position);
      if (active && !document.hidden && !reducedMotion.matches) elapsed += dt;
      waterUniforms.time.value = elapsed;
    },
  };
}
