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
});
