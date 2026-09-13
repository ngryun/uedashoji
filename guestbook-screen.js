import * as THREE from './lib/three.module.js';

// 글자 단위 줄바꿈으로 한국어·일본어·긴 URL도 화면 밖으로 넘치지 않는다.
export function wrapMessage(message, measure, maxWidth) {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const lines = [];
  for (const paragraph of String(message).replace(/\r\n?/g, '\n').split('\n')) {
    let line = '';
    for (const { segment } of segmenter.segment(paragraph)) {
      if (line && measure(line + segment) > maxWidth) {
        lines.push(line); line = '';
      }
      line += segment;
    }
    lines.push(line);
  }
  return lines;
}

export function makeSlides(entries, measure, maxWidth) {
  return entries.filter(entry => String(entry.message || '').trim()).flatMap(entry => {
    const lines = wrapMessage(entry.message, measure, maxWidth);
    const count = Math.ceil(lines.length / 7);
    return Array.from({ length: count }, (_, page) => {
      const body = lines.slice(page * 7, (page + 1) * 7);
      return { entry, lines: body, page, count,
        duration: Math.max(10, Math.min(25, body.join('').length / 9)) };
    });
  });
}

// 한 바퀴 동안 각 글을 한 번씩 보여주고, 다음 바퀴의 첫 글은 직전 글과 다르게 한다.
export function shuffleEntries(entries, previousId = null, random = Math.random) {
  const shuffled = [...entries];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  if (shuffled.length > 1 && previousId !== null && shuffled[0].id === previousId) {
    const j = 1 + Math.floor(random() * (shuffled.length - 1));
    [shuffled[0], shuffled[j]] = [shuffled[j], shuffled[0]];
  }
  return shuffled;
}

