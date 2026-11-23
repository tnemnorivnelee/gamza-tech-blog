import type { Redis } from 'ioredis';
import { ReadCache } from '../../src/common/read-cache.js';

// 읽기 캐시 시험용 가짜 Redis다. ReadCache가 쓰는 두 명령(get, set ... EX)만 흉내 낸다.
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
