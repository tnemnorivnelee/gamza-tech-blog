# M4 Prisma 계획

작성일 2026-11-09 · 상태: 검토 대기 · 이슈 #39 · 관련: `backend-plan.md` 7절·11절, `improvement-candidates.md` 19~21번, `porting-principle.md`

확인 기준: 복원한 로컬 DB를 직접 조회했고(개인정보 행은 보지 않고 합계만 봤다), 옛 백엔드 `potato-club/GamzaTechBlog-back`의 `master`는 읽기만 했다(코드를 실행하지 않았다). Prisma는 npm과 공식 문서로 확인했다. 표시: **[확인함]** 직접 확인, **[추정]** 자료로 짐작함, **[미검증]** 아직 확인할 방법이 없음.

## 1. 한눈에 보기

M4는 사용자 저장을 인메모리에서 진짜 DB로 옮기는 일이다. 순서는 이렇다.

1. 덤프를 로컬 MySQL에 복원한다. (완료, 3절)
2. Prisma를 넣고 `prisma db pull`로 스키마 파일을 만든다.
3. "지금 DB 상태 = 첫 마이그레이션"으로 고정한다(베이스라인).
4. `UserRepository`의 Prisma 구현을 만들어 인메모리 구현과 바꿔 끼운다. 로그인(M3)과 가드(M2)는 코드를 고치지 않는다.

프론트 비유: Prisma 스키마는 `openapi.json`과 비슷하다. 스키마 파일 하나에서 타입 있는 DB 클라이언트가 생성된다. 마이그레이션은 DB 구조의 git 커밋 이력이다. 베이스라인은 "이미 있는 프로젝트에 git을 처음 붙이며 첫 커밋을 찍는 것"이다.

## 2. 범위

M4에 넣는 것: 복원, Prisma 도입, 스키마, 베이스라인, 사용자 저장소의 Prisma 구현과 연결, 시간대 결정, 실제 DB로 하는 시험과 CI 설정.

넣지 않는 것: 글·댓글·좋아요 등 나머지 repository(M5~M6), `github_tokens`(D5), 이미지 파일(`s3-backup`, 저장소를 정할 때), 프로필 이미지.

## 3. 복원 결과 [확인함]

- 덤프 `gamzadb_full.sql`(MySQL 8.0.41, 567KB)을 로컬 컨테이너 MySQL 8.0.41의 `gamza` DB에 넣었다. 서버 버전이 같다.
- **`gamza` DB에 넣은 이유**: 덤프는 `gamzadb`라는 DB를 만들게 되어 있지만, 컨테이너의 `gamza` 사용자는 `gamza.*` 권한만 있다. 두 줄(`CREATE DATABASE`, `USE`)을 빼고 `gamza`에 넣어야 Prisma가 같은 사용자로 접속해도 테이블이 보인다. 컨테이너를 새로 만들지 않아도 된다.
- **`github_tokens` 제외**: 평문 OAuth 토큰이라 복원이 금지돼 있다(`AGENTS.md`). `awk`로 그 테이블 구간을 걸러서 MySQL에 바로 흘려 넣었다. 개인정보가 든 임시 파일은 만들지 않았다. 원본(`~/Documents`)은 그대로다.
- 덤프에는 트리거·뷰·프로시저·함수가 없다.

| 테이블    | 행  | 테이블            | 행  |
| --------- | --- | ----------------- | --- |
| users     | 15  | post_images       | 129 |
| posts     | 58  | profile_images    | 15  |
| comments  | 35  | repository        | 5   |
| likes     | 83  | commit_history    | 130 |
| tags      | 45  | introductions     | 1   |
| post_tags | 76  | projects          | 8   |
|           |     | admission_results | 7   |

외래 키 16개, 연결이 끊어진 행 0, 사용자당 프로필 이미지 최대 1장이다. 덤프 머리에 `FOREIGN_KEY_CHECKS=0`이 있어서 복원 때는 이 검사가 꺼져 있었으므로 따로 조회해 확인했다. 테이블마다 `AUTO_INCREMENT` 값이 행 수보다 크다(posts는 179, 58행). 지금까지 지워진 행이 많다는 뜻이고 새 글의 id는 179부터다.

