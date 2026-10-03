import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createCinemaPlayback, createCinemaScreen, prepareCinemaVideo, cinemaVideoSource } from '../cinema-playback.js';
import * as THREE from '../lib/three.module.js';

const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
function photo(name) {
  return { type: 'photo', name, tex: { disposed: false, dispose() { this.disposed = true; } } };
}
function setup() {
  const loads = [], installed = [], opacity = [], errors = [];
  const ctl = createCinemaPlayback({ items: [{ file: 'a' }, { file: 'b' }, { file: 'c' }],
    load: (item, signal) => new Promise((resolve, reject) => loads.push({ item, signal, resolve, reject })),
    install: slot => installed.push(slot.name), opacity: p => opacity.push(p),
    photoProgress() {}, clear() {}, onError: e => errors.push(e),
  });
  const tick = (dt = 1) => ctl.update(dt, true, false);
  const start = async (slot = photo('a')) => {
    tick(); await flush(); loads[0].resolve(slot); await flush(); tick();
    tick(); tick(); await flush();
  };
  return { ctl, loads, installed, opacity, errors, tick, start };
}

test('holds the current screen until the next slot is ready and never skips a pending item', async () => {
  const { ctl, loads, installed, opacity, tick, start } = setup();
  await start();
  assert.equal(loads[1].item.file, 'b');
  for (let i = 0; i < 30; i++) tick();
  assert.equal(ctl.phase, 'hold'); assert.equal(ctl.i, 0);
  assert.equal(opacity.at(-1), 1); assert.equal(loads.length, 2);
  loads[1].resolve(photo('b')); await flush(); tick(); tick();
  assert.deepEqual(installed, ['a', 'b']); assert.equal(ctl.i, 1);
});

test('leaving releases current and prepared media and discards late results', async () => {
  const { ctl, loads, start } = setup();
  const current = photo('a'); await start(current);
  ctl.update(1, false, false);
  assert.equal(current.tex.disposed, true); assert.equal(loads[1].signal.aborted, true);
  const stale = photo('stale'); loads[1].resolve(stale); await flush();
  assert.equal(stale.tex.disposed, true); assert.equal(ctl.current, null);
});

test('a prefetched video is released when leaving before transition', async () => {
  const { ctl, loads, start } = setup(); await start();
  const video = { pause() { this.paused = true; }, removeAttribute() { this.src = ''; }, load() {} };
  const slot = { video, vtex: { dispose() { this.disposed = true; } } };
  loads[1].resolve(slot); await flush(); ctl.update(1, false, false);
  assert.equal(video.paused, true); assert.equal(video.src, ''); assert.equal(slot.vtex.disposed, true);
});

test('failed next media is skipped while retaining the current screen', async () => {
  const { ctl, loads, errors, tick, start } = setup(); await start();
  loads[1].reject(new Error('bad file')); await flush(); tick(); await flush();
  assert.equal(ctl.i, 0); assert.equal(errors.length, 1); assert.equal(loads[2].item.file, 'c');
});

test('an initial load failure does not cause the recovered item to repeat', async () => {
  const { loads, tick } = setup();
  tick(); await flush(); loads[0].reject(new Error('bad first item')); await flush();
  tick(); await flush(); loads[1].resolve(photo('b')); await flush();
  tick(); tick(); tick(); await flush();
  assert.equal(loads[2].item.file, 'c');
});

test('video excerpt follows media time rather than animation time and pauses with the viewer', async () => {
  const { ctl, tick, start } = setup();
  const video = { currentTime: 20, paused: true, readyState: 4, seeking: false,
    play() { this.paused = false; return Promise.resolve(); }, pause() { this.paused = true; } };
  await start({ type: 'video', name: 'video', video, start: 20, duration: 10 });
  for (let i = 0; i < 40; i++) tick();
  assert.equal(ctl.phase, 'hold');
  ctl.update(1, true, true); assert.equal(video.paused, true);
  tick(); assert.equal(video.paused, false);
  video.currentTime = 30; tick(); assert.equal(video.paused, true);
});

