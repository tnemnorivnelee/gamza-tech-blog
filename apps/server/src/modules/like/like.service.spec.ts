import { BusinessException } from '../../common/error/business.exception.js';
import { ErrorCode } from '../../common/error/error-code.js';
import { createReadCache } from '../../../test/support/fake-redis.js';
import type {
  LikePage,
  LikeRepository,
  LikeSummary,
} from './like.repository.js';
import { LikeService } from './like.service.js';

const like = (
  likeId: number,
  overrides: Partial<LikeSummary> = {},
): LikeSummary => ({
  likeId,
  postId: likeId + 100,
  title: `제목${likeId}`,
  content: '본문',
  writer: `감자${likeId}`,
  writerProfileImageUrl: null,
  thumbnailImageUrl: null,
  createdAt: new Date('2025-07-27T21:08:37.120Z'),
  tags: ['java'],
  ...overrides,
});

function setup(page: LikePage, liked: boolean | null = true) {
  const repo = {
    findMyLikePage: vi.fn().mockResolvedValue(page),
    isPostLikedBy: vi.fn().mockResolvedValue(liked),
  };
  // 캐시는 가짜 Redis 위의 진짜 ReadCache다. 시험마다 새로 만들어서 앞 시험의 캐시가 남지 않는다.
  const { redis, cache } = createReadCache();
  return {
    repo,
    redis,
    service: new LikeService(repo as unknown as LikeRepository, cache),
  };
}

