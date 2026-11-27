import { Module } from '@nestjs/common';
import { ReadCacheModule } from '../../common/read-cache.module.js';
import { ImageStorageModule } from '../../infra/storage/image-storage.module.js';
import { PrismaModule } from '../../infra/prisma/prisma.module.js';
import { ProfileImageController } from './profile-image.controller.js';
import { ProfileImageRepository } from './profile-image.repository.js';
import { ProfileImageService } from './profile-image.service.js';

// 프로필 이미지 기능 하나를 묶는 모듈이다(옛 domain/profileimage). 저장소는 PrismaModule, 파일 저장소는 ImageStorageModule, 캐시 지우기는 ReadCacheModule에서 받는다.
@Module({
  imports: [PrismaModule, ImageStorageModule, ReadCacheModule],
  controllers: [ProfileImageController],
  providers: [ProfileImageService, ProfileImageRepository],
})
export class ProfileImageModule {}
