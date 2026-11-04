import type { Type } from '@nestjs/common';
import { ApiPropertyOptional, type ApiPropertyOptions } from '@nestjs/swagger';

// 이 파일의 클래스는 응답을 만드는 용도가 아니라 OpenAPI 명세에 스키마 이름을 남기는 용도다.
// 실제 응답은 ResponseDto / PagedResponse가 만든다. 필드는 그 두 클래스와 같게 유지한다.
//
// 옛 자바는 제네릭 ResponseDto<T>에서 springdoc이 ResponseDtoXxx 이름을 자동으로 지었다.
// TypeScript는 실행 시점에 제네릭이 사라져서, 같은 이름의 클래스를 직접 만든다.
// 이름을 지키는 이유: 프론트의 생성 클라이언트가 이 이름을 쓴다(계약 비교 시험이 지킨다).

const int32: ApiPropertyOptions = { type: 'integer', format: 'int32' };
const int64: ApiPropertyOptions = { type: 'integer', format: 'int64' };

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
