import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { FetchGithubClient } from './fetch-github-client.js';

// 시험용 가짜 값. 비밀값은 파일에 적지 않고 계산한다.
const CLIENT_SECRET = Buffer.alloc(8, 's').toString('hex');
const TOKEN = Buffer.alloc(8, 't').toString('hex');
const CODE = Buffer.alloc(4, 'c').toString('hex');
const settings = {
  GITHUB_CLIENT_ID: 'test-client-id',
  GITHUB_CLIENT_SECRET: CLIENT_SECRET,
  GITHUB_REDIRECT_URI: 'http://localhost:3000/login/oauth2/code/github',
};
const newClient = (values: Partial<EnvironmentVariables> = settings) =>
  new FetchGithubClient(new ConfigService<EnvironmentVariables>(values));

// 전역 fetch를 가짜로 바꿔서 GitHub를 실제로 부르지 않는다. 응답은 한 번 읽으면 비므로 시험마다 새로 만든다.
const fetchMock = vi.fn<typeof fetch>();
const reply = (body: unknown, status = 200) =>
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify(body), { status }),
  );
// 마지막으로 보낸 요청의 주소와 설정.
const sent = () => {
  const [url, init] = fetchMock.mock.lastCall ?? [];
  return { url: String(url), init: init ?? {} };
};
// 오류 메시지를 꺼내 보는 도구(던져야 하는 시험에서 쓴다).
const messageOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error('던지지 않았다');
};

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe('FetchGithubClient', () => {
  describe('exchangeCode', () => {
    it('code를 토큰으로 바꾸는 요청을 GitHub에 보낸다', async () => {
      reply({ access_token: TOKEN, token_type: 'bearer' });

      await expect(newClient().exchangeCode(CODE)).resolves.toBe(TOKEN);

      const { url, init } = sent();
      expect(url).toBe('https://github.com/login/oauth/access_token');
      expect(init.method).toBe('POST');
      expect(init.headers).toMatchObject({
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      });
      const form = init.body as URLSearchParams;
      expect(Object.fromEntries(form)).toEqual({
        client_id: settings.GITHUB_CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code: CODE,
        redirect_uri: settings.GITHUB_REDIRECT_URI,
      });
      // 제한 시간이 걸려 있어야 GitHub가 느릴 때 로그인이 매달리지 않는다.
      expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    // GitHub는 code가 틀려도 HTTP 200으로 답한다. 옛 코드도 access_token이 없으면 실패로 다뤘다.
    it('200이어도 본문에 error가 있으면 던진다', async () => {
      reply({ error: 'bad_verification_code', error_description: 'x' });

      await expect(newClient().exchangeCode(CODE)).rejects.toThrow(
        'bad_verification_code',
      );
    });

    it.each([{}, { access_token: '' }, { access_token: 1 }, [], null])(
      'access_token이 없거나 문자열이 아니면 던진다 %j',
      async (body) => {
        reply(body);

        await expect(newClient().exchangeCode(CODE)).rejects.toThrow(
          '액세스 토큰 요청 실패',
        );
      },
    );

    it('HTTP 오류면 던진다', async () => {
      reply({}, 500);

      await expect(newClient().exchangeCode(CODE)).rejects.toThrow('HTTP 500');
    });

    it('fetch 자체가 실패하면(제한 시간 등) 그대로 던진다', async () => {
      fetchMock.mockRejectedValueOnce(new Error('timeout'));

      await expect(newClient().exchangeCode(CODE)).rejects.toThrow('timeout');
    });

    it('환경변수가 비어 있으면 GitHub를 부르지 않고 던진다', async () => {
      await expect(newClient({}).exchangeCode(CODE)).rejects.toThrow(
        'GITHUB_*',
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('오류 메시지에 비밀값과 code를 싣지 않는다', async () => {
      reply({ error: 'bad_verification_code' });
      const bodyError = await messageOf(newClient().exchangeCode(CODE));
      reply({}, 401);
      const httpError = await messageOf(newClient().exchangeCode(CODE));

      for (const message of [bodyError, httpError]) {
        expect(message).not.toContain(CLIENT_SECRET);
        expect(message).not.toContain(CODE);
      }
    });
  });

  describe('fetchProfile', () => {
    it('토큰으로 프로필을 요청하고 쓰는 필드만 돌려준다', async () => {
      reply({
        id: 12345,
        login: 'octocat',
        name: 'The Octocat',
        email: 'octo@example.com',
        avatar_url: 'https://avatars.githubusercontent.com/u/12345',
        followers: 99, // 쓰지 않는 필드는 버린다.
      });

      await expect(newClient().fetchProfile(TOKEN)).resolves.toEqual({
        id: 12345,
        login: 'octocat',
        name: 'The Octocat',
        email: 'octo@example.com',
        avatarUrl: 'https://avatars.githubusercontent.com/u/12345',
      });

      const { url, init } = sent();
      expect(url).toBe('https://api.github.com/user');
      expect(init.headers).toMatchObject({
        Authorization: `Bearer ${TOKEN}`,
        Accept: 'application/json',
      });
      expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    // 이름·이메일을 비공개로 둔 사용자는 GitHub가 null로 준다. 옛 코드도 null을 그대로 다뤘다.
    it('비공개 필드는 null로 돌려준다', async () => {
      reply({ id: 1, login: 'octocat', name: null, email: null });

      await expect(newClient().fetchProfile(TOKEN)).resolves.toEqual({
        id: 1,
        login: 'octocat',
        name: null,
        email: null,
        avatarUrl: null,
      });
    });

    // id가 없는 채로 통과시키면 "g_undefined" 사용자가 만들어진다.
    it.each([
      { login: 'octocat' },
      { id: 1 },
      { id: '1', login: 'octocat' },
      [],
      null,
    ])('id나 login이 없거나 타입이 틀리면 던진다 %j', async (body) => {
      reply(body);

      await expect(newClient().fetchProfile(TOKEN)).rejects.toThrow(
        '형식이 올바르지 않습니다',
      );
    });

    it('HTTP 오류면 던지고 메시지에 토큰을 싣지 않는다', async () => {
      reply({ message: 'Bad credentials' }, 401);

      const message = await messageOf(newClient().fetchProfile(TOKEN));

      expect(message).toContain('HTTP 401');
      expect(message).not.toContain(TOKEN);
    });
  });

  describe('fetchPrimaryEmail', () => {
    it('토큰으로 이메일 목록을 요청하고 주 이메일을 돌려준다', async () => {
      reply([
        { email: 'other@example.com', primary: false, verified: true },
        { email: 'main@example.com', primary: true, verified: true },
      ]);

      await expect(newClient().fetchPrimaryEmail(TOKEN)).resolves.toBe(
        'main@example.com',
      );

      const { url, init } = sent();
      expect(url).toBe('https://api.github.com/user/emails');
      expect(init.headers).toMatchObject({
        Authorization: `Bearer ${TOKEN}`,
        Accept: 'application/json',
      });
      expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    // 옛 코드는 primary와 verified를 둘 다 만족하는 것만 골랐다.
    it('주 이메일이어도 인증되지 않았거나, 인증됐어도 주 이메일이 아니면 고르지 않는다', async () => {
      reply([
        { email: 'unverified@example.com', primary: true, verified: false },
        { email: 'secondary@example.com', primary: false, verified: true },
      ]);

      await expect(newClient().fetchPrimaryEmail(TOKEN)).rejects.toThrow(
        '주 이메일',
      );
    });

    it.each([[], {}, null, [{ primary: true, verified: true }]])(
      '쓸 수 있는 이메일이 없으면 던진다 %j',
      async (body) => {
        reply(body);

        await expect(newClient().fetchPrimaryEmail(TOKEN)).rejects.toThrow(
          '주 이메일',
        );
      },
    );

    it('HTTP 오류면 던진다(user:email 권한이 없을 때 등)', async () => {
      reply({ message: 'Not Found' }, 404);

      await expect(newClient().fetchPrimaryEmail(TOKEN)).rejects.toThrow(
        'HTTP 404',
      );
    });
  });
});
