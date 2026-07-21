// ═══════════════════════════════════════════════════════════════
//  방명록 · 사진 좋아요 · 사진별 코멘트 데이터 계층
//  Firebase(Firestore)로 공유 저장. 미설정 시 localStorage 로컬 모드.
// ═══════════════════════════════════════════════════════════════
import { firebaseConfig, FIREBASE_ENABLED } from './firebase-config.js';

const FB_VERSION = '10.12.5';
const FB_INIT_TIMEOUT_MS = 8000;
const LS_LIKED = 'guest.liked.v1';        // 이 브라우저가 누른 좋아요 {id:1}
const LS_LIKECOUNT = 'guest.likeCount.v1'; // 로컬 모드 좋아요 수 {id:n}
const LS_GUEST = 'guest.guestbook.v1';     // 로컬 모드 방명록 [entry]
const LS_COMMENTS = 'guest.photoComments.v1'; // 로컬 모드 사진별 코멘트 {photoId:[entry]}
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
      const modules = Promise.all([
        import(`https://www.gstatic.com/firebasejs/${FB_VERSION}/firebase-app.js`),
        import(`https://www.gstatic.com/firebasejs/${FB_VERSION}/firebase-firestore.js`),
      ]);
      const [appMod, fs] = await Promise.race([
        modules,
        new Promise((_, reject) => setTimeout(
          () => reject(new Error('Firebase 초기화 시간 초과')),
          FB_INIT_TIMEOUT_MS,
        )),
      ]);
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

// 3D 전시장 배지용 좋아요 스냅샷. 가까운 방의 사진 ID만 최대 30개씩
// 묶어 조회해 작품마다 개별 요청하거나 전 작품을 한꺼번에 읽지 않는다.
export async function getLikeCounts(ids) {
  const wanted = [...new Set(ids.map(String).filter(Boolean))];
  if (mode === 'firebase') {
    const counts = {};
    for (let i = 0; i < wanted.length; i += 30) {
      const chunk = wanted.slice(i, i + 30);
      const q = fb.query(fb.collection(fb.db, 'likes'),
        fb.where(fb.documentId(), 'in', chunk));
      const snap = await fb.getDocs(q);
      snap.forEach((doc) => { counts[doc.id] = Math.max(0, (doc.data()?.count) | 0); });
    }
    return counts;
  }
  const local = readJSON(LS_LIKECOUNT, {});
  return Object.fromEntries(wanted.map((id) => [id, local[id] | 0]));
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

/* ═══════════════════ 사진별 코멘트 ═══════════════════ */
const COMMENT_NAME_MAX = 40, COMMENT_MSG_MAX = 300, COMMENT_LIMIT = 40;

function localCommentsFor(photoId) {
  const all = readJSON(LS_COMMENTS, {});
  return Array.isArray(all[photoId]) ? all[photoId] : [];
}

// 선택한 사진의 최근 코멘트만 구독한다. 다른 사진의 코멘트는 읽지 않는다.
export function watchPhotoComments(photoId, cb) {
  if (mode === 'firebase') {
    const entries = fb.collection(fb.db, 'photoComments', photoId, 'entries');
    const q = fb.query(entries, fb.orderBy('createdAt', 'desc'), fb.limit(COMMENT_LIMIT));
    return fb.onSnapshot(q,
      (snap) => cb(snap.docs.map((d) => {
        const v = d.data();
        return {
          id: d.id,
          name: v.name,
          school: v.school,
          message: v.message,
          createdAt: v.createdAt?.toMillis ? v.createdAt.toMillis() : Date.now(),
        };
      })),
      (err) => {
        console.warn('[social] 사진 코멘트 구독 오류', err);
        cb(localCommentsFor(photoId));
      });
  }
  cb(localCommentsFor(photoId));
  return () => {};
}

export async function addPhotoComment({ photoId, name, school, message }) {
  const id = String(photoId || '').trim();
  const clean = {
    name: String(name || '').trim().slice(0, COMMENT_NAME_MAX) || '익명 · 匿名',
    school: String(school || '').trim().slice(0, 40),
    message: String(message || '').trim().slice(0, COMMENT_MSG_MAX),
  };
  if (!id || !clean.message) throw new Error('EMPTY_MESSAGE');
  if (postCooldownLeft() > 0) throw new Error('COOLDOWN');

  if (mode === 'firebase') {
    await fb.addDoc(fb.collection(fb.db, 'photoComments', id, 'entries'), {
      ...clean,
      createdAt: fb.serverTimestamp(),
    });
  } else {
    const all = readJSON(LS_COMMENTS, {});
    const list = localCommentsFor(id);
    list.unshift({ id: 'local-' + Date.now(), ...clean, createdAt: Date.now() });
    all[id] = list.slice(0, COMMENT_LIMIT);
    writeJSON(LS_COMMENTS, all);
  }
  localStorage.setItem(LS_LASTPOST, String(Date.now()));
  return clean;
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
          badge: v.badge || null,
          createdAt: v.createdAt?.toMillis ? v.createdAt.toMillis() : Date.now() };
      })),
      (err) => { console.warn('[social] 방명록 구독 오류', err); cb(readJSON(LS_GUEST, [])); });
  }
  cb(readJSON(LS_GUEST, []));
  return () => {};
}

// 방명록 작성. 성공 시 저장된 엔트리 형태 반환.
// badge: 'secret' 이면 "기네스북"(비밀의 방 도전 성공자) 뱃지를 함께 저장한다.
export async function addGuestbookEntry({ name, school, message, badge }) {
  const clean = {
    name: String(name || '').trim().slice(0, NAME_MAX) || '익명 · 匿名',
    school: String(school || '').trim().slice(0, 40),
    message: String(message || '').trim().slice(0, MSG_MAX),
  };
  if (!clean.message) throw new Error('EMPTY_MESSAGE');
  if (postCooldownLeft() > 0) throw new Error('COOLDOWN');
  const badgeVal = badge === 'secret' ? 'secret' : null;

  if (mode === 'firebase') {
    const doc = { ...clean, createdAt: fb.serverTimestamp() };
    if (badgeVal) doc.badge = badgeVal;
    await fb.addDoc(fb.collection(fb.db, 'guestbook'), doc);
  } else {
    const list = readJSON(LS_GUEST, []);
    const entry = { id: 'local-' + Date.now(), ...clean, createdAt: Date.now() };
    if (badgeVal) entry.badge = badgeVal;
    list.unshift(entry);
    writeJSON(LS_GUEST, list.slice(0, 200));
  }
  localStorage.setItem(LS_LASTPOST, String(Date.now()));
  return badgeVal ? { ...clean, badge: badgeVal } : clean;
}