## 4. 데이터에서 알게 된 것

1. **`github_id`는 15명 모두 `g_<숫자>` 형식이다.** M3가 만드는 `g_${id}`와 같다. 기존 회원이 로그인해도 새 사용자가 만들어지지 않는다.
2. **role은 ADMIN 3, USER 11, PRE_REGISTER 1, PENDING 0이다.** ADMIN을 만드는 코드가 옛 백엔드에 없으니 DB에 직접 넣은 것으로 보인다 **[추정]**. 이메일이 비어 있는 사용자는 0명이다.
3. **날짜는 KST(한국 시간) 벽시계 값으로 보인다 [추정].** 근거는 둘이다.
   - 옛 `BaseTime`이 `LocalDateTime`에 `@CreatedDate`·`@LastModifiedDate`를 쓴다 **[확인함]**. `LocalDateTime`에는 시간대 정보가 없고, 값은 서버(JVM)의 기본 시간대로 찍힌다. `application.yml`·`Dockerfile`·메인 클래스 어디에도 시간대 설정은 없다 **[확인함]**.
   - 글 작성 시각의 분포가 15~23시와 0~3시에 몰리고 4~8시에는 거의 없다(58건). 이 모양은 한국 시간대의 생활 패턴과 맞는다.
   - 덤프 머리의 `TIME_ZONE='+00:00'`는 덤프 도구가 쓴 세션 설정일 뿐이다. `DATETIME` 값에는 시간대 정보가 없다.
   - 첫 글은 2025-07-27, 마지막 글은 2026-05-16이다.
4. **`created_at`·`updated_at`은 `NOT NULL`인데 DB 기본값이 없다.** 옛 서버가 코드로 채웠다. Prisma로 옮기면 우리 코드가 채워야 한다(D3).
5. **1차 범위 밖인 테이블도 DB에 있다**: `admission_results`(합격 조회, 이름·전화번호 숫자 컬럼이 있다)와 `projects`. 프론트가 쓰지 않는 API의 테이블이지만 DB에 있으므로 스키마에서 지우면 안 된다(D6).

## 5. Prisma 선택 [확인함]

- **`npm view prisma dist-tags`에서 `latest`가 `8.0.0-rc.33`(릴리스 후보)이다.** 안정 버전은 `prev` 태그인 **7.10.1**(2026-10-15 게시)이고, `@prisma/client`의 `latest`도 7.10.1이다. 8의 공식 예제는 "contract" 파일과 별도 런타임 패키지(`@prisma/orm-mysql`)를 쓰는 다른 구조라서, 7의 문서와 예제를 그대로 쓸 수 없다.
- 7.x의 MySQL 쓰는 법: `prisma.config.ts`에 `datasource.url: env('DATABASE_URL')`, 생성기 `prisma-client`(출력 위치 지정, ESM 지원), 앱에서는 드라이버 어댑터 `@prisma/adapter-mariadb`(MySQL도 이걸 쓴다)로 접속한다. `schema.prisma`의 `datasource` 블록에는 `provider`만 둔다.
- 베이스라인 절차(공식): `prisma migrate diff --from-empty --to-schema ... --script`로 `0_init/migration.sql`을 만들고, `prisma migrate resolve --applied 0_init`으로 "이미 적용됨"으로 표시한다.
- Node 요구 `^22.18 || ^24.11`, 우리는 24.x라서 맞다.

## 6. 결정한 것 (옛 동작을 따르는 범위에서 구현 방법은 이유와 함께 정했다)

