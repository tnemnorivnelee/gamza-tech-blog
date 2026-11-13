import { toLocalDateTime } from '../../common/local-date-time.js';
import type { CommentResponse } from './dto/comment-response.dto.js';

// 저장소가 주는 댓글 한 줄이다(한 글의 댓글 전부, 최상위와 답글 구분 없이).
export interface CommentRow {
  readonly commentId: number;
  // 최상위 댓글이면 null이다.
  readonly parentCommentId: number | null;
  readonly writer: string;
  readonly writerProfileImageUrl: string | null;
  readonly content: string;
  readonly createdAt: Date;
}

// 평평한 댓글 목록으로 옛 CommentMapper.mapToCommentTree가 만들던 트리를 만든다. 깊이에는 제한이 없다.
// - 최상위 댓글은 rows에 온 순서 그대로다(저장소가 작성 시각 내림차순으로 준다. 옛 쿼리의 order by createdAt desc).
// - 답글은 commentId 오름차순이다. 옛 코드는 순서를 정하지 않았고 DB가 부모 열의 색인 순서(= 기본 키 순서)로 줬다 [추정].
export function buildCommentTree(
  rows: readonly CommentRow[],
): CommentResponse[] {
  const repliesOf = new Map<number, CommentRow[]>();
  for (const row of rows) {
    if (row.parentCommentId === null) continue;
    const siblings = repliesOf.get(row.parentCommentId) ?? [];
    siblings.push(row);
    repliesOf.set(row.parentCommentId, siblings);
  }

  const toResponse = (row: CommentRow): CommentResponse => ({
    commentId: row.commentId,
    writer: row.writer,
    writerProfileImageUrl: row.writerProfileImageUrl,
    content: row.content,
    createdAt: toLocalDateTime(row.createdAt),
    replies: (repliesOf.get(row.commentId) ?? [])
      .toSorted((a, b) => a.commentId - b.commentId)
      .map(toResponse),
  });

  return rows.filter((row) => row.parentCommentId === null).map(toResponse);
}
