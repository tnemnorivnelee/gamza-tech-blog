import { ErrorCode } from '../../common/error/error-code.js';
import type { PostService } from '../post/post.service.js';
import type {
  PublicProfile,
  UserProfile,
  UserQueryRepository,
} from './user-query.repository.js';
import { UserService } from './user.service.js';

const profile = (overrides: Partial<UserProfile> = {}): UserProfile => ({
  githubId: 'octo',
  nickname: '감자',
  name: '박지훈',
  email: 'octo@example.com',
  profileImageUrl: 'https://img.test/p.png',
  position: 'BACKEND',
  role: 'USER',
  studentNumber: '20231234',
  gamjaBatch: 9,
  createdAt: new Date('2025-07-27T21:08:37.999Z'),
  updatedAt: new Date('2025-08-05T10:20:30.123Z'),
  ...overrides,
});

const target: PublicProfile = {
  githubId: 'octo',
  nickname: '감자',
  gamjaBatch: 9,
  profileImageUrl: null,
};
const ACTIVITY = {
  likedPostCount: 5,
  writtenPostCount: 10,
  writtenCommentCount: 20,
};
const POSTS = {
  content: [],
  page: 0,
  size: 20,
  totalElements: 0,
  totalPages: 0,
};

function setup() {
  const repo = {
    findProfileByGithubId: vi.fn().mockResolvedValue(profile()),
    findPublicProfileByNickname: vi.fn().mockResolvedValue(target),
    countActivity: vi.fn().mockResolvedValue(ACTIVITY),
    findPendingUsers: vi.fn().mockResolvedValue([]),
  };
  const posts = { getMyPosts: vi.fn().mockResolvedValue(POSTS) };
  return {
    repo,
    posts,
    service: new UserService(
      repo as unknown as UserQueryRepository,
      posts as unknown as PostService,
    ),
  };
}

describe('UserService', () => {
  describe('getCurrentUserProfile', () => {
    it('날짜는 초까지만 쓴 문자열이고 나머지는 그대로다', async () => {
      const { service, repo } = setup();
      expect(await service.getCurrentUserProfile('octo')).toEqual({
        githubId: 'octo',
        nickname: '감자',
        name: '박지훈',
        email: 'octo@example.com',
        profileImageUrl: 'https://img.test/p.png',
        position: 'BACKEND',
        role: 'USER',
        studentNumber: '20231234',
        gamjaBatch: 9,
        createdAt: '2025-07-27T21:08:37',
        updatedAt: '2025-08-05T10:20:30',
      });
      expect(repo.findProfileByGithubId).toHaveBeenCalledWith('octo');
    });

    it('값이 없는 칸은 키가 빠지지 않고 null이다(가입 전 사용자)', async () => {
      const { service, repo } = setup();
      repo.findProfileByGithubId.mockResolvedValue(
        profile({
          email: null,
          profileImageUrl: null,
          position: null,
          studentNumber: null,
          gamjaBatch: null,
          role: 'PRE_REGISTER',
        }),
      );
      const response = await service.getCurrentUserProfile('octo');
      expect(response).toMatchObject({
        email: null,
        profileImageUrl: null,
        position: null,
        studentNumber: null,
        gamjaBatch: null,
        role: 'PRE_REGISTER',
      });
      expect(Object.keys(response)).toHaveLength(11);
    });

    it('사용자가 없으면 404 U001이다', async () => {
      const { service, repo } = setup();
      repo.findProfileByGithubId.mockResolvedValue(null);
      await expect(
        service.getCurrentUserProfile('ghost'),
      ).rejects.toMatchObject({ errorCode: ErrorCode.USER_NOT_FOUND });
    });
  });

  it('getActivitySummary는 저장소의 세 개수를 그대로 준다', async () => {
    const { service, repo } = setup();
    expect(await service.getActivitySummary('octo')).toEqual(ACTIVITY);
    expect(repo.countActivity).toHaveBeenCalledWith('octo');
  });

  describe('getPublicProfileByNickname', () => {
    it('프로필, 활동, 그 사용자의 글 목록을 묶는다(githubId는 싣지 않는다)', async () => {
      const { service, repo, posts } = setup();
      const page = { page: 1, size: 20 };
      expect(await service.getPublicProfileByNickname('감자', page)).toEqual({
        profile: { profileImageUrl: null, nickname: '감자', gamjaBatch: 9 },
        activity: ACTIVITY,
        posts: POSTS,
      });
      expect(repo.findPublicProfileByNickname).toHaveBeenCalledWith('감자');
      expect(repo.countActivity).toHaveBeenCalledWith('octo');
      expect(posts.getMyPosts).toHaveBeenCalledWith('octo', page);
    });

    it('응답의 닉네임은 요청 값이 아니라 저장된 값이다', async () => {
      const { service } = setup();
      const response = await service.getPublicProfileByNickname('OCTO', {
        page: 0,
        size: 20,
      });
      expect(response.profile.nickname).toBe('감자');
    });

    it('닉네임이 없으면 404 U001이고 활동과 글은 읽지 않는다', async () => {
      const { service, repo, posts } = setup();
      repo.findPublicProfileByNickname.mockResolvedValue(null);
      await expect(
        service.getPublicProfileByNickname('없음', { page: 0, size: 20 }),
      ).rejects.toMatchObject({ errorCode: ErrorCode.USER_NOT_FOUND });
      expect(repo.countActivity).not.toHaveBeenCalled();
      expect(posts.getMyPosts).not.toHaveBeenCalled();
    });
  });

  it('getPendingUsers는 저장소의 목록을 그대로 준다', async () => {
    const { service, repo } = setup();
    const pending = [
      { userId: 3, gamjaBatch: null, name: '이름', position: null },
    ];
    repo.findPendingUsers.mockResolvedValue(pending);
    expect(await service.getPendingUsers()).toEqual(pending);
  });
});
