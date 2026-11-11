import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiQuery,
  getSchemaPath,
} from '@nestjs/swagger';
import { Pageable } from '../../common/dto/pageable.dto.js';
import { ResponseDto } from '../../common/dto/response.dto.js';
import { ArgumentTypeMismatchException } from '../../common/error/input.exception.js';
import { parsePageable } from '../../common/pageable.js';
import { parseSpringLong } from '../../common/spring-compat.js';
import {
  ApiPageable,
  OkListOf,
  OkOf,
  OkPagedOf,
} from '../../common/swagger/api-decorators.js';
import { Public } from '../auth/access.decorator.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { User } from '../user/user.repository.js';
import { HomeFeedResponse } from './dto/home-feed-response.dto.js';
import { PostDetailResponse } from './dto/post-detail-response.dto.js';
import { PostListResponse } from './dto/post-list-response.dto.js';
import { PostPopularResponse } from './dto/post-popular-response.dto.js';
import { parseTags, readKeyword } from './post-query.js';
import { PostService } from './post.service.js';

// 옛 @PageableDefault의 기본 크기다. 네 목록 모두 붙어 있었다.
const DEFAULT_PAGE_SIZE = 10;

// @Controller: 이 클래스의 메서드들이 /api/v1/posts 아래 라우트가 된다(프론트의 라우트 파일과 비슷하다).
// 요청의 쿼리는 @Query()로 통째로 받아 직접 해석한다. page, size, sort를 이름으로 받으면 Swagger가 그 이름을 명세에 자동으로 더해서
// 프론트 계약(검색은 keyword와 pageable만)과 어긋난다. 해석 규칙은 common/pageable.ts와 post-query.ts에 있다.
// 라우트는 위에서부터 맞춰 보므로, 이름이 정해진 경로(me, search, tags/.., popular, feed)는 마지막의 /:postId보다 앞에 둔다.
@Controller('api/v1/posts')
export class PostController {
  constructor(private readonly posts: PostService) {}

  // @Public: 가드가 토큰을 검사하지 않는다. 데코레이터가 없는 라우트는 로그인이 필요하다(기본 규칙).
  @ApiOperation({ summary: '최신순 게시물 목록 조회' })
  @Public()
  @Get()
  @ApiPageable(DEFAULT_PAGE_SIZE)
  @ApiQuery({
    name: 'tags',
    required: false,
    schema: { type: 'array', items: { type: 'string' } },
  })
  @OkPagedOf(PostListResponse)
  async getPosts(@Query() query: Record<string, unknown>) {
    const paged = await this.posts.getPosts(
      parsePageable(query, DEFAULT_PAGE_SIZE),
      parseTags(query.tags),
    );
    return ResponseDto.of('게시물 목록 조회 성공', paged);
  }

  // 기본 규칙(로그인 필요)이라 데코레이터가 없다. 가드가 request.user를 붙여 두고, @CurrentUser()가 꺼낸다.
  @ApiOperation({ summary: '내가 쓴 게시물 목록 조회' })
  @Get('me')
  @ApiPageable(DEFAULT_PAGE_SIZE)
  @OkPagedOf(PostListResponse)
  async getMyPosts(
    @CurrentUser() user: User,
    @Query() query: Record<string, unknown>,
  ) {
    const paged = await this.posts.getMyPosts(
      user.githubId,
      parsePageable(query, DEFAULT_PAGE_SIZE),
    );
    return ResponseDto.of('내가 쓴 게시물 조회 성공', paged);
  }

  // 검색은 명세에 keyword와 pageable(객체 하나)로 적혀 있다(옛 springdoc). 실제로는 page, size, sort를 평평한 쿼리로 받는다.
  @ApiOperation({ summary: '게시물 검색' })
  @Public()
  @Get('search')
  @ApiQuery({ name: 'keyword', required: true, schema: { type: 'string' } })
  @ApiQuery({
    name: 'pageable',
    required: true,
    schema: { $ref: getSchemaPath(Pageable) },
  })
  @OkPagedOf(PostListResponse)
  async searchPosts(@Query() query: Record<string, unknown>) {
    const paged = await this.posts.searchPostsByTitle(
      parsePageable(query, DEFAULT_PAGE_SIZE),
      readKeyword(query),
    );
    return ResponseDto.of('게시물 검색 조회 성공', paged);
  }

  // @Param: 경로의 :tagName 자리 값을 받는다. Nest가 URL 인코딩(한글 태그)을 풀어서 준다.
  // 태그가 있는지는 확인하지 않는다. 없는 태그는 빈 쪽이 나온다(옛 동작).
  @ApiOperation({ summary: '태그별 게시물 조회' })
  @Public()
  @Get('tags/:tagName')
  @ApiPageable(DEFAULT_PAGE_SIZE)
  @OkPagedOf(PostListResponse)
  async getPostsByTag(
    @Param('tagName') tagName: string,
    @Query() query: Record<string, unknown>,
  ) {
    const paged = await this.posts.getPostsByTag(
      tagName,
      parsePageable(query, DEFAULT_PAGE_SIZE),
    );
    return ResponseDto.of(`'${tagName}' 태그 게시물 조회 성공`, paged);
  }

  @ApiOperation({ summary: '주간 인기 게시물 조회' })
  @Public()
  @Get('popular')
  @OkListOf(PostPopularResponse)
  async getWeeklyPopularPosts() {
    return ResponseDto.of(
      '주간 인기 게시물 조회 성공',
      await this.posts.getWeeklyPopularPosts(),
    );
  }

  // 인기 글, 최신 글 한 쪽(getPosts와 같은 page, size, tags), 전체 태그를 한 번에 돌려준다.
  @ApiOperation({ summary: '홈 피드 조회' })
  @Public()
  @Get('feed')
  @ApiPageable(DEFAULT_PAGE_SIZE)
  @ApiQuery({
    name: 'tags',
    required: false,
    schema: { type: 'array', items: { type: 'string' } },
  })
  @OkOf(HomeFeedResponse)
  async getHomeFeed(@Query() query: Record<string, unknown>) {
    const feed = await this.posts.getHomeFeed(
      parsePageable(query, DEFAULT_PAGE_SIZE),
      parseTags(query.tags),
    );
    return ResponseDto.of('홈 피드 조회 성공', feed);
  }

  // 경로의 postId는 문자열로 받아 Spring의 Long 변환 규칙(parseSpringLong)으로 직접 읽는다. 숫자가 아니면 400 C005다.
  // 숫자 형식이면 글이 없을 때 404 P001이다. 명세에는 int64로 적는다(문자열로 받으면 Swagger가 string으로 적는다).
  @ApiOperation({ summary: '단일 게시물 상세 조회' })
  @Public()
  @Get(':postId')
  @ApiParam({ name: 'postId', type: 'integer', format: 'int64' })
  @OkOf(PostDetailResponse)
  async getPostDetail(@Param('postId') postId: string) {
    const id = parseSpringLong(postId);
    if (id === undefined)
      throw new ArgumentTypeMismatchException('postId', postId);
    return ResponseDto.of(
      '게시물 상세 조회 성공',
      await this.posts.getPostDetail(id),
    );
  }
}
