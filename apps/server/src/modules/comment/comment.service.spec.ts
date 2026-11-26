import { BusinessException } from '../../common/error/business.exception.js';
import { ErrorCode } from '../../common/error/error-code.js';
import { createReadCache } from '../../../test/support/fake-redis.js';
import type { CommentRow } from './comment-tree.js';
import type {
  CommentRepository,
  CreateCommentResult,
  DeleteCommentResult,
  MyCommentPage,
  MyCommentSummary,
} from './comment.repository.js';
import { CommentService } from './comment.service.js';

const DEFAULT = [{ property: 'createdAt', direction: 'desc' }] as const;

const comment = (commentId: number): MyCommentSummary => ({
  commentId,
  content: `댓글${commentId}`,
  createdAt: new Date('2025-07-27T21:08:37.120Z'),
  postId: commentId + 100,
  postTitle: `제목${commentId}`,
});

const EMPTY: MyCommentPage = { comments: [], totalElements: 0 };

const created = (overrides: Partial<CommentRow> = {}): CreateCommentResult => ({
  status: 'CREATED',
  comment: {
    commentId: 9,
    parentCommentId: null,
    writer: '감자',
    writerProfileImageUrl: null,
    content: '새 댓글',
    createdAt: new Date('2025-07-27T21:08:37.120Z'),
    ...overrides,
  },
});

function setup(page: MyCommentPage = EMPTY) {
  const repo = {
    findMyCommentPage: vi.fn().mockResolvedValue(page),
    createComment: vi.fn().mockResolvedValue(created()),
    deleteComment: vi.fn().mockResolvedValue({
      status: 'DELETED',
      postId: 7,
    } as DeleteCommentResult),
  };
  // 캐시는 가짜 Redis 위의 진짜 ReadCache다. 시험마다 새로 만들어서 앞 시험의 캐시가 남지 않는다.
  const { redis, cache } = createReadCache();
  return {
    repo,
    redis,
    service: new CommentService(repo as unknown as CommentRepository, cache),
  };
}

describe('CommentService.getMyComments', () => {
  it('저장소가 준 값을 응답 모양으로 바꾼다(날짜는 문자열)', async () => {
    const { service } = setup({
      comments: [comment(1), comment(2)],
      totalElements: 2,
    });
    const response = await service.getMyComments(
      'octo',
      { page: 0, size: 10 },
      DEFAULT,
    );
    expect(response.content).toEqual([
      {
        commentId: 1,
        content: '댓글1',
        createdAt: '2025-07-27T21:08:37.12',
        postId: 101,
        postTitle: '제목1',
      },
      {
        commentId: 2,
        content: '댓글2',
        createdAt: '2025-07-27T21:08:37.12',
        postId: 102,
        postTitle: '제목2',
      },
    ]);
  });

  it('요청한 githubId, 쪽 정보, 정렬을 저장소에 그대로 넘긴다', async () => {
    const { service, repo } = setup({ comments: [], totalElements: 0 });
    const orders = [{ property: 'content', direction: 'asc' }] as const;
    await service.getMyComments('octo', { page: 3, size: 7 }, orders);
    expect(repo.findMyCommentPage).toHaveBeenCalledWith(
      'octo',
      { page: 3, size: 7 },
      orders,
    );
  });

  it('쪽 정보는 요청에서 고친 값이고, 총 쪽수는 개수를 크기로 나눠 올린다', async () => {
    const { service } = setup({ comments: [comment(1)], totalElements: 25 });
    const response = await service.getMyComments(
      'octo',
      { page: 2, size: 10 },
      DEFAULT,
    );
    expect(response).toMatchObject({
      page: 2,
      size: 10,
      totalElements: 25,
      totalPages: 3,
    });
  });

  // 글 목록은 빈 쪽이면 0이지만 내 댓글 목록은 쪽을 넘겨도 실제 전체 개수를 센다.
  it('범위를 넘긴 쪽도 저장소가 센 전체 개수를 그대로 쓴다', async () => {
    const { service } = setup({ comments: [], totalElements: 5 });
    const response = await service.getMyComments(
      'octo',
      { page: 99, size: 10 },
      DEFAULT,
    );
    expect(response).toMatchObject({
      content: [],
      page: 99,
      totalElements: 5,
      totalPages: 1,
    });
  });

  it('댓글이 없으면 총 쪽수도 0이다', async () => {
    const { service } = setup({ comments: [], totalElements: 0 });
    const response = await service.getMyComments(
      'octo',
      { page: 0, size: 10 },
      DEFAULT,
    );
    expect(response.totalPages).toBe(0);
  });
});

// 시험이 미리 채워 두는 캐시다. 쓰기가 무엇을 지우고 무엇을 남기는지 키 이름으로 본다.
function seedCaches(redis: { values: Map<string, string> }) {
  for (const key of [
    'cache:postDetail:7',
    'cache:postDetail:8',
    'cache:postsList:0-10-all',
    'cache:myLikes:octo-0-10',
  ])
    redis.values.set(key, '1');
}

