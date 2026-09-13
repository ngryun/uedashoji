import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const angle = source.slice(source.indexOf('function angleLerp('), source.indexOf('function setAutoButtonUI('));
const update = source.slice(source.indexOf('function updateAutoTour('), source.indexOf("autoBtn.addEventListener('click'"));
function setup(stop, blocked = false) {
  const player = { pos: { x: 0, y: 1.7, z: 0 }, yaw: 0, pitch: 0 };
  const autoTour = { active: true, idx: 0, wait: 0, stuck: 0, speed: 0 };
  const context = vm.createContext({
    player, autoTour, tourStops: [stop, { x: 0, z: -10 }],
    AUTO_SPEED: 1.1, AUTO_DWELL_PHOTO: 4, AUTO_DWELL_VIDEO: 9,
    resolveCollisions: () => { if (blocked) { player.pos.x = 0; player.pos.z = 0; } },
    stopAutoTour: () => { autoTour.active = false; }, showHint: () => {},
  });
  vm.runInContext(angle + update, context);
  return { player, autoTour, tick: dt => context.updateAutoTour(dt) };
}

test('tour turns at a bounded rate and accelerates gradually at different frame rates', () => {
  for (const dt of [1 / 120, 1 / 30, 1 / 15]) {
    const { player, autoTour, tick } = setup({ x: 0, z: 10 });
    for (let elapsed = 0; elapsed < 1; elapsed += dt) {
      const yaw = player.yaw, speed = autoTour.speed;
      tick(dt);
      assert.ok(Math.abs(player.yaw - yaw) <= Math.PI / 4 * dt + 1e-10);
      assert.ok(autoTour.speed - speed <= 0.55 * dt + 1e-10);
    }
  }
});

test('tour settles its gaze before counting viewing time and slows before arrival', () => {
  const { player, autoTour, tick } = setup({ x: 0, z: -3, art: { pos: { x: 3, y: 1.7, z: -3 } } });
  let peak = 0;
  for (let i = 0; i < 1000 && autoTour.wait === 0; i++) {
    tick(1 / 60);
    peak = Math.max(peak, autoTour.speed);
  }
  assert.ok(peak > 0.8);
  assert.equal(autoTour.speed, 0);
  assert.ok(Math.abs(player.pos.z + 3) <= 0.06);
  assert.ok(Math.abs(player.yaw + Math.PI / 2) < 0.15);
  assert.ok(autoTour.wait > 0 && autoTour.wait < 0.1);
  for (let i = 0; i < 250; i++) tick(1 / 60);
  assert.equal(autoTour.idx, 1);
});

test('blocked tour pauses in place instead of teleporting through a wall', () => {
  const { player, autoTour, tick } = setup({ x: 5, z: 0 }, true);
  for (let i = 0; i < 200 && autoTour.active; i++) tick(1 / 60);
  assert.equal(autoTour.active, false);
  assert.equal(player.pos.x, 0);
  assert.equal(player.pos.z, 0);
  assert.equal(autoTour.idx, 0);
});
