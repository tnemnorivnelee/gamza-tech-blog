import { randomUUID } from 'node:crypto';
import { BusinessException } from '../../common/error/business.exception.js';
import { ErrorCode } from '../../common/error/error-code.js';

// 옛 S3ImageValidator와 S3ImageStorageImpl이 파일 이름·주소를 다루던 규칙을 순수 함수로 옮겼다.
// 가짜 저장소(시험용)와 진짜 S3 어댑터(M6-4b)가 같은 함수를 쓰므로, 둘이 만드는 키와 주소 해석이 같다.

// 옛 generateSafeKey: 영문·숫자와 . _ - 이외의 글자를 _로 바꾸고, 연속된 _를 하나로 줄이고, 앞뒤 _를 떼고, 비면 "file"이다.
// 맨 앞에 UUID를 붙인다. u 플래그는 BMP 밖 글자(이모지)를 한 글자로 세는 Java와 같게 하려는 것이다.
export function generateSafeKey(
  originalFileName: string,
  uuid: string = randomUUID(),
): string {
  let safe = originalFileName
    .replace(/[^a-zA-Z0-9._-]/gu, '_')
    .replace(/_{2,}/gu, '_')
    .replace(/^_+|_+$/gu, '');
  if (safe === '') safe = 'file';
  return `${uuid}_${safe}`;
}

// 옛 determineContentType: 확장자로 정하고 모르면 octet-stream이다. 이름이 아니라 전체 키에 적용한다(마지막 점이 맨 앞이거나
// 맨 끝이면 확장자가 없다). 글 이미지는 형식 검사가 없어서 이 밖의 확장자도 그대로 올라간다.
export function determineContentType(key: string): string {
  const dot = key.lastIndexOf('.');
  const ext =
    dot > 0 && dot < key.length - 1 ? key.slice(dot + 1).toLowerCase() : '';
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    default:
      return 'application/octet-stream';
  }
}

// 파일 이름이 없으면 올린 시각으로 이름을 짓는다(옛 S3ImageStorageImpl.uploadFile).
// 전체 키는 "<폴더>/<UUID>_<안전한 이름>"이다.
export function buildImageKey(
  prefix: string,
  originalName: string | undefined,
  now: () => number = Date.now,
): string {
  const name =
    originalName === undefined || originalName.trim() === ''
      ? `unnamed_${now()}`
      : originalName;
  return `${prefix}/${generateSafeKey(name)}`;
}

// 옛 extractKey: 주소가 이 저장소의 주소로 시작해야 키를 꺼낼 수 있다. 아니면(예: GitHub 아바타 주소) 500 U012다.
// 시작 부분 뒤의 / 하나는 떼고, 남은 키가 비면 역시 U012다.
export function extractKey(bucketUrl: string, fileUrl: string): string {
  if (fileUrl.trim() === '' || !fileUrl.startsWith(bucketUrl))
    throw new BusinessException(ErrorCode.PROFILE_IMAGE_DELETE_FAILED);
  let key = fileUrl.slice(bucketUrl.length);
  if (key.startsWith('/')) key = key.slice(1);
  if (key.trim() === '')
    throw new BusinessException(ErrorCode.PROFILE_IMAGE_DELETE_FAILED);
  return key;
}
