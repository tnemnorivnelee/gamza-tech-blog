import { Injectable } from '@nestjs/common';
import {
  type ImageFile,
  ImageStorage,
} from '../../infra/storage/image-storage.js';

// 글 쓰기 전에 올리는 임시 이미지의 폴더다. 글을 저장할 때 글 폴더(post-images/<글번호>)로 옮긴다(글 쓰기, M6-5).
const TEMPORARY_IMAGES_PREFIX = 'tmp_images';

// 옛 PostImageServiceImpl.saveTemporaryImage다. 글 이미지는 형식·크기 검사가 없다(옛 코드도 없었다. 전체 업로드 한도 3MB만 있다).
@Injectable()
export class PostImageService {
  constructor(private readonly storage: ImageStorage) {}

  saveTemporaryImage(file: ImageFile): Promise<string> {
    return this.storage.uploadFile(file, TEMPORARY_IMAGES_PREFIX);
  }
}
