import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createTraceRecorder, visibleTraceSegments, validTrace, traceLayout, tracePreference,
  saveTracePreference, cleanTraceName, traceName, saveTraceName, traceLabel, TRACE_LIFETIME,
  TRACE_START_MIN, TRACE_START_SPREAD } from '../visitor-traces.js';

const storage = () => { const values = new Map(); return {
  getItem: k => values.get(k), setItem: (k, v) => values.set(k, v),
}; };
const rooms = [{ floor: 0, elevation: 0, W: 16, zFrom: 14, zTo: -100 },
  { floor: 1, elevation: 5.2, W: 16, zFrom: 14, zTo: -100 }];
const layout = traceLayout(rooms);
// Most tests start paths at once; the arrival clearance has its own tests below.
function setup(shared = storage(), name = () => '', options = { startAfter: () => 0 }) {
  let time = 100000;
  const segments = [];
  const recorder = createTraceRecorder({ storage: shared, layout, id: () => 'visit', name,
    now: () => time, onSegment: s => segments.push(s), ...options });
  const walk = (start, end, room = 0, active = true) => {
    const sign = end > start ? 1 : -1;
    for (let z = start; sign * (end - z) >= -0.001; z += sign * 0.1) recorder.sample({ x: 0, z }, room, active);
  };
  return { recorder, segments, walk, setTime: v => { time = v; }, storage: shared };
}

test('six steps alternate sides, spaced by distance and point along actual travel', () => {
  const s = setup(); s.walk(10, 6);
  assert.equal(s.segments.length, 1);
  assert.equal(s.segments[0].points.length, 6);
  const p = s.segments[0].points;
  for (let i = 0; i < p.length; i++) {
    assert.equal(p[i].x < 0, i % 2 === 0);
    assert.ok(Math.abs(p[i].angle) < 1e-6);
    if (i) assert.ok(Math.abs(p[i - 1].z - p[i].z - 0.65) < 1e-6);
  }
  assert.equal(s.segments[0].expiresAt - s.segments[0].createdAt, TRACE_LIFETIME);
});

test('room quotas survive reload; both time and distance separate the second segment', () => {
  const s = setup(); s.walk(10, 6); s.walk(6, -5);
  assert.equal(s.segments.length, 1);
  const reload = setup(s.storage); reload.setTime(131000); reload.walk(6, 5);
  assert.equal(reload.recorder.pending.length, 0);
  reload.walk(5, -3);
  assert.equal(reload.segments.length, 1);
  reload.setTime(200000); reload.walk(-3, -20);
  assert.equal(reload.segments.length, 1);
  const again = setup(s.storage); again.setTime(300000); again.walk(-20, -30);
  assert.equal(again.segments.length, 0);
  again.walk(10, 6, 1); assert.equal(again.segments.length, 1);
});

test('a pause keeps the path being formed; moving while paused or teleporting discards it', () => {
  for (const reason of ['viewer', 'esc', 'hidden']) {
    const s = setup(); s.walk(10, 8);
    assert.equal(s.recorder.pending.length, 3);
    for (let i = 0; i < 50; i++) s.recorder.sample({ x: 0, z: 8 }, 0, false);
    assert.equal(s.recorder.pending.length, 3, reason);
    s.walk(8, 5); assert.equal(s.segments.length, 1, reason);
  }
  for (const reason of ['jump', 'stairs', 'auto']) {
    const s = setup(); s.walk(10, 8);
    s.walk(8, 6, 0, false);
    assert.equal(s.recorder.pending.length, 3, reason);
    s.walk(6, 5);
    assert.equal(s.recorder.pending.length, 1, reason);
    assert.equal(s.segments.length, 0, reason);
  }
  const s = setup(); s.walk(10, 8); s.walk(-40, -42);
  assert.equal(s.segments.length, 0);
  s.recorder.reset(); s.walk(-42, -44);
  assert.equal(s.segments.length, 0);
});

