import { resolveAccessToken } from './access-token.js';

// 옛 JwtTokenValidator.resolveAccessTokenFromCookies와 JwtProvider.resolveAccessToken의 동작을 고정한다.
describe('resolveAccessToken', () => {
  describe('쿠키', () => {
    it.each(['authorization', 'accessToken'])(
      '%s 쿠키의 값을 그대로 쓴다(Bearer를 붙이지 않는다)',
      (name) => {
        expect(resolveAccessToken({ cookie: `${name}=tok-1` })).toBe('tok-1');
      },
    );

    it('다른 이름의 쿠키는 무시한다', () => {
      expect(
        resolveAccessToken({ cookie: 'refreshToken=tok-1; theme=dark' }),
      ).toBeNull();
    });

    it('값에 "="가 들어 있어도 첫 "="까지를 이름으로 본다', () => {
      expect(resolveAccessToken({ cookie: 'authorization=a=b' })).toBe('a=b');
    });

    it('Cookie 헤더에 적힌 순서대로 훑어 첫 번째가 이긴다', () => {
      expect(
        resolveAccessToken({
          cookie: 'accessToken=first; authorization=second',
        }),
      ).toBe('first');
      expect(
        resolveAccessToken({
          cookie: 'authorization=second; accessToken=first',
        }),
      ).toBe('second');
    });

    it('값이 비었거나 공백뿐인 쿠키는 건너뛰고 다음 쿠키를 본다', () => {
      expect(
        resolveAccessToken({ cookie: 'accessToken=; authorization=tok-2' }),
      ).toBe('tok-2');
      expect(
        resolveAccessToken({ cookie: 'accessToken=   ; authorization=tok-2' }),
      ).toBe('tok-2');
    });

    it('쿠키가 모두 비어 있으면 헤더로 넘어간다', () => {
      expect(
        resolveAccessToken({
          cookie: 'authorization=',
          authorization: 'Bearer from-header',
        }),
      ).toBe('from-header');
    });

    it('쿠키가 맞으면 헤더에 다른 토큰이 있어도 쿠키가 이긴다', () => {
      expect(
        resolveAccessToken({
          cookie: 'authorization=from-cookie',
          access: 'Bearer from-access',
          authorization: 'Bearer from-authorization',
        }),
      ).toBe('from-cookie');
    });

    it('쿠키 값에 Bearer가 붙어 있어도 떼지 않는다', () => {
      expect(resolveAccessToken({ cookie: 'authorization=Bearer x' })).toBe(
        'Bearer x',
      );
    });
  });

  describe('헤더', () => {
    it('ACCESS가 Authorization보다 먼저다', () => {
      expect(
        resolveAccessToken({
          access: 'Bearer from-access',
          authorization: 'Bearer from-authorization',
        }),
      ).toBe('from-access');
    });

    it('Authorization만 있어도 된다', () => {
      expect(resolveAccessToken({ authorization: 'Bearer tok-3' })).toBe(
        'tok-3',
      );
    });

    // 두 헤더 모두 "Bearer "가 필요하다. 접두어가 없으면 오류가 아니라 다음 후보로 넘어간다.
    it('ACCESS에 Bearer가 없으면 건너뛰고 Authorization을 본다', () => {
      expect(
        resolveAccessToken({
          access: 'raw-token',
          authorization: 'Bearer from-authorization',
        }),
      ).toBe('from-authorization');
    });

    it.each([
      ['ACCESS에 접두어 없이 토큰만', { access: 'raw-token' }],
      ['Authorization에 접두어 없이 토큰만', { authorization: 'raw-token' }],
      ['소문자 bearer', { authorization: 'bearer tok-3' }],
      ['Basic 방식', { authorization: 'Basic dXNlcjpwdw==' }],
      ['접두어 뒤 공백 없음', { authorization: 'Bearertok-3' }],
      ['헤더 없음', {}],
    ])('%s이면 null이다', (_name, headers) => {
      expect(resolveAccessToken(headers)).toBeNull();
    });

    // 빈 문자열은 null이 아니다. 토큰을 "찾은" 것이라 J004가 아니라 검증 단계의 C005로 간다.
    it('"Bearer " 뒤가 비면 null이 아니라 빈 문자열이다', () => {
      expect(resolveAccessToken({ authorization: 'Bearer ' })).toBe('');
    });
  });
});
