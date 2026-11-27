import { Module } from '@nestjs/common';
import { ImageStorageModule } from '../../infra/storage/image-storage.module.js';
import { PostImageController } from './post-image.controller.js';
import { PostImageService } from './post-image.service.js';

// 글 이미지 업로드 기능이다(옛 domain/postimage). 지금은 임시 폴더에 올리는 것뿐이라 파일 저장소만 필요하다.
// 글을 저장할 때 임시 이미지를 옮기고 정리하는 일은 글 쓰기(M6-5)가 더한다.
@Module({
  imports: [ImageStorageModule],
  controllers: [PostImageController],
  providers: [PostImageService],
})
export class PostImageModule {}