describe('LikeService.getMyLikes', () => {
  it('저장소가 준 값을 응답 모양으로 바꾼다(날짜는 문자열, 값이 없는 이미지 주소는 null)', async () => {
    const { service } = setup({
      likes: [
        like(1, {
          writerProfileImageUrl: 'https://img.test/p.png',
          thumbnailImageUrl: 'https://img.test/t.png',
        }),
        like(2),
      ],
      totalElements: 2,
    });
    const response = await service.getMyLikes('octo', { page: 0, size: 10 });
    expect(response.content).toEqual([
      {
        likeId: 1,
        postId: 101,
        title: '제목1',
        contentSnippet: '본문',
        writer: '감자1',
        writerProfileImageUrl: 'https://img.test/p.png',
        thumbnailImageUrl: 'https://img.test/t.png',
        createdAt: '2025-07-27T21:08:37.12',
        tags: ['java'],
      },
      {
        likeId: 2,
        postId: 102,
        title: '제목2',
        contentSnippet: '본문',
        writer: '감자2',
        writerProfileImageUrl: null,
        thumbnailImageUrl: null,
        createdAt: '2025-07-27T21:08:37.12',
        tags: ['java'],
      },
    ]);
  });

  // 글 목록과 같은 규칙이다(옛 postUtil.makeSnippet(content, 100)): 이미지를 지우고 앞뒤 공백을 자른 뒤 100자를 넘으면 자르고 ...을 붙인다.
  it('본문은 이미지를 지우고 100자로 줄인다', async () => {
    const content = `![그림](https://img.test/a.png)  ${'가'.repeat(120)}  `;
    const { service } = setup({
      likes: [like(1, { content })],
      totalElements: 1,
    });
    const response = await service.getMyLikes('octo', { page: 0, size: 10 });
    expect(response.content[0].contentSnippet).toBe(`${'가'.repeat(100)}...`);
  });

  // 옛 코드가 태그 이름 목록을 만들 때 왼쪽 조인의 null을 걸러내지 않아서, 태그가 없는 글은 [null]이다.
  it('태그가 없는 글의 [null]을 그대로 내보낸다', async () => {
    const { service } = setup({
      likes: [like(1, { tags: [null] })],
      totalElements: 1,
    });
    const response = await service.getMyLikes('octo', { page: 0, size: 10 });
    expect(response.content[0].tags).toEqual([null]);
  });

  it('요청한 githubId와 쪽 정보를 저장소에 그대로 넘긴다', async () => {
    const { service, repo } = setup({ likes: [], totalElements: 0 });
    await service.getMyLikes('octo', { page: 3, size: 7 });
    expect(repo.findMyLikePage).toHaveBeenCalledWith('octo', {
      page: 3,
      size: 7,
    });
  });

  it('쪽 정보는 요청에서 고친 값이고, 총 쪽수는 개수를 크기로 나눠 올린다', async () => {
    const { service } = setup({ likes: [like(1)], totalElements: 25 });
    const response = await service.getMyLikes('octo', { page: 2, size: 10 });
    expect(response).toMatchObject({
      page: 2,
      size: 10,
      totalElements: 25,
      totalPages: 3,
    });
  });

  // 글 목록은 빈 쪽이면 0이지만 좋아요 목록은 쪽을 넘겨도 실제 전체 개수를 센다.
  it('범위를 넘긴 쪽도 저장소가 센 전체 개수를 그대로 쓴다', async () => {
    const { service } = setup({ likes: [], totalElements: 5 });
    const response = await service.getMyLikes('octo', { page: 99, size: 10 });
    expect(response).toMatchObject({
      content: [],
      page: 99,
      totalElements: 5,
      totalPages: 1,
    });
  });

  it('좋아요가 없으면 총 쪽수도 0이다', async () => {
    const { service } = setup({ likes: [], totalElements: 0 });
    const response = await service.getMyLikes('octo', { page: 0, size: 10 });
    expect(response.totalPages).toBe(0);
  });

  // 옛 @Cacheable(myLikes): 키는 "사용자-쪽-크기-정렬"이고 unless가 없다. 여기서는 사용자 id 대신 githubId를 쓰고 정렬은 뺀다(응답이 sort를 읽지 않는다).
  describe('읽기 캐시', () => {
    const first = { page: 0, size: 10 };

    it('myLikes 이름으로 5분 동안 저장하고, 다시 부르면 저장소를 부르지 않고 같은 값을 준다(null 태그도 그대로)', async () => {
      const { service, repo, redis } = setup({
        likes: [like(1, { tags: [null] }), like(2)],
        totalElements: 2,
      });
      const miss = await service.getMyLikes('octo', first);
      expect(redis.ttls.get('cache:myLikes:octo-0-10')).toBe(300);
      const hit = await service.getMyLikes('octo', first);
      expect(hit).toEqual(miss);
      expect(hit.content[0].tags).toEqual([null]);
      expect(repo.findMyLikePage).toHaveBeenCalledTimes(1);
    });

    it('사용자, 쪽 번호, 크기가 다르면 따로 저장한다', async () => {
      const { service, repo, redis } = setup({ likes: [], totalElements: 0 });
      await service.getMyLikes('octo', first);
      await service.getMyLikes('boss', first);
      await service.getMyLikes('octo', { page: 1, size: 10 });
      await service.getMyLikes('octo', { page: 0, size: 5 });
      expect([...redis.values.keys()].sort()).toEqual([
        'cache:myLikes:boss-0-10',
        'cache:myLikes:octo-0-10',
        'cache:myLikes:octo-0-5',
        'cache:myLikes:octo-1-10',
      ]);
      expect(repo.findMyLikePage).toHaveBeenCalledTimes(4);
    });

    // 글 목록과 달리 옛 myLikes에는 unless가 없어서 빈 쪽도 저장했다.
    it('빈 쪽도 저장한다', async () => {
      const { service, repo, redis } = setup({ likes: [], totalElements: 0 });
      await service.getMyLikes('octo', first);
      await service.getMyLikes('octo', first);
      expect(redis.values.size).toBe(1);
      expect(repo.findMyLikePage).toHaveBeenCalledTimes(1);
    });
  });
});

describe('LikeService.isPostLiked', () => {
  it.each([true, false])('저장소의 답(%s)을 그대로 돌려준다', async (liked) => {
    const { service, repo } = setup({ likes: [], totalElements: 0 }, liked);
    expect(await service.isPostLiked('octo', 7n)).toBe(liked);
    expect(repo.isPostLikedBy).toHaveBeenCalledWith('octo', 7n);
  });

  it('글이 없으면 404 P001이다', async () => {
    const { service } = setup({ likes: [], totalElements: 0 }, null);
    await expect(service.isPostLiked('octo', 7n)).rejects.toThrow(
      new BusinessException(ErrorCode.POST_NOT_FOUND),
    );
  });

  // 옛 isPostLiked에는 @Cacheable이 없었다. 누른 직후 바로 바뀌어 보여야 해서 캐시를 걸지 않는다.
  it('캐시를 거치지 않는다', async () => {
    const { service, repo, redis } = setup({ likes: [], totalElements: 0 });
    await service.isPostLiked('octo', 7n);
    await service.isPostLiked('octo', 7n);
    expect(redis.get).not.toHaveBeenCalled();
    expect(redis.values.size).toBe(0);
    expect(repo.isPostLikedBy).toHaveBeenCalledTimes(2);
  });
});
