import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { POSITIONS, type Position } from './profile-request.js';

// 프로필 완성 요청(옛 UserProfileRequest). 이름은 옛 OpenAPI 스키마 이름 그대로다.
// 필수 여부와 검사는 profile-request.ts의 readProfileRequest가 한다(이메일은 선택).
// ApiProperty의 enum에는 enumName을 주지 않는다. 주면 공용 스키마($ref)가 되어 프론트 생성기가 만드는 UserProfileRequestPositionEnum과 어긋난다.
export class UserProfileRequest {
  @ApiPropertyOptional({
    type: 'string',
    description: '이메일',
    example: 'jihun@example.com',
  })
  email?: string;

  @ApiProperty({ type: 'string', description: '학번', example: '20231234' })
  studentNumber: string;

  @ApiProperty({
    type: 'integer',
    format: 'int32',
    description: '감자 동아리 기수',
    example: 9,
  })
  gamjaBatch: number;

  @ApiProperty({
    type: 'string',
    enum: POSITIONS,
    description: '포지션/직책',
    example: 'BACKEND',
  })
  position: Position;
}
