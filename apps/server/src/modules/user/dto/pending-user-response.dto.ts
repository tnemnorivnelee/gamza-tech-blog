import { ApiPropertyOptional } from '@nestjs/swagger';

// 승인 대기 사용자의 한 줄. 이름은 옛 OpenAPI 스키마 이름 그대로다. 값이 없는 칸은 키를 빼지 않고 null로 내보낸다.
export class PendingUserResponse {
  @ApiPropertyOptional({
    type: 'integer',
    format: 'int64',
    description: '유저 ID',
  })
  userId!: number;

  @ApiPropertyOptional({
    type: 'integer',
    format: 'int32',
    description: '감자기수',
  })
  gamjaBatch!: number | null;

  @ApiPropertyOptional({ type: 'string', description: '이름' })
  name!: string;

  @ApiPropertyOptional({ type: 'string', description: '포지션/직책' })
  position!: string | null;
}