export function createGuestbookScreen() {
  const canvas = document.createElement('canvas');
  canvas.width = 1536; canvas.height = 960;
  const ctx = canvas.getContext('2d');
  const font = '"Apple SD Gothic Neo","Hiragino Kaku Gothic ProN","Noto Sans KR",sans-serif';
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const group = new THREE.Group();
  // 1층 남쪽 벽, 로비 계단 출발점 옆. 북쪽(로비 안)을 향한다.
  group.position.set(4.5, 2.55, 13.88);
  group.rotation.y = Math.PI;
  const frame = new THREE.Mesh(new THREE.BoxGeometry(4.94, 3.14, 0.10),
    new THREE.MeshStandardMaterial({ color: 0x544e45, roughness: 0.65 }));
  group.add(frame);
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(4.8, 3),
    new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }));
  plane.position.z = 0.06;
  group.add(plane);
  let slides = [], index = 0, elapsed = 0, paused = false, signature = '';
  let sourceEntries = [];
  let status = 'loading', local = false, lastPaint = '';
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function draw(alpha = 1) {
    const slide = slides[index];
    ctx.fillStyle = '#f7f3e9'; ctx.fillRect(0, 0, 1536, 960);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#85765c'; ctx.font = `500 23px ${font}`;
    ctx.fillText('2026  ·  YONAGO × SEORAK', 100, 78);
    ctx.fillStyle = '#373b35'; ctx.font = `600 51px ${font}`;
    ctx.fillText('교류의 기억', 100, 153);
    ctx.fillStyle = '#7a7c70'; ctx.font = `400 26px ${font}`;
    ctx.fillText('交流の思い出', 404, 150);
    ctx.fillStyle = '#d7cdbb'; ctx.fillRect(100, 190, 1336, 2);
    ctx.save(); ctx.globalAlpha = alpha;
    if (slide) {
      ctx.fillStyle = '#697963'; ctx.font = `400 72px ${font}`;
      ctx.fillText('“', 94, 278);
      ctx.fillStyle = '#343b35'; ctx.font = `400 46px ${font}`;
      const top = 326 + (7 - slide.lines.length) * 28;
      slide.lines.forEach((line, i) => ctx.fillText(line, 100, top + i * 58));
      ctx.fillStyle = '#767568'; ctx.font = `500 27px ${font}`;
      ctx.fillText([slide.entry.name || '익명 · 匿名', slide.entry.school].filter(Boolean).join('  ·  '), 100, 774, 1200);
      if (slide.count > 1) {
        ctx.textAlign = 'right'; ctx.font = `400 22px ${font}`;
        ctx.fillText(`${slide.page + 1} / ${slide.count}`, 1436, 774); ctx.textAlign = 'left';
      }
    } else {
      ctx.fillStyle = '#444e42'; ctx.font = `400 43px ${font}`;
      const empty = status === 'loading' ? ['친구들의 기억을 불러오고 있어요', 'みんなの思い出を読み込み中']
        : status === 'error' ? ['잠시 연결을 기다리고 있어요', '接続を待っています']
        : ['함께한 시간, 어떤 순간이 기억나나요?', '一緒に過ごした時間、何を覚えていますか？'];
      empty.forEach((line, i) => ctx.fillText(line, 100, 430 + i * 80));
    }
    ctx.restore();
    ctx.fillStyle = '#d7cdbb'; ctx.fillRect(100, 814, 1336, 2);
    ctx.fillStyle = '#4f5e49'; ctx.font = `500 26px ${font}`;
    ctx.fillText('당신의 기억도 남겨 주세요 · あなたの思い出も残してください', 100, 866);
    ctx.fillStyle = '#827e71'; ctx.font = `400 21px ${font}`;
    ctx.fillText(paused ? '읽는 동안 잠시 멈춤 · 読んでいる間は一時停止' : '클릭 · 탭하여 방명록 열기 · クリックでゲストブックへ', 100, 915);
    if (local) { ctx.textAlign = 'right'; ctx.fillText('이 기기의 글 · この端末の投稿', 1436, 915); }
    texture.needsUpdate = true;
  }
  draw();

  return {
    group, plane,
    setEntries(entries, mode = 'firebase') {
      const nextSignature = JSON.stringify(entries.map(e => [e.id, e.name, e.school, e.message]));
      local = mode === 'local'; status = 'ready';
      if (signature !== nextSignature) {
        const previous = slides[index];
        sourceEntries = entries.filter(entry => String(entry.message || '').trim());
        const ordered = shuffleEntries(sourceEntries);
        // 실시간 갱신 중에도 읽고 있던 글과 페이지는 유지한다.
        const current = previous ? ordered.findIndex(entry => entry.id === previous.entry.id) : -1;
        if (current >= 0) ordered.unshift(...ordered.splice(current, 1));
        ctx.font = `400 46px ${font}`;
        slides = makeSlides(ordered, text => ctx.measureText(text).width, 1336);
        const page = current >= 0 ? Math.min(previous.page, slides[0].count - 1) : 0;
        const retained = previous ? slides.findIndex(s => s.entry.id === previous.entry.id && s.page === page) : -1;
        index = retained < 0 ? 0 : retained;
        if (retained < 0) elapsed = 0;
        signature = nextSignature;
      }
      lastPaint = ''; draw();
    },
    setError() { status = 'error'; if (!slides.length) draw(); },
    update(dt, player, active) {
      const visible = player.floor === 0 && player.pos.distanceToSquared(group.position) < 28 * 28;
      group.visible = visible;
      if (!visible || !active || document.hidden) return;
      const near = Math.hypot(player.pos.x - group.position.x, player.pos.z - group.position.z) < 3.5;
      paused = near;
      const slide = slides[index];
      if (!near && slides.length > 1) {
        elapsed += dt;
        if (elapsed >= slide.duration) {
          elapsed = 0;
          index++;
          if (index >= slides.length) {
            ctx.font = `400 46px ${font}`;
            slides = makeSlides(shuffleEntries(sourceEntries, slide.entry.id), text => ctx.measureText(text).width, 1336);
            index = 0;
          }
        }
      }
      const duration = slides[index]?.duration || 10;
      const alpha = reducedMotion || paused || slides.length < 2 ? 1
        : Math.min(1, elapsed / 0.7, (duration - elapsed) / 0.7);
      const paint = `${index}:${paused}:${Math.round(alpha * 24)}`;
      if (paint !== lastPaint) { draw(alpha); lastPaint = paint; }
    },
  };
}
