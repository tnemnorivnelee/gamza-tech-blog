import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { ResponseDto } from '../../common/dto/response.dto.js';
import {
  parsePageable,
  parseSort,
  type SortOrder,
} from '../../common/pageable.js';
import { ApiPageable, OkPagedOf } from '../../common/swagger/api-decorators.js';
import { Public } from '../auth/access.decorator.js';
import { IntroResponse } from './dto/intro-response.dto.js';
import { IntroService } from './intro.service.js';

// 옛 @PageableDefault(sort = "createdAt", direction = DESC)의 기본 크기와 기본 정렬이다.
const DEFAULT_PAGE_SIZE = 10;
const DEFAULT_SORT: SortOrder[] = [
  { property: 'createdAt', direction: 'desc' },
];

// @Controller: 이 클래스의 메서드들이 /api/v1/intros 아래 라우트가 된다. 요청의 쿼리는 @Query()로 통째로 받아 직접 해석한다
// (이름으로 받으면 Swagger가 파라미터를 자동으로 더해서 프론트 계약의 pageable과 어긋난다).
@Controller('api/v1/intros')
export class IntroController {
  constructor(private readonly intros: IntroService) {}

  // 소개 목록은 글 목록과 달리 요청의 sort를 반영한다(옛 동작). 해석 규칙은 common/pageable.ts에 있다.
  @ApiOperation({ summary: '자기소개 목록 조회' })
  @Public()
  @Get()
  @ApiPageable(DEFAULT_PAGE_SIZE)
  @OkPagedOf(IntroResponse)
  async getIntroList(@Query() query: Record<string, unknown>) {
    const paged = await this.intros.getIntroList(
      parsePageable(query, DEFAULT_PAGE_SIZE),
      parseSort(query, DEFAULT_SORT),
    );
    return ResponseDto.of('자기소개 목록 조회 성공', paged);
  }
}
