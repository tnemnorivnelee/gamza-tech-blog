# GamzaTechBlog 백엔드 구현 계획

작성일 2026-11-03 · 상태: **초안 2판** (이식 원칙 반영, 제안 항목은 사용자 검토 전, 레포 형식은 11-04 확정)

## 0. 읽는 법

- **[확정]** 사용자와 이미 합의한 것. 다시 열지 않는다.
- **[이식]** 옛 백엔드 코드에서 확인한 동작을 그대로 옮기는 것.
- **[제안]** 사용자가 결정을 위임해서 Claude가 정한 것(기능을 더하는 것은 없다). 이유를 읽고 싫으면 바꾼다.
- **[미검증]** 덤프나 실물을 보기 전에는 사실이 아닌 것. 구현 중 확인한다.
- 프론트 비유: Nest 모듈 ≈ `src/features/*`, DTO ≈ 생성된 API 타입, Repository ≈ ORM을 감싸는 서비스 레이어.

## 1. 목표와 범위

- **이식 원칙** [확정, 2026-11-03 사용자 지시]: 옛 백엔드와 동작이 같게 옮긴다. 옛 서비스에 없던 기능이나 동작 변경은 1차에 넣지 않는다. 새 기능은 이식이 끝난 뒤 따로 논의한다.
- **목표** [확정]: 옛 Java 백엔드를 NestJS로 다시 만든다. 프론트가 쓰는 API 35개를 **같은 계약**으로 제공해서 프론트 수정을 최소로 한다.
- **1차 범위 밖** [제안, 기능을 더하는 게 아니라 덜하는 제안]: 프론트가 안 쓰는 13개(admission 5, project 4, 프로필 이미지 조회·삭제, 댓글 단독 조회, 커밋 이력). 이유: 쓰는 곳이 없고(홍보 사이트도 폐기), 덤프를 본 뒤 필요하면 추가해도 늦지 않다. 테이블은 DB에 그대로 있으므로 데이터는 잃지 않는다.

## 2. 레포 형식

**[확정] 안 2 (2026-11-04 사용자 선택). 폴더는 `apps/web`(프론트, 나중에 이동)과 `apps/server`(백엔드).** 사용자가 모노레포 경험을 원한다. CI/CD를 빼고 봐도 판단 기준이 남는다.

- CI/CD와 별개로 남는 것: 프론트 `main`에 push하면 `sync-to-fork.yml`이 개인 포크로 **force push**하고 Vercel이 이어서 빌드한다. 이것은 배포 자동화가 아니라 **지금 운영 중인 프론트의 연결 구성**이다. 프론트를 옮기는 안은 CI/CD를 생각하지 않아도 이 구성을 건드린다.
- 모노레포의 대표 이점인 코드 공유는 이 프로젝트에서 약하다. 두 쪽이 공유하는 것은 OpenAPI 계약뿐이고 `gen:api`로 이미 분리돼 있다. 이점은 한 곳에서 관리하는 경험 쪽이다.

후보 세 가지:

- **안 1. 별도 레포로 시작하고 나중에 합친다.** 운영 중인 프론트를 건드리지 않는다. 합칠 때는 `git subtree` 등으로 양쪽 히스토리를 보존할 수 있어서 지금 선택이 나중을 막지 않는다.
- **안 2. 새 모노레포를 만들고 백엔드를 `apps/server`에 넣는다. 프론트는 나중에 `apps/web`으로 옮긴다. (Claude 추천, 사용자 선택)** 워크스페이스 구성, 공통 tsconfig·eslint 같은 모노레포 경험을 지금 시작하면서 운영 프론트는 건드리지 않는다. 프론트가 들어오기 전까지는 앱이 하나뿐인 모노레포다.
- **안 3. 지금 프론트 레포를 `apps/web` + `apps/server`로 재구성한다.** 가장 완전한 경험이지만 운영 사이트의 배포 경로를 바꾼다: Vercel Root Directory, `sync-to-fork.yml`의 force push(백엔드 코드도 개인 포크로 나간다), 파일 이동에 따른 `git blame`과 이슈·PR 흐름, CLAUDE.md 경로. blog.gamza.xyz를 막 연결한 시점이라 위험이 가장 크다.

