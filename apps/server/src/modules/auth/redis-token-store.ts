import { Injectable, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { TokenStore } from './token-store.js';

// 키 이름은 옛 RefreshTokenDao·BlacklistServiceImpl과 같다.
const REFRESH_PREFIX = 'refresh:'; // refresh:<토큰> → githubId
const USER_REFRESH_PREFIX = 'userRefresh:'; // userRefresh:<githubId> → 토큰
const BLACKLIST_PREFIX = 'blacklist:access:'; // blacklist:access:<토큰> → "true"

// 옛 RefreshTokenDao.ROTATE_REFRESH_TOKEN_SCRIPT 그대로다. Lua는 Redis 안에서 도는 작은 스크립트이고,
// 스크립트 하나가 명령 하나로 처리되어 중간에 다른 요청이 끼어들 수 없다(동시 로그인에도 사용자당 토큰이 하나만 남는다).
// KEYS[1]=userRefresh:<githubId>, KEYS[2]=refresh:<새 토큰>, ARGV=[refresh: 접두사, githubId, 새 토큰, 수명(초)]
const ROTATE_REFRESH_TOKEN_SCRIPT = `
local userKey = KEYS[1]
local newTokenKey = KEYS[2]
local tokenPrefix = ARGV[1]
local userId = ARGV[2]
local newToken = ARGV[3]
local ttl = tonumber(ARGV[4])

local oldToken = redis.call('GET', userKey)
if oldToken then
	redis.call('DEL', tokenPrefix .. oldToken)
end

redis.call('SET', newTokenKey, userId, 'EX', ttl)
redis.call('SET', userKey, newToken, 'EX', ttl)
return 1
`;

// 토큰 상태를 Redis에 적는 TokenStore 구현이다. 생성자에 `redis: Redis`라고 적으면 Nest가 RedisModule의 연결을 넣어 준다(주입).
// 리프레시 교체 말고는 실패(연결 끊김 등)를 잡지 않고 던진다. 전역 예외 필터가 500 C004로 바꾼다.
@Injectable()
export class RedisTokenStore extends TokenStore {
  // Nest의 로그 도구. 출력 앞에 클래스 이름이 붙는다(console.log보다 구분하기 쉽다).
  private readonly logger = new Logger(RedisTokenStore.name);

  constructor(private readonly redis: Redis) {
    super();
  }

  // 남은 수명이 0이면 Redis가 SET EX 0을 거부해서 던진다. 옛 BlacklistServiceImpl도 남은 수명을 그대로 넘겼다(improvement-candidates.md 13번).
  async blacklistAccessToken(token: string, ttlSeconds: number): Promise<void> {
    await this.redis.set(BLACKLIST_PREFIX + token, 'true', 'EX', ttlSeconds);
  }

  async isAccessTokenBlacklisted(token: string): Promise<boolean> {
    return (await this.redis.exists(BLACKLIST_PREFIX + token)) === 1;
  }

  // 옛 RefreshTokenDao.rotateRefreshToken과 같다: Lua로 한 덩어리 교체를 먼저 시도하고, 실패하면 경고를 남기고 키를 하나씩 바꾼다.
  async rotateRefreshToken(
    githubId: string,
    refreshToken: string,
    ttlSeconds: number,
  ): Promise<void> {
    try {
      await this.redis.eval(
        ROTATE_REFRESH_TOKEN_SCRIPT,
        2, // KEYS의 개수. 이 뒤의 두 값이 KEYS, 나머지가 ARGV다.
        USER_REFRESH_PREFIX + githubId,
        REFRESH_PREFIX + refreshToken,
        REFRESH_PREFIX,
        githubId,
        refreshToken,
        Math.max(ttlSeconds, 1), // 옛 코드와 같다(0 이하의 수명을 막는다).
      );
      return;
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Lua refresh rotate 실패, 레거시 회전으로 폴백 githubId=${githubId} cause=${cause}`,
      );
    }
    await this.rotateRefreshTokenLegacy(githubId, refreshToken, ttlSeconds);
  }

  // 옛 rotateRefreshTokenLegacy 그대로다. 명령 네 개가 따로 가서 한 덩어리가 아니다(동시에 로그인하면 토큰이 둘 남을 수 있다).
  // 수명도 옛 코드처럼 그대로 넘긴다(Lua 쪽의 최소 1초 보정이 없다). improvement-candidates.md 14번.
  private async rotateRefreshTokenLegacy(
    githubId: string,
    refreshToken: string,
    ttlSeconds: number,
  ): Promise<void> {
    const userKey = USER_REFRESH_PREFIX + githubId;
    const oldToken = await this.redis.get(userKey);
    if (oldToken !== null) {
      await this.redis.del(REFRESH_PREFIX + oldToken);
    }
    await this.redis.set(
      REFRESH_PREFIX + refreshToken,
      githubId,
      'EX',
      ttlSeconds,
    );
    await this.redis.set(userKey, refreshToken, 'EX', ttlSeconds);
  }

  async findGithubIdByRefreshToken(
    refreshToken: string,
  ): Promise<string | undefined> {
    return (await this.redis.get(REFRESH_PREFIX + refreshToken)) ?? undefined;
  }

  // EXPIRE는 있는 키의 만료만 새로 잡고, 없는 키는 만들지 않는다.
  async extendRefreshToken(
    refreshToken: string,
    ttlSeconds: number,
  ): Promise<void> {
    await this.redis.expire(REFRESH_PREFIX + refreshToken, ttlSeconds);
  }

  // 옛 BlacklistServiceImpl과 같은 순서다: userRefresh를 읽고 지운 뒤, 그 값이 가리키는 refresh 키를 지운다.
  async removeRefreshTokens(githubId: string): Promise<void> {
    const userKey = USER_REFRESH_PREFIX + githubId;
    const refreshToken = await this.redis.get(userKey);
    await this.redis.del(userKey);
    if (refreshToken !== null) {
      await this.redis.del(REFRESH_PREFIX + refreshToken);
    }
  }
}
