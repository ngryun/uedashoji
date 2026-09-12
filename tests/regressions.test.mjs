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
