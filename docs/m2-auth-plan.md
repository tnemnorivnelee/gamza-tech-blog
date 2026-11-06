# M2 인증 계획

작성일 2026-11-05 · 상태: **초안** (6절의 결정은 사용자 검토 전)

표기는 `backend-plan.md` 0절과 같다: **[확인함]** 코드나 실물에서 본 사실, **[이식]** 그대로 옮길 동작, **[제안]** Claude가 정한 것, **[미검증]** 확인하지 못한 것.

확인한 곳: 옛 레포 `potato-club/GamzaTechBlog-back`의 `master`(2026-06-30 커밋 `1edc82b`, 기본 브랜치도 `master`)를 **읽기만** 했다. 프론트는 `src/proxy.ts`와 생성된 클라이언트를 봤다.

## 1. 한눈에 보기

프론트 비유로 먼저 잡는다.

- 이 서버의 **가드(Guard)** 는 프론트 `src/proxy.ts`(Next.js 미들웨어)와 같은 자리에 있다. 컨트롤러가 일하기 전에 요청을 검사해서 통과시키거나 막는다.
- **JWT**(JSON Web Token)는 서버가 도장을 찍어 발급한 출입증 문자열이다. 도장(서명)이 맞고 유효 기간이 남았으면 진짜로 본다.
- 출입증은 두 종류다. **액세스 토큰**(1시간, 평소에 내미는 것)과 **리프레시 토큰**(30일, 만료되면 새 액세스 토큰으로 바꿔 받는 용도).
- **Redis**는 유효 기간을 붙여 값을 적어 두는 공유 메모장이다. 여기에 "지금 유효한 리프레시 토큰"과 "로그아웃한 액세스 토큰 목록(블랙리스트)"을 적는다.

## 2. 범위

**M2에 넣는 것**
- JWT 발급과 검증, 요청마다 도는 전역 가드(기본은 "로그인 필요"), `@Public()`·`@Roles()`·`@CurrentUser()`
- `TokenStore`(Redis 메모장) 인터페이스와 구현
- `POST /api/auth/reissue`, `POST /api/auth/me/logout`과 두 쿠키
- 접근 규칙 표 테스트

**M2에 넣지 않는 것**
- GitHub 로그인과 토큰 발급 호출부 → M3. (`TokenStore`의 "새 리프레시 토큰으로 교체"는 M3가 부르므로 M2에서 만들어 둔다.)
- 사용자 DB 저장 → M4. M2는 `UserRepository`의 `findByGithubId` 하나만 쓰고 임시 구현으로 개발한다.
- CORS 설정 → 8절의 횡단 관심사로, 프론트를 연결하기 전에 따로 한다.
- `ProfileCompletionInterceptor`(프로필 미완성 사용자 차단) → 옮기지 않는다. 클래스만 있고 등록하는 코드가 없다(`addInterceptors` 검색 결과 0건, `master` 기준). 읽는 코드가 없는 설정은 동작이 아니다(이식 원칙).

## 3. 옛 동작 [확인함]

### 3.1 토큰
- HS256 서명. 시크릿은 Base64 문자열을 풀어서 쓴 바이트다. 새 시크릿은 새로 만든다(전환 날 전원 재로그인).
- 클레임(토큰에 든 값): `sub`은 고정 문자열 `GamjaTech`, `githubId`, `jti`(UUID), `iat`, `exp`. role은 없다. 프론트 `proxy.ts`는 `exp`만 읽고, 만료 60초 전부터 미리 reissue를 부른다.
- 수명: 액세스 1시간, 리프레시 30일. 옛 `application.yml`의 **기본값**이다. 운영 환경변수가 덮었는지는 **[미검증]**.

### 3.2 요청 한 건이 지나는 길
1. 공개 경로면 검사를 건너뛴다(로그인한 사용자가 보내도 사용자 정보가 붙지 않는다).
2. 토큰을 찾는다. 순서: 쿠키 `accessToken` 또는 `authorization`(값 그대로) → 헤더 `ACCESS` → 헤더 `Authorization`(`Bearer ` 필수). 프론트는 쿠키 값을 `Authorization: Bearer`로 같이 보낸다.
3. 서명·만료를 본다 → 블랙리스트에 있는지 본다 → `githubId`로 DB에서 사용자를 찾아 role을 얻는다 → 경로의 role 규칙과 맞춘다.

