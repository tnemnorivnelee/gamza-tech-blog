import { BusinessException } from '../../common/error/business.exception.js';
import { ErrorCode } from '../../common/error/error-code.js';
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
  return {
    repo,
    service: new LikeService(repo as unknown as LikeRepository),
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
});
