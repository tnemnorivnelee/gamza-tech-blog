# M5 읽기 API 계획

작성일 2026-11-10 · 상태: M5-1(13절)·M5-2(14절)·M5-3(15절)·M5-4(16절)·M5-5(17절)·M5-6(18절) 구현됨, M5 끝 · 이슈 #46, #48, #50, #52, #54, #56 · 관련: `backend-plan.md` 5·7·11절, `m4-prisma-plan.md`, `improvement-candidates.md` 22~27번과 34번, `porting-principle.md`

확인 기준: 옛 백엔드 `potato-club/GamzaTechBlog-back`의 `master`와 프론트 `potato-club/GamzaTechBlog-front`는 읽기만 했다(코드를 실행하지 않았다). 복원한 로컬 DB는 합계만 조회했다(개인정보 행은 보지 않았다. 다만 M5-6의 서버 확인 스크립트는 사용자 행의 githubId·닉네임·role을 읽어 토큰을 만들고 DB 값과 대조했고, 그 값은 출력하지도 저장하지도 않았다). Spring 동작은 공식 문서와 Spring Data 소스로 확인했다. 표시: **[확인함]** 코드·문서에서 직접 확인, **[추정]** 자료로 짐작함, **[미검증]** 아직 확인할 방법이 없음. 운영 중이던 서버의 실제 응답은 못 봤으므로 "옛 동작"은 `master` 코드 기준이다.

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
- **정렬**: 글 목록 계열과 좋아요 목록은 요청의 `sort`를 **무시하고** 항상 `createdAt` 내림차순으로 고정되어 있다. 소개 목록(`findAll(pageable)`)은 요청의 `sort`를 반영한다(기본 `createdAt` 내림차순). 내 댓글 목록은 메서드 이름의 `createdAt` 내림차순이 먼저이고 요청의 `sort`(없으면 기본 `createdAt` 내림차순)가 그 뒤에 붙는다 **[확인함: Spring Data Commons 3.4.0 `AbstractQueryCreator.createQuery`의 `tree.getSort().and(dynamicSort)`, Spring Data JPA 3.4.0 `PartTreeJpaQuery`의 `getDynamicSort`]**. 그래서 요청의 `sort`는 같은 시각 안의 순서만 정하고 단 시각 순서를 뒤집지 못한다. 소개·댓글에서 없는 속성으로 정렬하면 처리되지 않은 예외라서 500 `C004`가 된다 **[추정]**.
- **`sort` 문법** **[확인함: 옛 서버의 Spring Boot 3.4.0이 쓰는 Spring Data Commons 3.4.0 소스 `SortHandlerMethodArgumentResolver`, M5-3에서 소개 목록에 구현]**: `sort=속성,방향`이고 여러 번 올 수 있다. 쉼표로 쪼갠 마지막 조각이 `asc`·`desc`(대소문자 무시)이면 방향이고, 아니면 오름차순이다. 나머지 조각은 모두 속성이다(`sort=a,b,desc`는 둘 다 내림차순). 조각은 다듬지 않고(`createdAt, desc`의 ` desc`는 방향이 아니라 속성이다) 비거나 공백뿐인 속성은 건너뛴다. 요청에 `sort`가 없거나(`sort=`도 같다) 해석한 결과가 비면 `PageableHandlerMethodArgumentResolver`가 `@PageableDefault`의 기본 정렬을 쓰고(`!sort.isSorted()`), 하나라도 읽히면 기본 정렬을 **바꾼다**(더하지 않는다). `sort[]=`(대괄호)는 읽지 않는다(`getParameterValues("sort")`뿐이고 Express 5도 다른 이름으로 둬서 같다). 속성 이름은 응답 필드가 아니라 **엔티티 필드 이름**이다(소개는 `id`, `createdAt`, `updatedAt`, `content`, `user`라서 `sort=introId`는 없는 속성이다). 소개 목록은 `id`·`createdAt`·`updatedAt`·`content`만 받고 나머지는 500 `C004`다(7절).
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
- **`tags`가 `List<String>`이 되는 규칙** **[확인함: Spring 소스]**: 값이 하나면 문자열로 받아 쉼표로 쪼개고 조각마다 `trim`한다(`tags=a,b`, `tags[]=a,b`도 같다. Spring 6.2의 `@RequestParam`은 `tags`가 없을 때 `tags[]`를 읽는다. Express 5의 기본 쿼리 해석기는 `tags[]`를 다른 이름으로 둬서 `readTags`가 직접 읽는다). 값이 여러 개면 배열로 받아 쪼개지 않는다(`tags=a,b&tags=c`는 `["a,b", "c"]`). 빈 문자열은 빈 목록이고 빈 목록은 필터 없음이다.
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
- **캐시와 자기 호출** **[확인함: 코드]**: 옛 `getHomeFeed`는 같은 클래스의 `getWeeklyPopularPosts()`와 `getPosts()`를 `this`로 부른다. Spring의 캐시는 프록시를 거쳐야 걸리므로 이 두 호출에는 캐시가 걸리지 않았고, 다른 빈인 `TagService.getAllTags()`와 `homeFeed` 결과 자체만 캐시됐다. M5-5에서 이 경계를 그대로 옮겼다(17절).

### 3.6 태그: `getAllTags`

- 모든 태그 이름을 이름 오름차순으로. 연결된 글이 없는 태그(고아 태그)도 포함된다(옛 쓰기가 글을 지울 때 고아 태그를 지워서 보통은 없다). 현재 데이터에 고아 태그는 0개다. 메시지 "태그 목록 조회 성공".

### 3.7 소개: `getIntroList`

- `IntroResponse{introId, userId, nickname, profileImageUrl, content, createdAt}`, 요청의 `sort`를 반영하고 기본은 `createdAt` 내림차순, 기본 크기 10. 메시지 "자기소개 목록 조회 성공". 현재 데이터는 1건이다.
- **값** **[확인함: 코드]**: `nickname`과 `profileImageUrl`은 작성자의 것이고 이미지가 없으면 `null`이다(`IntroResponse`는 `NON_NULL`이 아니다). `createdAt`은 3.1의 날짜 모양이다. `content`는 있는 그대로다(글 목록처럼 이미지 표기를 지우지 않는다).
- **쪽 나누기** **[확인함: Spring Data 소스]**: 글 목록과 달리 `findAll(pageable)`이라서 범위를 넘긴 쪽도 실제 전체 개수를 센다(`PageableExecutionUtils`는 빈 쪽이고 `offset`이 0보다 크면 개수 쿼리를 보낸다). 그래서 글이 1건이어도 `page=99`는 `content: []`, `totalElements: 1`, `totalPages: 1`이다(글 목록은 0, 3.2절).
- 같은 `createdAt`의 순서는 옛 쿼리가 정하지 않았다. 새 쿼리는 `introId` 내림차순으로 마무리한다(요청의 방향과 상관없이).

### 3.8 사용자: `getCurrentUserProfile`, `getCurrentUserRole`, `getActivitySummary`, `getPublicProfileByNickname`, `getPendingUsers`

