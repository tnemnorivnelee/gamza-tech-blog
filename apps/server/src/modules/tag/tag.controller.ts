import { Controller, Get } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { ResponseDto } from '../../common/dto/response.dto.js';
import { OkListOf } from '../../common/swagger/api-decorators.js';
import { Public } from '../auth/access.decorator.js';
import { TagService } from './tag.service.js';

// @Controller: 이 클래스의 메서드들이 /api/v1/tags 아래 라우트가 된다. 생성자의 TagService는 Nest가 찾아 넣어 준다(주입).
@Controller('api/v1/tags')
export class TagController {
  constructor(private readonly tags: TagService) {}

  // @Public: 가드가 토큰을 검사하지 않는다(옛 JwtSkipPathMatcher의 공개 경로).
  @ApiOperation({ summary: '전체 태그 조회' })
  @Public()
  @Get()
  @OkListOf(String)
  async getAllTags() {
    return ResponseDto.of('태그 목록 조회 성공', await this.tags.getAllTags());
  }
}
