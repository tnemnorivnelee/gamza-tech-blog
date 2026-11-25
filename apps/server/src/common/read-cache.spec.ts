import { createReadCache, FakeRedis } from '../../test/support/fake-redis.js';
import { ReadCache } from './read-cache.js';

// 여기서는 ReadCache 자체의 규칙(적중, 저장 조건, 만료, 오류)을 가짜 Redis로 본다.
// 서비스마다 어떤 이름·키·unless를 쓰는지는 각 서비스 시험이 보고, 실제 Redis와의 약속은 read-cache.redis.spec.ts가 본다.
describe('ReadCache.cached', () => {
  it('없으면 읽어 와서 저장하고 돌려준다. 있으면 읽어 오지 않고 저장된 값을 준다', async () => {
    const { cache, redis } = createReadCache();
    const load = vi.fn().mockResolvedValue({ n: 1 });

    expect(await cache.cached('allTags', 'a', load)).toEqual({ n: 1 });
    expect(redis.values.get('cache:allTags:a')).toBe('{"n":1}');
    expect(await cache.cached('allTags', 'a', load)).toEqual({ n: 1 });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('저장된 값은 JSON을 거쳐 돌아오므로 읽어 온 값과 모양이 같아야 한다(null 칸, 빈 배열, 0, false, 빈 문자열)', async () => {
    const { cache } = createReadCache();
    const value = { a: null, b: [], c: 0, d: false, e: '', f: [null] };
    await cache.cached('allTags', 'a', () => Promise.resolve(value));
    expect(
      await cache.cached('allTags', 'a', () => Promise.reject(new Error('x'))),
    ).toStrictEqual(value);
  });

  it('이름과 키가 모두 같아야 같은 값이다', async () => {
    const { cache, redis } = createReadCache();
    await cache.cached('allTags', 'k', () => Promise.resolve(1));
    await cache.cached('allTags', 'other', () => Promise.resolve(2));
    await cache.cached('introsList', 'k', () => Promise.resolve(3));
    expect([...redis.values.entries()].sort()).toEqual([
      ['cache:allTags:k', '1'],
      ['cache:allTags:other', '2'],
      ['cache:introsList:k', '3'],
    ]);
  });

  describe('만료(초)', () => {
    it.each([
      ['postsList', 300],
      ['postDetail', 300],
      ['myPosts', 300],
      ['postsByTag', 300],
      ['searchPosts', 300],
      ['homeFeed', 300],
      ['introsList', 300],
      ['myLikes', 300],
      ['userProfile', 300],
      ['publicProfileAggregate', 300],
      ['hotPosts', 1800],
      ['allTags', 3600],
    ] as const)('%s는 %i초', async (name, ttl) => {
      const { cache, redis } = createReadCache();
      await cache.cached(name, 'k', () => Promise.resolve('v'));
      expect(redis.ttls.get(`cache:${name}:k`)).toBe(ttl);
      expect(redis.set).toHaveBeenCalledWith(
        `cache:${name}:k`,
        '"v"',
        'EX',
        ttl,
      );
    });
  });

  // 옛 disableCachingNullValues: null은 저장하지 않는다.
  it('null은 저장하지 않는다', async () => {
    const { cache, redis } = createReadCache();
    const load = vi.fn().mockResolvedValue(null);
    expect(await cache.cached('allTags', 'a', load)).toBeNull();
    await cache.cached('allTags', 'a', load);
    expect(redis.set).not.toHaveBeenCalled();
    expect(load).toHaveBeenCalledTimes(2);
  });

  // 0, false, ''는 값이다. null만 건너뛴다.
  it.each([0, false, '', [], {}])('%j는 저장한다', async (value) => {
    const { cache, redis } = createReadCache();
    await cache.cached('allTags', 'a', () => Promise.resolve(value));
    expect(redis.set).toHaveBeenCalledTimes(1);
  });

  describe('unless', () => {
    it('true를 돌려주면 저장하지 않고 값은 그대로 준다', async () => {
      const { cache, redis } = createReadCache();
      const load = vi.fn().mockResolvedValue([]);
      const unless = vi.fn((value: unknown[]) => value.length === 0);
      expect(await cache.cached('postsList', 'a', load, unless)).toEqual([]);
      await cache.cached('postsList', 'a', load, unless);
      expect(unless).toHaveBeenCalledWith([]);
      expect(redis.set).not.toHaveBeenCalled();
      expect(load).toHaveBeenCalledTimes(2);
    });

    it('false를 돌려주면 저장한다', async () => {
      const { cache, redis } = createReadCache();
      const unless = (value: unknown[]) => value.length === 0;
      await cache.cached('postsList', 'a', () => Promise.resolve([1]), unless);
      expect(redis.values.size).toBe(1);
    });

    // 적중한 값에는 unless를 묻지 않는다(저장할 때만 본다).
    it('적중하면 unless를 부르지 않는다', async () => {
      const { cache } = createReadCache();
      const unless = vi.fn().mockReturnValue(false);
      await cache.cached('postsList', 'a', () => Promise.resolve(1), unless);
      await cache.cached('postsList', 'a', () => Promise.resolve(1), unless);
      expect(unless).toHaveBeenCalledTimes(1);
    });
  });

  // 옛 Spring의 기본 오류 처리는 캐시 오류를 다시 던졌다. 같은 동작이고, 전역 예외 필터가 500 C004로 바꾼다.
  describe('Redis 오류는 삼키지 않고 던진다', () => {
    it('읽을 때(get) 실패하면 읽어 오는 함수를 부르지 않고 던진다', async () => {
      const redis = new FakeRedis();
      redis.get.mockRejectedValue(new Error('redis down'));
      const cache = new ReadCache(redis.asRedis());
      const load = vi.fn().mockResolvedValue(1);
      await expect(cache.cached('allTags', 'a', load)).rejects.toThrow(
        'redis down',
      );
      expect(load).not.toHaveBeenCalled();
    });

    it('저장할 때(set) 실패해도 던진다', async () => {
      const redis = new FakeRedis();
      redis.set.mockRejectedValue(new Error('redis down'));
      const cache = new ReadCache(redis.asRedis());
      await expect(
        cache.cached('allTags', 'a', () => Promise.resolve(1)),
      ).rejects.toThrow('redis down');
    });

    it('읽어 오는 함수의 오류는 그대로 던지고 저장하지 않는다', async () => {
      const { cache, redis } = createReadCache();
      await expect(
        cache.cached('allTags', 'a', () => Promise.reject(new Error('db'))),
      ).rejects.toThrow('db');
      expect(redis.set).not.toHaveBeenCalled();
    });
  });
});

// 옛 @CacheEvict: 쓰기가 성공한 뒤 낡은 값을 지운다. 지운 뒤 읽으면 다시 읽어 와서 새 값이 저장된다.
describe('ReadCache.evict', () => {
  it('그 이름과 키만 지우고 다른 키·다른 이름은 그대로 둔다', async () => {
    const { cache, redis } = createReadCache();
    await cache.cached('postDetail', '1', () => Promise.resolve('a'));
    await cache.cached('postDetail', '2', () => Promise.resolve('b'));
    await cache.cached('myLikes', '1', () => Promise.resolve('c'));

    await cache.evict('postDetail', '1');

    expect([...redis.values.keys()].sort()).toEqual([
      'cache:myLikes:1',
      'cache:postDetail:2',
    ]);
  });

  it('없는 키를 지워도 오류가 아니다', async () => {
    const { cache } = createReadCache();
    await expect(cache.evict('postDetail', '404')).resolves.toBeUndefined();
  });

  it('지운 뒤 읽으면 읽어 오는 함수를 다시 부른다', async () => {
    const { cache } = createReadCache();
    const load = vi.fn().mockResolvedValueOnce('old').mockResolvedValue('new');
    expect(await cache.cached('postDetail', '1', load)).toBe('old');
    await cache.evict('postDetail', '1');
    expect(await cache.cached('postDetail', '1', load)).toBe('new');
  });

  it('Redis 오류는 삼키지 않고 던진다', async () => {
    const redis = new FakeRedis();
    redis.del.mockRejectedValue(new Error('redis down'));
    const cache = new ReadCache(redis.asRedis());
    await expect(cache.evict('postDetail', '1')).rejects.toThrow('redis down');
  });
});

describe('ReadCache.evictAll', () => {
  it('그 이름의 키를 모두 지우고 다른 이름의 키는 그대로 둔다', async () => {
    const { cache, redis } = createReadCache();
    await cache.cached('myLikes', 'octo-0-10', () => Promise.resolve(1));
    await cache.cached('myLikes', 'boss-0-10', () => Promise.resolve(2));
    await cache.cached('postDetail', '1', () => Promise.resolve(3));

    await cache.evictAll('myLikes');

    expect([...redis.values.keys()]).toEqual(['cache:postDetail:1']);
  });

  // 가짜 SCAN은 두 개씩 끊어 준다. 다섯 키를 모두 지우면 커서를 끝까지 따라간 것이다.
  it('SCAN이 나눠 주는 쪽을 끝까지 따라가며 지운다', async () => {
    const { cache, redis } = createReadCache();
    for (const n of [1, 2, 3, 4, 5])
      await cache.cached('myLikes', `u${n}`, () => Promise.resolve(n));
    await cache.cached('postDetail', '1', () => Promise.resolve(0));

    await cache.evictAll('myLikes');

    expect([...redis.values.keys()]).toEqual(['cache:postDetail:1']);
    expect(redis.scan.mock.calls.length).toBeGreaterThan(1);
  });

  // 이름 뒤의 ':'까지 맞춘다. 캐시가 아닌 키(로그인 토큰 등)는 접두사가 달라 걸리지 않는다.
  it("패턴은 'cache:<이름>:*'이다", async () => {
    const { cache, redis } = createReadCache();
    await cache.evictAll('introsList');
    expect(redis.scan).toHaveBeenCalledWith(
      '0',
      'MATCH',
      'cache:introsList:*',
      'COUNT',
      expect.any(Number),
    );
  });

  it('지울 키가 없으면 지우기 명령을 부르지 않는다', async () => {
    const { cache, redis } = createReadCache();
    await cache.evictAll('myLikes');
    expect(redis.del).not.toHaveBeenCalled();
  });

  it('Redis 오류는 삼키지 않고 던진다', async () => {
    const redis = new FakeRedis();
    redis.scan.mockRejectedValue(new Error('redis down'));
    const cache = new ReadCache(redis.asRedis());
    await expect(cache.evictAll('myLikes')).rejects.toThrow('redis down');
  });
});