- `getCurrentUserProfile`: `UserProfileResponse{githubId, nickname, name, email, profileImageUrl, position, role, studentNumber, gamjaBatch, createdAt, updatedAt}`. `position`·`role`은 enum 이름 문자열, 날짜는 3.1의 초 단위 문자열. 메시지 "프로필 조회 성공". 토큰의 사용자를 DB에서 **다시 읽고**(`validateAndGetUserByGithubId`) 그 사이 사라졌다면 404 `U001`이다. 값이 없는 칸(`email`, `profileImageUrl`, `position`, `studentNumber`, `gamjaBatch`)은 키째 빠지지 않고 `null`이다 **[확인함: 코드]**. 날짜는 MapStruct `dateFormat`이라 소수점 없이 초까지다(반올림 없이 버린다).
- `getCurrentUserRole`: role 이름 문자열. 메시지 "역할 조회 성공". DB를 읽지 않고 토큰으로 가드가 찾아 둔 사용자(principal)의 role을 그대로 준다 **[확인함: 코드]**.
- `getActivitySummary`: `{likedPostCount, writtenPostCount, writtenCommentCount}`(좋아요 수, 쓴 글 수, 쓴 댓글 수). 메시지 "유저 활동 정보 조회 성공". 셋 다 `countByUser`, 곧 **행 수**다: 좋아요 행(`likes`에는 `(user, post)` 유일 제약이 없어서 중복 행이 있으면 그만큼 세어진다), 쓴 글, 쓴 댓글(답글 포함). 값은 int32다 **[확인함: 코드]**.
- `getPublicProfileByNickname`: 닉네임이 없으면 404 `U001`. `{profile{profileImageUrl, nickname, gamjaBatch}, activity(위와 같은 세 숫자), posts(그 사용자의 글 PagedResponse<PostListResponse>)}`. 이 엔드포인트만 `@PageableDefault`가 없어서 **기본 크기가 20**이다. 글 정렬은 3.2처럼 고정이고 글 목록은 `getMyPosts`와 같은 조회다(요청의 `sort`는 무시하므로 틀린 `sort`도 오류가 아니다). 메시지 "공개 프로필 조회 성공". 닉네임은 `findByNickname`이라 컬럼의 정렬 규칙(`utf8mb4_0900_ai_ci`)을 따라 **대소문자와 악센트를 구분하지 않고**, 응답에는 요청 값이 아니라 **저장된 닉네임**이 나간다. 끝의 공백은 값으로 취급한다(`NO PAD`). `profile`의 이미지가 없으면 `null`이다 **[확인함: 코드, 규칙은 시험으로 확인]**.
- `getPendingUsers`: role이 `PENDING`인 사용자 전체. `PendingUserResponse{userId, gamjaBatch, name, position}`. 메시지 "대기 중인 사용자 조회 성공". 현재 데이터에 PENDING이 0명이다. 경로는 `/api/admin/users/pending`(v1이 없다), 관리자만이다. 옛 `findAllByRole`은 순서를 정하지 않았다(기본 키 순서로 짐작해 `userId` 오름차순 **[추정]**, 개선 후보 32번). `position`이 없으면 `null`이다.

### 3.9 내 댓글·좋아요: `getMyComments`, `getMyLikes`, `isPostLiked`

- `getMyComments`: `GET /api/v1/comment/me/comments`(기본 크기 10). 내가 쓴 댓글 전부(최상위와 답글 구분 없이). `CommentListResponse{commentId, content, createdAt, postId, postTitle}`. 메시지 "내가 단 댓글 목록 조회 성공".
- `getMyLikes`: `GET /api/v1/likes/me`(기본 크기 10). `LikeResponse{likeId, postId, title, contentSnippet(100자), writer, writerProfileImageUrl, thumbnailImageUrl, createdAt, tags}`. 정렬은 좋아요 시각 내림차순, 같으면 `likeId` 오름차순으로 고정이다(옛 `LikeQueryAdapter`가 두 쿼리 모두 `like.createdAt.desc(), like.id.asc()`를 적었다). 요청의 `sort`는 읽지 않는다. `createdAt`은 글이 아니라 좋아요를 누른 시각이다. 요약은 글 목록과 같은 규칙이다(`PostUtil.makeSnippet`이 안에서 이미지를 지운다). 같은 이름의 태그가 두 번 붙어도 이름은 한 번만 나온다(`distinct()`). **태그가 없는 글의 `tags`는 `[null]`이 된다**(옛 코드가 태그 이름 목록을 만들 때 왼쪽 조인의 null을 걸러내지 않는다. 현재 데이터에서 태그 없는 글은 3개). 메시지 "좋아요 목록 조회 성공".
- `isPostLiked`: `GET /api/v1/likes/{postId}/liked`. 글이 없으면 404 `P001`, 있으면 내가 좋아요 했는지 boolean. 메시지 "좋아요 여부 조회 성공".

### 3.10 캐시

옛 서버는 Redis를 캐시 저장소로 썼다(키 `cache:<이름>:<키>`, JSON). 기본 만료 5분이고 이름별로 다르다. 옛 `CacheConfig`와 각 서비스의 `@Cacheable`을 읽어 확인했다 **[확인함: 코드]**.

| 이름 | 옛 키 | 만료 | 저장하지 않는 경우(`unless`) |
| --- | --- | --- | --- |
| `postsList` | `쪽-크기-태그` (태그는 Java `List.toString()`인 `[a, b]`, 없으면 `all`) | 5분 | 빈 쪽 |
| `postDetail` | 글 번호 | 5분 | 결과가 `null`(글이 없으면 예외라 저장되지 않는다) |
| `myPosts` | `사용자 id-쪽-크기` | 5분 | 빈 쪽 |
| `hotPosts` | `weekly` | 30분 | 빈 목록 |
| `postsByTag` | `태그 이름-쪽-크기` | 5분 | 빈 쪽 |
| `searchPosts` | `검색어-쪽-크기` | 5분 | 빈 쪽 |
| `homeFeed` | `쪽-크기-태그`(`postsList`와 같다) | 5분 | 최신 글(`latest`)이 빈 쪽 |
| `allTags` | `all` | 60분 | 없음(빈 목록도 저장) |
| `introsList` | `p:쪽:s:크기:sort:정렬`(정렬은 Spring `Sort.toString()`, 예 `createdAt: DESC`, 여럿이면 쉼표만으로 잇는다) | 5분 | 없음(빈 쪽도 저장) |
| `myLikes` | `사용자 id-쪽-크기-정렬` | 5분 | 없음(빈 쪽도 저장) |
| `userProfile` | githubId | 5분 | 결과가 `null` |
| `publicProfileAggregate` | `닉네임-쪽-크기` | 5분 | 결과가 `null` |

- 목록마다 `unless`가 달라서 "빈 결과는 저장하지 않는다"를 한꺼번에 적용하면 안 된다. 글 계열 목록은 빈 쪽을 저장하지 않고 `allTags`·`introsList`·`myLikes`는 빈 결과도 저장한다.
- 옛 서버에는 `frequentPosts`(10분)도 설정돼 있지만 어디서도 쓰지 않아서 옮기지 않는다. 프로젝트 캐시는 M5의 범위 밖이다.
- 캐시 오류는 그대로 던진다. 옛 저장소에는 `CacheErrorHandler`가 없고, Spring의 기본 처리(`SimpleCacheErrorHandler`, 6.2.0 소스)가 읽기·쓰기 오류를 다시 던진다 **[확인함: 코드와 Spring 소스]**. 개선 후보 34번.
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

