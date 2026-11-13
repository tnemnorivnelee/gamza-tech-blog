import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { loadEnv } from 'vite';
import { PrismaClient } from '../../src/infra/prisma/generated/client.js';

// 진짜 MySQL로 하는 시험(*.repository.spec.ts)이 함께 쓰는 접속 준비다. 파일이 셋이 되어 공용으로 뽑았다.
// 접속 주소는 앱과 같은 환경변수 DATABASE_URL이다. CI는 환경변수로 주고, 로컬에서는 apps/server/.env에서 이 시험들만 직접 읽는다.
// 개발용 DB에는 복원한 실제 회원 데이터가 있어서 vitest.config.ts는 이 주소를 시험 전체에 넣지 않는다. 다른 시험이 실수로 기본 저장소
// (Prisma)를 쓰더라도 주소가 없어서 DB에 닿지 못하고 실패한다.
export const databaseUrl =
  process.env.DATABASE_URL ||
  loadEnv('test', process.cwd(), 'DATABASE_').DATABASE_URL;

// 연결되고 users 테이블이 있는지 먼저 본다. 안 되면 다시 시도하지 않고 바로 false다.
// acquireTimeout: 닿지 않는 DB에서 기다리는 시간. 기본값이면 건너뛰기 전에 20초를 기다린다.
async function canConnect(): Promise<boolean> {
  if (!databaseUrl) return false;
  const probeUrl = new URL(databaseUrl);
  probeUrl.searchParams.set('acquireTimeout', '2000');
  const probe = new PrismaClient({
    adapter: new PrismaMariaDb(probeUrl.toString()),
  });
  try {
    await probe.$queryRaw`SELECT 1 FROM users LIMIT 1`;
    return true;
  } catch {
    return false;
  } finally {
    await probe.$disconnect();
  }
}

export const databaseReachable = await canConnect();

// 로컬에는 DB가 없을 수 있어 건너뛴다. 하지만 CI에는 서비스 컨테이너가 항상 있어야 하므로, 건너뛰지 않고 실패시킨다.
// 조용히 건너뛰면 CI가 통과해도 DB는 한 번도 시험되지 않는다.
if (!databaseReachable && process.env.CI) {
  throw new Error(
    'CI인데 DB에 연결할 수 없거나 users 테이블이 없습니다. .github/workflows/ci.yml의 services.mysql과 migrate deploy 단계를 확인하세요.',
  );
}
