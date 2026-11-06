import { Injectable } from '@nestjs/common';
import { TokenStore } from './token-store.js';

// 키마다 만료 시각을 두는 맵. Redis 키의 만료(EX)처럼 지난 항목은 읽을 때 치운다.
class TtlMap<V> {
  private readonly entries = new Map<string, { value: V; expiresAt: number }>();

  set(key: string, value: V, ttlSeconds: number): void {
    this.entries.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  // Redis EXPIRE처럼 살아 있는 키의 만료만 새로 잡는다. 없는 키는 만들지 않는다.
  extend(key: string, ttlSeconds: number): void {
    const entry = this.entries.get(key);
    if (entry !== undefined && entry.expiresAt > Date.now()) {
      entry.expiresAt = Date.now() + ttlSeconds * 1000;
    }
  }
}

// 시험에서 Redis 대신 끼우는 가짜 저장소다(프론트 시험의 MSW 같은 역할). 운영 기본 구현은 RedisTokenStore다.
// 메모리에만 저장하고 재시작하면 사라진다. 진짜 Redis와 다른 점: 남은 수명 0으로 블랙리스트에 올려도 던지지 않는다(Redis는 던진다).
// @Injectable은 "Nest가 이 클래스를 만들고 주입할 수 있다"는 표시다.
@Injectable()
export class InMemoryTokenStore extends TokenStore {
  // 세 맵이 Redis의 세 키 종류와 같다. 키마다 만료가 따로라서 맵도 나눴다(reissue는 refresh 쪽만 늘린다).
  private readonly blacklist = new TtlMap<true>(); // blacklist:access:<토큰>
  private readonly githubIdByRefresh = new TtlMap<string>(); // refresh:<토큰>
  private readonly refreshByGithubId = new TtlMap<string>(); // userRefresh:<githubId>

  blacklistAccessToken(token: string, ttlSeconds: number): Promise<void> {
    this.blacklist.set(token, true, ttlSeconds);
    return Promise.resolve();
  }

  isAccessTokenBlacklisted(token: string): Promise<boolean> {
    return Promise.resolve(this.blacklist.get(token) !== undefined);
  }

  rotateRefreshToken(
    githubId: string,
    refreshToken: string,
    ttlSeconds: number,
  ): Promise<void> {
    const previous = this.refreshByGithubId.get(githubId);
    if (previous !== undefined) this.githubIdByRefresh.delete(previous);
    this.githubIdByRefresh.set(refreshToken, githubId, ttlSeconds);
    this.refreshByGithubId.set(githubId, refreshToken, ttlSeconds);
    return Promise.resolve();
  }

  findGithubIdByRefreshToken(
    refreshToken: string,
  ): Promise<string | undefined> {
    return Promise.resolve(this.githubIdByRefresh.get(refreshToken));
  }

  extendRefreshToken(refreshToken: string, ttlSeconds: number): Promise<void> {
    this.githubIdByRefresh.extend(refreshToken, ttlSeconds);
    return Promise.resolve();
  }

  removeRefreshTokens(githubId: string): Promise<void> {
    const refreshToken = this.refreshByGithubId.get(githubId);
    this.refreshByGithubId.delete(githubId);
    if (refreshToken !== undefined) this.githubIdByRefresh.delete(refreshToken);
    return Promise.resolve();
  }
}
