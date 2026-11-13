import { Injectable } from '@nestjs/common';
import { PagedResponse } from '../../common/dto/paged-response.dto.js';
import { toLocalDateTime } from '../../common/local-date-time.js';
import type { PageRequest, SortOrder } from '../../common/pageable.js';
import type { IntroResponse } from './dto/intro-response.dto.js';
import { IntroRepository } from './intro.repository.js';

// @Injectable: Nest가 만들어 다른 클래스의 생성자에 넣어 주는 부품이라는 표시다(프론트의 서비스 클래스와 비슷하다).
@Injectable()
export class IntroService {
  constructor(private readonly intros: IntroRepository) {}

  // page와 size는 요청에서 고친 값을 그대로 돌려준다. 총 쪽수는 Spring의 Page.getTotalPages()와 같다.
  async getIntroList(
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
