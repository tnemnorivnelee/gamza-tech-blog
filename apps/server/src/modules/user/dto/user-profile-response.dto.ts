import { ApiPropertyOptional } from '@nestjs/swagger';

// 내 프로필. 이름은 옛 OpenAPI 스키마 이름 그대로다. 값이 없는 칸은 키를 빼지 않고 null로 내보낸다(옛 record는 NON_NULL이 아니다).
// 날짜는 Date가 아니라 문자열 필드이고 초까지만 쓴다(yyyy-MM-dd'T'HH:mm:ss, toLocalDateTimeSeconds).
export class UserProfileResponse {
  @ApiPropertyOptional({ type: 'string', description: 'Github 아이디' })
  githubId!: string;

  @ApiPropertyOptional({ type: 'string', description: '닉네임' })
  nickname!: string;

  @ApiPropertyOptional({ type: 'string', description: '이름' })
  name!: string;

  @ApiPropertyOptional({ type: 'string', description: '이메일' })
  email!: string | null;

  @ApiPropertyOptional({ type: 'string', description: '프로필 이미지 URL' })
  profileImageUrl!: string | null;

  @ApiPropertyOptional({ type: 'string', description: '직책/포지션' })
  position!: string | null;

  @ApiPropertyOptional({ type: 'string', description: '유저 역할' })
  role!: string;

  @ApiPropertyOptional({ type: 'string', description: '학번' })
  studentNumber!: string | null;

  @ApiPropertyOptional({
    type: 'integer',
    format: 'int32',
    description: '감자 동아리 기수',
  })
  gamjaBatch!: number | null;

  @ApiPropertyOptional({ type: 'string', description: '생성 일시' })
  createdAt!: string;

  @ApiPropertyOptional({ type: 'string', description: '수정 일시' })
  updatedAt!: string;
}
