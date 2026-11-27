import { BusinessException } from '../../common/error/business.exception.js';
import {
  ErrorCode,
  type ErrorCodeInfo,
} from '../../common/error/error-code.js';
import { validateProfileImageFile } from './profile-image.validator.js';

const MB3 = 3 * 1024 * 1024;
const file = (originalName: string, size = 10) => ({
  originalName,
  size,
  buffer: Buffer.alloc(0),
});

function codeOf(name: string, size?: number): ErrorCodeInfo | undefined {
  try {
    validateProfileImageFile(file(name, size));
  } catch (error) {
    if (error instanceof BusinessException) return error.errorCode;
    throw error;
  }
  return undefined;
}

// 옛 ProfileImageValidator.validateFile: 비어 있음(U008) → 3MB 초과(U009) → 확장자(U010) 순서다.
describe('validateProfileImageFile', () => {
  it.each([
    'a.jpg',
    'a.jpeg',
    'a.png',
    'a.gif',
    'A.PNG',
    'a.JpG',
    'x.tar.png',
    '.png', // 점이 있으면 마지막 점 뒤가 확장자다(숨김 파일 이름도 그렇다)
    '사진 1.jpeg',
  ])('통과: %s', (name) => {
    expect(codeOf(name)).toBeUndefined();
  });

  it.each(['a.webp', 'a.svg', 'a.png.exe', 'a.txt', 'noextension', 'a.', ''])(
    '확장자가 네 가지가 아니면 U010이다: %j',
    (name) => {
      expect(codeOf(name)).toBe(ErrorCode.PROFILE_IMAGE_INVALID_TYPE);
    },
  );

  it('크기는 3MB까지 통과하고 1바이트만 넘어도 U009다', () => {
    expect(codeOf('a.png', MB3)).toBeUndefined();
    expect(codeOf('a.png', MB3 + 1)).toBe(
      ErrorCode.PROFILE_IMAGE_SIZE_EXCEEDED,
    );
  });

  it('비어 있으면 U008이다', () => {
    expect(codeOf('a.png', 0)).toBe(ErrorCode.PROFILE_IMAGE_EMPTY);
  });

  it('검사 순서: 비어 있음이 크기와 확장자보다 먼저, 크기가 확장자보다 먼저다', () => {
    expect(codeOf('a.txt', 0)).toBe(ErrorCode.PROFILE_IMAGE_EMPTY);
    expect(codeOf('a.txt', MB3 + 1)).toBe(
      ErrorCode.PROFILE_IMAGE_SIZE_EXCEEDED,
    );
  });
});
