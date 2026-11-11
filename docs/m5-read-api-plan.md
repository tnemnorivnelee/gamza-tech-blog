# M5 읽기 API 계획

작성일 2026-11-10 · 상태: M5-1(13절)·M5-2(14절) 구현됨, M5-3~M5-6 대기 · 이슈 #46, #48 · 관련: `backend-plan.md` 5·7·11절, `m4-prisma-plan.md`, `improvement-candidates.md` 22~27번, `porting-principle.md`

확인 기준: 옛 백엔드 `potato-club/GamzaTechBlog-back`의 `master`와 프론트 `potato-club/GamzaTechBlog-front`는 읽기만 했다(코드를 실행하지 않았다). 복원한 로컬 DB는 합계만 조회했다(개인정보 행은 보지 않았다). Spring 동작은 공식 문서와 Spring Data 소스로 확인했다. 표시: **[확인함]** 코드·문서에서 직접 확인, **[추정]** 자료로 짐작함, **[미검증]** 아직 확인할 방법이 없음. 운영 중이던 서버의 실제 응답은 못 봤으므로 "옛 동작"은 `master` 코드 기준이다.

## 1. 한눈에 보기

M5는 프론트가 쓰는 **읽기 API 17개**를 복원한 DB 위에서 옛 서버와 같은 응답으로 제공하는 일이다. 읽기는 데이터를 망칠 위험이 없고, 복원한 DB와 프론트 화면으로 바로 검증할 수 있어서 쓰기(M6)보다 먼저 한다.

옛 서버는 QueryDSL(자바의 쿼리 빌더)로 글 목록을 만들고, 거의 모든 읽기에 Spring 캐시(`@Cacheable`)를 걸었다. 프론트로 치면 "서버 쪽 SWR": 같은 요청을 5분 동안 DB 없이 돌려주는 장치다. 이 문서는 17개의 옛 동작, 새 구조, 작업 분할을 적는다.

## 2. 범위

**M5에 넣는 것: 17개** (계약 48개 중 GET 22개에서 프론트가 안 쓰는 5개를 뺀 것)

- 공개 9개(토큰 없이 호출): `getPosts`, `getPostsByTag`, `searchPosts`, `getHomeFeed`, `getPostDetail`, `getWeeklyPopularPosts`, `getAllTags`, `getIntroList`, `getPublicProfileByNickname`
- 로그인 7개: `getMyPosts`, `getMyComments`, `getMyLikes`, `isPostLiked`, `getActivitySummary`, `getCurrentUserProfile`, `getCurrentUserRole`(PRE_REGISTER·PENDING도 호출 가능)
- 관리자 1개: `getPendingUsers`

**넣지 않는 것**: 쓰기와 삭제 전부(M6), 챗봇(M7), 1차 범위 밖인 읽기 5개(`getAll` 합격 조회, `getAllProjects`, `getProfileImage`, `getCommitHistories`, `getComments`). 접근 규칙 표(`test/access/old-access-rules.ts`)의 근거와 같다. `getComments`(댓글 목록)는 글 상세 응답에 같은 댓글이 이미 들어 있어서 프론트가 따로 안 부르는 것으로 보인다 **[추정]**.

**정정**: `backend-plan.md` 11절의 "공개 13개 중심"은 공개 13개에 `chat`·`reissue`·`lookup`처럼 읽기가 아닌 것도 들어 있어서 부정확하다. M5의 공개 읽기는 9개다.

## 3. 옛 동작 [확인함]

### 3.1 공통

- **응답 래퍼**: `ResponseDto{status, message, data, timestamp}`. 이미 M1에서 만들었다. 메시지 문자열도 동작이므로 그대로 옮긴다(3.2~3.9에 적었다).
- **페이지 해석**(Spring 공식 설정과 Spring Data 소스로 확인): 요청 파라미터는 `page`, `size`, `sort`이고 페이지는 0부터 센다. 기본값은 `@PageableDefault`가 붙은 곳은 **크기 10**, 안 붙은 곳은 **크기 20**이다. `page`가 음수이거나 숫자가 아니면 0, `size`가 1 미만이거나 숫자가 아니면 기본 크기, 2000을 넘으면 2000으로 보정한다. 비어 있으면 기본값이다. 어떤 값도 오류가 되지 않는다.
- **정렬**: 글 목록 계열과 좋아요 목록은 요청의 `sort`를 **무시하고** 항상 `createdAt` 내림차순으로 고정되어 있다. 소개 목록(`findAll(pageable)`)은 요청의 `sort`를 반영한다(기본 `createdAt` 내림차순). 내 댓글 목록은 메서드 이름의 `createdAt` 내림차순에 요청의 `sort`가 덧붙는다 **[추정: Spring Data의 일반 동작]**. 소개·댓글에서 없는 속성으로 정렬하면 처리되지 않은 예외라서 500 `C004`가 된다 **[추정]**.
- **날짜**: `LocalDateTime` 필드는 Jackson 기본 직렬화로 `2025-07-27T21:08:37.109696`처럼 나간다(시간대 표시 없음, 소수점 이하는 0이 아닌 자리까지, 0이면 생략) **[추정: 설정 파일에 Jackson 설정이 없다]**. 예외로 `UserProfileResponse`의 `createdAt`·`updatedAt`은 문자열이고 형식이 `yyyy-MM-dd'T'HH:mm:ss`(초까지)다. 프론트의 생성 클라이언트는 날짜 필드를 `Date`로 받으므로 소수점 아래 자릿수는 화면에 영향이 없다 **[추정]**.
- **없는 대상**: 글이 없으면 404 `P001`(`POST_NOT_FOUND`), 사용자가 없으면 404 `U001`(`USER_NOT_FOUND`). 둘 다 우리 `ErrorCode`에 이미 있다.
- **경로의 `Long`**(`@PathVariable Long postId`) **[확인함: Spring 소스]**: Spring의 숫자 변환(`StringToNumberConverterFactory` → `NumberUtils.parseNumber`)을 거친다. 값 안의 공백을 **모두** 지우고(Java `Character.isWhitespace` 기준), `0x`·`0X`·`#`로 시작하면(앞에 `-`는 가능, `+`는 불가) 16진수로 `Long.decode`, 아니면 `Long.valueOf`(부호 `+`·`-` 가능)로 읽는다. 숫자가 아니거나 int64 범위를 넘으면 400 `C005`(`INVALID_TYPE_VALUE`)다(개선 후보 30번). 숫자 형식이면 없는 글은 404 `P001`이다.
- **검색어 오류**: 옛 예외 처리기는 `MethodArgumentNotValidException`(400)과 타입 불일치(400) 등만 따로 다루고 나머지는 500 `C004`로 보낸다. `keyword`가 비었거나(`@NotBlank` 위반) 없으면(필수 파라미터 누락) 둘 다 이 경로라서 **500 `C004`**가 된다 **[확인함: 코드, 운영 응답은 미관찰]**.
- **`tags` 파라미터**: `List<String>`이라 `tags=a&tags=b`와 `tags=a,b` 둘 다 목록이 된다(Spring의 쉼표 분리). 여러 태그는 **하나라도 가진 글**(OR)이다.
- **프론트의 호출 방식**: 검색은 생성 클라이언트가 `pageable[page]=0`처럼 중첩해서 보내서 Spring이 못 읽으므로, 프론트가 `keyword`, `page`, `size`, `sort`를 평평한 쿼리로 직접 만들어 호출한다(`postService.server.ts`). 우리도 평평한 쿼리를 받아야 한다. 명세(OpenAPI) 쪽은 `pageable` 객체 하나로 문서화되어 있어서 그대로 둔다.

