import { ApiProperty } from '@nestjs/swagger';
import { POSITIONS, type Position } from './profile-request.js';

// 프로필 수정 요청(옛 UpdateProfileRequest). 완성 요청과 달리 이메일이 필수다.
export class UpdateProfileRequest {
  @ApiProperty({
    type: 'string',
    description: '이메일',
    example: 'jihun@example.com',
  })
  email: string;

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
