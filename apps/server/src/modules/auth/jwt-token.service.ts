import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { EnvironmentVariables } from '../../config/env.validation.js';

// 모든 토큰의 sub(발급처 표시)가 이 고정 문자열이다(옛 JwtProvider와 같다).
const TOKEN_SUBJECT = 'GamjaTech';

// @Injectable: Nest가 이 클래스를 만들어 필요한 곳에 넣어 준다(의존성 주입).
// 생성자의 타입(JwtService, ConfigService)을 보고 알아서 넣어 주므로 new로 직접 만들지 않는다.
// 액세스·리프레시 토큰은 같은 방식으로 만들고 수명만 다르다. role은 토큰에 없고 요청마다 DB에서 읽는다.
@Injectable()
export class JwtTokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  createAccessToken(githubId: string): string {
    return this.sign(
      githubId,
      this.config.get('ACCESS_TOKEN_TTL_SECONDS', { infer: true }),
    );
  }

  createRefreshToken(githubId: string): string {
    return this.sign(
      githubId,
      this.config.get('REFRESH_TOKEN_TTL_SECONDS', { infer: true }),
    );
  }

  // 진짜이고 만료 전인 토큰이면 githubId를, 아니면 null을 돌려준다. 실패 이유는 나누지 않는다(옛 validateAccessToken).
  // 옛 코드처럼 sub는 확인하지 않는다(improvement-candidates.md 8번).
  verify(token: string): string | null {
    try {
      // 서명이 틀리거나 만료되면 jwt.verify가 예외를 던진다. 아래 catch가 null로 바꾼다.
      const payload = this.jwt.verify<{ githubId?: unknown; exp?: unknown }>(
        token,
        { algorithms: ['HS256'] },
      );
      // 서명이 맞아도 exp가 없는 토큰은 통과하므로 직접 확인한다. githubId도 문자열이어야 쓸 수 있다.
      if (
        typeof payload.githubId !== 'string' ||
        typeof payload.exp !== 'number'
      ) {
        return null;
      }
      return payload.githubId;
    } catch {
      return null;
    }
  }

  private sign(githubId: string, ttlSeconds: number): string {
    // expiresIn은 숫자면 초다(숫자 문자열은 밀리초로 읽힌다). jwtid는 토큰마다 다른 발급 번호다.
    return this.jwt.sign(
      { githubId },
      { subject: TOKEN_SUBJECT, jwtid: randomUUID(), expiresIn: ttlSeconds },
    );
  }
}
