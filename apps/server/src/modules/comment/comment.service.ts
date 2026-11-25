import { Injectable } from '@nestjs/common';
import { PagedResponse } from '../../common/dto/paged-response.dto.js';
import { BusinessException } from '../../common/error/business.exception.js';
import { ErrorCode } from '../../common/error/error-code.js';
import { toLocalDateTime } from '../../common/local-date-time.js';
import type { PageRequest, SortOrder } from '../../common/pageable.js';
import { ReadCache } from '../../common/read-cache.js';
import { toCommentResponse } from './comment-tree.js';
import { CommentRepository } from './comment.repository.js';
import type { CommentListResponse } from './dto/comment-list-response.dto.js';
import type { CommentResponse } from './dto/comment-response.dto.js';

// @Injectable: Nest가 만들어 다른 클래스의 생성자에 넣어 주는 부품이라는 표시다.
// 댓글을 쓰고 지우면 그 글의 postDetail 캐시를 지운다(옛 CommentServiceImpl.evictPostDetailCache). 다른 캐시는 지우지 않았다.
@Injectable()
export class CommentService {
  constructor(
    private readonly comments: CommentRepository,
    private readonly cache: ReadCache,
  ) {}

  // 글이 없으면 404 P001, 부모 댓글이 없으면 404 CM001, 부모가 다른 글의 댓글이면 400 CM004다. 성공한 뒤에만 캐시를 지운다.
  // 방금 쓴 댓글이라 replies는 빈 목록이다. content는 검사하지 않고 저장소에 넘긴다(옛 컨트롤러에 @Valid가 없었다).
  async addComment(
    githubId: string,
    postId: bigint,
    content: string,
    parentCommentId: bigint | null,
  ): Promise<CommentResponse> {
    const result = await this.comments.createComment(
      githubId,
      postId,
      content,
      parentCommentId,
    );
    if (result.status === 'POST_NOT_FOUND')
      throw new BusinessException(ErrorCode.POST_NOT_FOUND);
    if (result.status === 'PARENT_NOT_FOUND')
      throw new BusinessException(ErrorCode.COMMENT_NOT_FOUND);
    if (result.status === 'PARENT_OF_OTHER_POST')
      throw new BusinessException(ErrorCode.COMMENT_INVALID_PARENT);
    await this.cache.evict('postDetail', String(postId));
    return toCommentResponse(result.comment, []);
  }

  // 댓글이 없으면 404 CM001, 쓴 사람이 아니면 403 CM002다. 답글도 함께 지워지고, 지운 댓글이 달려 있던 글의 postDetail을 지운다.
  async deleteComment(githubId: string, commentId: bigint): Promise<void> {
    const result = await this.comments.deleteComment(githubId, commentId);
    if (result.status === 'COMMENT_NOT_FOUND')
      throw new BusinessException(ErrorCode.COMMENT_NOT_FOUND);
    if (result.status === 'FORBIDDEN')
      throw new BusinessException(ErrorCode.COMMENT_FORBIDDEN);
    await this.cache.evict('postDetail', String(result.postId));
  }

  // page와 size는 요청에서 고친 값을 그대로 돌려준다. 총 쪽수는 Spring의 Page.getTotalPages()와 같다.
  async getMyComments(
    githubId: string,
    { page, size }: PageRequest,
    orders: readonly SortOrder[],
  ): Promise<PagedResponse<CommentListResponse>> {
    const { comments, totalElements } = await this.comments.findMyCommentPage(
      githubId,
      { page, size },
      orders,
    );
    return new PagedResponse(
      comments.map((comment) => ({
        commentId: comment.commentId,
        content: comment.content,
        createdAt: toLocalDateTime(comment.createdAt),
        postId: comment.postId,
        postTitle: comment.postTitle,
      })),
      page,
      size,
      totalElements,
      Math.ceil(totalElements / size),
    );
  }
}