test('nickname is cleaned, capped at eight characters and stored only when present', () => {
  assert.equal(cleanTraceName('  민준\t 남궁 '), '민준 남궁');
  assert.equal(cleanTraceName('abcdefghijk'), 'abcdefgh');
  assert.equal(cleanTraceName(['👨‍👩‍👧 x', 'y'].join(String.fromCharCode(0))), '👨‍👩‍👧 xy');
  assert.equal(cleanTraceName(null), '');
  let name = ' 민준 ';
  const s = setup(storage(), () => name); s.walk(10, 6);
  assert.equal(s.segments[0].name, '민준');
  name = ''; s.setTime(200000); s.walk(0, -5);
  assert.equal(s.segments.length, 2);
  assert.equal('name' in s.segments[1], false);
  assert.equal(traceLabel({ createdAt: new Date(2026, 8, 26, 10).getTime(), name: '민준' }), '민준 · 2026.9.26');
  assert.equal(traceLabel({ createdAt: new Date(2026, 8, 26, 10).getTime() }), '2026.9.26');
  const data = storage(); saveTraceName(data, ' 하늘 '); assert.equal(traceName(data), '하늘');
  assert.equal(traceName(storage()), '');
});

test('standing still makes no steps; changing rooms does not join paths', () => {
  const s = setup();
  for (let i = 0; i < 100; i++) s.recorder.sample({ x: 0, z: 10 }, 0, true);
  assert.equal(s.recorder.pending.length, 0);
  s.walk(10, 8); s.walk(8, 6, 1);
  assert.equal(s.segments.length, 0);
});

test('preferences and blocked storage are safe; unchecked survives reload', () => {
  const data = storage(); assert.equal(tracePreference(data), true);
  saveTracePreference(data, false); assert.equal(tracePreference(data), false);
  const blocked = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } };
  assert.equal(tracePreference(blocked), true);
  saveTracePreference(blocked, false);
  const s = setup(blocked); s.walk(10, 6); assert.equal(s.segments.length, 1);
});

function segment(id, x = 0, createdAt = 100000) {
  return { id, room: 0, layout, createdAt, expiresAt: createdAt + TRACE_LIFETIME,
    points: Array.from({ length: 6 }, (_, i) => ({ x, z: 10 - i * 0.65, angle: 0 })) };
}
test('expiry, room bounds, layout changes and malformed points are excluded', () => {
  assert.equal(validTrace(segment('good'), rooms, layout, 100000), true);
  for (const s of [{ ...segment('old'), createdAt: 100000 - TRACE_LIFETIME },
    { ...segment('ttl'), expiresAt: 100000 }, { ...segment('layout'), layout: 'old' },
    { ...segment('bad'), points: [] }, segment('out', 20), segment('nan', NaN)]) {
    assert.equal(validTrace(s, rooms, layout, 100000), false);
  }
  assert.notEqual(traceLayout(rooms), traceLayout([{ ...rooms[0], zTo: -99 }, rooms[1]]));
  assert.equal(validTrace({ ...segment('named'), name: '민준' }, rooms, layout, 100000), true);
  for (const name of ['', ' 민준', 'abcdefghi', 3, null]) {
    assert.equal(validTrace({ ...segment('bad-name'), name }, rooms, layout, 100000), false, String(name));
  }
});
test('dense paths are omitted whole, own echo is deduplicated and display caps hold', () => {
  const a = segment('a'), b = segment('b', 0.1, 99999), c = segment('c', 2);
  const options = { rooms, layout, roomIds: [0], limit: 144, now: 100000 };
  assert.deepEqual(visibleTraceSegments([a, a, b, c], options).map(s => s.id), ['a', 'c']);
  assert.equal(visibleTraceSegments([a, c], { ...options, limit: 6 }).length, 1);
  assert.equal(visibleTraceSegments([a], { ...options, roomIds: [1] }).length, 0);
  const spread = Array.from({ length: 40 }, (_, i) => ({ ...segment(String(i), i % 10 - 5),
    points: segment('x').points.map(p => ({ ...p, x: i % 10 - 5, z: p.z - 5 * Math.floor(i / 10) })) }));
  assert.equal(visibleTraceSegments(spread, options).length * 6, 144);
  assert.equal(visibleTraceSegments(spread, { ...options, limit: 72 }).length * 6, 72);
});

