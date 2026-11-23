import { firstQueryValue, javaTrim, parseJavaInt } from './spring-compat.js';

// 쿼리의 page, size를 해석한 결과다. page는 0부터 센다.
// sort는 담지 않는다: 글 목록 계열은 요청의 sort를 무시하고 항상 createdAt 내림차순이다(옛 동작).
// sort를 반영하는 목록(소개, 내 댓글)은 아래 parseSort로 따로 읽는다.
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

// 요청의 sort 한 항목이다. property는 요청에 적힌 그대로(옛 엔티티의 필드 이름)이고, 어떤 이름을 받을지는 목록마다 다르다(저장소가 정한다).
export interface SortOrder {
  readonly property: string;
  readonly direction: 'asc' | 'desc';
}

// Spring Data의 sort 규칙 중 흔한 부분이다. sort=속성,방향 형태이고 여러 번 올 수 있다.
// - 쉼표로 쪼갠 마지막 조각이 asc나 desc(대소문자 무시)이면 방향이고, 아니면 asc다. 나머지 조각이 모두 속성이다(sort=a,b,desc는 둘 다 내림차순).
//   조각은 다듬지 않는다(sort=createdAt, desc의 " desc"는 방향이 아니라 속성이 된다). 빈 속성은 건너뛴다.
// - 하나도 안 남으면(sort가 없거나 비었으면) defaultSort다. 요청의 sort는 기본 정렬에 더해지지 않고 통째로 바꾼다.
// shortcut: 끝 조각 ignorecase(sort=content,asc,ignorecase), 점만 있는 조각 걸러내기, 값을 한 번 더 URL 디코딩하는 Spring의 동작은 옮기지 않는다. ignorecase는 속성 이름이 되어 저장소의 허용 목록에서 걸러진다.
// 쓰는 곳이 생기면 더한다(옛 서버의 Spring Data Commons 3.4.0 소스로 확인함: SortHandlerMethodArgumentResolver, 기본 정렬은 PageableHandlerMethodArgumentResolver가 고른다).
// sort[]=a는 Spring도 Express 5도 sort로 읽지 않는다(둘 다 기본 정렬).
export function parseSort(
  query: Record<string, unknown>,
  defaultSort: readonly SortOrder[],
): readonly SortOrder[] {
  const parts: unknown[] = Array.isArray(query.sort)
    ? query.sort
    : [query.sort];
  const orders: SortOrder[] = [];
  for (const part of parts) {
    if (typeof part !== 'string') continue;
    // Java의 split은 끝의 빈 조각을 버린다.
    const elements = part.split(',');
    while (elements.at(-1) === '') elements.pop();
    const last = elements.at(-1);
    const hasDirection = last !== undefined && /^(asc|desc)$/i.test(last);
    const direction = hasDirection
      ? (last.toLowerCase() as 'asc' | 'desc')
      : 'asc';
    for (const property of hasDirection ? elements.slice(0, -1) : elements) {
      if (javaTrim(property) !== '') orders.push({ property, direction });
    }
  }
  return orders.length > 0 ? orders : defaultSort;
}