- 도구는 yarn 워크스페이스만 쓰고, turbo/nx는 앱이 둘이 된 뒤에 도입을 검토한다. [제안]
- **새 레포**로 만든다. 옛 `GamzaTechBlog-back`은 재사용하지 않는다. 이유: public이고 Jasypt 암호문이 커밋돼 있고 Java다.
- **위치는 개인 계정을 추천**한다(안 1·2 기준. 안 3은 프론트가 있는 org 레포). org에서 사용자는 `member`이고 org 설정상 멤버도 레포를 만들 수 있다(확인함). 레포를 만든 사람은 그 레포의 admin이 되므로 시크릿 설정 자체는 가능하다. 그래도 org 레포의 최종 통제권은 org 소유자에게 있고, 팀원이 떠나 인프라가 내려간 전례가 있으며, 포트폴리오로 보여 주기에는 개인 계정이 낫다. 이름은 `gamza-tech-blog`로 정했다(개인 계정에 글 저장용 `GamzaTechBlog` 레포가 이미 있어서 겹치지 않게 했다). 비공개로 시작한다.

## 3. 기술 스택

- **Node 24(LTS) + NestJS 12 + TypeScript strict + Express** [제안]. Nest 12 CLI의 개발 의존성이 Node `^22.22.3 || ^24.15 || >=26`을 요구한다(로컬 22.21.1로는 설치가 막히는 것을 확인했다). Nest 12 공식 템플릿의 `@types/node`도 24 기준이라 Node 24로 정했다. Fastify는 이 규모에서 얻는 게 없다.
- **테스트는 vitest, 린트는 oxlint, 모듈은 ESM** [제안]. Nest 12 공식 템플릿의 기본값이다. Jest·ESLint와 사용법이 거의 같고, 기본값을 거스르면 설정을 직접 유지해야 한다. 우리 쪽 변경은 `any` 금지(`no-explicit-any: error`)를 켠 것뿐이다. 템플릿의 `oxlint.json`은 oxlint가 자동으로 읽지 않는 이름이라 `.oxlintrc.json`으로 바꿨다(이전 이름에서는 `any`가 통과함을 확인).
- **패키지 매니저는 yarn** [제안]. 프론트와 같은 습관을 유지한다.
- **검증은 class-validator DTO** [제안]. `@nestjs/swagger`가 클래스 데코레이터에서 스키마를 뽑아서, zod를 쓰면 어댑터가 하나 더 필요하다.
- **설정은 `@nestjs/config` + 시작 시 검증** [제안]. 환경변수가 하나라도 빠지면 부팅을 실패시킨다. 운영 중에 터지는 것보다 낫다.
- **로깅은 Nest 기본 Logger** [제안]. JSON 구조화 로깅은 서버를 올릴 때 다시 본다.
- 확정된 것: MySQL 8, Prisma(조건부), Redis [확정].

## 4. 프로젝트 내부 구조

```
apps/server/src/      (모노레포 루트는 yarn 워크스페이스 "apps/*")
  main.ts            부팅, Swagger, 쿠키·CORS 설정
  config/            환경변수 스키마와 검증
  common/            ResponseDto, PagedResponse, ErrorCode, 예외 필터, 가드, 데코레이터
  infra/             prisma/ redis/ storage/(이미지) gemini/ github/
  modules/
    auth/  user/  admin/  post/  tag/  comment/  like/  intro/  image/  chat/
```

