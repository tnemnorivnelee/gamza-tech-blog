import { Controller, Get } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { CommonModule } from '../../src/common/common.module.js';
import { validateEnv } from '../../src/config/env.validation.js';
import { AuthModule } from '../../src/modules/auth/auth.module.js';
import { InMemoryTokenStore } from '../../src/modules/auth/in-memory-token-store.js';
import { JwtTokenService } from '../../src/modules/auth/jwt-token.service.js';
import { TokenStore } from '../../src/modules/auth/token-store.js';
import {
  type User,
  UserRepository,
} from '../../src/modules/user/user.repository.js';

// 로그아웃 뒤에 같은 토큰이 막히는지 보려는 보호된 라우트(기본 규칙: 로그인 필요).
@Controller('fx')
class PingController {
  @Get('ping')
  ping() {
    return { ok: true };
  }
}

const USERS = new Map<string, User>([
  ['octo', { githubId: 'octo', role: 'USER' }],
  ['boss', { githubId: 'boss', role: 'ADMIN' }],
  ['newbie', { githubId: 'newbie', role: 'PRE_REGISTER' }],
  ['waiting', { githubId: 'waiting', role: 'PENDING' }],
]);

const REFRESH_TTL = 2592000; // 30일(초). env 기본값이다.
const DAY_MS = 24 * 3600 * 1000;
const T0 = new Date('2030-01-01T00:00:00.000Z').getTime();

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

async function createApp() {
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
    controllers: [PingController],
  })
    // 사용자 저장소와 토큰 저장소를 시험용으로 바꿔 끼운다(토큰 저장소는 가짜라서 Redis가 필요 없다).
    .overrideProvider(UserRepository)
    .useValue({
      findByGithubId: (githubId: string) =>
        Promise.resolve(USERS.get(githubId)),
    })
    .overrideProvider(TokenStore)
    .useClass(InMemoryTokenStore)
    .compile();
  const app = moduleRef.createNestApplication();
  await app.listen(0);
  const baseUrl = await app.getUrl();

  const request = async (
    method: 'GET' | 'POST',
    path: string,
    headers: Record<string, string> = {},
  ) => {
    const res = await fetch(`${baseUrl}${path}`, { method, headers });
    return {
      status: res.status,
      body: await res.json(),
      // getSetCookie는 Set-Cookie를 하나씩 배열로 준다. get('set-cookie')는 ", "로 이어 붙여서 Expires의 쉼표와 섞인다.
      setCookies: res.headers.getSetCookie().map(parseSetCookie),
    };
  };
  return {
    app,
    request,
    jwt: moduleRef.get(JwtTokenService),
    store: moduleRef.get(TokenStore),
  };
}

type TestApp = Awaited<ReturnType<typeof createApp>>;

// 인증 실패(가드)는 ResponseDto 모양이고 data에 코드가 들어간다. 일반 에러(ErrorResponse)와 모양이 다르다.
const expectGuardFailure = (
  res: { status: number; body: unknown },
  status: number,
  code: string,
) => {
  expect(res.status).toBe(status);
  expect(res.body).toEqual({
    status,
    message: expect.any(String),
    data: code,
    timestamp: expect.any(Number),
  });
};

const expectErrorResponse = (
  res: { status: number; body: unknown },
  status: number,
  code: string,
) => {
  expect(res.status).toBe(status);
  expect(res.body).toEqual({
    message: expect.any(String),
    status,
    errors: [],
    code,
  });
};