실패 응답(HTTP 상태 · 본문의 `data`에 담기는 코드):
- 토큰 없음 → 403 · `J004`
- 서명 오류·만료·형식 오류 → 400 · `C005`. 만료도 여기로 간다. 이상해 보여도 바꾸지 않는다.
- 블랙리스트에 있음 → 403 · `J001`
- DB에 사용자 없음 → 403 · `J005`

이 응답의 본문은 `ResponseDto` 모양(`status`, `message`, `data`=코드 문자열, `timestamp`)이다. 일반 에러 응답(`ErrorResponse`: `message`, `status`, `code`, `errors`)이 아니다. 옛 `JwtAuthenticationEntryPoint`가 만든다.

### 3.3 reissue (공개 경로)
- 리프레시 쿠키가 없으면: **HTTP 200**, 본문 `status`만 401, 메시지 "리프레시 토큰이 없습니다.", `data` 없음, Set-Cookie 없음.
- Redis에 그 토큰이 없으면: 403 · `J004`. 이쪽은 `BusinessException`이라 일반 에러 모양(`ErrorResponse`)이다. 3.2의 실패와 모양이 다르다.
- 있으면: 새 액세스 토큰을 만들고 Redis의 리프레시 만료를 30일로 다시 늘린다. 본문 `{authorization: 새 토큰}`, 메시지 "토큰 재발급 성공". Set-Cookie는 **`authorization` 하나뿐**이다.
- 리프레시 JWT 자체는 검증하지 않고 Redis에 있는지만 본다. 사용자가 아직 DB에 있는지도 보지 않는다.
- 리프레시 **쿠키는 다시 내려주지 않는다.** 그래서 브라우저의 쿠키 수명은 로그인 때 정해진 30일 그대로이고, "연장"은 Redis 쪽에서만 일어난다.
- 프론트 `proxy.ts`는 응답이 2xx이고 Set-Cookie가 있어야 성공으로 본다.

### 3.4 logout (로그인 필요)
- Redis에서 `userRefresh:<githubId>`와 `refresh:<리프레시 토큰>`을 지우고, 액세스 토큰을 남은 초만큼 `blacklist:access:<토큰>`에 올린다.
- 블랙리스트에 올리는 토큰은 **헤더**(`ACCESS`, `Authorization`)에서만 읽는다. 쿠키로만 인증한 요청은 올라가지 않는다. 프론트는 항상 헤더를 같이 보내서 실제로 문제는 없다. 이 두 가지는 테스트로 고정한다.
- 두 쿠키를 `Max-Age=0`으로 만료시킨다. 본문은 메시지 "로그아웃되었습니다."에 `data` 없음.
- `USER`·`ADMIN`만 부를 수 있다. 즉 `PRE_REGISTER`·`PENDING` 사용자는 로그아웃할 수 없다(옛 규칙 그대로).

### 3.5 쿠키
- `authorization`: 값은 액세스 토큰 그대로, HttpOnly 아님, `Secure`, `SameSite=Lax`, `path=/`, `Domain`은 환경변수, `Max-Age`는 액세스 수명.
- `refreshToken`: HttpOnly, `Secure`, **`SameSite=None`**, 나머지는 같고 `Max-Age`는 리프레시 수명.

### 3.6 Redis 키
- `refresh:<리프레시 토큰>` → githubId
- `userRefresh:<githubId>` → 리프레시 토큰 (사용자당 하나라서 다른 기기에서 로그인하면 이전 것이 무효가 된다)
- `blacklist:access:<액세스 토큰>` → `"true"`
- 로그인 때 "이전 토큰 삭제 + 새 토큰 저장"을 Lua 스크립트 하나로 한 번에 한다(중간에 끼어들 틈이 없게).

### 3.7 접근 규칙
규칙은 두 곳에 있다. `SecurityConfig`(role 규칙)와 `JwtSkipPathMatcher`(토큰 검사를 건너뛸 경로). 이 둘을 프론트 계약의 48개 작업에 겹쳐 다시 분류했다. 숫자는 `backend-plan.md` 6절과 같다.

- 공개 13개
- 로그인(`USER`·`ADMIN`) 27개
- `ADMIN` 6개
- 특수 2개: `getCurrentUserRole`(네 role 모두 허용), `completeProfile`(`PRE_REGISTER`만)

