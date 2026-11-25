# M6 쓰기 API 계획

작성일 2026-11-24 · 상태: M6-1(9절) 구현됨 · 이슈 #58 · 관련: `backend-plan.md` 11·14절, `m5-read-api-plan.md` 3.10·10절, `improvement-candidates.md` 27·33·34번, `porting-principle.md`

확인 기준: 옛 백엔드 `potato-club/GamzaTechBlog-back`의 `master`를 읽기만 했다(코드를 실행하지 않았다). 복원한 로컬 DB에서는 외래키 규칙(구조 정보)과 좋아요 중복 개수만 조회했다(행 내용은 보지 않았다). 표시: **[확인함]**, **[추정]**, **[제안]**, **[보류]**

## 1. 한눈에 보기

M6은 프론트가 쓰는 **쓰기 API 16개**를 옛 서버와 같은 동작으로 옮기는 일이다. 쓰기는 데이터를 바꾸므로 읽기(M5)보다 조심해서 다룬다. 필요한 것에 따라 세 갈래로 나뉜다.

| 갈래 | 개수 | API | 필요한 것 |
|---|---|---|---|
| DB만 | 9 | `likePost` `unlikePost` `addComment` `deleteComment` `createIntro` `deleteIntro` `completeProfile` `updateProfile` `approveUserProfile` | MySQL 쓰기, 캐시 지우기 |
| 이미지 저장소 | 4 | `uploadImage` `updateProfileImage` `deleteProfileImage` `withdraw` | 파일 올리기·옮기기·지우기(옛 S3) |
| GitHub와 이미지 저장소 | 3 | `publishPost` `revisePost` `removePost` | 사용자의 GitHub 토큰, 저장소 쓰기, 이미지 옮기기·지우기 |

프론트로 치면 "DB만"은 서버 상태를 바꾸는 `mutate`이고, 나머지는 서버가 바깥 서비스(S3, GitHub)까지 부르는 `mutate`다.

## 2. 범위

**넣는 것**: 위 16개와 쓰기 때 읽기 캐시를 지우는 일(`@CacheEvict` 대응).

**넣지 않는 것**: 합격 조회·관리(`create`, `update`, `delete`, `lookup`)와 프로젝트(`createProject`, `updateProject`, `deleteProject`)는 옛 admission·project 이식으로 덤프 후 재결정이다(`backend-plan.md` 12절). 챗봇(`chat`)은 M7이다. `logout`, `reissue`는 M2에서 했다.

## 3. 옛 동작 [확인함: 코드]

### 3.1 좋아요 (`LikeServiceImpl`)

- `likePost`: 글이 없으면 404 `P001`, 이미 눌렀으면 409 `L001`, 아니면 저장. 성공하면 본문 `status` 201의 "좋아요 추가 성공"(`data` 없음).
- `unlikePost`: 글이 없으면 404 `P001`, 누른 적이 없으면 404 `L002`, 아니면 삭제. "좋아요 취소 성공".
- 같은 `(사용자, 글)` 행이 둘 이상이면 `findByUserAndPost`가 `Optional` 하나를 기대해서 `IncorrectResultSizeDataAccessException`(500)이다. 둘 다 같다. 유일 제약이 없어 동시에 두 번 누르면 생길 수 있다. 개발 DB에는 중복 행이 0쌍이다(2026-11-24, 83행 83쌍).
- 두 작업 모두 그 글의 `postDetail`과 `myLikes` 전체를 지운다.

### 3.2 글 쓰기와 GitHub (`PostServiceImpl`, `PostProcessingService`)

- 순서: ① GitHub 토큰을 꺼내 `GET https://api.github.com/user`로 살아 있는지 확인(없으면 `GITHUB_OAUTH_TOKEN_NOT_FOUND`, 무효면 `_INVALID`) → ② 글·태그 저장 → ③ 커밋 뒤 백그라운드(`@Async`)에서 사용자 저장소 `GamzaTechBlog`의 `PotatoStudy/<첫 태그>/<글번호>-<제목>.md`를 만들거나 고치거나 지운다. ③이 실패해도 응답은 성공이고 로그만 남는다. 저장소가 없으면 ③에서 만든다.
- `backend-plan.md` 14절의 "글 저장 경로의 GitHub 커밋 호출 여부"는 **호출한다**로 풀렸다.
- `revisePost`는 저장하는 도중에 이미지를 정리한다(임시 이미지를 글 폴더로 옮기고 안 쓰는 이미지를 지움). `publishPost`는 저장 뒤 백그라운드에서, `removePost`는 저장하는 도중에 한다. 그래서 글 쓰기 3개는 이미지 저장소도 필요하다.
- 글 쓰기 3개 모두 `hotPosts`, `postDetail`, `postsList`, `myPosts`, `searchPosts`, `postsByTag` 전체와 `allTags`를 지운다(`allTags`는 커밋 뒤에).

