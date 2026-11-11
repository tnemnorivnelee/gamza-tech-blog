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