- **도메인당 Nest 모듈 하나**, 옛 `domain/` 폴더를 그대로 따라간다. [제안] 이유: 옛 코드를 보면서 옮기기 쉽다.
- **층은 controller → service → repository** [제안]. Prisma는 `*.repository.ts`에서만 import한다. 그러면 "ORM은 어댑터 안에만"이라는 확정 사항이 지켜진다.
- **인터페이스는 갈아끼울 곳에만** 둔다 [제안]: `TokenStore`(Redis), `ImageStorage`, `ChatClient`(Gemini), `GithubClient`. 이유: 저장소와 외부 API는 실제로 바뀔 가능성이 있고, 나머지는 바뀔 일이 거의 없다.
- 인증은 사용자 테이블에 기대므로(6절) `auth`는 `user` 모듈의 `UserRepository`를 주입받는다. M2~M3에서는 인메모리 구현으로 바꿔 끼워(Nest provider override) 개발하고, Prisma 구현은 M4에서 넣는다. [제안]
- 도메인마다 완전한 헥사고날을 만들지 않고, CQRS도 쓰지 않는다. 이유: API 35개 규모에서는 파일만 늘고 얻는 게 없다.
- 응답 래핑은 **컨트롤러가 `ok(message, data)` 헬퍼를 직접 호출**한다 [제안]. 자동 인터셉터는 쓰지 않는다. 이유: 옛 코드가 메시지를 직접 지정했고 Swagger 스키마도 명시적으로 남는다.

## 5. API 계약 호환 (가장 큰 위험)

"OpenAPI 계약 유지"는 경로만 맞추면 끝이 아니다. 아래가 전부 **필수 조건**이다.

**확인한 사실**
- 스펙 주소는 `/v3/api-docs/all`이다(springdoc 그룹 `all`). `gen:api`는 openapi-generator 7.14.0의 `typescript-fetch`, 옵션 `typescriptThreePlus, useInterfaces, disableESLint`로 `DefaultApi` 클래스 **하나**(48개)와 모델 65개를 만든다.
- 성공 응답은 `ResponseDto {status, message, data(null이면 생략), timestamp(epoch ms)}`이고 목록은 `PagedResponse {content, page(0부터), size, totalElements, totalPages}`이다.
- 에러 응답은 `{message, status, code(문자열), errors:[{field,value,reason}]}`이다. 프론트는 `body.message`와 `body.code`를 읽는다(`src/lib/actionResult.ts`, `imageService.ts`).
- 스키마 이름은 `ResponseDtoXxx`, `PagedResponseXxx`, `ResponseDtoListXxx` 같은 형태다. 날짜는 프론트가 `new Date(json[...])`로 읽는다.

**포팅 기준** [제안]: 옛 레포의 컨트롤러·DTO·`ErrorCode`를 필드 단위로 1:1 옮긴다(무엇을 만들지의 기준). 프론트의 생성 코드(`src/generated/api/`)는 운영 스펙을 받아 만든 결과라서 **최종 심판**으로 쓴다(맞는지의 기준). 옛 레포 `master`가 운영에 배포된 코드와 다를 수 있으므로 둘이 어긋나면 프론트 생성 코드를 따른다. 이 두 출처로 충분하고 옛 서버를 다시 띄울 필요는 없다(DB, Redis, 복호화 비밀번호가 필요하다).

