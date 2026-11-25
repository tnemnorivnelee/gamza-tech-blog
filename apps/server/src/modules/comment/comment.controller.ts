import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam } from '@nestjs/swagger';
import { ResponseDto } from '../../common/dto/response.dto.js';
import {
  parsePageable,
  parseSort,
  type SortOrder,
} from '../../common/pageable.js';
import { parsePathLong } from '../../common/spring-compat.js';
import {
  ApiPageable,
  OkOf,
  OkPagedOf,
  OkString,
} from '../../common/swagger/api-decorators.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { User } from '../user/user.repository.js';
import { CommentService } from './comment.service.js';
import { CommentListResponse } from './dto/comment-list-response.dto.js';
import { CommentRequest } from './dto/comment-request.dto.js';
import { CommentResponse } from './dto/comment-response.dto.js';

// 옛 @PageableDefault(sort = "createdAt", direction = DESC)의 기본 크기와 기본 정렬이다.
const DEFAULT_PAGE_SIZE = 10;
const DEFAULT_SORT: SortOrder[] = [
  { property: 'createdAt', direction: 'desc' },
];

// @Controller: 이 클래스의 메서드들이 /api/v1/comment 아래 라우트가 된다. 기본 규칙(로그인 필요)이라 접근 데코레이터가 없다.
// 글의 댓글 목록 조회(GET :postId/comments)는 1차 범위 밖이라 옮기지 않는다. 그래도 GET me/comments를 먼저 선언해 두었다(Express는 선언한
// 순서대로 맞춰 보고, Spring은 글자 그대로인 경로를 먼저 고른다). 경로가 'me'인 DELETE는 댓글 번호로 읽지 못해 400 C005다.
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

  // 요청 본문은 검사하지 않는다(옛 컨트롤러에 @Valid가 없었다). 성공은 HTTP 200이고 본문 status만 201이다.
  // parentCommentId는 JSON의 숫자를 bigint로 바꾼다(없거나 null이면 최상위 댓글이다).
  @ApiOperation({ summary: '게시물에 댓글 등록' })
  @Post(':postId/comments')
  @ApiParam({ name: 'postId', type: 'integer', format: 'int64' })
  @ApiBody({ type: CommentRequest })
  @OkOf(CommentResponse)
  async addComment(
    @CurrentUser() user: User,
    @Param('postId') postId: string,
    @Body() body: CommentRequest,
  ) {
    const created = await this.comments.addComment(
      user.githubId,
      parsePathLong('postId', postId),
      body.content,
      body.parentCommentId == null ? null : BigInt(body.parentCommentId),
    );
    return ResponseDto.of('댓글이 등록되었습니다.', created, 201);
  }

  // 댓글이 없으면 404 CM001, 쓴 사람이 아니면 403 CM002다.
  @ApiOperation({ summary: '댓글 삭제' })
  @Delete(':commentId')
  @ApiParam({ name: 'commentId', type: 'integer', format: 'int64' })
  @OkString()
  async deleteComment(
    @CurrentUser() user: User,
    @Param('commentId') commentId: string,
  ) {
    await this.comments.deleteComment(
      user.githubId,
      parsePathLong('commentId', commentId),
    );
    return ResponseDto.of('댓글이 삭제되었습니다.');
  }
}