- 층은 `controller -> service -> repository`이고 Prisma는 `*.repository.ts`에서만 import한다(AGENTS). 글 목록처럼 여러 테이블이 얽힌 조회는 옛 코드도 한 쿼리 어댑터 안에 있었으므로 `PostRepository` 안에서 `include`로 풀고, 다른 모듈의 repository를 부르지 않는다. 사용자 읽기(M5-3)는 위 "기존 `UserRepository`"를 넓히지 않고 Prisma 전용 `UserQueryRepository`를 따로 뒀다: `UserRepository`는 가드와 로그인이 쓰는 바꿔 끼우는 인터페이스(운영은 Prisma, 시험은 인메모리)인데, 활동 개수는 글·좋아요·댓글 테이블에 걸쳐 있어서 인메모리 가짜가 흉내 내야 할 것이 많아지기 때문이다.
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
3. **M5-3 사용자와 소개**: `getCurrentUserProfile`, `getCurrentUserRole`, `getActivitySummary`, `getPublicProfileByNickname`, `getPendingUsers`, `getIntroList`. **구현함(15절).**
4. **M5-4 내 댓글·좋아요**: `getMyComments`, `getMyLikes`(`tags: [null]` 포함), `isPostLiked`. **구현함(16절).**
5. **M5-5 읽기 캐시**: Redis `cache:<이름>:<키>`, 만료 5·30·60분, 목록마다 다른 `unless`(3.10). 무효화 연결은 M6. **구현함(17절).**
6. **M5-6 확인과 정리**: 읽기 17개가 모두 계약 시험(`TRIAL`)에 들어 있는지 점검하고, 서버를 띄워 17개를 진짜 DB·Redis로 호출해 복원 데이터와 대조(읽기 전용), 이 문서와 `backend-plan.md` 정리. **구현함(18절).** (처음에는 "`TRIAL`을 계약 전체 비교로 넓히기"라고 적었다. 쓰기(M6)와 챗봇(M7)이 아직 없어 계약 48개 중 22개만 비교할 수 있으므로 전체 비교는 M8로 정정했다.)

선행 없이 시작할 수 있다. 사용자의 허락이 필요한 일은 없다(진짜 DB 시험은 M4-2에서 이미 허락받은 방식이다).

## 7. 알려진 차이

- 날짜의 소수점 아래 넷째 자리부터가 잘린다(D3).
- 읽기 캐시는 옮겼지만(M5-5) 무효화는 쓰기와 함께 M6에서 연결한다. 쓰기 API가 없는 동안에는 캐시가 낡을 일이 없어서 차이를 볼 수 없다. M6에서 연결하기 전까지는 쓰기 뒤에 만료(5·30·60분)까지 낡은 값이 나갈 수 있다.
- 캐시 값을 Jackson 기본 타입 정보(`@class`)가 든 JSON이 아니라 보통 JSON으로 저장한다. 옛 서버가 쓰던 Redis와 같은 키에 모양이 다른 값이 생기므로 이 서버를 옛 Redis에 연결하면 안 된다(옛 서버는 이미 없다).
- 캐시 키를 몇 군데 단순하게 했다. 응답은 같다: 사용자 id 대신 githubId를 쓴다(`myPosts`, `myLikes`). `myLikes`의 키에서 정렬을 뺐다(이 목록은 `sort`를 읽지 않아 응답이 같다). 태그가 없을 때와 빈 목록일 때를 `all` 하나로 합쳤다(둘 다 필터 없는 같은 조회다. 옛 컨트롤러의 `tags`는 `required = false`인 `List<String>`이라 없으면 `null`(키 `all`)이고, `?tags=`는 빈 목록(키 `[]`)이 된다고 본다 **[추정: Spring의 변환 규칙]**. 옛 키는 둘이 달라서 같은 결과를 두 번 저장했을 것이다).
- 인기 글이 현재 데이터에서는 항상 빈 목록이다(최근 7일 글이 없다).
- 소개 목록의 `sort`는 `id`·`createdAt`·`updatedAt`·`content`만 받고 나머지는 500 `C004`다. 옛 서버는 연관 속성(`user`, `user.nickname`)과 `속성,방향,ignorecase`도 정렬했을 것이다. 프론트는 `createdAt,desc`만 쓴다. `sort` 값을 한 번 더 URL 디코딩하는 Spring의 동작(`UriUtils.decode`, 3.4.0 소스에 있다)과 `ignorecase`, 점만 있는 조각 걸러내기도 옮기지 않았다(`parseSort`의 `shortcut:` 주석).
- 내 댓글 목록의 `sort`도 `id`·`createdAt`·`updatedAt`·`content`만 받고 나머지(`post`, `user` 같은 연관 이름 포함)는 500 `C004`다. 옛 서버는 연관 속성도 정렬했을 것이다. 요청의 `sort`는 `createdAt` 내림차순 뒤에 붙어서 같은 시각 안의 순서만 정한다(옛 동작 그대로, 개선 후보 24번).
- 같은 시각의 마무리 순서는 목록마다 다르다. 좋아요 목록은 `likeId` 오름차순(옛 쿼리가 적었다), 글·소개·내 댓글은 id 내림차순(옛 쿼리가 정하지 않아 우리가 붙였다).

## 8. 미검증

1. ~~Prisma `contains`가 `%`·`_`를 글자 그대로 취급하는지~~ M5-1에서 확인함(13절): 취급하지 않는다. 키워드 앞에 `\`를 붙여서 해결했다.
2. `postTags`와 `replies`의 정렬(옛은 지정이 없고 기본 키 순서로 짐작한다). 글 목록·상세의 태그는 `postTagId`, 답글은 `commentId` 오름차순으로 구현했다(M5-1·M5-2). 옛 서버의 실제 응답을 못 봐서 **[추정]**이 남는다(현재 데이터에는 답글이 0개, 태그 순서는 연결한 순서와 같을 것으로 본다).
3. 옛 응답의 날짜가 실제로 마이크로초까지 나갔는지. 운영 응답을 못 봐서 확인할 수 없고, 프론트가 `Date`로 파싱하므로 영향이 없다고 본다.
4. 옛 운영에서 캐시가 실제로 동작했는지(설정상 Redis는 연결되어 있다). 운영 응답이 낡았는지는 못 봤다.
5. ~~`sort` 문법(`property,dir`)에서 틀린 값을 만났을 때 Spring이 하는 일의 세부~~ 문법은 Spring Data 소스로 확인했다(3.1). 소개 목록에는 `id`·`createdAt`·`updatedAt`·`content`만 허용하고 그 밖은 500 `C004`로 둔다. 옛 서버의 실제 응답은 못 봐서 500인지는 **[추정]**이다. 내 댓글은 "메서드 이름의 정렬 뒤에 붙는다"가 달라서 M5-4에서 Spring Data 3.4.0 소스로 확인했다(16절).
6. ~~한글 태그를 경로에 넣을 때(`/posts/tags/{tagName}`)의 인코딩~~ M5-6에서 확인함(18절): 복원 데이터의 한글 태그 22개를 포함해 태그 45개를 모두 불러 DB와 맞았다.
7. M5-6 확인에서도 못 본 것(18절): 비어 있지 않은 인기 글과 승인 대기 목록(현재 데이터에 둘 다 0개), 답글이 있는 댓글 트리(답글 0개), 한글 닉네임의 공개 프로필 경로(닉네임이 모두 영문), 옛 서버의 실제 응답과의 비교.

## 9. 개선 후보 (구현하지 않는다)

`improvement-candidates.md` 22~27번과 34번(M5-5에서 추가: Redis가 죽으면 캐시가 걸린 읽기가 모두 500)에 적는다. 요약: 검색어 오류가 500(22), 좋아요 목록의 `tags: [null]`(23), 요청의 `sort`를 무시하는 목록과 반영하는 목록이 섞여 있음(24), 읽기 캐시가 시간 만료에 의존하고 인기 글이 최근 7일로 제한됨(25), 글 상세(공개)에는 댓글이 있는데 댓글 목록 API는 로그인이 필요함(26), 이미지 주소를 절대 URL로 저장함(27).

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

1. ~~M4-3의 마지막 확인~~ 2026-11-23에 했다. 본인이 `http://localhost:3000/oauth2/authorization/github`로 GitHub 로그인을 했고, 회원 수가 15 그대로라서 새 사용자가 만들어지지 않았다(합계만 조회했다). role 유지는 본인이 화면에서 확인했다.
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

