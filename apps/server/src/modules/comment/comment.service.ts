import { Injectable } from '@nestjs/common';
import { PagedResponse } from '../../common/dto/paged-response.dto.js';
import { toLocalDateTime } from '../../common/local-date-time.js';
import type { PageRequest, SortOrder } from '../../common/pageable.js';
import { CommentRepository } from './comment.repository.js';
import type { CommentListResponse } from './dto/comment-list-response.dto.js';

// @Injectable: Nest가 만들어 다른 클래스의 생성자에 넣어 주는 부품이라는 표시다.
@Injectable()
export class CommentService {
  constructor(private readonly comments: CommentRepository) {}

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
