import { validateEnv } from './env.validation.js';

// 테스트용 가짜 키. 값을 파일에 적지 않고 계산한다.
const SECRET = Buffer.alloc(32, 'a').toString('base64');
const base = { JWT_SECRET: SECRET };

describe('validateEnv', () => {
  it('값이 없으면 기본값을 쓴다', () => {
    expect(validateEnv(base)).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3000,
      ACCESS_TOKEN_TTL_SECONDS: 3600,
      REFRESH_TOKEN_TTL_SECONDS: 2592000,
    });
  });

  it('문자열 PORT를 숫자로 바꾼다', () => {
    expect(validateEnv({ ...base, PORT: '8080' }).PORT).toBe(8080);
  });

  // jsonwebtoken은 숫자 문자열을 밀리초로 읽는다("3600"은 3.6초). 숫자로 바뀌어야 한다.
  it('토큰 수명 문자열을 숫자로 바꾼다', () => {
    const env = validateEnv({
      ...base,
      ACCESS_TOKEN_TTL_SECONDS: '7200',
      REFRESH_TOKEN_TTL_SECONDS: '86400',
    });
    expect(env.ACCESS_TOKEN_TTL_SECONDS).toBe(7200);
    expect(env.REFRESH_TOKEN_TTL_SECONDS).toBe(86400);
  });

  it('OPENAPI_SERVER_URL은 비워 두거나 URL이어야 한다', () => {
    expect(
      validateEnv({ ...base, OPENAPI_SERVER_URL: '' }).OPENAPI_SERVER_URL,
    ).toBeUndefined();
    expect(
      validateEnv({ ...base, OPENAPI_SERVER_URL: 'https://api.example.com' })
        .OPENAPI_SERVER_URL,
    ).toBe('https://api.example.com');
  });

  it('JWT_SECRET은 풀었을 때 32바이트 이상이면 통과한다', () => {
    const longer = Buffer.alloc(48, 'b').toString('base64');
    expect(validateEnv({ JWT_SECRET: longer }).JWT_SECRET).toBe(longer);
  });

  it.each([
    { PORT: 'abc' },
    { PORT: '70000' },
    { PORT: '' },
    { NODE_ENV: 'staging' },
    { OPENAPI_SERVER_URL: 'not a url' },
    { OPENAPI_SERVER_URL: 'api.example.com' },
    { ACCESS_TOKEN_TTL_SECONDS: '0' },
    { ACCESS_TOKEN_TTL_SECONDS: 'abc' },
    { REFRESH_TOKEN_TTL_SECONDS: '3600.5' },
  ])('잘못된 값이면 던진다 %o', (config) => {
    expect(() => validateEnv({ ...base, ...config })).toThrow(
      '환경변수가 올바르지 않습니다',
    );
  });

  it.each([
    ['없음', undefined],
    ['빈 문자열', ''],
    ['Base64가 아님', 'not base64 !!'],
    ['16바이트', Buffer.alloc(16, 'a').toString('base64')],
    // 44자이고 '=='로 끝나서 글자 수만 세면 통과하지만 31바이트다.
    ['31바이트', Buffer.alloc(31, 'a').toString('base64')],
  ])('JWT_SECRET이 %s이면 던진다', (_name, secret) => {
    expect(() => validateEnv({ JWT_SECRET: secret })).toThrow(
      '환경변수가 올바르지 않습니다',
    );
  });

  it('오류 메시지에 비밀값을 싣지 않는다', () => {
    const tooShort = Buffer.alloc(16, 'z').toString('base64');
    let message = '';
    try {
      validateEnv({ JWT_SECRET: tooShort });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('JWT_SECRET');
    expect(message).not.toContain(tooShort);
  });
});
