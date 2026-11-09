# M3 GitHub 로그인 계획

작성일 2026-11-09 · 상태: 결정 완료, 검토 대기 · 이슈 #31 · 관련: `m2-auth-plan.md`, `backend-plan.md` 9절 ③, `porting-principle.md`

확인 기준: 옛 백엔드 `potato-club/GamzaTechBlog-back`의 `master`와 프론트 `potato-club/GamzaTechBlog-front`의 `master`를 읽기만 했다(코드를 실행하지 않았다). 표시: **[확인함]** 코드에서 읽음, **[추정]** 코드나 문서로 짐작함, **[미검증]** 확인할 방법이 없음.

## 1. 한눈에 보기

옛 백엔드는 로그인 흐름을 직접 짜지 않고 Spring Security의 `oauth2Login`에 맡겼다. 우리가 따라 만들 흐름은 이렇다.

1. 프론트의 "Login with GitHub" 링크가 백엔드의 `/oauth2/authorization/github`로 이동한다.
2. 백엔드가 `state`(위조 방지용 임의 값)를 만들어 두고 GitHub 승인 화면으로 보낸다.
3. 사용자가 승인하면 GitHub가 백엔드의 `/login/oauth2/code/github?code=…&state=…`로 돌려보낸다.
4. 백엔드가 `state`를 확인하고, `code`를 GitHub 액세스 토큰으로 바꾸고, GitHub 프로필을 가져온다.
5. 처음 온 사용자면 `PRE_REGISTER`로 만든다. 액세스·리프레시 JWT를 만들고(M2), 리프레시를 Redis에 교체하고(M2-4), 쿠키 두 개를 내려주고, 프론트로 302 보낸다.
6. 응답을 보낸 뒤 따로(비동기) 이메일과 프로필 이미지를 채우고 GitHub 토큰을 DB에 저장한다.

프론트 비유: 1~5는 "로그인 버튼 → 외부 인증 → 돌아와서 쿠키 심기"이고, 6은 로그인 직후 백그라운드에서 도는 보강 작업이다.

두 경로는 컨트롤러가 아니라 Spring Security 필터가 처리했다. 그래서 OpenAPI 명세와 프론트의 생성 클라이언트에 없다(`contract/front-contract.json`에서 `oauth`·`login/` 검색 0건, [확인함]). 계약 비교 시험의 대상이 아니고, 새 컨트롤러는 명세에서 빼야 한다.

## 2. 범위

M3에 넣는 것: 1~5(시작 경로, 콜백 경로, `state` 검증, 코드 교환, 프로필 조회, 사용자 찾기·만들기, 토큰·쿠키·리다이렉트).

6(로그인 뒤 처리)은 의존하는 저장소가 아직 없다. 이메일 저장은 `UserRepository` 확장, 프로필 이미지는 S3 저장소, GitHub 토큰은 DB(M4)가 필요하다. 이메일은 M3-3에서, 프로필 이미지는 S3 저장소를 이식할 때, GitHub 토큰 저장은 게시글 동기화를 이식하기 전에 정한다(6절 D6·D7).

사용자 저장은 M4 전까지 인메모리(`InMemoryUserRepository`)다. M2와 달리 M3부터는 서버를 띄워 직접 로그인해 볼 수 있다(사용자가 메모리에 만들어지고, 서버를 재시작하면 사라진다).

## 3. 옛 동작 [확인함]

### 3.1 두 경로와 `state`

