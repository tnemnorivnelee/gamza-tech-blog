import {
  firstQueryValue,
  javaTrim,
  parseJavaInt,
  parseSpringLong,
} from './spring-compat.js';

describe('javaTrim', () => {
  it('U+0020 이하(공백, 탭, 줄바꿈, 제어 문자)를 앞뒤에서 지운다', () => {
    expect(javaTrim(' \t\n\r\u0000가나다\u001f  ')).toBe('가나다');
  });

  it('가운데는 건드리지 않는다', () => {
    expect(javaTrim('  a  b  ')).toBe('a  b');
  });

  // JS의 trim()과 다른 곳이다. 전각 공백, NBSP, BOM은 자바 trim이 남긴다.
  it.each(['　', ' ', '﻿'])(
    '%j(JS trim은 지우지만 Java trim은 남기는 문자)는 지우지 않는다',
    (ch) => {
      expect(javaTrim(`${ch}가${ch}`)).toBe(`${ch}가${ch}`);
      expect(`${ch}가${ch}`.trim()).toBe('가');
    },
  );

  it('공백뿐이면 빈 문자열이다', () => {
    expect(javaTrim('   \n')).toBe('');
  });
});

describe('firstQueryValue', () => {
  it('문자열은 그대로 돌려준다', () => {
    expect(firstQueryValue('3')).toBe('3');
    expect(firstQueryValue('')).toBe('');
  });

  it('같은 이름이 여러 번 오면 첫 값만 쓴다(Spring의 getParameter)', () => {
    expect(firstQueryValue(['1', '2'])).toBe('1');
  });

  it.each([undefined, null, 5, {}, { a: 'b' }, [], [{ a: 'b' }]])(
    '문자열이 아니면(%j) undefined다',
    (value) => {
      expect(firstQueryValue(value)).toBeUndefined();
    },
  );
});

describe('parseJavaInt', () => {
  it.each([
    ['0', 0],
    ['7', 7],
    ['007', 7],
    ['+5', 5],
    ['-5', -5],
    ['2147483647', 2147483647],
    ['-2147483648', -2147483648],
  ])('%j는 %i다', (text, expected) => {
    expect(parseJavaInt(text)).toBe(expected);
  });

  // Number()였다면 받았을 값들이다. Integer.parseInt는 모두 NumberFormatException이다.
  it.each([
    '',
    ' ',
    ' 1',
    '1 ',
    '1.5',
    '1e3',
    '0x10',
    '--1',
    '+',
    '１２',
    'abc',
    '2147483648',
    '-2147483649',
    '99999999999999999999',
  ])('%j는 숫자가 아니다', (text) => {
    expect(parseJavaInt(text)).toBeUndefined();
  });
});

describe('parseSpringLong', () => {
  const char = (code: number) => String.fromCodePoint(code);
  const MAX = 2n ** 63n - 1n;
  const MIN = -(2n ** 63n);

  it.each([
    ['1', 1n],
    ['007', 7n],
    ['+5', 5n],
    ['-5', -5n],
    ['0', 0n],
    [String(MAX), MAX],
    [String(MIN), MIN],
    // Number()라면 2^53+1이 2^53으로 뭉개진다. bigint라서 그대로다.
    ['9007199254740993', 9007199254740993n],
  ])('십진수 %j는 %s다', (text, expected) => {
    expect(parseSpringLong(text)).toBe(expected);
  });

  // NumberUtils.parseNumber는 0x, 0X, #로 시작하면 Long.decode로 읽는다(앞에 -는 가능, +는 불가).
  it.each([
    ['0x10', 16n],
    ['0X1f', 31n],
    ['#10', 16n],
    ['-0x10', -16n],
    ['-#10', -16n],
    ['0x7fffffffffffffff', MAX],
    ['-0x8000000000000000', MIN],
  ])('16진수 %j는 %s다', (text, expected) => {
    expect(parseSpringLong(text)).toBe(expected);
  });

  // StringUtils.trimAllWhitespace: 앞뒤뿐 아니라 가운데 공백도 모두 지운다. 기준은 Java의 Character.isWhitespace다.
  it.each([
    [' 1 ', 1n],
    ['1 2', 12n],
    ['\t7\n', 7n],
    [`${char(0x3000)}7`, 7n], // 전각 공백
    [`7${char(0x2003)}`, 7n], // em space
    [`${char(0x1c)}7`, 7n], // 구분 제어 문자도 공백이다
    [' - 5', -5n],
  ])('공백은 모두 지우고 읽는다(%j → %s)', (text, expected) => {
    expect(parseSpringLong(text)).toBe(expected);
  });

  // 줄바꿈 없는 공백(NBSP 등)은 Java에서 공백이 아니라서 지워지지 않고 숫자가 아니게 된다. JS의 \s와 다른 곳이다.
  it.each([
    ['NBSP', 0xa0],
    ['figure space', 0x2007],
    ['narrow NBSP', 0x202f],
    ['BOM', 0xfeff],
  ])('%s가 끼면 숫자가 아니다', (_name, code) => {
    expect(parseSpringLong(`${char(code)}7`)).toBeUndefined();
  });

  it.each([
    '',
    ' ',
    'abc',
    '1.5',
    '1e3',
    '--1',
    '+',
    '-',
    '0x',
    '#',
    '+0x10', // 16진수의 + 부호는 Long.valueOf가 받지 못한다
    '0x-1',
    '0x1g',
    '１２',
    String(MAX + 1n),
    String(MIN - 1n),
    '0x8000000000000000',
    '-0x8000000000000001',
    '99999999999999999999',
  ])('%j는 숫자가 아니거나 int64 범위 밖이다', (text) => {
    expect(parseSpringLong(text)).toBeUndefined();
  });
});
