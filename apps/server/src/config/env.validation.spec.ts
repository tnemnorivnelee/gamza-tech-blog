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

  it.each([
    { PORT: 'abc' },
    { PORT: '70000' },
    { PORT: '' },
    { NODE_ENV: 'staging' },
  ])('잘못된 값이면 던진다 %o', (config) => {
    expect(() => validateEnv(config)).toThrow('환경변수가 올바르지 않습니다');
  });
});