눈여겨볼 두 가지:
- 로그인 27개 중 `getCommitHistories`(1차 범위 밖)는 두 규칙이 어긋나서, 로그인해도 항상 거부된다.
- 컨트롤러 4곳의 `@PreAuthorize`는 URL 규칙과 같은 내용이라 따로 옮길 규칙이 없다.

계획서 9절이 입력으로 말한 `api-access.json`은 이 레포에 없다. M2-2에서 위 분류를 데이터 파일로 새로 만든다.

### 3.8 role
- 요청마다 `githubId`로 DB를 조회해 role을 얻는다. 값은 `ADMIN`, `USER`, `PRE_REGISTER`, `PENDING`.
- 흐름: 가입 직후 `PRE_REGISTER` → 프로필 제출하면 `PENDING` → 관리자가 승인하면 `USER`.
- **`ADMIN`을 주는 코드는 없다.** `setUserRole` 호출은 `PENDING`과 `USER` 두 곳뿐이고, 시드 데이터나 초기화 코드도 없다(`master` 검색). DB에 직접 넣은 것으로 보이며 덤프(M4)에서 확인한다.

## 4. 새 구조 [제안]

```
apps/server/src/
  common/error/       jwt-authentication.exception.ts (추가), global-exception.filter.ts (분기 추가)
  modules/auth/       auth.controller.ts, auth.service.ts, auth.guard.ts, 데코레이터,
                      token-store.ts (인터페이스), 인메모리 구현, Redis 구현
  modules/user/       user.repository.ts (인터페이스 + 임시 구현)
```

- **가드는 `common/`이 아니라 `modules/auth/`에 둔다.** `TokenStore`와 `UserRepository`에 기대기 때문이다. `backend-plan.md` 4절의 "common/ … 가드, 데코레이터"와 달라지므로, 승인되면 4절을 고친다(지금은 고치지 않았다).
- **가드 실패용 예외를 따로 만든다**(`JwtAuthenticationException`, 옛 이름 그대로). "도메인별 예외 하위 클래스 금지" 규칙을 어기는 것이 아니다. 목적이 다르다. 응답 **본문 모양**이 달라서(3.2) `BusinessException`에 태울 수 없다. `ValidationFailedException`을 둔 이유와 같다. 이 예외는 `BusinessException`을 상속하지 않는다(상속하면 필터의 첫 `instanceof` 검사에 먼저 걸린다).
- **가드는 반드시 `throw`로 막는다.** `return false`를 하면 Nest가 `ForbiddenException`을 만들고, 우리 필터는 그것을 500 `C004`로 바꾼다.
- 가드는 전역으로 걸고 기본은 "`USER`·`ADMIN` 로그인 필요"다(옛 `anyRequest().hasAnyRole(...)`). `@Public()`은 검사를 건너뛰고, `@Roles(...)`는 허용 role을 바꾼다.
- `UserRepository`는 M2에서 `findByGithubId`만 가진다. M3·M4에서 필요한 메서드를 그때 더한다.
- `TokenStore`가 하는 일: 리프레시 교체(Lua), 리프레시 조회, 만료 연장, 사용자 토큰 삭제, 블랙리스트 등록, 블랙리스트 조회.
- 새 환경변수(검증과 `.env.example`에 같이 추가): `JWT_SECRET`(Base64, 풀었을 때 32바이트 이상), 액세스·리프레시 수명(**초 단위 정수**로 받아 단위 변환 코드를 없앤다), `COOKIE_DOMAIN`, Redis 접속 정보.
- 새 의존성: `@nestjs/jwt`(`12.0.3`, `@nestjs/common ^12` 호환 확인함), `cookie-parser`(`1.4.7`, peer 의존성 없음 확인함. Express 5에는 쿠키 읽기 기능이 없다), Redis 클라이언트(6절 D2).

## 5. 알려진 차이와 미검증

