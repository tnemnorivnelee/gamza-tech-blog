import type { Type } from '@nestjs/common';
import { ApiPropertyOptional, type ApiPropertyOptions } from '@nestjs/swagger';

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

const int32: ApiPropertyOptions = { type: 'integer', format: 'int32' };
const int64: ApiPropertyOptions = { type: 'integer', format: 'int64' };

// Nest는 제네릭 스키마 이름을 못 만든다. 옛 명세의 ResponseDtoXxx 같은 이름을 클래스 이름으로 직접 만든다.
// 같은 이름은 같은 클래스를 돌려준다. 이름이 같은 다른 클래스가 생기면 스키마가 덮어써진다.
const classes = new Map<string, Type>();

function defineDto(
  name: string,
  properties: Record<string, ApiPropertyOptions>,
): Type {
  const cached = classes.get(name);
  if (cached) return cached;

  const dto = { [name]: class {} }[name]!;
  for (const [key, options] of Object.entries(properties)) {
    ApiPropertyOptional(options)(dto.prototype, key);
  }
  classes.set(name, dto);
  return dto;
}

// 옛 springdoc 명세에서는 응답 필드가 모두 선택(required 없음)이었다.
function wrapper(name: string, data: ApiPropertyOptions): Type {
  return defineDto(name, {
    status: int32,
    message: { type: 'string' },
    data,
    timestamp: int64,
  });
}

export const PagedResponseOf = (model: Type) =>
  defineDto(`PagedResponse${model.name}`, {
    content: { type: () => [model] },
    page: int32,
    size: int32,
    totalElements: int64,
    totalPages: int32,
  });

export const ResponseDtoOf = (model: Type) =>
  wrapper(`ResponseDto${model.name}`, { type: () => model });

export const ResponseDtoListOf = (model: Type | StringConstructor) =>
  wrapper(`ResponseDtoList${model.name}`, { type: () => [model] });

export const ResponseDtoPagedOf = (model: Type) => {
  const paged = PagedResponseOf(model);
  return wrapper(`ResponseDto${paged.name}`, { type: () => paged });
};

export const ResponseDtoString = wrapper('ResponseDtoString', {
  type: 'string',
});
export const ResponseDtoLong = wrapper('ResponseDtoLong', int64);
export const ResponseDtoBoolean = wrapper('ResponseDtoBoolean', {
  type: 'boolean',
});
export const ResponseDtoVoid = wrapper('ResponseDtoVoid', { type: Object });
