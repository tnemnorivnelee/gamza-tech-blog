import { Test } from '@nestjs/testing';
import { ImageStorage } from './image-storage.js';
import { ImageStorageModule } from './image-storage.module.js';
import { UnconfiguredImageStorage } from './unconfigured-image-storage.js';

// 진짜 S3 어댑터(M6-4b)가 들어오기 전까지 앱의 이미지 저장소는 "설정되지 않음"이다. 조용히 성공하지 않고 오류를 던진다.
describe('ImageStorageModule 기본 연결', () => {
  it('ImageStorage를 달라고 하면 설정되지 않은 저장소를 준다', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ImageStorageModule],
    }).compile();

    expect(moduleRef.get(ImageStorage)).toBeInstanceOf(
      UnconfiguredImageStorage,
    );
  });

  it('올리기와 지우기 모두 일반 Error로 실패한다(전역 필터가 500 C004로 바꾼다)', async () => {
    const storage: ImageStorage = new UnconfiguredImageStorage();
    const file = { originalName: 'a.png', size: 1, buffer: Buffer.from('a') };

    await expect(storage.uploadFile(file, 'tmp_images')).rejects.toThrow(
      '이미지 저장소가 설정되지 않았다',
    );
    await expect(storage.deleteByUrl('https://x.test/a.png')).rejects.toThrow(
      '이미지 저장소가 설정되지 않았다',
    );
  });
});
