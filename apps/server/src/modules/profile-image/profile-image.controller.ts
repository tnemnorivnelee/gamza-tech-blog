import {
  Controller,
  Delete,
  Put,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiOperation } from '@nestjs/swagger';
import { FieldError } from '../../common/dto/error-response.dto.js';
import { ResponseDto } from '../../common/dto/response.dto.js';
import { ValidationFailedException } from '../../common/error/input.exception.js';
import { OkOf, OkVoid } from '../../common/swagger/api-decorators.js';
import {
  imageUploadInterceptor,
  pickImageFile,
  type UploadedPart,
} from '../../infra/storage/image-upload.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { User } from '../user/user.repository.js';
import { ProfileImageResponse } from './dto/profile-image-response.dto.js';
import { ProfileImageService } from './profile-image.service.js';

// @Controller: 이 클래스의 메서드들이 /api/v1/profile-images 아래 라우트가 된다.
// 두 라우트 모두 기본 규칙(로그인 필요, USER·ADMIN)이다. 프로필 이미지 조회(getProfileImage)는 1차 범위 밖이다.
@Controller('api/v1/profile-images')
export class ProfileImageController {
  constructor(private readonly images: ProfileImageService) {}

  // 폼 칸 이름은 imageFile이다(옛 ProfileImageRequest의 필드 이름). @UseInterceptors: 멀티파트 본문을 읽어 파일을 @UploadedFiles()로 넘기는 장치다.
  // 파일 칸이 없으면 400 C001이다(옛 @Valid @NotNull "이미지 파일은 필수입니다"). 비어 있는 파일은 서비스에서 400 U008이다.
  // 이미지가 없는 사용자에게도 성공이고, 응답은 새로 만든 행의 {id, imageUrl}이다.
  @ApiOperation({ summary: '프로필 사진 업로드/수정' })
  @Put()
  @UseInterceptors(imageUploadInterceptor())
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['imageFile'],
      properties: {
        imageFile: {
          type: 'string',
          format: 'binary',
          description: '업로드할 프로필 이미지 파일',
        },
      },
    },
  })
  @OkOf(ProfileImageResponse)
  async updateProfileImage(
    @CurrentUser() user: User,
    @UploadedFiles() parts: UploadedPart[],
  ) {
    const file = pickImageFile(parts, 'imageFile');
    if (!file)
      throw new ValidationFailedException([
        FieldError.of('imageFile', null, '이미지 파일은 필수입니다'),
      ]);
    return ResponseDto.of(
      '프로필 이미지 수정 성공',
      await this.images.updateProfileImage(user.githubId, file),
    );
  }

  @ApiOperation({ summary: '프로필 사진 삭제' })
  @Delete()
  @OkVoid()
  async deleteProfileImage(@CurrentUser() user: User) {
    await this.images.deleteProfileImage(user.githubId);
    return ResponseDto.of('프로필 이미지 삭제 성공');
  }
}
