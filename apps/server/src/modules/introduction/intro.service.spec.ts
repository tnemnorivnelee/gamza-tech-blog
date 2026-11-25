import { BusinessException } from '../../common/error/business.exception.js';
import { ErrorCode } from '../../common/error/error-code.js';
import { createReadCache } from '../../../test/support/fake-redis.js';
import type {
  CreateIntroResult,
  DeleteIntroResult,
  IntroPage,
  IntroRepository,
} from './intro.repository.js';
import { IntroService } from './intro.service.js';

const DEFAULT = [{ property: 'createdAt', direction: 'desc' }] as const;

const EMPTY: IntroPage = { intros: [], totalElements: 0 };

function setup(page: IntroPage = EMPTY) {
  const repo = {
    findIntroPage: vi.fn().mockResolvedValue(page),
    createIntro: vi.fn().mockResolvedValue({
      status: 'CREATED',
      intro: intro(5, 'https://img.test/p.png'),
    } as CreateIntroResult),
    deleteIntro: vi
      .fn()
      .mockResolvedValue({ status: 'DELETED' } as DeleteIntroResult),
  };
  // 캐시는 가짜 Redis 위의 진짜 ReadCache다. 시험마다 새로 만들어서 앞 시험의 캐시가 남지 않는다.
  const { redis, cache } = createReadCache();
  return {
    repo,
    redis,
    service: new IntroService(repo as unknown as IntroRepository, cache),
  };
}

const intro = (introId: number, profileImageUrl: string | null = null) => ({
  introId,
  userId: introId + 100,
  nickname: `감자${introId}`,
  profileImageUrl,
  content: '안녕하세요',
  createdAt: new Date('2025-07-27T21:08:37.120Z'),
});

describe('IntroService', () => {
  it('저장소가 준 값을 응답 모양으로 바꾼다(날짜는 문자열, 값이 없는 이미지 주소는 null)', async () => {
    const { service } = setup({
      intros: [intro(1, 'https://img.test/a.png'), intro(2)],
      totalElements: 2,
    });
    const response = await service.getIntroList({ page: 0, size: 10 }, DEFAULT);
    expect(response.content).toEqual([
      {
        introId: 1,
        userId: 101,
        nickname: '감자1',
        profileImageUrl: 'https://img.test/a.png',
        content: '안녕하세요',
        createdAt: '2025-07-27T21:08:37.12',
      },
      {
        introId: 2,
        userId: 102,
        nickname: '감자2',
        profileImageUrl: null,
        content: '안녕하세요',
        createdAt: '2025-07-27T21:08:37.12',
      },
    ]);
  });

  it('쪽 번호와 크기는 요청에서 고친 값을 그대로 돌려주고, 총 쪽수는 올림이다', async () => {
    const { service } = setup({ intros: [intro(1)], totalElements: 21 });
    const response = await service.getIntroList({ page: 2, size: 10 }, DEFAULT);
    expect(response).toMatchObject({
      page: 2,
      size: 10,
      totalElements: 21,
      totalPages: 3,
    });
  });

  // 글 목록은 범위를 넘기면 0을 돌려주지만 소개 목록은 실제 개수를 그대로 준다(옛 Spring Data의 Page).
  it('범위를 넘긴 쪽도 저장소가 센 전체 개수를 그대로 준다', async () => {
    const { service } = setup({ intros: [], totalElements: 5 });
    const response = await service.getIntroList({ page: 9, size: 2 }, DEFAULT);
    expect(response).toMatchObject({
      content: [],
      page: 9,
      size: 2,
      totalElements: 5,
      totalPages: 3,
    });
  });

  it('하나도 없으면 총 쪽수가 0이다', async () => {
    const { service } = setup({ intros: [], totalElements: 0 });
    const response = await service.getIntroList({ page: 0, size: 10 }, DEFAULT);
    expect(response.totalPages).toBe(0);
  });

  it('쪽과 정렬을 저장소에 그대로 넘긴다', async () => {
    const { service, repo } = setup({ intros: [], totalElements: 0 });
    const orders = [{ property: 'id', direction: 'asc' }] as const;
    await service.getIntroList({ page: 1, size: 4 }, orders);
    expect(repo.findIntroPage).toHaveBeenCalledWith(
      { page: 1, size: 4 },
      orders,
    );
  });

  // 옛 @Cacheable(introsList): 키는 'p:쪽:s:크기:sort:정렬'이고 정렬은 Spring Sort.toString() 모양이다. unless가 없다.
  describe('읽기 캐시', () => {
    const first = { page: 0, size: 10 };

    it('introsList 이름으로 5분 동안 저장하고, 다시 부르면 저장소를 부르지 않고 같은 값을 준다', async () => {
      const { service, repo, redis } = setup({
        intros: [intro(1, 'https://img.test/a.png'), intro(2)],
        totalElements: 2,
      });
      const miss = await service.getIntroList(first, DEFAULT);
      expect(
        redis.ttls.get('cache:introsList:p:0:s:10:sort:createdAt: DESC'),
      ).toBe(300);
      expect(await service.getIntroList(first, DEFAULT)).toEqual(miss);
      expect(repo.findIntroPage).toHaveBeenCalledTimes(1);
    });

    it('정렬이 여럿이면 쉼표만으로 잇는다(공백 없음)', async () => {
      const { service, redis } = setup({ intros: [], totalElements: 0 });
      await service.getIntroList(first, [
        { property: 'content', direction: 'asc' },
        { property: 'id', direction: 'desc' },
      ]);
      expect([...redis.values.keys()]).toEqual([
        'cache:introsList:p:0:s:10:sort:content: ASC,id: DESC',
      ]);
    });

    it('쪽 번호, 크기, 정렬이 다르면 따로 저장한다', async () => {
      const { service, repo, redis } = setup({ intros: [], totalElements: 0 });
      await service.getIntroList(first, DEFAULT);
      await service.getIntroList({ page: 1, size: 10 }, DEFAULT);
      await service.getIntroList({ page: 0, size: 5 }, DEFAULT);
      await service.getIntroList(first, [{ property: 'id', direction: 'asc' }]);
      expect(redis.values.size).toBe(4);
      expect(repo.findIntroPage).toHaveBeenCalledTimes(4);
    });

    // 글 목록과 달리 옛 introsList에는 unless가 없어서 빈 쪽도 저장했다.
    it('빈 쪽도 저장한다', async () => {
      const { service, repo, redis } = setup({ intros: [], totalElements: 0 });
      await service.getIntroList(first, DEFAULT);
      await service.getIntroList(first, DEFAULT);
      expect(redis.values.size).toBe(1);
      expect(repo.findIntroPage).toHaveBeenCalledTimes(1);
    });
  });
});