describe('POST /api/auth/reissue, /api/auth/me/logout', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createApp();
  });

  afterAll(() => t.app.close());

  afterEach(() => vi.useRealTimers());

  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

  describe('reissue', () => {
    const REISSUE = '/api/auth/reissue';

    it.each([
      ['쿠키 헤더가 없음', {}],
      ['다른 이름의 쿠키만 있음', { cookie: 'theme=dark; authorization=x' }],
      ['이름 대소문자가 다름', { cookie: 'refreshtoken=x' }],
    ])(
      '리프레시 쿠키가 없으면(%s) HTTP 200이지만 본문 status는 401이고 쿠키는 내려가지 않는다',
      async (_name, headers) => {
        const res = await t.request('POST', REISSUE, headers);
        expect(res.status).toBe(200);
        // data 키가 없다.
        expect(res.body).toEqual({
          status: 401,
          message: '리프레시 토큰이 없습니다.',
          timestamp: expect.any(Number),
        });
        expect(res.setCookies).toEqual([]);
      },
    );

    it('저장소에 없는 토큰이면 403 J004이고 ErrorResponse 모양이다(가드 실패와 모양이 다르다)', async () => {
      const res = await t.request('POST', REISSUE, {
        cookie: 'refreshToken=never-issued',
      });
      expectErrorResponse(res, 403, 'J004');
      expect(res.setCookies).toEqual([]);
    });

    // 쿠키 값은 그대로 쓴다. Bearer를 떼지 않으므로 접두어가 붙으면 다른 문자열이다.
    it('쿠키 값에서 Bearer를 떼지 않는다', async () => {
      await t.store.rotateRefreshToken('octo', 'raw-1', REFRESH_TTL);
      const res = await t.request('POST', REISSUE, {
        cookie: 'refreshToken=Bearer raw-1',
      });
      expectErrorResponse(res, 403, 'J004');
    });

    // 빈 값은 "쿠키 없음"(401)이 아니라 존재하지 않는 토큰(403)이다 [추정: @CookieValue(required = false)].
    it('refreshToken 쿠키가 비어 있으면 403 J004다', async () => {
      const res = await t.request('POST', REISSUE, { cookie: 'refreshToken=' });
      expectErrorResponse(res, 403, 'J004');
    });

    it('있는 토큰이면 새 액세스 토큰을 본문과 authorization 쿠키 하나로 준다', async () => {
      await t.store.rotateRefreshToken('octo', 'r-ok', REFRESH_TTL);
      const res = await t.request('POST', REISSUE, {
        cookie: 'theme=dark; refreshToken=r-ok',
      });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        status: 200,
        message: '토큰 재발급 성공',
        data: { authorization: expect.any(String) },
        timestamp: expect.any(Number),
      });
      const token = (res.body as { data: { authorization: string } }).data
        .authorization;
      expect(t.jwt.verify(token)).toBe('octo');

      // Set-Cookie는 authorization 하나뿐이다. 리프레시 쿠키는 다시 내려주지 않는다.
      expect(res.setCookies).toHaveLength(1);
      const [cookie] = res.setCookies;
      expect(cookie.name).toBe('authorization');
      expect(cookie.value).toBe(token);
      expect(cookie.attrs.get('max-age')).toBe('3600');
      expect(cookie.attrs.get('path')).toBe('/');
      expect(cookie.attrs.get('samesite')).toBe('Lax');
      expect(cookie.attrs.has('secure')).toBe(true);
      expect(cookie.attrs.has('httponly')).toBe(false);
      expect(cookie.attrs.has('domain')).toBe(false);
    });

    // 리프레시 JWT를 검증하지 않고 사용자가 DB에 있는지도 보지 않는다(옛 동작). 저장소에 있는지만 본다.
    it('토큰 모양이 아니어도, DB에 없는 사용자여도 저장소에 있으면 발급한다', async () => {
      await t.store.rotateRefreshToken('ghost', 'not-a-jwt', REFRESH_TTL);
      const res = await t.request('POST', REISSUE, {
        cookie: 'refreshToken=not-a-jwt',
      });
      expect(res.status).toBe(200);
      const token = (res.body as { data: { authorization: string } }).data
        .authorization;
      expect(t.jwt.verify(token)).toBe('ghost');
    });

    it('공개 경로다. 깨진 액세스 토큰을 같이 보내도 가드가 막지 않는다', async () => {
      await t.store.rotateRefreshToken('octo', 'r-pub', REFRESH_TTL);
      const res = await t.request('POST', REISSUE, {
        cookie: 'refreshToken=r-pub',
        ...bearer('garbage'),
      });
      expect(res.status).toBe(200);
    });

    it('리프레시 토큰 자체는 그대로 두고 쓸 때마다 같은 토큰으로 다시 받을 수 있다', async () => {
      await t.store.rotateRefreshToken('octo', 'r-again', REFRESH_TTL);
      for (let i = 0; i < 2; i++) {
        const res = await t.request('POST', REISSUE, {
          cookie: 'refreshToken=r-again',
        });
        expect(res.status).toBe(200);
      }
      expect(await t.store.findGithubIdByRefreshToken('r-again')).toBe('octo');
    });
  });

  describe('logout', () => {
    const LOGOUT = '/api/auth/me/logout';
    const login = async (githubId: string) => {
      const refresh = `refresh-of-${githubId}`;
      await t.store.rotateRefreshToken(githubId, refresh, REFRESH_TTL);
      return { refresh, access: t.jwt.createAccessToken(githubId) };
    };

    it('성공하면 리프레시 토큰을 지우고, 헤더의 액세스 토큰을 블랙리스트에 올리고, 두 쿠키를 만료시킨다', async () => {
      const { refresh, access } = await login('octo');
      const res = await t.request('POST', LOGOUT, bearer(access));

      expect(res.status).toBe(200);
      // data 키가 없다.
      expect(res.body).toEqual({
        status: 200,
        message: '로그아웃되었습니다.',
        timestamp: expect.any(Number),
      });
      expect(await t.store.findGithubIdByRefreshToken(refresh)).toBeUndefined();
      expectGuardFailure(
        await t.request('GET', '/fx/ping', bearer(access)),
        403,
        'J001',
      );

      // 쿠키 두 개가 Max-Age=0으로 만료된다. 속성은 만들 때와 같아야 브라우저가 지운다.
      expect(res.setCookies.map((c) => c.name)).toEqual([
        'authorization',
        'refreshToken',
      ]);
      const [authCookie, refreshCookie] = res.setCookies;
      for (const cookie of res.setCookies) {
        expect(cookie.value).toBe('');
        expect(cookie.attrs.get('max-age')).toBe('0');
        expect(cookie.attrs.get('path')).toBe('/');
        expect(cookie.attrs.has('secure')).toBe(true);
        expect(cookie.attrs.has('domain')).toBe(false);
      }
      expect(authCookie.attrs.get('samesite')).toBe('Lax');
      expect(authCookie.attrs.has('httponly')).toBe(false);
      expect(refreshCookie.attrs.get('samesite')).toBe('None');
      expect(refreshCookie.attrs.has('httponly')).toBe(true);
    });

    it('다른 사용자의 리프레시 토큰은 지우지 않는다', async () => {
      const octo = await login('octo');
      const boss = await login('boss');
      await t.request('POST', LOGOUT, bearer(octo.access));
      expect(await t.store.findGithubIdByRefreshToken(boss.refresh)).toBe(
        'boss',
      );
    });

    it('블랙리스트에는 토큰의 남은 수명만큼만 오른다', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(T0);
      const { access } = await login('octo');
      await t.request('POST', LOGOUT, bearer(access));

      vi.setSystemTime(T0 + 3599_000);
      expect(await t.store.isAccessTokenBlacklisted(access)).toBe(true);
      vi.setSystemTime(T0 + 3600_000);
      expect(await t.store.isAccessTokenBlacklisted(access)).toBe(false);
    });

    // 프론트는 쿠키와 헤더를 같이 보낸다. 블랙리스트에 오르는 것은 헤더의 토큰이고, 쿠키는 같은 토큰이라 같이 막힌다.
    it('쿠키와 헤더로 같이 인증하면 그 토큰이 블랙리스트에 올라 쿠키만 보내도 막힌다', async () => {
      const { access } = await login('octo');
      const res = await t.request('POST', LOGOUT, {
        cookie: `authorization=${access}`,
        ...bearer(access),
      });
      expect(res.status).toBe(200);
      expectGuardFailure(
        await t.request('GET', '/fx/ping', {
          cookie: `authorization=${access}`,
        }),
        403,
        'J001',
      );
    });

    // improvement-candidates.md 6번: 쿠키로만 인증한 요청은 리프레시 토큰은 지워도 액세스 토큰은 블랙리스트에 오르지 않는다.
    it('쿠키로만 인증하면 로그아웃은 성공하지만 액세스 토큰은 블랙리스트에 오르지 않는다', async () => {
      const { refresh, access } = await login('octo');
      const res = await t.request('POST', LOGOUT, {
        cookie: `authorization=${access}`,
      });
      expect(res.status).toBe(200);
      expect(await t.store.findGithubIdByRefreshToken(refresh)).toBeUndefined();
      expect(
        (
          await t.request('GET', '/fx/ping', {
            cookie: `authorization=${access}`,
          })
        ).status,
      ).toBe(200);
    });

    // improvement-candidates.md 11번: 가드는 ACCESS에 접두어가 없으면 Authorization으로 넘어가지만,
    // 블랙리스트 등록은 ACCESS 값 하나만 보고 null이 된다.
    it('ACCESS에 Bearer가 없으면 Authorization으로 인증돼도 블랙리스트에 오르지 않는다', async () => {
      const { access } = await login('octo');
      const res = await t.request('POST', LOGOUT, {
        access: 'raw-token',
        ...bearer(access),
      });
      expect(res.status).toBe(200);
      expect(await t.store.isAccessTokenBlacklisted(access)).toBe(false);
    });

    // improvement-candidates.md 11번: 쿠키로 인증하고 헤더에 만료된 토큰이 있으면 남은 수명 계산이 던져 500이 된다.
    // 그 앞에서 리프레시 토큰은 이미 지워졌고 쿠키 만료(Set-Cookie)는 나가지 않는다.
    it('헤더 토큰이 만료됐으면 500 C004이고, 리프레시 토큰은 이미 지워졌고 쿠키는 만료되지 않는다', async () => {
      const { refresh, access } = await login('octo');
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(Date.now() - 2 * 3600 * 1000);
      const expired = t.jwt.createAccessToken('octo');
      vi.useRealTimers();

      const res = await t.request('POST', LOGOUT, {
        cookie: `authorization=${access}`,
        ...bearer(expired),
      });
      expectErrorResponse(res, 500, 'C004');
      expect(res.setCookies).toEqual([]);
      expect(await t.store.findGithubIdByRefreshToken(refresh)).toBeUndefined();
    });

    it('로그인이 필요하다. 토큰이 없으면 403 J004다', async () => {
      expectGuardFailure(await t.request('POST', LOGOUT), 403, 'J004');
    });

    // improvement-candidates.md 7번: USER·ADMIN만 허용한다. 가입 중인 사용자는 로그아웃을 부를 수 없다.
    it.each(['newbie', 'waiting'])(
      '%s(PRE_REGISTER·PENDING)는 403 J005이고 리프레시 토큰은 남는다',
      async (githubId) => {
        const { refresh, access } = await login(githubId);
        expectGuardFailure(
          await t.request('POST', LOGOUT, bearer(access)),
          403,
          'J005',
        );
        expect(await t.store.findGithubIdByRefreshToken(refresh)).toBe(
          githubId,
        );
      },
    );
  });

  // improvement-candidates.md 12번: reissue는 refresh 키만 늘리고 userRefresh 키는 로그인 때의 만료 그대로다.
  // 30일이 지난 뒤에는 로그아웃이 userRefresh 키를 못 찾아서 refresh 키가 남는다.
  it('reissue로 늘린 토큰은 30일이 지나도 살아 있지만, 그때 로그아웃해도 지워지지 않는다', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    await t.store.rotateRefreshToken('octo', 'r-long', REFRESH_TTL);

    vi.setSystemTime(T0 + 29 * DAY_MS);
    const reissued = await t.request('POST', '/api/auth/reissue', {
      cookie: 'refreshToken=r-long',
    });
    expect(reissued.status).toBe(200);

    vi.setSystemTime(T0 + 31 * DAY_MS);
    expect(await t.store.findGithubIdByRefreshToken('r-long')).toBe('octo');
    const logout = await t.request(
      'POST',
      '/api/auth/me/logout',
      bearer(t.jwt.createAccessToken('octo')),
    );
    expect(logout.status).toBe(200);
    expect(await t.store.findGithubIdByRefreshToken('r-long')).toBe('octo');
  });
});

