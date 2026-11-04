import { ApiPropertyOptional } from '@nestjs/swagger';

export class CommentResponse {
  @ApiPropertyOptional({ type: 'integer', format: 'int64' })
  commentId?: number;

  @ApiPropertyOptional({ type: 'string' })
  writer?: string;

  @ApiPropertyOptional({ type: 'string' })
  writerProfileImageUrl?: string;

  @ApiPropertyOptional({ type: 'string' })
  content?: string;

  @ApiPropertyOptional({ type: 'string', format: 'date-time' })
  createdAt?: string;

  @ApiPropertyOptional({ type: () => [CommentResponse] })
  replies?: CommentResponse[];
}
