# M4 Prisma 계획

작성일 2026-11-09 · 상태: M4-1·M4-2 구현됨(10·11절), M4-3 남음 · 이슈 #39, #41, #44 · 관련: `backend-plan.md` 7절·11절, `improvement-candidates.md` 19~21번, `porting-principle.md`

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

- 덤프 `gamzadb_full.sql`(MySQL 8.0.41, 567KB)을 로컬 컨테이너 MySQL 8.0.41의 `gamza` DB에 넣었다. 서버 버전이 같다. 운영은 MySQL 8.4로 정했다(D10). 같은 방식으로 임시 8.4.13 컨테이너에도 복원해서 테이블 13개, 외래 키 16개, 행 수가 모두 같음을 확인했다(컨테이너는 지웠다).
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

- **D1. Prisma 7.10.1을 정확한 버전으로 고정한다**(`^` 없이, `prisma`·`@prisma/client`·`@prisma/adapter-mariadb` 모두 같은 버전). 이유는 5절. 8의 정식판이 나오면 검토한다(개선 후보 20번).
- **D2. 접속 정보는 `DATABASE_URL` 하나다.** `prisma` 명령과 앱이 같은 변수를 읽는다. 사용자가 `.env`에 직접 넣는다(비밀번호가 들어 있고, 비밀번호에 특수문자가 있으면 URL 인코딩이 필요하다). 필수 여부는 `GITHUB_*`와 같은 방식이다(M4-1에서 구현): 운영(`NODE_ENV=production`)에서는 필수이고, 그 밖에서는 비워 둘 수 있다(DB 없이도 서버가 뜬다). 값이 있으면 `mysql://` 모양인지 검사한다. 검증 메시지에 값을 담지 않는다.
- **D3. `created_at`·`updated_at`은 앱 코드가 채운다.** 옛 `@CreatedDate`·`@LastModifiedDate`와 같은 일을 한다. **스키마에 `@default(now())`·`@updatedAt`을 붙이지 않았다**(M4-1에서 정함). 이유 둘: 베이스라인은 실제 DB와 같아야 하는데 `@default(now())`를 붙이면 마이그레이션 SQL에 `DEFAULT CURRENT_TIMESTAMP`가 생겨 어긋난다. 그리고 Prisma 7은 이 값을 클라이언트가 UTC로 채우므로, 붙이는 순간 시간대(D7)가 조용히 UTC로 정해진다.
- **D4. 모델 이름은 PascalCase 단수(`User`, `Post`, `PostTag`)로 정리하고 DB 이름은 `@@map`·`@map`으로 그대로 둔다.** 같은 DB를 쓰므로 테이블·컬럼 이름은 바꾸지 않는다. 정리한 뒤에는 `db pull`을 다시 돌리지 않는다(이름이 덮어써진다).
- **D5. `github_tokens` 모델은 만들지 않는다.** 복원하지 않았고, GitHub 토큰 보관 방식은 게시글 동기화를 이식하기 전에 사용자에게 묻기로 했다(`m3-github-login-plan.md` D7).
- **D6. 안 쓰는 테이블(`admission_results`, `projects`)도 스키마에 남긴다.** 빼면 이후 `migrate dev`가 그 테이블을 지우려 한다. 코드는 쓰지 않는다.
- **D7. 시간대는 옛 동작대로 "KST 벽시계 값을 DB에 그대로 두고, 새로 쓰는 값도 같은 기준으로 쓴다."** 옛 행과 새 행이 9시간 어긋나면 안 되기 때문이다. **[확정 2026-11-10, M4-2]** Prisma 어댑터는 `Date`의 UTC 필드를 `DATETIME`에 그대로 쓰고 읽는다(프로세스 시간대와 무관). 그래서 새 행에는 `Date.now() + 9시간`을 넘긴다(`prisma-user.repository.ts`). 실험과 근거는 11절. UTC로 바꾸는 것은 개선 후보 19번이다.
- **D8. 사용자 저장소 시험은 진짜 MySQL로 한다.** CI에 MySQL 서비스 컨테이너를 둔다(M4-1에서 마이그레이션 확인용으로 먼저 추가했고, M4-2에서 8.4.13으로 올리고 시험에도 쓴다). 로컬에서 닿지 않으면 건너뛰고, CI(`CI=true`)에서 닿지 않으면 실패시킨다. Redis 시험과 같은 방식이다. 개발용 DB에는 실제 회원 데이터가 있어서 `DATABASE_URL`은 이 시험만 `.env`에서 직접 읽는다(11절 함정 1번).
- **D9. 운영 DB는 EC2(t4g.small) 한 대 + RDS MySQL Single-AZ db.t4g.micro(1GB)로 간다**(사용자 결정, 2026-11-09). 1GB로 시작해 측정한 뒤 모자라면 올린다. 비교했던 안(월 비용은 전달받은 단가로 계산한 값이고 서울 단가는 [미검증]이다): A EC2에 MySQL 컨테이너 약 $21, **B RDS micro 약 $42**, C RDS small(2GB) 약 $61, D EC2 t4g.medium(4GB)에 MySQL 컨테이너 약 $36. 크레딧 $199.83이 2027-02-11에 끝나는데 B는 94일에 약 $131을 써서 약 $68이 남고, C는 약 $10만 남아 예상 밖 지출을 받을 수 없다. 이유: 학습·포트폴리오에 맞고(RDS 설정 경험), 옛 서비스도 RDS였으며, 자동 백업·패치가 있고, 데이터가 작아(덤프 567KB, 회원 15명) 나중에 A로 옮기는 비용이 낮다. 단점: 설정 단계가 늘고 크레딧이 끝난 뒤 월 $42가 계속 든다. **아직 AWS 리소스를 만들지 않았다.** 만들기 전에 확인할 것 [미검증]: 서울 EC2·RDS 시간당 단가, RDS 백업 무료 범위, 크레딧이 적용되는 서비스, 만료 후 자동 청구 여부, t3.small(이전 인수인계)과 t4g.small(ARM) 중 어느 것인지, 배포 이미지의 arm64 지원. 크레딧이 끝나기 전에(2027-02-11) 유지·축소·종료를 다시 정한다.
- **D10. MySQL은 8.4로 간다**(사용자 결정, 2026-11-09). RDS의 8.0은 표준 지원이 2026-07-31에 끝나서 연장 지원료가 붙는다(vCPU당 시간 과금, 전달받은 서울 단가 $0.12는 [미검증]이고 문서에는 리전과 날짜에 따라 다르다고만 나온다). 9.x는 RDS에서 미리보기뿐이다. 8.4는 RDS 표준 지원이 2029-07-31까지다(AWS 문서 확인함). 옛 덤프(8.0.41)는 임시 8.4.13에 오류 없이 복원되고 행 수가 모두 같다. 이 DB의 외래 키 16개가 모두 기본 키를 가리켜서, 8.4가 기본으로 막는 "기본 키가 아닌 컬럼을 가리키는 외래 키"에 걸리지 않는다. **후속(완료, M4-2, 2026-11-10)**: 로컬 Compose와 CI의 MySQL을 `mysql:8.4.13`으로 올렸다(사용자 허락 받음). 로컬은 `gamza-dev-mysql-1`만 다시 만들었고, 볼륨의 8.0.41 데이터를 8.4가 제자리에서 이어받았다(11절). RDS가 제공하는 8.4 마이너(문서상 8.4.5~8.4.11)는 만들 때 콘솔에서 확인한다.