### 3.3 요청 검사가 돌지 않던 곳

`publishPost`, `revisePost`, `addComment`에는 `@Valid`가 없어서 `@NotBlank`·`@NotEmpty`·`@Size(max = 1000)`가 실제로는 돌지 않았다. 반대로 `createIntro`, `completeProfile`, `updateProfile`, `updateProfileImage`에는 `@Valid`가 있다. `backend-plan.md` 14절의 해당 항목이 **돌지 않았다**로 풀렸다. 옛 동작 그대로 옮기고 개선 후보로 적는다(해당 작업에서).

### 3.4 이미지

- 글 이미지 업로드(`uploadImage`)는 형식·크기 검사가 앱 코드에 없다. 전체 업로드 한도 3MB만 있다. 확장자로 `Content-Type`을 정하고 모르는 확장자는 `application/octet-stream`으로 올린다. 임시 폴더 `tmp_images/`에 올렸다가 글을 저장할 때 `post-images/<글번호>`로 옮긴다. 14절의 "글 이미지 업로드의 검증 기준"이 **없음**으로 풀렸다.
- 프로필 이미지는 확장자 `jpg`·`jpeg`·`png`·`gif`, 3MB 이하, 비어 있으면 `PROFILE_IMAGE_EMPTY`다.
- 글 본문에서 "지금 설정한 버킷 주소가 든 이미지"만 이미지로 인정한다. DB에 있던 이미지 주소 중 거기 없는 것은 "안 쓰는 이미지"로 보고 지우려 하고, 주소가 버킷 주소로 시작하지 않으면 `PROFILE_IMAGE_DELETE_FAILED`가 난다(글 수정 경로는 이 오류를 잡지 않는다). 결정은 5절 D5.

### 3.5 삭제와 연쇄

복원한 DB의 외래키 16개 중 15개는 딸린 행이 있으면 삭제를 막는 규칙(`NO ACTION`·`RESTRICT`)이고, 지워 주는 규칙(`CASCADE`)은 `commit_history.post_id` 하나뿐이다. 옛 서버는 JPA의 `cascade = ALL`과 `orphanRemoval`로 앱에서 연쇄 삭제를 했다. 새 서버(Prisma)는 삭제 순서를 직접 짜서 한 트랜잭션에 지워야 한다.

- 글 → 이미지, 댓글(답글 포함), 좋아요, 태그 연결, 커밋 기록
- 댓글 → 답글
- 사용자 → 글, 댓글, 좋아요, 저장소 정보, 프로젝트, 프로필 이미지

**옛 코드의 구멍 [추정]**: 사용자의 연쇄 삭제 목록에 자기소개가 없고 `introductions.user_id`는 `NO ACTION`이다. 자기소개를 쓴 사용자의 탈퇴는 외래키에 걸려 실패했을 가능성이 크다. 옛 서버가 없어서 확정하지 못한다.

### 3.6 사용자

- `completeProfile`: 학번이 겹치면 `EMAIL_ALREADY_EXISTS` 코드를 던지고(옛 `validateDuplicateStudentNumber`), 저장하면 role이 `PENDING`이 된다. 캐시는 지우지 않는다.
- `updateProfile`: 그 사용자의 `userProfile`만 지운다.
- `approveUserProfile`: `PENDING`이 아니면 거부, 맞으면 `USER`로 바꾼다. 캐시를 지우지 않는다.
- `withdraw`: 글, 글 이미지(저장소 삭제 실패는 무시), 프로필 이미지, 사용자를 지우고 안 쓰는 태그를 지운다. 캐시를 지우지 않는다.

### 3.7 캐시 지우기 표

| 쓰기 | 지우는 것 |
|---|---|
| 글 작성·수정·삭제 | `hotPosts` `postDetail` `postsList` `myPosts` `searchPosts` `postsByTag` 전체, `allTags` 전체 |
| 좋아요 추가·취소 | 그 글의 `postDetail`, `myLikes` 전체 |
| 댓글 작성·삭제 | 그 글의 `postDetail` |
| 소개 작성·삭제 | `introsList` 전체 |
| 프로필 수정, 프로필 이미지 변경·삭제 | 그 사용자의 `userProfile` |
| 프로필 완성, 관리자 승인, 회원 탈퇴 | 없음 |

