import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const main = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const social = readFileSync(new URL('../social.js', import.meta.url), 'utf8')
  .replace(/^import .*;$/m, '').replaceAll('export ', '');

function socialContext(failKey) {
  const storage = new Map([['guest.owner.v1', 'owner']]);
  const context = vm.createContext({ console, globalThis, localStorage: {
    getItem: key => storage.get(key) ?? null,
    setItem(key, value) {
      if (key === failKey) throw new Error('QuotaExceededError');
      storage.set(key, value);
    },
  } });
  vm.runInContext(social, context);
  return { context, storage };
}

const entry = "{ name: 'Test', school: '', message: 'Hello world' }";
test('failed local create rejects without setting the cooldown', async () => {
  const { context, storage } = socialContext('guest.guestbook.v1');
  await assert.rejects(vm.runInContext(`addGuestbookEntry(${entry})`, context), /QuotaExceededError/);
  assert.equal(storage.has('guest.guestbook.v1'), false);
  assert.equal(vm.runInContext('postCooldownLeft()', context), 0);
});

test('failed local update preserves the stored entry', async () => {
  const { context, storage } = socialContext('guest.guestbook.v1');
  const original = JSON.stringify([{ id: 'test', ownerId: 'owner', message: 'Original' }]);
  storage.set('guest.guestbook.v1', original);
  await assert.rejects(vm.runInContext(`updateGuestbookEntry('test', ${entry})`, context), /QuotaExceededError/);
  assert.equal(storage.get('guest.guestbook.v1'), original);
});

test('cooldown storage failure does not turn a successful post into a failure', async () => {
  const { context, storage } = socialContext('guest.lastPost.v1');
  const result = await vm.runInContext(`addGuestbookEntry(${entry})`, context);
  assert.equal(JSON.parse(storage.get('guest.guestbook.v1'))[0].id, result.id);
  assert.ok(vm.runInContext('postCooldownLeft()', context) > 0);
  await assert.rejects(vm.runInContext(`addGuestbookEntry(${entry})`, context), /COOLDOWN/);
});

test('text inputs keep Space while game input still handles jumping', () => {
  const handlers = {};
  const context = { document: { addEventListener: (n, fn) => handlers[n] = fn },
    window: { addEventListener() {} }, keys: {}, controlsActive: false, viewerOpen: false,
    autoTour: { active: false } };
  vm.runInNewContext(main.slice(main.indexOf("document.addEventListener('keydown'"),
    main.indexOf('/* 데스크톱: 포인터 락 */')), context);
  const pressSpace = (input) => {
    let prevented = false;
    handlers.keydown({ code: 'Space', repeat: false,
      target: { closest: () => input }, preventDefault() { prevented = true; } });
    return prevented;
  };
  assert.equal(pressSpace(true), false);
  context.controlsActive = true;
  assert.equal(pressSpace(true), false);
  assert.equal(context.keys.Space, undefined);
  assert.equal(pressSpace(false), true);
  assert.equal(context.keys.Space, true);
});

test('panel-driven unlock keeps start hidden but ESC still opens it', () => {
  let onChange;
  let shown = false;
  const context = vm.createContext({
    document: { pointerLockElement: null, addEventListener: (_, fn) => onChange = fn },
    renderer: { domElement: {} }, IS_TOUCH: false, viewerOpen: false, quizOpen: false,
    autoTour: { active: false }, controlsActive: false,
    startEl: { classList: { remove() { shown = true; } }, setAttribute() {}, inert: true },
    touchUIEl: { setAttribute() {} }, btnJump: {}, btnRun: {}, enterBtn: {},
  });
  vm.runInContext(main.slice(main.indexOf('let wasLocked = false;'),
    main.indexOf("document.addEventListener('mousemove'")) + '\nwasLocked = true;', context);
  onChange();
  assert.equal(shown, false);
  context.controlsActive = true;
  onChange();
  assert.equal(shown, true);
});

test('local subscribers receive create and edit changes and can unsubscribe', async () => {
  const { context } = socialContext();
  vm.runInContext('var snapshots = []; var stop = watchGuestbook(entries => snapshots.push(entries));', context);
  const result = await vm.runInContext(`addGuestbookEntry(${entry})`, context);
  assert.equal(vm.runInContext('snapshots.length', context), 2);
  await vm.runInContext(`updateGuestbookEntry('${result.id}', {message:'Updated'})`, context);
  assert.equal(vm.runInContext('snapshots.at(-1)[0].message', context), 'Updated');
  vm.runInContext('stop()', context);
  await vm.runInContext(`updateGuestbookEntry('${result.id}', {message:'Another update'})`, context);
  assert.equal(vm.runInContext('snapshots.length', context), 3);
});

