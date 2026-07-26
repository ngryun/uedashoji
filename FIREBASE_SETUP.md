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

## 3. 로그인 화면 없는 브라우저 작성자 인증 켜기

1. Firebase Console 왼쪽 메뉴 **빌드 → Authentication → 시작하기**
2. **Sign-in method(로그인 방법)** 탭에서 **익명(Anonymous)** 제공업체를 사용 설정

사용자에게 로그인 화면은 나타나지 않습니다. Firebase가 브라우저마다 익명 작성자 ID를 자동 발급하며,
그 ID로 **같은 브라우저에서 새로 작성한 글만 수정**할 수 있게 합니다. 브라우저 저장 데이터를 지우거나
다른 브라우저·기기로 이동하면 기존 작성자 ID를 복구할 수 없습니다.

## 4. 보안 규칙(Rules) 붙여넣기

Firestore Database → **규칙(Rules)** 탭에 아래 내용을 붙여넣고 **게시(Publish)** 하세요.
누구나 읽고 쓸 수 있지만, 수정은 해당 글을 작성한 익명 작성자에게만 허용합니다.
`badge` 필드를 명시적으로 허용하므로 완주 뱃지를 체크한 글도 정상 저장됩니다.

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function validGuestbook(data) {
      return data.keys().hasOnly([
               'name', 'school', 'message', 'createdAt', 'editedAt', 'badge', 'ownerId'
             ])
             && data.keys().hasAll(['name', 'school', 'message', 'createdAt'])
             && data.name is string
             && data.name.size() <= 40
             && data.school is string
             && data.school.size() <= 40
             && data.message is string
             && data.message.size() >= 1
             && data.message.size() <= 500
             && (!('badge' in data) || data.badge == 'secret')
             && (!('ownerId' in data)
                 || (data.ownerId is string && data.ownerId.size() > 0));
    }

    match /guestbook/{id} {
      allow read: if true;

      // 익명 인증이 아직 켜지지 않은 배포에서도 작성은 유지하되,
      // ownerId가 있는 새 글만 브라우저 소유 글로 인정한다.
      allow create: if validGuestbook(request.resource.data)
                    && request.resource.data.createdAt == request.time
                    && !('editedAt' in request.resource.data)
                    && (!('ownerId' in request.resource.data)
                        || (request.auth != null
                            && request.resource.data.ownerId == request.auth.uid));

      allow update: if request.auth != null
                    && resource.data.ownerId == request.auth.uid
                    && request.resource.data.ownerId == resource.data.ownerId
                    && request.resource.data.createdAt == resource.data.createdAt
                    && request.resource.data.editedAt == request.time
                    && validGuestbook(request.resource.data)
                    && request.resource.data.diff(resource.data).affectedKeys()
                         .hasOnly(['name', 'school', 'message', 'badge', 'editedAt']);

      allow delete: if false;
    }
  }
}
```

## 5. 확인

사이트를 새로고침한 뒤:
- 방명록을 열면 "모든 관람객과 실시간으로 공유됩니다" 문구가 보입니다(로컬 모드면 "이 브라우저에만 저장").
- 다른 기기/브라우저에서 남긴 글이 실시간으로 함께 보이면 성공입니다.
- 새로 작성한 글에 **수정 · 編集** 버튼이 표시되고, 수정 후 **수정됨 · 編集済み**이 표시되면 익명 인증과 규칙이 정상입니다.
- 완주 후 뱃지를 체크한 글이 `🏆 기네스북 · クリア`와 함께 저장되는지 확인합니다.

## 관리(모더레이션)

- 사용자는 같은 브라우저에서 자신이 새로 작성한 글만 수정할 수 있습니다. 삭제는 사이트에서 허용하지 않습니다.
- 부적절한 방명록 글은 Firestore 콘솔의 **guestbook** 컬렉션에서 해당 문서를 직접 삭제하세요.
- 로그인이 없어 완벽한 도배 차단은 어렵습니다. 현재 클라이언트에서 방명록 작성 간격을 20초로 제한합니다.

## 비용

무료(Spark) 요금제로 충분합니다 — 하루 읽기 5만/쓰기 2만 회, 저장 1GB입니다. 일반적인 학교 전시 규모에서는 무료 한도에 충분한 여유가 있습니다. Firebase 콘솔의 **Firestore → Usage**에서 실제 사용량을 확인할 수 있습니다.

## 미성년자 개인정보 안내

방명록에는 이름·메시지가 공개 저장됩니다. 학교 정책에 맞게 최소 정보만 받도록 안내하고, 전시 종료 후 데이터 보관/폐기 계획을 정해 두시길 권합니다.
