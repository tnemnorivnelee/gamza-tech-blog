import { firstQueryValue, parseJavaInt } from './spring-compat.js';

// 쿼리의 page, size를 해석한 결과다. page는 0부터 센다.
// sort는 담지 않는다: 글 목록 계열은 요청의 sort를 무시하고 항상 createdAt 내림차순이다(옛 동작).
// sort를 반영하는 목록(소개, 내 댓글: M5-3, M5-4)을 옮길 때 여기에 더한다.
export interface PageRequest {
  readonly page: number;
  readonly size: number;
}

// Spring Data의 최대 페이지 크기 기본값.
const MAX_PAGE_SIZE = 2000;

// Spring Data의 PageableHandlerMethodArgumentResolver 규칙이다. 어떤 값도 오류가 되지 않고 기본값으로 고쳐진다.
// - page: 비었거나 숫자가 아니거나 음수면 0.
// - size: 비었거나 숫자가 아니거나 1 미만이면 defaultSize, 2000을 넘으면 2000.
// defaultSize는 컨트롤러마다 다르다(@PageableDefault가 있으면 10, 없으면 20).
// 비었을 때와 숫자가 아닐 때의 결과가 같아서(page 0, size 기본값) 둘을 나누지 않는다.
export function parsePageable(
  query: Record<string, unknown>,
  defaultSize: number,
): PageRequest {
  const page = parseJavaInt(firstQueryValue(query.page) ?? '') ?? 0;
  const size = parseJavaInt(firstQueryValue(query.size) ?? '') ?? 0;
  return {
    page: Math.max(page, 0),
    size: size < 1 ? defaultSize : Math.min(size, MAX_PAGE_SIZE),
  };
}
