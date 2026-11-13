import { ApiPropertyOptional } from '@nestjs/swagger';
import { CommentResponse } from '../../comment/dto/comment-response.dto.js';

// 글 상세. 이름은 옛 OpenAPI 스키마 이름 그대로다. 값이 없는 프로필 이미지 주소는 null로 내보낸다.
export class PostDetailResponse {
  @ApiPropertyOptional({ type: 'integer', format: 'int64' })
  postId!: number;

  @ApiPropertyOptional({ type: 'string' })
  title!: string;

  @ApiPropertyOptional({ type: 'string' })
  content!: string;

  // 작성자의 닉네임이다.
  @ApiPropertyOptional({ type: 'string' })
  writer!: string;

  @ApiPropertyOptional({ type: 'string' })
  writerProfileImageUrl!: string | null;

  @ApiPropertyOptional({ type: 'integer', format: 'int32' })
  likesCount!: number;

  // 작성자의 GitHub 아이디다.
  @ApiPropertyOptional({ type: 'string' })
  githubId!: string;

  @ApiPropertyOptional({ type: 'string', format: 'date-time' })
  createdAt!: string;

  @ApiPropertyOptional({ type: 'string', format: 'date-time' })
  updatedAt!: string;

  @ApiPropertyOptional({ type: 'array', items: { type: 'string' } })
  tags!: string[];

  @ApiPropertyOptional({ type: () => [CommentResponse] })
  comments!: CommentResponse[];
}
