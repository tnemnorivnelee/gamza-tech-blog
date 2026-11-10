import { Injectable } from '@nestjs/common';
import { PagedResponse } from '../../common/dto/paged-response.dto.js';
import { toLocalDateTime } from '../../common/local-date-time.js';
import type { PageRequest } from '../../common/pageable.js';
import type { PostListResponse } from './dto/post-list-response.dto.js';
import { makeContentSnippet } from './post-snippet.js';
import {
  type PostPage,
  PostRepository,
  type PostSummary,
} from './post.repository.js';

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
@Injectable()
export class PostService {
  constructor(private readonly posts: PostRepository) {}

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
