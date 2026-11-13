import { ApiPropertyOptional } from '@nestjs/swagger';

export class CommentResponse {
  @ApiPropertyOptional({ type: 'integer', format: 'int64' })
  commentId?: number;

  @ApiPropertyOptional({ type: 'string' })
  writer?: string;

  // 프로필 이미지가 없으면 키를 빼지 않고 null로 내보낸다(옛 record는 NON_NULL이 아니다).
  @ApiPropertyOptional({ type: 'string' })
  writerProfileImageUrl?: string | null;

  @ApiPropertyOptional({ type: 'string' })
  content?: string;

  @ApiPropertyOptional({ type: 'string', format: 'date-time' })
  createdAt?: string;

  @ApiPropertyOptional({ type: () => [CommentResponse] })
  replies?: CommentResponse[];
}
