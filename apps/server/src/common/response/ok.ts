export interface ResponseBody<T> {
  status: number;
  message: string;
  data?: T;
  timestamp: number;
}

// 옛 ResponseDto.of(HttpStatus, message, data). data가 없으면 키를 뺀다(옛 @JsonInclude(NON_NULL)).
// status는 본문 값일 뿐 HTTP 상태와 별개다. 옛 컨트롤러는 CREATED를 넣어도 HTTP는 200이었다.
export function ok<T>(
  message: string,
  data?: T,
  status = 200,
): ResponseBody<T> {
  return {
    status,
    message,
    ...(data == null ? {} : { data }),
    timestamp: Date.now(),
  };
}
