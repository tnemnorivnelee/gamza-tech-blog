import type {
  CommentRepository,
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

function setup(page: MyCommentPage) {
  const repo = { findMyCommentPage: vi.fn().mockResolvedValue(page) };
  return {
    repo,
    service: new CommentService(repo as unknown as CommentRepository),
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