test('slow computers step the rendering resolution down, brief hitches do not', () => {
  const body = main.slice(main.indexOf('const frameCheck = '), main.indexOf('const clock = new THREE.Clock()'));
  const run = (frameMs, seconds, { ratio = 1.5, hitchEvery = 0 } = {}) => {
    const renderer = { ratio, getPixelRatio() { return this.ratio; }, setPixelRatio(v) { this.ratio = v; } };
    const context = vm.createContext({ controlsActive: true, viewerOpen: false, document: { hidden: false },
      window: { devicePixelRatio: 2 }, renderer, pixelRatioCap: ratio, Math, Object });
    vm.runInContext(body, context);
    let now = 1000;
    for (let i = 0; now < 1000 + seconds * 1000; i++) {
      now += hitchEvery && i % hitchEvery === 0 ? 40 : frameMs;
      context.adaptResolution(now);
    }
    return renderer.ratio;
  };
  assert.equal(run(16.7, 10), 1.5, 'a smooth 60fps keeps 1.5x');
  assert.equal(run(16.7, 10, { hitchEvery: 4 }), 1.5, 'occasional photo-loading hitches are ignored');
  assert.equal(run(33, 2.5), 1.25, 'one slow window lowers one step');
  assert.equal(run(33, 20), 1, 'never below 1x');
  assert.equal(run(16.7, 10, { ratio: 1 }), 1);
});

test('other floor and outdoor scenery are drawn only when an opening or window can be in view', async () => {
  const THREE = await import('../lib/three.module.js');
  const body = main.slice(main.indexOf('const OPENING_REACH'), main.indexOf('/* ═══════════════════ 룸 매니저'));
  const group = () => ({ visible: true });
  const rooms = [
    { floor: 0, zFrom: 14, zTo: 0 }, { floor: 0, zFrom: 0, zTo: -30 }, { floor: 0, zFrom: -30, zTo: -98 },
    { floor: 1, zFrom: 14, zTo: 0 }, { floor: 1, zFrom: 0, zTo: -13 }, { floor: 1, zFrom: -13, zTo: -40 },
    { floor: 1, zFrom: -40, zTo: -85 },
  ].map(room => ({ ...room, group: group() }));
  const camera = new THREE.PerspectiveCamera(72, 16 / 9, 0.18, 400);
  camera.rotation.order = 'YXZ';
  const player = { floor: 0, pos: new THREE.Vector3() };
  const daisenLandscape = { group: group(), sky: group() };
  const context = vm.createContext({ THREE, camera, rooms, player, daisenLandscape,
    challenge: { bounds: { wallX: -7.2, zS: -9.5, zN: -3.5 } },
    stairProgressAt: () => null, WALL_H: 5, FLOOR_HEIGHT: 5.2 });
  vm.runInContext(`${body}
    openingBoxes.push(new THREE.Box3(new THREE.Vector3(3.2, 4.9, -83.2), new THREE.Vector3(5.6, 5.3, -75.8)));
    windowBoxes.push(new THREE.Box3(new THREE.Vector3(8.1, 0.6, 0), new THREE.Vector3(8.3, 5, 14)));`, context);
  const look = (floor, x, z, yaw, pitch = 0) => {
    player.floor = floor; player.pos.set(x, 1.7 + floor * 5.2, z);
    camera.position.copy(player.pos); camera.rotation.set(pitch, yaw, 0);
    context.updateHiddenAreas();
    return { rooms: rooms.map(room => room.group.visible), outside: daisenLandscape.sky.visible };
  };
  // Day 1에서 서쪽 벽을 보면 개구부도 창도 시야에 없으므로 2층과 풍경을 그리지 않는다.
  assert.deepEqual(look(0, 0, -15, Math.PI / 2), { rooms: [true, true, true, false, false, false, false], outside: false });
  // Day 2 북쪽 개구부를 올려다보면 그 위의 Day 3만 함께 그린다.
  assert.deepEqual(look(0, 0, -60, 0, 0.3).rooms, [true, true, true, false, false, false, true]);
  // 로비 유리창을 보면 풍경을 그린다.
  assert.equal(look(0, 0, 7, -Math.PI / 2).outside, true);
  // 비밀 통로에서는 트인 옆면으로 1층과 하늘이 보인다.
  assert.deepEqual(look(1, -20, -6.5, Math.PI), { rooms: rooms.map(() => true), outside: true });
});
