import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// 클래스 이름이 곧 스키마 이름이다(프론트 모델 이름과 같아야 한다).
// class-validator 규칙(@NotBlank, @Size)은 컨트롤러를 옮길 때 옛 검증 위치를 확인한 뒤 붙인다.
export class CommentRequest {
  @ApiProperty({
    type: 'string',
    description: '댓글 내용',
    example: '글 감사합니다.',
    maxLength: 1000,
  })
  content: string;

  @ApiPropertyOptional({ type: 'integer', format: 'int64' })
  parentCommentId?: number;
}
