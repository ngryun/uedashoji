import * as THREE from './lib/three.module.js';

export const TRACE_LIFETIME = 60 * 24 * 60 * 60 * 1000;
export const TRACE_STEP = 0.65;
export const TRACE_NAME_MAX = 8;
const PREF_KEY = 'guest.traces.enabled.v1';
const NAME_KEY = 'guest.traces.name.v1';
const SESSION_KEY = 'guest.traces.visit.v1';
const LABEL_FONT = '"Apple SD Gothic Neo","Hiragino Kaku Gothic ProN","Noto Sans KR","Noto Sans JP",sans-serif';
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const read = (storage, key, fallback) => {
  try { return JSON.parse(storage?.getItem(key)) ?? fallback; } catch { return fallback; }
};
const write = (storage, key, value) => {
  try { storage?.setItem(key, JSON.stringify(value)); } catch { /* Memory-only on restricted browsers. */ }
};
export function tracePreference(storage) { return read(storage, PREF_KEY, true) !== false; }
export function saveTracePreference(storage, enabled) { write(storage, PREF_KEY, enabled); }

// The nickname is the only visitor-typed text on the floor: optional, short and printable.
export function cleanTraceName(value) {
  const text = String(value ?? '').replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, '').replace(/\s+/g, ' ').trim();
  return [...text].slice(0, TRACE_NAME_MAX).join('');
}
const validTraceName = value => typeof value === 'string' && value.length > 0 && value === cleanTraceName(value);
export function traceName(storage) { return cleanTraceName(read(storage, NAME_KEY, '')); }
export function saveTraceName(storage, value) { write(storage, NAME_KEY, cleanTraceName(value)); }
// Both schools share UTC+9, so the viewer's local date is the date everyone expects to see.
export function traceLabel(segment) {
  const date = new Date(segment.createdAt);
  const day = `${date.getFullYear()}.${date.getMonth() + 1}.${date.getDate()}`;
  return segment.name ? `${segment.name} · ${day}` : day;
}

// Include geometry in the version so manifest changes cannot leave tracks inside new walls.
export function traceLayout(rooms) {
  const value = JSON.stringify(rooms.map(r => [r.floor, r.W, r.zFrom, r.zTo]));
  let hash = 2166136261;
  for (const ch of value) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619);
  return `traces-v1-${(hash >>> 0).toString(16)}`;
}

export function createTraceRecorder({ storage, layout, onSegment, now = Date.now, id = () => crypto.randomUUID(),
  name = () => '' }) {
  let visit = read(storage, SESSION_KEY, null);
  if (!visit || visit.layout !== layout || typeof visit.id !== 'string' || !visit.rooms
      || typeof visit.rooms !== 'object' || Array.isArray(visit.rooms)) {
    visit = { id: id(), layout, rooms: {} };
    write(storage, SESSION_KEY, visit);
  }
  let previous = null, travelled = 0, points = [], room = null;
  const reset = () => { previous = null; travelled = 0; points = []; room = null; };
  return {
    reset,
    get pending() { return points; },
    get pendingRoom() { return room; },
    sample(position, roomId, active) {
      // A pause keeps the path being formed, so a look at a photo does not erase it. Moving
      // while not recording (jumps, stairs, automatic tours) trips the discontinuity check below.
      if (!active) return;
      if (roomId !== room) { reset(); room = roomId; }
      const p = { x: position.x, z: position.z };
      if (!previous) { previous = p; return; }
      const length = distance(p, previous);
      // Normal run movement is <= .42m per frame. Discontinuities are never interpolated.
      if (length > 0.8) { reset(); room = roomId; previous = p; return; }
      const state = visit.rooms[roomId] || { count: 0 };
      if (state.count >= 2 || (points.length === 0 && state.last
          && (now() - state.at < 30000 || distance(p, state.last) < 4))) {
        previous = p; travelled = 0; return;
      }
      if (length < 1e-6) return;
      const dx = (p.x - previous.x) / length, dz = (p.z - previous.z) / length;
      if (travelled + length >= TRACE_STEP) {
        const offset = TRACE_STEP - travelled;
        const side = points.length % 2 ? 0.095 : -0.095;
        points.push({ x: previous.x + dx * offset - dz * side,
          z: previous.z + dz * offset + dx * side, angle: Math.atan2(-dx, -dz) });
        travelled = travelled + length - TRACE_STEP;
        if (points.length === 6) {
          const createdAt = now(), nickname = cleanTraceName(name());
          const segment = { id: `${visit.id}-${roomId}-${state.count}`, room: roomId, layout,
            points, createdAt, expiresAt: createdAt + TRACE_LIFETIME, ...(nickname ? { name: nickname } : {}) };
          // Reserve the slot before starting a write: reloads and failures cannot amplify writes.
          visit.rooms[roomId] = { count: state.count + 1, at: createdAt, last: p };
          write(storage, SESSION_KEY, visit);
          points = []; travelled = 0;
          onSegment(segment);
        }
      } else travelled += length;
      previous = p;
    },
  };
}

