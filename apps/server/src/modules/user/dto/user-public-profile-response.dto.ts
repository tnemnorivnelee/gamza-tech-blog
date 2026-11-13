import { ApiExtraModels, ApiPropertyOptional } from '@nestjs/swagger';
import type { PagedResponse } from '../../../common/dto/paged-response.dto.js';
import { pagedSchema } from '../../../common/swagger/api-decorators.js';
import { PostListResponse } from '../../post/dto/post-list-response.dto.js';
import { UserActivityResponse } from './user-activity-response.dto.js';
import { UserMiniProfileResponse } from './user-mini-profile-response.dto.js';

// 상대방의 공개 프로필: 프로필, 활동 개수, 그 사람의 글 목록(한 쪽). 이름은 옛 OpenAPI 스키마 이름 그대로다.
// posts는 홈 피드의 latest와 같이 이름 붙은 스키마(PagedResponsePostListResponse)로 적는다. 프론트 생성 클라이언트가 이 이름으로 타입을 만든다.
const { title, allOf } = pagedSchema(PostListResponse);
const postsSchema = { title, allOf };

@ApiExtraModels(PostListResponse)
export class UserPublicProfileResponse {
  @ApiPropertyOptional({ type: () => UserMiniProfileResponse })
  profile!: UserMiniProfileResponse;

  @ApiPropertyOptional({ type: () => UserActivityResponse })
  activity!: UserActivityResponse;

  @ApiPropertyOptional({ type: Object, ...postsSchema })
  posts!: PagedResponse<PostListResponse>;
}
