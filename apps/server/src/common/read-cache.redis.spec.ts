import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { ReadCache } from './read-cache.js';

// 진짜 Redis로 하는 시험이다. 키 모양, 저장된 JSON, 실제 만료(TTL)는 가짜로는 증명할 수 없다.
// 접속 정보는 앱과 같은 환경변수를 읽고, 없으면 로컬 Compose 주소(127.0.0.1:6379)를 쓴다(redis-token-store.spec.ts와 같다).
const options = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: Number(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
};

async function canConnect(): Promise<boolean> {
  const probe = new Redis({
    ...options,
    lazyConnect: true,
    retryStrategy: () => null,
    maxRetriesPerRequest: 0,
  });
  probe.on('error', () => {}); // 연결 실패는 결과(false)로만 쓴다.
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
// 로컬에는 Redis가 없을 수 있어 건너뛴다. CI에는 서비스 컨테이너가 항상 있어야 하므로 건너뛰지 않고 실패시킨다.
if (!reachable && process.env.CI) {
  throw new Error(
    'CI인데 Redis에 연결할 수 없습니다. .github/workflows/ci.yml의 services.redis를 확인하세요.',
  );
}

describe.skipIf(!reachable)('ReadCache (진짜 Redis)', () => {
  let redis: Redis;
  let cache: ReadCache;
  // 시험이 만든 키. 끝나면 이 키만 지운다. 개발용 Redis에는 로그인 토큰도 있어서 SCAN이나 FLUSH는 쓰지 않는다.
  const created: string[] = [];

  // 진짜 캐시 이름 아래에 시험마다 겹치지 않는 키 조각을 쓴다. 개발 서버가 쓰는 키와 같은 이름 공간이어도 값이 섞이지 않는다.
  const newKey = (name: string) => {
    const key = `readcache-test-${randomUUID()}`;
    created.push(`cache:${name}:${key}`);
    return key;
  };

  beforeAll(() => {
    redis = new Redis({ ...options, maxRetriesPerRequest: 1 });
    cache = new ReadCache(redis);
  });

  afterEach(async () => {
    if (created.length > 0) await redis.del(...created.splice(0));
  });

  afterAll(async () => {
    await redis.quit();
  });

  // 남은 수명이 기대한 값 근처인지 본다(시험이 도는 사이 몇 초는 흐를 수 있다).
  const expectTtlNear = async (key: string, seconds: number) => {
    const ttl = await redis.ttl(key);
    expect(ttl).toBeGreaterThan(seconds - 10);
    expect(ttl).toBeLessThanOrEqual(seconds);
  };

  it('cache:<이름>:<키> 모양의 키에 JSON 문자열로 저장한다', async () => {
    const key = newKey('introsList');
    const value = { content: [{ introId: 1, profileImageUrl: null }], page: 0 };
    await cache.cached('introsList', key, () => Promise.resolve(value));
    expect(await redis.get(`cache:introsList:${key}`)).toBe(
      JSON.stringify(value),
    );
  });

  it('적중하면 읽어 오는 함수를 부르지 않고 저장된 값을 준다', async () => {
    const key = newKey('postsList');
    const load = vi.fn().mockResolvedValue({ n: 1 });
    await cache.cached('postsList', key, load);
    expect(await cache.cached('postsList', key, load)).toEqual({ n: 1 });
    expect(load).toHaveBeenCalledTimes(1);
  });

  // 닉네임 키에는 한글이 들어간다.
  it('한글과 공백, 쉼표가 든 키도 그대로 저장하고 다시 찾는다', async () => {
    const key = `${newKey('postsList')}-[감자, 고구마]-0-10`;
    created.push(`cache:postsList:${key}`);
    const load = vi.fn().mockResolvedValue(['값']);
    await cache.cached('postsList', key, load);
    expect(await cache.cached('postsList', key, load)).toEqual(['값']);
    expect(load).toHaveBeenCalledTimes(1);
  });

  describe('실제 만료(초)', () => {
    it.each([
      ['postsList', 300],
      ['hotPosts', 1800],
      ['allTags', 3600],
    ] as const)('%s는 %i초', async (name, seconds) => {
      const key = newKey(name);
      await cache.cached(name, key, () => Promise.resolve('v'));
      await expectTtlNear(`cache:${name}:${key}`, seconds);
    });
  });

  it('null과 unless가 막은 값은 저장하지 않는다', async () => {
    const nullKey = newKey('postsList');
    const emptyKey = newKey('postsList');
    await cache.cached('postsList', nullKey, () => Promise.resolve(null));
    await cache.cached(
      'postsList',
      emptyKey,
      () => Promise.resolve([] as number[]),
      (value) => value.length === 0,
    );
    expect(await redis.exists(`cache:postsList:${nullKey}`)).toBe(0);
    expect(await redis.exists(`cache:postsList:${emptyKey}`)).toBe(0);
  });

  describe('evict', () => {
    it('그 키 하나만 지우고 같은 이름의 다른 키는 남긴다', async () => {
      const gone = newKey('postDetail');
      const kept = newKey('postDetail');
      await cache.cached('postDetail', gone, () => Promise.resolve('a'));
      await cache.cached('postDetail', kept, () => Promise.resolve('b'));

      await cache.evict('postDetail', gone);

      expect(await redis.exists(`cache:postDetail:${gone}`)).toBe(0);
      expect(await redis.get(`cache:postDetail:${kept}`)).toBe('"b"');
    });

    it('지운 뒤 읽으면 새로 읽어 와서 저장한다', async () => {
      const key = newKey('postDetail');
      const load = vi
        .fn()
        .mockResolvedValueOnce('old')
        .mockResolvedValue('new');
      await cache.cached('postDetail', key, load);
      await cache.evict('postDetail', key);
      expect(await cache.cached('postDetail', key, load)).toBe('new');
      expect(await redis.get(`cache:postDetail:${key}`)).toBe('"new"');
    });
  });

  // evictAll은 그 이름의 캐시를 모두 지운다. 개발용 Redis에서 개발 서버가 쓰던 같은 이름의 캐시도 함께 지워지지만 캐시는
  // 다시 채워지는 값이다. 로그인 토큰 같은 캐시 아닌 키는 접두사가 달라 걸리지 않는다는 것을 아래에서 확인한다.
  // 같은 이름을 쓰는 시험은 이 파일 안에서 차례로 돌기 때문에 서로의 키를 지우지 않는다.
  describe('evictAll', () => {
    it('그 이름의 키를 모두 지우고 다른 이름의 키와 캐시 아닌 키는 남긴다', async () => {
      const a = newKey('userProfile');
      const b = `${newKey('userProfile')}-한글 키`;
      created.push(`cache:userProfile:${b}`);
      const other = newKey('myLikes');
      await cache.cached('userProfile', a, () => Promise.resolve(1));
      await cache.cached('userProfile', b, () => Promise.resolve(2));
      await cache.cached('myLikes', other, () => Promise.resolve(3));
      const notCache = `readcache-test-token:${randomUUID()}`;
      created.push(notCache);
      await redis.set(notCache, 'x');

      await cache.evictAll('userProfile');

      expect(await redis.exists(`cache:userProfile:${a}`)).toBe(0);
      expect(await redis.exists(`cache:userProfile:${b}`)).toBe(0);
      expect(await redis.exists(`cache:myLikes:${other}`)).toBe(1);
      expect(await redis.exists(notCache)).toBe(1);
    });

    // SCAN은 한 번에 일부만 훑는다(힌트 100). 250개를 모두 지우면 커서를 끝까지 따라간 것이다.
    it('SCAN 한 번에 다 못 훑는 많은 키도 모두 지운다', async () => {
      const prefix = `readcache-test-${randomUUID()}`;
      const keys = Array.from(
        { length: 250 },
        (_, n) => `cache:publicProfileAggregate:${prefix}-${n}`,
      );
      created.push(...keys);
      await redis.mset(keys.flatMap((key) => [key, '1']));

      await cache.evictAll('publicProfileAggregate');

      expect(await redis.exists(...keys)).toBe(0);
    });

    it('지울 키가 없어도 오류가 아니다', async () => {
      await expect(cache.evictAll('hotPosts')).resolves.toBeUndefined();
    });
  });

  it('이름이 다르면 같은 키 조각이어도 따로 저장한다', async () => {
    const key = newKey('postsList');
    created.push(`cache:myPosts:${key}`);
    await cache.cached('postsList', key, () => Promise.resolve('a'));
    await cache.cached('myPosts', key, () => Promise.resolve('b'));
    expect(await redis.get(`cache:postsList:${key}`)).toBe('"a"');
    expect(await redis.get(`cache:myPosts:${key}`)).toBe('"b"');
  });
});