### 3.2 글 목록 계열: `getPosts`, `getPostsByTag`, `searchPosts`, `getMyPosts`

넷 모두 같은 `fetchPosts`를 쓰고 조건만 다르다. 응답 `PostListResponse`: `postId, title, contentSnippet, writer(=닉네임), writerProfileImageUrl, createdAt, tags, thumbnailImageUrl`.

- `getPosts`: `tags`가 있으면 그중 하나라도 가진 글, 없으면 전체. 메시지 "게시물 목록 조회 성공".
- `getPostsByTag`: 경로의 태그 하나로 같은 조회. 태그가 있는지는 확인하지 않는다(없으면 빈 페이지). 메시지에 태그 이름이 들어간다(`'<태그>' 태그 게시물 조회 성공`).
- `searchPosts`: 제목에 `keyword`가 들어 있는 글(`containsIgnoreCase`: 대소문자 무시, `%`와 `_` 같은 문자는 글자 그대로 취급). 메시지 "게시물 검색 조회 성공".
- `getMyPosts`: 내가 쓴 글. 메시지 "내가 쓴 게시물 조회 성공".
- **정렬은 `createdAt` 내림차순 고정**, 페이지 정보는 `PagedResponse{content, page, size, totalElements, totalPages}`(이미 M1에서 만들었다).
- `contentSnippet`: 본문에서 마크다운 이미지(`![..](..)`)를 모두 지우고 앞뒤 공백을 자른 뒤, 100자를 넘으면 앞 100자에 `...`을 붙인다.
- `thumbnailImageUrl`: 그 글의 이미지 중 `post_image_id`가 가장 작은 것의 주소, 없으면 null.
- `tags`: 글에 연결된 태그 이름(정렬 지정 없음). 태그가 없는 글은 빈 목록.
- `writerProfileImageUrl`: 작성자의 프로필 이미지 주소, 없으면 null.
- 총 개수는 같은 조건의 `count(distinct 글)`이다.
- **범위를 넘긴 쪽**: 그 쪽에 글이 없으면 개수를 세지 않고 `totalElements`와 `totalPages`를 0으로 돌려준다(옛 `PageImpl(List.of(), pageable, 0)`). 글이 58개여도 `page=99`는 `content: []`, `totalElements: 0`, `totalPages: 0`이다. `page`와 `size`는 요청에서 고친 값이고 내용의 개수가 아니다 **[확인함: 코드]** (개선 후보 28번).
- **null**: `writerProfileImageUrl`과 `thumbnailImageUrl`은 없으면 키를 빼지 않고 `null`로 나간다. `NON_NULL`은 `ResponseDto`에만 붙어 있고 설정 파일에도 Jackson 설정이 없다 **[확인함: 코드]**.
- **같은 작성 시각의 순서**: 옛 쿼리는 정하지 않았다. 새 쿼리는 `postId` 내림차순으로 마무리해서 쪽을 넘겨도 순서가 흔들리지 않게 한다(옛 동작의 허용 범위 안).
- **`tags`가 `List<String>`이 되는 규칙** **[확인함: Spring 소스]**: 값이 하나면 문자열로 받아 쉼표로 쪼개고 조각마다 `trim`한다(`tags=a,b`, `tags[]=a,b`도 같다). 값이 여러 개면 배열로 받아 쪼개지 않는다(`tags=a,b&tags=c`는 `["a,b", "c"]`). 빈 문자열은 빈 목록이고 빈 목록은 필터 없음이다.
- **Java와 JS의 차이**: `page`·`size`는 `Integer.parseInt`라서 부호와 숫자만 받고 int32 범위 안이어야 한다(공백, 소수, `1e3`은 숫자가 아님). `trim()`은 U+0020 이하만 지워서 전각 공백(U+3000)은 남는다. 검색어의 `@NotBlank`와 스니펫이 이 기준이다. JS의 `Number()`와 `trim()`을 그대로 쓰면 결과가 달라진다.
- 공개 프로필의 글 목록과 홈 피드의 `latest`도 같은 조회다(3.5, 3.8).

### 3.3 글 상세: `getPostDetail`