- 시작 경로 `/oauth2/authorization/github`: `SecurityConfig`의 `loginPage("/oauth2/authorization/github")`. 공개 경로 목록에 `/oauth2/**`와 `/login/oauth2/code/**`가 있다.
- 콜백 경로 `/login/oauth2/code/github`: `redirectionEndpoint`를 바꾸지 않았으므로 Spring 기본 경로다. GitHub 앱에 등록한 redirect-uri 값은 설정 파일(`application.yml`)에서 암호문이라 읽을 수 없다 **[미검증]**.
- `state`는 서버 세션에 저장한다. Spring의 기본 저장소가 `HttpSession`이다(Spring Security 문서 확인함). 세션 정책이 `STATELESS`여도 이 저장소는 세션을 직접 만든다. 그래서 시작 요청에 `JSESSIONID` 쿠키가 따라 나갔을 것이다 **[추정]**.
- 기본 승인 요청의 매개변수: `response_type=code`, `client_id`, `scope`, `state`, `redirect_uri` (Spring 기본 동작).

### 3.2 코드 교환과 프로필 조회

- Spring이 `code`를 GitHub 토큰으로 바꾸고(`DefaultAuthorizationCodeTokenResponseClient`), 사용자 정보 주소를 불러 프로필을 가져온다(`DefaultOAuth2UserService`). 주소들은 설정 파일에서 암호문이라 읽을 수 없지만 GitHub의 표준 주소를 쓴 것으로 본다 **[추정]**.
- 두 호출 모두 연결 2초, 응답 5초 제한과 연결 풀을 설정했다(`OAuth2ClientConfig`). 풀은 성능 튜닝이고 제한 시간은 GitHub가 느릴 때 로그인이 매달리지 않게 하는 동작이다.
- 콜백에서 이메일 API(`/user/emails`)는 부르지 않는다. 프로필의 `email`이 비공개면 `null`로 둔다.

### 3.3 사용자 만들기 (`OAuth2LoginSuccessHandler`, `GithubUser`, `UserMapper`)

- `githubId`는 `"g_" + GitHub 숫자 id`다. JWT 클레임과 DB의 `github_id`가 모두 이 값이다.
- 처음 온 사용자(`existsByGithubId`가 false)만 만든다. 필드: `name` = 프로필의 `name`(없으면 `login`), `nickname` = `login`, `email` = 프로필의 `email`(비공개면 `null`), `role` = `PRE_REGISTER`, 나머지는 `null`.
- 이미 있는 사용자는 아무것도 갱신하지 않는다(이름·닉네임이 GitHub에서 바뀌어도 그대로).

### 3.4 토큰, 쿠키, 이동 (`OAuth2LoginSuccessHandler`)

순서: 사용자 만들기 → 액세스·리프레시 JWT 발급 → `rotateRefreshToken`(M2-4가 이미 옮김) → 쿠키 두 개 → 비동기 후처리 이벤트 발행 → 리다이렉트.

- 쿠키는 M2-3에서 옮긴 것과 같다(`authorization`: HttpOnly 아님, Lax / `refreshToken`: HttpOnly, SameSite=None, 둘 다 Secure, 수명 1시간·30일, 도메인은 `COOKIE_DOMAIN`).
- 이동 주소: 콜백 요청의 쿼리 `location`을 소문자로 바꾸고 허용 목록(`app,dev,preview`)에 있는지 본다. 없거나 목록 밖이면 기본값(`app`). 주소는 `https://{location}.{도메인 접미사}`이고 접미사 기본값은 `gamzatech.site`다. 값은 환경변수 `AUTH_*`로 바꿀 수 있었다.
- `location`은 **콜백 요청**에서 읽는다. 콜백 주소는 GitHub가 정한 redirect-uri라서, 시작 요청에 붙인 `?location=`은 거기까지 오지 않는다. redirect-uri 설정에 `location`이 들어 있지 않다면 이 값은 항상 비어 있고 항상 기본값으로 이동했을 것이다 **[추정]**.

### 3.5 로그인 뒤 비동기 처리 (`GithubPostLoginHandler`)

응답을 보낸 뒤 `@Async` 스레드에서 돈다. 어느 단계가 실패해도 로그만 남기고 사용자에게는 알리지 않는다.