## 7. 새 구조 [제안]

```
apps/server/
  prisma.config.ts             Prisma 명령의 설정(스키마 위치, 마이그레이션 위치, DATABASE_URL)
  prisma/schema.prisma         db pull로 만든 뒤 이름을 정리한 스키마
  prisma/migrations/0_init/    베이스라인(현재 DB 상태)
  src/infra/prisma/            PrismaModule, PrismaService(연결만, 키 이름·쿼리는 두지 않는다)
  src/modules/user/prisma-user.repository.ts   UserRepository의 Prisma 구현 (Prisma는 *.repository.ts에서만 import)
```

생성되는 클라이언트 코드(`src/infra/prisma/generated/`)는 커밋하지 않는다. `yarn install`의 `postinstall`이 `prisma generate`를 돌린다(M4-1). `UserModule`의 `useClass`만 `PrismaUserRepository`로 바꾸면 쓰는 쪽(가드, 로그인)은 그대로다. `InMemoryUserRepository`는 가드·로그인 시험이 쓰므로 남긴다.

## 8. 미검증

1. ~~시간대 처리~~ **[확인함, M4-2]** 어댑터가 `DATETIME`을 UTC 필드 그대로 쓰고 읽는다. 프로세스 시간대 네 가지에서 같은 시험이 통과했다(11절). 옛 행이 KST라는 근거는 여전히 **[추정]**이다(4절).
2. ~~`db pull` 결과 품질~~ **[확인함, M4-1]** `ENUM`(role, position), `MEDIUMTEXT`, `DATETIME(6)`, `idx_post_created_at DESC` 인덱스, 하이버네이트가 붙인 외래 키 이름(`FK7h83...`)이 모두 정확히 들어왔다(10절).
3. **마이크로초**: DB는 `DATETIME(6)`(마이크로초)인데 JS `Date`는 밀리초까지다. 옛 응답 JSON이 마이크로초까지 보냈다면(Spring 기본 설정에서 `LocalDateTime`은 0이 아닌 자리까지 찍는 것이 보통이다 **[추정]**) 새 응답은 밀리초에서 잘려 달라진다 **[미검증]**. 읽기 API를 옮기는 M5에서 계약과 함께 본다.
4. ~~어댑터 설정 방식~~ **[확인함, M4-2]** `mysql://` 연결 문자열을 그대로 받는다. 로컬 MySQL 8.4의 기본 인증(`caching_sha2_password`)에도 별도 옵션 없이 접속된다. RDS에 붙일 때의 TLS 옵션은 인프라 단계에서 본다 **[미검증]**.
5. ~~생성기의 ESM 출력과 우리 규칙~~ **[확인함, M4-1]** `importFileExtension = "js"`로 상대 import가 `.js`로 끝나고, 생성물을 `src` 안에 두면 `dist/main.js` 구조가 그대로다.
6. **`migrate dev`는 임시(shadow) DB를 만들 권한이 필요한데 `gamza` 사용자에게는 없다.** 베이스라인과 `migrate diff`는 필요 없으므로 지금은 걸리지 않는다. 이후 스키마를 바꿀 때 다시 본다.