- **D1. Prisma 7.10.1을 정확한 버전으로 고정한다**(`^` 없이, `prisma`와 `@prisma/client`와 어댑터 모두). 이유는 5절. 8의 정식판이 나오면 검토한다(개선 후보 20번).
- **D2. 접속 정보는 `DATABASE_URL` 하나다.** `prisma` 명령과 앱이 같은 변수를 읽는다. 사용자가 `.env`에 직접 넣는다(비밀번호가 들어 있고, 비밀번호에 특수문자가 있으면 URL 인코딩이 필요하다). 필수 여부는 `REDIS_*`·`GITHUB_*`와 같은 방식을 M4-1에서 맞춘다. 검증 메시지에 값을 담지 않는다.
- **D3. `created_at`·`updated_at`은 앱 코드가 채운다.** 옛 `@CreatedDate`·`@LastModifiedDate`와 같은 일을 한다. 스키마에 `@default(now())`·`@updatedAt`을 붙일지는 `db pull` 결과를 보고 M4-1에서 정한다.
- **D4. 모델 이름은 PascalCase 단수(`User`, `Post`, `PostTag`)로 정리하고 DB 이름은 `@@map`·`@map`으로 그대로 둔다.** 같은 DB를 쓰므로 테이블·컬럼 이름은 바꾸지 않는다. 정리한 뒤에는 `db pull`을 다시 돌리지 않는다(이름이 덮어써진다).
- **D5. `github_tokens` 모델은 만들지 않는다.** 복원하지 않았고, GitHub 토큰 보관 방식은 게시글 동기화를 이식하기 전에 사용자에게 묻기로 했다(`m3-github-login-plan.md` D7).
- **D6. 안 쓰는 테이블(`admission_results`, `projects`)도 스키마에 남긴다.** 빼면 이후 `migrate dev`가 그 테이블을 지우려 한다. 코드는 쓰지 않는다.
- **D7. 시간대는 옛 동작대로 "KST 벽시계 값을 DB에 그대로 두고, 새로 쓰는 값도 같은 기준으로 쓴다."** 옛 행과 새 행이 9시간 어긋나면 안 되기 때문이다. Prisma가 `DATETIME`을 UTC로 읽고 쓰므로, 값을 어떻게 맞출지는 M4-2에서 실험으로 정한다(8절 1번). UTC로 바꾸는 것은 개선 후보 19번이다.
- **D8. 사용자 저장소 시험은 진짜 MySQL로 한다.** CI에 `mysql:8.0.41` 서비스 컨테이너를 추가한다. 로컬에서 닿지 않으면 건너뛰고, CI(`CI=true`)에서 닿지 않으면 실패시킨다. Redis 시험과 같은 방식이다.

## 7. 새 구조 [제안]

```
apps/server/
  prisma.config.ts             Prisma 명령의 설정(스키마 위치, 마이그레이션 위치, DATABASE_URL)
  prisma/schema.prisma         db pull로 만든 뒤 이름을 정리한 스키마
  prisma/migrations/0_init/    베이스라인(현재 DB 상태)
  src/infra/prisma/            PrismaModule, PrismaService(연결만, 키 이름·쿼리는 두지 않는다)
  src/modules/user/prisma-user.repository.ts   UserRepository의 Prisma 구현 (Prisma는 *.repository.ts에서만 import)
```

생성되는 클라이언트 코드는 커밋하지 않는다. `prisma generate`를 빌드 전에 돌린다(위치와 스크립트는 M4-1에서 정한다). `UserModule`의 `useClass`만 `PrismaUserRepository`로 바꾸면 쓰는 쪽(가드, 로그인)은 그대로다. `InMemoryUserRepository`는 가드·로그인 시험이 쓰므로 남긴다.

## 8. 미검증