1. **role이 안 맞는 로그인 사용자의 응답 [미검증]**. 옛 `SecurityConfig`는 `authenticationEntryPoint`만 설정했고 접근 거부 처리기는 없다. 그래서 예를 들어 `PENDING` 사용자가 로그아웃을 부르거나 `USER`가 관리자 API를 부르면 Spring 기본 처리기가 403을 내고, 그 뒤 Spring Boot 내부 `/error` 경로가 보안 검사를 한 번 더 지나는데, 이때 본문이 어떻게 나가는지는 코드만으로 확정할 수 없다. 운영에서 본 응답도 없다. 6절 D1에서 옛 동작의 추정대로 구현하기로 했다.
2. **토큰 없이 없는 경로나 잘못된 메서드를 부를 때**. 옛 필터는 라우팅보다 먼저 돌아서 403 `J004`를 줬다. Nest 가드는 맞는 라우트에서만 돌아서 이 요청은 500 `C004`가 된다. 알려진 차이로 기록한다. 토큰이 있는 요청은 옛 서버도 500이었다고 추정한다(`backend-plan.md` 8절의 "없는 경로 → 500"은 이쪽에 해당하므로 서술을 좁힌다).
3. **로컬 개발의 쿠키 도메인**. 쿠키의 `Domain`이 요청한 호스트와 다르면 브라우저가 쿠키를 버린다. 로컬에서는 `COOKIE_DOMAIN`을 따로 정해야 한다. M2-3에서 확인한다.
4. **개선 후보**: 이 문서에서 찾은 것(토큰 종류 구분 없음, 만료가 400 `C005`로 나가는 것 등)은 `docs/improvement-candidates.md`에 모았다. 1차에서는 옛 동작대로 구현한다.

## 6. 결정이 필요한 것

`AGENTS.md`에 따라 **한 번에 하나씩**, 후보 세 개 이상을 이 프로젝트의 확인된 제약과 비교해서 정한다. 아래는 목록과 이미 확인한 제약뿐이고, 비교와 추천은 해당 항목을 논의할 때 채운다.

- **D1. role이 안 맞을 때의 응답 모양.** **[확정 2026-11-05]** 3.2의 실패와 같은 403 · `ResponseDto` 모양 · `J005`로 구현한다. 사용자 지침(비즈니스 로직은 옛 백엔드를 최대한 따르고, 개선할 점은 `improvement-candidates.md`에 기록)에 따라 옛 동작의 가장 그럴듯한 추정을 골랐다. 옛 응답은 여전히 [미검증]이다. 비교한 안: `ErrorResponse` 모양 + 403 + `C006`(`HANDLE_ACCESS_DENIED`, 옛 `ErrorCode`에 있지만 쓰이지 않던 코드), 403에 본문 없음. 프론트는 403 본문의 `message`를 보여 주고 `code`로 분기하지 않아서 어느 안이든 화면 동작은 같고 문구만 다르다.
- **D2. Redis 클라이언트.** 후보: `ioredis`, `redis`(node-redis), Nest 내장 캐시 추상화(`@nestjs/cache-manager`). 제약: Lua 실행(`EVAL`), `SET EX`, `GET`, `DEL`, `EXPIRE`, `EXISTS`가 필요하고, ESM·Node 24에서 돌아야 한다. npm 조회 결과 `ioredis` 6.0.0, `redis` 6.3.1이 있고 둘 다 Node 20 이상이다. 캐시 추상화가 Lua를 지원하는지는 **[미검증]**.
- **D3. 임시 구현을 어디에 두나.** **[확정 2026-11-05]** `src`에 인메모리 구현을 기본으로 두고 `shortcut:` 주석으로 M4 교체를 적는다. `backend-plan.md` 4절은 "Nest provider override로 인메모리 구현을 끼운다"고 제안했는데, 시험에서만 끼우면 가드가 `UserRepository`를 주입받는 M2-2부터 M4까지 `yarn dev`가 뜨지 않아서 M3의 OAuth 확인이 막힌다. 비교한 안: 시험에서만 끼움(서버가 안 뜸), `src`에 두되 `NODE_ENV=production`이면 시작 거부(교체를 잊는 위험을 코드로 막지만 분기가 늘고, 배포할 서버가 아직 없어 위험이 작다). 제약: M2 동안에는 사용자를 만드는 기능이 없어 인메모리 저장소가 비어 있으므로, 서버를 띄워 직접 로그인해 볼 수는 없고 시험으로 검증한다. 교체를 잊지 않도록 M4 시작 때 `shortcut:` 주석을 `grep`으로 모아 확인한다.
- **D4. Redis 구현을 어떻게 시험하나.** 이 컴퓨터에는 Docker가 없었는데 2026-11-06에 Docker Desktop을 설치했다(후보 (b)의 전제가 갖춰졌고, 선택은 아직 안 했다). 로컬 Redis 컨테이너는 `apps/server/docker-compose.dev.yml`이 있다. 후보: (a) GitHub Actions의 서비스 컨테이너에서만 돌린다, (b) 로컬과 CI에서 돌린다, (c) Redis 모조품 라이브러리를 쓴다(진짜 Redis가 아니라 Lua 동작을 보장하지 못한다). D2에 따라 달라진다.
- **D5. 작업 분할(7절).** **[확정 2026-11-05]** 4개로 간다. 비교한 안: 1개(가장 늦게 정해지는 결정에 전부 막힘), 3개(M2-1과 M2-2를 합침, 첫 PR이 D1까지 기다림), 4개. 결정이 풀리는 순서대로 진행할 수 있어서 4개로 정했다.