**지켜야 할 것** [제안]
1. **operationId = 메서드 이름.** `operationIdFactory: (_, method) => method`. `DefaultApi`가 하나뿐이라 메서드 이름은 컨트롤러 전체에서 유일해야 하고, 비교 함수가 중복을 검사한다. 예약어 `delete`는 그대로 쓴다(생성기가 `_delete`로 바꾼다).
2. **태그를 붙이지 않는다.** typescript-fetch는 태그마다 API 클래스를 나눠서 프론트 import가 전부 깨진다. `@nestjs/swagger`는 컨트롤러 이름으로 태그를 **자동으로 붙이므로**(시험에서 `FakeComment` 태그가 실제로 나왔다) `createDocument`에 `autoTagControllers: false`를 준다. [확인함] 옛 컨트롤러는 `@Operation(tags = "댓글 기능")` 같은 한글 태그를 `@Operation` 45개 중 32개에 붙였는데도 프론트에는 `DefaultApi`뿐이다. 한글만 있는 태그를 생성기가 지워서 기본 클래스로 모았을 가능성이 있지만 [미검증], 우리는 태그를 두지 않으므로 어느 쪽이든 `DefaultApi`가 되는 것이 기대값이다. 전체 생성기 diff(M8)로 확인한다.
3. **제네릭 래퍼 이름을 명시한다.** Nest는 제네릭을 못 쓰므로 `common/dto/response-dto.ts`의 헬퍼(`ResponseDtoOf`, `ResponseDtoListOf`, `ResponseDtoPagedOf`, `ResponseDtoString`·`Long`·`Boolean`·`Void`)가 `ResponseDto${Model}` 이름의 클래스를 만들어 캐시한다. 응답 필드는 옛 springdoc 명세처럼 전부 선택(required 없음)이다. 같은 스키마 이름과 필드가 나오는 것을 M1-1 시험에서 확인했다. [확인함] 클래스 이름이 곧 스키마 이름이다.
4. **응답 모양을 같게 한다.** `data` null 생략, `timestamp` epoch ms, 페이지 번호 0부터, 에러 `code` 문자열은 옛 `ErrorCode` 표를 그대로 옮긴다.
   - **HTTP 상태는 모두 200이다.** 옛 컨트롤러는 `ResponseEntity`도 `@ResponseStatus`도 쓰지 않아서, `ResponseDto.of(HttpStatus.CREATED, …)`를 돌려줘도 HTTP는 200이었고 본문 `status`만 201이었다. Nest는 POST를 201로 내므로 `@Ok(모델)` 데코레이터가 `@HttpCode(200)`과 문서의 200 응답을 **함께** 건다. 한쪽만 걸면 문서와 실제가 어긋난다. [확인함]
   - 본문 `status`는 컨트롤러가 `ok(message, data, status)`로 넘기는 값이다. HTTP 상태와 별개다.
5. **날짜 형식을 같게 한다.** 옛 코드는 `LocalDateTime`(12개 파일)이라 오프셋 없는 ISO일 가능성이 높지만 [미검증], 덤프와 실제 응답으로 확인한다.
6. **검증은 두 단계로 한다.**
   - 가벼운 검사(CI에서 매번): Nest가 만든 `openapi.json`의 operationId, 메서드, 경로, 파라미터, 스키마 이름, **모델의 필드 이름과 타입**을 옛 계약과 비교한다. 옛 계약은 `extract-api.mjs`처럼 생성 코드(`DefaultApi.ts`와 모델 65개)를 `apps/server/scripts/extract-contract.mjs`로 읽어 `apps/server/contract/front-contract.json`에 저장해 둔다(operation 48개). `test/contract/diff-contract.ts`가 이것과 비교하고, 지금은 가짜 컨트롤러가 흉내 내는 작업 4개만 대상이다. 생성기가 예약어 이름에 붙이는 `_`(`delete` → `_delete`)는 비교할 때 뗀다. 비교 함수가 틀린 것을 실제로 잡는지도 시험한다. 기대하는 차이는 1절에서 뺀 13개 operation(과 그것만 쓰는 모델)뿐이고, 목록에 `deferred`로 표시해 둔다. Java가 필요 없다.
   - 전체 검사(프론트 전환 직전 1회): 같은 generator 7.14.0으로 임시 폴더에 생성해서 `src/generated/api/`와 diff한다. **로컬에 Java도 Docker도 없으므로** Docker 설치 후 generator의 Docker 이미지로 돌리는 것을 추천한다.