**남은 것**: M5-3(사용자와 소개, 15절에서 구현함). 홈 피드의 안쪽 호출에 캐시가 걸리지 않았던 점(3.5)은 M5-5에서 맞춘다.

## 15. M5-3 구현 결과 [확인함]

**만든 것**: `modules/introduction/`(`GET /api/v1/intros`: `intro.controller.ts`, `intro.service.ts`, `intro.repository.ts`, `dto/intro-response.dto.ts`, `intro.module.ts`)와 `modules/user/`의 사용자 API(`GET /api/v1/users/me/get/profile`, `/me/activity`, `/me/role`, `/public/profile/:nickname`, 그리고 `GET /api/admin/users/pending`: `user.controller.ts`, `admin-user.controller.ts`, `user.service.ts`, `user-query.repository.ts`, `dto/` 5개. 기존 `user.module.ts`에 컨트롤러·서비스·조회 저장소를 더했다). `common/pageable.ts`에 `parseSort`(요청의 `sort` 해석)를, `common/local-date-time.ts`에 `toLocalDateTimeSeconds`(`UserProfileResponse`의 초 단위 날짜)를 더했다. `PostModule`은 공개 프로필의 글 목록을 위해 `PostService`를 내보낸다. M5-1의 `tags[]=` 구멍을 `post-query.ts`의 `readTags`로 고쳤다(함정 7). 계약 시험은 `TRIAL.operations`에 6개를 더했고 가짜 컨트롤러 없이 실제 컨트롤러로 비교한다. "없는 작업" 시험은 앞으로도 옮기지 않을 `getAllProjects`로 바꿨다. 앱 조립 시험(`app.module.spec.ts`)에는 새 컨트롤러 3개의 등록 단언을 더했다.

**구조에서 정한 것**: 사용자 읽기는 `UserQueryRepository`(Prisma 전용 클래스)가 맡고, 가드와 로그인이 쓰는 `UserRepository`(바꿔 끼우는 인터페이스)는 넓히지 않았다(4절). 사용자 API는 `UserModule` 하나에 컨트롤러·서비스·저장소를 모두 둔다. 옛 Spring의 `domain/user`도 `UserController`·`UserService`·`UserRepository`가 하나씩이고, 인증(`UserDetailServiceImpl`)이 같은 `UserRepository`를 쓴다(`GamzaTechBlog-back`의 `master`를 읽어 확인). 처음에는 `AuthModule`이 `UserModule`을 가져오는데 여기에 `PostModule`을 가져오는 컨트롤러까지 넣으면 `AuthModule`을 쓰는 시험 앱에 글 컨트롤러와 실제 서비스가 딸려 와서 시험이 틀어질 것이라 짐작해 `UserApiModule`로 따로 뒀다. 합친 상태로 돌려 보니 분리했을 때와 결과가 같아서(`typecheck` 통과, 단위 시험 598개 통과·14개 건너뜀, 건너뛴 것은 Redis가 없으면 생략되는 시험) 짐작이 틀린 것으로 확인하고 하나로 합쳤다. 인증을 건너뛰는 것은 모듈 위치가 아니라 `@Public()`이 정한다(전역 `AuthGuard`가 첫 줄에서 통과시킨다).

**확인한 방법과 결과**

1. 게이트 4개: `lint`, `typecheck`, `test`(35개 파일 710개, 이전 29개 604개), `build` 통과. 전체 `yarn test`를 10번 반복해 0번 실패했다.
2. 진짜 MySQL 8.4.13으로 하는 저장소 시험: 소개 19개(기본 정렬과 같은 시각의 `introId` 마무리, 요청 `sort`의 `id`·`createdAt`·`updatedAt`·`content`와 여러 항목, 허용 목록 밖 6개 이름의 500 `C004`, 쪽 나누기, 범위를 넘긴 쪽의 실제 `totalElements`, 값 변환, 이미지 없음 `null`)와 사용자 17개(프로필의 모든 칸과 `null`, 닉네임 조회의 대소문자·악센트 무시와 저장된 닉네임 반환, 끝 공백은 다른 값, 한글 닉네임, 활동 개수의 행 수 세기와 남의 활동 제외, PENDING만 `userId` 오름차순).
3. 순수 함수·서비스·컨트롤러 시험(서비스·저장소·토큰 저장소는 가짜): `parseSort` 문법 12개(방향 대소문자, 방향 없음, 끝 쉼표, 방향이 아닌 조각은 속성, 여러 번 온 `sort`, 기본 정렬을 바꿈), 서비스의 응답 변환·404·글 목록 호출 인자, 컨트롤러의 공개 여부와 role별 허용(`/me/role`은 PRE_REGISTER·PENDING도 가능, 나머지 `/me/*`는 USER·ADMIN만, 승인 대기 목록은 ADMIN만), 공개 프로필의 기본 크기 20과 `sort` 무시, 한글 닉네임 경로.
4. 생성된 명세를 직접 열어 확인했다: `getPublicProfileByNickname`은 경로 `nickname`과 쿼리 `page`·`size`·`sort`, `UserPublicProfileResponse.posts`는 `title: PagedResponsePostListResponse`인 `allOf`, `getIntroList`의 기본 크기 10. 계약 시험이 6개 작업과 DTO를 프론트 계약과 비교해 통과한다. 접근 규칙 시험은 실제 `AppModule`의 새 라우트가 옛 접근 규칙 표와 같음을 비교한다.
5. 변이 시험 79개(`sort` 해석, 날짜 형식, 정렬·쪽·개수·허용 목록, 응답 변환, 메시지·경로·공개 여부·role 허용, 모듈 등록, 명세 모양)를 돌려 77개를 시험이 잡았고, 원본은 해시로 복원을 확인했다. 살아남은 2개는 시험 데이터가 약해서였다: `id` 정렬이 `userId`로 바뀌어도, `createdAt` 정렬이 `updatedAt`으로 바뀌어도 통과했다(소개와 사용자를 같은 순서로 만들고 `updatedAt`을 `createdAt`과 같게 넣어서 두 컬럼의 순서가 같았다). 소개를 사용자와 반대 순서로 만들고 두 시각을 다르게 넣는 시험을 더해 둘 다 잡는 것을 확인했다. `parseSort` 시험 3개(끝 쉼표, `descending`, 공백뿐인 속성)는 첫 변이 목록을 쓰다가 살아남을 것으로 예상해 변이 시험 전에 더했다.
6. 시험이 개발 DB에 남긴 것이 없다: 변이 시험과 전체 반복 실행 뒤에도 합계가 같다(users 15, posts 58, tags 45, post_tags 76, post_images 129, comments 35, likes 83, introductions 1, profile_images 15, repository 5). 시험 접두사(`intro_test_`, `user_q_test_` 등)의 행과 2099년 행은 0개다.
7. 변경 파일 비밀 정보 검사: 해당 패턴 없음.

