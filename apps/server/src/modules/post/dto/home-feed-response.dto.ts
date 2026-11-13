import { ApiExtraModels, ApiPropertyOptional } from '@nestjs/swagger';
import type { PagedResponse } from '../../../common/dto/paged-response.dto.js';
import { pagedSchema } from '../../../common/swagger/api-decorators.js';
import { PostListResponse } from './post-list-response.dto.js';
import { PostPopularResponse } from './post-popular-response.dto.js';

// 홈 피드: 이번 주 인기 글, 최신 글 목록(한 쪽), 전체 태그. 이름은 옛 OpenAPI 스키마 이름 그대로다.
// latest는 PagedResponse 클래스를 그대로 가리키지 않고 @OkPagedOf와 같은 모양의 이름 붙은 스키마(PagedResponsePostListResponse)로 적는다.
// 프론트 생성 클라이언트가 이 이름으로 타입을 만든다.
const { title, allOf } = pagedSchema(PostListResponse);
const latestSchema = { title, allOf };

@ApiExtraModels(PostListResponse)
export class HomeFeedResponse {
  @ApiPropertyOptional({ type: () => [PostPopularResponse] })
  weeklyPopular!: PostPopularResponse[];

  @ApiPropertyOptional({ type: Object, ...latestSchema })
  latest!: PagedResponse<PostListResponse>;

  @ApiPropertyOptional({ type: 'array', items: { type: 'string' } })
  allTags!: string[];
}