`homeFeed`와 `publicProfileAggregate`는 옛 서버 전체에서 지우는 곳이 없어서 쓰기 뒤에도 최대 5분 낡은 값이 나간다.

## 4. 작업 분할

각각 이슈 → 브랜치 → PR이고, 모두 `lint`·`typecheck`·`test`·`build`를 통과해야 한다. 옮긴 API는 그 작업에서 바로 계약 시험(`TRIAL`)에 넣는다.

| 작업 | 내용 | API | 막힌 것 |
|---|---|---|---|
| M6-1 | 캐시 지우기 도구 + 좋아요 | `likePost` `unlikePost` | 없음. **구현함(9절)** |
| M6-2 | 댓글·자기소개 | `addComment` `deleteComment` `createIntro` `deleteIntro` | 없음. 단, 댓글 삭제 때 답글을 함께 지우는 방법을 먼저 확인(3.5). 계약 시험의 가짜 컨트롤러 2개를 진짜로 바꾼다 |
| M6-3 | 사용자 | `completeProfile` `updateProfile` `approveUserProfile` | 없음. `UserProfileMapper`(필드 규칙)를 구현 때 읽는다 |
| M6-4 | 이미지 | `uploadImage` `updateProfileImage` `deleteProfileImage` | 진짜 저장소가 없어 `ImageStorage` 인터페이스와 가짜 구현으로 시험한다 |
| M6-5 | 글 쓰기 | `publishPost` `revisePost` `removePost` | M6-4 뒤, D4(토큰 보관 결정), D5(주소 치환이 글 수정보다 먼저) |
| M6-6 | 회원 탈퇴 | `withdraw` | M6-4 뒤. 연쇄 삭제 순서를 직접 짠다(3.5) |
| M6-7 | 확인과 정리 | — | 서버를 띄워 쓰기를 호출하는 확인(시험용 행만 쓰고 지움), 계약 시험 점검, 문서 정리 |

순서 이유: DB만 쓰는 것부터 하면 안전하게 검증되고, 막힌 것(이미지 저장소, GitHub 토큰)을 정할 시간이 생긴다.

## 5. 결정한 것과 보류한 것

- **D1. 작업 순서 [확정 2026-11-24]**: 위 4절. 사용자가 승인했다.
- **D2. 캐시 지우기 [확정]**: 쓰기가 성공한 뒤에만 지운다(옛 `@CacheEvict`의 기본이 메서드가 예외 없이 끝난 뒤다). 이름 전체는 `KEYS` 대신 `SCAN`으로 지운다. 지우다 Redis가 실패하면 오류를 던진다. 이때 DB 쓰기는 이미 끝나 있다(34번).
- **D3. 현재 시각 공용화 [확정]**: DB의 서울 벽시계 "지금"을 만드는 `kstWallClockNow`를 `common/local-date-time.ts`로 뽑았다. 쓰는 곳이 셋(사용자 저장, 글 인기 기간, 좋아요 저장)이 되어서다.
- **D4. GitHub 토큰 보관 [보류, M6-5 전에 사용자에게 묻는다]**: 옛 서버는 평문으로 DB `github_tokens`에 두었고 이 표는 복원이 금지돼 있다. 안: **A** Redis에 만료를 붙여서(로그인 때 저장, 리프레시 토큰과 같은 30일, 재발급 때 연장. 코드가 가장 적다. 추천이지만 Redis 안에서는 여전히 평문이라 "오래 남지 않게" 줄일 뿐이다), **B** 암호화해서 DB에(옛 수명과 가장 비슷하다. 새 표와 키 관리가 늘어난다), **C** 저장하지 않고 글 쓸 때마다 다시 로그인(동작이 달라진다). 새 로그인은 GitHub 권한으로 `read:user user:email repo`를 요청해서 `repo`가 저장소 쓰기를 포함한다. 로그인 쪽 변경은 필요 없다.
- **D5. 이미지 저장소 [보류, 인프라 단계]**: 옛 버킷을 계속 쓸지 새로 만들지는 인프라 단계에서 정한다. 새 저장소를 쓰면 `m5-read-api-plan.md` 10절의 주소 치환 SQL을 먼저 돌려 DB의 모든 주소가 새 주소로 시작하게 해야 글 수정이 깨지지 않는다(3.4). 새 저장소를 켰는데 치환을 아직 안 한 사이가 위험하다. M6-5는 이 순서 조건을 계획에 적는다.
- **D6. 시험 안전 [확정]**: 쓰기 시험은 시험 전용 접두어를 단 행만 만들고 끝나면 지운다(개발 DB에는 실제 회원 데이터가 있다). GitHub는 가짜 클라이언트로만 시험하고, 진짜 토큰으로 진짜 저장소에 커밋하는 일은 하지 않는다.

