import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
    // 테스트용 가짜 JWT 키. 값을 파일에 적지 않고 실행할 때 계산한다(비밀값 스캐너가 오탐하지 않게).
    env: { JWT_SECRET: Buffer.alloc(32, 'test-only').toString('base64') },
  },
});
