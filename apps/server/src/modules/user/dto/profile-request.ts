import { isValidEmail } from '../../../common/email-validator.js';
import { FieldError } from '../../../common/dto/error-response.dto.js';
import { BusinessException } from '../../../common/error/business.exception.js';
import { ErrorCode } from '../../../common/error/error-code.js';
import { ValidationFailedException } from '../../../common/error/input.exception.js';
import { javaTrim } from '../../../common/spring-compat.js';

// 옛 Position enum이다. 선언 순서가 OpenAPI의 enum 순서가 된다.
export const POSITIONS = [
  'BACKEND',
  'FRONTEND',
  'DESIGNER',
  'APP_DEVELOPER',
] as const;
export type Position = (typeof POSITIONS)[number];

// 프로필 완성(UserProfileRequest)과 수정(UpdateProfileRequest)이 검사를 거친 뒤 서비스에 넘기는 값이다.
// 이메일은 완성에서만 없을 수 있다(null).
export interface ProfileFields {
  readonly email: string | null;
  readonly studentNumber: string;
  readonly gamjaBatch: number;
  readonly position: Position;
}

// 옛 Hibernate Validator의 기본 메시지(한국어)다. 옛 서버는 요청의 Accept-Language로 언어를 골라서, 한국어 브라우저가 보낸 요청의 메시지를 따른다.
// 다른 언어 요청의 영어 메시지는 옮기지 않았다.
const NOT_BLANK_MESSAGE = '공백일 수 없습니다';
const NOT_NULL_MESSAGE = '널이어서는 안됩니다';
const EMAIL_MESSAGE = '올바른 형식의 이메일 주소여야 합니다';

// 옛 Jackson이 요청 본문을 읽다가 실패하면(칸의 타입이 틀렸거나 enum 값이 없음) HttpMessageNotReadableException이고,
// 옛 전역 예외 처리기는 그것을 처리하지 않아 마지막의 Exception 처리기가 500 C004로 응답했다.
// shortcut: Jackson이 관대하게 바꿔 받는 입력(문자열 "9"를 숫자로, 숫자를 문자열로, 소수를 정수로, 숫자 순번을 enum으로)은 옮기지 않고 500으로 둔다.
// 프론트가 생성한 클라이언트는 정해진 타입으로만 보낸다. 옛 서버로 확인하게 되면 그때 맞춘다.
const unreadable = () => new BusinessException(ErrorCode.INTERNAL_SERVER_ERROR);

const INT_MIN = -(2 ** 31);
const INT_MAX = 2 ** 31 - 1;

function readString(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === 'string') return raw;
  throw unreadable();
}

function readInteger(raw: unknown): number | null {
  if (raw === undefined || raw === null) return null;
  if (
    typeof raw === 'number' &&
    Number.isInteger(raw) &&
    raw >= INT_MIN &&
    raw <= INT_MAX
  )
    return raw;
  throw unreadable();
}

function readPosition(raw: unknown): Position | null {
  if (raw === undefined || raw === null) return null;
  const position = POSITIONS.find((name) => name === raw);
  if (position) return position;
  throw unreadable();
}

// 옛 @Valid @RequestBody UserProfileRequest(프로필 완성)와 UpdateProfileRequest(프로필 수정)의 검사다.
// - 칸을 읽다가 타입이 틀리면 500 C004다(위 설명). 읽기가 검사보다 먼저라서 400보다 앞선다.
// - 학번은 @NotBlank: 없거나 Java trim으로 비면 거부한다.
// - 기수와 포지션은 @NotNull이다.
// - 이메일은 @Email이다. 비어 있거나 없으면 통과한다. 수정에서는 @NotBlank가 더 붙는다(emailRequired).
//   그래서 수정에서 빈 문자열은 NotBlank 오류 하나, 공백만 있는 문자열은 NotBlank와 Email 오류 둘이다.
// 위반하면 400 C001과 필드별 오류(field, 거부된 값, 규칙의 메시지)다. 오류 순서는 옛 Spring이 정하지 않아서 맞출 수 없다.
// 여기서는 칸 순서(이메일, 학번, 기수, 포지션)와 같은 칸 안에서 NotBlank를 먼저 둔다.
export function readProfileRequest(
  body: unknown,
  { emailRequired }: { emailRequired: boolean },
): ProfileFields {
  const raw: Record<string, unknown> =
    typeof body === 'object' && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  const email = readString(raw.email);
  const studentNumber = readString(raw.studentNumber);
  const gamjaBatch = readInteger(raw.gamjaBatch);
  const position = readPosition(raw.position);

  const errors: FieldError[] = [];
  if (emailRequired && (email === null || javaTrim(email).length === 0))
    errors.push(FieldError.of('email', email, NOT_BLANK_MESSAGE));
  if (email !== null && !isValidEmail(email))
    errors.push(FieldError.of('email', email, EMAIL_MESSAGE));
  if (studentNumber === null || javaTrim(studentNumber).length === 0)
    errors.push(
      FieldError.of('studentNumber', studentNumber, NOT_BLANK_MESSAGE),
    );
  if (gamjaBatch === null)
    errors.push(FieldError.of('gamjaBatch', gamjaBatch, NOT_NULL_MESSAGE));
  if (position === null)
    errors.push(FieldError.of('position', position, NOT_NULL_MESSAGE));

  if (
    errors.length > 0 ||
    studentNumber === null ||
    gamjaBatch === null ||
    position === null
  )
    throw new ValidationFailedException(errors);
  return { email, studentNumber, gamjaBatch, position };
}
