import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { RedisModule } from '../../infra/redis/redis.module.js';
import { UserModule } from '../user/user.module.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { JwtTokenService } from './jwt-token.service.js';
import { RedisTokenStore } from './redis-token-store.js';
import { TokenStore } from './token-store.js';

// 모듈은 관련 부품(provider)을 묶는다. providers에 적으면 Nest가 만들어 관리하고,
// exports에 적은 것만 다른 모듈이 쓸 수 있다.
@Module({
  imports: [
    // 가드가 UserRepository를 쓴다. 다른 모듈의 부품은 그 모듈을 imports에 적어야 주입받을 수 있다.
    UserModule,
    // RedisTokenStore가 쓰는 Redis 연결(Redis 클래스)을 내주는 모듈.
    RedisModule,
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
  // controllers에 적은 클래스의 라우트가 앱에 붙는다.
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtTokenService,
    // "TokenStore를 달라는 곳에는 RedisTokenStore를 만들어 넣어 준다"는 뜻이다. 시험은 overrideProvider로 InMemoryTokenStore(가짜)를 끼운다.
    { provide: TokenStore, useClass: RedisTokenStore },
    // APP_GUARD라는 이름표로 등록하면 이 가드가 모든 요청에 적용된다(예외 필터의 APP_FILTER와 같은 방식).
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [JwtTokenService],
})
export class AuthModule {}
