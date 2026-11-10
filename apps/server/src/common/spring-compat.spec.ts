import { firstQueryValue, javaTrim, parseJavaInt } from './spring-compat.js';

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
