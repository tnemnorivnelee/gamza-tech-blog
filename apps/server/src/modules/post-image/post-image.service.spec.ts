import { InMemoryImageStorage } from '../../infra/storage/in-memory-image-storage.js';
import { PostImageService } from './post-image.service.js';

// 글 이미지는 임시 폴더(tmp_images)에 올린다. 글을 저장할 때 글 폴더로 옮기는 일은 글 쓰기(M6-5)가 한다.
describe('PostImageService', () => {
  const file = (originalName: string, size = 3) => ({
    originalName,
    size,
    buffer: Buffer.from('abc'),
  });

  it('tmp_images 폴더에 올리고 저장소 주소를 준다', async () => {
    const storage = new InMemoryImageStorage();
    const service = new PostImageService(storage);

    const url = await service.saveTemporaryImage(file('shot.png'));

    const [key] = [...storage.files.keys()];
    expect(key.startsWith('tmp_images/')).toBe(true);
    expect(key.endsWith('_shot.png')).toBe(true);
    expect(url).toBe(`${storage.bucketUrl}${key}`);
  });

  it('형식과 크기를 검사하지 않는다(옛 코드도 없었다): 이미지가 아닌 파일, 빈 파일도 올라간다', async () => {
    const storage = new InMemoryImageStorage();
    const service = new PostImageService(storage);

    await service.saveTemporaryImage(file('notes.txt'));
    await service.saveTemporaryImage(file('empty.png', 0));

    expect(storage.files.size).toBe(2);
    // 모르는 확장자는 octet-stream으로 올라간다(옛 determineContentType).
    const types = [...storage.files.values()].map((f) => f.contentType).sort();
    expect(types).toEqual(['application/octet-stream', 'image/png']);
  });

  it('저장소가 실패하면 그 오류가 그대로 나간다', async () => {
    const storage = new InMemoryImageStorage();
    vi.spyOn(storage, 'uploadFile').mockRejectedValue(new Error('S3 장애'));

    await expect(
      new PostImageService(storage).saveTemporaryImage(file('a.png')),
    ).rejects.toThrow('S3 장애');
  });
});
