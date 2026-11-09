import { validateEnv } from './env.validation.js';

// 테스트용 가짜 키. 값을 파일에 적지 않고 계산한다.
const SECRET = Buffer.alloc(32, 'a').toString('base64');
const base = { JWT_SECRET: SECRET };
// 운영에서는 GitHub OAuth 앱 정보도 필수다. 시험용 가짜 값이고, 비밀값은 파일에 적지 않고 계산한다.
const github = {
  GITHUB_CLIENT_ID: 'test-client-id',
  GITHUB_CLIENT_SECRET: Buffer.alloc(8, 's').toString('hex'),
  GITHUB_REDIRECT_URI: 'http://localhost:3000/login/oauth2/code/github',
};

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

  describe('COOKIE_DOMAIN', () => {
    it('개발에서는 비워 둬도 된다(Domain 속성을 생략한다)', () => {
      expect(validateEnv(base).COOKIE_DOMAIN).toBeUndefined();
      expect(
        validateEnv({ ...base, COOKIE_DOMAIN: '' }).COOKIE_DOMAIN,
      ).toBeUndefined();
    });

    it.each(['.gamza.xyz', 'gamza.xyz', 'localhost'])(
      '도메인 모양이면 통과한다 %s',
      (domain) => {
        expect(
          validateEnv({ ...base, COOKIE_DOMAIN: domain }).COOKIE_DOMAIN,
        ).toBe(domain);
      },
    );

    it('운영에서는 필수다. 없거나 비어 있으면 던진다', () => {
      const prod = { ...base, ...github, NODE_ENV: 'production' };
      expect(() => validateEnv(prod)).toThrow('COOKIE_DOMAIN');
      expect(() => validateEnv({ ...prod, COOKIE_DOMAIN: '' })).toThrow(
        'COOKIE_DOMAIN',
      );
      expect(
        validateEnv({ ...prod, COOKIE_DOMAIN: '.gamza.xyz' }).COOKIE_DOMAIN,
      ).toBe('.gamza.xyz');
    });

    // 틀린 값은 부팅이 아니라 요청마다 쿠키를 만들 때 터지므로 값이 있으면 개발에서도 막는다.
    it.each(['gamza xyz', 'gamza.xyz;Path=/', 'https://gamza.xyz', 'a..b'])(
      '도메인 모양이 아니면 던진다 %s',
      (domain) => {
        expect(() => validateEnv({ ...base, COOKIE_DOMAIN: domain })).toThrow(
          'COOKIE_DOMAIN',
        );
      },
    );
  });

  describe('REDIS_*', () => {
    // 로컬 Compose는 127.0.0.1(IPv4)에만 연다. 기본값이 localhost면 ::1로 풀려 거부당할 수 있다.
    it('없으면 로컬 Compose 주소를 쓰고, 비밀번호는 비어 있다', () => {
      expect(validateEnv(base)).toMatchObject({
        REDIS_HOST: '127.0.0.1',
        REDIS_PORT: 6379,
      });
      expect(validateEnv(base).REDIS_PASSWORD).toBeUndefined();
    });

    it('값을 주면 쓴다. 포트 문자열은 숫자로 바뀌고 빈 비밀번호는 없는 것이다', () => {
      const password = Buffer.alloc(8, 'p').toString('hex'); // 시험용 가짜 값. 파일에 적지 않고 계산한다.
      const env = validateEnv({
        ...base,
        REDIS_HOST: 'redis.internal',
        REDIS_PORT: '6380',
        REDIS_PASSWORD: password,
      });
      expect(env).toMatchObject({
        REDIS_HOST: 'redis.internal',
        REDIS_PORT: 6380,
        REDIS_PASSWORD: password,
      });
      expect(
        validateEnv({ ...base, REDIS_PASSWORD: '' }).REDIS_PASSWORD,
      ).toBeUndefined();
    });

    it.each([
      { REDIS_HOST: '' },
      { REDIS_PORT: 'abc' },
      { REDIS_PORT: '0' },
      { REDIS_PORT: '70000' },
    ])('잘못된 값이면 던진다 %o', (config) => {
      expect(() => validateEnv({ ...base, ...config })).toThrow(
        '환경변수가 올바르지 않습니다',
      );
    });
  });

  describe('GITHUB_*', () => {
    it('개발에서는 비워 둬도 된다(OAuth 앱 없이도 서버가 뜬다)', () => {
      const env = validateEnv(base);
      expect(env.GITHUB_CLIENT_ID).toBeUndefined();
      expect(env.GITHUB_CLIENT_SECRET).toBeUndefined();
      expect(env.GITHUB_REDIRECT_URI).toBeUndefined();
      expect(
        validateEnv({
          ...base,
          GITHUB_CLIENT_ID: '',
          GITHUB_CLIENT_SECRET: '',
          GITHUB_REDIRECT_URI: '',
        }).GITHUB_CLIENT_ID,
      ).toBeUndefined();
    });

    it('값을 주면 쓴다', () => {
      expect(validateEnv({ ...base, ...github })).toMatchObject(github);
    });

    // 운영에서 빼먹으면 로그인이 요청 때서야 깨진다. 이름마다 따로 막히는지 본다.
    it.each([
      'GITHUB_CLIENT_ID',
      'GITHUB_CLIENT_SECRET',
      'GITHUB_REDIRECT_URI',
    ])('운영에서는 필수다. %s가 없거나 비어 있으면 던진다', (name) => {
      const prod = { ...base, ...github, NODE_ENV: 'production' };
      const { [name]: _removed, ...without } = prod as Record<string, string>;
      expect(() =>
        validateEnv({ ...without, COOKIE_DOMAIN: '.gamza.xyz' }),
      ).toThrow(name);
      expect(() =>
        validateEnv({ ...without, [name]: '', COOKIE_DOMAIN: '.gamza.xyz' }),
      ).toThrow(name);
    });

    it('운영에서 모두 있으면 통과한다', () => {
      const env = validateEnv({
        ...base,
        ...github,
        NODE_ENV: 'production',
        COOKIE_DOMAIN: '.gamza.xyz',
      });
      expect(env).toMatchObject(github);
    });

    // 틀린 콜백 주소는 로그인 때서야 GitHub가 거부하므로 값이 있으면 개발에서도 막는다.
    it.each(['not a url', 'localhost:3000/callback', 'ftp://example.com/cb'])(
      'GITHUB_REDIRECT_URI가 http(s) 주소가 아니면 던진다 %s',
      (uri) => {
        expect(() =>
          validateEnv({ ...base, GITHUB_REDIRECT_URI: uri }),
        ).toThrow('GITHUB_REDIRECT_URI');
      },
    );

    it('오류 메시지에 비밀값을 싣지 않는다', () => {
      let message = '';
      try {
        validateEnv({
          ...base,
          ...github,
          GITHUB_REDIRECT_URI: 'not a url',
        });
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).toContain('GITHUB_REDIRECT_URI');
      expect(message).not.toContain(github.GITHUB_CLIENT_SECRET);
    });
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
