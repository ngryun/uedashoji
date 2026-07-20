// ═══════════════════════════════════════════════════════════════
//  방명록 · 사진 좋아요 데이터 계층
//  Firebase(Firestore)로 공유 저장. 미설정 시 localStorage 로컬 모드.
// ═══════════════════════════════════════════════════════════════
import { firebaseConfig, FIREBASE_ENABLED } from './firebase-config.js';

const FB_VERSION = '10.12.5';
const LS_LIKED = 'guest.liked.v1';        // 이 브라우저가 누른 좋아요 {id:1}
const LS_LIKECOUNT = 'guest.likeCount.v1'; // 로컬 모드 좋아요 수 {id:n}
const LS_GUEST = 'guest.guestbook.v1';     // 로컬 모드 방명록 [entry]
const LS_LASTPOST = 'guest.lastPost.v1';   // 도배 방지용 마지막 작성 시각

let mode = 'local';   // 'firebase' | 'local'
let fb = null;        // Firestore 모듈 + db
let initPromise = null;

export function getMode() { return mode; }

export function initSocial() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const configured = FIREBASE_ENABLED &&
      firebaseConfig && !String(firebaseConfig.apiKey || '').startsWith('PASTE');
    if (!configured) { mode = 'local'; return mode; }
    try {
      const appMod = await import(`https://www.gstatic.com/firebasejs/${FB_VERSION}/firebase-app.js`);
      const fs = await import(`https://www.gstatic.com/firebasejs/${FB_VERSION}/firebase-firestore.js`);
      const app = appMod.initializeApp(firebaseConfig);
      const db = fs.getFirestore(app);
      fb = { db, ...fs };
      mode = 'firebase';
    } catch (err) {
      console.warn('[social] Firebase 초기화 실패 — 로컬 모드로 전환합니다.', err);
      mode = 'local';
    }
    return mode;
  })();
  return initPromise;
}

/* ── 로컬 저장 헬퍼 ── */
function readJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function writeJSON(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

/* ═══════════════════ 좋아요 ═══════════════════ */
export function hasLiked(id) { return !!readJSON(LS_LIKED, {})[id]; }
function setLikedLocal(id, liked) {
  const s = readJSON(LS_LIKED, {});
  if (liked) s[id] = 1; else delete s[id];
  writeJSON(LS_LIKED, s);
}

// 실시간 좋아요 수 구독. cb(count) 호출. 해제 함수 반환.
export function watchLikes(id, cb) {
  if (mode === 'firebase') {
    const ref = fb.doc(fb.db, 'likes', id);
    return fb.onSnapshot(ref,
      (snap) => cb(Math.max(0, (snap.data()?.count) | 0)),
      () => cb(readJSON(LS_LIKECOUNT, {})[id] | 0));
  }
  cb(readJSON(LS_LIKECOUNT, {})[id] | 0);
  return () => {};
}

// 좋아요 토글. 새 상태(liked) 반환.
export async function toggleLike(id) {
  const liked = !hasLiked(id);
  setLikedLocal(id, liked);
  if (mode === 'firebase') {
    try {
      const ref = fb.doc(fb.db, 'likes', id);
      await fb.setDoc(ref, { count: fb.increment(liked ? 1 : -1) }, { merge: true });
    } catch (err) {
      setLikedLocal(id, !liked); // 롤백
      throw err;
    }
  } else {
    const c = readJSON(LS_LIKECOUNT, {});
    c[id] = Math.max(0, (c[id] | 0) + (liked ? 1 : -1));
    writeJSON(LS_LIKECOUNT, c);
  }
  return liked;
}

/* ═══════════════════ 방명록 ═══════════════════ */
const NAME_MAX = 40, MSG_MAX = 500, POST_COOLDOWN_MS = 20000;

export function postCooldownLeft() {
  const last = Number(localStorage.getItem(LS_LASTPOST) || 0);
  return Math.max(0, POST_COOLDOWN_MS - (Date.now() - last));
}

// 실시간 방명록 구독. cb([{id,name,school,message,createdAt(ms)}]) 최신순. 해제 함수 반환.
export function watchGuestbook(cb) {
  if (mode === 'firebase') {
    const q = fb.query(fb.collection(fb.db, 'guestbook'),
      fb.orderBy('createdAt', 'desc'), fb.limit(200));
    return fb.onSnapshot(q,
      (snap) => cb(snap.docs.map((d) => {
        const v = d.data();
        return { id: d.id, name: v.name, school: v.school, message: v.message,
          createdAt: v.createdAt?.toMillis ? v.createdAt.toMillis() : Date.now() };
      })),
      (err) => { console.warn('[social] 방명록 구독 오류', err); cb(readJSON(LS_GUEST, [])); });
  }
  cb(readJSON(LS_GUEST, []));
  return () => {};
}

// 방명록 작성. 성공 시 저장된 엔트리 형태 반환.
export async function addGuestbookEntry({ name, school, message }) {
  const clean = {
    name: String(name || '').trim().slice(0, NAME_MAX) || '익명 · 匿名',
    school: String(school || '').trim().slice(0, 40),
    message: String(message || '').trim().slice(0, MSG_MAX),
  };
  if (!clean.message) throw new Error('EMPTY_MESSAGE');
  if (postCooldownLeft() > 0) throw new Error('COOLDOWN');

  if (mode === 'firebase') {
    await fb.addDoc(fb.collection(fb.db, 'guestbook'),
      { ...clean, createdAt: fb.serverTimestamp() });
  } else {
    const list = readJSON(LS_GUEST, []);
    list.unshift({ id: 'local-' + Date.now(), ...clean, createdAt: Date.now() });
    writeJSON(LS_GUEST, list.slice(0, 200));
  }
  localStorage.setItem(LS_LASTPOST, String(Date.now()));
  return clean;
}