**알게 된 함정**

1. **`sort`의 속성 이름은 응답 필드가 아니라 엔티티 필드 이름이다.** 소개의 `introId`는 응답 이름이고 엔티티 필드는 `id`라서 `sort=introId`는 옛 서버에서도 없는 속성이었다. 요청에 `sort`가 있으면 기본 정렬을 더하지 않고 **바꾼다**(Spring Data 소스 `SortHandlerMethodArgumentResolver`로 확인). 처음 쓴 주석의 `속성:ignorecase` 문법은 틀렸고(실제는 끝 조각 `sort=content,asc,ignorecase`), 소스를 읽고 고쳤다.
2. **소개 목록의 쪽 나누기는 글 목록과 다르다.** `findAll(pageable)`은 범위를 넘긴 쪽도 실제 전체 개수를 센다. 글 목록의 "빈 쪽이면 0"(28번)을 소개에까지 쓰면 틀린다.
3. **날짜 형식이 둘이다.** 소개와 글은 Jackson의 `LocalDateTime`(소수점은 0이 아닌 자리까지), `UserProfileResponse`는 MapStruct `dateFormat`(초까지, 소수점 없음)이다. 둘 다 시험으로 고정했다.
4. **닉네임 조회는 DB의 정렬 규칙을 따른다.** `utf8mb4_0900_ai_ci`라서 대소문자와 악센트를 구분하지 않고(`/public/profile/CAFE`가 `Café`를 찾는다), `NO PAD`라서 끝의 공백은 다른 값이다. 응답에는 저장된 닉네임이 나간다. 옛 `findByNickname`도 같은 DB 규칙이었다.
5. **`ProfileCompletionInterceptor`는 등록되지 않았다**(`m2-auth-plan.md`). 그래서 가입을 끝내지 않은 사용자가 `/me/*`에서 막히지 않는 것이 아니라, 옛 접근 규칙(기본 USER·ADMIN)만 적용된다.
6. **시험 데이터가 컬럼을 구분하지 못하면 변이가 살아남는다.** 같은 순서로 만든 데이터는 `id`/`userId`, `createdAt`/`updatedAt`을 바꿔도 통과한다. 정렬 시험의 데이터는 서로 다른 컬럼의 순서가 달라지게 만든다.
7. **Express 5의 기본 쿼리 해석기는 `qs`가 아니라 `querystring`이다.** `?tags[]=a`는 `tags`가 아니라 `tags[]`라는 키로 온다. 처음에는 "Express가 `sort[]`를 배열로 합쳐 읽어서 Spring과 다르다"고 문서에 적었는데 틀렸다(`sort`는 Spring도 `sort[]`를 안 읽는다). HTTP로 확인하니 오히려 M5-1의 `tags[]=a,b`가 Spring과 달랐다(Spring 6.2의 `@RequestParam`은 `tags[]`를 읽고 우리는 필터를 무시했다). `readTags`로 고치고 컨트롤러 시험에 넣었다(프론트는 `tags=a&tags=b`로 보내서 화면 영향은 없었다). 옛 서버 버전은 `build.gradle`의 Spring Boot 3.4.0으로 확인하고(Spring Framework 6.2.0, Spring Data Commons 3.4.0), 두 태그의 소스를 읽었다.

**알려진 차이**: 소개 목록의 `sort`는 `id`·`createdAt`·`updatedAt`·`content`만 받고 나머지는 500 `C004`다(옛 서버는 `user.nickname` 같은 연관 정렬과 `ignorecase`도 받았을 것이다). `sort` 값의 이중 URL 디코딩은 옮기지 않았다. 승인 대기 목록의 정렬(32번)과 좋아요 수의 행 수 세기(33번)는 옛 동작대로 옮겼다. 날짜의 소수점 아래 넷째 자리부터가 잘린다(D3). 현재 데이터에 소개는 1건, PENDING은 0명이다.

**남은 것**: M5-4(16절에서 구현함). 옛 `userProfile`·`introsList`·`publicProfileAggregate` 캐시와 `userProfile`의 무효화는 M5-5와 M6에서 맞춘다. 전체 계약 비교와 복원 데이터 대조는 M5-6이다.

## 16. M5-4 구현 결과 [확인함]

**만든 것**: `modules/comment/`(`GET /api/v1/comment/me/comments`: `comment.controller.ts`, `comment.service.ts`, `comment.repository.ts`, `comment.module.ts`)와 `modules/like/`(`GET /api/v1/likes/me`, `GET /api/v1/likes/{postId}/liked`: `like.controller.ts`, `like.service.ts`, `like.repository.ts`, `like.module.ts`, `dto/like-response.dto.ts`). 옛 `domain/comment`와 `domain/like`가 각각 컨트롤러·서비스·저장소를 따로 가져서 같은 구조로 두 모듈을 만들고 `AppModule`에 등록했다. 계약 시험은 `TRIAL.operations`에 `getMyLikes`와 `isPostLiked`를 더했고, `getMyComments`는 가짜 컨트롤러를 지우고 실제 컨트롤러로 바꿨다. 앱 조립 시험(`app.module.spec.ts`)에는 새 컨트롤러 2개의 등록 단언을 더했다.

**구조에서 정한 것**: `LikeRepository`는 `post` 테이블에서 글과 내 좋아요를 한 번에 읽는다(옛 코드는 글을 찾고 좋아요 행을 따로 확인했다). 글 모듈을 가져오지 않는다(다른 모듈의 저장소를 부르지 않는 원칙, 4절). 요약 문장은 글 모듈의 `makeContentSnippet` 함수를 가져다 쓴다(옛 `PostUtil.makeSnippet`이 안에서 이미지를 지우므로 글 목록과 같은 규칙이다).

**확인한 방법과 결과**

