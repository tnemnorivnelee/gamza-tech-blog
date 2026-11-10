import { ApiPropertyOptional } from '@nestjs/swagger';

// 글 목록의 한 줄. 이름은 옛 OpenAPI 스키마 이름 그대로다(프론트 생성 클라이언트가 이 이름을 쓴다).
// 옛 명세처럼 필드는 모두 선택으로 적는다. 값이 없는 두 이미지 주소는 키를 빼지 않고 null로 내보낸다(옛 record는 NON_NULL이 아니다).
export class PostListResponse {
  @ApiPropertyOptional({ type: 'integer', format: 'int64' })
  postId!: number;

  @ApiPropertyOptional({ type: 'string' })
  title!: string;

  @ApiPropertyOptional({ type: 'string' })
  contentSnippet!: string;

  // 작성자의 닉네임이다.
  @ApiPropertyOptional({ type: 'string' })
  writer!: string;

  @ApiPropertyOptional({ type: 'string' })
  writerProfileImageUrl!: string | null;

  @ApiPropertyOptional({ type: 'string', format: 'date-time' })
  createdAt!: string;

  @ApiPropertyOptional({ type: 'array', items: { type: 'string' } })
  tags!: string[];

  @ApiPropertyOptional({ type: 'string' })
  thumbnailImageUrl!: string | null;
}