1. GitHub 액세스 토큰을 Spring이 메모리에 보관한 인증 정보(`OAuth2AuthorizedClientService`)에서 꺼낸다. 없으면 여기서 끝낸다.
2. 사용자에게 이메일이 없거나 프로필 이미지가 없으면: 프로필 API로 `avatar_url`을, 이메일 API(`/user/emails`)로 "주 이메일이면서 인증된 것"을 가져온다. 이메일이 비어 있을 때만 저장하고, 프로필 이미지는 GitHub 이미지를 S3에 올려 붙인다(올리기 실패는 경고만 남기고 계속).
3. GitHub 액세스 토큰을 `github_tokens` 테이블에 **평문으로** 저장하거나 갱신한다(`GithubOAuthTokenDaoImpl`, 컬럼 길이 2000).

저장한 토큰은 게시글을 GitHub 저장소에 동기화할 때 쓴다(`PostServiceImpl`이 `GithubTokenValidator`로 꺼내 `GET https://api.github.com/user`로 살아 있는지 확인). 없으면 `GITHUB_OAUTH_TOKEN_NOT_FOUND`, 무효면 `GITHUB_OAUTH_TOKEN_INVALID`다.

### 3.6 요청하는 권한(scope)

설정 파일의 `scope`가 암호문이라 실제 값은 읽을 수 없다 **[미검증]**. 코드에는 쓰이지 않는 상수 `GITHUB_OAUTH_SCOPES = {read:user, user:email, repo}`가 있다. `user:email`은 이메일 API에, `repo`는 저장소 생성·파일 쓰기(`GithubApiClient`)에 필요해서 상수의 세 개가 실제 값일 가능성이 높다 **[추정]**.

### 3.7 실패했을 때

`SecurityConfig`에 실패 처리기(`failureHandler`)가 없다. 이 경우 Spring의 기본 실패 주소는 `loginPage + "?error"`, 즉 `/oauth2/authorization/github?error`로 보인다 **[추정]**. 그 주소는 시작 경로와 같은 필터가 받으므로 다시 GitHub로 보내진다. 사용자가 승인을 취소하거나(`access_denied`) `state`가 맞지 않으면 에러 화면 없이 로그인이 처음부터 다시 시작되는 모양이다.

### 3.8 프론트

로그인 링크는 `process.env.NEXT_PUBLIC_OAUTH_LOGIN_URL || "/api/auth/github"`다(`HeaderNavigation.tsx`, `mypage/page.tsx`). 환경변수 값은 저장소에 없다. 대체값 `/api/auth/github`는 백엔드에 없는 경로라서 운영에서는 환경변수가 채워져 있었을 것이다 **[추정]**. 옛 프론트의 배포 주소는 `https://app.gamzatech.site`다(README). 3.4의 이동 주소 기본값 `app` + `gamzatech.site`와 맞는다.

## 4. 새 구조 [제안]

```
apps/server/src/modules/auth/
  github-login.controller.ts   두 경로(시작, 콜백). @Public(), 명세에서 제외
  github-login.service.ts      콜백 흐름: 코드 교환 → 프로필 → 사용자 → 토큰 → 쿠키 값
  github-client.ts             GithubClient 추상 클래스(코드 교환, 프로필, 이메일)
  fetch-github-client.ts       Node 내장 fetch로 만든 구현. 제한 시간 5초
modules/user/user.repository.ts   existsByGithubId, create 추가 (인메모리 구현도)
```