- 글이 없으면 404 `P001`. 메시지 "게시물 상세 조회 성공".
- `PostDetailResponse`: `postId, title, content, writer(닉네임), writerProfileImageUrl, likesCount(=좋아요 행 수), githubId(작성자), createdAt, updatedAt, tags, comments`.
- `comments`: 그 글의 **최상위 댓글만** `createdAt` 내림차순으로 가져오고, 각 댓글 안에 `replies`가 재귀로 들어간다(`CommentResponse{commentId, writer, writerProfileImageUrl, content, createdAt, replies}`). 답글의 정렬은 지정이 없다 **[추정: 기본 키 순서]**(개선 후보 31번). 현재 데이터에는 답글이 0개다.
- **값이 없을 때** **[확인함: 코드]**: `PostDetailResponse`와 `CommentResponse`는 `NON_NULL`이 아니라서 작성자의 프로필 이미지가 없으면 `writerProfileImageUrl`이 키째 빠지지 않고 `null`이다. 댓글이 없으면 `comments: []`, 답글이 없으면 `replies: []`다.
- `likesCount`는 `post.getLikes().size()`(그 글의 좋아요 행 수), `tags`는 글에 연결된 태그 이름(정렬 지정 없음, 연결한 순서로 짐작), `createdAt`·`updatedAt`은 3.1의 날짜 모양이다. 본문(`content`)은 이미지 표기를 지우지 않고 그대로 준다(요약은 목록에서만).
- 답글은 깊이에 제한이 없는 재귀다(`mapToCommentTree`). 새 코드는 글의 댓글을 한 번에 평평하게 읽어 트리로 만든다(`comment-tree.ts`).

### 3.4 인기 글: `getWeeklyPopularPosts`

- 작성 시각이 `지금 - 1주`보다 늦은 글(`after`, 같은 시각은 뺀다) 중에서 **좋아요 수 내림차순, 같으면 작성 시각 내림차순으로 최대 3개**. 좋아요가 0개인 글도 후보다(왼쪽 조인). `PostPopularResponse{postId, title, writer, writerProfileImageUrl}`(프로필 이미지가 없으면 `null`). 메시지 "주간 인기 게시물 조회 성공".
- `지금`은 `LocalDateTime.now()`라서 서버의 벽시계 시각이다. DB에는 서울 벽시계 값이 들어 있으므로 새 코드는 같은 기준(`Date.now() + 9시간`)으로 `지금 - 7일`을 만든다(`m4-prisma-plan.md` D7). 좋아요 수도 작성 시각도 같으면 순서가 정해져 있지 않았다. 새 쿼리는 `postId` 내림차순으로 마무리한다.
- 현재 복원 데이터는 마지막 글이 2026-05-16이라 최근 7일 글이 0개다. 지금 호출하면 빈 목록이다. 시험에서는 시각을 고정해서 검증한다.

### 3.5 홈 피드: `getHomeFeed`

- `HomeFeedResponse{weeklyPopular, latest, allTags}`. `weeklyPopular`는 3.4, `latest`는 `getPosts`(같은 `page`, `size`, `tags`, 기본 크기 10), `allTags`는 3.6과 같다. 메시지 "홈 피드 조회 성공". 경로는 `GET /api/v1/posts/feed`다.
- **캐시와 자기 호출** **[확인함: 코드]**: 옛 `getHomeFeed`는 같은 클래스의 `getWeeklyPopularPosts()`와 `getPosts()`를 `this`로 부른다. Spring의 캐시는 프록시를 거쳐야 걸리므로 이 두 호출에는 캐시가 걸리지 않았고, 다른 빈인 `TagService.getAllTags()`와 `homeFeed` 결과 자체만 캐시됐다. M5-5에서 캐시를 붙일 때 이 점을 맞춘다.

### 3.6 태그: `getAllTags`

- 모든 태그 이름을 이름 오름차순으로. 연결된 글이 없는 태그(고아 태그)도 포함된다(옛 쓰기가 글을 지울 때 고아 태그를 지워서 보통은 없다). 현재 데이터에 고아 태그는 0개다. 메시지 "태그 목록 조회 성공".

### 3.7 소개: `getIntroList`

- `IntroResponse{introId, userId, nickname, profileImageUrl, content, createdAt}`, 요청의 `sort`를 반영하고 기본은 `createdAt` 내림차순, 기본 크기 10. 메시지 "자기소개 목록 조회 성공". 현재 데이터는 1건이다.

### 3.8 사용자: `getCurrentUserProfile`, `getCurrentUserRole`, `getActivitySummary`, `getPublicProfileByNickname`, `getPendingUsers`

- `getCurrentUserProfile`: `UserProfileResponse{githubId, nickname, name, email, profileImageUrl, position, role, studentNumber, gamjaBatch, createdAt, updatedAt}`. `position`·`role`은 enum 이름 문자열, 날짜는 3.1의 초 단위 문자열. 메시지 "프로필 조회 성공".
- `getCurrentUserRole`: role 이름 문자열. 메시지 "역할 조회 성공".
- `getActivitySummary`: `{likedPostCount, writtenPostCount, writtenCommentCount}`(좋아요 수, 쓴 글 수, 쓴 댓글 수). 메시지 "유저 활동 정보 조회 성공".
- `getPublicProfileByNickname`: 닉네임이 없으면 404 `U001`. `{profile{profileImageUrl, nickname, gamjaBatch}, activity(위와 같은 세 숫자), posts(그 사용자의 글 PagedResponse<PostListResponse>)}`. 이 엔드포인트만 `@PageableDefault`가 없어서 **기본 크기가 20**이다. 글 정렬은 3.2처럼 고정. 메시지 "공개 프로필 조회 성공".
- `getPendingUsers`: role이 `PENDING`인 사용자 전체. `PendingUserResponse{userId, gamjaBatch, name, position}`. 메시지 "대기 중인 사용자 조회 성공". 현재 데이터에 PENDING이 0명이다.

### 3.9 내 댓글·좋아요: `getMyComments`, `getMyLikes`, `isPostLiked`

- `getMyComments`: 내가 쓴 댓글 전부(최상위와 답글 구분 없이). `CommentListResponse{commentId, content, createdAt, postId, postTitle}`. 메시지 "내가 단 댓글 목록 조회 성공".
- `getMyLikes`: `LikeResponse{likeId, postId, title, contentSnippet(100자), writer, writerProfileImageUrl, thumbnailImageUrl, createdAt, tags}`. 정렬은 좋아요 시각 내림차순, 같으면 `likeId` 오름차순으로 고정. **태그가 없는 글의 `tags`는 `[null]`이 된다**(옛 코드가 태그 이름 목록을 만들 때 왼쪽 조인의 null을 걸러내지 않는다. 현재 데이터에서 태그 없는 글은 3개). 메시지 "좋아요 목록 조회 성공".
- `isPostLiked`: 글이 없으면 404 `P001`, 있으면 내가 좋아요 했는지 boolean. 메시지 "좋아요 여부 조회 성공".

