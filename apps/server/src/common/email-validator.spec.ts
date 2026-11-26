import { EMAIL_DOMAIN_PATTERN, isValidEmail } from './email-validator.js';

describe('isValidEmail (옛 Hibernate @Email)', () => {
  it.each([
    'jihun@example.com',
    'a@b', // 최상위 도메인이 없어도 통과한다(옛 규칙)
    'first.last+tag@sub.example.co.kr',
    "!#$%&'*+/=?^_`{|}~-@example.com",
    '"quoted..local"@example.com',
    '"a@b"@example.com', // 따옴표 안의 @
    '"esc\\\\aped\\"quote"@example.com',
    'user@[127.0.0.1]',
    'user@[IPv6:::1]',
    '한글@한글.kr',
    'a@x-y.example',
    'a@x--y.example',
    'a@1.2',
  ])('통과: %s', (email) => {
    expect(isValidEmail(email)).toBe(true);
  });

  it('빈 문자열은 통과한다(옛 @Email은 null과 빈 값을 거르지 않는다)', () => {
    expect(isValidEmail('')).toBe(true);
  });

  it.each([
    ['@ 없음', 'plain'],
    ['로컬 없음', '@example.com'],
    ['도메인 없음', 'a@'],
    ['도메인 끝의 점', 'a@example.com.'],
    ['로컬 끝의 점', 'a.@example.com'],
    ['로컬 앞의 점', '.a@example.com'],
    ['로컬의 연속된 점', 'a..b@example.com'],
    ['도메인의 연속된 점', 'a@example..com'],
    ['공백', 'a b@example.com'],
    ['앞 공백', ' a@example.com'],
    ['도메인 공백', 'a@exa mple.com'],
    ['라벨이 -로 시작', 'a@-x.com'],
    ['라벨이 -로 끝남', 'a@x-.com'],
    ['따옴표 밖의 @', 'a@b@example.com'],
    ['닫히지 않은 따옴표', '"abc@example.com'],
    ['이모지(BMP 밖 글자)는 범위 밖', 'a😀@example.com'],
    ['대괄호가 닫히지 않은 IP', 'a@[127.0.0.1'],
    ['IP 칸 수 오류', 'a@[1.2.3]'],
  ])('거부: %s', (_reason, email) => {
    expect(isValidEmail(email)).toBe(false);
  });

  it('로컬 파트는 64자까지다', () => {
    expect(isValidEmail(`${'a'.repeat(64)}@example.com`)).toBe(true);
    expect(isValidEmail(`${'a'.repeat(65)}@example.com`)).toBe(false);
  });

  it('도메인 라벨은 63자, 전체는 255자까지다', () => {
    expect(isValidEmail(`a@${'b'.repeat(63)}.com`)).toBe(true);
    expect(isValidEmail(`a@${'b'.repeat(64)}.com`)).toBe(false);
    const label = 'b'.repeat(60);
    // 라벨 4개(60자)와 점 3개 = 243자, 여기에 ".com"을 붙이면 247자
    expect(
      isValidEmail(`a@${[label, label, label, label].join('.')}.com`),
    ).toBe(true);
    expect(
      isValidEmail(
        `a@${[label, label, label, label, 'bbbbbbbb'].join('.')}.com`,
      ),
    ).toBe(false);
  });

  it('유니코드 도메인도 변환 뒤 63자를 넘으면 거부한다', () => {
    expect(isValidEmail(`a@${'한'.repeat(10)}.kr`)).toBe(true);
    expect(isValidEmail(`a@${'한'.repeat(60)}.kr`)).toBe(false);
  });

  // 소유 한정자(++)를 일반 반복으로 옮겼다. 규칙을 손으로 쓴 기준(라벨은 비지 않고, 첫 글자와 끝 글자는 도메인 글자, 사이는 도메인 글자나 -)과
  // 짧은 문자열 전부에서 같은 결과인지 확인한다.
  describe('도메인 패턴이 손으로 쓴 규칙과 같은 문자열을 받는다', () => {
    const isDomainChar = (ch: string) =>
      /^[a-z\u0080-\uFFFF0-9!#$%&'*+/=?^_`{|}~]$/iu.test(ch);
    const reference = (domain: string) =>
      domain.split('.').every((label) => {
        const chars = [...label];
        return (
          chars.length > 0 &&
          isDomainChar(chars[0]) &&
          isDomainChar(chars[chars.length - 1]) &&
          chars.every((ch) => ch === '-' || isDomainChar(ch))
        );
      });
    const SYMBOLS = ['a', 'K', '-', '.', '!', 'é', ' ', '😀'];

    it('길이 5까지 모든 조합', () => {
      let compared = 0;
      const walk = (prefix: string, depth: number) => {
        expect(EMAIL_DOMAIN_PATTERN.test(prefix)).toBe(reference(prefix));
        compared += 1;
        if (depth === 5) return;
        for (const symbol of SYMBOLS) walk(prefix + symbol, depth + 1);
      };
      walk('', 0);
      expect(compared).toBeGreaterThan(30_000);
    });
  });

  it('맞지 않는 긴 입력도 바로 끝난다', () => {
    const started = Date.now();
    const slow = `a@${'a'.repeat(60)} `;
    const alsoSlow = `a@${'a-'.repeat(30)}a `;
    expect(isValidEmail(slow)).toBe(false);
    expect(isValidEmail(alsoSlow)).toBe(false);
    expect(EMAIL_DOMAIN_PATTERN.test(`${'a'.repeat(250)} `)).toBe(false);
    expect(Date.now() - started).toBeLessThan(500);
  });
});
