import { AnyFilesInterceptor } from '@nestjs/platform-express';
import type { ImageFile } from './image-storage.js';

// 옛 spring.servlet.multipart의 max-file-size와 max-request-size가 둘 다 3MB다. 한도를 넘으면 요청이 컨트롤러에 닿기 전에 거부되고,
// 옛 전역 예외 처리기가 그 예외를 따로 다루지 않아 500 C004로 응답했다고 본다 [추정]. 여기서는 multer가 LIMIT_FILE_SIZE를 던지고
// Nest가 413으로 바꾼 것을 전역 필터가 같은 500 C004로 바꾼다.
// 차이: 옛 한도는 요청 전체(멀티파트 머리글 포함)가 3MB이고 여기서는 파일 하나가 3MB다. 경계에서 수백 바이트 차이만 난다.
export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;

// multer가 파싱해 둔 파일 조각이다(@types/multer 없이 쓰는 필드만 적었다).
export interface UploadedPart {
  readonly fieldname: string;
  readonly originalname: string;
  readonly size: number;
  readonly buffer: Buffer;
}

// @UseInterceptors에 넣는다. 인터셉터는 컨트롤러 메서드 앞에서 요청을 가공하는 장치다(프론트의 axios 인터셉터와 비슷하다).
// 이것은 multipart/form-data 본문을 읽어 파일 조각을 @UploadedFiles()로 넘긴다. 파일을 메모리(buffer)에 둔다(3MB 이하라서 충분하다).
// AnyFilesInterceptor는 칸 이름이 달라도 오류로 보지 않는다. 옛 Spring이 모르는 파트를 무시한 것과 같다.
// defParamCharset: 파서는 파일 이름을 기본으로 latin1로 읽어서 한글 이름이 깨진다. 옛 Spring은 UTF-8로 읽었다.
export const imageUploadInterceptor = () =>
  AnyFilesInterceptor({
    limits: { fileSize: MAX_UPLOAD_BYTES },
    defParamCharset: 'utf8',
  });

// 같은 이름의 파일이 여럿이면 첫 번째를 쓴다(옛 MultipartFile 바인딩과 같다).
export function pickImageFile(
  parts: readonly UploadedPart[] | undefined,
  fieldName: string,
): ImageFile | undefined {
  const part = parts?.find((p) => p.fieldname === fieldName);
  return (
    part && {
      originalName: part.originalname,
      size: part.size,
      buffer: part.buffer,
    }
  );
}