export function validTrace(segment, rooms, layout, now = Date.now()) {
  if (!segment || typeof segment.id !== 'string') return false;
  const r = rooms[segment.room];
  return !!r && segment.layout === layout && (!('name' in segment) || validTraceName(segment.name))
    && Number.isFinite(segment.createdAt)
    && segment.createdAt <= now + 300000 && segment.createdAt > now - TRACE_LIFETIME
    && Number.isFinite(segment.expiresAt) && segment.expiresAt > now
    && Array.isArray(segment.points) && segment.points.length === 6
    && segment.points.every(p => p && Number.isFinite(p.x) && Number.isFinite(p.z)
      && Number.isFinite(p.angle) && Math.abs(p.angle) <= Math.PI
      && Math.abs(p.x) <= r.W / 2 - 0.1 && p.z <= r.zFrom && p.z >= r.zTo);
}

export function visibleTraceSegments(segments, { rooms, layout, roomIds, limit, now = Date.now() }) {
  const selected = [], ids = new Set();
  for (const segment of segments.filter(s => validTrace(s, rooms, layout, now))
    .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id))) {
    if (selected.length * 6 >= limit) break;
    if (ids.has(segment.id) || !roomIds.includes(segment.room)) continue;
    // Omit entire crowded paths, rather than breaking the visual rhythm of six steps.
    if (selected.some(other => other.room === segment.room && other.points.some(a =>
      segment.points.some(b => distance(a, b) < 0.55)))) continue;
    ids.add(segment.id); selected.push(segment);
  }
  return selected;
}

