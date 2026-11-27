import { BusinessException } from '../../common/error/business.exception.js';
import { ErrorCode } from '../../common/error/error-code.js';
import {
  buildImageKey,
  determineContentType,
  extractKey,
  generateSafeKey,
} from './image-key.js';
import { InMemoryImageStorage } from './in-memory-image-storage.js';

const UUID = '11111111-2222-3333-4444-555555555555';
const UUID_SHAPE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('generateSafeKey (옛 S3ImageValidator.generateSafeKey)', () => {
  it.each([
    ['photo.png', `${UUID}_photo.png`],
    ['my photo (1).png', `${UUID}_my_photo_1_.png`],
    ['a  b.png', `${UUID}_a_b.png`],
    ['한글 사진.jpg', `${UUID}_.jpg`],
    ['__x__.png', `${UUID}_x_.png`],
    ['a--b..c__d.gif', `${UUID}_a--b..c_d.gif`],
    ['사진', `${UUID}_file`],
    ['', `${UUID}_file`],
    ['😀.png', `${UUID}_.png`],
    ['_.png', `${UUID}_.png`],
  ])('이름 %j → 키 %s', (name, expected) => {
    expect(generateSafeKey(name, UUID)).toBe(expected);
  });

  it('UUID를 주지 않으면 새로 만든다', () => {
    const [first, second] = [
      generateSafeKey('a.png'),
      generateSafeKey('a.png'),
    ];
    expect(first.slice(0, 36)).toMatch(UUID_SHAPE);
    expect(first.slice(36)).toBe('_a.png');
    expect(first).not.toBe(second);
  });
});

describe('determineContentType (옛 determineContentType)', () => {
  it.each([
    ['post-images/1/abc_photo.png', 'image/png'],
    ['a.PNG', 'image/png'],
    ['a.jpg', 'image/jpeg'],
    ['a.JPEG', 'image/jpeg'],
    ['a.gif', 'image/gif'],
    ['a.webp', 'application/octet-stream'],
    ['a.svg', 'application/octet-stream'],
    ['profile-images/abc_file', 'application/octet-stream'],
    ['.png', 'application/octet-stream'], // 점이 맨 앞이면 확장자가 아니다
    ['a.', 'application/octet-stream'], // 점이 맨 끝이면 확장자가 없다
  ])('%s → %s', (key, contentType) => {
    expect(determineContentType(key)).toBe(contentType);
  });
});

describe('buildImageKey', () => {
  it('폴더와 안전한 이름을 "/"로 잇는다', () => {
    const key = buildImageKey('tmp_images', 'a b.png');
    expect(key.startsWith('tmp_images/')).toBe(true);
    expect(key.slice('tmp_images/'.length, 'tmp_images/'.length + 36)).toMatch(
      UUID_SHAPE,
    );
    expect(key.endsWith('_a_b.png')).toBe(true);
  });

  it.each([undefined, '', '   '])(
    '이름이 없거나 공백뿐이면(%j) 올린 시각으로 이름을 짓는다',
    (name) => {
      const key = buildImageKey('profile-images', name, () => 1234567890);
      expect(key.endsWith('_unnamed_1234567890')).toBe(true);
    },
  );
});

describe('extractKey (옛 S3ImageValidator.extractKey)', () => {
  const bucket = 'https://bucket.s3.ap-northeast-2.amazonaws.com/';

  it('저장소 주소 뒤의 키를 꺼낸다', () => {
    expect(extractKey(bucket, `${bucket}post-images/7/a.png`)).toBe(
      'post-images/7/a.png',
    );
  });

  it('저장소 주소가 /로 끝나지 않아도 앞의 / 하나를 뗀다', () => {
    const noSlash = 'https://bucket.s3.ap-northeast-2.amazonaws.com';
    expect(extractKey(noSlash, `${noSlash}/profile-images/a.png`)).toBe(
      'profile-images/a.png',
    );
  });

  it.each([
    [
      '다른 저장소의 주소(GitHub 아바타)',
      'https://avatars.githubusercontent.com/u/1?v=4',
    ],
    ['빈 주소', ''],
    ['공백뿐인 주소', '   '],
    ['키가 비어 있음', 'https://bucket.s3.ap-northeast-2.amazonaws.com/'],
    ['키가 공백뿐', 'https://bucket.s3.ap-northeast-2.amazonaws.com/  '],
  ])('거부: %s', (_name, url) => {
    try {
      extractKey(bucket, url);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(BusinessException);
      expect((error as BusinessException).errorCode).toBe(
        ErrorCode.PROFILE_IMAGE_DELETE_FAILED,
      );
    }
  });
});

describe('InMemoryImageStorage', () => {
  const file = (originalName: string) => ({
    originalName,
    size: 3,
    buffer: Buffer.from('abc'),
  });

  it('올린 파일을 키 아래에 두고 저장소 주소로 시작하는 주소를 준다', async () => {
    const storage = new InMemoryImageStorage();
    const url = await storage.uploadFile(file('photo.png'), 'tmp_images');

    expect(url.startsWith(`${storage.bucketUrl}tmp_images/`)).toBe(true);
    const [key, saved] = [...storage.files.entries()][0];
    expect(url).toBe(`${storage.bucketUrl}${key}`);
    expect(saved.contentType).toBe('image/png');
    expect(saved.buffer.toString()).toBe('abc');
  });

  it('주소로 지운다. 이미 없는 파일을 지워도 오류가 아니다', async () => {
    const storage = new InMemoryImageStorage();
    const url = await storage.uploadFile(file('a.png'), 'profile-images');

    await storage.deleteByUrl(url);
    expect(storage.files.size).toBe(0);
    await expect(storage.deleteByUrl(url)).resolves.toBeUndefined();
  });

  it('자기 주소가 아닌 주소는 PROFILE_IMAGE_DELETE_FAILED다', async () => {
    const storage = new InMemoryImageStorage();
    await expect(
      storage.deleteByUrl('https://avatars.githubusercontent.com/u/1'),
    ).rejects.toMatchObject({
      errorCode: ErrorCode.PROFILE_IMAGE_DELETE_FAILED,
    });
  });
});