// ConfigModule은 검증한 값을 process.env에도 써 넣는다. 앱 둘을 한꺼번에 띄우면 값이 서로 새므로,
// 환경변수를 stub한 앱을 이 describe 안에서만 띄우고 끝나면 되돌린다.
describe('COOKIE_DOMAIN이 설정되어 있으면', () => {
  let t: TestApp;

  beforeAll(async () => {
    vi.stubEnv('COOKIE_DOMAIN', '.gamza.xyz');
    t = await createApp();
  });

  afterAll(async () => {
    await t.app.close();
    vi.unstubAllEnvs();
  });

  it('reissue의 authorization 쿠키에 Domain 속성이 붙는다', async () => {
    await t.store.rotateRefreshToken('octo', 'r-dom', REFRESH_TTL);
    const res = await t.request('POST', '/api/auth/reissue', {
      cookie: 'refreshToken=r-dom',
    });
    expect(res.setCookies.map((c) => c.attrs.get('domain'))).toEqual([
      '.gamza.xyz',
    ]);
  });

  it('logout이 만료시키는 두 쿠키에 모두 Domain 속성이 붙는다', async () => {
    await t.store.rotateRefreshToken('octo', 'r-dom-out', REFRESH_TTL);
    const res = await t.request('POST', '/api/auth/me/logout', {
      authorization: `Bearer ${t.jwt.createAccessToken('octo')}`,
    });
    expect(res.setCookies.map((c) => c.attrs.get('domain'))).toEqual([
      '.gamza.xyz',
      '.gamza.xyz',
    ]);
  });
});

