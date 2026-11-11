import { ApiPropertyOptional } from '@nestjs/swagger';

// 주간 인기 글의 한 줄. 이름은 옛 OpenAPI 스키마 이름 그대로다.
// 값이 없는 프로필 이미지 주소는 키를 빼지 않고 null로 내보낸다(옛 record는 NON_NULL이 아니다).
export class PostPopularResponse {
  @ApiPropertyOptional({ type: 'integer', format: 'int64' })
  postId!: number;

  @ApiPropertyOptional({ type: 'string' })
  title!: string;

  // 작성자의 닉네임이다.
  @ApiPropertyOptional({ type: 'string' })
  writer!: string;

  @ApiPropertyOptional({ type: 'string' })
  writerProfileImageUrl!: string | null;
}
