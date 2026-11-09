import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Controller, Get, Logger, Query, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { Public } from './access.decorator.js';
import { setAccessTokenCookie, setRefreshTokenCookie } from './auth-cookie.js';
import { GithubLoginService } from './github-login.service.js';

// 세션에 넣어 두는 값의 이름과 타입을 알려 준다(req.session.oauthState를 타입 오류 없이 쓰려는 것이다).
declare module 'express-session' {
  interface SessionData {
    oauthState?: string;
  }
}

// 실패하면 가는 곳. 옛 Spring의 기본 실패 주소(loginPage + "?error")로 추정한다. 이 주소는 시작 경로와 같아서 다시 GitHub로 이어진다
// (improvement-candidates.md 15번).
const FAILURE_URL = '/oauth2/authorization/github?error';

// 두 값이 같은지 본다. 일반 비교(===)는 다른 글자를 만나는 순간 끝나서 응답 시간으로 값을 짐작할 수 있다.
// timingSafeEqual은 길이가 다르면 던지므로 길이를 먼저 본다.
function sameState(expected: string | undefined, actual: string): boolean {
  if (expected === undefined) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}

// 옛 Spring Security의 oauth2Login이 맡던 두 경로다. 컨트롤러가 아니라 필터가 처리해서 OpenAPI 명세에 없었다.
// @ApiExcludeController: 명세(Swagger 문서)에서 이 컨트롤러를 뺀다(프론트의 생성 클라이언트에 없는 경로다).
// @Public: 토큰 없이 부른다(로그인하러 오는 사람은 토큰이 없다). 경로 앞 /api가 없는 것도 옛 주소 그대로다.
// 세션 미들웨어는 AuthModule.configure에서 이 컨트롤러의 두 경로에만 걸린다.
@ApiExcludeController()
@Public()
@Controller()
export class GithubLoginController {
  private readonly logger = new Logger(GithubLoginController.name);

  constructor(
    private readonly githubLogin: GithubLoginService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  // 1단계: state(위조 방지 값)를 만들어 세션에 넣고 GitHub 승인 화면으로 보낸다.
  // @Res()를 받으면 응답을 직접 보내야 한다(여기서는 res.redirect). 설정이 빠져 던지면 필터가 500으로 바꾼다.
  // 되돌리는 주소가 이 경로 자신이라서, 실패를 되돌리기로 처리하면 무한 이동이 되기 때문에 던지게 둔다.
  @Get('oauth2/authorization/github')
  start(@Req() req: Request, @Res() res: Response): void {
    const state = randomBytes(32).toString('base64url');
    // 주소를 먼저 만든다. 설정이 빠져 던지는 요청이 세션만 만들고 끝나지 않게 한다.
    const url = this.githubLogin.authorizationUrl(state);
    req.session.oauthState = state;
    res.redirect(url);
  }

  // 2단계: GitHub가 code와 state를 붙여 돌려보낸다. 확인이 모두 맞으면 로그인을 마치고 쿠키를 심어 프론트로 보낸다.
  // @Query(): 주소 뒤의 ?a=b를 객체로 받는다. 값 타입을 믿지 않고 아래에서 확인한다.
  @Get('login/oauth2/code/github')
  async callback(
    @Req() req: Request,
    @Res() res: Response,
    @Query() query: Record<string, unknown>,
  ): Promise<void> {
    const expectedState = req.session.oauthState;
    // 성공이든 실패든 한 번 쓴 state는 지운다(옛 Spring도 승인 요청을 꺼내면서 세션에서 지웠다).
    await new Promise<void>((resolve) => req.session.destroy(() => resolve()));

    try {
      // 사용자가 승인을 취소하면 GitHub가 code 없이 ?error=access_denied로 돌려보낸다.
      if (query.error !== undefined) {
        throw new Error('GitHub가 로그인을 승인하지 않았습니다');
      }
      const { code, state } = query;
      if (typeof code !== 'string' || typeof state !== 'string' || !code) {
        throw new Error('code 또는 state가 없습니다');
      }
      if (!sameState(expectedState, state)) {
        throw new Error('state가 맞지 않습니다');
      }

      const { accessToken, refreshToken } = await this.githubLogin.login(code);
      const domain = this.config.get('COOKIE_DOMAIN', { infer: true });
      setAccessTokenCookie(
        res,
        accessToken,
        this.config.get('ACCESS_TOKEN_TTL_SECONDS', { infer: true }),
        domain,
      );
      setRefreshTokenCookie(
        res,
        refreshToken,
        this.config.get('REFRESH_TOKEN_TTL_SECONDS', { infer: true }),
        domain,
      );
      res.redirect(this.githubLogin.redirectUrl(query.location));
    } catch (error) {
      // 원인은 로그에만 남긴다. code, state, 토큰은 오류 메시지에 들어 있지 않다.
      this.logger.warn(
        `GitHub 로그인 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
      res.redirect(FAILURE_URL);
    }
  }
}
