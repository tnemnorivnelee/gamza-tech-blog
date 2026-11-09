import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { UserRepository } from '../user/user.repository.js';
import { GithubClient } from './github-client.js';
import { JwtTokenService } from './jwt-token.service.js';
import { TokenStore } from './token-store.js';

const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';

// 승인 화면에서 요구할 권한. 옛 설정값은 암호문이라 읽지 못했고, 코드에 남은 상수 GithubUser.GITHUB_OAUTH_SCOPES를 따른다
// (m3-github-login-plan.md D5).
const SCOPES = ['read:user', 'user:email', 'repo'];

// 옛 Spring의 oauth2Login이 하던 일 중 우리 코드로 옮긴 부분과 OAuth2LoginSuccessHandler의 로그인 처리를 맡는다.
// HTTP(세션, 쿠키, 이동)는 컨트롤러가 하고, 여기는 "무엇을 할지"만 있다.
@Injectable()
export class GithubLoginService {
  constructor(
    private readonly github: GithubClient,
    private readonly users: UserRepository,
    private readonly jwt: JwtTokenService,
    private readonly tokens: TokenStore,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  // GitHub 승인 화면 주소. 매개변수 순서도 Spring이 만들던 주소와 같다.
  authorizationUrl(state: string): string {
    const clientId = this.config.get('GITHUB_CLIENT_ID', { infer: true });
    const redirectUri = this.config.get('GITHUB_REDIRECT_URI', {
      infer: true,
    });
    // 운영이 아니면 비워 둘 수 있다. 비어 있는 채로 부르면 잘못된 주소로 보내지 않고 여기서 막는다.
    if (!clientId || !redirectUri) {
      throw new Error('GitHub OAuth 환경변수(GITHUB_*)가 설정되지 않았습니다');
    }
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      scope: SCOPES.join(' '),
      state,
      redirect_uri: redirectUri,
    });
    return `${AUTHORIZE_URL}?${query.toString()}`;
  }

  // 승인 화면에서 돌아온 code로 로그인을 마친다(옛 OAuth2LoginSuccessHandler 순서 그대로):
  // 사용자 만들기 → 액세스·리프레시 토큰 발급 → 리프레시 토큰 교체. GitHub 호출이 실패하면 던진다.
  async login(
    code: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const githubToken = await this.github.exchangeCode(code);
    const profile = await this.github.fetchProfile(githubToken);
    const githubId = `g_${profile.id}`;

    // 처음 온 사용자만 PRE_REGISTER로 만든다. 이미 있으면 이름·이메일을 포함해 아무것도 바꾸지 않는다(옛 registerIfNewUser).
    if (!(await this.users.findByGithubId(githubId))) {
      await this.users.create({
        githubId,
        role: 'PRE_REGISTER',
        name: profile.name ?? profile.login,
        nickname: profile.login,
        email: profile.email,
      });
    }

    const accessToken = this.jwt.createAccessToken(githubId);
    const refreshToken = this.jwt.createRefreshToken(githubId);
    await this.tokens.rotateRefreshToken(
      githubId,
      refreshToken,
      this.config.get('REFRESH_TOKEN_TTL_SECONDS', { infer: true }),
    );
    return { accessToken, refreshToken };
  }

  // 로그인 뒤 프론트로 보낼 주소(옛 resolveRedirectUrl). location은 앞뒤 공백을 떼고 소문자로 바꿔서 허용 목록에 있으면 쓰고,
  // 없거나 목록 밖이면 기본값을 쓴다. 같은 이름이 여러 번 오면 첫 값을 본다(Spring의 getParameter와 같다).
  redirectUrl(location: unknown): string {
    const first: unknown = Array.isArray(location) ? location[0] : location;
    const requested =
      typeof first === 'string' ? first.trim().toLowerCase() : undefined;
    const allowed = this.config.get('OAUTH_ALLOWED_LOCATIONS', { infer: true });
    const chosen =
      requested !== undefined && allowed.includes(requested)
        ? requested
        : this.config.get('OAUTH_DEFAULT_LOCATION', { infer: true });
    return `https://${chosen}.${this.config.get('OAUTH_REDIRECT_DOMAIN_SUFFIX', { infer: true })}`;
  }
}
