import { ApiPropertyOptional } from '@nestjs/swagger';

// 프로필 이미지 응답. 이름은 옛 OpenAPI 스키마 이름 그대로다(옛 record ProfileImageResponse(Long id, String imageUrl)).
export class ProfileImageResponse {
  @ApiPropertyOptional({ type: 'integer', format: 'int64' })
  id!: number;

  @ApiPropertyOptional({ type: 'string' })
  imageUrl!: string;
}