## 7. 작업 분할 [제안]

각각 이슈 → 브랜치 → PR이고, 모두 `lint`·`typecheck`·`test`·`build`를 통과해야 한다.

1. **M2-1 토큰과 사용자 조회**: 환경변수 검증 추가, `@nestjs/jwt`로 발급·검증, `UserRepository`(인터페이스 + 임시 구현), `JwtAuthenticationException`과 필터 분기. 시험: 클레임 모양, 만료·서명 오류, 예외 본문이 `ErrorResponse`와 다른 모양인 것.
2. **M2-2 가드와 접근 규칙**: `TokenStore`(인터페이스 + 인메모리), 전역 가드, 데코레이터, 토큰 찾는 순서(3.2)와 실패 4종(코드와 상태), 접근 규칙 표(`test/access/`). 표는 옛 분류 48개를 입력으로 하고 지금 등록된 라우트만 검사한다. 계약 시험처럼 컨트롤러를 옮길 때마다 범위를 넓힌다.
3. **M2-3 reissue·logout**: 컨트롤러, 쿠키 설정(3.5), `cookie-parser`, 3.3·3.4의 세부 동작 시험(HTTP 200인데 본문 401인 경우, 헤더만 블랙리스트에 오르는 경우 포함). 계약 비교 범위에 `reissue`(`ResponseDtoAccessTokenResponse`)와 `logout`(`ResponseDtoString`)을 추가하는 것이 이 PR의 확장 단계다.
4. **M2-4 Redis `TokenStore`**: D2에서 고른 클라이언트로 구현, Lua 교체 스크립트, D4에서 고른 방식의 시험.

## 8. backend-plan.md 정정 [확인한 사실 기준]

이 PR에서 아래만 고친다. 구조나 결정은 바꾸지 않는다.

- 6절 로그아웃: 리프레시 토큰(Redis 키 두 개)도 함께 지운다고 적고, 블랙리스트에 오르는 것은 헤더의 토큰뿐이라고 적는다.
- 6절 갱신: reissue는 Redis의 만료만 늘리고 리프레시 쿠키는 다시 내려주지 않는다고 적는다.
- 8절 쿠키: `SameSite`는 액세스 쿠키 `Lax`, **리프레시 쿠키 `None`** 이다.
- 8절 알려진 차이: 5절 2번을 추가한다.
- 8절 인증 실패 응답 문장: 옛 진입점이 `ResponseDto` 모양으로 만들었고, 접근 거부 처리기는 설정에 없다고 고친다.
- 9절: `api-access.json`이 없으므로 M2-2에서 만든다고 고친다.
- 11절 M2: 이 문서로 연결한다.
- 14절: "ADMIN 부여 지점"은 코드에 없음(덤프에서 확인, M4)으로, "401/403 응답 본문"은 진입점은 확인함·role 부족 응답은 추정(D1)대로 구현한다고 고친다.

## 9. 사용자가 할 일

1. 6절의 결정을 한 번에 하나씩 답한다. D5(분할), D3(임시 구현 위치), D1(role 부족 응답)은 정했다. 남은 것은 D2·D4(Redis, M2-4를 막음)다. M2-1과 M2-2, M2-3은 이 둘을 기다리지 않고 시작할 수 있다.
2. ~~Docker Desktop 설치 여부~~ 설치 완료(2026-11-06). `backend-plan.md` 13절 3번과 같은 항목이다. D4의 시험 방식 선택은 남아 있다.
3. JWT 시크릿은 M2-1 구현 때 만드는 방법을 안내한다. 값은 `.env`에만 둔다.
