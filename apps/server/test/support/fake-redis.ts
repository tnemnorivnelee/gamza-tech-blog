import type { Redis } from 'ioredis';
import { ReadCache } from '../../src/common/read-cache.js';

// 읽기 캐시 시험용 가짜 Redis다. ReadCache가 쓰는 명령(get, set ... EX, del, scan MATCH 접두사*)만 흉내 낸다.
// 실제 만료와 키 형식은 진짜 Redis로 하는 시험(read-cache.spec.ts)이 본다. 진짜 Redis 연결은 닿지 않을 때
// 재시도하느라 시험이 멈출 수 있어서, 서비스 시험은 이 가짜만 쓴다.
export class FakeRedis {
  // 저장된 값(JSON 문자열)과 만료(초)다. 시험이 키 이름과 만료를 직접 본다.
  readonly values = new Map<string, string>();
  readonly ttls = new Map<string, number>();

  get = vi.fn((key: string): Promise<string | null> =>
    Promise.resolve(this.values.get(key) ?? null),
  );

  set = vi.fn(
    (key: string, value: string, _mode: string, ttl: number): Promise<'OK'> => {
      this.values.set(key, value);
      this.ttls.set(key, ttl);
      return Promise.resolve('OK');
    },
  );

  // 지운 키의 개수를 준다. 진짜 Redis처럼 없는 키는 세지 않는다.
  del = vi.fn((...keys: string[]): Promise<number> => {
    let removed = 0;
    for (const key of keys) {
      if (this.values.delete(key)) removed += 1;
      this.ttls.delete(key);
    }
    return Promise.resolve(removed);
  });

  // 'cache:이름:*'처럼 끝이 *인 패턴만 읽는다. 진짜 SCAN처럼 한 번에 다 주지 않고 PAGE_SIZE개씩 나눠서 커서를 돌려준다.
  // 그래서 ReadCache.evictAll이 커서를 끝까지 따라가는지 볼 수 있다. 커서는 마지막으로 준 키다(글자 순으로 그 뒤부터 이어 준다).
  // 위치 번호로 이으면 지운 만큼 밀려서 키를 건너뛴다. 진짜 SCAN은 도중에 지워도 남은 키를 건너뛰지 않는다.
  static readonly PAGE_SIZE = 2;
  scan = vi.fn(
    (
      cursor: string,
      _match: 'MATCH',
      pattern: string,
      _count: 'COUNT',
      _hint: number,
    ): Promise<[string, string[]]> => {
      const prefix = pattern.slice(0, -1);
      const rest = [...this.values.keys()]
        .filter(
          (key) => key.startsWith(prefix) && (cursor === '0' || key > cursor),
        )
        .sort();
      const page = rest.slice(0, FakeRedis.PAGE_SIZE);
      const done = rest.length <= FakeRedis.PAGE_SIZE;
      return Promise.resolve([done ? '0' : page[page.length - 1], page]);
    },
  );

  // ReadCache는 Redis 클래스를 받는다. 쓰는 명령이 같아서 이 가짜를 그 자리에 끼운다.
  asRedis(): Redis {
    return this as unknown as Redis;
  }
}

// 가짜 Redis 위에 진짜 ReadCache를 만든다. 시험은 redis의 values와 ttls로 무엇이 어떤 키·만료로 저장됐는지 본다.
export function createReadCache() {
  const redis = new FakeRedis();
  return { redis, cache: new ReadCache(redis.asRedis()) };
}
