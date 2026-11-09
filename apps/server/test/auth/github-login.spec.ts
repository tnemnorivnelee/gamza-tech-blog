import { Logger } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { CommonModule } from '../../src/common/common.module.js';
import { validateEnv } from '../../src/config/env.validation.js';
import { AuthModule } from '../../src/modules/auth/auth.module.js';
import {
  GithubClient,
  type GithubProfile,
} from '../../src/modules/auth/github-client.js';
import { InMemoryTokenStore } from '../../src/modules/auth/in-memory-token-store.js';
import { JwtTokenService } from '../../src/modules/auth/jwt-token.service.js';
import { TokenStore } from '../../src/modules/auth/token-store.js';
import { UserRepository } from '../../src/modules/user/user.repository.js';

// 시험용 가짜 값. 비밀값은 파일에 적지 않고 계산한다.
const GITHUB_TOKEN = Buffer.alloc(8, 'g').toString('hex');
const CLIENT_SECRET = Buffer.alloc(8, 's').toString('hex');
const CODE = 'test-code';
const CALLBACK = '/login/oauth2/code/github';
const FAILURE = '/oauth2/authorization/github?error';
const REFRESH_TTL = 2592000; // 30일(초). env 기본값이다.

// GitHub에 실제로 요청하지 않는 가짜. 부른 순서를 calls에 적고, fail로 실패시킬 단계를 고른다.
class FakeGithubClient extends GithubClient {
  calls: string[] = [];
  fail: 'exchange' | 'profile' | undefined;
  profile: GithubProfile = {
    id: 1001,
    login: 'octocat',
    name: 'The Octocat',
    email: 'octo@example.com',
    avatarUrl: 'https://avatars.githubusercontent.com/u/1001',
  };

  exchangeCode(code: string): Promise<string> {
    this.calls.push(`exchange:${code}`);
    if (this.fail === 'exchange') {
      return Promise.reject(
        new Error('GitHub 액세스 토큰 요청 실패: HTTP 401'),
      );
    }
    return Promise.resolve(GITHUB_TOKEN);
  }

  fetchProfile(accessToken: string): Promise<GithubProfile> {
    this.calls.push(`profile:${accessToken}`);
    if (this.fail === 'profile') {
      return Promise.reject(new Error('GitHub 프로필 조회 실패: HTTP 500'));
    }
    return Promise.resolve(this.profile);
  }

  fetchPrimaryEmail(): Promise<string> {
    return Promise.reject(
      new Error('이메일 보강은 M3-3이라 여기서는 부르지 않는다'),
    );
  }
}

// "name=value; Max-Age=3600; Secure"를 이름, 값, 속성(소문자 키)으로 나눈다.
function parseSetCookie(raw: string) {
  const [first, ...rest] = raw.split('; ');
  const eq = first.indexOf('=');
  const attrs = new Map<string, string>();
  for (const attr of rest) {
    const i = attr.indexOf('=');
    attrs.set(
      (i < 0 ? attr : attr.slice(0, i)).toLowerCase(),
      i < 0 ? '' : attr.slice(i + 1),
    );
  }
  return { name: first.slice(0, eq), value: first.slice(eq + 1), attrs };
}

// 환경변수 기본값에 이 값들을 얹어 앱을 만든다. ConfigModule.forRoot가 불리는 순간 검증하므로 그 전에 넣어야 한다.
const defaultEnv: Record<string, string> = {
  GITHUB_CLIENT_ID: 'test-client-id',
  GITHUB_CLIENT_SECRET: CLIENT_SECRET,
  GITHUB_REDIRECT_URI: 'http://localhost:3000/login/oauth2/code/github',
  COOKIE_DOMAIN: '.gamza.xyz',
};

