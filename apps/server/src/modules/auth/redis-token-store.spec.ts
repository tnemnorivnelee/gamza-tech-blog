import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { RedisTokenStore } from './redis-token-store.js';

// 진짜 Redis로 하는 시험이다(m2-auth-plan.md D4). Lua와 만료(TTL)는 가짜로는 증명할 수 없다.
// 접속 정보는 앱과 같은 환경변수를 읽고, 없으면 로컬 Compose 주소(127.0.0.1:6379)를 쓴다.
const options = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: Number(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
};

// 연결되는지 먼저 본다. 안 되면 다시 시도하지 않고 바로 false다.
async function canConnect(): Promise<boolean> {
  const probe = new Redis({
    ...options,
    lazyConnect: true,
    retryStrategy: () => null,
    maxRetriesPerRequest: 0,
  });
  probe.on('error', () => {}); // 연결 실패는 결과(false)로만 쓴다. 이벤트를 받아 두지 않으면 콘솔에 찍힌다.
  try {
    await probe.connect();
    await probe.ping();
    return true;
  } catch {
    return false;
  } finally {
    probe.disconnect();
  }
}

const reachable = await canConnect();
// 로컬에는 Redis가 없을 수 있어 건너뛴다. 하지만 CI에는 서비스 컨테이너가 항상 있어야 하므로, 건너뛰지 않고 실패시킨다.
// 조용히 건너뛰면 CI가 통과해도 Redis는 한 번도 시험되지 않는다.
if (!reachable && process.env.CI) {
  throw new Error(
    'CI인데 Redis에 연결할 수 없습니다. .github/workflows/ci.yml의 services.redis를 확인하세요.',
  );
}