## 9. 작업 분할 [제안]

각각 이슈 → 브랜치 → PR이고, 모두 `lint`·`typecheck`·`test`·`build`를 통과해야 한다.

1. **M4-1 Prisma 도입과 스키마** (구현됨, 10절): 7.10.1 고정 설치, `prisma.config.ts`, `db pull`, 이름 정리, `0_init` 베이스라인(로컬 DB에는 `migrate resolve --applied`), 클라이언트 생성, `DATABASE_URL` 검증과 `.env.example`. 시험: 빈 MySQL에 `0_init`을 적용한 결과가 스키마 파일과 같은지 CI에서 비교한다. 어댑터(`@prisma/adapter-mariadb`)는 접속하는 M4-2에서 더한다.
2. **M4-2 사용자 저장소 연결** (구현됨, 11절): `PrismaModule`·`PrismaService`, `PrismaUserRepository`(`findByGithubId`, `create`, `updateEmailIfEmpty`), `UserModule` 교체, 시간대 실험과 결정(D7), 실제 MySQL 시험, CI MySQL 서비스. 시험: 찾기, 만들기(필드·시각), 이메일은 비어 있을 때만 채움, 같은 `github_id`나 닉네임 중복 처리. 선행(허락 받음, 2026-11-10): 시험이 `.env`의 `DATABASE_` 값을 읽는 것, 로컬 MySQL을 8.4로 올리는 것.
3. **M4-3 확인과 정리**: 코드에 남긴 `shortcut:` 주석을 모아 M4 시점에 풀 것을 확인하고 이 문서와 `backend-plan.md`를 사실에 맞게 고친다. 사용자가 실제 GitHub 로그인으로 기존 계정이 role을 유지하는지 확인한다.

## 10. M4-1 구현 결과 [확인함]

**만든 것**: `prisma`·`@prisma/client` 7.10.1(고정), `apps/server/prisma.config.ts`, `apps/server/prisma/schema.prisma`(모델 13개, enum 3개), `prisma/migrations/0_init`(테이블 13개, 외래 키 16개), `postinstall`의 `prisma generate`, `.gitignore`(생성물 무시, 마이그레이션 SQL 예외), `DATABASE_URL` 검증과 `.env.example`, CI(MySQL 서비스 컨테이너, 마이그레이션 적용, 스키마 비교).