- `GithubClient`는 `AGENTS.md`가 "바꿔 끼울 곳"으로 든 이름이다. 시험은 가짜 `GithubClient`를 끼워 GitHub를 실제로 부르지 않는다.
- 쿠키는 M2-3의 `auth-cookie.ts`를 쓴다. 로그인에서만 필요한 `setRefreshTokenCookie`를 하나 더한다.
- 새 환경변수(검증과 `.env.example`에 같이 추가): `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`(비밀), `GITHUB_REDIRECT_URI`(콜백 전체 주소. GitHub 앱에 등록한 값과 같아야 한다), 이동 주소 설정 `OAUTH_REDIRECT_DOMAIN_SUFFIX`·`OAUTH_DEFAULT_LOCATION`·`OAUTH_ALLOWED_LOCATIONS`(D3). 값은 `.env`에만 둔다. 세션 쿠키 서명 키는 환경변수로 받지 않는다(D1).
- 두 경로는 OpenAPI에서 뺀다(`@ApiExcludeController`).
- 세션 미들웨어(`express-session`, `@types/express-session`)는 `main.ts`가 아니라 로그인 모듈의 `configure()`에서 두 경로에만 건다(D1). `main.ts`에 두면 시험 앱에는 적용되지 않기 때문이다(`m2-auth-plan.md` D6과 같은 이유). 시험 앱은 `main.ts`를 거치지 않고 `createNestApplication`으로 만든다.

## 5. 알려진 차이와 미검증

1. **요청 scope [미검증]**: 3.6. D5에서 상수의 세 개로 정했다(옛 실제 값은 여전히 [미검증]).
2. **실패 시 동작 [추정]**: 3.7. D2에서 옛 추정 동작대로 구현하기로 정했다.
3. **`location`이 실제로 쓰였는지 [추정]**: 3.4. D3에서 옛 형식 그대로 옮기기로 정했다.
4. **새 도메인과 이동 주소**: 새 프론트는 `blog.gamza.xyz` 하나이고(`infra-notes.md`), 옛 형식 `https://{location}.{접미사}`에서 `app`이 `blog`로 바뀐다. 백엔드 서브도메인은 아직 없어서 콜백 주소와 `COOKIE_DOMAIN`은 모두 환경변수다.
5. **GitHub OAuth 앱의 콜백 주소 개수 [미검증]**: GitHub 문서(`github/docs` 저장소 main)에는 OAuth 앱에도 "첫 번째 콜백 주소"와 콜백 주소별 와일드카드 설정이 나온다. 내가 알기로 예전에는 하나뿐이어서 로컬용과 운영용 앱을 따로 만들었다(이 부분은 문서로 확인하지 못했다). 지금은 여러 개 등록이 되는 것으로 보이지만, 설정 화면에서 직접 확인한 것이 아니다. 앱 생성 때 확인한다(9절).
6. **로컬의 쿠키와 이동**: 이동 주소 형식에 포트가 없어서 로컬 프론트(`localhost:3000`)로는 돌아올 수 없다. 로컬에서는 콜백 응답의 `Location`과 `Set-Cookie` 헤더를 개발자 도구로 확인한다. 쿠키 `Domain` 속성은 `m2-auth-plan.md` 5절 3번과 같은 [미검증]이다.
7. **개선 후보**: 이 문서에서 찾은 것은 `improvement-candidates.md` 15~18번에 모았다. 1차에서는 옛 동작대로 구현한다.

## 6. 결정이 필요한 것

1차는 옛 동작을 그대로 옮긴다(`porting-principle.md`). 아래는 옛 코드가 정해 주지 못하는 부분(구현 방식, 읽을 수 없는 설정, 의존하는 저장소가 아직 없는 일, 보안상 못 옮기는 동작)에서 어떻게 했는지의 기록이다. 옛 동작이 정해 주는 것은 새로 비교하지 않고 따른다(사용자 지침 2026-11-09: 개선할 점은 `improvement-candidates.md`에만 적는다).

