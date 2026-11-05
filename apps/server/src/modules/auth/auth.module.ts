import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { UserModule } from '../user/user.module.js';
import { AuthGuard } from './auth.guard.js';
import { InMemoryTokenStore } from './in-memory-token-store.js';
import { JwtTokenService } from './jwt-token.service.js';
import { TokenStore } from './token-store.js';

// 모듈은 관련 부품(provider)을 묶는다. providers에 적으면 Nest가 만들어 관리하고,
// exports에 적은 것만 다른 모듈이 쓸 수 있다.
@Module({
  imports: [
    // 가드가 UserRepository를 쓴다. 다른 모듈의 부품은 그 모듈을 imports에 적어야 주입받을 수 있다.
    UserModule,
    // JwtModule(토큰 서명·검증 도구)을 설정한다. registerAsync는 ConfigService가 준비된 뒤
    // useFactory를 실행해 설정값을 얻는다. inject에 적은 부품이 useFactory의 인자로 들어온다.
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) => ({
        // 키는 Base64로 푼 바이트를 쓴다(옛 jjwt와 같다).
        secret: Buffer.from(
          config.get('JWT_SECRET', { infer: true }),
          'base64',
        ),
        signOptions: { algorithm: 'HS256' },
        // 기본값은 HS384·HS512로 서명된 토큰도 받는다. 우리가 발급하는 HS256만 받게 제한한다.
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
  ],
  providers: [
    JwtTokenService,
    // "TokenStore를 달라는 곳에는 InMemoryTokenStore를 만들어 넣어 준다"는 뜻이다. M2-4에서 useClass만 Redis 구현으로 바꾼다.
    { provide: TokenStore, useClass: InMemoryTokenStore },
    // APP_GUARD라는 이름표로 등록하면 이 가드가 모든 요청에 적용된다(예외 필터의 APP_FILTER와 같은 방식).
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [JwtTokenService],
})
export class AuthModule {}