function makeRenderer(limit) {
  const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.ellipse(31, 43, 20, 34, -0.1, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(35, 99, 16, 19, 0.05, 0, Math.PI * 2); ctx.fill();
  const texture = new THREE.CanvasTexture(canvas);
  const geometry = new THREE.PlaneGeometry(0.16, 0.29);
  const alpha = new THREE.InstancedBufferAttribute(new Float32Array(limit), 1);
  geometry.setAttribute('traceOpacity', alpha);
  const mirror = new THREE.InstancedBufferAttribute(new Float32Array(limit), 1);
  geometry.setAttribute('traceMirror', mirror);
  const material = new THREE.MeshBasicMaterial({ color: 0x84776b, map: texture,
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1,
    polygonOffsetUnits: -1, toneMapped: false });
  material.onBeforeCompile = shader => {
    shader.vertexShader = 'attribute float traceOpacity; attribute float traceMirror; varying float vTraceOpacity; varying float vTraceMirror;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\nvTraceOpacity = traceOpacity; vTraceMirror = traceMirror;');
    shader.fragmentShader = 'varying float vTraceOpacity; varying float vTraceMirror;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>',
      THREE.ShaderChunk.map_fragment.replace('vMapUv', 'vec2(mix(vMapUv.x, 1.0 - vMapUv.x, vTraceMirror), vMapUv.y)'));
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>',
      '#include <color_fragment>\ndiffuseColor.a *= vTraceOpacity;');
  };
  const mesh = new THREE.InstancedMesh(geometry, material, limit);
  mesh.name = 'visitor-footprints'; mesh.count = 0; mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.raycast = () => {};
  const dummy = new THREE.Object3D(); dummy.rotation.order = 'YXZ';
  return { mesh,
    draw(segments, rooms, pending, pendingRoom, now) {
      let index = 0;
      const draw = (points, room, opacity) => {
        for (let i = 0; i < points.length && index < limit; i++) {
          const p = points[i];
          dummy.position.set(p.x, rooms[room].elevation + 0.008, p.z);
          dummy.rotation.set(-Math.PI / 2, p.angle, 0);
          dummy.updateMatrix(); mirror.setX(index, i % 2);
          mesh.setMatrixAt(index, dummy.matrix); alpha.setX(index++, opacity);
        }
      };
      // Keep the newly forming local path visible, even at the display cap.
      if (pending.length && rooms[pendingRoom]) draw(pending, pendingRoom, 0.26);
      const drawn = [];
      for (const s of segments) {
        if (index + 6 > limit) break;
        draw(s.points, s.room, 0.26 * Math.max(0, 1 - (now - s.createdAt) / TRACE_LIFETIME));
        drawn.push(s);
      }
      mesh.count = index; mesh.instanceMatrix.needsUpdate = true; alpha.needsUpdate = true; mirror.needsUpdate = true;
      return drawn;
    },
    dispose() { geometry.dispose(); material.dispose(); texture.dispose(); },
  };
}

// One small floor label per drawn path: the nickname (if any) and the date, just past the sixth step.
function makeLabelRenderer(slots) {
  const group = new THREE.Group(); group.name = 'visitor-footprint-labels';
  const geometry = new THREE.PlaneGeometry(1.4, 0.28);
  const labels = Array.from({ length: slots }, () => {
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 128;
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.MeshBasicMaterial({ color: 0x4e463f, map: texture, transparent: true,
      opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
      toneMapped: false });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.order = 'YXZ'; mesh.visible = false; mesh.raycast = () => {};
    group.add(mesh);
    return { canvas, texture, material, mesh, text: '' };
  });
  const paint = (label, text) => {
    if (label.text === text) return;
    label.text = text;
    const ctx = label.canvas.getContext('2d');
    ctx.clearRect(0, 0, 640, 128);
    ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    let size = 58;
    ctx.font = `600 ${size}px ${LABEL_FONT}`;
    const width = ctx.measureText(text).width;
    if (width > 600) { size = Math.max(24, Math.floor(size * 600 / width)); ctx.font = `600 ${size}px ${LABEL_FONT}`; }
    ctx.fillText(text, 320, 66);
    label.texture.needsUpdate = true;
  };
  return { group,
    draw(segments, rooms, now) {
      let i = 0;
      for (; i < segments.length && i < slots; i++) {
        const s = segments[i], last = s.points[5], label = labels[i];
        paint(label, traceLabel(s));
        // Half a metre beyond the last step, upright for anyone following the path.
        label.mesh.position.set(last.x - Math.sin(last.angle) * 0.5, rooms[s.room].elevation + 0.009,
          last.z - Math.cos(last.angle) * 0.5);
        label.mesh.rotation.set(-Math.PI / 2, last.angle, 0);
        label.material.opacity = 0.6 * Math.max(0, 1 - (now - s.createdAt) / TRACE_LIFETIME);
        label.mesh.visible = true;
      }
      for (; i < slots; i++) labels[i].mesh.visible = false;
    },
    dispose() { geometry.dispose(); for (const label of labels) { label.material.dispose(); label.texture.dispose(); } },
  };
}