- **D1. `state` 저장 방식.** **[확정 2026-11-09, 사용자 결정: 옛 방식대로]** 서버 메모리 세션(`express-session`의 기본 `MemoryStore`)에 `state`를 넣고, 브라우저에는 세션 쿠키만 준다. 옛 Spring의 기본 동작(`HttpSession`에 승인 요청 저장)과 같다. 옛 `SecurityConfig`에는 보관 방식을 정하는 설정이 없어서, 팀이 고른 방식이라기보다 프레임워크 기본값이었을 것이다 **[추정]**. 추천했던 안(쿠키에 담기)은 개선 후보 17번에 남겼다.
  - 비교한 안: **쿠키에 담기**(추천했던 안. 서버가 기억할 것이 없고 새 패키지도 없다. `SameSite=Lax` 쿠키는 GitHub에서 넘어오는 최상위 GET 이동에 실린다). **세션 + `MemoryStore`**(고름. 옛 동작과 같다). **세션 + Redis 보관소**(`connect-redis` 10.0.0은 node-redis 전용이라 ioredis(M2-4 D2)와 맞지 않는다. 쓰려면 두 번째 Redis 클라이언트를 들이거나 보관소를 ioredis로 직접 만들어야 한다). **Redis에만 두기**("우리가 발급한 값인가"만 확인하고 "그 브라우저의 것인가"는 확인하지 못해서, 공격자의 `code`로 피해자를 로그인시키는 공격을 막지 못한다. 쿠키를 곁들이면 세션과 같아진다).
  - 한계 `shortcut:` (`express-session` 문서 기준): `MemoryStore`는 서버 한 대 전제이고 운영에서는 "메모리가 샌다"는 경고를 낸다. 서버를 재시작하거나 배포하면 진행 중이던 로그인은 실패한다. 로그인 시작 경로는 로그인 전에도 열려 있어서 호출할 때마다 세션이 하나 생기고, 콜백까지 가지 않은 세션은 서버를 재시작하기 전까지 메모리에 남는다. 완화: 세션은 시작 경로에서 값을 쓸 때만 만들고(`saveUninitialized: false`), 콜백이 끝나면 `destroy`로 지운다. 문제가 되면 ioredis로 보관소를 직접 만든다.
  - 제약과 결과: 세션 쿠키 서명 키는 부팅마다 새로 만든다(세션이 메모리에만 있어 재시작하면 어차피 사라지므로 환경변수 `SESSION_SECRET`이 필요 없다. 처음 계획에서 바꿨다). 세션 수명은 30분이다(옛 서블릿 세션 기본값으로 추정 **[추정]**). 세션 쿠키는 `HttpOnly`, `SameSite=Lax`이고 `Secure`는 켜지 않는다(`secure: true`는 Nginx 뒤에서 `trust proxy`를 설정하지 않으면 쿠키가 내려가지 않는다. 문서 기준). 옛 `JSESSIONID`도 `Secure` 설정이 없었다고 본다 **[추정]**. 그래서 `state`는 로컬 `http://localhost`에서도 동작한다. 로그인 후의 인증 쿠키(`Secure`)가 로컬에서 받아지는지는 M2부터 이어진 [미검증]이다. 세션 쿠키 이름은 라이브러리 기본값 `connect.sid`이고 프론트는 읽지 않는다.
- **D2. 로그인 실패 때의 응답.** **[확정 2026-11-09]** 옛 동작 **[추정]**(3.7)대로 실패하면 `/oauth2/authorization/github?error`로 302를 보낸다. 그 주소는 시작 경로와 같은 처리라서 다시 GitHub로 이어진다. 실패의 범위: 사용자가 승인을 취소(`error` 쿼리), `code`나 `state`가 없음, `state` 불일치(세션이 없는 경우 포함), 코드 교환이나 프로필 조회 실패.
  - 비교한 안: **옛 동작 그대로**(고름. 일시 실패는 자동으로 복구되지만 승인을 취소하면 GitHub 화면이 다시 뜨고, 설정이 틀리면 이동이 반복되어 브라우저가 멈춘다). **프론트로 오류 표시를 붙여 이동**(`/?error=…`. 반복 이동은 없고 프론트를 고칠 필요도 없지만, 프론트에 `error` 쿼리 처리가 없어서 문구는 뜨지 않고 자동 복구도 되지 않는다. 옛 동작과 다름). **JSON 오류 응답**(`ErrorResponse`. 시험은 쉽지만 사용자가 JSON 문서를 보게 된다. 옛 동작과 다름).
  - 제약: 우리 `ErrorResponse`와 `BusinessException`은 JSON 응답용이고 로그인은 브라우저가 이동하는 요청이다. 옛 동작은 코드로 확인하지 못했다. D1(메모리 세션)과 짝이 맞는다: 서버를 재시작해서 `state`가 사라져도 새 로그인이 자동으로 시작된다. 개선은 15번.
  - 구현 메모: 실패 원인은 서버 로그에만 남기고(값인 `code`·`state`·secret은 남기지 않는다) 응답에는 담지 않는다. 시험으로 고정한다.
