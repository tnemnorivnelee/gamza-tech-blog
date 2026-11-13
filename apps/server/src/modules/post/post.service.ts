import { Injectable } from '@nestjs/common';
import { PagedResponse } from '../../common/dto/paged-response.dto.js';
import { BusinessException } from '../../common/error/business.exception.js';
import { ErrorCode } from '../../common/error/error-code.js';
import { toLocalDateTime } from '../../common/local-date-time.js';
import type { PageRequest } from '../../common/pageable.js';
import { buildCommentTree } from '../comment/comment-tree.js';
import { TagService } from '../tag/tag.service.js';
import type { HomeFeedResponse } from './dto/home-feed-response.dto.js';
import type { PostDetailResponse } from './dto/post-detail-response.dto.js';
import type { PostListResponse } from './dto/post-list-response.dto.js';
import type { PostPopularResponse } from './dto/post-popular-response.dto.js';
import { makeContentSnippet } from './post-snippet.js';
import {
  type PostPage,
  PostRepository,
  type PostSummary,
} from './post.repository.js';

// 인기 글은 최근 1주 안에 쓴 글 중 3개다(옛 getWeeklyPopularPosts).
const POPULAR_LIMIT = 3;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
// DB의 DATETIME에는 서울 벽시계 값이 들어 있다. 옛 LocalDateTime.now()와 같은 기준의 "지금"을 만들려고 9시간을 더한다.
// prisma-user.repository.ts의 kstWallClockNow와 같은 규칙이다. 쓰는 곳이 셋이 되면 공용으로 뽑는다.
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

const toPostListResponse = (post: PostSummary): PostListResponse => ({
  postId: post.postId,
  title: post.title,
  contentSnippet: makeContentSnippet(post.content),
  writer: post.writer,
  writerProfileImageUrl: post.writerProfileImageUrl,
  createdAt: toLocalDateTime(post.createdAt),
  tags: post.tags,
  thumbnailImageUrl: post.thumbnailImageUrl,
});

// 서비스는 저장소가 준 값을 응답 모양으로 바꾼다(요약 글, 날짜 문자열, 쪽 정보). 옛 PostServiceImpl과 PostListResponse가 하던 일이다.
// @Injectable: Nest가 생성자의 부품(PostRepository)을 찾아 넣어 주는 대상이라는 표시다.
// 옛 @Cacheable은 읽기 캐시 단계(M5-5)에서 이 메서드들에 붙인다.
// 옛 getHomeFeed는 같은 클래스의 getWeeklyPopularPosts와 getPosts를 직접 불렀다. Spring의 캐시는 프록시를 거쳐야 걸려서,
// 그 안쪽 두 호출에는 캐시가 걸리지 않았고 TagService(다른 빈)와 homeFeed 자체만 걸렸다. M5-5에서 캐시를 붙일 때 이 점을 맞춘다.
@Injectable()
export class PostService {
  constructor(
    private readonly posts: PostRepository,
    private readonly tagService: TagService,
  ) {}

  async getPosts(page: PageRequest, tags: string[]) {
    return this.toPagedResponse(
      page,
      await this.posts.findAllPosts(page, tags),
    );
  }

  async getPostsByTag(tagName: string, page: PageRequest) {
    return this.toPagedResponse(
      page,
      await this.posts.findAllPosts(page, [tagName]),
    );
  }

  async searchPostsByTitle(page: PageRequest, keyword: string) {
    return this.toPagedResponse(
      page,
      await this.posts.searchPostsByTitle(page, keyword),
    );
  }

  async getMyPosts(githubId: string, page: PageRequest) {
    return this.toPagedResponse(
      page,
      await this.posts.findPostsByWriter(page, githubId),
    );
  }

  // 글이 없으면 404 P001이다.
  async getPostDetail(postId: bigint): Promise<PostDetailResponse> {
    const post = await this.posts.findPostDetail(postId);
    if (!post) throw new BusinessException(ErrorCode.POST_NOT_FOUND);
    return {
      postId: post.postId,
      title: post.title,
      content: post.content,
      writer: post.writer,
      writerProfileImageUrl: post.writerProfileImageUrl,
      likesCount: post.likesCount,
      githubId: post.githubId,
      createdAt: toLocalDateTime(post.createdAt),
      updatedAt: toLocalDateTime(post.updatedAt),
      tags: post.tags,
      comments: buildCommentTree(post.comments),
    };
  }

  getWeeklyPopularPosts(): Promise<PostPopularResponse[]> {
    const since = new Date(Date.now() + KST_OFFSET_MS - WEEK_MS);
    return this.posts.findWeeklyPopularPosts(since, POPULAR_LIMIT);
  }

  // 세 조회는 서로 기다릴 이유가 없어서 함께 보낸다(옛 코드는 차례로 불렀지만 결과는 같다).
  async getHomeFeed(
    page: PageRequest,
    tags: string[],
  ): Promise<HomeFeedResponse> {
    const [weeklyPopular, latest, allTags] = await Promise.all([
      this.getWeeklyPopularPosts(),
      this.getPosts(page, tags),
      this.tagService.getAllTags(),
    ]);
    return { weeklyPopular, latest, allTags };
  }

  // page와 size는 요청에서 고친 값을 그대로 돌려준다(내용의 개수가 아니다). 총 쪽수는 Spring의 Page.getTotalPages()와 같다.
  private toPagedResponse(
    { page, size }: PageRequest,
    { posts, totalElements }: PostPage,
  ): PagedResponse<PostListResponse> {
    return new PagedResponse(
      posts.map(toPostListResponse),
      page,
      size,
      totalElements,
      Math.ceil(totalElements / size),
    );
  }
}
