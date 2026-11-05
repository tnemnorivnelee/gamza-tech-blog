import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { JwtTokenService } from './jwt-token.service.js';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) => ({
        // 옛 jjwt가 Base64로 푼 바이트를 키로 썼다.
        secret: Buffer.from(
          config.get('JWT_SECRET', { infer: true }),
          'base64',
        ),
        signOptions: { algorithm: 'HS256' },
        // 기본값은 HS256·HS384·HS512를 모두 받는다. 우리가 발급하는 알고리즘만 받는다.
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
  ],
  providers: [JwtTokenService],
  exports: [JwtTokenService],
})
export class AuthModule {}
