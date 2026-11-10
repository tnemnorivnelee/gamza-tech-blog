import { makeContentSnippet, SNIPPET_LENGTH } from './post-snippet.js';

describe('makeContentSnippet', () => {
  describe('마크다운 이미지 제거', () => {
    it('이미지를 지우고 앞뒤 공백을 자른다', () => {
      expect(
        makeContentSnippet('![로고](https://a.test/x.png)\n\n본문입니다'),
      ).toBe('본문입니다');
    });

    it('이미지가 여러 개여도 모두 지운다', () => {
      expect(makeContentSnippet('가![a](1.png)나![b](2.png)다')).toBe('가나다');
    });

    it('대체 텍스트가 비어 있어도 지운다', () => {
      expect(makeContentSnippet('가![](1.png)나')).toBe('가나');
    });

    it('이미지가 아닌 링크는 그대로 둔다', () => {
      expect(makeContentSnippet('[링크](https://a.test) 와 !느낌표')).toBe(
        '[링크](https://a.test) 와 !느낌표',
      );
    });

    // 옛 정규식은 주소에서 첫 ')'까지만 지운다. 주소에 괄호가 있으면 뒷부분이 남는다(옛 동작 그대로).
    it('주소 안에 괄호가 있으면 첫 닫는 괄호까지만 지운다', () => {
      expect(makeContentSnippet('![a](x(1).png) 끝')).toBe('.png) 끝');
    });

    it('대체 텍스트 안에 ]가 있으면 이미지로 보지 않는다', () => {
      expect(makeContentSnippet('![a]b](1.png)')).toBe('![a]b](1.png)');
    });
  });

  describe('공백 자르기(Java trim)', () => {
    it('U+0020 이하(공백, 탭, 줄바꿈)를 앞뒤에서 지운다', () => {
      expect(makeContentSnippet(' \n\t본문\r\n ')).toBe('본문');
    });

    it('전각 공백(U+3000)과 NBSP는 지우지 않는다(JS trim과 다르다)', () => {
      expect(makeContentSnippet('　본문 ')).toBe('　본문 ');
    });

    it('가운데의 줄바꿈은 그대로 둔다', () => {
      expect(makeContentSnippet('첫 줄\n\n둘째 줄')).toBe('첫 줄\n\n둘째 줄');
    });
  });

  describe('길이 제한', () => {
    it(`${SNIPPET_LENGTH}글자 이하면 그대로다`, () => {
      const exact = '가'.repeat(SNIPPET_LENGTH);
      expect(makeContentSnippet(exact)).toBe(exact);
    });

    it(`${SNIPPET_LENGTH}글자를 넘으면 앞 ${SNIPPET_LENGTH}글자에 ...를 붙인다`, () => {
      const result = makeContentSnippet('가'.repeat(SNIPPET_LENGTH + 1));
      expect(result).toBe(`${'가'.repeat(SNIPPET_LENGTH)}...`);
    });

    // 길이는 이미지를 지우고 공백을 자른 뒤에 잰다.
    it('이미지와 앞뒤 공백을 뺀 길이로 잰다', () => {
      const body = '나'.repeat(SNIPPET_LENGTH);
      expect(makeContentSnippet(`![a](${'x'.repeat(500)})  ${body}  \n`)).toBe(
        body,
      );
    });

    // Java의 length()/substring()과 JS의 length/slice()는 모두 UTF-16 단위로 센다. 이모지(2단위)가 반으로 잘리는 것도 같다.
    it('UTF-16 단위로 센다(이모지는 2글자)', () => {
      const result = makeContentSnippet('😀'.repeat(SNIPPET_LENGTH));
      expect(result).toBe(`${'😀'.repeat(SNIPPET_LENGTH / 2)}...`);
    });

    it('빈 본문은 빈 문자열이다', () => {
      expect(makeContentSnippet('')).toBe('');
      expect(makeContentSnippet('![a](1.png)')).toBe('');
    });
  });
});
