// 옛 Spring/Java가 요청 값과 문자열을 다루던 규칙을 그대로 옮긴 작은 함수들이다(docs/m5-read-api-plan.md 3.1).
// JS의 기본 동작과 조금씩 달라서, 같은 입력에 같은 응답을 내려면 따로 맞춰야 한다.

// Java의 String.trim(): 코드 포인트 U+0020 이하만 앞뒤에서 지운다.
// JS의 trim()은 전각 공백(U+3000), NBSP(U+00A0), BOM까지 지워서 결과가 달라진다.
// 제어 문자까지 지우는 것이 목적이라 no-control-regex 경고는 끈다.
// oxlint-disable-next-line no-control-regex
const JAVA_TRIM = /^[\x00-\x20]+|[\x00-\x20]+$/g;
export const javaTrim = (text: string) => text.replace(JAVA_TRIM, '');

// Spring의 request.getParameter는 같은 이름이 여러 번 와도 첫 값만 준다. Express는 배열로 준다.
// 문자열이 아닌 값(?a[b]=c 같은 중첩)은 Spring에서 다른 이름의 파라미터라서 "없음"으로 본다.
export function firstQueryValue(value: unknown): string | undefined {
  const first: unknown = Array.isArray(value) ? value[0] : value;
  return typeof first === 'string' ? first : undefined;
}

// Java의 Character.isWhitespace: 탭·줄바꿈·구분 제어 문자(0x1C~0x1F)와 공백류에서, 줄바꿈 안 되는 공백(0xA0, 0x2007, 0x202F)을 뺀 것이다.
// JS의 \s와 다르다(NBSP와 BOM을 포함한다). 코드 값으로 판정한다.
const isJavaWhitespace = (code: number) =>
  (code >= 0x09 && code <= 0x0d) ||
  (code >= 0x1c && code <= 0x20) ||
  code === 0x1680 ||
  (code >= 0x2000 && code <= 0x2006) ||
  (code >= 0x2008 && code <= 0x200a) ||
  code === 0x2028 ||
  code === 0x2029 ||
  code === 0x205f ||
  code === 0x3000;
const stripJavaWhitespace = (text: string) =>
  Array.from(text)
    .filter((char) => !isJavaWhitespace(char.codePointAt(0) ?? 0))
    .join('');
const INT64_MIN = -(2n ** 63n);
const INT64_MAX = 2n ** 63n - 1n;

// Spring의 @PathVariable Long 변환(StringToNumberConverterFactory → NumberUtils.parseNumber)이다.
// 공백을 전부 지우고(안쪽 공백도), 16진수(0x, 0X, #로 시작, 앞에 - 가능)면 Long.decode, 아니면 Long.valueOf(부호 +, - 가능)로 읽는다.
// 숫자가 아니거나 int64 범위를 넘으면 NumberFormatException이라 undefined다. 2^53을 넘는 값이 있어서 bigint로 돌려준다.
// shortcut: 숫자는 ASCII만 받는다(parseJavaInt와 같다).
export function parseSpringLong(text: string): bigint | undefined {
  const trimmed = stripJavaWhitespace(text);
  const hex = /^(-?)(?:0[xX]|#)([0-9a-fA-F]+)$/.exec(trimmed);
  let value: bigint;
  if (hex) {
    const magnitude = BigInt(`0x${hex[2]}`);
    value = hex[1] ? -magnitude : magnitude;
  } else if (/^[+-]?\d+$/.test(trimmed)) {
    value = BigInt(trimmed);
  } else {
    return undefined;
  }
  return value >= INT64_MIN && value <= INT64_MAX ? value : undefined;
}

const INT32_MIN = -(2 ** 31);
const INT32_MAX = 2 ** 31 - 1;

// Java의 Integer.parseInt: 부호(+, -)와 숫자만 받고 int32 범위 안이어야 한다.
// 공백, 소수점, 지수(1e3), 16진수(0x10), 범위 초과는 모두 NumberFormatException이라 undefined다.
// shortcut: 숫자는 ASCII만 받는다. Java는 다른 문자 체계의 숫자도 받지만 요청에 올 일이 없다.
export function parseJavaInt(text: string): number | undefined {
  if (!/^[+-]?\d+$/.test(text)) return undefined;
  const value = Number(text);
  return value >= INT32_MIN && value <= INT32_MAX ? value : undefined;
}
