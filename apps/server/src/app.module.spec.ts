import { Test } from '@nestjs/testing';
import { AppModule } from './app.module.js';
import { JwtTokenService } from './modules/auth/jwt-token.service.js';
import { InMemoryUserRepository } from './modules/user/in-memory-user.repository.js';
import { UserRepository } from './modules/user/user.repository.js';

describe('AppModule', () => {
  it('환경변수 검증을 포함해 모듈이 조립된다', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    expect(moduleRef).toBeDefined();
    // 생성자 주입이 vitest의 변환에서도 풀리는지(데코레이터 메타데이터) 확인한다.
    expect(moduleRef.get(JwtTokenService)).toBeInstanceOf(JwtTokenService);
    // M4 전까지 기본 구현은 인메모리다(user.module.ts).
    expect(moduleRef.get(UserRepository)).toBeInstanceOf(
      InMemoryUserRepository,
    );
    await moduleRef.close();
  });
});
