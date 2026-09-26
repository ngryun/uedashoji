// ═══════════════════════════════════════════════════════════════
//  방명록 데이터 계층
//  Firebase(Firestore)로 공유 저장. 미설정 시 localStorage 로컬 모드.
// ═══════════════════════════════════════════════════════════════
import { firebaseConfig, FIREBASE_ENABLED } from './firebase-config.js';

const FB_VERSION = '10.12.5';
const FB_INIT_TIMEOUT_MS = 8000;
const LS_GUEST = 'guest.guestbook.v1';     // 로컬 모드 방명록 [entry]
const LS_LASTPOST = 'guest.lastPost.v1';   // 도배 방지용 마지막 작성 시각
const LS_OWNER = 'guest.owner.v1';         // 로컬 모드 브라우저별 작성자 ID

let mode = 'local';   // 'firebase' | 'local'
let fb = null;        // Firestore 모듈 + db
let initPromise = null;
let memoryOwnerId = null;
let lastPostInMemory = 0;
const localWatchers = new Set();

function notifyLocalWatchers() {
  for (const notify of localWatchers) {
    try { notify(); } catch (err) { console.warn('[social] 로컬 방명록 표시 실패', err); }
  }
}
globalThis.addEventListener?.('storage', event => {
  if (event.key === LS_GUEST || event.key === null) notifyLocalWatchers();
});

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
        import(`https://www.gstatic.com/firebasejs/${FB_VERSION}/firebase-auth.js`),
      ]);
      const [appMod, fs, authMod] = await Promise.race([
        modules,
        new Promise((_, reject) => setTimeout(
          () => reject(new Error('Firebase 초기화 시간 초과')),
          FB_INIT_TIMEOUT_MS,
        )),
      ]);
      const app = appMod.initializeApp(firebaseConfig);
      const db = fs.getFirestore(app);
      const auth = authMod.getAuth(app);
      let authUser = auth.currentUser;
      let authError = null;
      try {
        await authMod.setPersistence(auth, authMod.browserLocalPersistence);
        if (typeof auth.authStateReady === 'function') await auth.authStateReady();
        authUser = auth.currentUser;
        if (!authUser) authUser = (await authMod.signInAnonymously(auth)).user;
      } catch (err) {
        authError = err;
        console.warn('[social] 익명 작성자 인증 실패 — 새 글 수정 기능을 사용할 수 없습니다.', err);
      }
      fb = { db, ...fs, auth, authUser, authError };
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
  localStorage.setItem(key, JSON.stringify(val));
  if (key === LS_GUEST) notifyLocalWatchers();
}

