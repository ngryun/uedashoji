# Firebase 설정 가이드 — 방명록

방명록을 **모든 관람객이 공유**하려면 Firebase(Firestore)를 연결해야 합니다.
연결하기 전에는 자동으로 **로컬 모드**(각자 브라우저에만 저장)로 동작하므로, 설정 없이도 화면과 동작은 미리 확인할 수 있습니다.

## 1. 프로젝트 만들기

1. https://console.firebase.google.com 접속 → **프로젝트 추가**
2. 왼쪽 메뉴 **빌드 → Firestore Database → 데이터베이스 만들기**
   - 위치(location): **asia-northeast3 (서울)** 또는 **asia-northeast1 (도쿄)** 권장
   - 모드: "프로덕션 모드"로 시작 (규칙은 아래 3번에서 넣습니다)

## 2. 웹 앱 설정값 붙여넣기

1. 프로젝트 설정(⚙️) → **일반** → **내 앱** → 웹 앱(`</>`) 추가
2. 표시되는 `firebaseConfig` 값을 복사
3. [`firebase-config.js`](firebase-config.js) 파일을 열어 값을 붙여넣고, 맨 아래를 다음처럼 변경:

```js
export const firebaseConfig = {
  apiKey: "실제-값",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "실제-값",
  appId: "실제-값",
};

export const FIREBASE_ENABLED = true;   // ← true 로 변경
```

> `apiKey` 등은 공개되어도 안전한 값입니다(비밀키 아님). 실제 보안은 아래 규칙으로 겁니다.

## 3. 보안 규칙(Rules) 붙여넣기

Firestore Database → **규칙(Rules)** 탭에 아래 내용을 붙여넣고 **게시(Publish)** 하세요.
로그인 없이 누구나 쓸 수 있지만, 형식과 길이를 제한합니다.

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // 방명록: 누구나 읽기/작성, 수정·삭제는 콘솔(관리자)에서만
    // badge 는 선택 필드 — "기네스북"(비밀의 방 도전 성공자) 표시용. 값은 'secret' 만 허용.
    match /guestbook/{id} {
      allow read: if true;
      allow create: if request.resource.data.keys().hasOnly(['name','school','message','createdAt','badge'])
                    && request.resource.data.keys().hasAll(['name','school','message','createdAt'])
                    && request.resource.data.name is string
                    && request.resource.data.name.size() <= 40
                    && request.resource.data.school is string
                    && request.resource.data.school.size() <= 40
                    && request.resource.data.message is string
                    && request.resource.data.message.size() >= 1
                    && request.resource.data.message.size() <= 500
                    && request.resource.data.createdAt == request.time
                    && (!('badge' in request.resource.data)
                        || request.resource.data.badge == 'secret');
      allow update, delete: if false;
    }
  }
}
```

## 4. 확인

사이트를 새로고침한 뒤:
- 방명록을 열면 "모든 관람객과 실시간으로 공유됩니다" 문구가 보입니다(로컬 모드면 "이 브라우저에만 저장").
- 다른 기기/브라우저에서 남긴 글이 실시간으로 함께 보이면 성공입니다.

## 관리(모더레이션)

- 부적절한 방명록 글은 Firestore 콘솔의 **guestbook** 컬렉션에서 해당 문서를 직접 삭제하세요(사이트에서는 삭제 불가).
- 로그인이 없어 완벽한 도배 차단은 어렵습니다. 현재 클라이언트에서 방명록 작성 간격을 20초로 제한합니다.

## 비용

무료(Spark) 요금제로 충분합니다 — 하루 읽기 5만/쓰기 2만 회, 저장 1GB입니다. 일반적인 학교 전시 규모에서는 무료 한도에 충분한 여유가 있습니다. Firebase 콘솔의 **Firestore → Usage**에서 실제 사용량을 확인할 수 있습니다.

## 미성년자 개인정보 안내

방명록에는 이름·메시지가 공개 저장됩니다. 학교 정책에 맞게 최소 정보만 받도록 안내하고, 전시 종료 후 데이터 보관/폐기 계획을 정해 두시길 권합니다.
