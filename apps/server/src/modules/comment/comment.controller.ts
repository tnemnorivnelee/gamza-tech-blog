import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { ResponseDto } from '../../common/dto/response.dto.js';
import {
  parsePageable,
  parseSort,
  type SortOrder,
} from '../../common/pageable.js';
import { ApiPageable, OkPagedOf } from '../../common/swagger/api-decorators.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { User } from '../user/user.repository.js';
import { CommentService } from './comment.service.js';
import { CommentListResponse } from './dto/comment-list-response.dto.js';

// 옛 @PageableDefault(sort = "createdAt", direction = DESC)의 기본 크기와 기본 정렬이다.
const DEFAULT_PAGE_SIZE = 10;
const DEFAULT_SORT: SortOrder[] = [
  { property: 'createdAt', direction: 'desc' },
];

// @Controller: 이 클래스의 메서드들이 /api/v1/comment 아래 라우트가 된다. 기본 규칙(로그인 필요)이라 접근 데코레이터가 없다.
// 댓글을 쓰고 지우고 글의 댓글 목록을 보는 API는 M6에서 이 컨트롤러에 더한다. 그때 GET :postId/comments가 me/comments를
// 가리지 않도록 이 라우트를 먼저 선언해 둔다(Express는 선언한 순서대로 맞춰 보고, Spring은 글자 그대로인 경로를 먼저 고른다).
@Controller('api/v1/comment')
export class CommentController {
  constructor(private readonly comments: CommentService) {}

  // 요청의 sort는 기본 정렬을 바꾸지 않고 createdAt 내림차순 뒤에 붙는다(comment.repository.ts). 쿼리는 통째로 받아 직접 해석한다.
  @ApiOperation({ summary: '내가 단 댓글 목록 조회' })
  @Get('me/comments')
  @ApiPageable(DEFAULT_PAGE_SIZE)
  @OkPagedOf(CommentListResponse)
  async getMyComments(
    @CurrentUser() user: User,
    @Query() query: Record<string, unknown>,
  ) {
    const paged = await this.comments.getMyComments(
      user.githubId,
      parsePageable(query, DEFAULT_PAGE_SIZE),
      parseSort(query, DEFAULT_SORT),
    );
    return ResponseDto.of('내가 단 댓글 목록 조회 성공', paged);
  }
}
