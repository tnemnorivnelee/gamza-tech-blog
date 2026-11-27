import { Injectable, Logger } from '@nestjs/common';
import { BusinessException } from '../../common/error/business.exception.js';
import { ErrorCode } from '../../common/error/error-code.js';
import { ReadCache } from '../../common/read-cache.js';
import {
  type ImageFile,
  ImageStorage,
} from '../../infra/storage/image-storage.js';
import type { ProfileImageResponse } from './dto/profile-image-response.dto.js';
import { ProfileImageRepository } from './profile-image.repository.js';
import { validateProfileImageFile } from './profile-image.validator.js';

// 옛 S3 폴더 이름이다. 옛 코드는 상수 이름이 POST_IMAGES_PREFIX였지만 값은 "profile-images"다.
const PROFILE_IMAGES_PREFIX = 'profile-images';

// 프로필 이미지 바꾸기·지우기다(옛 ProfileImageServiceImpl). 두 쓰기 모두 성공한 뒤 그 사용자의 userProfile 캐시를 지운다(옛 @CacheEvict).
@Injectable()
export class ProfileImageService {
  private readonly logger = new Logger(ProfileImageService.name);

  constructor(
    private readonly images: ProfileImageRepository,
    private readonly storage: ImageStorage,
    private readonly cache: ReadCache,
  ) {}

  // 순서는 옛 코드와 같다: 사용자 확인(없으면 400 C003) → 파일 검사 → 옛 이미지를 저장소에서 지움 → 새 파일 올림 → DB 행 교체.
  // 저장소 작업(지우기, 올리기)이 실패하면 DB는 그대로다(옛 코드는 트랜잭션이 되돌아갔다). 옛 이미지 삭제가 실패하면 전체가 실패한다:
  // 예를 들어 저장소 주소가 아닌 GitHub 아바타 주소가 들어 있는 사용자는 500 U012로 바꿀 수 없다(개선 후보 42번).
  // 올리기까지 성공하고 DB 교체가 실패하면 올린 파일은 남는다(옛 코드도 같다).
  async updateProfileImage(
    githubId: string,
    file: ImageFile,
  ): Promise<ProfileImageResponse> {
    const user = await this.images.findUserWithImage(githubId);
    if (!user) throw new BusinessException(ErrorCode.ENTITY_NOT_FOUND);
    validateProfileImageFile(file);
    if (user.imageUrl !== null) await this.storage.deleteByUrl(user.imageUrl);
    const url = await this.storage.uploadFile(file, PROFILE_IMAGES_PREFIX);
    const saved = await this.images.replaceImage(user.userId, url);
    await this.cache.evict('userProfile', githubId);
    return { id: Number(saved.id), imageUrl: saved.imageUrl };
  }

  // 이미지가 없어도 성공이고 캐시는 지운다(옛 메서드가 정상으로 끝나서 @CacheEvict가 돈다).
  // 있으면: 주소가 비어 있으면 400 U008(옛 validateForDelete), 저장소 삭제 실패는 BusinessException만 무시한다(옛 catch의 타입).
  // 그 밖의 오류(저장소 연결 실패 등)는 그대로 던져서 DB 행을 지우지 않는다.
  async deleteProfileImage(githubId: string): Promise<void> {
    const user = await this.images.findUserWithImage(githubId);
    if (!user) throw new BusinessException(ErrorCode.ENTITY_NOT_FOUND);
    if (user.imageUrl !== null) {
      if (user.imageUrl.trim() === '')
        throw new BusinessException(ErrorCode.PROFILE_IMAGE_EMPTY);
      try {
        await this.storage.deleteByUrl(user.imageUrl);
      } catch (error) {
        if (!(error instanceof BusinessException)) throw error;
        this.logger.warn(`이미지 저장소 삭제 실패(무시): ${error.message}`);
      }
      await this.images.deleteImages(user.userId);
    }
    await this.cache.evict('userProfile', githubId);
  }
}
