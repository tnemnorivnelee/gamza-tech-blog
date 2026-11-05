import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { EnvironmentVariables } from '../../config/env.validation.js';

// 옛 JwtProvider.TOKEN_SUBJECT. 모든 토큰의 sub가 이 고정 문자열이다.
const TOKEN_SUBJECT = 'GamjaTech';

// 옛 JwtProvider. 액세스·리프레시 토큰은 수명만 다르고 같은 방식으로 만든다.
// 클레임: sub(고정), githubId, jti(UUID), iat, exp. role은 토큰에 없고 요청마다 DB에서 읽는다.
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

  // 토큰을 검증하고 githubId를 돌려준다. 실패는 전부 null이다.
  // 옛 JwtProvider.validateAccessToken은 만료·서명 오류·형식 오류를 구분하지 않고 false만 돌려줬고,
  // 가드(M2-2)가 그것을 400 C005(INVALID_TYPE_VALUE)로 바꾼다. 그래서 여기서도 이유를 나누지 않는다.
  // 옛 코드처럼 sub는 확인하지 않는다(improvement-candidates.md 8번).
  verify(token: string): string | null {
    try {
      const payload = this.jwt.verify<{ githubId?: unknown; exp?: unknown }>(
        token,
        { algorithms: ['HS256'] },
      );
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
    // expiresIn은 숫자면 초다. 숫자 문자열("3600")은 밀리초로 읽히므로 환경변수 검증이 숫자로 바꿔 준다.
    return this.jwt.sign(
      { githubId },
      { subject: TOKEN_SUBJECT, jwtid: randomUUID(), expiresIn: ttlSeconds },
    );
  }
}
