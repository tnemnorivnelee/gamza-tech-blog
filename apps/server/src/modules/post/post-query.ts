import { BusinessException } from '../../common/error/business.exception.js';
import { ErrorCode } from '../../common/error/error-code.js';
import { firstQueryValue, javaTrim } from '../../common/spring-compat.js';

// tags 쿼리를 문자열 목록으로 바꾼다(옛 Spring의 List<String> 변환).
// - 값이 하나면 쉼표로 쪼개고 조각마다 앞뒤 공백을 자른다: tags=a,b → [a, b]. 빈 문자열은 빈 목록이다.
// - 값이 여러 개면 있는 그대로 쓴다(쪼개지 않는다): tags=a&tags=b → [a, b], tags=a,b&tags=c → ["a,b", c].
// 빈 목록은 "필터 없음"이다(옛 코드의 filterTags.isEmpty()).
export function parseTags(value: unknown): string[] {
  // Express는 같은 이름이 여러 번 올 때(tags[]=a 형태도) 배열로 준다. Spring은 값이 하나면 문자열, 여럿이면 배열로 다룬다.
  const single = Array.isArray(value) && value.length === 1 ? value[0] : value;
  if (Array.isArray(single))
    return single.filter((tag): tag is string => typeof tag === 'string');
  if (typeof single !== 'string' || single === '') return [];
  return single.split(',').map(javaTrim);
}

// 검색어를 꺼낸다. 없거나 공백뿐이면 500 C004다.
// 옛 예외 처리기는 검증 실패(@NotBlank)와 파라미터 누락 둘 다 따로 다루지 않아서 마지막 처리기가 500으로 보냈다(개선 후보 22번).
// 값은 다듬지 않고 그대로 검색에 쓴다(옛 코드가 그랬다).
export function readKeyword(query: Record<string, unknown>): string {
  const keyword = firstQueryValue(query.keyword);
  if (keyword === undefined || javaTrim(keyword) === '')
    throw new BusinessException(ErrorCode.INTERNAL_SERVER_ERROR);
  return keyword;
}