### 3.10 캐시

옛 서버는 Redis를 캐시 저장소로 썼다(키 `cache:<이름>:<키>`, JSON). 기본 만료 5분이고 이름별로 다르다.

- 5분: `postsList`, `postDetail`(키 글 ID), `myPosts`, `postsByTag`, `searchPosts`, `homeFeed`, `myLikes`, `introsList`, `userProfile`(키 githubId), `publicProfileAggregate`(키 닉네임-페이지-크기)
- 30분: `hotPosts`(인기 글). 60분: `allTags`.
- 빈 결과는 저장하지 않는 곳이 많다(`unless`).
- 무효화: 글 쓰기(작성, 수정, 삭제)가 `hotPosts`, `postDetail`, `postsList`, `myPosts`, `searchPosts`, `postsByTag` 전체와 `allTags`를 지운다. 좋아요 추가·취소가 해당 글의 `postDetail`과 `myLikes` 전체를, 댓글 추가·삭제가 해당 글의 `postDetail`을, 소개 작성·삭제가 `introsList`를, 프로필 수정과 프로필 이미지 변경·삭제가 해당 사용자의 `userProfile`을 지운다. **`homeFeed`와 `publicProfileAggregate`는 무효화가 없어서**(옛 저장소 전체에서 이 이름은 각자의 `@Cacheable` 한 곳에만 나온다) 쓰기 뒤에도 최대 5분 동안 낡은 값이 나간다.
- 쓰기 API가 아직 없는 동안에는 무효화 지점이 없다. 무효화는 쓰기를 옮길 때(M6) 함께 연결한다.

## 4. 새 구조 [제안]

```
apps/server/src/
  common/            pageable.ts(page·size·sort 해석), local-date-time.ts(날짜 문자열)
  modules/
    post/            controller, service, repository(Prisma), dto/ (PostListResponse 등)
    tag/             controller, service, repository
    introduction/    controller, service, repository, dto/
    user/            controller(내 정보·공개 프로필), admin controller, 기존 UserRepository
    comment/         내 댓글 읽기 (dto는 이미 있다)
    like/            내 좋아요 읽기
```

- 층은 `controller -> service -> repository`이고 Prisma는 `*.repository.ts`에서만 import한다(AGENTS). 글 목록처럼 여러 테이블이 얽힌 조회는 옛 코드도 한 쿼리 어댑터 안에 있었으므로 `PostRepository` 안에서 `include`로 풀고, 다른 모듈의 repository를 부르지 않는다.
- **쿼리**: Prisma 문법으로 쓴다. 태그 필터는 `postTags: { some: { tag: { tagName: { in } } } }`라서 조인 중복이 없고 `GROUP BY`가 필요 없다. 인기 글은 `orderBy: { likes: { _count: 'desc' } }`로 된다. 썸네일은 목록의 글 ID들로 이미지를 `post_image_id` 오름차순으로 한 번 더 읽어서 글마다 첫 것을 고른다(옛 코드와 같은 방식). 검색은 Prisma의 `contains`를 쓰되, `%`·`_`가 글자 그대로 취급되는지 시험으로 확인하고(8절 1번) 안 되면 검색만 `$queryRaw`로 쓴다.
- **공용 부품 두 개** (호출처가 3곳 이상이라 뽑는다): `common/pageable.ts`는 3.1의 규칙대로 쿼리를 `{page, size, sort}`로 바꾼다(기본 크기를 인자로 받는다). `common/local-date-time.ts`는 `Date`를 3.1의 날짜 문자열로 바꾼다(DB의 벽시계 값을 `Date`의 UTC 필드로 읽는 약속은 `m4-prisma-plan.md` 11절). 글 요약(스니펫)은 `modules/post/`에 둔다(글 목록과 좋아요 목록, 둘 다 글 모듈의 규칙이다).
- `BigInt` 컬럼(id, 개수)은 응답에 실을 때 `Number(...)`로 바꾼다(`m4-prisma-plan.md` 10절).
- 접근 규칙은 `@Public()`·`@Roles()`로 표(`old-access-rules.ts`)에 맞추고, 컨트롤러를 옮길 때마다 `access-rules.spec.ts`와 계약 시험의 `TRIAL.operations`에 옮긴 작업을 더한다. 가짜 컨트롤러(`test/contract/fakes.ts`)는 옮긴 만큼 줄인다.

## 5. 결정한 것 [제안, 옛 동작을 따르는 범위에서 구현 방법을 정했다]

- **D1. 정렬·검색·오류는 3.1~3.9의 옛 동작을 그대로 옮긴다.** 요청의 `sort`를 무시하는 곳, `tags: [null]`, 검색어 오류의 500 `C004`는 개선 후보(22~24번)로만 기록한다.
- **D2. 쿼리는 Prisma 문법을 먼저 쓰고, 안 되는 곳만 `$queryRaw`.** 이유: 옛 코드의 복잡함은 JPA의 연관 로딩 때문이었고, Prisma의 `some`과 `_count`로 같은 결과가 더 읽기 쉽게 나온다. 같은 결과인지는 진짜 MySQL 시험으로 증명한다.
- **D3. 날짜는 옛 `LocalDateTime` 직렬화 규칙대로 문자열로 만든다.** DB는 마이크로초까지 있지만 `Date`는 밀리초라서 소수점 아래 넷째 자리부터는 잘린다. 프론트가 `Date`로 파싱하므로 화면에는 영향이 없다고 본다 **[추정]**.
- **D4. 읽기 캐시는 옛 동작이라 옮기되, 마지막 순서로 미룬다(M5-5).** 이유: 캐시는 결과가 같고 낡은 정도만 다른 장치라 목록·상세의 정확성을 먼저 증명하는 편이 안전하다. 키와 만료는 3.10의 값을 그대로 쓰고, 무효화는 M6에서 쓰기를 옮길 때 연결한다. 챗봇 응답 캐시(M7)와 같은 Redis 연결을 쓴다. 캐시 없이도 화면이 같으니, 옮기지 않기로 하면 개선 후보로 바꾼다.
- **D5. 시험 방식**: 컨트롤러 시험은 service를 가짜로 바꿔 응답 모양·메시지·파라미터 해석·오류 코드를 본다. 쿼리의 의미는 `*.repository.spec.ts`가 진짜 MySQL로 증명한다(`AGENTS.md`의 규칙: 진짜 DB는 이 시험들만 쓰고 시험 행은 지운다). 읽기 시험은 글·태그·댓글·좋아요 행이 필요하므로, 사용자는 `g_test_` 접두사, 태그는 `test-tag-<uuid>` 이름으로 만들고 **글의 작성 시각을 2099년으로 둬서** 복원 데이터와 섞인 전체 목록에서도 맨 앞에 오게 한다. 끝나면 자식 행부터 지운다.
- **D6. 복원 데이터 대조는 마지막에 읽기 전용으로 한다(M5-6).** 서버를 띄워 17개를 호출한 결과의 개수(글 58, 태그 45, 좋아요 83, 댓글 35 등)를 DB 합계와 맞춰 본다.

