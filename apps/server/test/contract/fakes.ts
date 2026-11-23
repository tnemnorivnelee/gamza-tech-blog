import { Body, Controller, Delete, Param, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBody, ApiOperation, ApiParam } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { ResponseDto } from '../../src/common/dto/response.dto.js';
import {
  OkOf,
  OkString,
  OkVoid,
} from '../../src/common/swagger/api-decorators.js';
import { setupSwagger } from '../../src/common/swagger/setup-swagger.js';
import { AuthController } from '../../src/modules/auth/auth.controller.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { CommentController } from '../../src/modules/comment/comment.controller.js';
import { CommentService } from '../../src/modules/comment/comment.service.js';
import { CommentRequest } from '../../src/modules/comment/dto/comment-request.dto.js';
import { CommentResponse } from '../../src/modules/comment/dto/comment-response.dto.js';
import { IntroController } from '../../src/modules/introduction/intro.controller.js';
import { IntroService } from '../../src/modules/introduction/intro.service.js';
import { LikeController } from '../../src/modules/like/like.controller.js';
import { LikeService } from '../../src/modules/like/like.service.js';
import { PostController } from '../../src/modules/post/post.controller.js';
import { PostService } from '../../src/modules/post/post.service.js';
import { TagController } from '../../src/modules/tag/tag.controller.js';
import { TagService } from '../../src/modules/tag/tag.service.js';
import { AdminUserController } from '../../src/modules/user/admin-user.controller.js';
import { UserController } from '../../src/modules/user/user.controller.js';
import { UserService } from '../../src/modules/user/user.service.js';

const int64 = { type: 'integer', format: 'int64' } as const;

// 계약 시험용 가짜 컨트롤러. 아직 옮기지 않은 쓰기 작업(댓글 등록·삭제)과 합격 결과 삭제를 흉내 낸다.
// 실제 컨트롤러가 생기면 해당 작업을 지우고 실제 컨트롤러로 시험한다.
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

// 인증·글·태그·소개·사용자·내 댓글·좋아요 컨트롤러는 실제 클래스를 쓴다. 명세는 데코레이터만으로 만들어지므로 의존하는 부품은 빈 가짜로 채운다.
// AuthModule을 통째로 넣으면 전역 가드가 따라와서 위 가짜 컨트롤러의 응답 시험이 로그인을 요구하게 된다.
export async function createFakeApp() {
  const moduleRef = await Test.createTestingModule({
    controllers: [
      FakeCommentController,
      FakeAdmissionController,
      AuthController,
      PostController,
      TagController,
      IntroController,
      UserController,
      AdminUserController,
      CommentController,
      LikeController,
    ],
    providers: [
      { provide: AuthService, useValue: {} },
      { provide: PostService, useValue: {} },
      { provide: TagService, useValue: {} },
      { provide: IntroService, useValue: {} },
      { provide: UserService, useValue: {} },
      { provide: CommentService, useValue: {} },
      { provide: LikeService, useValue: {} },
      { provide: ConfigService, useValue: {} },
    ],
  }).compile();
  const app = moduleRef.createNestApplication();
  setupSwagger(app);
  await app.listen(0);
  return app;
}
