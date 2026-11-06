import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BusinessException } from '../../common/error/business.exception.js';
import { ErrorCode } from '../../common/error/error-code.js';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { JwtTokenService } from './jwt-token.service.js';
import { TokenStore } from './token-store.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly jwt: JwtTokenService,
    private readonly tokenStore: TokenStore,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  // 리프레시 토큰으로 새 액세스 토큰을 받는다. 리프레시 JWT는 검증하지 않고 저장소에 있는지만 본다(옛 동작).
  // 사용자가 아직 DB에 있는지도 보지 않는다. 늘어나는 것은 refresh:<토큰> 키의 만료뿐이고, 리프레시 토큰은 그대로다.
  async reissue(refreshToken: string): Promise<string> {
    const githubId =
      await this.tokenStore.findGithubIdByRefreshToken(refreshToken);
    if (githubId === undefined)
      throw new BusinessException(ErrorCode.JWT_NOT_FOUND);

    const accessToken = this.jwt.createAccessToken(githubId);
    await this.tokenStore.extendRefreshToken(
      refreshToken,
      this.config.get('REFRESH_TOKEN_TTL_SECONDS', { infer: true }),
    );
    return accessToken;
  }

  // 순서는 옛 BlacklistServiceImpl과 같다: 리프레시 토큰 삭제 → 남은 수명 계산 → 블랙리스트 등록.
  // 헤더 토큰이 만료됐거나 위조면 remainingSeconds가 던진다. 그 앞의 삭제는 이미 끝난 뒤다(옛 동작, improvement-candidates.md 11번).
  async logout(githubId: string, headerAccessToken: string | null) {
    await this.tokenStore.removeRefreshTokens(githubId);
    if (headerAccessToken !== null) {
      await this.tokenStore.blacklistAccessToken(
        headerAccessToken,
        this.jwt.remainingSeconds(headerAccessToken),
      );
    }
  }
}