test('photos do not advance while a panel is open or the tab is hidden', async () => {
  const { ctl, start } = setup(); await start(); const t = ctl.t;
  for (let i = 0; i < 20; i++) ctl.update(1, true, true);
  assert.equal(ctl.t, t); assert.equal(ctl.phase, 'hold');
});

function screenSetup() {
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(6.8, 3.825), new THREE.MeshBasicMaterial());
  const spill = { material: { opacity: 0 } };
  const visual = createCinemaScreen(THREE, { screen, spill, width: 6.8, height: 3.825 });
  const loads = [];
  const ctl = createCinemaPlayback({ items: [{}, {}, {}], ...visual,
    load: (_, signal) => new Promise(resolve => loads.push({ resolve, signal })),
  });
  const frame = (name, aspect) => {
    const slot = { name, aspect, type: 'photo', tex: new THREE.Texture(), disposed: false };
    slot.tex.addEventListener('dispose', () => { slot.disposed = true; });
    return slot;
  };
  const begin = async next => {
    ctl.update(1, true, false); await flush();
    const first = frame('first', 16 / 9);
    loads[0].resolve(first); await flush();
    ctl.update(1, true, false); ctl.update(1, true, false); ctl.update(1, true, false); await flush();
    loads[1].resolve(next); await flush(); ctl.update(5, true, false);
    return first;
  };
  return { screen, spill, ctl, frame, begin, uniforms: screen.material.uniforms };
}

test('different-aspect screens crossfade without an empty frame or a dip in screen opacity', async () => {
  for (const dt of [1 / 120, 1 / 30, 1 / 15]) {
    const { screen, ctl, frame, begin, uniforms, spill } = screenSetup();
    const next = frame('portrait', 9 / 16);
    const previous = await begin(next);
    assert.equal(ctl.phase, 'transition');
    assert.equal(previous.disposed, false);
    assert.equal(uniforms.previousFrame.value, previous.tex);
    assert.equal(uniforms.currentFrame.value, next.tex);
    assert.equal(uniforms.previousAspect.value, 16 / 9);
    assert.equal(uniforms.currentAspect.value, 9 / 16);
    let frames = 0;
    while (ctl.phase === 'transition') {
      assert.equal(screen.visible, true);
      assert.equal(uniforms.alpha.value, 1);
      assert.equal(spill.material.opacity, 0.42);
      assert.ok(uniforms.blend.value >= 0 && uniforms.blend.value <= 1);
      assert.equal(previous.disposed, false);
      ctl.update(dt, true, false);
      assert.ok(++frames < 200);
    }
    assert.equal(previous.disposed, true);
    assert.equal(uniforms.previousFrame.value, next.tex);
    assert.equal(uniforms.hasPrevious.value, false);
    assert.equal(uniforms.alpha.value, 1);
    assert.equal(screen.geometry.parameters.width, 6.8);
    assert.equal(screen.geometry.parameters.height, 3.825);
  }
});

test('incoming video playback delay keeps the previous frame fully visible', async () => {
  const { ctl, frame, begin, uniforms } = screenSetup();
  const next = frame('video', 9 / 16);
  next.type = 'video'; next.start = 0; next.duration = 10;
  next.video = { currentTime: 0, paused: true, readyState: 3, seeking: false,
    play() { return new Promise(() => {}); }, pause() {}, removeAttribute() {}, load() {} };
  const previous = await begin(next);
  for (let i = 0; i < 10; i++) ctl.update(0.1, true, false);
  assert.equal(ctl.phase, 'transition');
  assert.equal(uniforms.alpha.value, 1); assert.equal(uniforms.blend.value, 0);
  assert.equal(uniforms.previousFrame.value, previous.tex); assert.equal(previous.disposed, false);
  next.video.paused = false;
  ctl.update(0.3, true, false);
  assert.ok(uniforms.blend.value > 0 && uniforms.blend.value < 1);
});

