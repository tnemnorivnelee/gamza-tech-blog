import { ApiPropertyOptional } from '@nestjs/swagger';

// 소개 목록의 한 줄. 이름은 옛 OpenAPI 스키마 이름 그대로다.
// 값이 없는 프로필 이미지 주소는 키를 빼지 않고 null로 내보낸다(옛 record는 NON_NULL이 아니다).
export class IntroResponse {
  @ApiPropertyOptional({ type: 'integer', format: 'int64' })
  introId!: number;

  @ApiPropertyOptional({ type: 'integer', format: 'int64' })
  userId!: number;

  @ApiPropertyOptional({ type: 'string' })
  nickname!: string;

  @ApiPropertyOptional({ type: 'string' })
  profileImageUrl!: string | null;

  @ApiPropertyOptional({ type: 'string' })
  content!: string;

  @ApiPropertyOptional({ type: 'string', format: 'date-time' })
  createdAt!: string;
}
