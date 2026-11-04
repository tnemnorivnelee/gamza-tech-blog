import { ApiPropertyOptional } from '@nestjs/swagger';

// 옛 ResponseDto<T>. 응답 본문의 껍데기다.
// 옛 @JsonInclude(NON_NULL)처럼 data가 null/undefined이면 키를 뺀다(0, false, ''는 값이므로 남긴다).
// status는 본문 값일 뿐 HTTP 상태와 별개다. 옛 컨트롤러는 CREATED를 넣어도 HTTP는 200이었다.
//
// 명세에서는 이 클래스가 공통 껍데기 스키마(status, message, timestamp)가 된다. 옛 명세처럼 필드는 모두 선택이다.
// data는 엔드포인트마다 타입이 달라서(TypeScript는 제네릭을 남기지 않는다) 여기서 적지 않고,
// 각 응답의 @OkOf 같은 데코레이터(common/swagger/api-decorators.ts)가 적는다.
export class ResponseDto<T = unknown> {
  @ApiPropertyOptional({ type: 'integer', format: 'int32' })
  readonly status: number;

  @ApiPropertyOptional({ type: 'string' })
  readonly message: string;

  readonly data?: T;

  @ApiPropertyOptional({ type: 'integer', format: 'int64' })
  readonly timestamp: number;

  constructor(status: number, message: string, data?: T) {
    this.status = status;
    this.message = message;
    if (data != null) this.data = data;
    this.timestamp = Date.now();
  }

  static of<T>(message: string, data?: T, status = 200): ResponseDto<T> {
    return new ResponseDto(status, message, data);
  }
}
