import type { IncomingHttpHeaders } from 'node:http';
import { cookiePairs } from './cookie-header.js';

const BEARER_PREFIX = 'Bearer ';
const COOKIE_NAMES = ['accessToken', 'authorization'];

// 요청에서 액세스 토큰을 찾는다. 없으면 null. 옛 JwtTokenValidator·JwtProvider와 같은 순서다.
// 쿠키(값 그대로) → 헤더 ACCESS → 헤더 Authorization. 헤더 값은 둘 다 "Bearer "로 시작해야 한다.
// 쿠키가 하나라도 맞으면 헤더에 다른 토큰이 있어도 쿠키가 이긴다.
export function resolveAccessToken(
  headers: IncomingHttpHeaders,
): string | null {
  return (
    readCookieToken(headers.cookie) ??
    fromBearer(headers['access']) ??
    fromBearer(headers.authorization)
  );
}

// Cookie 헤더를 훑어서, 이름이 accessToken 또는 authorization이고 값이 비어 있지 않은 첫 쿠키의 값을 돌려준다(옛 동작).
// 빈 값은 건너뛰고 계속 본다. refreshToken 쿠키는 이 규칙을 쓰지 않는다(cookie-header.ts).
function readCookieToken(cookieHeader: string | undefined): string | null {
  for (const [name, value] of cookiePairs(cookieHeader)) {
    if (COOKIE_NAMES.includes(name) && value !== '') return value;
  }
  return null;
}

// "Bearer "로 시작하지 않으면 null이라 다음 후보로 넘어간다. 대소문자를 구분한다(옛 동작).
// "Bearer " 뒤가 비어 있으면 빈 문자열이 나가고, 이는 null이 아니라서 검증 단계에서 C005가 된다.
function fromBearer(value: string | string[] | undefined): string | null {
  return typeof value === 'string' && value.startsWith(BEARER_PREFIX)
    ? value.slice(BEARER_PREFIX.length)
    : null;
}

// 로그아웃이 블랙리스트에 올릴 토큰. 가드의 resolveAccessToken과 읽는 방식이 다르다(옛 resolveAccessTokenFromHeader):
// 쿠키는 보지 않고, ACCESS 헤더가 있으면 그 값 하나만 골라서 "Bearer " 검사를 한다.
// 그래서 ACCESS가 접두어 없이 오면 Authorization에 유효한 토큰이 있어도 null이고, 아무것도 블랙리스트에 오르지 않는다.
// ('' 도 값이 있는 헤더라서 ??가 넘어가지 않는다. 옛 Optional.ofNullable("")과 같다.)
export function resolveAccessTokenFromHeader(
  headers: IncomingHttpHeaders,
): string | null {
  return fromBearer(headers['access'] ?? headers.authorization);
}