// `cp .env.example .env`로 만든 .env는 COOKIE_DOMAIN=이 비어 있다. 검증을 거친 값은 undefined지만
// ConfigService는 그 값이 없으면 process.env를 읽어서 컨트롤러에는 ''가 들어올 수 있다. 그래도 Domain 속성은 빠져야 한다.
describe('COOKIE_DOMAIN이 빈 문자열이면', () => {
  let t: TestApp;

  beforeAll(async () => {
    vi.stubEnv('COOKIE_DOMAIN', '');
    t = await createApp();
  });

  afterAll(async () => {
    await t.app.close();
    vi.unstubAllEnvs();
  });

  it('두 쿠키 모두 Domain 속성이 없다', async () => {
    await t.store.rotateRefreshToken('octo', 'r-blank', REFRESH_TTL);
    const reissued = await t.request('POST', '/api/auth/reissue', {
      cookie: 'refreshToken=r-blank',
    });
    const loggedOut = await t.request('POST', '/api/auth/me/logout', {
      authorization: `Bearer ${t.jwt.createAccessToken('octo')}`,
    });
    const cookies = [...reissued.setCookies, ...loggedOut.setCookies];
    expect(cookies).toHaveLength(3);
    expect(cookies.map((c) => c.attrs.has('domain'))).toEqual([
      false,
      false,
      false,
    ]);
  });
});
