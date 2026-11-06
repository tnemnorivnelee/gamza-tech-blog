import type { Access } from '../../src/modules/auth/access.decorator.js';
import type { UserRole } from '../../src/modules/user/user.repository.js';

// 옛 SecurityConfig(role 규칙)와 JwtSkipPathMatcher(토큰 검사 생략 경로)를 프론트 계약의 48개 작업에 겹쳐 분류한 표다.
// 근거는 docs/m2-auth-plan.md 3.7절. 옛 레포 master 기준이다. 키는 operationId(= 컨트롤러 메서드 이름)다.
// 컨트롤러를 옮길 때 메서드에 @Public()·@Roles()를 맞게 붙였는지 access-rules.spec.ts가 이 표와 비교한다.
const LOGIN: readonly UserRole[] = ['USER', 'ADMIN'];
const ADMIN: readonly UserRole[] = ['ADMIN'];

export const oldAccessRules: Readonly<Record<string, Access>> = {
  // 공개 13개: 토큰 검사를 건너뛴다.
  chat: 'public',
  getAllProjects: 'public',
  getAllTags: 'public',
  getHomeFeed: 'public',
  getIntroList: 'public',
  getPostDetail: 'public',
  getPosts: 'public',
  getPostsByTag: 'public',
  getPublicProfileByNickname: 'public',
  getWeeklyPopularPosts: 'public',
  lookup: 'public',
  reissue: 'public',
  searchPosts: 'public',

  // 로그인(USER, ADMIN) 27개. 기본 규칙이라 컨트롤러에 꼬리표를 붙이지 않는다.
  addComment: LOGIN,
  createIntro: LOGIN,
  createProject: LOGIN,
  deleteComment: LOGIN,
  deleteIntro: LOGIN,
  deleteProfileImage: LOGIN,
  deleteProject: LOGIN,
  getActivitySummary: LOGIN,
  getComments: LOGIN,
  getCurrentUserProfile: LOGIN,
  getMyComments: LOGIN,
  getMyLikes: LOGIN,
  getMyPosts: LOGIN,
  getProfileImage: LOGIN,
  isPostLiked: LOGIN,
  likePost: LOGIN,
  logout: LOGIN,
  publishPost: LOGIN,
  removePost: LOGIN,
  revisePost: LOGIN,
  unlikePost: LOGIN,
  updateProfile: LOGIN,
  updateProfileImage: LOGIN,
  updateProject: LOGIN,
  uploadImage: LOGIN,
  withdraw: LOGIN,
  // 옛 서버에서는 로그인해도 항상 거부됐다(아래 ALWAYS_DENIED_IN_OLD). 1차 범위 밖이라 옮기지 않는다.
  getCommitHistories: LOGIN,

  // ADMIN 6개
  approveUserProfile: ADMIN,
  create: ADMIN,
  delete: ADMIN,
  getAll: ADMIN,
  getPendingUsers: ADMIN,
  update: ADMIN,

  // 특수 2개
  getCurrentUserRole: ['USER', 'PRE_REGISTER', 'PENDING', 'ADMIN'],
  completeProfile: ['PRE_REGISTER'],
};

// SecurityConfig는 로그인(USER, ADMIN)을 요구하는데 JwtSkipPathMatcher는 토큰 검사를 건너뛰는 경로다.
// 인증 정보가 붙지 않아 로그인한 사용자도 거부됐다. 개선 후보가 아니라 옛 버그에 가깝고, 이식 범위 밖이다.
export const ALWAYS_DENIED_IN_OLD: readonly string[] = ['getCommitHistories'];
