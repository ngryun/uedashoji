// 상영 순서·준비·전환을 렌더링과 분리한다. 다음 화면이 준비되기 전에는 현재 화면을 유지한다.
export function cinemaVideoSource(item, mobile = false, quality = 'auto') {
  return quality === 'mobile' || (quality === 'auto' && mobile)
    ? item.mobileFile || item.file : item.file;
}

export function releaseCinemaSlot(slot) {
  if (!slot) return;
  if (slot.video) {
    slot.video.pause();
    slot.video.removeAttribute('src');
    slot.video.load();
  }
  slot.tex?.dispose();
  slot.vtex?.dispose();
}

// 중간 위치의 프레임과 그 뒤의 데이터가 준비된 뒤에만 텍스처를 화면에 설치한다.
export function prepareCinemaVideo(video, src, signal, excerpt = 10, timeout = 15000) {
  return new Promise((resolve, reject) => {
    let settled = false, positioned = false;
    let start = 0;
    const events = ['loadedmetadata', 'loadeddata', 'canplay', 'seeked', 'error'];
    const cleanup = () => {
      clearTimeout(timer);
      events.forEach(name => video.removeEventListener(name, handle));
      signal?.removeEventListener('abort', abort);
    };
    const finish = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) {
        video.pause(); video.removeAttribute('src'); video.load();
        reject(error);
      } else resolve({ start, duration: Math.min(excerpt, video.duration - start),
        aspect: video.videoWidth / video.videoHeight });
    };
    const abort = () => finish(new DOMException('Cancelled', 'AbortError'));
    const handle = event => {
      if (event.type === 'error') { finish(new Error('Video unavailable')); return; }
      if (!positioned && video.readyState >= 1) {
        if (!Number.isFinite(video.duration) || video.duration <= 0) return;
        positioned = true;
        start = Math.max(0, video.duration / 2 - excerpt / 2);
        if (start > 0) { video.currentTime = start; return; }
      }
      if (positioned && !video.seeking && Math.abs(video.currentTime - start) < 0.2
          && video.readyState >= 3) finish();
    };
    const timer = setTimeout(() => finish(new Error('Video preparation timed out')), timeout);
    events.forEach(name => video.addEventListener(name, handle));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    video.muted = true; video.loop = false; video.playsInline = true;
    video.preload = 'auto'; video.crossOrigin = 'anonymous';
    video.src = src; video.load();
  });
}

