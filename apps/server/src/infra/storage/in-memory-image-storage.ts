import { Injectable } from '@nestjs/common';
import {
  buildImageKey,
  determineContentType,
  extractKey,
} from './image-key.js';
import { type ImageFile, ImageStorage } from './image-storage.js';

// 시험용 메모리 저장소다. 올린 파일을 Map에 두고, 주소 규칙(자기 주소로 시작해야 지울 수 있음)은 진짜 어댑터와 같은 함수를 쓴다.
// 운영에서는 쓰지 않는다. 앱의 기본 연결은 UnconfiguredImageStorage이고, 시험이 overrideProvider로 이것을 끼운다.
@Injectable()
export class InMemoryImageStorage extends ImageStorage {
  readonly bucketUrl = 'https://in-memory-bucket.test/';
  // 키 → 올린 내용. 시험이 무엇이 올라갔고 지워졌는지 직접 본다.
  readonly files = new Map<string, { buffer: Buffer; contentType: string }>();

  uploadFile(file: ImageFile, prefix: string): Promise<string> {
    const key = buildImageKey(prefix, file.originalName);
    this.files.set(key, {
      buffer: file.buffer,
      contentType: determineContentType(key),
    });
    return Promise.resolve(`${this.bucketUrl}${key}`);
  }

  deleteByUrl(fileUrl: string): Promise<void> {
    try {
      this.files.delete(extractKey(this.bucketUrl, fileUrl));
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error as Error);
    }
  }
}