function localOwnerId() {
  if (memoryOwnerId) return memoryOwnerId;
  let id;
  try { id = localStorage.getItem(LS_OWNER); } catch {}
  if (id) return (memoryOwnerId = id);
  id = globalThis.crypto?.randomUUID?.()
    || `browser-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try { localStorage.setItem(LS_OWNER, id); } catch {}
  return (memoryOwnerId = id);
}

function ownerId() {
  return mode === 'firebase' ? (fb?.authUser?.uid || '') : localOwnerId();
}

export function canEditOwnEntries() {
  return Boolean(ownerId());
}

/* ═══════════════════ 방명록 ═══════════════════ */
const NAME_MAX = 40, MSG_MAX = 500, POST_COOLDOWN_MS = 20000;

export function postCooldownLeft() {
  let last = lastPostInMemory;
  try {
    const stored = Number(localStorage.getItem(LS_LASTPOST) || 0);
    if (Number.isFinite(stored)) last = Math.max(last, stored);
  } catch {}
  return Math.max(0, POST_COOLDOWN_MS - (Date.now() - last));
}

function cleanEntry({ name, school, message }) {
  const clean = {
    name: String(name || '').trim().slice(0, NAME_MAX) || '익명 · 匿名',
    school: String(school || '').trim().slice(0, 40),
    message: String(message || '').trim().slice(0, MSG_MAX),
  };
  if (!clean.message) throw new Error('EMPTY_MESSAGE');
  return clean;
}

function publicEntry(id, value) {
  const mine = Boolean(value.ownerId && value.ownerId === ownerId());
  return {
    id,
    name: value.name,
    school: value.school,
    message: value.message,
    badge: value.badge || null,
    createdAt: value.createdAt?.toMillis ? value.createdAt.toMillis() : Number(value.createdAt) || Date.now(),
    editedAt: value.editedAt?.toMillis ? value.editedAt.toMillis() : Number(value.editedAt) || null,
    editable: mine,
  };
}

// 실시간 방명록 구독. 최신순 목록과 현재 브라우저의 수정 가능 여부를 반환한다.
export function watchGuestbook(cb, onError = null) {
  if (mode === 'firebase') {
    const q = fb.query(fb.collection(fb.db, 'guestbook'),
      fb.orderBy('createdAt', 'desc'), fb.limit(200));
    return fb.onSnapshot(q,
      (snap) => cb(snap.docs.map((d) => publicEntry(d.id, d.data()))),
      (err) => {
        console.warn('[social] 방명록 구독 오류', err);
        if (onError) { onError(err); return; }
        cb(readJSON(LS_GUEST, []).map((entry) => publicEntry(entry.id, entry)));
      });
  }
  const notify = () => cb(readJSON(LS_GUEST, []).map((entry) => publicEntry(entry.id, entry)));
  localWatchers.add(notify);
  notify();
  return () => localWatchers.delete(notify);
}

// 방명록 작성. 성공 시 저장된 엔트리 형태 반환.
// badge: 'secret' 이면 비밀의 방 도전 성공자 뱃지를 함께 저장한다.
export async function addGuestbookEntry({ name, school, message, badge }) {
  const clean = cleanEntry({ name, school, message });
  if (postCooldownLeft() > 0) throw new Error('COOLDOWN');
  const badgeVal = badge === 'secret' ? 'secret' : null;
  const entryOwnerId = ownerId();

  let id;
  if (mode === 'firebase') {
    const doc = { ...clean, createdAt: fb.serverTimestamp() };
    if (entryOwnerId) doc.ownerId = entryOwnerId;
    if (badgeVal) doc.badge = badgeVal;
    const ref = await fb.addDoc(fb.collection(fb.db, 'guestbook'), doc);
    id = ref.id;
  } else {
    const list = readJSON(LS_GUEST, []);
    const entry = {
      id: 'local-' + Date.now(),
      ...clean,
      ownerId: entryOwnerId,
      createdAt: Date.now(),
    };
    if (badgeVal) entry.badge = badgeVal;
    list.unshift(entry);
    writeJSON(LS_GUEST, list.slice(0, 200));
    id = entry.id;
  }
  lastPostInMemory = Date.now();
  // 도배 방지 시각을 기록하지 못해도 이미 완료한 저장을 실패로 알리지 않는다.
  try { localStorage.setItem(LS_LASTPOST, String(lastPostInMemory)); } catch {}
  return {
    id,
    ...clean,
    badge: badgeVal,
    createdAt: Date.now(),
    editedAt: null,
    editable: Boolean(entryOwnerId),
  };
}

// 현재 브라우저에서 작성한 방명록만 수정한다. 서버에서도 ownerId를 다시 검증한다.
export async function updateGuestbookEntry(id, { name, school, message, badge }) {
  const clean = cleanEntry({ name, school, message });
  const badgeVal = badge === 'secret' ? 'secret' : null;
  const entryOwnerId = ownerId();
  if (!entryOwnerId) throw new Error('AUTH_REQUIRED');

  if (mode === 'firebase') {
    const patch = { ...clean, editedAt: fb.serverTimestamp() };
    patch.badge = badgeVal || fb.deleteField();
    await fb.updateDoc(fb.doc(fb.db, 'guestbook', String(id)), patch);
  } else {
    const list = readJSON(LS_GUEST, []);
    const index = list.findIndex((entry) => entry.id === id);
    if (index < 0) throw new Error('NOT_FOUND');
    if (!list[index].ownerId || list[index].ownerId !== entryOwnerId) throw new Error('NOT_OWNER');
    const updated = { ...list[index], ...clean, editedAt: Date.now() };
    if (badgeVal) updated.badge = badgeVal;
    else delete updated.badge;
    list[index] = updated;
    writeJSON(LS_GUEST, list);
  }
  return { id, ...clean, badge: badgeVal, editedAt: Date.now(), editable: true };
}

/* ── 방문 발자국: 방문자가 직접 적은 별명만 담고, 방명록 작성자 정보와 연결하지 않는다. ── */
export function canShareVisitorTraces() {
  return mode === 'firebase' && Boolean(fb?.authUser?.uid);
}

export async function saveVisitorTrace(segment, shouldWrite = () => true) {
  if (!canShareVisitorTraces()) throw new Error('TRACE_SHARING_UNAVAILABLE');
  // Transactions fail offline rather than queuing an upload after recording was disabled.
  // Only the optional nickname the visitor typed is stored: no owner ID, guestbook name or school.
  const { id, room, layout, points, name } = segment;
  const ref = fb.doc(fb.db, 'visitorTraces', id);
  return fb.runTransaction(fb.db, async transaction => {
    const existing = await transaction.get(ref);
    if (existing.exists()) return true;
    if (!shouldWrite()) return false;
    transaction.set(ref, { room, layout, points, ...(name ? { name } : {}), createdAt: fb.serverTimestamp(),
      expiresAt: fb.Timestamp.fromMillis(Date.now() + 60 * 86400000) });
    return true;
  }, { maxAttempts: 2 });
}

export function watchVisitorTraces({ room, layout }, callback, onError = () => {}) {
  if (!canShareVisitorTraces()) { callback([]); return () => {}; }
  const q = fb.query(fb.collection(fb.db, 'visitorTraces'),
    fb.where('room', '==', room), fb.where('layout', '==', layout),
    fb.where('createdAt', '>', fb.Timestamp.fromMillis(Date.now() - 60 * 86400000)),
    fb.orderBy('createdAt', 'desc'), fb.limit(24));
  return fb.onSnapshot(q, snapshot => callback(snapshot.docs
    .filter(doc => !doc.metadata.hasPendingWrites)
    .map(doc => { const data = doc.data(); return { ...data, id: doc.id,
      createdAt: data.createdAt?.toMillis() ?? NaN, expiresAt: data.expiresAt?.toMillis() ?? NaN }; })), onError);
}