export function createCinemaPlayback({ items, load, install, opacity, photoProgress,
  clear, finishTransition = () => {}, onError = () => {}, firstIndex = 0 }) {
  const ctl = {
    items, i: -1, phase: 'idle', current: null, previous: null, upcoming: null,
    t: 0, near: false, suspended: true, playFailed: false, generation: 0,
    get video() { return this.current?.video || null; },
    get pending() { return this.upcoming?.slot || null; },
    request(index) {
      if (!items.length || this.upcoming) return;
      const generation = this.generation;
      const task = { index: (index + items.length) % items.length, abort: new AbortController(), slot: null };
      this.upcoming = task;
      Promise.resolve().then(() => load(items[task.index], task.abort.signal)).then(slot => {
        if (generation !== this.generation || this.upcoming !== task) { releaseCinemaSlot(slot); return; }
        task.slot = slot;
      }).catch(error => {
        if (generation !== this.generation || this.upcoming !== task) return;
        this.upcoming = null;
        onError(error);
        this.retryIndex = (task.index + 1) % items.length;
        this.retryIn = 1;
      });
    },
    play() {
      const video = this.video;
      if (!video || this.playFailed) return;
      try {
        video.play()?.catch(error => {
          if (this.video !== video || this.suspended) return;
          this.playFailed = true; onError(error);
        });
      } catch (error) { this.playFailed = true; onError(error); }
    },
    swap() {
      const task = this.upcoming;
      if (!task?.slot) return;
      // 이전 화면은 새 화면과 겹쳐 보이는 동안 계속 보관한다.
      this.previous = this.current;
      if (!this.previous) clear();
      this.current = task.slot; this.i = task.index; this.upcoming = null;
      this.playFailed = false;
      install(this.current, items[this.i], this.i, this.previous);
      opacity(0);
      this.phase = this.previous ? 'transition' : 'in'; this.t = 0;
      this.retryIndex = null; this.retryIn = 0;
      this.play();
    },
    reset() {
      this.generation++;
      this.upcoming?.abort.abort();
      releaseCinemaSlot(this.upcoming?.slot);
      clear(); releaseCinemaSlot(this.current);
      releaseCinemaSlot(this.previous);
      this.current = null; this.previous = null; this.upcoming = null;
      opacity(0);
      this.phase = 'idle'; this.t = 0; this.i = -1;
      this.retryIndex = null; this.retryIn = 0;
    },
    update(dt, near, paused) {
      this.near = near;
      if (!near) { if (this.phase !== 'idle' || this.upcoming) this.reset(); return; }
      if (paused) { this.video?.pause(); this.suspended = true; return; }
      if (this.suspended) { this.suspended = false; this.play(); }
      if (this.video?.error && !this.playFailed) { this.playFailed = true; onError(this.video.error); }
      if (!this.current) {
        if (this.upcoming?.slot) this.swap();
        else if (!this.upcoming) {
          this.retryIn = Math.max(0, (this.retryIn || 0) - dt);
          if (!this.retryIn) this.request(this.retryIndex ?? firstIndex);
        }
        return;
      }
      if (this.phase === 'in' || this.phase === 'transition') {
        if (this.video && !this.playFailed && (this.video.paused || this.video.seeking || this.video.readyState < 2)) return;
        this.t += dt;
        opacity(Math.min(1, this.t / 0.9));
        if (this.t >= 0.9) {
          finishTransition();
          releaseCinemaSlot(this.previous); this.previous = null;
          this.phase = 'hold'; this.t = 0;
        }
      } else if (this.phase === 'hold') {
        this.t += dt;
        const slot = this.current;
        const progress = slot.video
          ? (this.playFailed || slot.video.ended ? 1 : (slot.video.currentTime - slot.start) / slot.duration)
          : this.t / 5.5;
        if (!slot.video) photoProgress(Math.min(1, progress));
        // 1枚先だけ準備する。読み込み中は今の画面を保つ。
        if (!this.upcoming) {
          this.retryIn = Math.max(0, (this.retryIn || 0) - dt);
          if (!this.retryIn) { this.request(this.retryIndex ?? this.i + 1); this.retryIndex = null; }
        }
        if (progress >= 1) {
          slot.video?.pause();
          if (this.upcoming?.slot) this.swap();
        }
      }
    },
  };
  return ctl;
}

