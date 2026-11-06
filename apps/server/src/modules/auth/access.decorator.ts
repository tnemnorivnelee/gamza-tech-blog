import { type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { UserRole } from '../user/user.repository.js';

// 데코레이터(@Public, @Roles)는 컨트롤러나 메서드에 "꼬리표(metadata)"를 붙일 뿐이다.
// 꼬리표를 읽고 판단하는 쪽은 가드다. 프론트의 라우트 meta(예: meta.requiresAuth)와 같다.
const IS_PUBLIC_KEY = 'isPublic';
const ROLES_KEY = 'roles';

// 꼬리표가 없을 때의 기본값. 옛 SecurityConfig의 anyRequest().hasAnyRole(USER, ADMIN)이다.
export const DEFAULT_ROLES: readonly UserRole[] = ['USER', 'ADMIN'];

// 'public'은 토큰 검사를 건너뛴다. 역할 목록이면 로그인한 사용자의 role이 그 안에 있어야 한다.
export type Access = 'public' | readonly UserRole[];

// 토큰 검사를 건너뛴다. 토큰이 있어도 사용자 정보를 붙이지 않는다(옛 JwtSkipPathMatcher).
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

// 허용할 role을 기본값(USER, ADMIN) 대신 이 목록으로 바꾼다.
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

// 꼬리표를 읽을 대상(메서드 또는 클래스). Nest가 getHandler()로 주는 함수 타입이다.
type Target = ReturnType<ExecutionContext['getHandler']>;

// 메서드와 클래스에 붙은 꼬리표를 읽어 이 라우트의 접근 규칙을 정한다. @Roles는 메서드 쪽이 클래스보다 우선한다.
// 주의: @Public은 어디에 붙었든 이긴다. 클래스에 @Public이 있으면 메서드에 @Roles를 붙여도 공개다(꼬리표를 "끄는" 방법이 없다).
// 가드와 접근 규칙 표 시험이 같은 함수를 쓴다. 규칙을 읽는 방식이 둘로 갈라지지 않게 하려는 것이다.
export function resolveAccess(
  reflector: Reflector,
  handler: Target,
  controllerClass: Target,
): Access {
  const targets = [handler, controllerClass];
  if (reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, targets))
    return 'public';
  return (
    reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, targets) ??
    DEFAULT_ROLES
  );
}