## 6. 작업 분할 [제안]

각각 이슈 → 브랜치 → PR이고, 모두 `lint`·`typecheck`·`test`·`build`를 통과해야 한다.

1. **M5-1 공통 부품과 글 목록 4개**: `pageable.ts`, `local-date-time.ts`, 스니펫, `PostListResponse` 등 DTO를 실제 모듈로, `PostRepository`의 `fetchPosts`. 작업: `getPosts`, `getPostsByTag`, `searchPosts`, `getMyPosts`. 시험: 페이지 해석 규칙, 날짜 문자열, 스니펫, 태그 OR 필터, 대소문자와 `%`·`_` 검색, 정렬 고정, 총 개수, 접근 규칙, 계약.
2. **M5-2 글 상세·인기·홈 피드·태그**: `getPostDetail`(댓글 트리 포함), `getWeeklyPopularPosts`(시각을 고정해 시험), `getHomeFeed`, `getAllTags`. **구현함(14절).**
3. **M5-3 사용자와 소개**: `getCurrentUserProfile`, `getCurrentUserRole`, `getActivitySummary`, `getPublicProfileByNickname`, `getPendingUsers`, `getIntroList`.
4. **M5-4 내 댓글·좋아요**: `getMyComments`, `getMyLikes`(`tags: [null]` 포함), `isPostLiked`.
5. **M5-5 읽기 캐시**: Redis `cache:<이름>:<키>`, 만료 5·30·60분, 빈 결과는 저장 안 함(3.10). 무효화 연결은 M6.
6. **M5-6 확인과 정리**: 계약 시험의 `TRIAL`을 계약 전체 비교로 넓히고, 복원 데이터 대조(읽기 전용), 이 문서와 `backend-plan.md` 정리.

선행 없이 시작할 수 있다. 사용자의 허락이 필요한 일은 없다(진짜 DB 시험은 M4-2에서 이미 허락받은 방식이다).

## 7. 알려진 차이

- 날짜의 소수점 아래 넷째 자리부터가 잘린다(D3).
- 읽기 캐시를 옮기기 전(M5-1~M5-4)에는 쓰기 뒤에도 항상 최신 값이 나간다. 옛 서버는 최대 5분 낡은 값이 나갈 수 있었다. 쓰기가 없는 동안에는 차이를 볼 수 없다.
- 인기 글이 현재 데이터에서는 항상 빈 목록이다(최근 7일 글이 없다).

## 8. 미검증

1. ~~Prisma `contains`가 `%`·`_`를 글자 그대로 취급하는지~~ M5-1에서 확인함(13절): 취급하지 않는다. 키워드 앞에 `\`를 붙여서 해결했다.
2. `postTags`와 `replies`의 정렬(옛은 지정이 없고 기본 키 순서로 짐작한다). 글 목록·상세의 태그는 `postTagId`, 답글은 `commentId` 오름차순으로 구현했다(M5-1·M5-2). 옛 서버의 실제 응답을 못 봐서 **[추정]**이 남는다(현재 데이터에는 답글이 0개, 태그 순서는 연결한 순서와 같을 것으로 본다).
3. 옛 응답의 날짜가 실제로 마이크로초까지 나갔는지. 운영 응답을 못 봐서 확인할 수 없고, 프론트가 `Date`로 파싱하므로 영향이 없다고 본다.
4. 옛 운영에서 캐시가 실제로 동작했는지(설정상 Redis는 연결되어 있다). 운영 응답이 낡았는지는 못 봤다.
5. `sort` 문법(`property,dir`)에서 틀린 값을 만났을 때 Spring이 하는 일의 세부(소개·내 댓글에만 영향). 흔한 값(`createdAt,desc`)만 맞추고, 그 밖은 500 `C004`로 둔다.
6. 한글 태그를 경로에 넣을 때(`/posts/tags/{tagName}`)의 인코딩. 시험에 한글 태그를 넣는다.

## 9. 개선 후보 (구현하지 않는다)

`improvement-candidates.md` 22~27번에 적는다. 요약: 검색어 오류가 500(22), 좋아요 목록의 `tags: [null]`(23), 요청의 `sort`를 무시하는 목록과 반영하는 목록이 섞여 있음(24), 읽기 캐시가 시간 만료에 의존하고 인기 글이 최근 7일로 제한됨(25), 글 상세(공개)에는 댓글이 있는데 댓글 목록 API는 로그인이 필요함(26), 이미지 주소를 절대 URL로 저장함(27).

## 10. 이미지 주소와 옛 버킷 (M5가 주소를 그대로 내보내는 이유)

M5의 응답에는 DB의 이미지 주소가 **그대로** 나간다. 이 주소들은 옛 S3 버킷을 가리키고, 버킷이 사라지면 이미지가 안 보인다. 파일은 잃지 않는다는 것을 확인했고, 옮기는 일은 인프라 단계에서 한다.

**확인한 사실** (2026-11-10)

- 옛 서버는 AWS S3 버킷 하나(서울)에 AWS SDK로 올렸고(`<폴더>/<UUID>_<안전한 이름>`, 폴더는 `post-images/`, `profile-images/`, `project_images/`, 임시 `tmp_images/`), DB에는 파일이 아닌 전체 주소만 저장했다(`https://<버킷>.s3.ap-northeast-2.amazonaws.com/<키>`). 임시 폴더는 8시간마다 8시간 지난 파일을 스케줄러가 지운다.
- DB와 글 본문이 가리키는 고유 S3 주소는 **151개**(글 이미지 129, 프로필 14, 프로젝트 8). 글 본문 56개에도 같은 주소가 직접 들어 있다. 프로필 1건은 GitHub 아바타 주소 그대로다.
- 샘플 3개를 요청하면 HTTP 200이라 공개 읽기다(`backend-plan.md` 14절의 "S3 이미지 공개 읽기 여부"가 샘플 수준으로 확인됨).
- 로컬 백업(`~/Documents`의 `s3-backup`)에 151개 중 150개가 있고, 150개 모두 실제 버킷과 **크기와 MD5가 같다**. 없는 1개(글 이미지, 글 1개)는 실제 버킷에서도 403이라 이미 사라진 것으로 보인다 **[추정]**. 백업의 33개는 어디서도 쓰이지 않는 파일이다.

