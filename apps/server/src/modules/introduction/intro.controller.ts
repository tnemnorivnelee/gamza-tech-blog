import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam } from '@nestjs/swagger';
import { ResponseDto } from '../../common/dto/response.dto.js';
import {
  parsePageable,
  parseSort,
  type SortOrder,
} from '../../common/pageable.js';
import { parsePathLong } from '../../common/spring-compat.js';
import {
  ApiPageable,
  OkOf,
  OkPagedOf,
  OkVoid,
} from '../../common/swagger/api-decorators.js';
import { Public } from '../auth/access.decorator.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { User } from '../user/user.repository.js';
import {
  IntroCreateRequest,
  validateIntroCreateRequest,
} from './dto/intro-create-request.dto.js';
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

  // 기본 규칙(로그인 필요, USER·ADMIN)이다. 요청 내용은 서비스에 가기 전에 검사한다(옛 @Valid): 위반하면 400 C001이다.
  // 성공은 HTTP 200이고 본문 status만 201이다.
  @ApiOperation({ summary: '자기소개 작성' })
  @Post()
  @ApiBody({ type: IntroCreateRequest })
  @OkOf(IntroResponse)
  async createIntro(
    @CurrentUser() user: User,
    @Body() body: IntroCreateRequest,
  ) {
    validateIntroCreateRequest(body);
    const created = await this.intros.createIntro(user.githubId, body.content);
    return ResponseDto.of('자기소개 작성 성공', created, 201);
  }

  // 없으면 404 IN002, 쓴 사람이 아니면 403 IN003이다. 소개 번호가 숫자가 아니면 400 C005다.
  @ApiOperation({ summary: '자기소개 삭제' })
  @Delete(':introId')
  @ApiParam({ name: 'introId', type: 'integer', format: 'int64' })
  @OkVoid()
  async deleteIntro(
    @CurrentUser() user: User,
    @Param('introId') introId: string,
  ) {
    await this.intros.deleteIntro(
      user.githubId,
      parsePathLong('introId', introId),
    );
    return ResponseDto.of('자기소개 삭제 성공');
  }
}
