import { ApiPropertyOptional } from '@nestjs/swagger';

export class CommentListResponse {
  @ApiPropertyOptional({ type: 'integer', format: 'int64' })
  commentId?: number;

  @ApiPropertyOptional({ type: 'string' })
  content?: string;

  @ApiPropertyOptional({ type: 'string', format: 'date-time' })
  createdAt?: string;

  @ApiPropertyOptional({ type: 'integer', format: 'int64' })
  postId?: number;

  @ApiPropertyOptional({ type: 'string' })
  postTitle?: string;
}
