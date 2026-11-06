import { ApiPropertyOptional } from '@nestjs/swagger';

// 옛 AccessTokenResponse. reissue가 새 액세스 토큰을 본문에도 담아 준다.
export class AccessTokenResponse {
  @ApiPropertyOptional({ type: 'string' })
  authorization?: string;
}
