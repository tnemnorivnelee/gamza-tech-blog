import { ApiPropertyOptional } from '@nestjs/swagger';

// 옛 PagedResponse<T>. page는 0부터 센다.
// 명세에서는 이 클래스가 공통 스키마(page, size, totalElements, totalPages)가 되고,
// content의 항목 타입은 ResponseDto처럼 각 응답의 @OkPagedOf 데코레이터가 적는다.
export class PagedResponse<T> {
  readonly content: T[];

  @ApiPropertyOptional({ type: 'integer', format: 'int32' })
  readonly page: number;

  @ApiPropertyOptional({ type: 'integer', format: 'int32' })
  readonly size: number;

  @ApiPropertyOptional({ type: 'integer', format: 'int64' })
  readonly totalElements: number;

  @ApiPropertyOptional({ type: 'integer', format: 'int32' })
  readonly totalPages: number;

  constructor(
    content: T[],
    page: number,
    size: number,
    totalElements: number,
    totalPages: number,
  ) {
    this.content = content;
    this.page = page;
    this.size = size;
    this.totalElements = totalElements;
    this.totalPages = totalPages;
  }
}
