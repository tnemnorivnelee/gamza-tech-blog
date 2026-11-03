import { validateEnv } from './env.validation.js';

describe('validateEnv', () => {
  it('값이 없으면 기본값을 쓴다', () => {
    expect(validateEnv({})).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3000,
    });
  });

  it('문자열 PORT를 숫자로 바꾼다', () => {
    expect(validateEnv({ PORT: '8080' }).PORT).toBe(8080);
  });

  it('OPENAPI_SERVER_URL은 비워 두거나 URL이어야 한다', () => {
    expect(
      validateEnv({ OPENAPI_SERVER_URL: '' }).OPENAPI_SERVER_URL,
    ).toBeUndefined();
    expect(
      validateEnv({ OPENAPI_SERVER_URL: 'https://api.example.com' })
        .OPENAPI_SERVER_URL,
    ).toBe('https://api.example.com');
  });

  it.each([
    { PORT: 'abc' },
    { PORT: '70000' },
    { PORT: '' },
    { NODE_ENV: 'staging' },
    { OPENAPI_SERVER_URL: 'not a url' },
    { OPENAPI_SERVER_URL: 'api.example.com' },
  ])('잘못된 값이면 던진다 %o', (config) => {
    expect(() => validateEnv(config)).toThrow('환경변수가 올바르지 않습니다');
  });
});