async function createApp(env: Record<string, string> = {}) {
  for (const [name, value] of Object.entries({ ...defaultEnv, ...env })) {
    vi.stubEnv(name, value);
  }
  const github = new FakeGithubClient();
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        validate: validateEnv,
      }),
      CommonModule,
      AuthModule,
    ],
  })
    // 사용자 저장소는 진짜 인메모리 구현을 쓴다. 토큰 저장소는 가짜라서 Redis가 필요 없다.
    .overrideProvider(GithubClient)
    .useValue(github)
    .overrideProvider(TokenStore)
    .useClass(InMemoryTokenStore)
    .compile();
  const app = moduleRef.createNestApplication();
  await app.listen(0);
  const baseUrl = await app.getUrl();

  // redirect: 'manual'이어야 302를 따라가지 않고 그대로 볼 수 있다.
  const get = async (path: string, headers: Record<string, string> = {}) => {
    const res = await fetch(`${baseUrl}${path}`, {
      redirect: 'manual',
      headers,
    });
    return {
      status: res.status,
      location: res.headers.get('location'),
      setCookies: res.headers.getSetCookie().map(parseSetCookie),
      text: await res.text(),
    };
  };

  // 1단계를 부르고 state와 세션 쿠키를 꺼낸다. 브라우저가 쿠키를 들고 있다가 콜백에 보내는 것을 흉내 낸다.
  const start = async () => {
    const res = await get('/oauth2/authorization/github');
    const session = res.setCookies.find((c) => c.name === 'connect.sid');
    return {
      res,
      state:
        new URL(res.location ?? 'http://none').searchParams.get('state') ?? '',
      cookie: session ? `${session.name}=${session.value}` : undefined,
    };
  };
  const callback = (query: string, cookie?: string) =>
    get(`${CALLBACK}?${query}`, cookie ? { cookie } : {});
  // 시작부터 콜백까지 정상으로 한 번 로그인한다.
  const login = async (extraQuery = '') => {
    const { state, cookie } = await start();
    return callback(`code=${CODE}&state=${state}${extraQuery}`, cookie);
  };

  return {
    app,
    github,
    get,
    start,
    callback,
    login,
    users: moduleRef.get(UserRepository),
    jwt: moduleRef.get(JwtTokenService),
    tokens: moduleRef.get(TokenStore),
  };
}

type TestApp = Awaited<ReturnType<typeof createApp>>;

const authCookies = (res: { setCookies: { name: string }[] }) =>
  res.setCookies.filter(
    (c) => c.name === 'authorization' || c.name === 'refreshToken',
  );