**`db pull` 품질**: 13개 모델과 ENUM 3개, `MEDIUMTEXT`, `TINYTEXT`, `DATETIME(6)`, 내림차순 인덱스, 하이버네이트가 붙인 인덱스·외래 키 이름이 정확히 들어왔다. 고친 것은 이름뿐이다(D4): 모델은 테이블 이름 그대로(`users`, `posts`)라서 PascalCase 단수로, 컬럼은 camelCase로 바꾸고 옛 이름은 `@map`으로 남겼다. 자기 참조 관계(대댓글)는 `parent`·`replies`로 이름을 붙였고, `db pull`이 지운 주석은 다시 적었다.

**확인한 방법과 결과**

1. 정리한 스키마와 실제 로컬 DB를 `prisma migrate diff --exit-code`로 비교: 차이 없음(0). 컬럼 길이를 바꾼 사본과 인덱스를 지운 사본은 각각 2(차이 있음)가 나와서, 이 검사가 어긋남을 잡는 것을 확인했다.
2. 빈 MySQL 8.0.41에 `0_init`을 적용하고 실제 DB와 `information_schema`로 비교(테이블 엔진·정렬 규칙, 컬럼 타입·널 허용·기본값·문자셋, 인덱스 열 순서·내림차순, 외래 키 이름·규칙): 148개 항목이 모두 같다.
3. `node_modules`·`.env`·생성물이 없는 깨끗한 사본에서 `yarn install`(`postinstall`) → 마이그레이션 적용 → 스키마 비교 → `lint`·`typecheck`·`test`·`build` 통과(313 통과, 14 건너뜀: 로컬에 Redis 접속 정보가 없는 Redis 시험).
4. `DATABASE_URL` 검증의 변이 6개(운영 필수 조건 제거, 정규식 앞·끝 고정 제거 등)는 모두 시험이 잡았다.

**알게 된 함정**

1. **정렬 규칙이 다르게 만들어진다.** Prisma가 만드는 SQL은 테이블마다 `COLLATE utf8mb4_unicode_ci`를 박는데 실제 DB는 MySQL 8 기본값 `utf8mb4_0900_ai_ci`다. Prisma의 비교는 정렬 규칙을 보지 않아서 "차이 없음"이 나오지만, 이 SQL로 새 DB를 만들면 운영 DB와 달라진다. `0_init`의 13곳을 `utf8mb4_0900_ai_ci`로 고쳤다. 앞으로 Prisma가 만드는 마이그레이션도 새 테이블에 `unicode_ci`를 박으므로, 새 테이블을 만들 때 직접 확인해야 한다.
2. **`.gitignore`의 `*.sql`(덤프 방지)이 마이그레이션 SQL을 막았다.** 깨끗한 사본에서 "적용할 마이그레이션 없음"이 나와서 알았다. 구조(DDL)만 있는 `migration.sql`은 예외로 풀었다. 데이터 행(`INSERT`)이 들어가면 안 된다.
3. **`env('DATABASE_URL')`은 값이 없으면 `generate`까지 막는다.** `postinstall`이 `.env` 없는 새 클론과 CI에서 깨지므로, 주소가 있을 때만 `datasource`를 넘기게 했다. DB가 필요한 명령(`db pull`, `migrate`)은 주소가 없으면 "The datasource.url property is required"로 멈춘다.
4. **`BigInt` 컬럼은 JS `bigint`로 나온다.** `JSON.stringify`가 다루지 못하므로 응답에 실을 때 `Number(...)`로 바꿔야 한다(M5).
5. `prisma` 패키지가 `@prisma/studio-core` 등 무거운 의존을 끌고 온다. 개발 의존성이라 서버 배포 이미지에는 필요 없다.

**로컬 DB에 한 일**: `prisma migrate resolve --applied 0_init`으로 `_prisma_migrations` 표 하나를 추가했다(SQL은 실행하지 않았다). 로컬 컨테이너를 8.4로 새로 만들어 덤프를 다시 복원하면 이 표가 사라지므로, 그때 한 번 더 표시해야 한다.

