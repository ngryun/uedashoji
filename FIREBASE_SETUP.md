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
- 완주 후 뱃지를 체크한 글이 `🏆 다이센과 설악산의 축복을 받은자`와 함께 저장되는지 확인합니다.

## 관리(모더레이션)

- 사용자는 같은 브라우저에서 자신이 새로 작성한 글만 수정할 수 있습니다. 삭제는 사이트에서 허용하지 않습니다.
- 부적절한 방명록 글은 Firestore 콘솔의 **guestbook** 컬렉션에서 해당 문서를 직접 삭제하세요.
- 로그인이 없어 완벽한 도배 차단은 어렵습니다. 현재 클라이언트에서 방명록 작성 간격을 20초로 제한합니다.

## 비용

무료(Spark) 요금제로 충분합니다 — 하루 읽기 5만/쓰기 2만 회, 저장 1GB입니다. 일반적인 학교 전시 규모에서는 무료 한도에 충분한 여유가 있습니다. Firebase 콘솔의 **Firestore → Usage**에서 실제 사용량을 확인할 수 있습니다.

## 미성년자 개인정보 안내

방명록에는 이름·메시지가 공개 저장됩니다. 학교 정책에 맞게 최소 정보만 받도록 안내하고, 전시 종료 후 데이터 보관/폐기 계획을 정해 두시길 권합니다.

## 방문 발자국 공유 (60일)

발자국은 `visitorTraces` 컬렉션을 사용합니다. Firebase Authentication의 **익명 로그인**을 활성화해야 기록·구독이 시작됩니다. 방문자가 입장 화면에 직접 적은 별명(`name`, 선택, 규칙상 32자 이하, 화면에는 8자까지)만 저장하며, 방명록 이름, 학교, 방명록 ID, 인증 UID는 발자국 문서에 저장하지 않습니다. 문서 ID에는 탭별 무작위 방문 ID와 공간·구간 번호만 들어갑니다. 인증은 쓰기 권한 확인에만 사용합니다. 발자국 문서는 수정·삭제가 규칙으로 막혀 있으므로, 부적절한 별명은 Firebase 콘솔에서 문서를 직접 삭제합니다.

### 배포 순서

1. 기존 프로젝트의 인덱스·TTL 설정과 `firestore.indexes.json`을 비교해 다른 서비스의 설정을 보존합니다.
2. 프로젝트 루트에서 보안 규칙과 인덱스·TTL을 배포합니다.

   ```bash
   firebase deploy --only firestore:rules,firestore:indexes --project yonago-45610
   ```

3. Firebase 콘솔에서 `visitorTraces` 복합 인덱스가 **사용 설정됨** 상태인지 확인합니다. Google Cloud Firestore 콘솔의 TTL에서 `visitorTraces.expiresAt` 정책이 활성화되었는지 확인합니다. TTL 정책은 결제 사용 설정이 필요할 수 있으며 삭제 비용이 발생합니다.
4. 이후 사이트를 배포합니다. GitHub Pages 워크플로에는 `visitor-traces.js`가 포함되어 있습니다.
5. 서로 다른 브라우저에서 입장한 뒤 한쪽에서 별명을 적고 4m 이상 걸어, 다른 쪽에서 6개의 발자국과 별명·날짜 라벨이 보이는지 확인합니다. ‘내 발자국 남기기’를 끄고 새로고침해 설정이 유지되는지도 확인합니다.

별명 필드는 규칙 배포 이후에만 저장됩니다. 별명을 허용하지 않는 이전 규칙이 남아 있으면 별명이 있는 발자국 쓰기가 거부되어 "공유에 연결되지 않아…" 안내가 표시되므로, 사이트를 배포하기 전에 규칙과 인덱스를 먼저 배포합니다.

TTL 실제 삭제는 즉시 수행되지 않습니다. 앱은 서버 기록 시각 기준 60일 또는 `expiresAt` 중 먼저 도달한 시점부터 표시하지 않습니다. 클라이언트 시계 오차는 TTL 쓰기 규칙에서 ±5분까지만 허용합니다. 정책 활성화 전에는 만료 문서가 데이터베이스에 남으므로 TTL 활성화까지 배포 완료로 간주하지 않습니다. [공식 TTL 안내](https://firebase.google.com/docs/firestore/ttl), [인덱스·TTL 설정 형식](https://firebase.google.com/docs/reference/firestore/indexes/).

### 로컬 검증

Java 21 이상과 Firebase CLI가 필요합니다. 아래 명령은 실제 프로젝트 대신 `demo-ueda-traces` 에뮬레이터만 사용합니다.

```bash
firebase emulators:exec --only firestore,auth --project demo-ueda-traces \
  "node --test tests/*.test.mjs"
```

일반 `node --test tests/*.test.mjs`에서는 에뮬레이터 환경변수가 없는 보안 규칙 테스트만 건너뜁니다. 에뮬레이터는 복합 인덱스 준비 여부와 운영 TTL 삭제를 검증하지 않으므로 배포 후 콘솔 확인도 필요합니다.

공간별 최근 24구간만 구독하고, 현재 층의 현재·인접 공간을 떠나거나 탭을 숨기면 구독을 해제합니다. 6걸음이 완성되면 온라인 트랜잭션으로 저장하며, 오프라인에서 추후 업로드할 대기열은 만들지 않습니다. 전송 전 설정을 끄면 해당 기록을 폐기합니다. 이미 전송한 기록은 수정·삭제할 수 없고 만료까지 유지됩니다.

한 방문당 공간별 두 구간 한도는 탭의 `sessionStorage`에 유지하는 클라이언트 제한입니다. 인증·형식·좌표 범위·구간 길이·만료 시각은 서버 규칙으로 검증하지만, 악의적인 클라이언트에 대한 서버 쓰기 빈도 제한은 아닙니다. 정확한 공간 경계와 현재 레이아웃은 표시할 때 추가 검증합니다. 구조가 바뀌면 계산된 레이아웃 버전이 바뀌어 과거 흔적은 표시되지 않습니다.


브라우저 공유·모바일 화면 검증은 Playwright를 설치한 환경에서 별도의 터미널 세 개로 실행할 수 있습니다. 스크립트는 **로컬 demo 에뮬레이터 문서만 초기화**하며 운영 Firebase에 접속하지 않습니다.

```bash
# 터미널 1
firebase emulators:start --only firestore,auth --project demo-ueda-traces
# 터미널 2
HOST=127.0.0.1 PORT=8736 node tools/serve.mjs
# 터미널 3 (Playwright와 Chromium 설치 필요)
node tools/verify-visitor-traces.cjs
```

`PLAYWRIGHT_MODULE`로 설치된 Playwright 모듈 경로, `CHROME_BIN`으로 사용할 Chrome 실행 파일, `TRACE_SCREENSHOTS`로 캡처 저장 폴더를 지정할 수 있습니다. 기본 캡처 위치는 OS 임시 폴더입니다. 초기 익명 인증 중의 걸음은 메모리에 잠시 보관하고, 연결 완료 시에도 기록 설정이 켜져 있을 때만 전송합니다.
