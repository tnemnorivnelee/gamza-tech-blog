import type { CookieOptions, Response } from 'express';

// 옛 CookieUtils와 같은 속성이다. 쿠키 속성은 만들 때와 지울 때가 같아야 브라우저가 같은 쿠키로 보고 지운다.
// Secure는 항상 켠다(로컬 http://localhost에서도 옛 동작 그대로). domain이 undefined이면 Domain 속성이 빠진다.
const ACCESS_COOKIE = 'authorization';
const REFRESH_COOKIE = 'refreshToken';

// 프론트가 읽어야 해서 HttpOnly가 아니다. 다른 사이트에서 오는 요청에는 보내지 않는다(Lax).
const accessCookieOptions = (domain?: string): CookieOptions => ({
  domain,
  path: '/',
  httpOnly: false,
  secure: true,
  sameSite: 'lax',
});

// 자바스크립트가 못 읽는다(HttpOnly). 프론트와 API 도메인이 달라도 보내려고 None이다.
const refreshCookieOptions = (domain?: string): CookieOptions => ({
  domain,
  path: '/',
  httpOnly: true,
  secure: true,
  sameSite: 'none',
});

// res.cookie는 Set-Cookie 헤더를 붙인다. Express의 maxAge는 밀리초이고 헤더에는 초(Max-Age)로 나간다.
export function setAccessTokenCookie(
  res: Response,
  token: string,
  ttlSeconds: number,
  domain?: string,
): void {
  res.cookie(ACCESS_COOKIE, token, {
    ...accessCookieOptions(domain),
    maxAge: ttlSeconds * 1000,
  });
}

// 로그인에서만 내려준다. reissue는 리프레시 쿠키를 다시 내려주지 않는다(옛 동작). 속성은 만료시킬 때와 같다.
export function setRefreshTokenCookie(
  res: Response,
  token: string,
  ttlSeconds: number,
  domain?: string,
): void {
  res.cookie(REFRESH_COOKIE, token, {
    ...refreshCookieOptions(domain),
    maxAge: ttlSeconds * 1000,
  });
}

// 두 쿠키를 Max-Age=0으로 만료시킨다. res.clearCookie는 Express 5에서 maxAge를 무시하고 Expires만 보내서(옛 서버는 Max-Age=0) 쓰지 않았다.
export function expireAuthCookies(res: Response, domain?: string): void {
  res.cookie(ACCESS_COOKIE, '', { ...accessCookieOptions(domain), maxAge: 0 });
  res.cookie(REFRESH_COOKIE, '', {
    ...refreshCookieOptions(domain),
    maxAge: 0,
  });
}
