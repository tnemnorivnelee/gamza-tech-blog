import type { IncomingHttpHeaders } from 'node:http';
import { Controller, Headers, Post, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation } from '@nestjs/swagger';
import type { Response } from 'express';
import { ResponseDto } from '../../common/dto/response.dto.js';
import { OkOf, OkString } from '../../common/swagger/api-decorators.js';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import type { User } from '../user/user.repository.js';
import { Public } from './access.decorator.js';
import { expireAuthCookies, setAccessTokenCookie } from './auth-cookie.js';
import { AuthService } from './auth.service.js';
import { resolveAccessTokenFromHeader } from './access-token.js';
import { resolveRefreshToken } from './cookie-header.js';
import { CurrentUser } from './current-user.decorator.js';
import { AccessTokenResponse } from './dto/access-token-response.dto.js';

// @Controller: 이 클래스의 메서드들이 /api/auth 아래 라우트가 된다(프론트의 라우트 파일과 비슷하다).
@Controller('api/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  // @Public: 가드가 토큰을 검사하지 않는다(옛 JwtSkipPathMatcher). 리프레시 쿠키가 신분증 역할을 한다.
  // @Headers(): 요청 헤더 전체를 인자로 받는다. @Res({ passthrough: true })는 쿠키 같은 응답 헤더만 만지고,
  // 본문은 아래에서 return하는 값을 Nest가 보내게 둔다(passthrough가 없으면 직접 res.json()을 불러야 한다).
  @ApiOperation({ summary: '토큰 재발급' })
  @Public()
  @Post('reissue')
  @OkOf(AccessTokenResponse)
  async reissue(
    @Headers() headers: IncomingHttpHeaders,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = resolveRefreshToken(headers);
    // HTTP는 200이고 본문의 status만 401이다(옛 동작). Set-Cookie도 없다. 프론트는 쿠키가 내려와야 성공으로 본다.
    if (refreshToken === null)
      return ResponseDto.of<AccessTokenResponse>(
        '리프레시 토큰이 없습니다.',
        undefined,
        401,
      );

    const accessToken = await this.auth.reissue(refreshToken);
    // 내려가는 쿠키는 authorization 하나뿐이다. 리프레시 쿠키는 다시 내려주지 않는다(옛 동작).
    setAccessTokenCookie(
      res,
      accessToken,
      this.config.get('ACCESS_TOKEN_TTL_SECONDS', { infer: true }),
      this.config.get('COOKIE_DOMAIN', { infer: true }),
    );
    return ResponseDto.of('토큰 재발급 성공', { authorization: accessToken });
  }

  // 기본 규칙(USER, ADMIN 로그인 필요)이라 데코레이터가 없다. 가드가 request.user를 붙여 두고, @CurrentUser()가 꺼낸다.
  @ApiOperation({ summary: '로그아웃' })
  @Post('me/logout')
  @OkString()
  async logout(
    @CurrentUser() user: User,
    @Headers() headers: IncomingHttpHeaders,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.logout(
      user.githubId,
      resolveAccessTokenFromHeader(headers),
    );
    expireAuthCookies(res, this.config.get('COOKIE_DOMAIN', { infer: true }));
    return ResponseDto.of('로그아웃되었습니다.');
  }
}
