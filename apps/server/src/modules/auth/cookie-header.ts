import type { IncomingHttpHeaders } from 'node:http';

// 브라우저의 document.cookie처럼 "a=1; b=2" 문자열인 Cookie 헤더를 [이름, 값] 쌍으로 나눈다. 헤더에 적힌 순서대로다.
// 앞뒤 공백만 떼고 값은 그대로 둔다(Bearer를 떼거나 URL 디코딩을 하지 않는다). "="가 없는 조각은 건너뛴다.
// 쿠키 객체로 바꿔 주는 라이브러리는 순서와 같은 이름의 쿠키를 잃어서 쓰지 않았다(m2-auth-plan.md D6).
export function* cookiePairs(
  cookieHeader: string | undefined,
): Generator<[name: string, value: string]> {
  for (const pair of cookieHeader?.split(';') ?? []) {
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    yield [pair.slice(0, eq).trim(), pair.slice(eq + 1).trim()];
  }
}

// refreshToken 쿠키의 값을 그대로 돌려준다. 없으면 null이다.
// 같은 이름이 여럿이면 먼저 나온 것이고, 값이 비어 있어도 그 빈 문자열을 돌려준다.
// 옛 @CookieValue("refreshToken", required = false)와 같다고 추정한다 [추정]: 빈 값은 "쿠키 없음"이 아니라 Redis에 없는 토큰이 된다.
export function resolveRefreshToken(
  headers: IncomingHttpHeaders,
): string | null {
  for (const [name, value] of cookiePairs(headers.cookie)) {
    if (name === 'refreshToken') return value;
  }
  return null;
}
