import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import {
  ok,
  ResponseDtoOf,
  ResponseDtoPagedOf,
  ResponseDtoString,
  ResponseDtoVoid,
} from '../../src/common/dto/response-dto.js';
import { ApiPageable, Ok } from '../../src/common/swagger/api-decorators.js';
import { setupSwagger } from '../../src/common/swagger/setup-swagger.js';
import { CommentListResponse } from '../../src/modules/comment/dto/comment-list-response.dto.js';
import { CommentRequest } from '../../src/modules/comment/dto/comment-request.dto.js';
import { CommentResponse } from '../../src/modules/comment/dto/comment-response.dto.js';

const int64 = { type: 'integer', format: 'int64' } as const;

// 계약 시험용 가짜 컨트롤러. 옛 CommentController와 AdmissionController의 일부를 흉내 낸다.
// 실제 컨트롤러가 생기면 이 파일을 지우고 실제 모듈로 시험한다.
@Controller('api/v1/comment')
class FakeCommentController {
  @ApiOperation({ summary: '게시물에 댓글 등록' })
  @Post(':postId/comments')
  @Ok(ResponseDtoOf(CommentResponse))
  @ApiParam({ name: 'postId', ...int64 })
  @ApiBody({ type: CommentRequest })
  addComment(@Param('postId') postId: string, @Body() body: CommentRequest) {
    return ok(
      '댓글이 등록되었습니다.',
      { commentId: Number(postId), content: body.content },
      201,
    );
  }

  @ApiOperation({ summary: '댓글 삭제' })
  @Delete(':commentId')
  @Ok(ResponseDtoString)
  @ApiParam({ name: 'commentId', ...int64 })
  deleteComment() {
    return ok('댓글이 삭제되었습니다.');
  }

  @ApiOperation({ summary: '내가 단 댓글 목록 조회' })
  @Get('me/comments')
  @ApiPageable()
  @Ok(ResponseDtoPagedOf(CommentListResponse))
  getMyComments() {
    return ok('내가 단 댓글 목록 조회 성공', {
      content: [],
      page: 0,
      size: 20,
      totalElements: 0,
      totalPages: 0,
    });
  }
}

@Controller('api/admissions')
class FakeAdmissionController {
  // 메서드 이름이 예약어 `delete`다. 생성기는 이것을 `_delete`로 바꾼다.
  @ApiOperation({ summary: '합격/불합격 결과 삭제 (ADMIN)' })
  @Delete('admin/:admissionId')
  @Ok(ResponseDtoVoid)
  @ApiParam({ name: 'admissionId', ...int64 })
  delete() {
    return ok('합격/불합격 결과가 삭제되었습니다.');
  }
}

export async function createFakeApp() {
  const moduleRef = await Test.createTestingModule({
    controllers: [FakeCommentController, FakeAdmissionController],
  }).compile();
  const app = moduleRef.createNestApplication();
  setupSwagger(app);
  await app.listen(0);
  return app;
}