import { createVisitorTraces } from '../visitor-traces.js';
const flush = () => new Promise(resolve => setImmediate(resolve));
function controller(t, adapter = {}) {
  const original = globalThis.document;
  globalThis.document = { createElement: () => ({ getContext: () => ({
    beginPath() {}, ellipse() {}, fill() {}, clearRect() {}, fillText() {}, measureText: () => ({ width: 320 }),
  }) }) };
  t.after(() => { globalThis.document = original; });
  const watched = [], stopped = [], statuses = [];
  const social = { initSocial: async () => {}, canShareVisitorTraces: () => true, canSaveVisitorTraces: () => true,
    saveVisitorTrace: async () => true,
    watchVisitorTraces(options, cb, error) { watched.push({ ...options, cb, error }); return () => stopped.push(options.room); },
    ...adapter };
  const view = createVisitorTraces({ rooms, mobile: false, social, storage: storage(), onStatus: v => statuses.push(v),
    startAfter: () => 0 });
  t.after(() => view.dispose());
  let time = Date.now();
  const tick = (z, active = true, room = 0, hidden = false) => view.update({ position: { x: 0, z }, room, active, hidden, time: time += 60 });
  const walk = () => { for (let z = 10; z >= 5.9; z -= .1) tick(z); };
  return { view, watched, stopped, statuses, tick, walk };
}
test('controller starts only on entry, unsubscribes on hiding and switches floors', async t => {
  const c = controller(t);
  c.tick(10); assert.equal(c.watched.length, 0); assert.equal(c.view.mesh.count, 0);
  c.view.start(); await flush(); c.tick(10);
  assert.equal(c.watched.length, 1); assert.equal(c.watched[0].room, 0);
  c.tick(10, false, 1); assert.deepEqual(c.stopped, [0]);
  assert.equal(c.watched[1].room, 1);
  c.view.suspend(); assert.deepEqual(c.stopped, [0, 1]);
  c.tick(10, false, 1, true); assert.equal(c.watched.length, 2);
  c.tick(10, false, 1); assert.equal(c.watched.length, 3);
});
test('failed writes keep local footsteps, do not retry, and opt-out discards unsent paths', async t => {
  let attempts = 0;
  const c = controller(t, { saveVisitorTrace: async () => { attempts++; throw Error('offline'); } });
  c.view.start(); await flush(); c.walk(); await flush();
  assert.equal(attempts, 1); assert.equal(c.view.mesh.count, 6);
  assert.equal(c.statuses.at(-1), 'unavailable');
  c.view.setEnabled(false); c.tick(5); assert.equal(c.view.mesh.count, 0);
  assert.equal(c.view.labels.children.filter(m => m.visible).length, 0);
  for (let z = 5; z > 0; z -= .1) c.tick(z);
  assert.equal(attempts, 1);
});
test('each drawn path gets one floor label just past its last step, carrying the chosen nickname', async t => {
  let saved;
  const c = controller(t, { saveVisitorTrace: async s => { saved = s; return true; } });
  const visible = () => c.view.labels.children.filter(m => m.visible);
  c.view.start(); await flush(); c.tick(10); assert.equal(visible().length, 0);
  c.view.setName(' 민준 '); c.walk(); await flush(); c.tick(5.9);
  assert.equal(saved.name, '민준'); assert.equal(visible().length, 1);
  const label = visible()[0];
  assert.ok(Math.abs(label.position.z - 5.6) < 0.02 && Math.abs(label.position.x) < 0.1);
  assert.equal(label.rotation.order, 'YXZ');
  c.view.setEnabled(false); c.tick(5.9); assert.equal(visible().length, 1, 'already sent steps keep their label');
});
test('opt-out cancels a write still awaiting its transaction read', async t => {
  let mayWrite, finish;
  const c = controller(t, { saveVisitorTrace: (_segment, check) => {
    mayWrite = check; return new Promise(resolve => { finish = resolve; });
  } });
  c.view.start(); await flush(); c.walk(); assert.equal(mayWrite(), true);
  c.view.setEnabled(false); assert.equal(mayWrite(), false);
  finish(false); await flush(); c.tick(5); assert.equal(c.view.mesh.count, 0);
});
test('remote echo replaces the local segment, and query failures never invent visitors', async t => {
  let saved;
  const c = controller(t, { saveVisitorTrace: async s => { saved = s; return true; } });
  c.view.start(); await flush(); c.walk(); await flush();
  c.watched[0].cb([saved]); c.tick(5.9); assert.equal(c.view.mesh.count, 6);
  c.watched[0].error(Error('denied')); c.tick(5.9);
  assert.equal(c.view.mesh.count, 6); assert.equal(c.statuses.at(-1), 'unavailable');
  c.view.setEnabled(false); c.tick(5.9); assert.equal(c.view.mesh.count, 6, 'already sent steps remain');
});


