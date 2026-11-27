import { BusinessException } from '../../common/error/business.exception.js';
import { ErrorCode } from '../../common/error/error-code.js';
import { InMemoryImageStorage } from '../../infra/storage/in-memory-image-storage.js';
import type { ImageFile } from '../../infra/storage/image-storage.js';
import { createReadCache } from '../../../test/support/fake-redis.js';
import type { ProfileImageRepository } from './profile-image.repository.js';
import { ProfileImageService } from './profile-image.service.js';

const file = (originalName = 'me.png', size = 3): ImageFile => ({
  originalName,
  size,
  buffer: Buffer.from('abc'),
});

// 저장소는 가짜, 파일 저장소는 메모리 가짜, 캐시는 가짜 Redis 위의 진짜 ReadCache다.
function setup() {
  const repo = {
    findUserWithImage: vi
      .fn()
      .mockResolvedValue({ userId: 7n, imageUrl: null }),
    replaceImage: vi
      .fn()
      .mockImplementation((_userId: bigint, imageUrl: string) =>
        Promise.resolve({ id: 42n, imageUrl }),
      ),
    deleteImages: vi.fn().mockResolvedValue(undefined),
  };
  const storage = new InMemoryImageStorage();
  const { redis, cache } = createReadCache();
  const service = new ProfileImageService(
    repo as unknown as ProfileImageRepository,
    storage,
    cache,
  );
  // 이 사용자와 다른 사용자의 캐시 키다. 쓰기는 이 사용자의 키 하나만 지워야 한다.
  const CACHED = ['cache:userProfile:octo', 'cache:userProfile:boss'];
  const seedCache = () => CACHED.forEach((key) => redis.values.set(key, '1'));
  return { repo, storage, redis, service, seedCache };
}