1. **시간대 처리**: Prisma 7의 MariaDB 어댑터가 `DATETIME`을 어떤 시간대로 읽고 쓰는지. 실험: 새 행을 쓴 뒤 SQL로 날것의 값을 읽어 비교한다. M4-2.
2. **`db pull` 결과 품질**: `ENUM`(role, position), `MEDIUMTEXT`, `DATETIME(6)`, `idx_post_created_at DESC` 인덱스, 하이버네이트가 붙인 외래 키 이름(`FK7h83...`). M4-1.
3. **마이크로초**: DB는 `DATETIME(6)`(마이크로초)인데 JS `Date`는 밀리초까지다. 옛 응답 JSON이 마이크로초까지 보냈다면(Spring 기본 설정에서 `LocalDateTime`은 0이 아닌 자리까지 찍는 것이 보통이다 **[추정]**) 새 응답은 밀리초에서 잘려 달라진다 **[미검증]**. 읽기 API를 옮기는 M5에서 계약과 함께 본다.
4. **어댑터 설정 방식**(연결 문자열인지 옵션 객체인지)과 로컬 MySQL 8의 인증 방식(`caching_sha2_password`)에 필요한 옵션. M4-2.
5. **생성기의 ESM 출력과 우리 규칙**(상대 import는 `.js`로 끝낸다)이 맞는지. M4-1.
6. **`migrate dev`는 임시(shadow) DB를 만들 권한이 필요한데 `gamza` 사용자에게는 없다.** 베이스라인과 `migrate diff`는 필요 없으므로 지금은 걸리지 않는다. 이후 스키마를 바꿀 때 다시 본다.

## 9. 작업 분할 [제안]

각각 이슈 → 브랜치 → PR이고, 모두 `lint`·`typecheck`·`test`·`build`를 통과해야 한다.

1. **M4-1 Prisma 도입과 스키마**: 7.10.1 고정 설치, `prisma.config.ts`, `db pull`, 이름 정리, `0_init` 베이스라인(로컬 DB에는 `migrate resolve --applied`), 클라이언트 생성, `DATABASE_URL` 검증과 `.env.example`. 시험: 빈 MySQL에 `0_init`을 적용한 결과가 스키마 파일과 같은지 CI에서 비교한다. 선행: 사용자가 `.env`에 `DATABASE_URL` 추가.
2. **M4-2 사용자 저장소 연결**: `PrismaModule`·`PrismaService`, `PrismaUserRepository`(`findByGithubId`, `create`, `updateEmailIfEmpty`), `UserModule` 교체, 시간대 실험과 결정(D7), 실제 MySQL 시험, CI MySQL 서비스. 시험: 찾기, 만들기(필드·시각), 이메일은 비어 있을 때만 채움, 같은 `github_id`나 닉네임 중복 처리. 선행: vitest가 `.env`의 `DATABASE_` 접두사 값을 읽는 것을 사용자가 허락(`REDIS_`와 같은 방식).
3. **M4-3 확인과 정리**: 코드에 남긴 `shortcut:` 주석을 모아 M4 시점에 풀 것을 확인하고 이 문서와 `backend-plan.md`를 사실에 맞게 고친다. 사용자가 실제 GitHub 로그인으로 기존 계정이 role을 유지하는지 확인한다.

## 10. 문서 정정

이 PR에서 `improvement-candidates.md`에 19~21번을 더하고, `backend-plan.md`는 7절 마지막 줄, 11절 M4, 13절 6번, 14절의 세 항목(ADMIN, Prisma, 시간대)만 사실에 맞춘다.

## 11. 사용자가 할 일

1. M4-1 직전: `apps/server/.env`에 `DATABASE_URL`을 추가한다. 형식은 `mysql://gamza:<비밀번호>@127.0.0.1:3306/gamza`이고, 값은 이미 `.env`에 있는 `MYSQL_*`와 같은 사용자·비밀번호다. 값은 채팅과 커밋에 쓰지 않는다.
2. M4-2 직전: vitest가 `.env`의 `DATABASE_` 접두사 값만 읽어도 되는지 알려 준다.
3. 원본 덤프와 `s3-backup`(`~/Documents`)은 사용자의 파일이라 그대로 뒀다. 복원은 끝났고 작업 사본은 만들지 않았다. 개인정보가 있으니 보관 위치는 사용자가 정한다.
4. 옛 운영 서버의 JWT 비밀값·DB 비밀번호·스토리지 키가 아직 쓰이고 있다면 교체한다(`AGENTS.md`). 새 서버는 새 값을 쓰므로 배포 단계에서 다시 짚는다.
