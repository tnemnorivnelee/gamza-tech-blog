import { InMemoryTokenStore } from './in-memory-token-store.js';

describe('InMemoryTokenStore', () => {
  afterEach(() => vi.useRealTimers());

  it('올리지 않은 토큰은 블랙리스트에 없다', async () => {
    expect(await new InMemoryTokenStore().isAccessTokenBlacklisted('a')).toBe(
      false,
    );
  });

  it('올린 토큰은 수명 동안만 블랙리스트에 있다(Redis 키 만료처럼)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const store = new InMemoryTokenStore();
    await store.blacklistAccessToken('a', 10);

    expect(await store.isAccessTokenBlacklisted('a')).toBe(true);
    expect(await store.isAccessTokenBlacklisted('b')).toBe(false);

    vi.setSystemTime(Date.now() + 9_999);
    expect(await store.isAccessTokenBlacklisted('a')).toBe(true);
    vi.setSystemTime(Date.now() + 1);
    expect(await store.isAccessTokenBlacklisted('a')).toBe(false);
  });

  describe('리프레시 토큰', () => {
    // 만료 시각을 비교하는 시험이라 Date만 가짜로 바꾼다.
    const start = new Date('2030-01-01T00:00:00.000Z').getTime();
    const advance = (seconds: number) =>
      vi.setSystemTime(Date.now() + seconds * 1000);
    const newStore = () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(start);
      return new InMemoryTokenStore();
    };

    it('저장한 토큰의 주인을 찾고, 모르는 토큰은 undefined다', async () => {
      const store = newStore();
      await store.rotateRefreshToken('octo', 'r1', 100);
      expect(await store.findGithubIdByRefreshToken('r1')).toBe('octo');
      expect(await store.findGithubIdByRefreshToken('nope')).toBeUndefined();
    });

    it('수명이 지나면 찾을 수 없다', async () => {
      const store = newStore();
      await store.rotateRefreshToken('octo', 'r1', 100);
      advance(99);
      expect(await store.findGithubIdByRefreshToken('r1')).toBe('octo');
      advance(1);
      expect(await store.findGithubIdByRefreshToken('r1')).toBeUndefined();
    });

    it('새 토큰으로 바꾸면 이전 토큰은 무효가 된다(사용자당 하나)', async () => {
      const store = newStore();
      await store.rotateRefreshToken('octo', 'r1', 100);
      await store.rotateRefreshToken('octo', 'r2', 100);
      expect(await store.findGithubIdByRefreshToken('r1')).toBeUndefined();
      expect(await store.findGithubIdByRefreshToken('r2')).toBe('octo');
    });

    it('다른 사용자의 토큰은 건드리지 않는다', async () => {
      const store = newStore();
      await store.rotateRefreshToken('octo', 'r1', 100);
      await store.rotateRefreshToken('boss', 'r2', 100);
      expect(await store.findGithubIdByRefreshToken('r1')).toBe('octo');
    });

    it('사용자의 토큰을 지운다', async () => {
      const store = newStore();
      await store.rotateRefreshToken('octo', 'r1', 100);
      await store.removeRefreshTokens('octo');
      expect(await store.findGithubIdByRefreshToken('r1')).toBeUndefined();
      // 없는 사용자를 지워도 아무 일 없다.
      await expect(
        store.removeRefreshTokens('nobody'),
      ).resolves.toBeUndefined();
    });

    it('만료를 늘리면 refresh 키만 늘어난다. 늘리지 않은 userRefresh 키는 원래 수명에 끝난다', async () => {
      const store = newStore();
      await store.rotateRefreshToken('octo', 'r1', 100);
      advance(90);
      await store.extendRefreshToken('r1', 100); // refresh 키는 t=190까지
      advance(20); // t=110: userRefresh 키(t=100)는 끝났고 refresh 키는 살아 있다
      expect(await store.findGithubIdByRefreshToken('r1')).toBe('octo');

      // userRefresh 키가 없어서 지우기가 r1을 찾지 못한다. 그래서 refresh 키가 남는다(improvement-candidates.md 12번).
      await store.removeRefreshTokens('octo');
      expect(await store.findGithubIdByRefreshToken('r1')).toBe('octo');
    });

    it('없거나 이미 끝난 토큰의 만료는 늘리지 않는다(Redis EXPIRE처럼)', async () => {
      const store = newStore();
      await store.extendRefreshToken('ghost', 100);
      expect(await store.findGithubIdByRefreshToken('ghost')).toBeUndefined();

      await store.rotateRefreshToken('octo', 'r1', 10);
      advance(10);
      await store.extendRefreshToken('r1', 100);
      expect(await store.findGithubIdByRefreshToken('r1')).toBeUndefined();
    });
  });
});