describe('ProfileImageService', () => {
  describe('updateProfileImage', () => {
    it('이미지가 없던 사용자: profile-images 폴더에 올리고 DB에 넣은 행의 id와 주소를 준다', async () => {
      const { service, repo, storage } = setup();

      const result = await service.updateProfileImage('octo', file('me.png'));

      const [[key]] = [...storage.files.entries()];
      expect(key.startsWith('profile-images/')).toBe(true);
      expect(key.endsWith('_me.png')).toBe(true);
      expect(result).toEqual({
        id: 42,
        imageUrl: `${storage.bucketUrl}${key}`,
      });
      expect(repo.replaceImage).toHaveBeenCalledWith(
        7n,
        `${storage.bucketUrl}${key}`,
      );
      expect(repo.findUserWithImage).toHaveBeenCalledWith('octo');
    });

    it('옛 이미지가 있으면 저장소에서 먼저 지우고 새 파일을 올린 뒤 DB 행을 바꾼다', async () => {
      const { service, repo, storage } = setup();
      const oldUrl = await storage.uploadFile(
        file('old.png'),
        'profile-images',
      );
      repo.findUserWithImage.mockResolvedValue({
        userId: 7n,
        imageUrl: oldUrl,
      });
      const order: string[] = [];
      const realDelete = storage.deleteByUrl.bind(storage);
      const realUpload = storage.uploadFile.bind(storage);
      vi.spyOn(storage, 'deleteByUrl').mockImplementation((url) => {
        order.push('delete');
        return realDelete(url);
      });
      vi.spyOn(storage, 'uploadFile').mockImplementation((f, prefix) => {
        order.push('upload');
        return realUpload(f, prefix);
      });
      repo.replaceImage.mockImplementation((...args: [bigint, string]) => {
        order.push('db');
        return Promise.resolve({ id: 43n, imageUrl: args[1] });
      });

      await service.updateProfileImage('octo', file('new.png'));

      expect(order).toEqual(['delete', 'upload', 'db']);
      expect(storage.files.size).toBe(1);
      expect([...storage.files.keys()][0].endsWith('_new.png')).toBe(true);
    });

    it('성공하면 그 사용자의 userProfile 캐시 키만 지운다', async () => {
      const { service, redis, seedCache } = setup();
      seedCache();

      await service.updateProfileImage('octo', file());

      expect([...redis.values.keys()]).toEqual(['cache:userProfile:boss']);
    });

    it('사용자가 없으면 400 C003이고 파일 검사보다 먼저다(저장소는 건드리지 않는다)', async () => {
      const { service, repo, storage } = setup();
      repo.findUserWithImage.mockResolvedValue(null);

      // 확장자도 틀린 파일이지만 사용자 확인이 먼저라서 C003이다.
      await expect(
        service.updateProfileImage('ghost', file('x.txt')),
      ).rejects.toMatchObject({ errorCode: ErrorCode.ENTITY_NOT_FOUND });
      expect(storage.files.size).toBe(0);
      expect(repo.replaceImage).not.toHaveBeenCalled();
    });

    it.each([
      ['비어 있음', file('a.png', 0), ErrorCode.PROFILE_IMAGE_EMPTY],
      [
        '3MB 초과',
        file('a.png', 3 * 1024 * 1024 + 1),
        ErrorCode.PROFILE_IMAGE_SIZE_EXCEEDED,
      ],
      ['확장자 아님', file('a.txt'), ErrorCode.PROFILE_IMAGE_INVALID_TYPE],
    ])(
      '파일 검사에 걸리면(%s) 옛 이미지를 지우지 않고 캐시도 그대로다',
      async (_name, bad, code) => {
        const { service, repo, storage, redis, seedCache } = setup();
        const oldUrl = await storage.uploadFile(
          file('old.png'),
          'profile-images',
        );
        repo.findUserWithImage.mockResolvedValue({
          userId: 7n,
          imageUrl: oldUrl,
        });
        seedCache();

        await expect(
          service.updateProfileImage('octo', bad),
        ).rejects.toMatchObject({ errorCode: code });

        expect(storage.files.size).toBe(1);
        expect(repo.replaceImage).not.toHaveBeenCalled();
        expect(redis.values.size).toBe(2);
      },
    );

    // 옛 코드의 구멍: 옛 이미지 삭제가 실패하면 전체가 실패해서, 저장소 주소가 아닌 GitHub 아바타 주소를 가진 사용자는 이미지를 바꿀 수 없다.
    it('옛 이미지 주소가 이 저장소 것이 아니면 500 U012로 실패하고 올리지도 DB를 바꾸지도 않는다', async () => {
      const { service, repo, storage, redis, seedCache } = setup();
      repo.findUserWithImage.mockResolvedValue({
        userId: 7n,
        imageUrl: 'https://avatars.githubusercontent.com/u/1?v=4',
      });
      seedCache();

      await expect(
        service.updateProfileImage('octo', file()),
      ).rejects.toMatchObject({
        errorCode: ErrorCode.PROFILE_IMAGE_DELETE_FAILED,
      });

      expect(storage.files.size).toBe(0);
      expect(repo.replaceImage).not.toHaveBeenCalled();
      expect(redis.values.size).toBe(2);
    });

    it('올리기가 실패하면 DB는 그대로이고 캐시도 지우지 않는다(옛 파일은 이미 지워졌다)', async () => {
      const { service, repo, storage, redis, seedCache } = setup();
      const oldUrl = await storage.uploadFile(
        file('old.png'),
        'profile-images',
      );
      repo.findUserWithImage.mockResolvedValue({
        userId: 7n,
        imageUrl: oldUrl,
      });
      vi.spyOn(storage, 'uploadFile').mockRejectedValue(new Error('S3 장애'));
      seedCache();

      await expect(service.updateProfileImage('octo', file())).rejects.toThrow(
        'S3 장애',
      );

      expect(repo.replaceImage).not.toHaveBeenCalled();
      expect(storage.files.size).toBe(0);
      expect(redis.values.size).toBe(2);
    });

    it('DB 교체가 실패하면 올린 파일은 남고 캐시는 그대로다(옛 코드도 같다)', async () => {
      const { service, repo, storage, redis, seedCache } = setup();
      repo.replaceImage.mockRejectedValue(new Error('DB 장애'));
      seedCache();

      await expect(service.updateProfileImage('octo', file())).rejects.toThrow(
        'DB 장애',
      );

      expect(storage.files.size).toBe(1);
      expect(redis.values.size).toBe(2);
    });
  });

  describe('deleteProfileImage', () => {
    it('이미지가 있으면 저장소에서 지우고 DB 행을 지우고 캐시 키를 지운다', async () => {
      const { service, repo, storage, redis, seedCache } = setup();
      const url = await storage.uploadFile(file(), 'profile-images');
      repo.findUserWithImage.mockResolvedValue({ userId: 7n, imageUrl: url });
      seedCache();

      await service.deleteProfileImage('octo');

      expect(storage.files.size).toBe(0);
      expect(repo.deleteImages).toHaveBeenCalledWith(7n);
      expect([...redis.values.keys()]).toEqual(['cache:userProfile:boss']);
    });

    // 옛 메서드가 이미지가 없어도 정상으로 끝나서 @CacheEvict가 돈다.
    it('이미지가 없어도 성공이고 DB는 건드리지 않지만 캐시 키는 지운다', async () => {
      const { service, repo, redis, seedCache } = setup();
      seedCache();

      await expect(service.deleteProfileImage('octo')).resolves.toBeUndefined();

      expect(repo.deleteImages).not.toHaveBeenCalled();
      expect([...redis.values.keys()]).toEqual(['cache:userProfile:boss']);
    });

    it('사용자가 없으면 400 C003이다', async () => {
      const { service, repo } = setup();
      repo.findUserWithImage.mockResolvedValue(null);

      await expect(service.deleteProfileImage('ghost')).rejects.toMatchObject({
        errorCode: ErrorCode.ENTITY_NOT_FOUND,
      });
    });

    // 옛 catch (BusinessException e)는 저장소의 "주소가 이 저장소 것이 아님" 오류를 무시한다.
    it('저장소 삭제가 BusinessException으로 실패하면 무시하고 DB 행은 지운다', async () => {
      const { service, repo, redis, seedCache } = setup();
      repo.findUserWithImage.mockResolvedValue({
        userId: 7n,
        imageUrl: 'https://avatars.githubusercontent.com/u/1?v=4',
      });
      seedCache();

      await expect(service.deleteProfileImage('octo')).resolves.toBeUndefined();

      expect(repo.deleteImages).toHaveBeenCalledWith(7n);
      expect([...redis.values.keys()]).toEqual(['cache:userProfile:boss']);
    });

    it('BusinessException이 아닌 오류는 무시하지 않는다(DB 행도 캐시도 그대로)', async () => {
      const { service, repo, storage, redis, seedCache } = setup();
      repo.findUserWithImage.mockResolvedValue({
        userId: 7n,
        imageUrl: `${storage.bucketUrl}profile-images/a.png`,
      });
      vi.spyOn(storage, 'deleteByUrl').mockRejectedValue(
        new Error('연결 끊김'),
      );
      seedCache();

      await expect(service.deleteProfileImage('octo')).rejects.toThrow(
        '연결 끊김',
      );

      expect(repo.deleteImages).not.toHaveBeenCalled();
      expect(redis.values.size).toBe(2);
    });

    it('저장된 주소가 비어 있으면 400 U008이고 저장소는 부르지 않는다', async () => {
      const { service, repo, storage } = setup();
      repo.findUserWithImage.mockResolvedValue({ userId: 7n, imageUrl: '  ' });
      const deleteSpy = vi.spyOn(storage, 'deleteByUrl');

      await expect(service.deleteProfileImage('octo')).rejects.toMatchObject({
        errorCode: ErrorCode.PROFILE_IMAGE_EMPTY,
      });

      expect(deleteSpy).not.toHaveBeenCalled();
      expect(repo.deleteImages).not.toHaveBeenCalled();
    });

    it('BusinessException을 던지는 저장소 오류는 BusinessException 그대로다(타입 확인)', async () => {
      const { storage } = setup();
      await expect(
        storage.deleteByUrl('https://example.com/x.png'),
      ).rejects.toBeInstanceOf(BusinessException);
    });
  });
});