1. 게이트 4개: `lint`, `typecheck`, `test`(41개 파일 814개 통과, 건너뜀 0개. 이전 35개 710개), `build` 통과. 전체 `yarn test`를 10번 반복해 0번 실패했다(매번 814개 통과). 이번 변경 파일의 서식 검사도 통과했다(전체 검사의 경고 21개는 git이 무시하는 Prisma 생성 코드다).
2. 진짜 MySQL 8.4.13으로 하는 저장소 시험: 좋아요(정렬 두 가지, 내 것만, 쪽 나누기와 범위 밖 쪽의 실제 개수, 중복 좋아요 행, 태그의 순서·중복·`[null]`, 썸네일, 글쓴이 값, 글 없음·안 누름·누름·남의 좋아요·다른 글·중복 행의 `isPostLikedBy`)와 댓글(내 것만과 답글 포함, 기본 정렬과 같은 시각 마무리, 요청 `sort`가 같은 시각 안에서만 작동함, 허용 목록 밖 10개 이름의 500 `C004`, 쪽 나누기와 범위 밖 쪽).
3. 서비스·컨트롤러 시험(서비스·저장소·토큰 저장소는 가짜): 응답 변환(날짜 문자열, 요약, `[null]` 그대로), 총 쪽수, 404 `P001`, 경로의 글 번호(16진수·공백, 잘못된 값의 400 `C005`), `false`가 `data`에 남는 것, 접근 규칙(토큰 없음 403 `J004`, PENDING·PRE_REGISTER 403 `J005`), 좋아요 목록은 `sort`를 읽지 않고 댓글 목록은 읽어 넘기는 것.
4. 계약 시험이 세 작업의 경로·쿼리·응답 모델을 프론트 계약과 비교해 통과하고, 접근 규칙 시험이 실제 `AppModule`의 새 라우트를 옛 접근 규칙 표와 비교해 통과한다.
5. 변이 시험 62개(정렬 기준·방향·마무리, 허용 목록과 이름 짝, 사용자 필터, 쪽·개수, 태그·썸네일·프로필 값, 응답 변환, 메시지·경로·기본 크기, 명세 모양, 모듈 등록)를 돌려 61개를 시험이 잡았고, 원본은 해시로 복원을 확인했다. 살아남은 1개는 좋아요 목록에서 같은 시각의 `likeId` 오름차순 마무리를 지운 변이다. 이 시험 데이터로는 구분되지 않았다 **[추정: MySQL이 같은 값을 기본 키 순서로 돌려준 것으로 보인다. `ORDER BY ... LIMIT`의 정렬은 같은 값끼리의 순서가 보장되지 않아서 데이터가 많으면 달라질 수 있다]**. 옛 쿼리가 적은 정렬이라 그대로 두고, 이 변이는 알려진 한계로 남긴다.
6. 시험이 개발 DB에 남긴 것이 없다: 전체 시험 전후의 합계가 같다(users 15, posts 58, tags 45, post_tags 76, post_images 129, comments 35, likes 83, introductions 1, profile_images 15, repository 5).
7. M4-3의 로그인 확인(12절 1번)을 끝냈다.

**알게 된 함정**

1. **좋아요 목록의 같은 시각 마무리는 `likeId` 오름차순이다.** 글 목록·소개·내 댓글에 붙인 마무리(id 내림차순)와 반대다. 옛 `LikeQueryAdapter`가 두 쿼리 모두 `like.createdAt.desc(), like.id.asc()`를 직접 적었다.
2. **내 댓글의 요청 `sort`는 기본 정렬을 바꾸지 못한다.** 메서드 이름의 `createdAt` 내림차순이 먼저이고 요청의 `sort`가 뒤에 붙는다(Spring Data Commons 3.4.0 `tree.getSort().and(dynamicSort)`, JPA 3.4.0의 `getDynamicSort`로 확인). `sort=content,asc`를 보내도 단 시각 순서는 그대로이고 같은 시각 안에서만 `content`가 순서를 정한다. 소개 목록(요청의 `sort`가 기본 정렬을 바꾼다)과 다르다. 개선 후보 24번에 적었다.
3. **두 목록 모두 범위를 넘긴 쪽도 실제 전체 개수를 센다.** 글 목록의 "빈 쪽이면 0"과 다르다. 내 댓글은 Spring Data의 `PageableExecutionUtils.getPage`(3.4.0 소스)가 빈 쪽이면 개수 쿼리를 실행하고, 좋아요는 어댑터가 항상 `count`를 센다.
4. **좋아요 목록은 `sort`를 읽지 않는다.** 명세에는 `sort`가 있지만 어댑터가 `pageable`의 정렬을 쓰지 않는다(캐시 키에만 들어간다). 이상한 값도 오류가 아니다.
5. **태그는 이름 기준으로 중복이 없고, 하나도 없으면 `[null]`이다.** 글 목록은 같은 태그가 두 번 붙으면 두 번 나오지만 좋아요 목록은 `distinct()`라 한 번만 나온다. 태그 순서는 옛 쿼리가 정하지 않아 `postTagId` 순서로 두었다 **[추정]**.
6. **같은 사용자의 좋아요 행이 여럿이면(유일 제약 없음) 목록에 모두 나오고 총 개수도 행 수다.** `isPostLiked`는 하나라도 있으면 `true`다(33번).
7. **`isPostLiked`의 `false`는 `data`에서 빠지지 않는다.** `ResponseDto`는 `null`일 때만 `data`를 뺀다.
8. **`GET me/comments`는 M6의 `GET :postId/comments`보다 먼저 선언해야 한다.** Express는 선언한 순서대로 맞춰 보지만 Spring은 글자 그대로인 경로를 먼저 고른다. 컨트롤러 주석에 적었다.
9. **같은 시각의 순서는 DB가 자연스럽게 맞춰 줘서 시험이 약해지기 쉽다.** 정렬 시험의 데이터는 좋아요 시각, 글 작성 시각, 좋아요 번호가 서로 다른 순서가 되게 만들었고, 같은 시각 시험은 만든 순서와 글 번호의 순서가 어긋나게 만들었다.

**알려진 차이**: 내 댓글 목록의 `sort`는 `id`·`createdAt`·`updatedAt`·`content`만 받고 나머지는 500 `C004`다(옛 서버는 연관 속성도 받았을 것이다). 날짜의 소수점 아래 넷째 자리부터가 잘린다(D3). 현재 데이터에서 태그 없는 글은 3개라서, 그 글을 좋아요 한 사용자의 목록은 `tags`가 `[null]`로 나간다.

**남은 것**: M5-5(읽기 캐시). 옛 `myLikes`의 키는 `사용자 id-쪽 번호-쪽 크기-정렬 문자열`이고 좋아요 추가·취소가 `myLikes` 전체를 지운다(무효화는 M6). 내 댓글 목록에는 옛 서버에 캐시가 없었다 **[확인함: 코드]**. 전체 계약 비교와 복원 데이터 대조는 M5-6이다.

## 17. M5-5 구현 결과 [확인함]

**만든 것**: `common/read-cache.ts`(`ReadCache.cached(이름, 키, 읽어 오는 함수, unless)`)와 `common/read-cache.module.ts`(`ReadCacheModule`, 앱의 Redis 연결을 가져와 `ReadCache`를 내준다). 캐시가 걸린 읽기 12개: 글 7개(`postsList`, `postDetail`, `myPosts`, `hotPosts`, `postsByTag`, `searchPosts`, `homeFeed`), `allTags`, `introsList`, `myLikes`, `userProfile`, `publicProfileAggregate`. 키·만료·`unless`는 3.10의 표와 같다. 글·태그·소개·좋아요·사용자 모듈이 `ReadCacheModule`을 가져온다. 시험용 가짜 Redis는 `test/support/fake-redis.ts`다. 캐시가 없는 읽기는 옛 코드와 같다(`getMyComments`, `isPostLiked`, `getActivitySummary`, `getPendingUsers`, `getCurrentUserRole`).

**구조에서 정한 것**

1. **`ReadCache`는 `common/`에 둔다.** `infra/redis/`는 연결만 맡고 키 이름과 명령은 쓰는 쪽이 정한다는 원칙(AGENTS.md)을 따랐다. 캐시 이름은 `CacheName` 타입으로 묶어 오타를 컴파일에서 잡는다. 키 조각은 각 서비스가 옛 `@Cacheable`의 `key` 식대로 만든다.
2. **옛 Spring의 프록시 경계를 코드 구조로 옮겼다.** Spring의 `@Cacheable`은 프록시를 거쳐야 걸려서 같은 클래스 안의 호출에는 걸리지 않았다. Nest에는 프록시가 없으므로, 캐시를 거는 공개 메서드와 캐시 없이 읽는 안쪽 메서드(`loadPosts`, `loadWeeklyPopularPosts`, `loadHomeFeed`, ...)를 나눴다. 홈 피드는 안쪽 두 조회를 캐시 없이 부르고 `TagService.getAllTags()`는 캐시를 거친다(옛 동작). 공개 프로필의 글 목록은 캐시가 붙은 `getMyPosts`가 아니라 캐시 없는 `PostService.findPostsByWriter`로 읽는다(옛 `postQueryPort` 직접 호출).
3. **값은 JSON을 거친다.** 적중한 값은 문자열을 `JSON.parse`한 것이라 `Date`는 문자열이 되고 `bigint`는 저장할 때 오류가 난다. 캐시가 걸린 12개의 반환값은 모두 서비스가 이미 응답 모양(문자열 날짜, 일반 숫자)으로 바꾼 값이라 안전하다. 새 캐시를 더할 때 지킬 규칙으로 `ReadCache`의 주석에 적었다.

