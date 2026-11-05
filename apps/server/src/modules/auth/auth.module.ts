import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { JwtTokenService } from './jwt-token.service.js';

// 모듈은 관련 부품(provider)을 묶는다. providers에 적으면 Nest가 만들어 관리하고,
// exports에 적은 것만 다른 모듈이 쓸 수 있다.
@Module({
  imports: [
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
  providers: [JwtTokenService],
  exports: [JwtTokenService],
})
export class AuthModule {}