**옮기는 순서** (새 저장소를 정한 뒤)

1. 새 저장소에 백업 파일을 올린다. **키(경로)를 바꾸지 않는다.** 읽기 공개로 설정한다.
2. 주소 앞부분만 바꾼다. 아래 SQL은 로컬 DB에서 트랜잭션으로 실행한 뒤 롤백하는 리허설을 통과했다: 바뀐 행 `post_images` 129, `profile_images` 14, `projects` 8, `posts.content` 56, 치환 뒤 옛 주소가 남은 행 0, 롤백 뒤 원래대로 복귀. `updated_at`은 건드리지 않는다.

```sql
SET @old = '<옛 주소 앞부분: https://<버킷>.s3.ap-northeast-2.amazonaws.com/>';
SET @new = '<새 주소 앞부분>';
START TRANSACTION;
UPDATE post_images    SET image_url         = REPLACE(image_url, @old, @new)         WHERE image_url         LIKE CONCAT(@old, '%');
UPDATE profile_images SET profile_image_url = REPLACE(profile_image_url, @old, @new) WHERE profile_image_url LIKE CONCAT(@old, '%');
UPDATE projects       SET thumbnail_url     = REPLACE(thumbnail_url, @old, @new)     WHERE thumbnail_url     LIKE CONCAT(@old, '%');
UPDATE posts          SET content           = REPLACE(content, @old, @new)           WHERE content           LIKE CONCAT('%', @old, '%');
-- 옛 주소가 남은 행이 0인지 확인한 뒤 COMMIT. 이상하면 ROLLBACK.
```

3. 글 본문은 `TEXT`(최대 65,535바이트)다. 가장 긴 글이 40,712바이트이고 글 하나의 이미지가 최대 18개라서, 새 주소 앞부분이 옛 것(57바이트)보다 **3,021바이트까지** 길어져도 넘치지 않는다.
4. 바꾼 뒤 DB의 모든 이미지 주소가 HTTP 200인지 확인한다. 그다음에 옛 버킷 삭제를 허용한다.

**지금 해 둘 일**: 백업의 두 번째 사본(사용자). 백업에는 회원 프로필 사진이 있으니 공개 위치에 두지 않는다.

## 11. 문서 정정

이 PR에서 `improvement-candidates.md`에 22~27번을 더하고, `backend-plan.md`는 11절의 M5 줄(읽기 17개)과 14절의 두 항목(S3 공개 읽기, 날짜 형식)만 사실에 맞춘다. `m4-prisma-plan.md`에는 M4-3 점검 결과(`shortcut:` 6개 중 M4에서 풀 것은 없음)를 적는다.

## 12. 사용자가 할 일

1. M4-3의 마지막 확인: 서버를 띄워 GitHub로 로그인해서 본인 계정이 새 사용자로 만들어지지 않고 role을 유지하는지 본다(`yarn dev:local`, `http://localhost:3000/oauth2/authorization/github`). 끝나면 알려 주면 회원 수 합계로 확인한다.
2. 백업의 두 번째 사본을 만든다(10절).
3. D4(읽기 캐시를 옮긴다)에 이의가 있으면 알려 준다. 없으면 이대로 간다.

## 13. M5-1 구현 결과 [확인함]

**만든 것**: `common/pageable.ts`(쪽 해석), `common/local-date-time.ts`(날짜 문자열), `common/spring-compat.ts`(Java `trim`, Java `parseInt`, 같은 이름 쿼리의 첫 값), `modules/post/`(`post.controller.ts`, `post.service.ts`, `post.repository.ts`, `post-query.ts`: `tags`·`keyword` 해석, `post-snippet.ts`, `dto/post-list-response.dto.ts`, `post.module.ts`), `AppModule` 등록, 작업 4개(`getPosts`, `getPostsByTag`, `searchPosts`, `getMyPosts`). 계약 시험은 `TRIAL.operations`에 4개를 더했고 가짜 컨트롤러 없이 실제 `PostController`로 비교한다. `ApiPageable`은 문서에 적는 기본 크기를 인자로 받는다(글 목록 네 개는 10).

**확인한 방법과 결과**