- **D3. 로그인 뒤 이동 주소.** **[확정 2026-11-09]** 옛 형식 그대로 옮긴다. 콜백 요청의 `location` 쿼리를 앞뒤 공백 제거·소문자 변환해서 허용 목록에 있으면 쓰고, 없거나 목록 밖이면 기본값을 쓴다. 주소는 `https://{location}.{도메인 접미사}`다. 환경변수는 `OAUTH_REDIRECT_DOMAIN_SUFFIX`(기본 `gamza.xyz`), `OAUTH_DEFAULT_LOCATION`(기본 `blog`), `OAUTH_ALLOWED_LOCATIONS`(쉼표로 구분, 기본 `blog`)로 구현했다(M3-2). 허용 목록은 쉼표로 구분하고, 값은 소문자 영문·숫자·하이픈만 받는다.
  - 비교한 안: **옛 형식 그대로**(고름. 옛 코드와 같고, `dev`·`preview` 서브도메인을 환경변수만으로 더할 수 있다. 포트와 `http`를 쓸 수 없고 `location`이 사실상 안 쓰였을 수 있다). **프론트 주소 하나를 환경변수로**(`FRONTEND_URL`. 코드가 가장 짧고 로컬 프론트로 돌아올 수 있지만, 옛 코드에 있던 `location` 기능을 뺀다). **완성된 주소의 허용 목록과 기본값**(로컬과 운영을 모두 지원하지만 옛 구조에서 많이 벗어나 1차에는 과하다).
  - 제약: 새 프론트는 `blog.gamza.xyz` 하나다(`infra-notes.md`). 허용 목록 검사는 아무 주소로나 보내는 취약점(open redirect)을 막으므로 시험으로 고정한다(목록 밖 값, 대소문자·공백, 값 없음). `location`은 콜백 요청에서 읽고 시작 요청에 붙인 값은 거기까지 오지 않아서 사실상 항상 기본값일 수 있다 **[추정]**. 로컬 프론트(`localhost:3000`)로는 돌아올 수 없다(5절 6번). 개선은 18번.
- **D4. GitHub 호출 방법.** **[확정 2026-11-09]** Node 내장 `fetch`로 직접 구현하고 `GithubClient` 뒤에 둔다. `backend-plan.md` 9절 ③의 [제안](기록된 이유는 "약 80줄"뿐이었다)을 비교한 뒤 확정했다. 프론트가 쓰는 방식은 어느 안이든 같다(링크로 이동, 쿠키 읽기). 이 결정은 백엔드가 GitHub 서버에 요청을 보내는 방법만 정한다.
  - 비교한 안: **직접 `fetch`**(새 패키지 없음, `state` 검증이 우리 코드에 보임, 약 80줄 **[추정]**). **Arctic 3.7.0**(ESM, 승인 주소 조립과 코드 교환을 해 주고 GitHub의 "실패도 200" 응답을 오류로 던진다. 프로필·이메일 조회와 `state`의 쿠키 보관·비교는 하지 않는다. 줄어드는 양은 20~30줄 **[추정]**, 의존성 1개). **Passport**(`@nestjs/passport` 12.0.1 + `passport` 0.7.0 + `passport-github2` 0.1.12, 의존성 3개. 옛 Spring 구조와 가장 비슷하지만, `state` 옵션을 켜지 않으면 검증이 없고 켜면 기본 보관소가 세션을 요구한다(passport-oauth2 문서). `passport-github2`의 마지막 수정은 2022-06-23이다. 가드가 실패 때 `HttpException`을 던지면 전역 필터가 500 `C004`로 바꾸는 규칙과 부딪힐 수 있다 **[미검증: 직접 실행하지 않음]**).
  - 제약: 필요한 호출은 코드 교환(POST), 프로필(GET), 이메일(GET) 세 개이고 Node 24에 `fetch`가 있다. 옛 서비스의 로그인 제공자는 GitHub 하나뿐이다(`OAuthProvider`).
  - 구현 때 처리할 것: GitHub는 코드 교환이 실패해도 HTTP 200으로 주고 본문에 `error`를 넣는다(옛 코드는 `access_token`이 없으면 실패로 처리했다). 제한 시간은 옛 설정(연결 2초·응답 5초)을 `fetch`로 나눌 수 없어 `AbortSignal.timeout(5000)` 하나로 둔다. 로그인 제공자가 늘어나면 Arctic을 다시 검토한다.
