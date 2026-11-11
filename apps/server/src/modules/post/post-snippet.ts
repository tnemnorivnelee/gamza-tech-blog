import { javaTrim } from '../../common/spring-compat.js';

// 글 목록·좋아요 목록은 본문을 이 길이까지만 보여 준다(옛 PostUtil.makeSnippet(markdown, 100)).
export const SNIPPET_LENGTH = 100;

// 본문에서 목록용 요약을 만든다. 옛 PostUtil.stripAllImages와 makeSnippet을 합친 것이다:
//   1) 마크다운 이미지 ![대체 텍스트](주소)를 모두 지운다. 옛 정규식은 !\[[^\]]*\]\([^\)]*\) 이다.
//   2) 앞뒤 공백을 자른다. 옛 Java의 trim()이라서 javaTrim을 쓴다(JS의 trim()과 다르다).
//   3) 길이가 SNIPPET_LENGTH 이하면 그대로, 넘으면 앞 SNIPPET_LENGTH글자에 '...'를 붙인다.
export function makeContentSnippet(content: string): string {
  const text = javaTrim(content.replace(/!\[[^\]]*\]\([^)]*\)/g, ''));
  return text.length <= SNIPPET_LENGTH
    ? text
    : `${text.slice(0, SNIPPET_LENGTH)}...`;
}