test('main scene gates recording on actual control, floor and movement state', () => {
  const main = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
  const body = main.slice(main.indexOf('function updateVisitorTraces()'), main.indexOf('const clock = new THREE.Clock()'));
  let captured;
  const base = () => ({ player: { pos: { x: 0, z: 10 }, floor: 0, onGround: true },
    rooms, roomIndexAt: () => 0, visitorTraces: { update: v => { captured = v; } },
    document: { hidden: false }, controlsActive: true, autoTour: { active: false }, viewerOpen: false,
    stairProgressAt: () => null, inSecretZone: () => false, RADIUS: .38 });
  const check = change => { const context = base(); change(context); vm.runInNewContext(body + '\nupdateVisitorTraces();', context); return captured; };
  assert.equal(check(() => {}).active, true);
  for (const change of [c => { c.controlsActive = false; }, c => { c.autoTour.active = true; },
    c => { c.player.onGround = false; }, c => { c.viewerOpen = true; },
    c => { c.stairProgressAt = () => .5; }, c => { c.inSecretZone = () => true; },
    c => { c.player.pos.x = 9; }, c => { c.player.pos.z = 15; },
    c => { c.player.pos.z = 13.95; }, c => { c.player.pos.z = -99.95; }]) {
    assert.equal(check(change).active, false);
  }
  // Wall contact settles exactly on W/2 - RADIUS (or a float hair past it); it still records.
  assert.equal(check(c => { c.player.pos.x = 8 - .38 + 1e-15; }).active, true);
  assert.equal(check(c => { c.player.pos.x = 8 - .38 + .02; }).active, false);
  assert.equal(check(c => { c.player.pos.x = -(8 - .38); }).active, true);
  assert.equal(check(c => { c.document.hidden = true; }).hidden, true);
});

test('a walk during initial sign-in is shared once ready, unless opted out first', async t => {
  for (const optOut of [false, true]) {
    let ready, writes = 0;
    const c = controller(t, { initSocial: () => new Promise(resolve => { ready = resolve; }),
      saveVisitorTrace: async () => { writes++; return true; } });
    c.view.start(); c.walk(); assert.equal(writes, 0);
    if (optOut) c.view.setEnabled(false);
    ready(); await flush(); assert.equal(writes, optOut ? 0 : 1);
    c.view.dispose();
  }
});