**확인한 방법과 결과**

1. 게이트 4개: `lint`, `typecheck`, `test`(44개 파일 891개 통과, 건너뜀 0개. 이전 41개 814개), `build` 통과. 전체 `yarn test`를 10번 반복해 0번 실패했다(매번 891개 통과). 바뀐 파일의 서식 검사도 통과했다.
2. `ReadCache` 단위 시험(가짜 Redis): 미적중→저장, 적중→읽어 오는 함수를 부르지 않음, JSON 왕복 뒤 값이 같음(`null` 칸, 빈 배열, `0`, `false`, `''`), 이름이 다르면 따로 저장, 이름 12개의 만료(5분·30분·60분), `null`은 저장하지 않고 `0`·`false`·`''`·`[]`·`{}`는 저장, `unless`(참이면 저장 안 함, 거짓이면 저장, 적중하면 부르지 않음), Redis `get`·`set` 오류와 읽어 오는 함수의 오류를 삼키지 않음.
3. 진짜 Redis 8.10.3 시험(`read-cache.redis.spec.ts`): 키 모양과 저장된 JSON, 적중, 한글·공백·쉼표가 든 키, 실제 남은 수명(300·1800·3600초 근처), `null`과 `unless`가 막은 값, 이름이 다르면 따로 저장. 진짜 캐시 이름 아래에 시험마다 겹치지 않는 키 조각(`readcache-test-<uuid>`)을 써서 개발용 Redis의 다른 키와 섞이지 않고, 끝나면 만든 키만 지운다(`SCAN`이나 `FLUSH`는 쓰지 않는다. 개발용 Redis에는 로그인 토큰이 있다).
4. 서비스별 시험(가짜 Redis 위의 진짜 `ReadCache`): 이름·키·만료, 쪽 번호·크기·태그·사용자·검색어가 키에 들어가는지, 목록마다 다른 `unless`(글 계열은 빈 쪽 비저장, `allTags`·`introsList`·`myLikes`는 빈 결과도 저장), 두 번째 호출이 첫 호출과 같은 값인지와 저장소를 다시 부르지 않는지, 404는 저장하지 않는지, 홈 피드의 안쪽 조회와 공개 프로필의 글 목록이 캐시를 거치지 않는지(홈 피드 뒤에 `postsList`·`hotPosts` 키가 없고 `allTags` 키는 있다, 공개 프로필 뒤에 `myPosts` 키가 없다), `isPostLiked`·`getActivitySummary`·`getPendingUsers`에 캐시가 없는지.
5. 변이 시험 71개(만료 값과 표, 키 접두사·이름·구분자, `null` 건너뛰기, `unless`의 유무와 반전과 조건, 오류 삼키기, 키 조각 하나씩 빼기, 캐시 이름 바꾸기, 쪽·크기 순서, 태그 구분자와 대괄호, 정렬 구분자와 방향 표기, 닉네임 소문자화, 캐시를 거치지 않는 안쪽 경로에 캐시 걸기, 모듈 등록)를 돌려 71개를 모두 시험이 잡았다. 실패 이유가 단언 실패인지 표본으로 확인했고, 원본은 해시로 복원을 확인했다.
6. 시험이 개발 DB에 남긴 것이 없다: 전체 시험 전후의 합계가 같다(users 15, posts 58, tags 45, post_tags 76, post_images 129, comments 35, likes 83, introductions 1, profile_images 15, repository 5). 변이 시험은 개발용 Redis에 시험 전용 접두사(`readcache-test-<uuid>`) 키를 남겼다(키 모양을 바꾸는 변이 둘이 시험의 정리 목록을 벗어났다). `*readcache-test-*`로만 찾아 모두 지웠고, 지운 뒤 개발용 Redis에는 `cache:*` 키가 하나도 없다. 정상 시험은 남기지 않는다.

**알게 된 함정**

1. **적중한 값은 처음 읽은 값과 같아야 한다.** JSON을 거치면 `Date`가 문자열이 되어 첫 호출(미적중)과 두 번째 호출(적중)의 타입이 달라진다. 이 문제가 없는지 서비스마다 "두 번째 호출 = 첫 호출" 시험을 두었다.
2. **`unless`가 목록마다 다르다.** 한꺼번에 "빈 결과는 저장하지 않는다"로 만들면 `allTags`·`introsList`·`myLikes`가 옛 동작과 달라진다. 호출하는 쪽이 `unless`를 넘기게 해서 이름별로 정했다.
3. **구분자가 두 종류다.** 글 목록의 태그 키는 Java `List.toString()`이라 `[a, b]`(쉼표 뒤 공백)이고, 소개 목록의 정렬은 `Sort.toString()`이라 `createdAt: DESC`(콜론 뒤 공백)이며 여러 개는 쉼표만으로 잇는다(공백 없음, Spring Data Commons 3.4.0 소스로 확인).
4. **현재 데이터에서 인기 글은 항상 빈 목록이라 저장되지 않는다**(최근 7일 글이 없다). 홈 피드는 인기 글이 비어도 최신 글이 있으면 저장된다(`unless`가 `latest`만 본다).
5. **변이 시험은 개발용 Redis를 어지럽힐 수 있다.** 키 이름을 바꾸는 변이가 시험의 정리 목록을 벗어난 키를 만든다. `cache:`로 시작하는 키만 찾으면 접두사를 바꾸는 변이(`c:`)의 키를 놓치므로 `*readcache-test-*`로 찾았고, 그 접두사로만 지웠다. 변이 시험을 다시 돌릴 때도 같은 확인이 필요하다.

**알려진 차이**: 7절에 적었다(값 형식, 키 단순화, 무효화 없음). 요약하면 값은 `@class` 없는 보통 JSON이고, 사용자 id 대신 githubId를 키에 쓰며, `myLikes` 키에서 정렬을 뺐고, 태그 없음과 빈 목록을 `all` 하나로 합쳤다. 응답은 옛 서버와 같다.

**남은 것**: M5-6(계약 시험을 전체 비교로 넓히기, 복원 데이터 대조, 이 문서와 `backend-plan.md` 정리). 서버를 실제로 띄워 진짜 Redis·진짜 DB 위에서 17개 API를 부르는 확인도 M5-6에서 한다(지금까지의 서비스 시험은 가짜 저장소, 저장소 시험은 진짜 MySQL, 캐시 시험은 진짜 Redis로 따로 본 것이다). 무효화(`@CacheEvict`)는 쓰기를 옮기는 M6에서 연결한다. 옛 무효화는 대부분 `allEntries`(이름 전체 삭제)라서 `cache:<이름>:*`를 찾아 지워야 하고, 이때 `KEYS` 대신 `SCAN`을 쓴다 **[제안]**. `homeFeed`와 `publicProfileAggregate`는 옛 서버에도 무효화가 없다(3.10).