describe.skipIf(!reachable)('RedisTokenStore (진짜 Redis)', () => {
  let redis: Redis;
  let store: RedisTokenStore;
  // 시험이 만든 키. 시험마다 끝나면 지운다.
  const created: string[] = [];

  // 시험마다 새 이름을 쓴다. 서로 겹치지 않고, 개발용 Redis에 이미 있는 데이터와도 겹치지 않는다.
  // 같은 이름으로 세 종류 키를 모두 청소 대상에 올려 두어서, 어떤 키를 만들었는지 일일이 적지 않아도 된다.
  const newId = () => {
    const id = randomUUID();
    created.push(
      `refresh:${id}`,
      `userRefresh:${id}`,
      `blacklist:access:${id}`,
    );
    return id;
  };
  // 남은 수명이 기대한 값 근처인지 본다(시험이 도는 사이 몇 초는 흐를 수 있다).
  const expectTtlAbout = async (key: string, seconds: number) => {
    const ttl = await redis.ttl(key);
    expect(ttl).toBeGreaterThan(seconds - 5);
    expect(ttl).toBeLessThanOrEqual(seconds);
  };

  beforeAll(() => {
    redis = new Redis(options);
    store = new RedisTokenStore(redis);
  });
  afterEach(async () => {
    vi.restoreAllMocks(); // 시험에서 바꾼 eval·get·warn을 되돌린 뒤에 청소한다.
    if (created.length > 0) await redis.del(...created);
    created.length = 0;
  });
  afterAll(async () => {
    await redis.quit();
  });

  describe('블랙리스트', () => {
    it('올린 토큰만 블랙리스트에 있고, 값은 "true"이며, 수명 안에 끝난다', async () => {
      const token = newId();
      expect(await store.isAccessTokenBlacklisted(token)).toBe(false);

      await store.blacklistAccessToken(token, 100);

      expect(await store.isAccessTokenBlacklisted(token)).toBe(true);
      expect(await store.isAccessTokenBlacklisted(newId())).toBe(false);
      expect(await redis.get(`blacklist:access:${token}`)).toBe('true');
      await expectTtlAbout(`blacklist:access:${token}`, 100);
    });

    // 로그아웃 때 토큰의 남은 수명이 0초(만료 직전)면 Redis가 SET EX 0을 거부한다. 옛 코드도 남은 수명을 그대로 넘겼다.
    // 가짜(InMemoryTokenStore)는 이때 던지지 않는다. 고칠 일은 improvement-candidates.md 13번.
    it('남은 수명이 0이면 Redis가 거부해서 던진다', async () => {
      await expect(store.blacklistAccessToken(newId(), 0)).rejects.toThrow(
        /invalid expire time/,
      );
    });
  });

  describe('리프레시 토큰', () => {
    it('저장한 토큰의 주인을 찾고, 모르는 토큰은 undefined다', async () => {
      const [user, token] = [newId(), newId()];
      await store.rotateRefreshToken(user, token, 100);

      expect(await store.findGithubIdByRefreshToken(token)).toBe(user);
      expect(await store.findGithubIdByRefreshToken(newId())).toBeUndefined();
    });

    it('두 키(refresh, userRefresh)를 같은 수명으로 적는다', async () => {
      const [user, token] = [newId(), newId()];
      await store.rotateRefreshToken(user, token, 100);

      expect(await redis.get(`refresh:${token}`)).toBe(user);
      expect(await redis.get(`userRefresh:${user}`)).toBe(token);
      await expectTtlAbout(`refresh:${token}`, 100);
      await expectTtlAbout(`userRefresh:${user}`, 100);
    });

    // 옛 RefreshTokenDao는 수명을 최소 1초로 올려서 Lua에 넘겼다. 0이면 Redis가 SET EX 0을 거부하기 때문이다.
    it('수명이 0 이하여도 1초로 올려 저장한다', async () => {
      const [user, token] = [newId(), newId()];
      await store.rotateRefreshToken(user, token, 0);

      expect(await store.findGithubIdByRefreshToken(token)).toBe(user);
      expect(await redis.ttl(`refresh:${token}`)).toBeLessThanOrEqual(1);
    });

    it('새 토큰으로 바꾸면 이전 토큰은 무효가 된다(사용자당 하나). 다른 사용자는 그대로다', async () => {
      const [user, other, first, second, otherToken] = [
        newId(),
        newId(),
        newId(),
        newId(),
        newId(),
      ];
      await store.rotateRefreshToken(other, otherToken, 100);
      await store.rotateRefreshToken(user, first, 100);
      await store.rotateRefreshToken(user, second, 100);

      expect(await store.findGithubIdByRefreshToken(first)).toBeUndefined();
      expect(await store.findGithubIdByRefreshToken(second)).toBe(user);
      expect(await store.findGithubIdByRefreshToken(otherToken)).toBe(other);
    });

    // Lua가 한 덩어리로 도는지 보는 시험이다. 키를 하나씩 바꾸는 방식이면 동시에 온 요청들이 서로의 중간에 끼어들어
    // 옛 토큰을 못 지우고 refresh 키가 여러 개 남는다.
    it('같은 사용자가 동시에 로그인해도 토큰은 하나만 남는다', async () => {
      const user = newId();
      const tokens = Array.from({ length: 8 }, newId);

      await Promise.all(
        tokens.map((token) => store.rotateRefreshToken(user, token, 100)),
      );

      const remaining = await redis.exists(
        ...tokens.map((token) => `refresh:${token}`),
      );
      expect(remaining).toBe(1);
      const current = await redis.get(`userRefresh:${user}`);
      expect(tokens).toContain(current);
      expect(await redis.exists(`refresh:${current}`)).toBe(1);
    });

    it('만료를 늘리면 refresh 키만 늘어난다. userRefresh 키는 원래 수명 그대로다', async () => {
      const [user, token] = [newId(), newId()];
      await store.rotateRefreshToken(user, token, 100);

      await store.extendRefreshToken(token, 500);

      await expectTtlAbout(`refresh:${token}`, 500);
      await expectTtlAbout(`userRefresh:${user}`, 100);
    });

    it('없는 토큰의 만료는 늘려도 키가 생기지 않는다(EXPIRE)', async () => {
      const ghost = newId();
      await store.extendRefreshToken(ghost, 100);
      expect(await redis.exists(`refresh:${ghost}`)).toBe(0);
    });

    it('사용자의 토큰을 지운다. 없는 사용자를 지워도 아무 일 없다', async () => {
      const [user, token] = [newId(), newId()];
      await store.rotateRefreshToken(user, token, 100);

      await store.removeRefreshTokens(user);

      expect(
        await redis.exists(`refresh:${token}`, `userRefresh:${user}`),
      ).toBe(0);
      await expect(store.removeRefreshTokens(newId())).resolves.toBeUndefined();
    });

    // userRefresh 키가 먼저 끝난 사용자는 지우기가 refresh 키를 찾지 못한다(improvement-candidates.md 12번).
    // 여기서는 userRefresh 키가 끝난 상황을 키를 직접 지워서 만든다.
    it('userRefresh 키가 이미 없으면 refresh 키는 지워지지 않고 남는다', async () => {
      const [user, token] = [newId(), newId()];
      await store.rotateRefreshToken(user, token, 100);
      await redis.del(`userRefresh:${user}`);

      await store.removeRefreshTokens(user);

      expect(await store.findGithubIdByRefreshToken(token)).toBe(user);
    });

    // 옛 RefreshTokenDao는 Lua가 실패하면 경고를 남기고 키를 하나씩 바꾸는 길로 돌아갔다(improvement-candidates.md 14번).
    // 진짜 Redis에서 Lua만 실패하게 만들려고 eval 호출 하나만 던지게 바꾼다.
    describe('Lua가 실패하면 키를 하나씩 바꾸는 대체 경로로 돌아간다', () => {
      it('Lua가 성공하면 경고를 남기지 않는다', async () => {
        const warn = vi.spyOn(Logger.prototype, 'warn');

        await store.rotateRefreshToken(newId(), newId(), 100);

        expect(warn).not.toHaveBeenCalled();
      });

      it('경고를 남기고, Lua와 같은 결과를 만든다', async () => {
        const [user, first, second] = [newId(), newId(), newId()];
        await store.rotateRefreshToken(user, first, 100);
        const warn = vi
          .spyOn(Logger.prototype, 'warn')
          .mockImplementation(() => {});
        vi.spyOn(redis, 'eval').mockRejectedValueOnce(new Error('script off'));

        await store.rotateRefreshToken(user, second, 100);

        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining(user));
        expect(await store.findGithubIdByRefreshToken(first)).toBeUndefined();
        expect(await store.findGithubIdByRefreshToken(second)).toBe(user);
        expect(await redis.get(`userRefresh:${user}`)).toBe(second);
        await expectTtlAbout(`refresh:${second}`, 100);
        await expectTtlAbout(`userRefresh:${user}`, 100);
      });

      it('대체 경로까지 실패하면(Redis가 죽음) 예외를 던진다', async () => {
        vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
        vi.spyOn(redis, 'eval').mockRejectedValueOnce(new Error('script off'));
        vi.spyOn(redis, 'get').mockRejectedValueOnce(new Error('redis down'));

        await expect(
          store.rotateRefreshToken(newId(), newId(), 100),
        ).rejects.toThrow('redis down');
      });
    });
  });
});