## 11. M4-2 구현 결과 [확인함]

**만든 것**: 로컬 Compose·CI의 `mysql:8.4.13`, `@prisma/adapter-mariadb` 7.10.1, `infra/prisma/`의 `PrismaModule`·`PrismaService`(연결만), `modules/user/prisma-user.repository.ts`(`findByGithubId`, `create`, `updateEmailIfEmpty`), `UserModule`이 기본으로 `PrismaUserRepository`를 쓰도록 교체, 진짜 MySQL 시험 18개와 `PrismaService` 시험 3개, CI 시험 단계의 `DATABASE_URL`.

**로컬 MySQL을 8.4로 올린 결과**: `gamza-dev-mysql-1`만 다시 만들었다(Redis는 그대로). 로그에 `Server upgrade from '80041' to '80413' completed`가 나왔다. 올린 뒤 users 15, posts 58, comments 35, likes 83이 그대로이고 `prisma migrate status`는 "up to date", 스키마 비교는 차이 없음이다.

**시간대 결정(D7)과 근거**
1. 어댑터 소스(`@prisma/adapter-mariadb/dist/index.js`)를 읽었다. 쓸 때는 `Date`의 `getUTC*` 필드를 `DATETIME` 문자열로 만들고, 읽을 때는 드라이버에 `dateStrings: true`를 줘서 문자열로 받은 뒤 끝에 `Z`를 붙여 UTC로 해석한다. 둘 다 프로세스 시간대를 쓰지 않는다.
2. 그래서 새 행에는 `new Date(Date.now() + 9시간)`을 넘긴다. DB에는 서울 벽시계 값이 들어간다. 시험은 코드의 `+9시간` 상수를 쓰지 않고 `Intl`(`Asia/Seoul`)로 따로 구한 서울 시각과 SQL로 읽은 날것의 값을 비교한다. 상수가 틀리면 잡힌다(변이 3개 확인).
3. 프로세스 시간대를 `UTC`, `Asia/Seoul`, `America/Los_Angeles`, `Pacific/Auckland`로 바꿔 돌려도 같은 시험이 통과했다.
4. 읽을 때는 `Date`의 UTC 필드가 DB의 벽시계 값(KST)이다. M5에서 응답을 만들 때 `toISOString()`에서 끝의 `Z`를 떼면 Spring의 `LocalDateTime` 모양이 된다. 옛 응답이 실제로 그 모양이었는지와 마이크로초(8절 3번)는 M5에서 본다.

**확인한 방법과 결과**
1. 진짜 MySQL 8.4.13으로 하는 시험 18개: 찾기·만들기(한글 포함), 두 시각의 서울 시각, 이메일은 비었을 때(null, 빈 문자열, 공백)만 채우고 이미 있으면 값과 `updated_at`을 건드리지 않음, 다른 사용자의 비어 있는 이메일은 건드리지 않음, 따옴표와 SQL 조각이 든 이메일도 값으로만 저장됨, `githubId`·닉네임·이메일이 겹치면 DB가 거부(P2002).
2. `PrismaUserRepository` 변이 16개와 `PrismaService` 변이 3개를 모두 시험이 잡았다. 처음에 못 잡은 것은 "앱이 닫힐 때 연결을 닫지 않음"이라 `PrismaService` 시험을 추가했다.
3. 전체 `yarn test` 349개 통과(19개 파일). 깨끗한 사본(`node_modules`·`.env`·생성물 없음)에서 MySQL 8.4.13으로 CI 순서를 돌렸다. (a) `DATABASE_URL`·`CI` 없이: DB 시험 18개는 건너뛰고 통과. (b) `CI=true` + `DATABASE_URL`: 시험 335개 통과(DB 시험 18개 포함). 이 사본에는 Redis를 띄우지 않아서 Redis 시험의 "CI인데 연결 불가" 가드만 실패했고, 실제 CI에는 Redis 서비스가 있다.
4. CI에서 DB에 못 닿으면 실패한다(`CI=true`와 닿지 않는 주소로 확인).

