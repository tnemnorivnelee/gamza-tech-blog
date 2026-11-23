import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiParam } from '@nestjs/swagger';
import { ResponseDto } from '../../common/dto/response.dto.js';
import { ArgumentTypeMismatchException } from '../../common/error/input.exception.js';
import { parsePageable } from '../../common/pageable.js';
import { parseSpringLong } from '../../common/spring-compat.js';
import {
  ApiPageable,
  OkBoolean,
  OkPagedOf,
} from '../../common/swagger/api-decorators.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { User } from '../user/user.repository.js';
import { LikeResponse } from './dto/like-response.dto.js';
import { LikeService } from './like.service.js';

// 옛 @PageableDefault(sort = "createdAt", direction = DESC)의 기본 크기다.
const DEFAULT_PAGE_SIZE = 10;

// @Controller: 이 클래스의 메서드들이 /api/v1/likes 아래 라우트가 된다. 두 작업 모두 기본 규칙(로그인 필요)이라 데코레이터가 없다.
// 가드가 request.user를 붙여 두고, @CurrentUser()가 꺼낸다. 좋아요를 누르고 취소하는 쓰기 API는 M6에서 이 컨트롤러에 더한다.
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

  // 글이 없으면 404 P001이다. 숫자가 아닌 경로는 400 C005다(글 상세와 같다).
  @ApiOperation({ summary: '내가 해당 게시글에 좋아요 눌렀는지 여부 조회' })
  @Get(':postId/liked')
  @ApiParam({ name: 'postId', type: 'integer', format: 'int64' })
  @OkBoolean()
  async isPostLiked(
    @CurrentUser() user: User,
    @Param('postId') postId: string,
  ) {
    const id = parseSpringLong(postId);
    if (id === undefined)
      throw new ArgumentTypeMismatchException('postId', postId);
    return ResponseDto.of(
      '좋아요 여부 조회 성공',
      await this.likes.isPostLiked(user.githubId, id),
    );
  }
}
