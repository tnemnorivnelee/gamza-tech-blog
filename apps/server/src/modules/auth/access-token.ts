import type { IncomingHttpHeaders } from 'node:http';

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

// 브라우저의 document.cookie처럼 "a=1; b=2" 문자열이다. Cookie 헤더에 적힌 순서대로 훑어서,
// 이름이 accessToken 또는 authorization이고 값이 비어 있지 않은 첫 쿠키의 값을 돌려준다(옛 동작).
// 쿠키 객체로 바꿔 주는 라이브러리는 이 순서와 빈 값 건너뛰기를 잃어서 쓰지 않았다.
function readCookieToken(cookieHeader: string | undefined): string | null {
  for (const pair of cookieHeader?.split(';') ?? []) {
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
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
