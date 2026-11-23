import { createReadCache } from '../../../test/support/fake-redis.js';
import type { TagRepository } from './tag.repository.js';
import { TagService } from './tag.service.js';

function setup(names: string[] = ['nest', 'prisma']) {
  const repo = { findAllTagNames: vi.fn().mockResolvedValue(names) };
  // 캐시는 가짜 Redis 위의 진짜 ReadCache다. 시험마다 새로 만들어서 앞 시험의 캐시가 남지 않는다.
  const { redis, cache } = createReadCache();
  return {
    repo,
    redis,
    service: new TagService(repo as unknown as TagRepository, cache),
  };
}

describe('TagService.getAllTags', () => {
  it('저장소가 준 태그 이름을 그대로 준다', async () => {
    const { service } = setup();
    expect(await service.getAllTags()).toEqual(['nest', 'prisma']);
  });

  // 옛 @Cacheable(allTags): 키는 'all'이고 만료는 60분이다.
  it('allTags 이름에 all 키로 60분 동안 저장하고, 다시 부르면 저장소를 부르지 않고 같은 값을 준다', async () => {
    const { service, repo, redis } = setup();
    const miss = await service.getAllTags();
    expect(redis.ttls.get('cache:allTags:all')).toBe(3600);
    expect(await service.getAllTags()).toEqual(miss);
    expect(repo.findAllTagNames).toHaveBeenCalledTimes(1);
  });

  // 옛 allTags에는 unless가 없어서 태그가 하나도 없는 빈 목록도 저장했다.
  it('빈 목록도 저장한다', async () => {
    const { service, repo, redis } = setup([]);
    expect(await service.getAllTags()).toEqual([]);
    expect(await service.getAllTags()).toEqual([]);
    expect(redis.values.get('cache:allTags:all')).toBe('[]');
    expect(repo.findAllTagNames).toHaveBeenCalledTimes(1);
  });
});
