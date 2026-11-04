import { ApiPropertyOptional } from '@nestjs/swagger';

// 프론트가 쿼리 파라미터 타입으로 직접 import하는 스키마(옛 springdoc의 Pageable).
export class Pageable {
  @ApiPropertyOptional({ type: 'integer', format: 'int32', minimum: 0 })
  page?: number;

  @ApiPropertyOptional({ type: 'integer', format: 'int32', minimum: 1 })
  size?: number;

  @ApiPropertyOptional({ type: 'array', items: { type: 'string' } })
  sort?: string[];
}
