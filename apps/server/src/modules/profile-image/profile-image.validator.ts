import { BusinessException } from '../../common/error/business.exception.js';
import { ErrorCode } from '../../common/error/error-code.js';
import type { ImageFile } from '../../infra/storage/image-storage.js';
import { MAX_UPLOAD_BYTES } from '../../infra/storage/image-upload.js';

const ALLOWED_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif']);

// 옛 ProfileImageValidator.validateFile: 비어 있으면 400 U008, 3MB를 넘으면 400 U009, 확장자가 네 가지가 아니면 400 U010이다(이 순서).
// 확장자는 파일 이름의 마지막 점 뒤를 소문자로 본다. 점이 없으면 확장자가 없는 것이다. 내용(파일 시그니처)은 보지 않는다.
// 3MB 검사는 HTTP로는 닿지 않는다: 요청 한도(3MB)가 먼저 걸려서 이미 거부된다(image-upload.ts). 옛 코드와 같게 남겨 둔다.
export function validateProfileImageFile(file: ImageFile): void {
  if (file.size === 0)
    throw new BusinessException(ErrorCode.PROFILE_IMAGE_EMPTY);
  if (file.size > MAX_UPLOAD_BYTES)
    throw new BusinessException(ErrorCode.PROFILE_IMAGE_SIZE_EXCEEDED);
  const name = file.originalName;
  const ext = name.includes('.')
    ? name.slice(name.lastIndexOf('.') + 1).toLowerCase()
    : '';
  if (!ALLOWED_EXTENSIONS.has(ext))
    throw new BusinessException(ErrorCode.PROFILE_IMAGE_INVALID_TYPE);
}
