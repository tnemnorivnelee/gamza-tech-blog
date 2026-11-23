import { Injectable } from '@nestjs/common';
import { PagedResponse } from '../../common/dto/paged-response.dto.js';
import { BusinessException } from '../../common/error/business.exception.js';
import { ErrorCode } from '../../common/error/error-code.js';
import { toLocalDateTime } from '../../common/local-date-time.js';
import type { PageRequest } from '../../common/pageable.js';
import { ReadCache } from '../../common/read-cache.js';
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
// 옛 @Cacheable(myLikes)을 getMyLikes에 건다. 옛 코드는 unless가 없어서 빈 쪽도 저장했다.
@Injectable()
export class LikeService {
  constructor(
    private readonly likes: LikeRepository,
    private readonly cache: ReadCache,
  ) {}

  // 옛 키는 "사용자 id-쪽 번호-쪽 크기-정렬 문자열"이다. 여기서는 사용자 id 대신 githubId를 쓰고 정렬은 키에 넣지 않는다.
  // 이 목록은 요청의 sort를 읽지 않아서 sort가 달라도 응답이 같기 때문이다(옛 서버는 sort마다 따로 저장했다).
  getMyLikes(githubId: string, page: PageRequest) {
    return this.cache.cached(
      'myLikes',
      `${githubId}-${page.page}-${page.size}`,
      () => this.loadMyLikes(githubId, page),
    );
  }

  // 글이 없으면 404 P001이다(옛 PostValidator.validatePostExists). 캐시가 없다.
  async isPostLiked(githubId: string, postId: bigint): Promise<boolean> {
    const liked = await this.likes.isPostLikedBy(githubId, postId);
    if (liked === null) throw new BusinessException(ErrorCode.POST_NOT_FOUND);
    return liked;
  }

  // page와 size는 요청에서 고친 값을 그대로 돌려준다. 총 쪽수는 Spring의 Page.getTotalPages()와 같다.
  private async loadMyLikes(
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
}
