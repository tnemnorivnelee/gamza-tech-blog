import { ApiPropertyOptional } from '@nestjs/swagger';

// 좋아요 목록의 한 줄. 이름은 옛 OpenAPI 스키마 이름 그대로다(프론트 생성 클라이언트가 이 이름을 쓴다).
// 옛 명세처럼 필드는 모두 선택으로 적는다. 값이 없는 두 이미지 주소는 키를 빼지 않고 null로 내보낸다(옛 record는 NON_NULL이 아니다).
export class LikeResponse {
  @ApiPropertyOptional({ type: 'integer', format: 'int64' })
  likeId!: number;

  @ApiPropertyOptional({ type: 'integer', format: 'int64' })
  postId!: number;

  @ApiPropertyOptional({ type: 'string' })
  title!: string;

  @ApiPropertyOptional({ type: 'string' })
  contentSnippet!: string;

  // 글 작성자의 닉네임이다(좋아요를 누른 사람이 아니다).
  @ApiPropertyOptional({ type: 'string' })
  writer!: string;

  @ApiPropertyOptional({ type: 'string' })
  writerProfileImageUrl!: string | null;

  @ApiPropertyOptional({ type: 'string' })
  thumbnailImageUrl!: string | null;

  // 좋아요를 누른 시각이다(글을 쓴 시각이 아니다).
  @ApiPropertyOptional({ type: 'string', format: 'date-time' })
  createdAt!: string;

  // 명세는 문자열 배열이다. 태그가 없는 글은 옛 코드의 버그로 [null]이 나가서 타입에 null이 들어 있다(docs/m5-read-api-plan.md 3.9).
  @ApiPropertyOptional({ type: 'array', items: { type: 'string' } })
  tags!: (string | null)[];
}
