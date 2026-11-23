import { Injectable } from '@nestjs/common';
import { PagedResponse } from '../../common/dto/paged-response.dto.js';
import { BusinessException } from '../../common/error/business.exception.js';
import { ErrorCode } from '../../common/error/error-code.js';
import { toLocalDateTime } from '../../common/local-date-time.js';
import type { PageRequest } from '../../common/pageable.js';
import { ReadCache } from '../../common/read-cache.js';
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

// 캐시 키의 조각이다(옛 @Cacheable의 key 식).
// 쪽은 "쪽 번호-크기"다. 태그는 옛 Java List.toString()이 만드는 "[a, b]"(쉼표 뒤 공백)이고, 없으면 all이다.
// 옛 코드는 태그가 없을 때(null)와 빈 목록일 때(tags=)의 키가 달랐지만 둘 다 필터 없는 같은 조회라서 all 하나로 합친다.
const pageKey = ({ page, size }: PageRequest) => `${page}-${size}`;
const tagsKey = (tags: string[]) =>
  tags.length > 0 ? `[${tags.join(', ')}]` : 'all';

// 옛 unless = "#result.content.isEmpty()": 빈 쪽은 저장하지 않는다.
const isEmptyPage = (paged: PagedResponse<unknown>) =>
  paged.content.length === 0;

// 서비스는 저장소가 준 값을 응답 모양으로 바꾼다(요약 글, 날짜 문자열, 쪽 정보). 옛 PostServiceImpl과 PostListResponse가 하던 일이다.
// @Injectable: Nest가 생성자의 부품(PostRepository 등)을 찾아 넣어 주는 대상이라는 표시다.
//
// 읽기 캐시는 옛 @Cacheable처럼 컨트롤러가 부르는 메서드에 건다. 옛 Spring의 캐시는 프록시를 거쳐야 걸려서,
// 같은 클래스 안의 호출은 캐시를 거치지 않았고 다른 빈(TagService)의 호출은 거쳤다. 그 경계를 그대로 옮긴다:
// - 홈 피드는 인기 글과 최신 글을 캐시 없이 읽고(load...), 태그만 TagService의 캐시(allTags)를 거친다.
// - 공개 프로필(UserService)은 캐시가 붙은 getMyPosts가 아니라 캐시 없는 findPostsByWriter를 쓴다(옛 postQueryPort 직접 호출).
@Injectable()
export class PostService {
  constructor(
    private readonly posts: PostRepository,
    private readonly tagService: TagService,
    private readonly cache: ReadCache,
  ) {}

  getPosts(page: PageRequest, tags: string[]) {
    return this.cache.cached(
      'postsList',
      `${pageKey(page)}-${tagsKey(tags)}`,
      () => this.loadPosts(page, tags),
      isEmptyPage,
    );
  }

  getPostsByTag(tagName: string, page: PageRequest) {
    return this.cache.cached(
      'postsByTag',
      `${tagName}-${pageKey(page)}`,
      () => this.loadPosts(page, [tagName]),
      isEmptyPage,
    );
  }

  searchPostsByTitle(page: PageRequest, keyword: string) {
    return this.cache.cached(
      'searchPosts',
      `${keyword}-${pageKey(page)}`,
      async () =>
        this.toPagedResponse(
          page,
          await this.posts.searchPostsByTitle(page, keyword),
        ),
      isEmptyPage,
    );
  }

  getMyPosts(githubId: string, page: PageRequest) {
    return this.cache.cached(
      'myPosts',
      `${githubId}-${pageKey(page)}`,
      () => this.findPostsByWriter(githubId, page),
      isEmptyPage,
    );
  }

  // getMyPosts와 같은 조회인데 캐시를 거치지 않는다. 공개 프로필이 쓴다(위 설명).
  async findPostsByWriter(githubId: string, page: PageRequest) {
    return this.toPagedResponse(
      page,
      await this.posts.findPostsByWriter(page, githubId),
    );
  }

  // 글이 없으면 404 P001이다(예외는 저장하지 않는다).
  getPostDetail(postId: bigint): Promise<PostDetailResponse> {
    return this.cache.cached('postDetail', String(postId), () =>
      this.loadPostDetail(postId),
    );
  }

  getWeeklyPopularPosts() {
    return this.cache.cached(
      'hotPosts',
      'weekly',
      () => this.loadWeeklyPopularPosts(),
      (popular) => popular.length === 0,
    );
  }

  getHomeFeed(page: PageRequest, tags: string[]) {
    return this.cache.cached(
      'homeFeed',
      `${pageKey(page)}-${tagsKey(tags)}`,
      () => this.loadHomeFeed(page, tags),
      (feed) => feed.latest.content.length === 0,
    );
  }

  private async loadPosts(page: PageRequest, tags: string[]) {
    return this.toPagedResponse(
      page,
      await this.posts.findAllPosts(page, tags),
    );
  }

  private async loadPostDetail(postId: bigint): Promise<PostDetailResponse> {
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

  private loadWeeklyPopularPosts(): Promise<PostPopularResponse[]> {
    const since = new Date(Date.now() + KST_OFFSET_MS - WEEK_MS);
    return this.posts.findWeeklyPopularPosts(since, POPULAR_LIMIT);
  }

  // 세 조회는 서로 기다릴 이유가 없어서 함께 보낸다(옛 코드는 차례로 불렀지만 결과는 같다).
  private async loadHomeFeed(
    page: PageRequest,
    tags: string[],
  ): Promise<HomeFeedResponse> {
    const [weeklyPopular, latest, allTags] = await Promise.all([
      this.loadWeeklyPopularPosts(),
      this.loadPosts(page, tags),
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