export function createVisitorTraces({ rooms, mobile, storage, social, enabled = true, name = '', onStatus = () => {} }) {
  const layout = traceLayout(rooms), limit = mobile ? 72 : 144;
  const renderer = makeRenderer(limit), labels = makeLabelRenderer(limit / 6);
  const own = new Map(), remote = new Map(), watches = new Map();
  const failedRooms = new Set();
  let roomIds = [], started = false, ready = false, disposed = false, lastDraw = 0;
  let online = false, writingFailed = false, generation = 0, nickname = cleanTraceName(name);
  const unsent = new Set();
  const status = () => onStatus(writingFailed || failedRooms.size ? 'unavailable' : online ? 'shared' : 'local');
  const send = segment => {
    const attempt = generation; unsent.add(segment.id);
    social.saveVisitorTrace(segment, () => enabled && generation === attempt && !disposed).then(saved => {
      unsent.delete(segment.id);
      if (saved === false) own.delete(segment.id);
      writingFailed = false; status();
    }).catch(() => {
      if (disposed || generation !== attempt) { own.delete(segment.id); unsent.delete(segment.id); return; }
      writingFailed = true; status();
    });
  };
  const recorder = createTraceRecorder({ storage, layout, name: () => nickname, onSegment(segment) {
    if (!validTrace(segment, rooms, layout)) return;
    own.set(segment.id, segment);
    if (online && enabled) send(segment);
    else unsent.add(segment.id);
  } });
  const sync = () => {
    for (const [room, stop] of watches) if (!roomIds.includes(room)) {
      stop(); watches.delete(room); remote.delete(room); failedRooms.delete(room);
    }
    if (!ready || !online || disposed) return;
    for (const room of roomIds) if (!watches.has(room)) {
      // Install placeholder first because local adapters can deliver synchronously.
      watches.set(room, () => {});
      const stop = social.watchVisitorTraces({ room, layout }, entries => {
        remote.set(room, entries); failedRooms.delete(room); status();
      }, () => { remote.delete(room); failedRooms.add(room); status(); });
      watches.set(room, stop);
    }
  };
  return {
    mesh: renderer.mesh,
    labels: labels.group,
    reset: recorder.reset,
    setName(value) { nickname = cleanTraceName(value); },
    setEnabled(value) {
      enabled = value; generation++; recorder.reset();
      if (!value) { for (const id of unsent) own.delete(id); unsent.clear(); }
    },
    // A hidden tab cannot move, so the path being formed waits for the tab to return.
    suspend() { roomIds = []; sync(); },
    start() {
      if (started) return;
      started = true;
      social.initSocial().then(() => {
        if (disposed) return;
        ready = true; online = social.canShareVisitorTraces(); status(); sync();
        // Preserve the first few steps taken while anonymous sign-in was still loading.
        // This is an in-memory initialization buffer, never an offline upload queue.
        if (online && enabled) for (const id of [...unsent]) {
          const segment = own.get(id);
          if (segment) send(segment);
        }
      }).catch(() => { ready = true; status(); });
    },
    update({ position, room, active, hidden = false, time = Date.now() }) {
      const current = rooms[room];
      const wanted = !started || hidden || !current ? [] : rooms.map((r, i) => ({ r, i }))
        .filter(({ r, i }) => r.floor === current.floor && Math.abs(i - room) <= 1).map(({ i }) => i);
      if (wanted.join() !== roomIds.join()) { roomIds = wanted; sync(); }
      recorder.sample(position, room, started && enabled && active && !hidden);
      if (time - lastDraw < 50) return;
      lastDraw = time;
      for (const [id, s] of own) if (s.expiresAt <= time) own.delete(id);
      const merged = new Map(own);
      for (const entries of remote.values()) for (const s of entries) merged.set(s.id, s);
      const selected = visibleTraceSegments([...merged.values()], { rooms, layout, roomIds, limit, now: time });
      labels.draw(renderer.draw(selected, rooms, recorder.pending, recorder.pendingRoom, time), rooms, time);
    },
    dispose() {
      disposed = true; for (const stop of watches.values()) stop(); watches.clear();
      renderer.dispose(); labels.dispose();
    },
  };
}