- **D5. 요청 scope.** **[확정 2026-11-09]** `read:user user:email repo`(옛 상수 그대로). 옛 설정값은 암호문이라 이 세 개가 실제 값이라는 것은 끝까지 **[추정]**이다. 근거: 옛 `GithubApiClient`가 부르는 호출이 요구하는 권한과 맞는다(GitHub 문서 확인함: 이메일 조회 `user:email`, 저장소 생성은 `public_repo` 또는 `repo`, 비공개 저장소 쓰기는 `repo`).
  - 비교한 안: 상수의 세 개(옛 동작과 같고 게시글 동기화를 옮길 때 다시 승인받을 일이 없다. `repo`가 넓다), 두 개(`repo` 뺌. 가장 가볍지만 동기화 이식 때 이미 로그인한 사용자가 다시 승인해야 하고 옛 동작과 다르다), `public_repo`(공개 저장소만. 옛 저장소 생성 호출은 `private`을 지정하지 않아 공개 저장소가 만들어진다(문서 확인함). 비공개 저장소에는 쓰지 못한다).
  - 제약: `backend-plan.md` 12절이 "GitHub 스코프 축소"를 1차 범위 밖으로 뺐다. 권한이 넓다는 점은 그 항목에서 이식 뒤에 다룬다. 요청 때 `scope`는 공백으로 이어 붙인다.
- **D6. 로그인 뒤 보강(이메일·프로필 이미지)을 어디까지.** **[확정 2026-11-09]** 옛 동작(3.5)을 그대로 옮기되, 의존하는 저장소가 생기는 순서로 나눈다. 이메일 보강은 M3-3에서, 프로필 이미지는 S3 저장소를 이식할 때, GitHub 토큰 저장은 D7에서 정한다. 사용자에게 고르게 한 안이 아니라 옛 동작을 의존 순서대로 나눈 것이다.
  - 이유: 이메일은 GitHub 호출(`GithubClient`에 이미 포함)과 사용자 저장소의 "이메일이 비었으면 채우기"만 있으면 된다. 프로필 이미지는 S3에 올리는 저장소(`infra/storage`)와 이미지 주소 검증이 필요한데 아직 없다.
  - 구현 방식: Node에는 `@Async`가 없어서 응답(302)을 보낸 뒤 `void promise.catch(로그)`로 따로 돌린다(새 패키지 없음). 옛 동작대로 실패는 로그만 남긴다(개선 후보 16번). 옛 서버는 GitHub 토큰을 Spring이 메모리에 쥔 인증 정보에서 꺼냈지만, 우리는 코드 교환 때 받은 토큰을 바로 넘긴다(눈에 보이는 차이 없음).
  - 옛 동작의 세부: 로그인 때마다 이메일이 비었는지 다시 본다(첫 로그인만이 아니다). 이메일이 이미 있으면 GitHub를 부르지 않는다. "주 이메일이면서 인증된 것"만 쓴다.
