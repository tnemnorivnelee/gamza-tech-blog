import { ApiPropertyOptional } from '@nestjs/swagger';

// 활동 개수. 이름은 옛 OpenAPI 스키마 이름 그대로다. 개수는 행 수다(좋아요 행, 글, 댓글. 대댓글도 댓글로 센다).
export class UserActivityResponse {
  @ApiPropertyOptional({
    type: 'integer',
    format: 'int32',
    description: '좋아요 한 게시물 수',
  })
  likedPostCount!: number;

  @ApiPropertyOptional({
    type: 'integer',
    format: 'int32',
    description: '작성한 게시물 수',
  })
  writtenPostCount!: number;

  @ApiPropertyOptional({
    type: 'integer',
    format: 'int32',
    description: '작성한 댓글 수',
  })
  writtenCommentCount!: number;
}
