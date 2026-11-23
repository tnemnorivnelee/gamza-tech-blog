import { Injectable } from '@nestjs/common';
import { PagedResponse } from '../../common/dto/paged-response.dto.js';
import { toLocalDateTime } from '../../common/local-date-time.js';
import type { PageRequest, SortOrder } from '../../common/pageable.js';
import { ReadCache } from '../../common/read-cache.js';
import type { IntroResponse } from './dto/intro-response.dto.js';
import { IntroRepository } from './intro.repository.js';

// 캐시 키의 정렬 조각이다. 옛 Spring Sort.toString()과 같다: "createdAt: DESC", 여러 개는 쉼표만으로 잇는다(공백 없음).
const sortKey = (orders: readonly SortOrder[]) =>
  orders
    .map(({ property, direction }) => `${property}: ${direction.toUpperCase()}`)
    .join(',');

// @Injectable: Nest가 만들어 다른 클래스의 생성자에 넣어 주는 부품이라는 표시다(프론트의 서비스 클래스와 비슷하다).
// 옛 @Cacheable(introsList)을 getIntroList에 건다. 키에 정렬이 들어가고, 옛 코드는 unless가 없어서 빈 쪽도 저장했다.
@Injectable()
export class IntroService {
  constructor(
    private readonly intros: IntroRepository,
    private readonly cache: ReadCache,
  ) {}

  // page와 size는 요청에서 고친 값을 그대로 돌려준다. 총 쪽수는 Spring의 Page.getTotalPages()와 같다.
  getIntroList(
    page: PageRequest,
    orders: readonly SortOrder[],
  ): Promise<PagedResponse<IntroResponse>> {
    return this.cache.cached(
      'introsList',
      `p:${page.page}:s:${page.size}:sort:${sortKey(orders)}`,
      () => this.loadIntroList(page, orders),
    );
  }

  private async loadIntroList(
    { page, size }: PageRequest,
    orders: readonly SortOrder[],
  ): Promise<PagedResponse<IntroResponse>> {
    const { intros, totalElements } = await this.intros.findIntroPage(
      { page, size },
      orders,
    );
    return new PagedResponse(
      intros.map((intro) => ({
        ...intro,
        createdAt: toLocalDateTime(intro.createdAt),
      })),
      page,
      size,
      totalElements,
      Math.ceil(totalElements / size),
    );
  }
}
