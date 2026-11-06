import { cookiePairs, resolveRefreshToken } from './cookie-header.js';

describe('cookiePairs', () => {
  it('헤더에 적힌 순서대로 [이름, 값]을 돌려주고 앞뒤 공백을 뗀다', () => {
    expect([...cookiePairs('a=1;  b = 2 ;c=3')]).toEqual([
      ['a', '1'],
      ['b', '2'],
      ['c', '3'],
    ]);
  });

  it('값에 "="가 있으면 첫 "="까지가 이름이다', () => {
    expect([...cookiePairs('a=b=c')]).toEqual([['a', 'b=c']]);
  });

  it('"="가 없는 조각과 헤더 없음은 건너뛴다', () => {
    expect([...cookiePairs('junk; a=1')]).toEqual([['a', '1']]);
    expect([...cookiePairs(undefined)]).toEqual([]);
  });

  it('값을 디코딩하거나 따옴표를 떼지 않는다', () => {
    expect([...cookiePairs('a=%7Bx%7D; b="q"')]).toEqual([
      ['a', '%7Bx%7D'],
      ['b', '"q"'],
    ]);
  });
});

describe('resolveRefreshToken', () => {
  it('refreshToken 쿠키의 값을 그대로 돌려준다(Bearer를 떼지 않는다)', () => {
    expect(resolveRefreshToken({ cookie: 'refreshToken=tok-1' })).toBe('tok-1');
    expect(resolveRefreshToken({ cookie: 'refreshToken=Bearer tok-1' })).toBe(
      'Bearer tok-1',
    );
  });

  it('다른 쿠키 사이에 있어도 찾는다', () => {
    expect(
      resolveRefreshToken({ cookie: 'theme=dark; refreshToken=tok-1; a=b' }),
    ).toBe('tok-1');
  });

  it('쿠키가 없으면 null이다. 이름이 비슷한 쿠키는 다른 쿠키다', () => {
    expect(resolveRefreshToken({})).toBeNull();
    expect(resolveRefreshToken({ cookie: 'theme=dark' })).toBeNull();
    expect(resolveRefreshToken({ cookie: 'refreshtoken=tok-1' })).toBeNull();
    expect(resolveRefreshToken({ cookie: 'authorization=tok-1' })).toBeNull();
  });

  it('같은 이름이 여럿이면 먼저 나온 것이다', () => {
    expect(
      resolveRefreshToken({
        cookie: 'refreshToken=first; refreshToken=second',
      }),
    ).toBe('first');
  });

  // 액세스 쿠키는 빈 값을 건너뛰지만 이쪽은 건너뛰지 않는다. 빈 값은 Redis 조회로 가서 403 J004가 된다 [추정].
  it('값이 비어 있으면 null이 아니라 빈 문자열이다', () => {
    expect(resolveRefreshToken({ cookie: 'refreshToken=' })).toBe('');
    expect(
      resolveRefreshToken({ cookie: 'refreshToken=; refreshToken=second' }),
    ).toBe('');
  });
});
