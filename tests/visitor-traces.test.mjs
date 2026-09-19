import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createTraceRecorder, visibleTraceSegments, validTrace, traceLayout,
  tracePreference, saveTracePreference, TRACE_LIFETIME } from '../visitor-traces.js';

const storage = () => { const values = new Map(); return {
  getItem: k => values.get(k), setItem: (k, v) => values.set(k, v),
}; };
const rooms = [{ floor: 0, elevation: 0, W: 16, zFrom: 14, zTo: -100 },
  { floor: 1, elevation: 5.2, W: 16, zFrom: 14, zTo: -100 }];
const layout = traceLayout(rooms);
function setup(shared = storage()) {
  let time = 100000;
  const segments = [];
  const recorder = createTraceRecorder({ storage: shared, layout, id: () => 'visit',
    now: () => time, onSegment: s => segments.push(s) });
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

test('pauses, jumps, stairs and automatic mode discard partial paths; teleport cannot connect', () => {
  for (const reason of ['pause', 'jump', 'stairs', 'auto', 'hidden']) {
    const s = setup(); s.walk(10, 8);
    assert.equal(s.recorder.pending.length, 3);
    s.walk(8, 7, 0, false);
    assert.equal(s.recorder.pending.length, 0, reason);
    s.walk(7, 5); assert.equal(s.segments.length, 0, reason);
  }
  const s = setup(); s.walk(10, 8); s.walk(-40, -42);
  assert.equal(s.segments.length, 0);
  s.recorder.reset(); s.walk(-42, -44);
  assert.equal(s.segments.length, 0);
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
    beginPath() {}, ellipse() {}, fill() {},
  }) }) };
  t.after(() => { globalThis.document = original; });
  const watched = [], stopped = [], statuses = [];
  const social = { initSocial: async () => {}, canShareVisitorTraces: () => true,
    saveVisitorTrace: async () => true,
    watchVisitorTraces(options, cb, error) { watched.push({ ...options, cb, error }); return () => stopped.push(options.room); },
    ...adapter };
  const view = createVisitorTraces({ rooms, mobile: false, social, storage: storage(), onStatus: v => statuses.push(v) });
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
  for (let z = 5; z > 0; z -= .1) c.tick(z);
  assert.equal(attempts, 1);
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
    c => { c.player.pos.x = 9; }, c => { c.player.pos.z = 15; }]) {
    assert.equal(check(change).active, false);
  }
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
