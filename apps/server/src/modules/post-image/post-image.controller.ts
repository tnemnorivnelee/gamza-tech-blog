import {
  Controller,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiOperation } from '@nestjs/swagger';
import { ResponseDto } from '../../common/dto/response.dto.js';
import { BusinessException } from '../../common/error/business.exception.js';
import { ErrorCode } from '../../common/error/error-code.js';
import { OkString } from '../../common/swagger/api-decorators.js';
import {
  imageUploadInterceptor,
  pickImageFile,
  type UploadedPart,
} from '../../infra/storage/image-upload.js';
import { PostImageService } from './post-image.service.js';

// 경로가 글 컨트롤러(/api/v1/posts)와 겹쳐 보이지만 별도 컨트롤러다(옛 domain/postimage). 기본 규칙(로그인 필요, USER·ADMIN)이다.
@Controller('api/v1/posts/images')
export class PostImageController {
  constructor(private readonly postImages: PostImageService) {}

  // 폼 칸 이름은 file이다. 칸이 없으면 옛 @RequestPart("file")가 MissingServletRequestPartException을 던지고 전역 예외 처리기가
  // 따로 다루지 않아 500 C004였다고 본다 [추정]. 성공은 HTTP 200이고 본문 status만 201이다. data는 올린 파일의 주소다.
  @ApiOperation({ summary: '게시글 이미지 업로드' })
  @Post()
  @UseInterceptors(imageUploadInterceptor())
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: '업로드할 이미지 파일',
        },
      },
    },
  })
  @OkString()
  async uploadImage(@UploadedFiles() parts: UploadedPart[]) {
    const file = pickImageFile(parts, 'file');
    if (!file) throw new BusinessException(ErrorCode.INTERNAL_SERVER_ERROR);
    return ResponseDto.of(
      '이미지 업로드 성공',
      await this.postImages.saveTemporaryImage(file),
      201,
    );
  }
}
