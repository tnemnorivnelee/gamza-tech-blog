import { Injectable } from '@nestjs/common';
import { TokenStore } from './token-store.js';

// shortcut: 메모리에만 저장하고 재시작하면 사라진다. 만료된 항목은 조회할 때만 치워서 오래 두면 쌓인다. M2-4에서 Redis 구현으로 바꾼다.
// @Injectable은 "Nest가 이 클래스를 만들고 주입할 수 있다"는 표시다.
@Injectable()
export class InMemoryTokenStore extends TokenStore {
  // 토큰 → 블랙리스트에서 빠지는 시각(밀리초). Redis의 키 만료 시각과 같은 역할이다.
  private readonly blacklist = new Map<string, number>();

  blacklistAccessToken(token: string, ttlSeconds: number): Promise<void> {
    this.blacklist.set(token, Date.now() + ttlSeconds * 1000);
    return Promise.resolve();
  }

  isAccessTokenBlacklisted(token: string): Promise<boolean> {
    const expiresAt = this.blacklist.get(token);
    if (expiresAt === undefined) return Promise.resolve(false);
    if (expiresAt <= Date.now()) {
      this.blacklist.delete(token);
      return Promise.resolve(false);
    }
    return Promise.resolve(true);
  }
}