describe('CommentService.addComment', () => {
  it('저장소에 githubId, 글 번호, 내용, 부모 번호를 그대로 넘긴다', async () => {
    const { service, repo } = setup();
    await service.addComment('octo', 7n, '내용', 3n);
    expect(repo.createComment).toHaveBeenCalledWith('octo', 7n, '내용', 3n);
  });

  // 방금 쓴 댓글이라 답글이 없다. 날짜는 문자열, 프로필 이미지가 없으면 키를 빼지 않고 null이다.
  it('만든 댓글을 응답 모양으로 바꾼다(replies는 빈 목록)', async () => {
    const { service } = setup();
    expect(await service.addComment('octo', 7n, '새 댓글', null)).toEqual({
      commentId: 9,
      writer: '감자',
      writerProfileImageUrl: null,
      content: '새 댓글',
      createdAt: '2025-07-27T21:08:37.12',
      replies: [],
    });
  });

  // 답글을 쓴 경우에도 응답은 그 댓글 하나다(부모 아래로 끼워 넣지 않는다. 옛 mapToCommentTree(saved)).
  it('답글을 써도 응답은 그 댓글 하나다', async () => {
    const { service, repo } = setup();
    repo.createComment.mockResolvedValue(
      created({ commentId: 10, parentCommentId: 9, content: '답글' }),
    );
    expect(await service.addComment('octo', 7n, '답글', 9n)).toMatchObject({
      commentId: 10,
      content: '답글',
      replies: [],
    });
  });

  // 옛 evictPostDetailCache(postId): 그 글의 postDetail 하나만 지운다.
  it('성공하면 그 글의 postDetail만 지운다', async () => {
    const { service, redis } = setup();
    seedCaches(redis);
    await service.addComment('octo', 7n, '내용', null);
    expect([...redis.values.keys()].sort()).toEqual([
      'cache:myLikes:octo-0-10',
      'cache:postDetail:8',
      'cache:postsList:0-10-all',
    ]);
  });

  it.each([
    ['POST_NOT_FOUND', ErrorCode.POST_NOT_FOUND],
    ['PARENT_NOT_FOUND', ErrorCode.COMMENT_NOT_FOUND],
    ['PARENT_OF_OTHER_POST', ErrorCode.COMMENT_INVALID_PARENT],
  ] as const)(
    '%s이면 옛 오류로 바꾸고 캐시를 지우지 않는다',
    async (status, code) => {
      const { service, repo, redis } = setup();
      repo.createComment.mockResolvedValue({ status });
      seedCaches(redis);
      await expect(service.addComment('octo', 7n, '내용', 3n)).rejects.toThrow(
        new BusinessException(code),
      );
      expect(redis.values.size).toBe(4);
    },
  );

  it('저장소가 던지면 그대로 던지고 캐시를 지우지 않는다', async () => {
    const { service, repo, redis } = setup();
    repo.createComment.mockRejectedValue(new Error('db down'));
    seedCaches(redis);
    await expect(service.addComment('octo', 7n, '내용', null)).rejects.toThrow(
      'db down',
    );
    expect(redis.values.size).toBe(4);
  });

  // 지우는 중 Redis가 실패하면 오류가 올라간다(34번). 이미 저장은 끝났다.
  it('캐시를 지우다 실패하면 던진다(저장은 이미 끝난 뒤다)', async () => {
    const { service, repo, redis } = setup();
    redis.del.mockRejectedValue(new Error('redis down'));
    await expect(service.addComment('octo', 7n, '내용', null)).rejects.toThrow(
      'redis down',
    );
    expect(repo.createComment).toHaveBeenCalledTimes(1);
  });
});

describe('CommentService.deleteComment', () => {
  it('저장소에 githubId와 댓글 번호를 그대로 넘긴다', async () => {
    const { service, repo } = setup();
    await service.deleteComment('octo', 3n);
    expect(repo.deleteComment).toHaveBeenCalledWith('octo', 3n);
  });

  // 지울 글은 요청이 아니라 저장소가 알려 준 "그 댓글이 달려 있던 글"이다.
  it('성공하면 그 댓글이 달려 있던 글의 postDetail만 지운다', async () => {
    const { service, redis } = setup();
    seedCaches(redis);
    await service.deleteComment('octo', 3n);
    expect([...redis.values.keys()].sort()).toEqual([
      'cache:myLikes:octo-0-10',
      'cache:postDetail:8',
      'cache:postsList:0-10-all',
    ]);
  });

  it.each([
    ['COMMENT_NOT_FOUND', ErrorCode.COMMENT_NOT_FOUND],
    ['FORBIDDEN', ErrorCode.COMMENT_FORBIDDEN],
  ] as const)(
    '%s이면 옛 오류로 바꾸고 캐시를 지우지 않는다',
    async (status, code) => {
      const { service, repo, redis } = setup();
      repo.deleteComment.mockResolvedValue({ status });
      seedCaches(redis);
      await expect(service.deleteComment('octo', 3n)).rejects.toThrow(
        new BusinessException(code),
      );
      expect(redis.values.size).toBe(4);
    },
  );

  it('저장소가 던지면 그대로 던지고 캐시를 지우지 않는다', async () => {
    const { service, repo, redis } = setup();
    repo.deleteComment.mockRejectedValue(new Error('db down'));
    seedCaches(redis);
    await expect(service.deleteComment('octo', 3n)).rejects.toThrow('db down');
    expect(redis.values.size).toBe(4);
  });
});