7. **프론트에서 `yarn gen:api`를 돌리지 않는다.** 새 백엔드의 diff가 깨끗해진 뒤, 서버 URL을 바꾸는 별도 프론트 이슈와 PR에서 한다.
8. 스펙 주소는 `SwaggerModule.setup`의 `jsonDocumentUrl: 'v3/api-docs/all'`로 같게 한다. 보안 스킴 이름은 정확히 `bearerAuth`(http bearer JWT)이고 전역으로 건다. 생성된 클라이언트가 `token("bearerAuth")`로 토큰을 찾는다(48개 모두). 명세는 OpenAPI 3.0.0으로 나온다. [확인함]
9. **`servers`는 환경변수 `OPENAPI_SERVER_URL`(선택)로 내보낸다.** 프론트의 `BASE_PATH`가 `https://gamzatech.site`인 것은 옛 명세에 `servers` 항목이 있었기 때문이다(옛 `openapi.server-url`). 새 주소가 정해지면 이 값을 넣고 프론트에서 `gen:api`를 돌리면 `BASE_PATH`가 바뀐다. 비어 있으면 항목을 내보내지 않는다.
10. **`@nestjs/swagger` CLI 플러그인을 켜지 않고, 모든 `@ApiProperty`에 `type`을 명시한다.** vitest(oxc)와 `nest build`(tsc)가 만드는 타입 메타데이터가 다를 수 있다. 시험이 검사하는 문서와 실제로 나가는 문서가 같아야 한다.
11. **프론트가 쓰는 `Pageable`은 스키마로 내보내고, 쓰지 않는 원시 `ResponseDto`·`PagedResponse` 모델은 내보내지 않는다** [허용한 차이]. 프론트는 `Pageable`을 쿼리 파라미터 타입으로 직접 import한다(11곳). 원시 `ResponseDto`는 springdoc이 제네릭의 첫 인스턴스에 기본 이름을 붙인 흔적이라 `data`가 `ProjectListResponse`로 되어 있어 흉내 낼 이유가 없다. 쿼리 파라미터 `page`·`size`·`sort`는 `@ApiPageable()`이 옛 `@ParameterObject Pageable`처럼 펼친다.

## 6. 인증

[확정] JWT(HS256), 쿠키 `authorization`(httpOnly=false)과 `refreshToken`(httpOnly), `exp` 클레임 필수, `/api/auth/reissue`는 Set-Cookie 배열 응답, 저장소는 Redis, 쿠키 도메인은 `.gamza.xyz`(환경변수).

**② 로그아웃·세션** [이식]
- **블랙리스트 유지.** 로그아웃하면 그 액세스 토큰의 남은 유효 시간만큼 Redis에 등록하고, 요청마다 조회한다. 공개 GET은 옛 동작처럼 검사를 건너뛴다.
- **한 기기만 로그인(옛 동작 그대로).** 옛 코드는 사용자당 활성 리프레시 토큰이 하나다(`refresh:<token>` → userId, `userRefresh:<userId>` → token). 다른 기기에서 로그인하면 이전 토큰이 무효가 된다. 옛 코드가 이 교체를 Lua 스크립트로 한 번에 처리했으므로 같은 방식으로 옮긴다. 구형 키를 위한 대체 경로는 새 Redis에 구형 데이터가 없어 옮기지 않는다.
- **리프레시 토큰은 옛 형식(JWT, 30일).** 옛 `reissue`는 Redis에 있는지만 확인한다. 이 동작도 그대로 옮긴다.
- **갱신 방식도 그대로.** `reissue`는 액세스 토큰만 새로 주고 리프레시 만료를 30일로 연장한다(슬라이딩). 로테이션은 없다.
- 참고: 새 Redis는 비어 있고 JWT 시크릿도 바꿀 예정이라 전환 날 모든 사용자가 한 번 다시 로그인한다.

**③ GitHub 로그인**
- [제안] **Passport 없이 직접 구현**한다. 리다이렉트, 콜백, 코드 교환, 사용자 조회까지 Node 24 내장 `fetch`로 약 80줄이다. 동작은 옛 Spring OAuth2 흐름과 같게 하고 `state` 검증을 포함한다. 구현 방식의 선택일 뿐 기능을 더하지 않는다. JWT 발급은 `@nestjs/jwt`, 가드는 직접 만든 `AuthGuard`.
- [이식] 로그인 후 프론트로 돌려보내는 주소 규칙(`location` 값)은 옛 성공 핸들러를 읽고 그대로 맞춘다. [미검증]
- [미검증] 옛 앱의 요청 스코프는 설정에 Jasypt 암호문으로만 있고 복호화 비밀번호가 없어 읽을 수 없다. ④의 결정에 맞춰 정하고, 옛 값이 필요하면 이전 팀원에게 묻는다.