## 6. 알려진 차이 (작업마다 채운다)

- (M6-1) 캐시 값은 보통 JSON이고 옛 서버의 Jackson 타입 정보가 든 값이 아니다. 새 서버를 옛 Redis에 연결하면 안 된다(`m5-read-api-plan.md` 7절과 같다).
- (M6-1) 좋아요를 눌러도 인기 글(`hotPosts`, 홈 피드 안의 인기 글)은 지우지 않는다. 인기 글은 좋아요 수로 순위를 매기는데 옛 `@CacheEvict`가 거기를 안 지워서, 순위가 만료(`hotPosts` 30분, `homeFeed` 5분)까지 낡다(개선 후보 25번과 같은 뿌리).
- (M6-1) 좋아요 행이 이미 둘 이상인 `(사용자, 글)`은 옛 서버처럼 누르기·취소가 500이다. 동시에 눌러야만 생기는 상태이고 개발 DB에는 없다.

## 7. 미검증

- 서버를 띄워 쓰기를 실제 HTTP로 부른 확인은 아직 없다(M6-7). M6-1은 서비스(가짜 저장소·가짜 Redis), 저장소(진짜 MySQL), 캐시 지우기(진짜 Redis), 컨트롤러(HTTP)를 따로 확인했다.
- 연쇄 삭제의 실제 순서(Hibernate가 무엇을 먼저 지우는지), 답글이 있는 댓글을 지웠을 때와 자기소개가 있는 사용자의 탈퇴 결과는 옛 서버를 못 돌려 봐서 확정하지 못한다.
- 읽지 않은 옛 코드: `UserProfileMapper`(M6-3), `PostMapper`와 커밋 기록 저장 코드(M6-5).
- 진짜 GitHub·S3 호출은 어떤 작업에서도 실행하지 않았다.

## 8. 개선 후보 (구현하지 않는다)

`improvement-candidates.md`: 33번(좋아요 중복 행, 쓰기 쪽 동작 추가), 34번(Redis 오류, 지우기 쪽 추가). 글 작성·수정·댓글 작성의 검사 누락(3.3), 학번 중복의 오류 코드, 자기소개가 있는 사용자의 탈퇴는 해당 작업에서 번호를 받아 적는다.

## 9. M6-1 구현 결과 [확인함]

**한 일**
- `ReadCache.evict(이름, 키)`와 `evictAll(이름)`을 더했다. `evictAll`은 `cache:<이름>:*`를 `SCAN`(힌트 100)으로 훑으며 지운다.
- `likePost`(`POST /api/v1/likes/{postId}`)와 `unlikePost`(`DELETE`)를 옮겼다. 저장소가 `ADDED`·`ALREADY_LIKED`·`POST_NOT_FOUND`와 `REMOVED`·`LIKE_NOT_FOUND`·`POST_NOT_FOUND`를 돌려주고, 서비스가 오류로 바꾼 뒤 성공했을 때만 그 글의 `postDetail`과 `myLikes` 전체를 지운다.
- `kstWallClockNow`를 `common/local-date-time.ts`로 뽑고 `prisma-user.repository.ts`, `post.service.ts`가 쓰게 바꿨다.
- 계약 시험 `TRIAL`에 `likePost`, `unlikePost`를 더했고 통과한다(비교하는 작업 22 → 24개).

**확인한 것**: `yarn lint`, `typecheck`, `build` 통과. `yarn test` 44개 파일 956개 통과(M5-6의 891개에서 65개 늘었다). 일부러 코드를 망가뜨려 보았다: 패턴의 `:` 제거, `myLikes` 안 지우기, 중복 행 던지기 제거, 본문 status 201 → 200 모두 시험이 잡았다. 시험 뒤 개발 DB(시험 사용자 0, `likes` 83, `posts` 58)와 Redis(전체 2, `cache:*` 0)에 남은 것이 없다.

**한계**: 패턴에서 `:`를 빼도 진짜 Redis 시험은 통과한다(이름이 서로의 접두어가 아니라서 걸리는 키가 같다). 패턴 문자열은 가짜 Redis 시험이 고정한다.

**남은 것**: M6-2(댓글·소개). 서버 실행 확인은 M6-7.
