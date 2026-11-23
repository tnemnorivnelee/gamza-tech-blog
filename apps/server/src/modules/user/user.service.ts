import { Injectable } from '@nestjs/common';
import { BusinessException } from '../../common/error/business.exception.js';
import { ErrorCode } from '../../common/error/error-code.js';
import { toLocalDateTimeSeconds } from '../../common/local-date-time.js';
import type { PageRequest } from '../../common/pageable.js';
import { ReadCache } from '../../common/read-cache.js';
import { PostService } from '../post/post.service.js';
import type { PendingUserResponse } from './dto/pending-user-response.dto.js';
import type { UserActivityResponse } from './dto/user-activity-response.dto.js';
import type { UserProfileResponse } from './dto/user-profile-response.dto.js';
import type { UserPublicProfileResponse } from './dto/user-public-profile-response.dto.js';
import { UserQueryRepository } from './user-query.repository.js';

// @Injectable: Nest가 만들어 다른 클래스의 생성자에 넣어 주는 부품이라는 표시다(프론트의 서비스 클래스와 비슷하다).
// 공개 프로필의 글 목록은 글 모듈의 PostService가 만든다(옛 UserServiceImpl이 글 모듈의 조회 포트 postQueryPort를 쓴 것과 같다).
// 옛 @Cacheable은 getCurrentUserProfile(userProfile)과 getPublicProfileByNickname(publicProfileAggregate)에 있었다.
@Injectable()
export class UserService {
  constructor(
    private readonly users: UserQueryRepository,
    private readonly posts: PostService,
    private readonly cache: ReadCache,
  ) {}

  // 키는 옛 코드처럼 githubId다. 옛 코드는 예외(404)를 저장하지 않았고 여기도 같다.
  getCurrentUserProfile(githubId: string): Promise<UserProfileResponse> {
    return this.cache.cached('userProfile', githubId, () =>
      this.loadCurrentUserProfile(githubId),
    );
  }

  getActivitySummary(githubId: string): Promise<UserActivityResponse> {
    return this.users.countActivity(githubId);
  }

  // 키는 옛 코드처럼 "닉네임-쪽 번호-쪽 크기"다. 닉네임의 대소문자를 합치지 않는다(DB는 합쳐서 찾지만 키는 요청 그대로다).
  getPublicProfileByNickname(nickname: string, page: PageRequest) {
    return this.cache.cached(
      'publicProfileAggregate',
      `${nickname}-${page.page}-${page.size}`,
      () => this.loadPublicProfile(nickname, page),
    );
  }

  getPendingUsers(): Promise<PendingUserResponse[]> {
    return this.users.findPendingUsers();
  }

  // 옛 코드는 토큰의 사용자를 DB에서 다시 읽는다. 그 사이 사라졌다면 404 U001이다.
  private async loadCurrentUserProfile(
    githubId: string,
  ): Promise<UserProfileResponse> {
    const profile = await this.users.findProfileByGithubId(githubId);
    if (!profile) throw new BusinessException(ErrorCode.USER_NOT_FOUND);
    return {
      ...profile,
      createdAt: toLocalDateTimeSeconds(profile.createdAt),
      updatedAt: toLocalDateTimeSeconds(profile.updatedAt),
    };
  }

  // 닉네임이 없으면 404 U001이다. 글 목록은 getMyPosts와 같은 조회다(createdAt 내림차순 고정, 요청의 sort는 무시).
  // 글 목록은 캐시가 붙은 getMyPosts가 아니라 캐시 없는 findPostsByWriter로 읽는다. 옛 코드가 postQueryPort를 직접 불렀다.
  private async loadPublicProfile(
    nickname: string,
    page: PageRequest,
  ): Promise<UserPublicProfileResponse> {
    const target = await this.users.findPublicProfileByNickname(nickname);
    if (!target) throw new BusinessException(ErrorCode.USER_NOT_FOUND);
    // 옛 코드는 활동 개수와 글 목록을 차례로 읽었다. 서로 기다릴 이유가 없어서 함께 보낸다.
    const [activity, posts] = await Promise.all([
      this.users.countActivity(target.githubId),
      this.posts.findPostsByWriter(target.githubId, page),
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
}
