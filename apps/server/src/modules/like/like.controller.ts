import { Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiParam } from '@nestjs/swagger';
import { ResponseDto } from '../../common/dto/response.dto.js';
import { parsePageable } from '../../common/pageable.js';
import { parsePathLong } from '../../common/spring-compat.js';
import {
  ApiPageable,
  OkBoolean,
  OkPagedOf,
  OkString,
} from '../../common/swagger/api-decorators.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { User } from '../user/user.repository.js';
import { LikeResponse } from './dto/like-response.dto.js';
import { LikeService } from './like.service.js';

// 옛 @PageableDefault(sort = "createdAt", direction = DESC)의 기본 크기다.
const DEFAULT_PAGE_SIZE = 10;

// @Controller: 이 클래스의 메서드들이 /api/v1/likes 아래 라우트가 된다. 모든 작업이 기본 규칙(로그인 필요)이라 데코레이터가 없다.
// 가드가 request.user를 붙여 두고, @CurrentUser()가 꺼낸다.
@Controller('api/v1/likes')
export class LikeController {
  constructor(private readonly likes: LikeService) {}

  // 정렬은 좋아요를 누른 시각 내림차순으로 고정이라 요청의 sort를 읽지 않는다(옛 동작). 쿼리는 통째로 받아 직접 해석한다.
  @ApiOperation({ summary: '내가 누른 좋아요 목록 조회' })
  @Get('me')
  @ApiPageable(DEFAULT_PAGE_SIZE)
  @OkPagedOf(LikeResponse)
  async getMyLikes(
    @CurrentUser() user: User,
    @Query() query: Record<string, unknown>,
  ) {
    const paged = await this.likes.getMyLikes(
      user.githubId,
      parsePageable(query, DEFAULT_PAGE_SIZE),
    );
    return ResponseDto.of('좋아요 목록 조회 성공', paged);
  }

  // 글이 없으면 404 P001, 이미 눌렀으면 409 L001이다. 성공은 HTTP 200이고 본문 status만 201이다(옛 ResponseDto.of(CREATED, ...)). data는 없다.
  // 경로가 'me'면 글 번호로 읽지 못해 400 C005다(옛 Long 변환과 같다. GET me만 목록 조회다).
  @ApiOperation({ summary: '게시글 좋아요' })
  @Post(':postId')
  @ApiParam({ name: 'postId', type: 'integer', format: 'int64' })
  @OkString()
  async likePost(@CurrentUser() user: User, @Param('postId') postId: string) {
    await this.likes.likePost(user.githubId, parsePathLong('postId', postId));
    return ResponseDto.of('좋아요 추가 성공', undefined, 201);
  }

  // 글이 없으면 404 P001, 누른 적이 없으면 404 L002다. 성공은 HTTP 200에 본문 status도 200이다.
  @ApiOperation({ summary: '좋아요 취소' })
  @Delete(':postId')
  @ApiParam({ name: 'postId', type: 'integer', format: 'int64' })
  @OkString()
  async unlikePost(@CurrentUser() user: User, @Param('postId') postId: string) {
    await this.likes.unlikePost(user.githubId, parsePathLong('postId', postId));
    return ResponseDto.of('좋아요 취소 성공');
  }

  // 글이 없으면 404 P001이다. 숫자가 아닌 경로는 400 C005다(글 상세와 같다).
  @ApiOperation({ summary: '내가 해당 게시글에 좋아요 눌렀는지 여부 조회' })
  @Get(':postId/liked')
  @ApiParam({ name: 'postId', type: 'integer', format: 'int64' })
  @OkBoolean()
  async isPostLiked(
    @CurrentUser() user: User,
    @Param('postId') postId: string,
  ) {
    return ResponseDto.of(
      '좋아요 여부 조회 성공',
      await this.likes.isPostLiked(
        user.githubId,
        parsePathLong('postId', postId),
      ),
    );
  }
}