test('pausing a crossfade freezes both the image mixture and resource lifetime', async () => {
  const { ctl, frame, begin, uniforms, screen } = screenSetup();
  const next = frame('next', 4 / 3), previous = await begin(next);
  ctl.update(0.3, true, false);
  const blend = uniforms.blend.value;
  for (let i = 0; i < 10; i++) ctl.update(1, true, true);
  assert.equal(uniforms.blend.value, blend); assert.equal(previous.disposed, false);
  ctl.update(1, false, false);
  assert.equal(screen.visible, false);
  assert.equal(previous.disposed, true); assert.equal(next.disposed, true);
  assert.equal(uniforms.currentFrame.value, null); assert.equal(uniforms.previousFrame.value, null);
});

class FakeVideo extends EventTarget {
  readyState = 0; duration = 40; videoWidth = 720; videoHeight = 1280; seeking = false;
  time = 0;
  get currentTime() { return this.time; }
  set currentTime(value) { this.time = value; this.seeking = true; }
  pause() { this.paused = true; }
  removeAttribute() { this.src = ''; }
  load() {}
  fire(type) { this.dispatchEvent(new Event(type)); }
}
test('video preparation waits for seek completion and future frames', async () => {
  const video = new FakeVideo(); const abort = new AbortController();
  let ready = false;
  const pending = prepareCinemaVideo(video, 'test.mp4', abort.signal).then(value => { ready = true; return value; });
  video.readyState = 1; video.fire('loadedmetadata');
  assert.equal(video.currentTime, 15);
  video.readyState = 2; video.fire('loadeddata'); await flush(); assert.equal(ready, false);
  video.seeking = false; video.fire('seeked'); await flush(); assert.equal(ready, false);
  video.readyState = 3; video.fire('canplay');
  const result = await pending;
  assert.equal(result.start, 15); assert.equal(result.duration, 10); assert.equal(result.aspect, 9 / 16);
});

test('short videos start from the beginning and play their full duration', async () => {
  const video = new FakeVideo(); video.duration = 4; video.readyState = 3;
  const pending = prepareCinemaVideo(video, 'short.mp4', new AbortController().signal);
  video.fire('loadeddata'); assert.equal((await pending).duration, 4); assert.equal(video.currentTime, 0);
});

test('cancelled and timed-out preparations release the video source', async () => {
  const video = new FakeVideo(); const abort = new AbortController();
  const pending = prepareCinemaVideo(video, 'test.mp4', abort.signal); abort.abort();
  await assert.rejects(pending, { name: 'AbortError' }); assert.equal(video.src, '');
  const second = new FakeVideo();
  await assert.rejects(prepareCinemaVideo(second, 'test.mp4', null, 10, 1), /timed out/);
  assert.equal(second.src, '');
});

test('quality selection uses the mobile variant when present and falls back to original', () => {
  const item = { file: 'original.mp4', mobileFile: 'small.mp4' };
  assert.equal(cinemaVideoSource(item, true), 'small.mp4');
  assert.equal(cinemaVideoSource(item, false), 'original.mp4');
  assert.equal(cinemaVideoSource(item, true, 'original'), 'original.mp4');
  assert.equal(cinemaVideoSource(item, false, 'mobile'), 'small.mp4');
  assert.equal(cinemaVideoSource({ file: 'original.mp4' }, true), 'original.mp4');
});

test('background music ducks only during audible playback and restores on mute or pause', () => {
  const main = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
  const update = main.slice(main.indexOf('function updateBgm('), main.indexOf('/* ═══════════════════ 자동 관람 모드'));
  const media = { paused: false, muted: true, volume: 1 };
  const bgm = { volume: 0.15, paused: false };
  const context = vm.createContext({ bgmAvailable: true, viewerOpen: true, bgmTarget: 0.15, bgmOn: true,
    bgm, viewerBody: { querySelector: () => media } });
  vm.runInContext(update, context);
  context.updateBgm(1); assert.equal(bgm.volume, 0.15);
  media.muted = false;
  context.updateBgm(1); assert.ok(Math.abs(bgm.volume - 0.03) < 1e-10);
  media.paused = true;
  context.updateBgm(1); assert.equal(bgm.volume, 0.15);
  media.paused = false; media.volume = 0;
  context.updateBgm(1); assert.equal(bgm.volume, 0.15);
});
