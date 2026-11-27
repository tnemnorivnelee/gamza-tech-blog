import { Injectable } from '@nestjs/common';
import { ImageStorage } from './image-storage.js';

// 앱의 기본 연결이다. 진짜 S3 어댑터(M6-4b)가 들어오기 전까지 이미지 저장소는 설정되지 않은 상태다.
// 조용히 성공한 척하지 않고(메모리 가짜로 대신하면 올린 파일이 재시작과 함께 사라진다) 일반 Error를 던져서,
// 전역 예외 필터가 500 C004로 응답하고 서버 로그에 이 메시지를 남기게 한다.
@Injectable()
export class UnconfiguredImageStorage extends ImageStorage {
  uploadFile(): Promise<string> {
    return Promise.reject(notConfigured());
  }

  deleteByUrl(): Promise<void> {
    return Promise.reject(notConfigured());
  }
}

const notConfigured = () =>
  new Error('이미지 저장소가 설정되지 않았다(S3 어댑터는 M6-4b에서 붙인다).');
