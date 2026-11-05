import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode } from '../../common/error/error-code.js';
import { JwtAuthenticationException } from '../../common/error/jwt-authentication.exception.js';
import { UserRepository } from '../user/user.repository.js';
import { resolveAccess } from './access.decorator.js';
import { resolveAccessToken } from './access-token.js';
import type { RequestWithUser } from './current-user.decorator.js';
import { JwtTokenService } from './jwt-token.service.js';
import { TokenStore } from './token-store.js';

// 가드(Guard)는 컨트롤러가 일하기 전에 요청을 검사해서 통과시키거나 막는다. 프론트의 라우트 가드·미들웨어와 같은 자리다.
// AuthModule이 APP_GUARD로 등록해서 모든 라우트에 걸린다. 생성자의 부품은 Nest가 찾아서 넣어 준다.
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtTokenService,
    private readonly tokenStore: TokenStore,
    private readonly users: UserRepository,
  ) {}

  // 순서는 옛 JwtAuthenticationFilter와 같다: 토큰 찾기 → 서명·만료 → 블랙리스트 → 사용자 조회 → role.
  // 가드는 반드시 throw로 막는다. false를 돌려주면 Nest가 ForbiddenException을 만들고, 우리 필터는 그걸 500으로 바꾼다.
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const access = resolveAccess(
      this.reflector,
      context.getHandler(),
      context.getClass(),
    );
    if (access === 'public') return true;

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const token = resolveAccessToken(request.headers);
    if (token === null)
      throw new JwtAuthenticationException(ErrorCode.JWT_NOT_FOUND);

    // 서명 오류·만료·형식 오류는 이유를 가리지 않고 400 C005다(옛 동작).
    const githubId = this.jwt.verify(token);
    if (githubId === null)
      throw new JwtAuthenticationException(ErrorCode.INVALID_TYPE_VALUE);

    // 로그아웃한 토큰이다. 코드가 EXPIRED_JWT(J001)인 것은 옛 동작이다.
    if (await this.tokenStore.isAccessTokenBlacklisted(token))
      throw new JwtAuthenticationException(ErrorCode.EXPIRED_JWT);

    // 토큰에는 role이 없어서 요청마다 저장소에서 읽는다. role이 안 맞을 때도 같은 J005다(D1).
    const user = await this.users.findByGithubId(githubId);
    if (user === undefined || !access.includes(user.role))
      throw new JwtAuthenticationException(ErrorCode.AUTHENTICATION_FAILED);

    request.user = user;
    return true;
  }
}
