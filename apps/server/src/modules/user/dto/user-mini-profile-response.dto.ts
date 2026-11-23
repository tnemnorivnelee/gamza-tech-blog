import { ApiPropertyOptional } from '@nestjs/swagger';

// 공개 프로필의 윗부분. 이름은 옛 OpenAPI 스키마 이름 그대로다. 값이 없는 칸은 키를 빼지 않고 null로 내보낸다.
export class UserMiniProfileResponse {
  @ApiPropertyOptional({ type: 'string' })
  profileImageUrl!: string | null;

  @ApiPropertyOptional({ type: 'string' })
  nickname!: string;

  @ApiPropertyOptional({ type: 'integer', format: 'int32' })
  gamjaBatch!: number | null;
}
