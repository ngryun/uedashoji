// ═══════════════════════════════════════════════════════════════
//  Firebase 설정 (방명록 · 사진 좋아요 · 사진별 코멘트)
// ───────────────────────────────────────────────────────────────
//  설정 방법:
//  1) https://console.firebase.google.com 에서 프로젝트 생성
//  2) 왼쪽 메뉴 "빌드 > Firestore Database" → 데이터베이스 만들기
//     (위치는 asia-northeast1(도쿄) 또는 asia-northeast3(서울) 권장)
//  3) 프로젝트 설정(⚙️) > 일반 > 내 앱 > 웹 앱(</>) 추가 →
//     firebaseConfig 값을 복사해 아래에 붙여넣기
//  4) FIREBASE_ENABLED 를 true 로 변경
//  5) Firestore "규칙(Rules)" 탭에 README/설명의 보안 규칙을 붙여넣고 게시
//
//  ※ 아래 apiKey 등은 "공개되어도 안전한" 값입니다(비밀키 아님).
//     실제 보안은 Firestore 규칙으로 겁니다.
//  ※ FIREBASE_ENABLED 가 false 이면 방명록·좋아요·코멘트가 이 브라우저에만
//     저장되는 "로컬 모드"로 동작합니다(다른 사람과 공유되지 않음).
// ═══════════════════════════════════════════════════════════════

export const firebaseConfig = {
  apiKey: "AIzaSyCPTBEctdXfRxrkiE6gBpGMnXLCKBwLtcM",
  authDomain: "yonago-45610.firebaseapp.com",
  projectId: "yonago-45610",
  storageBucket: "yonago-45610.firebasestorage.app",
  messagingSenderId: "538475472830",
  appId: "1:538475472830:web:320e14798028d56e1afbef",
  measurementId: "G-371L4K79BH",
};

export const FIREBASE_ENABLED = true;

// 사진별 코멘트는 Firestore 규칙을 따로 게시하기 전까지 이 기기에만 저장합니다.
// FIREBASE_SETUP.md의 규칙을 게시한 뒤 공유하려면 true로 바꾸세요.
export const FIREBASE_PHOTO_COMMENTS_ENABLED = false;
