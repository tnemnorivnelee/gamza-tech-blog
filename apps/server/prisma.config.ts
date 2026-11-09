import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

// prisma 명령(db pull, migrate 등)의 설정 파일이다. 서버 코드가 아니라 CLI가 읽는다(vite.config.ts가 빌드 도구의 설정인 것과 같다).
// Prisma 7 CLI는 .env를 읽지 않으므로 Node 내장 loadEnvFile로 읽는다. 이미 설정된 환경변수는 덮어쓰지 않는다(CI는 .env 없이 환경변수로 준다).
// 명령은 apps/server에서 실행한다(yarn workspace @gamza/server prisma ...). .env는 거기 있다.
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

const url = process.env.DATABASE_URL;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // 접속 주소는 스키마 파일이 아니라 여기에 둔다(Prisma 7). 주소가 없어도 클라이언트 생성(generate)은 된다(DB에 붙지 않는다).
  // 그래서 yarn install의 postinstall이 .env 없는 새 클론이나 CI에서도 통과한다. DB가 필요한 명령(db pull, migrate)은 주소가 없으면 Prisma가 멈춘다.
  datasource: url ? { url } : undefined,
});