// 두 자료를 각각 16:9 화면 안에 배치한 다음 한 번에 섞는다.
// 화면비가 달라도 이전 화면이 비치거나 중간에 전체 화면이 검게 되지 않는다.
export function createCinemaScreen(THREE, { screen, spill, width, height, mirror = false }) {
  const uniforms = {
    currentFrame: { value: null }, previousFrame: { value: null },
    currentAspect: { value: 1 }, previousAspect: { value: 1 }, frameAspect: { value: width / height },
    currentVideo: { value: false }, previousVideo: { value: false },
    currentMatrix: { value: new THREE.Matrix3() }, previousMatrix: { value: new THREE.Matrix3() },
    hasPrevious: { value: false }, blend: { value: 1 }, alpha: { value: 0 },
  };
  screen.material.dispose();
  screen.material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, toneMapped: false, uniforms,
    vertexShader: `varying vec2 frameUv;
      void main() { frameUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform sampler2D currentFrame; uniform sampler2D previousFrame;
      uniform float currentAspect; uniform float previousAspect; uniform float frameAspect;
      uniform bool currentVideo; uniform bool previousVideo; uniform bool hasPrevious;
      uniform mat3 currentMatrix; uniform mat3 previousMatrix;
      uniform float blend; uniform float alpha; varying vec2 frameUv;
      vec3 sampleColor(sampler2D image, vec2 p, bool video) {
        vec3 c = texture2D(image, clamp(p, 0.0, 1.0)).rgb;
        if (video) c = mix(pow(c * 0.9478673 + 0.0521327, vec3(2.4)),
          c * 0.0773994, vec3(lessThanEqual(c, vec3(0.04045))));
        return c;
      }
      vec3 composeFrame(sampler2D image, float aspect, bool video, mat3 imageMatrix) {
        vec2 fit = aspect < frameAspect ? vec2(aspect / frameAspect, 1.0) : vec2(1.0, frameAspect / aspect);
        vec2 p = (frameUv - 0.5) / fit + 0.5;
        if (p.x >= 0.0 && p.x <= 1.0 && p.y >= 0.0 && p.y <= 1.0)
          return sampleColor(image, (imageMatrix * vec3(p, 1.0)).xy, video);
        vec3 background = vec3(0.0015);
        if (video && aspect < 1.0) {
          vec2 center = (frameUv - 0.5) * vec2(1.0, aspect / frameAspect) + 0.5;
          background = vec3(0.0);
          for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) {
            vec2 q = center + vec2(float(x), float(y)) * 0.035;
            background += sampleColor(image, (imageMatrix * vec3(q, 1.0)).xy, true) / 9.0;
          }
          background *= 0.25;
        }
        return background;
      }
      void main() {
        vec3 color = composeFrame(currentFrame, currentAspect, currentVideo, currentMatrix);
        if (hasPrevious) color = mix(composeFrame(previousFrame, previousAspect, previousVideo, previousMatrix), color, blend);
        gl_FragColor = vec4(color, alpha);
        #include <colorspace_fragment>
      }`,
  });
  screen.geometry.dispose();
  screen.geometry = new THREE.PlaneGeometry(width, height);
  screen.visible = false;
  let currentTexture = null, kb = null;
  const setFrame = (prefix, slot) => {
    const tex = slot.tex || slot.vtex;
    uniforms[`${prefix}Frame`].value = tex;
    uniforms[`${prefix}Aspect`].value = slot.aspect;
    uniforms[`${prefix}Video`].value = slot.type === 'video';
    uniforms[`${prefix}Matrix`].value = tex.matrix;
  };
  return {
    clear() {
      screen.visible = false;
      uniforms.currentFrame.value = uniforms.previousFrame.value = null;
      uniforms.hasPrevious.value = false; currentTexture = null; kb = null;
    },
    install(slot, item, index, previous) {
      const tex = slot.tex || slot.vtex;
      if (mirror) { tex.repeat.x = -1; tex.offset.x = 1; }
      tex.updateMatrix();
      // 일시정지된 준비 프레임도 전환 첫 프레임에서 GPU에 올린다.
      tex.needsUpdate = true;
      setFrame('current', slot);
      setFrame('previous', previous || slot);
      uniforms.hasPrevious.value = Boolean(previous);
      currentTexture = tex;
      kb = slot.type === 'photo' ? { px: (index % 3) * 0.03, py: index % 2 ? 0.03 : -0.03 } : null;
      screen.visible = true;
    },
    opacity(p) {
      const alpha = uniforms.hasPrevious.value ? 1 : p;
      uniforms.alpha.value = alpha;
      uniforms.blend.value = uniforms.hasPrevious.value ? p : 1;
      spill.material.opacity = alpha * 0.42;
    },
    finishTransition() {
      // 해제할 이전 텍스처를 먼저 셰이더에서 떼어 낸다.
      uniforms.hasPrevious.value = false;
      uniforms.previousFrame.value = uniforms.currentFrame.value;
    },
    photoProgress(p) {
      if (!kb || !currentTexture) return;
      const r = 1 - 0.07 * p, sign = mirror ? -1 : 1;
      currentTexture.repeat.set(sign * r, r);
      currentTexture.offset.set((sign < 0 ? 1 : 0) + sign * ((1 - r) / 2 + kb.px * p),
        (1 - r) / 2 + kb.py * p);
      currentTexture.updateMatrix();
    },
  };
}
