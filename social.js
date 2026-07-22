// ═══════════════════════════════════════════════════════════════
//  방명록 데이터 계층
//  Firebase(Firestore)로 공유 저장. 미설정 시 localStorage 로컬 모드.
// ═══════════════════════════════════════════════════════════════
import { firebaseConfig, FIREBASE_ENABLED } from './firebase-config.js';

const FB_VERSION = '10.12.5';
const FB_INIT_TIMEOUT_MS = 8000;
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