- **D7. GitHub 액세스 토큰 보관.** `porting-principle.md`가 "보안상 그대로 이식할 수 없는 동작은 먼저 묻는다"고 한 항목이다. 옛: 평문 DB 저장(`AGENTS.md`는 옛 `github_tokens` 테이블 복원도 금지). 쓰이는 곳: 게시글 GitHub 동기화. **[보류 2026-11-09]** M3에서는 GitHub 토큰을 저장하지 않는다(DB가 M4 이후이고, 쓰는 곳인 게시글 동기화가 아직 없어서 눈에 보이는 차이가 없다). 보안상 평문 저장을 그대로 옮길 수 없는 항목이라, 게시글 GitHub 동기화를 이식하기 전에 사용자에게 방식을 묻는다(`porting-principle.md`). 참고로 생각해 둔 안: 암호화해서 DB에, Redis에 만료를 붙여서, 저장하지 않고 필요할 때 다시 로그인시키기.
- **D8. `modules/auth/` 폴더.** **[확정 2026-11-09]** 이번에는 정리하지 않는다. 새 파일은 `modules/auth/`에 평평하게 둔다(M2의 결정 그대로). 파일 이동과 이름 변경은 요청을 따로 받는 일이라 사용자가 요청하면 별도 PR로 한다(안: `guard/`와 `store/`만 분리).
- **D9. 작업 분할.** **[진행 2026-11-09]** 7절의 3개로 간다.

## 7. 작업 분할 [제안]

각각 이슈 → 브랜치 → PR이고, 모두 `lint`·`typecheck`·`test`·`build`를 통과해야 한다.

1. **M3-1 GitHub 호출과 환경변수**: `GithubClient`와 fetch 구현, 환경변수 검증과 `.env.example`. 시험: 가짜 `fetch`로 요청 모양(주소, 헤더, 본문)과 오류 처리. 선행 결정: D4, D5.
2. **M3-2 시작·콜백 흐름**: 두 경로, `state` 검증, 사용자 찾기·만들기, 토큰·쿠키·이동. 시험: 가짜 `GithubClient`로 새 사용자, 기존 사용자, `state` 불일치, 취소, 이동 주소, 쿠키 속성, 리프레시 교체. 선행 결정: D1, D2, D3.
3. **M3-3 로그인 뒤 이메일 보강**: 응답을 보낸 뒤 `void`로 따로 돌려서 이메일이 비었으면 채운다(D6). 시험: 비었을 때만 채움, 이미 있으면 GitHub를 부르지 않음, GitHub 실패는 삼키고 로그만 남김. 프로필 이미지와 토큰 저장은 이 단계에 없다(D6·D7).

폴더 정리(D8)는 하지 않는다.

## 8. 문서 정정

이 PR에서는 `improvement-candidates.md`에 15~18번만 추가한다. `backend-plan.md`는 결정이 나온 뒤 필요한 곳(9절 ③의 "약 80줄", 14절의 미해결 항목)만 고친다.

## 9. 사용자가 할 일

1. 6절의 결정은 끝났다. D7(GitHub 토큰 보관)만 게시글 동기화를 이식하기 전에 묻는다.
2. GitHub OAuth 앱 만들기는 로그인을 직접 해 보는 M3-2 직전에 단계별로 안내한다(M3-1은 환경변수가 운영 밖에서 선택이라 앱 없이도 진행된다). 값(Client ID, Client Secret)은 `.env`에만 두고 채팅·커밋에 쓰지 않는다. 앱 설정에서 콜백 주소를 여러 개 넣을 수 있는지 그때 확인한다.
3. 새 프론트가 쓸 `NEXT_PUBLIC_OAUTH_LOGIN_URL` 값은 백엔드 주소가 정해진 뒤 Vercel 환경변수에서 바꾼다(프론트 저장소 변경이 아니다).