## 18. M5-6 구현 결과 [확인함]

**한 일**: 코드는 바꾸지 않았다(서버 쪽에서 고칠 것이 나오지 않았다). 읽기 17개가 계약 시험에 모두 들어 있는지 점검하고, 서버를 실제로 띄워 진짜 MySQL·Redis 위에서 17개를 불러 복원 데이터와 대조했고, 문서(6·8절, `backend-plan.md`)를 정리했다. 확인 스크립트는 저장소에 넣지 않았다(이유는 아래 6번).

**확인한 방법과 결과**

1. **계약 시험 점검**: 읽기 17개(공개 9, 로그인 7, 관리자 1)가 모두 `TRIAL`에 들어 있고 실제 컨트롤러로 비교된다. 가짜 컨트롤러는 쓰기 3개(`addComment`, `deleteComment`, 관리자 `delete`)만 남았다. 계약 48개 중 비교하는 것은 22개이고 나머지 26개는 쓰기(M6), 챗봇(M7), 1차 범위 밖 읽기 5개, `lookup`이라 아직 없다. 그래서 "계약 전체 비교"는 M8로 정정했다(6절).
2. **서버를 띄워 17개를 불렀다**: `yarn build` 뒤 `node dist/main`을 띄우고 개발 MySQL·Redis에 연결했다. 로그인이 필요한 호출은 개발용 JWT 비밀값으로 로컬에서 서명한 토큰(사용자마다 하나, USER·ADMIN 14명)으로 불렀다. 토큰과 비밀값은 출력하지 않았다. 기대값은 서버 코드가 아니라 따로 쓴 SQL로 구했다.
   - 공개 9개: `getPosts` totalElements와 글 id 집합이 `posts`(58)와 같고 기본 크기 10, 최신순이다. `getAllTags`는 `tags`(45)와 이름 집합이 같다. `getPostsByTag`는 태그 45개(한글 22개 포함) 모두 totalElements가 DB와 같고, 없는 태그는 200과 빈 쪽이다. `searchPosts`는 `LIKE` 결과 수와 같고 `%`를 글자 그대로 찾는다. `getWeeklyPopularPosts`는 최근 7일 글 수(0)와 같다. `getHomeFeed`의 최신 글·태그·인기 글이 위 값과 같다. `getPostDetail`은 글 58개 모두 댓글 수·좋아요 수·태그·제목이 DB와 같고 댓글 합계가 35(`comments` 행 수)다. 없는 글은 404 `P001`, 숫자가 아니면 400 `C005`다. `getIntroList`는 `introductions`(1)와 같다. `getPublicProfileByNickname`은 15명 모두 활동 수·글 수가 DB와 같고 없는 닉네임은 404 `U001`이다.
   - 로그인 7개(14명 각자): `getCurrentUserProfile`의 githubId·닉네임·role, `getCurrentUserRole`, `getActivitySummary`의 세 수, `getMyPosts`·`getMyLikes`·`getMyComments`의 totalElements와 content 길이가 모두 DB와 같다. `isPostLiked`는 누른 글에 `true`, 안 누른 글에 `false`, 없는 글에 404 `P001`이다.
   - 관리자 1개와 접근 규칙: `getPendingUsers`가 관리자에게 200(승인 대기 0명과 같음)이고 일반 사용자·토큰 없음·잘못된 토큰은 거부한다. `PRE_REGISTER` 사용자는 `getCurrentUserRole`은 200이고 `getMyPosts`는 거부된다.
3. **캐시**: 캐시가 비어 있을 때 프록시 경계를 먼저 확인했다. 홈 피드는 `homeFeed`와 `allTags`만 만들고(`postsList`·`hotPosts` 없음), 공개 프로필은 `publicProfileAggregate`만 만든다(`myPosts` 없음). 전체를 부른 뒤 만들어진 캐시 이름은 11개로 기대와 같다(`hotPosts`는 인기 글이 비어 저장하지 않아서 없다). 이름별 남은 수명이 기대 범위(5분, `allTags` 60분 안쪽)이고, 키 모양은 `cache:postsList:0-10-all`, `cache:homeFeed:0-100-all`, `cache:allTags:all`, `cache:introsList:p:0:s:100:sort:createdAt: DESC`다. 성공한 234건을 한 번씩 더 불렀을 때 응답이 첫 번째와 같았다(`timestamp` 제외). `cache:allTags:all`의 값을 바꿔 두자 응답이 따라 바뀌어 적중이 DB가 아니라 Redis에서 나옴을 확인했다.
4. **읽기 전용인지**: 정적으로는 운영 코드의 쓰기(`create`, `$executeRaw`)가 GitHub 로그인 서비스에만, 토큰 저장소 쓰기가 재발급·로그아웃에만 있어 17개 경로가 닿지 않는다. 동적으로는 호출 전후로 10개 표의 행 수와 `CHECKSUM TABLE`이 같고(UPDATE도 없었다), Redis의 `cache:*` 키 집합과 전체 키 수(2개, 로그인 토큰)가 같다. 이번 실행이 만든 `cache:*` 키 160개는 만든 것만 지웠다.
5. 서버는 확인이 끝난 뒤 종료했고(남은 프로세스 없음) 서버 로그에 오류가 없었다.
6. **스크립트를 저장소에 넣지 않은 이유**: 복원 데이터의 숫자(58, 45, 35 ...)에 기대고 있어 데이터가 없는 CI에서는 실패한다. `AGENTS.md`는 진짜 DB를 쓰는 시험을 `*.repository.spec.ts`로 한정한다. 이 확인은 복원 데이터가 바뀌면 다시 해야 하는 일회성 점검이다.

**알게 된 함정**

1. **응답마다 `timestamp`가 다르다.** 응답 본문 전체를 비교하면 항상 달라진다. 캐시 적중과 미적중을 비교할 때는 `timestamp`를 빼야 한다.
2. **서버가 떴는지 보려고 캐시가 걸린 경로를 부르면 캐시가 미리 생긴다.** 처음에 `/api/v1/tags`로 확인해서 `allTags`가 먼저 만들어졌고, 그 뒤 홈 피드가 만든 `allTags`가 새 키로 보이지 않아 프록시 경계 확인이 실패로 나왔다(서버 쪽 문제가 아니라 확인 순서의 문제였다). 준비 확인은 캐시를 쓰지 않는 `/v3/api-docs/all`로 한다.

**못 본 것**: 현재 데이터에 인기 글(최근 7일 글)과 승인 대기 사용자가 없어서 `getWeeklyPopularPosts`와 `getPendingUsers`는 "빈 경우"만 확인했다. 답글이 0개라 댓글 트리의 깊이는 단위·저장소 시험으로만 본다. 닉네임이 모두 영문이라 한글 닉네임의 공개 프로필 경로는 서버 호출로는 못 봤다. 로그인은 토큰을 직접 서명해 가드를 통과시켰고, 실제 GitHub 로그인 흐름은 M4-3에서 따로 확인했다. 옛 서버의 실제 응답과의 비교는 옛 서버가 없어서 할 수 없다. 한 번의 순차 실행이라 동시 요청 상황은 보지 않았다.

**남은 것**: M6(쓰기 API와 캐시 무효화). M8에서 계약 전체 비교와 프론트 전환.
