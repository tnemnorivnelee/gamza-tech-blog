# gamza-tech-blog

감자 기술 블로그 모노레포입니다. 내려간 옛 백엔드를 NestJS로 같은 API 계약에 맞춰 다시 만들고 있습니다.

## 구조

- `apps/server`: NestJS API 서버
- `apps/web`: 프론트엔드 (예정). 지금은 `potato-club/GamzaTechBlog-front`에서 따로 운영합니다.
- `docs/backend-plan.md`: 구현 계획과 결정 이유
- `docs/infra-notes.md`: 코드에 드러나지 않는 인프라 사실(도메인, 서버, 팀원 합의)
- `docs/porting-principle.md`: 이식(1차) 단계 동안만 쓰는 이식 원칙
- `AGENTS.md`: 작업 규칙과 AI 도구용 지침 (`CLAUDE.md`는 이것을 불러옵니다)

## 개발

Node 버전은 `.nvmrc`를 따릅니다. 패키지 매니저는 yarn(v1)입니다.

```bash
fnm use                                    # .nvmrc의 Node 사용
yarn install
cp apps/server/.env.example apps/server/.env
yarn dev                                   # 개발 서버
yarn lint && yarn typecheck && yarn test && yarn build   # CI와 같은 검사
```

로컬 MySQL·Redis(Docker)는 `apps/server/.env`에 `MYSQL_ROOT_PASSWORD`, `MYSQL_PASSWORD`, `REDIS_PASSWORD`를 채운 뒤 띄웁니다(`openssl rand -hex 24`로 만들 수 있습니다). 서버는 아직 이 둘에 연결하지 않습니다.

`yarn dev:local` 한 번이면 두 컨테이너를 띄우고(이미 떠 있으면 그대로 둡니다), 둘이 실제 요청을 받을 수 있을 때까지 기다린 뒤 `yarn dev`를 실행합니다. 준비에 실패하면 서버를 띄우지 않습니다. `Ctrl+C`는 서버만 끄고 컨테이너는 남깁니다. 이 명령이 성공해도 서버가 DB·Redis에 연결한다는 뜻은 아닙니다(연결 구현은 별도 작업입니다).

```bash
docker compose -f apps/server/docker-compose.dev.yml up -d     # 띄우기 (데이터는 볼륨에 남음)
docker compose -f apps/server/docker-compose.dev.yml down      # 끄기 (데이터 유지, -v를 붙이면 삭제)
```

## 지켜야 할 것

- `.env`, DB 덤프(`*.sql`, `*.dump` 등)는 커밋하지 않습니다. 덤프에 개인정보가 있습니다.
- 작업은 Issue → Branch(`<type>/<이슈번호>-<설명>`) → PR 순서로 합니다. 커밋 메시지는 한국어로 씁니다.
- 자세한 규칙은 `AGENTS.md`(코딩·시험 규칙, 절대 하지 않는 것)와 `docs/porting-principle.md`(이식 원칙)를 봅니다.