**④ GitHub 토큰·자동 커밋** [제안, 범위를 덜어내는 제안]
- 옛 동작: 로그인 후 GitHub 토큰을 평문으로 저장하고, 글을 사용자의 GitHub 레포에 커밋한다. 평문 저장 금지(확정) 때문에 그대로는 옮길 수 없다.
- 1차에서는 토큰을 저장하지 않고 자동 커밋을 보류한다. 이식하려면 토큰을 암호화해서 저장해야 하고 스코프도 필요해진다. 글 저장 경로에 GitHub 호출이 동기로 끼어 있는지는 옛 `PostService`를 읽고 확인한다 [미검증]. 있으면 저장 경로에서 분리한다.
- 이식을 원하면 이 항목을 바꾼다.

**인가** [이식]
- **권한(role)은 토큰이 아니라 DB에서 읽는다.** 확인한 사실: 액세스 토큰 클레임에는 role이 없고(`sub`, `githubId`, `jti`, `iat`, `exp`), 옛 `JwtProvider.getAuthentication`이 요청마다 `githubId`로 사용자를 조회해 `ROLE_<role>`을 만든다. 그대로 따른다. 그래서 인증 가드는 사용자 테이블에 의존한다(4절의 `UserRepository`).
- 옛 접근 규칙표(공개 13 / 로그인 27 / ADMIN 6 / 특수 2)를 `@Public()`과 `@Roles()` 데코레이터로 옮긴다. 전역 가드는 기본 거부(공개 표시가 없으면 로그인 필요)로 두어 옛 `anyRequest().authenticated()`와 같게 한다.
- **작성자 검사(수정·삭제)는 서비스에 둔다.** 확인한 사실: 옛 `PostValidator.validateOwnership`, `IntroValidator.validateOwner`, `CommentValidator.validateCommentOwnership`은 모두 작성자 id만 비교하고 관리자 예외가 없다. 프론트 #173의 "작성자 전용" 변경과 같은 방향이다.

## 7. 데이터 계층

- Prisma는 [확정](조건부). **스키마를 손으로 쓰지 않고 `prisma db pull`로 만든 뒤 이름을 정리**한다 [제안]. 옛 DB는 `ddl-auto: update`로 자라서 마이그레이션 이력이 없으므로, 공식 베이스라이닝 절차로 "현재 상태 = 첫 마이그레이션"을 만든 뒤 이후 변경을 마이그레이션으로 관리한다.
- **복잡한 쿼리는 `$queryRaw`를 repository 안에서만 허용**한다 [제안]. 옛 `PostQueryAdapter`(leftJoin 16개, groupBy 2개)와 고아 태그 정리(`NOT EXISTS`)가 대상이다. 억지로 ORM 문법에 맞추면 읽기 어렵다. 파라미터 바인딩(태그드 템플릿)만 쓴다.
- 글 저장과 태그 연결은 `$transaction`으로 묶는다.
- **[미검증, 덤프 후 확인]**: Prisma 버전(v7 고정 가능한가), DATETIME 시간대(9시간 어긋남 가능성), ENUM, MEDIUMTEXT, TINYINT(1) 매핑, `db pull` 결과 품질.

## 8. 횡단 관심사