**알게 된 함정**
1. **기본 저장소를 Prisma로 바꾸자 `test/auth/github-login.spec.ts`가 개발 DB에 사용자를 만들었다.** 이 시험은 앱 모듈의 기본 `UserRepository`를 그대로 꺼내 썼고(전에는 인메모리였다), 전체 시험 실행에서 21개 실패로 드러났다. 개발 DB에 시험 행 `g_1001` 하나가 남았고(원본 회원 15명은 그대로), 좁은 조건으로 그 한 행만 지웠다. 시험은 `overrideProvider(UserRepository)`로 인메모리를 쓰게 고쳤다. **재발 방지**: `DATABASE_URL`을 시험 전체에 주입하지 않고(`vitest.config.ts`), 진짜 DB 시험만 `.env`에서 직접 읽는다. 다른 시험이 실수로 Prisma 저장소를 쓰면 주소가 없어서 "연결 주소 형식" 오류로 실패한다. 교체를 일부러 빼서 35개가 실패하고 DB는 변하지 않음을 확인했다. CI의 DB는 일회용이라 환경변수로 준다.
2. **닿지 않는 DB에는 기본 설정으로 첫 쿼리가 약 20초 뒤에 실패한다.** 연결 확인(probe)에만 `acquireTimeout=2000`을 줘서 약 4초로 줄였다. 서비스의 연결 풀 설정은 어댑터 기본값 그대로다(`shortcut:` 주석). 옛 서버의 HikariCP 기본값(연결 대기 10초, 유휴 10분, 최대 수명 약 28분)과 맞추는 일은 운영 DB를 만들 때 한다.
3. **`DATABASE_URL`이 `undefined`이면 어댑터 생성자가 `TypeError`로 죽는다.** 빈 문자열을 넘기면 서버는 뜨고 첫 쿼리에서 "error parsing connection string"으로 막힌다. 개발에서 비워 둘 수 있다는 D2와 맞추려고 빈 문자열을 넘긴다.
4. **시험이 `users`의 AUTO_INCREMENT를 올린다.** InnoDB는 지운 행의 번호를 되돌리지 않는다. 회원 데이터에는 영향이 없고 새 사용자의 id가 46보다 커질 뿐이다. 값을 정확히 보려면 `SET SESSION information_schema_stats_expiry=0`을 먼저 줘야 한다(통계를 하루 캐시한다).

**남은 것**: M4-3. 코드에 남긴 `shortcut:` 주석 확인과 사용자가 실제 GitHub 로그인으로 기존 계정의 role이 유지되는지 확인하는 것. 서버를 띄워 로그인해 보는 것은 아직 하지 않았다.

## 12. 문서 정정

M4-1 PR에서 `improvement-candidates.md`에 19~21번을 더하고, `backend-plan.md`는 7절 마지막 줄, 11절 M4, 13절 6번, 14절의 세 항목(ADMIN, Prisma, 시간대)만 사실에 맞췄다. M4-2 PR에서는 `backend-plan.md`의 Compose 이미지 줄(8.4.13)과 13절 1번의 저장소 "비공개" 표기(지금은 공개)를 고치고, `AGENTS.md`의 구조 설명에 `infra/prisma`를 반영했다.

## 13. 사용자가 할 일

1. ~~M4-1 직전: `.env`에 `DATABASE_URL` 추가~~ 완료.
2. ~~M4-2 직전: 시험이 `.env`의 `DATABASE_` 값을 읽어도 되는지~~ 허락 받음(2026-11-10).
3. ~~로컬 Compose를 MySQL 8.4로 올릴 때 `gamza-dev-mysql-1` 재생성~~ 허락 받고 완료(2026-11-10).
4. AWS 리소스를 만들기 전(D9): 서울 단가, 백업 무료 범위, 크레딧 적용 서비스, 만료 후 자동 청구 여부, 인스턴스 종류를 콘솔과 계산기로 확인한다.
5. 원본 덤프와 `s3-backup`(`~/Documents`)은 사용자의 파일이라 그대로 뒀다. 작업 사본은 만들지 않았고, 임시 컨테이너는 모두 지웠다. 개인정보가 있으니 보관 위치는 사용자가 정한다.
6. 옛 운영 서버의 JWT 비밀값·DB 비밀번호·스토리지 키가 아직 쓰이고 있다면 교체한다(`AGENTS.md`). 새 서버는 새 값을 쓰므로 배포 단계에서 다시 짚는다.
