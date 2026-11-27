// 업로드된 이미지 파일 하나다. 멀티파트 파서(multer)가 메모리에 읽어 둔 값을 컨트롤러가 이 모양으로 넘긴다.
export interface ImageFile {
  // 요청이 보낸 원래 파일 이름이다. 확장자 검사와 키 이름에 쓴다.
  readonly originalName: string;
  readonly size: number;
  readonly buffer: Buffer;
}

// 이미지 저장소의 계약이다(옛 S3ImageStorage 인터페이스). 운영은 S3(M6-4b), 시험은 메모리 가짜다.
// interface는 실행할 때 사라져서 Nest가 "무엇을 넣어 줄지" 알 수 없다. 남아 있는 추상 클래스를 이름표로 쓴다(TokenStore와 같다).
// 필요해지는 대로 메서드를 더한다: 글 쓰기(M6-5)가 임시 이미지를 글 폴더로 옮기는 move를 더한다.
export abstract class ImageStorage {
  // 파일을 "<폴더>/<UUID>_<안전한 이름>"으로 올리고 그 주소를 준다.
  abstract uploadFile(file: ImageFile, prefix: string): Promise<string>;
  // 주소로 파일을 지운다. 이 저장소의 주소가 아니면 BusinessException(PROFILE_IMAGE_DELETE_FAILED)이다.
  // 이미 없는 파일을 지우는 것은 오류가 아니다(S3의 deleteObject처럼).
  abstract deleteByUrl(fileUrl: string): Promise<void>;
}
