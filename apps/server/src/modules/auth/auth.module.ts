import { randomBytes } from 'node:crypto';
import {
  type MiddlewareConsumer,
  Module,
  type NestModule,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import session from 'express-session';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { RedisModule } from '../../infra/redis/redis.module.js';
import { UserModule } from '../user/user.module.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { FetchGithubClient } from './fetch-github-client.js';
import { GithubClient } from './github-client.js';
import { GithubLoginController } from './github-login.controller.js';
import { GithubLoginService } from './github-login.service.js';
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
  controllers: [AuthController, GithubLoginController],
  providers: [
    AuthService,
    GithubLoginService,
    JwtTokenService,
    // "TokenStore를 달라는 곳에는 RedisTokenStore를 만들어 넣어 준다"는 뜻이다. 시험은 overrideProvider로 InMemoryTokenStore(가짜)를 끼운다.
    { provide: TokenStore, useClass: RedisTokenStore },
    // GitHub에 보내는 요청 세 개. M3-2의 로그인 흐름이 GithubClient로 받아 쓴다. 시험은 가짜를 끼운다.
    { provide: GithubClient, useClass: FetchGithubClient },
    // APP_GUARD라는 이름표로 등록하면 이 가드가 모든 요청에 적용된다(예외 필터의 APP_FILTER와 같은 방식).
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [JwtTokenService],
})
export class AuthModule implements NestModule {
  // 미들웨어는 컨트롤러 앞에서 요청을 먼저 받는 함수다(Express의 app.use와 같다). main.ts가 아니라 모듈에서 걸면 시험 앱에도 적용된다.
  // 로그인 경로 두 개에만 걸어서 다른 요청이 세션을 만들지 않는다.
  // shortcut: 보관소는 기본인 서버 메모리(MemoryStore)다. 옛 Spring 세션도 서버 메모리였다. 서버를 재시작하면 진행 중이던 로그인이
  // 실패하고, 콜백까지 오지 않은 세션은 재시작 전까지 남는다. 서버를 여러 대로 늘리거나 문제가 되면 Redis 보관소로 바꾼다
  // (connect-redis는 ioredis와 맞지 않아 직접 만들어야 한다. improvement-candidates.md 17번).
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(
        session({
          // 세션 쿠키 서명 키. 세션이 메모리에만 있어 재시작하면 어차피 사라지므로 부팅마다 새로 만든다(환경변수가 필요 없다).
          secret: randomBytes(32).toString('hex'),
          resave: false, // 바뀌지 않은 세션은 다시 저장하지 않는다.
          saveUninitialized: false, // 값을 넣은 세션만 저장한다(시작 경로만 state를 넣는다).
          // Secure는 켜지 않는다: 켜면 Nginx 뒤에서 trust proxy 설정이 없을 때 쿠키가 내려가지 않는다. 옛 JSESSIONID도 같았다고 본다.
          // 수명 30분은 옛 Spring 서블릿 세션의 기본값으로 추정한다.
          cookie: { httpOnly: true, sameSite: 'lax', maxAge: 30 * 60 * 1000 },
        }),
      )
      .forRoutes(GithubLoginController);
  }
}
