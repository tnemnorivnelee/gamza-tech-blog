import { Injectable } from '@nestjs/common';
import { PagedResponse } from '../../common/dto/paged-response.dto.js';
import { BusinessException } from '../../common/error/business.exception.js';
import { ErrorCode } from '../../common/error/error-code.js';
import { toLocalDateTime } from '../../common/local-date-time.js';
import type { PageRequest } from '../../common/pageable.js';
import { makeContentSnippet } from '../post/post-snippet.js';
import type { LikeResponse } from './dto/like-response.dto.js';
import { type LikeSummary, LikeRepository } from './like.repository.js';

const toLikeResponse = (like: LikeSummary): LikeResponse => ({
  likeId: like.likeId,
  postId: like.postId,
  title: like.title,
  // 글 목록과 같은 규칙이다(옛 postUtil.makeSnippet(content, 100)).
  contentSnippet: makeContentSnippet(like.content),
  writer: like.writer,
  writerProfileImageUrl: like.writerProfileImageUrl,
  thumbnailImageUrl: like.thumbnailImageUrl,
  createdAt: toLocalDateTime(like.createdAt),
  tags: like.tags,
});

// @Injectable: Nest가 만들어 다른 클래스의 생성자에 넣어 주는 부품이라는 표시다.
// 옛 @Cacheable("myLikes")은 읽기 캐시 단계(M5-5)에서 getMyLikes에 붙인다.
@Injectable()
export class LikeService {
  constructor(private readonly likes: LikeRepository) {}

  // page와 size는 요청에서 고친 값을 그대로 돌려준다. 총 쪽수는 Spring의 Page.getTotalPages()와 같다.
  async getMyLikes(
    githubId: string,
    { page, size }: PageRequest,
  ): Promise<PagedResponse<LikeResponse>> {
    const { likes, totalElements } = await this.likes.findMyLikePage(githubId, {
      page,
      size,
    });
    return new PagedResponse(
      likes.map(toLikeResponse),
      page,
      size,
      totalElements,
      Math.ceil(totalElements / size),
    );
  }

  // 글이 없으면 404 P001이다(옛 PostValidator.validatePostExists).
  async isPostLiked(githubId: string, postId: bigint): Promise<boolean> {
    const liked = await this.likes.isPostLikedBy(githubId, postId);
    if (liked === null) throw new BusinessException(ErrorCode.POST_NOT_FOUND);
    return liked;
  }
}
