import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, getSchemaPath } from '@nestjs/swagger';
import { Pageable } from '../../common/dto/pageable.dto.js';
import { ResponseDto } from '../../common/dto/response.dto.js';
import { parsePageable } from '../../common/pageable.js';
import { ApiPageable, OkPagedOf } from '../../common/swagger/api-decorators.js';
import { Public } from '../auth/access.decorator.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { User } from '../user/user.repository.js';
import { PostListResponse } from './dto/post-list-response.dto.js';
import { parseTags, readKeyword } from './post-query.js';
import { PostService } from './post.service.js';

// 옛 @PageableDefault의 기본 크기다. 네 목록 모두 붙어 있었다.
const DEFAULT_PAGE_SIZE = 10;

// @Controller: 이 클래스의 메서드들이 /api/v1/posts 아래 라우트가 된다(프론트의 라우트 파일과 비슷하다).
// 요청의 쿼리는 @Query()로 통째로 받아 직접 해석한다. page, size, sort를 이름으로 받으면 Swagger가 그 이름을 명세에 자동으로 더해서
// 프론트 계약(검색은 keyword와 pageable만)과 어긋난다. 해석 규칙은 common/pageable.ts와 post-query.ts에 있다.
// 라우트는 위에서부터 맞춰 보므로, 이름이 정해진 경로(me, search, tags/..)는 나중에 올 /:postId보다 앞에 둔다.
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
}