// 시험이 미리 채워 두는 캐시다. 쓰기가 무엇을 지우고 무엇을 남기는지 키 이름으로 본다.
function seedCaches(redis: { values: Map<string, string> }) {
  for (const key of [
    'cache:introsList:p:0:s:10:sort:createdAt: DESC',
    'cache:introsList:p:1:s:10:sort:createdAt: DESC',
    'cache:postDetail:7',
    'cache:userProfile:octo',
  ])
    redis.values.set(key, '1');
}

const UNTOUCHED = ['cache:postDetail:7', 'cache:userProfile:octo'];

describe('IntroService.createIntro', () => {
  it('저장소에 githubId와 내용을 그대로 넘긴다', async () => {
    const { service, repo } = setup();
    await service.createIntro('octo', '안녕하세요');
    expect(repo.createIntro).toHaveBeenCalledWith('octo', '안녕하세요');
  });

  it('만든 소개를 응답 모양으로 바꾼다(날짜는 문자열)', async () => {
    const { service } = setup();
    expect(await service.createIntro('octo', '안녕하세요')).toEqual({
      introId: 5,
      userId: 105,
      nickname: '감자5',
      profileImageUrl: 'https://img.test/p.png',
      content: '안녕하세요',
      createdAt: '2025-07-27T21:08:37.12',
    });
  });

  // 옛 @CacheEvict(introsList, allEntries = true): 쪽마다 따로 저장된 목록을 모두 지우고 다른 이름은 건드리지 않는다.
  it('성공하면 introsList를 모두 지우고 다른 캐시는 남긴다', async () => {
    const { service, redis } = setup();
    seedCaches(redis);
    await service.createIntro('octo', '안녕하세요');
    expect([...redis.values.keys()].sort()).toEqual(UNTOUCHED);
  });

  it('이미 썼으면 409 IN001이고 캐시를 지우지 않는다', async () => {
    const { service, repo, redis } = setup();
    repo.createIntro.mockResolvedValue({ status: 'ALREADY_EXISTS' });
    seedCaches(redis);
    await expect(service.createIntro('octo', '안녕하세요')).rejects.toThrow(
      new BusinessException(ErrorCode.INTRO_ALREADY_EXISTS),
    );
    expect(redis.values.size).toBe(4);
  });

  it('저장소가 던지면 그대로 던지고 캐시를 지우지 않는다', async () => {
    const { service, repo, redis } = setup();
    repo.createIntro.mockRejectedValue(new Error('db down'));
    seedCaches(redis);
    await expect(service.createIntro('octo', '안녕하세요')).rejects.toThrow(
      'db down',
    );
    expect(redis.values.size).toBe(4);
  });
});

describe('IntroService.deleteIntro', () => {
  it('저장소에 githubId와 소개 번호를 그대로 넘긴다', async () => {
    const { service, repo } = setup();
    await service.deleteIntro('octo', 3n);
    expect(repo.deleteIntro).toHaveBeenCalledWith('octo', 3n);
  });

  it('성공하면 introsList를 모두 지우고 다른 캐시는 남긴다', async () => {
    const { service, redis } = setup();
    seedCaches(redis);
    await service.deleteIntro('octo', 3n);
    expect([...redis.values.keys()].sort()).toEqual(UNTOUCHED);
  });

  it.each([
    ['NOT_FOUND', ErrorCode.INTRO_NOT_FOUND],
    ['FORBIDDEN', ErrorCode.INTRO_DELETE_FORBIDDEN],
  ] as const)(
    '%s이면 옛 오류로 바꾸고 캐시를 지우지 않는다',
    async (status, code) => {
      const { service, repo, redis } = setup();
      repo.deleteIntro.mockResolvedValue({ status });
      seedCaches(redis);
      await expect(service.deleteIntro('octo', 3n)).rejects.toThrow(
        new BusinessException(code),
      );
      expect(redis.values.size).toBe(4);
    },
  );
});

// 쓰기와 읽기 캐시가 이어지는 길이다: 목록을 읽어 캐시에 담고, 쓰기가 지우면 다음 읽기가 저장소를 다시 부른다.
describe('소개 쓰기 뒤의 읽기', () => {
  it('쓰면 캐시된 목록을 버리고 다음 읽기가 저장소를 다시 부른다', async () => {
    const { service, repo } = setup();
    await service.getIntroList({ page: 0, size: 10 }, DEFAULT);
    await service.getIntroList({ page: 0, size: 10 }, DEFAULT);
    expect(repo.findIntroPage).toHaveBeenCalledTimes(1);

    await service.createIntro('octo', '안녕하세요');
    await service.getIntroList({ page: 0, size: 10 }, DEFAULT);
    expect(repo.findIntroPage).toHaveBeenCalledTimes(2);
  });
});
