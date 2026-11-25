import { Injectable } from '@nestjs/common';
import { PagedResponse } from '../../common/dto/paged-response.dto.js';
import { BusinessException } from '../../common/error/business.exception.js';
import { ErrorCode } from '../../common/error/error-code.js';
import { toLocalDateTime } from '../../common/local-date-time.js';
import type { PageRequest, SortOrder } from '../../common/pageable.js';
import { ReadCache } from '../../common/read-cache.js';
import type { IntroResponse } from './dto/intro-response.dto.js';
import { type IntroSummary, IntroRepository } from './intro.repository.js';

// 캐시 키의 정렬 조각이다. 옛 Spring Sort.toString()과 같다: "createdAt: DESC", 여러 개는 쉼표만으로 잇는다(공백 없음).
const sortKey = (orders: readonly SortOrder[]) =>
  orders
    .map(({ property, direction }) => `${property}: ${direction.toUpperCase()}`)
    .join(',');

const toIntroResponse = (intro: IntroSummary): IntroResponse => ({
  ...intro,
  createdAt: toLocalDateTime(intro.createdAt),
});

// @Injectable: Nest가 만들어 다른 클래스의 생성자에 넣어 주는 부품이라는 표시다(프론트의 서비스 클래스와 비슷하다).
// 옛 @Cacheable(introsList)을 getIntroList에 건다. 키에 정렬이 들어가고, 옛 코드는 unless가 없어서 빈 쪽도 저장했다.
// 소개를 쓰거나 지우면 introsList 전체를 지운다(옛 @CacheEvict(allEntries = true)).
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

  // 이미 썼으면 409 IN001이다. 요청 내용의 검사(400 C001)는 컨트롤러가 먼저 한다. 성공한 뒤에만 캐시를 지운다.
  async createIntro(githubId: string, content: string): Promise<IntroResponse> {
    const result = await this.intros.createIntro(githubId, content);
    if (result.status === 'ALREADY_EXISTS')
      throw new BusinessException(ErrorCode.INTRO_ALREADY_EXISTS);
    await this.cache.evictAll('introsList');
    return toIntroResponse(result.intro);
  }

  // 없으면 404 IN002, 쓴 사람이 아니면 403 IN003이다.
  async deleteIntro(githubId: string, introId: bigint): Promise<void> {
    const result = await this.intros.deleteIntro(githubId, introId);
    if (result.status === 'NOT_FOUND')
      throw new BusinessException(ErrorCode.INTRO_NOT_FOUND);
    if (result.status === 'FORBIDDEN')
      throw new BusinessException(ErrorCode.INTRO_DELETE_FORBIDDEN);
    await this.cache.evictAll('introsList');
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
      intros.map(toIntroResponse),
      page,
      size,
      totalElements,
      Math.ceil(totalElements / size),
    );
  }
}
