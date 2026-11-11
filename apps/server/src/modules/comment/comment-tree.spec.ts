import { type CommentRow, buildCommentTree } from './comment-tree.js';

const row = (
  commentId: number,
  parentCommentId: number | null,
  overrides: Partial<CommentRow> = {},
): CommentRow => ({
  commentId,
  parentCommentId,
  writer: `작성자${commentId}`,
  writerProfileImageUrl: null,
  content: `내용${commentId}`,
  createdAt: new Date(Date.UTC(2025, 6, 27, 21, 8, commentId)),
  ...overrides,
});

describe('buildCommentTree', () => {
  it('댓글이 없으면 빈 목록이다', () => {
    expect(buildCommentTree([])).toEqual([]);
  });

  it('응답 모양으로 바꾼다(날짜는 문자열, 이미지가 없으면 null, 답글이 없으면 빈 목록)', () => {
    const [comment] = buildCommentTree([
      row(1, null, {
        writerProfileImageUrl: 'https://img.test/a.png',
        createdAt: new Date('2025-07-27T21:08:37.109Z'),
      }),
    ]);
    expect(comment).toEqual({
      commentId: 1,
      writer: '작성자1',
      writerProfileImageUrl: 'https://img.test/a.png',
      content: '내용1',
      createdAt: '2025-07-27T21:08:37.109',
      replies: [],
    });
    expect(
      buildCommentTree([row(2, null)])[0].writerProfileImageUrl,
    ).toBeNull();
  });

  it('최상위 댓글은 받은 순서 그대로다(저장소가 이미 최신순으로 준다)', () => {
    const tree = buildCommentTree([row(5, null), row(9, null), row(2, null)]);
    expect(tree.map((comment) => comment.commentId)).toEqual([5, 9, 2]);
  });

  it('답글은 부모 아래에 commentId 오름차순으로 붙고, 최상위에는 나오지 않는다', () => {
    // 저장소는 작성 시각 내림차순으로 주므로 답글도 큰 번호가 먼저 온다.
    const tree = buildCommentTree([
      row(8, 1),
      row(7, null),
      row(6, 1),
      row(1, null),
    ]);
    expect(tree.map((comment) => comment.commentId)).toEqual([7, 1]);
    expect(tree[0].replies).toEqual([]);
    expect(tree[1].replies?.map((reply) => reply.commentId)).toEqual([6, 8]);
  });

  it('깊이에 제한이 없다(답글의 답글)', () => {
    const [root] = buildCommentTree([
      row(4, 3),
      row(3, 2),
      row(2, 1),
      row(1, null),
    ]);
    expect(root.replies?.[0].replies?.[0].replies?.[0]).toMatchObject({
      commentId: 4,
      replies: [],
    });
  });

  it('여러 최상위 댓글의 답글은 각자의 부모에게만 붙는다', () => {
    const tree = buildCommentTree([
      row(10, 1),
      row(20, 2),
      row(2, null),
      row(1, null),
    ]);
    expect(
      tree.map((c) => [c.commentId, c.replies?.map((r) => r.commentId)]),
    ).toEqual([
      [2, [20]],
      [1, [10]],
    ]);
  });
});