describe('GitHub 로그인', () => {
  let t: TestApp;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    t = await createApp();
  });

  afterEach(async () => {
    await t.app.close();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe('GET /oauth2/authorization/github (시작)', () => {
    it('토큰 없이 부를 수 있고 GitHub 승인 화면으로 302를 보낸다', async () => {
      const { res } = await t.start();

      expect(res.status).toBe(302);
      const url = new URL(res.location ?? '');
      expect(`${url.origin}${url.pathname}`).toBe(
        'https://github.com/login/oauth/authorize',
      );
      // 옛 Spring이 만들던 주소와 같은 매개변수다(순서까지).
      expect([...url.searchParams.keys()]).toEqual([
        'response_type',
        'client_id',
        'scope',
        'state',
        'redirect_uri',
      ]);
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('client_id')).toBe('test-client-id');
      expect(url.searchParams.get('scope')).toBe('read:user user:email repo');
      expect(url.searchParams.get('redirect_uri')).toBe(
        defaultEnv.GITHUB_REDIRECT_URI,
      );
      // 임의의 32바이트를 base64url로 쓴 43자다(옛 Spring도 같다).
      expect(url.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    });

    it('state를 서버 세션에 넣고 브라우저에는 세션 쿠키만 준다(HttpOnly, Lax, Secure 없음)', async () => {
      const { res } = await t.start();

      const session = res.setCookies.find((c) => c.name === 'connect.sid');
      expect(session).toBeDefined();
      expect(session?.attrs.has('httponly')).toBe(true);
      expect(session?.attrs.get('samesite')).toBe('Lax');
      expect(session?.attrs.has('secure')).toBe(false);
      // state 값이 쿠키에 그대로 들어 있지 않다(서버 메모리에만 있다).
      const { state } = await t.start();
      expect(decodeURIComponent(session?.value ?? '')).not.toContain(state);
    });

    it('부를 때마다 다른 state를 만든다', async () => {
      const first = await t.start();
      const second = await t.start();

      expect(first.state).not.toBe(second.state);
    });
  });

  describe('GET /login/oauth2/code/github (콜백) 성공', () => {
    it('처음 온 사용자는 PRE_REGISTER로 만들고, 쿠키 두 개를 심어 프론트로 302를 보낸다', async () => {
      const res = await t.login();

      expect(res.status).toBe(302);
      expect(res.location).toBe('https://blog.gamza.xyz');
      expect(await t.users.findByGithubId('g_1001')).toEqual({
        githubId: 'g_1001',
        role: 'PRE_REGISTER',
        name: 'The Octocat',
        nickname: 'octocat',
        email: 'octo@example.com',
      });
      // 코드를 토큰으로 바꾼 뒤 그 토큰으로 프로필을 조회한다.
      expect(t.github.calls).toEqual([
        `exchange:${CODE}`,
        `profile:${GITHUB_TOKEN}`,
      ]);
    });

    it('이름과 이메일을 비공개로 둔 사용자는 이름에 login을 쓰고 이메일은 null이다', async () => {
      t.github.profile = { ...t.github.profile, name: null, email: null };

      await t.login();

      expect(await t.users.findByGithubId('g_1001')).toMatchObject({
        name: 'octocat',
        nickname: 'octocat',
        email: null,
      });
    });

    it('이미 있는 사용자는 아무것도 바꾸지 않는다', async () => {
      const existing = {
        githubId: 'g_1001',
        role: 'USER' as const,
        name: '기존 이름',
        nickname: 'old-nick',
        email: null,
      };
      await t.users.create(existing);

      const res = await t.login();

      expect(res.location).toBe('https://blog.gamza.xyz');
      expect(await t.users.findByGithubId('g_1001')).toEqual(existing);
      expect(authCookies(res)).toHaveLength(2);
    });

    it('액세스 쿠키(authorization)와 리프레시 쿠키(refreshToken)의 속성은 옛 CookieUtils와 같다', async () => {
      const res = await t.login();

      const access = res.setCookies.find((c) => c.name === 'authorization');
      const refresh = res.setCookies.find((c) => c.name === 'refreshToken');
      // 프론트가 읽는 쿠키라서 HttpOnly가 아니다.
      expect(access?.attrs.get('max-age')).toBe('3600');
      expect(access?.attrs.get('domain')).toBe('.gamza.xyz');
      expect(access?.attrs.get('path')).toBe('/');
      expect(access?.attrs.get('samesite')).toBe('Lax');
      expect(access?.attrs.has('secure')).toBe(true);
      expect(access?.attrs.has('httponly')).toBe(false);
      // 자바스크립트가 못 읽고, 프론트와 API 도메인이 달라도 보내려고 None이다.
      expect(refresh?.attrs.get('max-age')).toBe(String(REFRESH_TTL));
      expect(refresh?.attrs.get('domain')).toBe('.gamza.xyz');
      expect(refresh?.attrs.get('path')).toBe('/');
      expect(refresh?.attrs.get('samesite')).toBe('None');
      expect(refresh?.attrs.has('secure')).toBe(true);
      expect(refresh?.attrs.has('httponly')).toBe(true);
    });

    it('두 토큰은 이 사용자의 것이고, 리프레시 토큰은 저장소에 적힌다', async () => {
      const res = await t.login();

      const access = res.setCookies.find((c) => c.name === 'authorization');
      const refresh = res.setCookies.find((c) => c.name === 'refreshToken');
      expect(t.jwt.verify(access?.value ?? '')).toBe('g_1001');
      expect(t.jwt.verify(refresh?.value ?? '')).toBe('g_1001');
      expect(
        await t.tokens.findGithubIdByRefreshToken(refresh?.value ?? ''),
      ).toBe('g_1001');
    });

    it('다시 로그인하면 이전 리프레시 토큰은 쓸 수 없다(사용자당 하나)', async () => {
      const first = await t.login();
      const second = await t.login();

      const oldRefresh = first.setCookies.find(
        (c) => c.name === 'refreshToken',
      );
      const newRefresh = second.setCookies.find(
        (c) => c.name === 'refreshToken',
      );
      expect(oldRefresh?.value).not.toBe(newRefresh?.value);
      expect(
        await t.tokens.findGithubIdByRefreshToken(oldRefresh?.value ?? ''),
      ).toBeUndefined();
      expect(
        await t.tokens.findGithubIdByRefreshToken(newRefresh?.value ?? ''),
      ).toBe('g_1001');
    });

    // location은 콜백 요청에서 읽는다. 허용 목록(기본은 blog 하나)에 없거나 값이 없으면 기본값이다.
    it.each([
      ['값이 없다', '', 'https://blog.gamza.xyz'],
      ['목록에 있다', '&location=blog', 'https://blog.gamza.xyz'],
      [
        '대소문자와 앞뒤 공백을 정리한다',
        '&location=%20BLOG%20',
        'https://blog.gamza.xyz',
      ],
      ['목록에 없다', '&location=dev', 'https://blog.gamza.xyz'],
      ['다른 도메인을 넣는다', '&location=evil.com', 'https://blog.gamza.xyz'],
      ['빈 값이다', '&location=', 'https://blog.gamza.xyz'],
      [
        '여러 번 오면 첫 값만 본다(첫 값이 목록 밖)',
        '&location=dev&location=blog',
        'https://blog.gamza.xyz',
      ],
      [
        '여러 번 오면 첫 값만 본다(첫 값이 목록 안)',
        '&location=blog&location=dev',
        'https://blog.gamza.xyz',
      ],
    ])('location %s → 이동 주소', async (_name, extraQuery, expected) => {
      const res = await t.login(extraQuery);

      expect(res.status).toBe(302);
      expect(res.location).toBe(expected);
    });
  });

  describe('GET /login/oauth2/code/github (콜백) 실패', () => {
    // 실패하면 에러 화면 없이 시작 경로로 되돌린다(옛 Spring 기본 동작 추정). 쿠키도 사용자도 만들지 않는다.
    const expectFailure = async (
      res: Awaited<ReturnType<TestApp['login']>>,
    ) => {
      expect(res.status).toBe(302);
      expect(res.location).toBe(FAILURE);
      expect(authCookies(res)).toEqual([]);
      expect(await t.users.findByGithubId('g_1001')).toBeUndefined();
    };

    it('시작 없이(세션 없이) 콜백이 오면 GitHub를 부르지 않고 되돌린다', async () => {
      const res = await t.callback(`code=${CODE}&state=anything`);

      await expectFailure(res);
      expect(t.github.calls).toEqual([]);
    });

    it('state가 다르면 되돌린다(길이가 달라도 500이 아니다)', async () => {
      const { state, cookie } = await t.start();

      for (const wrong of [
        'x',
        `${state}x`,
        state.slice(0, -1),
        'a'.repeat(43),
      ]) {
        const res = await t.callback(`code=${CODE}&state=${wrong}`, cookie);
        await expectFailure(res);
      }
      expect(t.github.calls).toEqual([]);
    });

    it.each([
      ['code가 없다', (state: string) => `state=${state}`],
      ['code가 비었다', (state: string) => `code=&state=${state}`],
      ['state가 없다', () => `code=${CODE}`],
    ])('%s', async (_name, query) => {
      const { state, cookie } = await t.start();

      const res = await t.callback(query(state), cookie);

      await expectFailure(res);
      expect(t.github.calls).toEqual([]);
    });

    // 사용자가 승인 화면에서 취소하면 GitHub가 code 없이 ?error=access_denied로 돌려보낸다.
    it('사용자가 승인을 취소하면(error 쿼리) GitHub를 부르지 않고 되돌린다', async () => {
      const { state, cookie } = await t.start();

      const res = await t.callback(
        `error=access_denied&error_description=x&state=${state}`,
        cookie,
      );

      await expectFailure(res);
      expect(t.github.calls).toEqual([]);
    });

    // GitHub는 취소하면 code를 주지 않지만, 규칙은 "error가 있으면 실패"다(옛 Spring도 같다). code가 함께 와도 통과시키지 않는다.
    it('error 쿼리가 있으면 맞는 code·state가 함께 와도 되돌린다', async () => {
      const { state, cookie } = await t.start();

      const res = await t.callback(
        `code=${CODE}&state=${state}&error=access_denied`,
        cookie,
      );

      await expectFailure(res);
      expect(t.github.calls).toEqual([]);
    });

    it.each(['exchange', 'profile'] as const)(
      'GitHub %s 단계가 실패하면 되돌리고 사용자를 만들지 않는다',
      async (step) => {
        t.github.fail = step;

        const res = await t.login();

        await expectFailure(res);
      },
    );

    it('한 번 쓴 state는 다시 쓸 수 없다(성공한 뒤 같은 요청을 되풀이해도 되돌린다)', async () => {
      const { state, cookie } = await t.start();
      const query = `code=${CODE}&state=${state}`;
      const first = await t.callback(query, cookie);
      expect(first.location).toBe('https://blog.gamza.xyz');
      t.github.calls = [];

      const replay = await t.callback(query, cookie);

      expect(replay.location).toBe(FAILURE);
      expect(authCookies(replay)).toEqual([]);
      expect(t.github.calls).toEqual([]);
    });

    it('틀린 state로 시도했어도 그 세션의 state는 이미 지워진다', async () => {
      const { state, cookie } = await t.start();
      await t.callback(`code=${CODE}&state=wrong`, cookie);

      const res = await t.callback(`code=${CODE}&state=${state}`, cookie);

      await expectFailure(res);
      expect(t.github.calls).toEqual([]);
    });

    it('실패 원인은 로그에 남기되 code, state, 토큰은 싣지 않는다', async () => {
      const { state, cookie } = await t.start();
      await t.callback(`code=${CODE}&state=wrong`, cookie);
      t.github.fail = 'exchange';
      await t.login();

      expect(warn).toHaveBeenCalledTimes(2);
      for (const [message] of warn.mock.calls) {
        expect(String(message)).toContain('GitHub 로그인 실패');
        expect(String(message)).not.toContain(CODE);
        expect(String(message)).not.toContain(state);
        expect(String(message)).not.toContain(GITHUB_TOKEN);
        expect(String(message)).not.toContain(CLIENT_SECRET);
      }
    });
  });

  describe('명세와 설정', () => {
    it('두 경로는 OpenAPI 명세에 나오지 않는다', () => {
      const paths = Object.keys(
        SwaggerModule.createDocument(t.app, new DocumentBuilder().build())
          .paths,
      );

      expect(paths).toContain('/api/auth/reissue'); // 다른 컨트롤러는 나온다
      expect(
        paths.filter((p) => p.startsWith('/oauth2') || p.startsWith('/login')),
      ).toEqual([]);
    });
  });
});