1. 게이트 4개: `lint`, `typecheck`, `test`(27개 파일 511개, 이전 349개), `build` 통과.
2. 진짜 MySQL 8.4.13으로 하는 저장소 시험 25개: 최신순과 같은 시각의 `postId` 마무리, 태그 OR 필터가 중복 없이 세어짐, 결과의 `tags`는 글의 모든 태그, 쪽 나누기, 범위를 넘긴 쪽의 `totalElements` 0, 아주 큰 `page`(2147483647)도 오류 없는 빈 쪽, 썸네일은 가장 작은 `post_image_id`, 이미지 없으면 `null`, 검색의 대소문자·한글·`%`·`_`·`\`·SQL 조각, 내 글.
3. 컨트롤러 시험(서비스·사용자 저장소·토큰 저장소는 가짜): 파라미터 해석, 메시지, 검색어 오류 500 `C004`, 토큰 없는 `getMyPosts`의 403 `J004`와 승인 대기 role의 403 `J005`, 공개 라우트는 잘못된 토큰도 무시.
4. 변이 시험 42개(쪽 해석, 날짜, `tags`·검색어 해석, 정렬·개수·필터·썸네일, 서비스의 총 쪽수, 컨트롤러의 기본 크기·공개 여부·메시지, 스니펫 경계)를 모두 시험이 잡았다. 원본은 해시로 복원을 확인했다. 첫 판정에서 출력을 `tail`로 잘라 "살아남음" 두 개가 잘못 나왔고, 종료 코드로 판정을 바꿔 다시 돌려 잡힌 것을 확인했다.
5. 시험이 개발 DB에 남긴 것이 없다: 시험 전후 합계가 같다(users 15, posts 58, tags 45, post_tags 76, post_images 129, comments 35, likes 83, 시험 접두사 행 0).

**알게 된 함정**

1. **Prisma `contains`는 값을 이스케이프하지 않는다.** `%`와 `_`가 와일드카드, `\`가 이스케이프 문자로 동작해서 옛 `containsIgnoreCase`와 결과가 달랐다(시험 3개가 실패해서 알았다). `$queryRaw` 대신 키워드의 `\`, `%`, `_` 앞에 `\`를 붙인다. Prisma가 이스케이프를 하게 바뀌면 시험이 알려 준다.
2. **시험 파일은 병렬로 돈다.** 처음 계획한 `g_test_` 접두사는 `prisma-user.repository.spec.ts`의 `afterEach`(그 접두사의 사용자를 전부 지움)와 겹쳐서, 글이 달린 사용자를 지우려다 외래 키 오류가 나거나 시험 도중 사용자가 사라진다. 글 시험은 `post_test_` 접두사를 쓴다. 이후 읽기 시험도 접두사를 서로 다르게 쓴다.
3. **옛 `fetchPosts`는 빈 쪽에서 `totalElements`를 0으로 돌려준다**(3.2절). 별도 `count`를 그대로 옮기면 실제 개수가 나가서 달라진다.
4. **`@Query('page')`처럼 이름으로 받으면 Swagger가 그 이름을 명세에 자동으로 더한다.** 검색은 계약상 `keyword`와 `pageable`뿐이라서 `@Query()`로 통째로 받아 직접 해석한다. 계약 시험이 어긋남을 잡는다.
5. 옛 `User`는 프로필 이미지를 하나만 가지고(`@OneToOne`) DB에도 둘 이상 가진 사용자가 0명이라 `take: 1`로 읽는다.

**알려진 차이**: 날짜의 소수점 아래 넷째 자리부터가 잘린다(D3). `tags`나 검색어에 문자열이 아닌 값이 오면(`tags[a]=b`) Spring처럼 없는 것으로 본다. 숫자는 ASCII만 받는다(Java는 다른 문자 체계의 숫자도 받는다. `spring-compat.ts`의 `shortcut:` 주석).

**남은 것**: M5-2(글 상세, 인기, 홈 피드, 태그). 진짜 MySQL 시험의 연결 확인(`canConnect`)이 두 파일에 중복되어 있다. 세 번째 파일이 생기면 공용으로 뽑는다.

## 14. M5-2 구현 결과 [확인함]

**만든 것**: `modules/post/`에 라우트 3개(`GET /api/v1/posts/popular`, `/feed`, `/:postId`: 이름이 정해진 경로를 `/:postId`보다 앞에 둔다), `PostService`의 `getPostDetail`·`getWeeklyPopularPosts`·`getHomeFeed`, `PostRepository`의 `findPostDetail`·`findWeeklyPopularPosts`, DTO 3개(`PostDetailResponse`, `PostPopularResponse`, `HomeFeedResponse`). `modules/comment/comment-tree.ts`는 평평한 댓글 목록을 트리로 바꾸는 순수 함수다. `modules/tag/`는 `GET /api/v1/tags`(`getAllTags`)이고 `TagModule`이 `TagService`를 내보내서 `PostModule`의 홈 피드가 쓴다. `common/spring-compat.ts`에 `parseSpringLong`(경로의 `Long` 변환, bigint), `common/swagger/api-decorators.ts`에 `pagedSchema`(홈 피드의 `latest`가 `@OkPagedOf`와 같은 이름 붙은 스키마가 되게 한다)를 더했다. 계약 시험은 `TRIAL.operations`에 4개를 더했고, "없는 작업" 시험은 아직 안 옮긴 `getIntroList`로 바꿨다. 진짜 DB 시험의 접속 코드는 파일이 셋이 되어 `test/support/test-database.ts`로 뽑았다.

**확인한 방법과 결과**

1. 게이트 4개: `lint`, `typecheck`, `test`(29개 파일 604개, 이전 27개 512개), `build` 통과.
2. 진짜 MySQL 8.4.13으로 하는 저장소 시험: 글 저장소 34개(M5-1의 25개 + 9개), 태그 저장소 3개. 상세는 좋아요 수(그 글의 것만), 태그의 연결한 순서, 댓글 전부(최상위와 답글)의 작성 시각 내림차순과 같은 시각의 `commentId` 마무리, 프로필 이미지 `null`, 없는 글 `null`. 인기 글은 기준 시각과 같은 글 제외(`gt`), 좋아요 많은 순 → 최신순 → `postId` 큰 순, 좋아요 0개도 후보, `limit`. 태그는 `a`, `B`, `c` 순서(DB 정렬 규칙: JS의 기본 정렬은 `B`, `a`, `c`라서 다르다), 글에 연결 안 된 태그 포함, 한글 가나다순.
3. 순수 함수와 서비스 시험: `parseSpringLong`(십진수·16진수·부호·공백 제거·Java 공백과 JS 공백의 차이·int64 경계·`2^53+1`), 댓글 트리(깊이 3, 답글 `commentId` 오름차순, 각자의 부모에게만 붙음), 서비스의 응답 변환·404·홈 피드 묶음·인기 글 기준 시각(시스템 시각을 고정하고 코드의 `+9시간` 상수를 쓰지 않은 `Intl`(`Asia/Seoul`)의 서울 시각과 비교).
4. 컨트롤러 시험(서비스·저장소는 가짜): 세 라우트와 `/tags`의 공개 여부·메시지, `popular`와 `feed`가 `/:postId`로 흘러가지 않음, 글 번호 해석(`0x10`, 공백, int64 최댓값), 숫자 아님·범위 초과의 400 `C005`(`errors`의 `postId`, 원래 값, `typeMismatch`), 서비스가 던진 404 `P001`의 전달, `null` 이미지 주소가 키째 나감, 홈 피드의 `page`·`size`·`tags`·기본 크기 10.
5. 생성된 명세를 직접 열어 확인했다: `HomeFeedResponse.latest`는 `$ref`가 아니라 `title: PagedResponsePostListResponse`인 `allOf`이고, `getPostDetail`의 `postId`는 `int64`, `getAllTags`의 응답은 `ResponseDtoListString`이다. 계약 시험이 4개 작업과 DTO를 프론트 계약과 비교해 통과한다.
6. 변이 시험 59개(경로 해석·댓글 트리·정렬과 필터·개수·기준 시각·메시지·공개 여부·모듈 등록·명세 모양)를 돌려 57개를 시험이 잡았다. 원본은 해시로 복원을 확인했다. 살아남은 2개는 동작이 같은 변이다: 최상위 댓글을 `repliesOf`의 `null` 키 아래에 묶는 변경(아무도 그 키를 읽지 않고 이 줄은 타입 좁히기용이다), `AppModule`에서 `TagModule`을 빼는 변경(`PostModule`이 `TagModule`을 가져오므로 `/api/v1/tags`는 그대로 열린다. 라우트를 가진 모듈이라 `AppModule`에 명시해 둔다). 이 판정을 하다가 컨트롤러가 앱에 실제로 등록됐는지 보는 시험이 없다는 것을 알았다(다른 시험은 컨트롤러를 직접 넣는다. M5-1부터 있던 구멍). `app.module.spec.ts`에 `PostController`·`TagController`가 조립된 앱에서 꺼내진다는 단언을 더했고, `AppModule`에서 `PostModule`을 빼는 변이가 이제 잡힌다.
7. 시험이 개발 DB에 남긴 것이 없다: 시험 전후 합계가 같다(users 15, posts 58, tags 45, post_tags 76, post_images 129, comments 35, likes 83). 시험 접두사(`post_test_`, `g_test_`, `test-tag-`, `tag-spec-`)의 행과 2099년 글은 0개다.

**알게 된 함정**

1. **DB 시험 파일을 병렬로 돌리면 MySQL 교착이 난다.** 전체 실행에서 `createUser`의 `prisma.repository.create()`가 `Transaction failed due to a write conflict or a deadlock`으로 가끔 죽었다(7번 중 2번, 다시 30번 중 1번). DB 시험 파일 둘(두 조합, 각 20번)이나 셋(30번)만 병렬로 돌릴 때는 모두 통과해서 전체 실행에서만 보인다. 접두사를 나눠도 막을 수 없다: `prisma-user.repository.spec.ts`의 `afterEach`는 `g_test_` 접두사 사용자를 지우는 범위 삭제인데, 사용자를 지울 때 MySQL이 자식 테이블의 외래 키 검사로 잠금(간격 잠금)을 잡고, 같은 시각에 다른 파일이 `repository`에 행을 넣으면 엇갈리는 것으로 **짐작한다**(교착 기록 `SHOW ENGINE INNODB STATUS`는 `PROCESS` 권한이 없어 못 봤다 **[추정]**). 해결은 재시도가 아니라 DB 시험 파일(`*.repository.spec.ts`)을 한 번에 하나씩 돌리는 것이다: `vitest.config.ts`에 `unit`(나머지, 병렬)과 `db`(`fileParallelism: false`) 두 프로젝트를 둔다. 파일 시작·끝 시각으로 DB 파일끼리 겹치지 않음을 확인했고, 전체 `yarn test`를 60번 돌려 0번 실패했다. 이전에는 같은 방식에서 7번 중 2번, 30번 중 1번 실패했다(실패 확률이 낮아서 증명은 아니고, 60번 무실패는 개선의 근거다).
2. **`@PathVariable Long`은 `Long.parseLong`이 아니다.** Spring 소스(`NumberUtils.parseNumber`)를 보니 모든 공백을 지우고 16진수(`0x10`, `#10`, `-0x10`)를 받는다. 그대로 옮겼고(`parseSpringLong`, 개선 후보 30번), 2^53을 넘는 번호가 있어서 `Number` 대신 `bigint`로 읽어 Prisma에도 `bigint`로 넘긴다.
3. **`@ApiPropertyOptional`에는 `SchemaObject`를 통째로 못 넘긴다**(타입이 맞지 않는다). 홈 피드 `latest`는 `pagedSchema`에서 `title`과 `allOf`만 꺼내 `type: Object`와 함께 넘긴다. 명세에는 `type` 없이 `title`과 `allOf`만 나가서 `@OkPagedOf`가 만드는 것과 같은 모양이다.
4. **태그 정렬은 JS가 아니라 DB의 정렬 규칙이다**(`utf8mb4_0900_ai_ci`, 대소문자 구분 없음). 시험이 `[...names].sort()`와 다름을 일부러 확인한다. 전체 태그 목록에는 복원한 실제 태그 45개가 섞여 있어서, 시험은 자기가 만든 태그만 걸러 순서를 본다. 접두사는 글 저장소 시험의 `test-tag-`와 겹치지 않는 `tag-spec-`다.

**알려진 차이**: 날짜의 소수점 아래 넷째 자리부터가 잘린다(D3). 답글과 태그의 순서는 옛 서버가 정하지 않아 기본 키 순서로 짐작했다(8절 2번). 숫자는 ASCII만 받는다(`spring-compat.ts`의 `shortcut:` 주석). 홈 피드의 세 조회는 옛 코드가 차례로 불렀지만 새 코드는 동시에 보낸다(결과는 같다). 인기 글은 현재 데이터(마지막 글 2026-05-16)에서 빈 목록이다.

**남은 것**: M5-3(사용자와 소개). 홈 피드의 안쪽 호출에 캐시가 걸리지 않았던 점(3.5)은 M5-5에서 맞춘다.
