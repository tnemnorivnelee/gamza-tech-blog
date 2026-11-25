import { Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';

// 옛 서버의 캐시 이름이다(CacheConfig와 각 서비스의 @Cacheable). 프로젝트 캐시와 쓰이지 않는 frequentPosts는 옮기지 않는다.
// 이름을 타입으로 묶어 두면 오타가 컴파일에서 잡힌다.
export type CacheName =
  | 'postsList'
  | 'postDetail'
  | 'myPosts'
  | 'hotPosts'
  | 'postsByTag'
  | 'searchPosts'
  | 'homeFeed'
  | 'allTags'
  | 'introsList'
  | 'myLikes'
  | 'userProfile'
  | 'publicProfileAggregate';

// 옛 CacheConfig의 만료: 기본 5분, hotPosts 30분, allTags 60분. Redis의 EX는 초 단위다.
const DEFAULT_TTL_SECONDS = 5 * 60;
const TTL_SECONDS: Partial<Record<CacheName, number>> = {
  hotPosts: 30 * 60,
  allTags: 60 * 60,
};

// SCAN이 한 번에 훑어 보는 키 수의 힌트다(정확한 개수가 아니다). 캐시 키는 이름마다 수백 개 안팎이라 작게 둔다.
const EVICT_SCAN_COUNT = 100;

// 옛 Spring의 @Cacheable에 해당하는 읽기 캐시다. 프론트로 치면 서버 쪽 SWR이다: 같은 요청을 만료될 때까지 DB 없이 돌려준다.
// 서비스의 메서드 하나가 캐시 이름, 키, 읽어 오는 함수를 넘기면 있을 때는 Redis의 값을, 없을 때는 읽어 온 값을 저장하고 돌려준다.
// @Injectable: Nest가 만들어 다른 클래스의 생성자에 넣어 주는 부품이라는 표시다. `redis: Redis`는 RedisModule의 연결이 들어온다.
//
// 옛 동작과 같은 점:
// - 키는 cache:<이름>:<키>이다(옛 computePrefixWith).
// - null은 저장하지 않는다(옛 disableCachingNullValues).
// - Redis 오류는 삼키지 않고 던진다. 옛 Spring의 기본 오류 처리(SimpleCacheErrorHandler)도 다시 던졌고, 전역 예외 필터가 500 C004로 바꾼다.
//   Redis가 죽으면 캐시가 걸린 읽기가 모두 실패한다(improvement-candidates.md 34번).
// - 이름이 같고 키가 같으면 같은 값이다. 자동으로 지워지는 것은 만료뿐이고, 쓰기 API가 evict·evictAll로 지운다(M6).
//   지우는 중 Redis가 실패하면 그 오류도 던진다. 이때 DB 쓰기는 이미 끝나 있어서 사용자는 500을 받지만 쓴 내용은 남는다(34번).
//
// 옛 동작과 다른 점: 값을 Jackson 기본 타입 정보(@class)가 든 JSON이 아니라 보통 JSON으로 저장한다.
// 그래서 이 서버를 옛 서버가 쓰던 Redis에 연결하면 안 된다(같은 키에 모양이 다른 값이 있다).
@Injectable()
export class ReadCache {
  constructor(private readonly redis: Redis) {}

  // unless는 옛 @Cacheable(unless = ...)이다. 값을 받아 true를 돌려주면 그 값은 저장하지 않는다(예: 빈 쪽).
  // 목록마다 다르다: 빈 결과를 저장하지 않는 곳도, 저장하는 곳도 있어서 호출하는 쪽이 정한다.
  // 값은 JSON을 거치므로 Date나 bigint가 들어 있으면 안 된다(적중하면 문자열이 되거나, 저장할 때 오류가 난다).
  async cached<T>(
    name: CacheName,
    key: string,
    load: () => Promise<T>,
    unless?: (value: T) => boolean,
  ): Promise<T> {
    const redisKey = `cache:${name}:${key}`;
    const hit = await this.redis.get(redisKey);
    if (hit !== null) return JSON.parse(hit) as T;

    const value = await load();
    if (value != null && !unless?.(value)) {
      await this.redis.set(
        redisKey,
        JSON.stringify(value),
        'EX',
        TTL_SECONDS[name] ?? DEFAULT_TTL_SECONDS,
      );
    }
    return value;
  }

  // 키 하나를 지운다(옛 @CacheEvict(value, key)). 없는 키는 아무 일도 없다. 쓰기가 성공한 뒤에 부른다.
  // 프론트로 치면 SWR의 mutate(key)다: 다음 읽기가 DB에서 새로 읽어 온다.
  async evict(name: CacheName, key: string): Promise<void> {
    await this.redis.del(`cache:${name}:${key}`);
  }

  // 이름 전체를 지운다(옛 @CacheEvict(allEntries = true)). 키는 사용자와 쪽마다 흩어져 있어서 cache:<이름>:*를 찾아 지운다.
  // KEYS는 키가 많으면 훑는 동안 Redis가 다른 요청을 못 받아서, 조금씩 나눠 훑는 SCAN을 쓴다. 이름 뒤의 ':'까지 맞춰서
  // 다른 이름의 키와 로그인 토큰 같은 캐시 아닌 키는 건드리지 않는다.
  // SCAN이 같은 키를 두 번 줄 수 있어도 없는 키를 지우는 것은 해롭지 않다. 훑는 도중에 새로 생긴 키는 놓칠 수 있다.
  async evictAll(name: CacheName): Promise<void> {
    let cursor = '0';
    do {
      const [next, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        `cache:${name}:*`,
        'COUNT',
        EVICT_SCAN_COUNT,
      );
      if (keys.length > 0) await this.redis.del(...keys);
      cursor = next;
    } while (cursor !== '0');
  }
}
