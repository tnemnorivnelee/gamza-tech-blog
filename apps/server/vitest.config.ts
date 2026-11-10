import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => ({
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
    env: {
      // 테스트용 가짜 JWT 키. 값을 파일에 적지 않고 실행할 때 계산한다(비밀값 스캐너가 오탐하지 않게).
      JWT_SECRET: Buffer.alloc(32, 'test-only').toString('base64'),
      // 로컬 Redis(yarn dev:local)의 접속 정보만 .env에서 읽는다. 접두사가 REDIS_인 값만 시험에 들어오고 다른 값(COOKIE_DOMAIN 등)은
      // 시험 결과를 바꾸지 못한다. .env가 없으면 빈 객체이고, 그러면 Redis 시험은 127.0.0.1:6379에 연결해 보고 안 되면 건너뛴다.
      // DATABASE_URL은 일부러 넣지 않는다. 개발용 DB에는 복원한 실제 회원 데이터가 있어서, 모든 시험에 주소를 주면 시험 하나가 실수로
      // 기본 저장소(Prisma)를 쓸 때 실제 DB를 건드린다. 진짜 DB 시험(prisma-user.repository.spec.ts)만 .env에서 직접 읽는다.
      // (CI는 일회용 DB라서 환경변수로 준다.)
      ...loadEnv(mode, process.cwd(), 'REDIS_'),
    },
  },
}));
