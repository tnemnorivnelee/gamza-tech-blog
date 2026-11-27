import { Module } from '@nestjs/common';
import { ImageStorage } from './image-storage.js';
import { UnconfiguredImageStorage } from './unconfigured-image-storage.js';

// 이미지 저장소를 내보내는 모듈이다. { provide: ImageStorage, useClass: ... }는 "ImageStorage를 달라는 곳에는 이 클래스를 만들어 넣어 준다"는 뜻이다.
// 지금은 설정되지 않은 저장소가 기본이고, M6-4b에서 환경변수가 있을 때 S3 어댑터로 바꾼다. 시험은 overrideProvider로 가짜를 끼운다.
@Module({
  providers: [{ provide: ImageStorage, useClass: UnconfiguredImageStorage }],
  exports: [ImageStorage],
})
export class ImageStorageModule {}
