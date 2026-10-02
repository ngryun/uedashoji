import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../main.js', import.meta.url), 'utf8');

test('touch API presence alone does not select touch controls on a desktop', () => {
  const detection = source.slice(source.indexOf('const IS_TOUCH ='), source.indexOf('const EYE ='));
  for (const [touchPoints, search, expected] of [
    [0, '', false], [5, '', true], [0, '?touch=1', true],
  ]) {
    assert.equal(vm.runInNewContext(detection + 'IS_TOUCH', {
      navigator: { maxTouchPoints: touchPoints }, location: { search },
      window: { ontouchstart: null },
    }), expected);
  }
});

function setup(touch = false) {
  const canvasHandlers = {}, windowHandlers = {}, documentHandlers = {}, views = [];
  const canvas = { addEventListener: (name, handler) => { canvasHandlers[name] = handler; } };
  const context = vm.createContext({
    IS_TOUCH: touch, controlsActive: true, renderer: { domElement: canvas },
    document: { pointerLockElement: null,
      addEventListener: (name, handler) => { documentHandlers[name] = handler; } },
    window: { addEventListener: (name, handler) => { windowHandlers[name] = handler; } },
    player: { yaw: 0, pitch: 0 }, autoTour: { active: false },
    stopAutoTour() { context.autoTour.active = false; },
    tryViewAt: (x, y) => views.push([x, y]),
  });
  vm.runInContext(source.slice(source.indexOf("document.addEventListener('mousemove'"),
    source.indexOf('/* 모바일:')), context);
  const event = { pointerType: 'mouse', pointerId: 1, button: 0, buttons: 1, clientX: 100, clientY: 100 };
  return { context, canvas, views,
    down: overrides => canvasHandlers.pointerdown({ ...event, ...overrides }),
    move: overrides => windowHandlers.pointermove({ ...event, clientX: 200, clientY: 150, ...overrides }),
    up: overrides => windowHandlers.pointerup({ ...event, buttons: 0, ...overrides }),
    cancel: () => windowHandlers.pointercancel(event),
    blur: () => windowHandlers.blur(),
    lockedMove: () => documentHandlers.mousemove({ movementX: 100, movementY: 50 }),
  };
}

test('mouse drag rotates in desktop and touch UI modes when pointer lock is unavailable', () => {
  for (const touch of [false, true]) {
    const { context, down, move, up, views } = setup(touch);
    down(); move(); up();
    assert.ok(Math.abs(context.player.yaw + 0.35) < 1e-10);
    assert.ok(Math.abs(context.player.pitch + 0.175) < 1e-10);
    assert.equal(views.length, 0);
  }
});

test('touch input, right click and unrelated pointers do not rotate with the mouse handler', () => {
  const { context, down, move } = setup(true);
  down({ pointerType: 'touch' }); move();
  down({ button: 2 }); move();
  down(); move({ pointerId: 2 });
  assert.equal(context.player.yaw, 0);
});

test('short mouse clicks still open artwork and a cancelled drag never opens it', () => {
  const { down, up, cancel, views } = setup(true);
  down(); up();
  assert.deepEqual(views, [[100, 100]]);
  down(); cancel(); up();
  assert.equal(views.length, 1);
});

test('blur, released button and an open panel stop a drag', () => {
  for (const reason of ['blur', 'released', 'panel']) {
    const { context, down, move, blur } = setup();
    down();
    if (reason === 'blur') blur();
    if (reason === 'panel') context.controlsActive = false;
    move(reason === 'released' ? { buttons: 0 } : {});
    context.controlsActive = true;
    move();
    assert.equal(context.player.yaw, 0);
  }
});

test('manual mouse drag cancels automatic touring and clamps vertical look', () => {
  const { context, down, move } = setup(true);
  context.autoTour.active = true;
  down(); move({ clientY: 10000 });
  assert.equal(context.autoTour.active, false);
  assert.equal(context.player.pitch, -1.45);
});

test('pointer lock rotates once and does not change the view while a panel is open', () => {
  const { context, canvas, down, move, lockedMove } = setup();
  down();
  context.document.pointerLockElement = canvas;
  move(); lockedMove();
  assert.ok(Math.abs(context.player.yaw + 0.22) < 1e-10);
  context.controlsActive = false;
  lockedMove();
  assert.ok(Math.abs(context.player.yaw + 0.22) < 1e-10);
});

test('unsupported or rejected pointer lock explains the drag fallback', async () => {
  const lock = source.slice(source.indexOf('function lockPointer()'), source.indexOf('let wasLocked = false;'));
  for (const requestPointerLock of [undefined, () => Promise.reject(new Error('Denied'))]) {
    const hints = [];
    const context = vm.createContext({ renderer: { domElement: { requestPointerLock } },
      controlsActive: true, autoTour: { active: false }, showHint: text => hints.push(text) });
    vm.runInContext(lock + 'lockPointer()', context);
    await Promise.resolve();
    assert.equal(hints.length, 1);
    assert.match(hints[0], /드래그/);
  }
});
