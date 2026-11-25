import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// 클래스 이름이 곧 스키마 이름이다(프론트 모델 이름과 같아야 한다).
// 옛 컨트롤러에 @Valid가 없어서 @NotBlank·@Size(max = 1000)는 실제로 검사되지 않았다. 여기서도 검사하지 않고 명세에만 적는다.
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
