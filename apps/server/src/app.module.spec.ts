import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import { AppModule } from './app.module.js';
import { FetchGithubClient } from './modules/auth/fetch-github-client.js';
import { GithubClient } from './modules/auth/github-client.js';
import { JwtTokenService } from './modules/auth/jwt-token.service.js';
import { RedisTokenStore } from './modules/auth/redis-token-store.js';
import { TokenStore } from './modules/auth/token-store.js';
import { PrismaUserRepository } from './modules/user/prisma-user.repository.js';
import { UserRepository } from './modules/user/user.repository.js';

describe('AppModule', () => {
  it('환경변수 검증을 포함해 모듈이 조립된다', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    expect(moduleRef).toBeDefined();
    // 생성자 주입이 vitest의 변환에서도 풀리는지(데코레이터 메타데이터) 확인한다.
    expect(moduleRef.get(JwtTokenService)).toBeInstanceOf(JwtTokenService);
    // 사용자 저장소의 기본 구현은 Prisma다(user.module.ts). 연결은 첫 쿼리 때 열려서 DB 없이도 조립된다.
    expect(moduleRef.get(UserRepository)).toBeInstanceOf(PrismaUserRepository);
    // 토큰 저장소는 Redis 구현이다(auth.module.ts).
    expect(moduleRef.get(TokenStore)).toBeInstanceOf(RedisTokenStore);
    // GitHub 요청 클라이언트는 fetch 구현이다(auth.module.ts). 환경변수가 비어 있어도 만들어지고, 부를 때 막힌다.
    expect(moduleRef.get(GithubClient)).toBeInstanceOf(FetchGithubClient);
    // 연결은 첫 명령을 보낼 때 열린다(lazyConnect). 그래서 이 시험은 Redis 없이도 끝나고, 앱을 닫으면 연결 객체도 끝난다.
    const redis = moduleRef.get(Redis);
    expect(redis.status).toBe('wait');
    await moduleRef.close();
    expect(redis.status).toBe('end');
  });
});