describe('GitHub 로그인 설정', () => {
  let t: TestApp;

  afterEach(async () => {
    await t.app.close();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('허용 목록과 도메인 접미사를 환경변수로 바꿀 수 있다', async () => {
    t = await createApp({
      OAUTH_ALLOWED_LOCATIONS: 'blog,dev',
      OAUTH_REDIRECT_DOMAIN_SUFFIX: 'example.org',
    });

    // 허용 목록의 값(dev)이 기본값(blog)과 달라야 정리(공백·대소문자)와 첫 값 선택이 실제로 동작하는지 구분된다.
    expect((await t.login('&location=%20Dev%20')).location).toBe(
      'https://dev.example.org',
    );
    expect((await t.login('&location=dev&location=blog')).location).toBe(
      'https://dev.example.org',
    );
    expect((await t.login('&location=blog&location=dev')).location).toBe(
      'https://blog.example.org',
    );
    expect((await t.login('&location=preview')).location).toBe(
      'https://blog.example.org',
    );
  });

  // OAuth 앱을 만들기 전에도 서버는 뜬다(M3-1). 이때 시작 경로를 부르면 잘못된 주소로 보내지 않고 500이 된다.
  // 실패를 시작 경로로 되돌리는 방식(자기 자신으로의 이동)을 쓰면 끝없이 이동하므로 던지게 둔다.
  it('GITHUB_* 값이 없으면 시작 경로는 500 C004이고 세션 쿠키도 만들지 않는다', async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    t = await createApp({
      GITHUB_CLIENT_ID: '',
      GITHUB_CLIENT_SECRET: '',
      GITHUB_REDIRECT_URI: '',
    });

    const { res } = await t.start();

    expect(res.status).toBe(500);
    expect(JSON.parse(res.text)).toMatchObject({ code: 'C004' });
    expect(res.setCookies).toEqual([]);
  });
});
