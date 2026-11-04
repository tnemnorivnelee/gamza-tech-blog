// 옛 ResponseDto<T>. 응답 본문의 껍데기다.
// 옛 @JsonInclude(NON_NULL)처럼 data가 null/undefined이면 키를 뺀다(0, false, ''는 값이므로 남긴다).
// status는 본문 값일 뿐 HTTP 상태와 별개다. 옛 컨트롤러는 CREATED를 넣어도 HTTP는 200이었다.
// 명세에 나가는 ResponseDtoXxx 스키마는 response-schema.factory.ts가 따로 만든다. 필드가 바뀌면 그쪽도 같이 고친다.
export class ResponseDto<T = unknown> {
  readonly status: number;
  readonly message: string;
  readonly data?: T;
  readonly timestamp: number;

  private constructor(status: number, message: string, data?: T) {
    this.status = status;
    this.message = message;
    if (data != null) this.data = data;
    this.timestamp = Date.now();
  }

  static of<T>(message: string, data?: T, status = 200): ResponseDto<T> {
    return new ResponseDto(status, message, data);
  }
}