test('paths begin only after walking a varied distance away from where the visitor arrived', () => {
  const s = setup(storage(), () => '', { startAfter: () => 3 });
  s.walk(10, 4);
  assert.equal(s.segments.length, 0, 'spawn clearance plus six steps does not fit in 6m');
  s.walk(4, 2);
  const first = s.segments[0].points[0];
  assert.ok(10 - first.z > 3.5 && 10 - first.z < 3.7, String(first.z));
  // Straight-line distance, not distance walked: circling near the entrance never starts a path.
  const circle = setup(storage(), () => '', { startAfter: () => 3 });
  for (let a = 0; a < 40; a += 0.1) circle.recorder.sample({ x: Math.cos(a), z: 10 + Math.sin(a) }, 0, true);
  assert.equal(circle.recorder.pending.length, 0);
  assert.equal(circle.segments.length, 0, 'about 40m walked, never 3m away');
  // Every arrival (doorway, floor switch via reset) needs its own clearance; a jump landing does not.
  const doors = setup(storage(), () => '', { startAfter: () => 3 });
  doors.walk(10, 5); assert.ok(doors.recorder.pending.length > 0);
  doors.walk(5, 2.1, 1); assert.equal(doors.recorder.pending.length, 0, 'doorway');
  doors.walk(2.1, 1.2, 1); assert.ok(doors.recorder.pending.length > 0);
  doors.walk(1.2, -1.7, 1, false); doors.walk(-1.7, -2.5, 1);
  assert.equal(doors.recorder.pending.length, 1, 'jump landing keeps the doorway arrival');
  doors.recorder.reset(); doors.walk(-2.5, -5.4, 1);
  assert.equal(doors.recorder.pending.length, 0, 'floor switch');
});

test('a path that turns back toward the arrival point is not kept', () => {
  // Peeks 4m in and heads back out: the old rule finished this path 1.1m from the doorway.
  const s = setup(storage(), () => '', { startAfter: () => 3 });
  s.walk(10, 6); assert.ok(s.recorder.pending.length > 0);
  s.walk(6, 9.5);
  assert.equal(s.segments.length, 0); assert.equal(s.recorder.pending.length, 0);
  // Turning back early enough still keeps a path, with every step clear of the arrival point.
  const far = setup(storage(), () => '', { startAfter: () => 3 });
  far.walk(10, 5); far.walk(5, 9.5);
  assert.equal(far.segments.length, 1);
  for (const p of far.segments[0].points) assert.ok(Math.hypot(p.x, 10 - p.z) >= 3, String(p.z));
});

test('the arrival clearance varies between visitors within the configured range', t => {
  for (const [random, clearance] of [[0, TRACE_START_MIN], [0.999999, TRACE_START_MIN + TRACE_START_SPREAD]]) {
    t.mock.method(Math, 'random', () => random);
    const s = setup(storage(), () => '', {});
    s.walk(10, 0);
    const away = 10 - s.segments[0].points[0].z;
    assert.ok(away > clearance + 0.5 && away < clearance + 0.7, `${random}: ${away}`);
    t.mock.restoreAll();
  }
});

test('a path no viewer would draw is dropped without using up the room slot', () => {
  let allow = false; const checked = [];
  const s = setup(storage(), () => '', { startAfter: () => 0, accept: segment => { checked.push(segment); return allow; } });
  s.walk(10, 6);
  assert.equal(checked.length, 1); assert.equal(s.segments.length, 0); assert.equal(s.recorder.pending.length, 0);
  allow = true; s.walk(6, 2);
  assert.equal(s.segments.length, 1); assert.equal(s.segments[0].id, 'visit-0-0');
});

test('visit ids do not need crypto.randomUUID (plain-HTTP LAN pages, older Safari)', t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { configurable: true,
    value: { getRandomValues: bytes => bytes.fill(171) } });
  t.after(() => Object.defineProperty(globalThis, 'crypto', original));
  const data = storage();
  createTraceRecorder({ storage: data, layout, onSegment() {} });
  assert.equal(JSON.parse(data.getItem('guest.traces.visit.v1')).id, 'ab'.repeat(16));
});

test('test pages read shared footprints but keep their own walk on screen only', async t => {
  let writes = 0;
  const c = controller(t, { canSaveVisitorTraces: () => false, saveVisitorTrace: async () => { writes++; return true; } });
  c.view.start(); await flush(); c.walk(); await flush();
  assert.equal(writes, 0); assert.equal(c.statuses.at(-1), 'preview');
  assert.equal(c.watched.length, 1); assert.equal(c.view.mesh.count, 6);
  // Steps taken while sign-in is still loading are not flushed to the shared collection either.
  let ready;
  const early = controller(t, { initSocial: () => new Promise(resolve => { ready = resolve; }),
    canSaveVisitorTraces: () => false, saveVisitorTrace: async () => { writes++; return true; } });
  early.view.start(); early.walk(); ready(); await flush();
  assert.equal(writes, 0); assert.equal(early.view.mesh.count, 6);
});