- **챗봇** [이식]: 옛 코드는 메시지 2000자 초과를 거부하고, Gemini 응답을 Redis에 TTL을 두고 캐시한다. 키와 TTL은 옛 `GamzaChatService`에서 그대로 옮긴다.
- **챗봇 요청 횟수 제한은 이식하지 않는다.** 옛 설정에 20회/60초 값이 있지만 설정 파일과 프로퍼티 클래스에만 있고 읽는 코드를 찾지 못했다 [미검증]. 적용되지 않던 설정으로 보인다. 횟수 제한은 새 기능이라 이식이 끝난 뒤 따로 논의한다.
- **CORS·쿠키** [이식]: 허용 출처를 환경변수로 받고(`blog.gamza.xyz`와 로컬) `credentials: true`. 쿠키는 `cookie-parser`로 읽고 `Secure`, `SameSite=Lax`, 도메인은 환경변수.
- **프록시 신뢰 설정은 넣지 않는다** [제안]: 옛 앱도 포워딩 헤더 설정이 없었고 쿠키의 Secure를 고정으로 썼다. `res.cookie`로 직접 설정하면 요청이 HTTP로 들어와도 Secure 속성이 붙는다. 세션 라이브러리를 쓰게 되면 다시 본다.
- **이미지 업로드** [이식]: 옛 검증을 그대로 옮긴다. 확인한 값은 프로필 이미지 기준으로 확장자 jpg·jpeg·png·gif, 최대 3MB(멀티파트 설정도 3MB)다. 글 이미지의 검증은 옛 `PostImageServiceUtil` 등을 읽고 맞춘다 [미검증].
- **이미지 저장소** [제안]: `ImageStorage` 인터페이스 뒤에 두고, 구현은 S3 호환 클라이언트(`@aws-sdk/client-s3`, endpoint는 환경변수)로 한다. 옛 이미지 URL이 이미 S3를 가리키고, 저장소 종류는 인프라 단계에서 정해도 코드가 같다.
- **예약 작업** [이식]: 임시 이미지 정리(`TempImageCleanupScheduler`)는 `@nestjs/schedule`로 옮긴다. 주기와 규칙은 옛 코드를 읽고 맞춘다.

## 9. 테스트와 CI

- **접근 규칙 표 테스트**: 옛 분류 결과(`api-access.json`)를 입력으로, 각 경로가 공개/로그인/ADMIN/특수 규칙대로 동작하는지 표 기반으로 검사한다. 값싸고 실수를 가장 잘 잡는다.
- **단위 테스트**: 토큰 서비스(Redis는 가짜로 대체), 인증 가드, 에러 변환.
- **계약 검사**: 5절의 가벼운 diff를 CI에서 돌린다.
- **e2e**: supertest와 실제 MySQL·Redis. GitHub Actions의 서비스 컨테이너를 쓰면 로컬 Docker 없이도 CI에서 돌릴 수 있다.
- **CI는 lint → test → build까지만** 만든다. 배포는 인프라 단계에서 한다. 커버리지 수치 목표와 전체 스냅샷 테스트는 하지 않는다.

## 10. 개발 환경과 보안 규칙

- `.env.example`은 변수 **이름만** 두고, 실제 값은 레포에 두지 않는다. 옛 레포의 암호문 커밋 방식은 따르지 않는다.
- `.gitignore`에 `*.sql`, `*.dump`, `*.sql.gz`, 덤프 보관 폴더를 넣는다(덤프에 개인정보가 있다).
- 로컬 MySQL·Redis는 `docker-compose.dev.yml`로 띄우고 Nest는 호스트에서 `yarn start:dev`로 실행한다. 배포용 Compose는 인프라 단계에서 따로 만든다.
- **확인한 사실: 이 컴퓨터에는 Docker도 Java도 없다.** Docker Desktop 설치를 추천한다(문서가 가장 많다). 설치는 사용자 승인 후에 한다.

## 11. 구현 순서

**A. 지금 시작 가능 (덤프 불필요. 단 M2~M3의 사용자 저장은 M4 이후에 연결)**
- **M0** 레포 생성(승인 후), 스켈레톤, lint/test/build CI, 환경변수 검증
- **M1** 가장 큰 위험(계약)을 맨 앞에 둔다. **M1-1** 응답 래퍼, Swagger 설정, 가짜 컨트롤러로 계약 diff 시험(통과). **M1-2** `ErrorCode`와 전역 예외 필터
- **M2** 인증: JWT, `TokenStore`(Redis), 쿠키, reissue·logout, 가드, 접근 규칙 표 테스트. 가드가 role을 `UserRepository`로 읽으므로 **인메모리 구현으로 개발**한다.
- **M3** GitHub 로그인 (새 OAuth 앱 필요). 콜백이 사용자를 찾거나 PRE_REGISTER로 만드는 부분은 `UserRepository`까지만 만들고, 실제 저장은 M4 뒤에 연결한다.

