import { Injectable } from '@nestjs/common';
import { BusinessException } from '../../common/error/business.exception.js';
import { ErrorCode } from '../../common/error/error-code.js';
import { toLocalDateTimeSeconds } from '../../common/local-date-time.js';
import type { PageRequest } from '../../common/pageable.js';
import { PostService } from '../post/post.service.js';
import type { PendingUserResponse } from './dto/pending-user-response.dto.js';
import type { UserActivityResponse } from './dto/user-activity-response.dto.js';
import type { UserProfileResponse } from './dto/user-profile-response.dto.js';
import type { UserPublicProfileResponse } from './dto/user-public-profile-response.dto.js';
import { UserQueryRepository } from './user-query.repository.js';

// @Injectable: Nest가 만들어 다른 클래스의 생성자에 넣어 주는 부품이라는 표시다(프론트의 서비스 클래스와 비슷하다).
// 공개 프로필의 글 목록은 글 모듈의 PostService가 만든다(옛 UserServiceImpl이 글 모듈의 조회 포트 postQueryPort를 쓴 것과 같다).
@Injectable()
export class UserService {
  constructor(
    private readonly users: UserQueryRepository,
    private readonly posts: PostService,
  ) {}

  // 옛 코드는 토큰의 사용자를 DB에서 다시 읽는다. 그 사이 사라졌다면 404 U001이다.
  async getCurrentUserProfile(githubId: string): Promise<UserProfileResponse> {
    const profile = await this.users.findProfileByGithubId(githubId);
    if (!profile) throw new BusinessException(ErrorCode.USER_NOT_FOUND);
    return {
      ...profile,
      createdAt: toLocalDateTimeSeconds(profile.createdAt),
      updatedAt: toLocalDateTimeSeconds(profile.updatedAt),
    };
  }

  getActivitySummary(githubId: string): Promise<UserActivityResponse> {
    return this.users.countActivity(githubId);
  }

  // 닉네임이 없으면 404 U001이다. 글 목록은 getMyPosts와 같은 조회다(createdAt 내림차순 고정, 요청의 sort는 무시).
  async getPublicProfileByNickname(
    nickname: string,
    page: PageRequest,
  ): Promise<UserPublicProfileResponse> {
    const target = await this.users.findPublicProfileByNickname(nickname);
    if (!target) throw new BusinessException(ErrorCode.USER_NOT_FOUND);
    // 옛 코드는 활동 개수와 글 목록을 차례로 읽었다. 서로 기다릴 이유가 없어서 함께 보낸다.
    const [activity, posts] = await Promise.all([
      this.users.countActivity(target.githubId),
      this.posts.getMyPosts(target.githubId, page),
    ]);
    return {
      profile: {
        profileImageUrl: target.profileImageUrl,
        nickname: target.nickname,
        gamjaBatch: target.gamjaBatch,
      },
      activity,
      posts,
    };
  }

  getPendingUsers(): Promise<PendingUserResponse[]> {
    return this.users.findPendingUsers();
  }
}