test('a segment outside the room is neither saved nor counted against the room', async t => {
  let writes = 0;
  const c = controller(t, { saveVisitorTrace: async () => { writes++; return true; } });
  c.view.start(); await flush();
  let time = Date.now();
  for (let z = 10; z >= 5.9; z -= .1) c.view.update({ position: { x: 7.95, z }, room: 0, active: true, time: time += 60 });
  await flush(); assert.equal(writes, 0);
  c.walk(); await flush(); assert.equal(writes, 1);
});

test('development hosts and preview pages never save footprints to the shared collection', async () => {
  const source = readFileSync(new URL('../social.js', import.meta.url), 'utf8')
    .replace(/^import .*;$/m, '').replaceAll('export ', '');
  const page = (hostname, search = '') => {
    const context = vm.createContext({ console, URLSearchParams, globalThis: { location: { hostname, search } } });
    vm.runInContext(source, context);
    // Signed in to Firebase, so only the page decides whether a walk may be saved.
    vm.runInContext("mode = 'firebase'; fb = { authUser: { uid: 'visitor' } };", context);
    return context;
  };
  const testPage = (hostname, search) => vm.runInContext('testPage()', page(hostname, search));
  // Any IP address (loopback, LAN, link-local, IPv6, 0.0.0.0 from serve.mjs) or local name is a test page.
  for (const host of ['localhost', 'localhost.', '127.0.0.1', '0.0.0.0', '[::1]', '[fd00::5]', '[fe80::1]', '[::ffff:7f00:1]',
    '192.168.0.12', '10.1.2.3', '172.20.1.1', '169.254.10.1', '100.101.102.103', '203.0.113.7', 'museum.localhost', 'mac.local', 'mac.local.']) {
    assert.equal(testPage(host), true, host);
  }
  for (const host of ['ngryun.github.io', 'ngryun.github.io.', '192.168.example.com', 'localhost.example.com']) {
    assert.equal(testPage(host), false, host);
  }
  assert.equal(testPage('ngryun.github.io', '?preview=cinema'), true);
  assert.equal(testPage('ngryun.github.io', '?touch=1'), false);
  const local = page('localhost');
  assert.equal(vm.runInContext('canShareVisitorTraces()', local), true, 'still reads');
  assert.equal(vm.runInContext('canSaveVisitorTraces()', local), false);
  await assert.rejects(vm.runInContext('saveVisitorTrace({ id: "x", room: 0, points: [] })', local), /TRACE_SHARING_UNAVAILABLE/);
  assert.equal(vm.runInContext('canSaveVisitorTraces()', page('ngryun.github.io')), true);
});

test('the sharing notice follows the recording switch', () => {
  const main = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
  const body = main.slice(main.indexOf('let traceSharing'), main.indexOf('function setTraceName'));
  const context = vm.createContext({ tracesEnabled: true, traceStatus: {}, traceHudBtn: {}, visitorTraces: null,
    tracePreferences: null, saveTracePreference() {}, updateTraceUI() {} });
  vm.runInContext(body, context);
  const { traceStatus } = context;
  context.updateTraceStatus('local');
  assert.equal(traceStatus.hidden, false); assert.match(traceStatus.textContent, /공유에 연결되지 않아/);
  context.setTracesEnabled(false);
  assert.equal(traceStatus.hidden, true, 'OFF hides a notice that was already showing');
  context.updateTraceStatus('unavailable'); assert.equal(traceStatus.hidden, true);
  context.setTracesEnabled(true);
  assert.equal(traceStatus.hidden, false, 'ON shows the last known state again');
  context.updateTraceStatus('preview'); assert.match(traceStatus.textContent, /개발·미리보기/);
  context.updateTraceStatus('shared'); assert.equal(traceStatus.hidden, true);
});
