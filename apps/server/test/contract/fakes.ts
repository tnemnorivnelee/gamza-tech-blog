import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { PagedResponse } from '../../src/common/dto/paged-response.dto.js';
import { ResponseDto } from '../../src/common/dto/response.dto.js';
import {
  ApiPageable,
  OkOf,
  OkPagedOf,
  OkString,
  OkVoid,
} from '../../src/common/swagger/api-decorators.js';
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
  @OkOf(CommentResponse)
  @ApiParam({ name: 'postId', ...int64 })
  @ApiBody({ type: CommentRequest })
  addComment(@Param('postId') postId: string, @Body() body: CommentRequest) {
    return ResponseDto.of(
      '댓글이 등록되었습니다.',
      { commentId: Number(postId), content: body.content },
      201,
    );
  }

  @ApiOperation({ summary: '댓글 삭제' })
  @Delete(':commentId')
  @OkString()
  @ApiParam({ name: 'commentId', ...int64 })
  deleteComment() {
    return ResponseDto.of('댓글이 삭제되었습니다.');
  }

  @ApiOperation({ summary: '내가 단 댓글 목록 조회' })
  @Get('me/comments')
  @ApiPageable()
  @OkPagedOf(CommentListResponse)
  getMyComments() {
    return ResponseDto.of(
      '내가 단 댓글 목록 조회 성공',
      new PagedResponse<CommentListResponse>([], 0, 20, 0, 0),
    );
  }
}

@Controller('api/admissions')
class FakeAdmissionController {
  // 메서드 이름이 예약어 `delete`다. 생성기는 이것을 `_delete`로 바꾼다.
  @ApiOperation({ summary: '합격/불합격 결과 삭제 (ADMIN)' })
  @Delete('admin/:admissionId')
  @OkVoid()
  @ApiParam({ name: 'admissionId', ...int64 })
  delete() {
    return ResponseDto.of('합격/불합격 결과가 삭제되었습니다.');
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