**B. 덤프를 받은 뒤**
- **M4** Prisma: 덤프 복원, `db pull`, 베이스라인, v7 검증, 시간대·ENUM 점검, 그리고 `UserRepository`의 Prisma 구현을 넣어 M2~M3와 연결
- **M5** 읽기 API(공개 13개 중심): 목록, 피드, 상세, 인기, 검색, 태그
- **M6** 쓰기 API: 글 CRUD, 댓글, 좋아요, 소개, 프로필, 이미지 업로드, 관리자 승인
- **M7** 챗봇(Gemini)과 응답 캐시
- **M8** 계약 전체 diff 통과 → 프론트 전환(별도 프론트 이슈·PR)

**C. 인프라 단계 (이후 별도 논의)**: Dockerfile, 배포용 Compose, Nginx, HTTPS, 백업, CI/CD, 이미지 저장소 결정, 서버 확보

읽기를 쓰기보다 먼저 두는 이유: 읽기 API는 덤프의 실제 데이터와 프론트 화면으로 바로 검증할 수 있고, 데이터를 망칠 위험이 없다.

## 12. 하지 않는 것

옛 서비스에 없던 기능이나 동작 변경은 1차에서 넣지 않는다.

**제안했다가 뺀 것**: 여러 기기 동시 로그인, 리프레시 토큰 형식 변경(무작위 문자열), 로그인·챗봇 요청 횟수 제한, 보안 헤더(helmet), 이미지 파일 시그니처 검사, 헬스체크 엔드포인트, GitHub 스코프 축소

**처음부터 안 하기로 한 것**: CQRS, 도메인별 풀 헥사고날, GraphQL, 마이크로서비스, Passport, 일괄 로그아웃 기능, 로그·모니터링 스택, 옛 admission·project 이식(덤프 후 재결정)

## 13. 사용자가 해야 할 일

1. ~~레포 위치와 이름 승인~~ 완료: `tnemnorivnelee/gamza-tech-blog` (비공개, 로컬 `~/projects/gamza-tech-blog`)
2. **Node 24.22.2 설치**: `fnm install 24.22.2` (레포 루트의 `.nvmrc`가 이 버전을 가리킨다. 지금 Node 22.21.1로는 의존성 설치가 막힌다)
3. Docker Desktop 설치 (M2의 로컬 Redis와 M4의 로컬 MySQL에 필요하고, M8의 계약 전체 검사에도 쓴다)
4. 새 GitHub OAuth 앱 생성 (M3 전)
5. Gemini API 키 발급 (M7 전)
6. DB 덤프 수령 (11/05경)
7. SSH 개인키를 `~/.ssh`로 옮기고 `chmod 600` (기존 할 일)

## 14. 검증 대기 항목 모음

| 항목 | 언제 |
|---|---|
| 한글 태그가 생성기에서 `DefaultApi`로 모이는지(옛 명세가 한 클래스였던 이유의 가설) | M8 |
| 옛 레포 `master`와 운영 스펙(프론트 생성 코드)이 어긋나는 곳 | M5~M6 (컨트롤러를 옮기며 비교 대상이 늘 때) |
| enum 필드의 비교(6개 모델이 쓴다. 비교 함수는 아직 enum을 보지 않는다) | M5 |
| `@NotBlank`·`@Size` 같은 요청 검증이 `@Valid` 없이도 실제로 실행됐는지(`addComment`에는 `@Valid`가 없다) | M6 |
| 원시 `ResponseDto`·`PagedResponse` 없이 프론트가 재생성 후 컴파일되는지 | M8 |
| ADMIN 부여 지점 | M2 |
| 옛 GitHub 로그인 스코프(암호문)와 성공 후 리다이렉트 규칙 | M3 |
| Prisma 7의 MySQL `db pull` 품질, v7 고정 | M4 |
| 날짜 형식과 시간대(9시간) | M4~M5 |
| 글 저장 경로의 GitHub 커밋 호출 여부 | M6 |
| 글 이미지 업로드의 검증 기준 | M6 |
| 챗봇 응답 캐시 키·TTL, 횟수 설정이 실제로 적용됐는지 | M7 |
| S3 이미지 공개 읽기 여부 | 인프라 단계 |
