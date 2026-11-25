import { ApiProperty } from '@nestjs/swagger';
import { FieldError } from '../../../common/dto/error-response.dto.js';
import { ValidationFailedException } from '../../../common/error/input.exception.js';
import { javaTrim } from '../../../common/spring-compat.js';

// 클래스 이름이 곧 스키마 이름이다(프론트 모델 이름과 같아야 한다).
export class IntroCreateRequest {
  @ApiProperty({ type: 'string', minLength: 2, maxLength: 1000 })
  content: string;
}

const NOT_BLANK_MESSAGE = '자기소개 내용은 필수입니다.';
const SIZE_MESSAGE = '자기소개는 2~1000자 사이로 입력하세요.';

// 옛 @Valid @RequestBody IntroCreateRequest와 같은 검사다: @NotBlank(없거나 공백뿐이면 거부)와 @Size(min = 2, max = 1000).
// 위반하면 400 C001과 필드별 오류(field, 거부된 값, 규칙의 메시지)다.
// - @NotBlank는 Java의 trim(U+0020 이하를 지움)으로 비었는지 본다. 그래서 javaTrim이다.
// - @Size는 문자열의 length(UTF-16 코드 단위 수)다. JS의 .length와 같아서 이모지는 두 칸이다. 앞뒤 공백도 센다.
// - 없는 값(null)은 @Size를 통과한다. 그래서 내용이 없으면 오류는 하나뿐이고, 빈 문자열은 둘 다 위반해 오류가 둘이다.
//   두 오류의 순서는 옛 Spring이 정하지 않아서 맞출 수 없다(위반 집합의 순회 순서). 여기서는 @NotBlank를 먼저 둔다.
// 이미 설치된 class-validator의 길이 검사는 이모지를 한 칸으로 세어서 옛 동작과 달라 쓰지 않았다.
export function validateIntroCreateRequest(
  request: IntroCreateRequest | undefined,
): void {
  const content: unknown = request?.content;
  const text = typeof content === 'string' ? content : null;
  const errors: FieldError[] = [];
  if (text === null || javaTrim(text).length === 0)
    errors.push(FieldError.of('content', content, NOT_BLANK_MESSAGE));
  if (text !== null && (text.length < 2 || text.length > 1000))
    errors.push(FieldError.of('content', text, SIZE_MESSAGE));
  if (errors.length > 0) throw new ValidationFailedException(errors);
}
