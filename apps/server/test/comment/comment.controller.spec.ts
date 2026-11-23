import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { CommonModule } from '../../src/common/common.module.js';
import { PagedResponse } from '../../src/common/dto/paged-response.dto.js';
import { validateEnv } from '../../src/config/env.validation.js';
import { AuthModule } from '../../src/modules/auth/auth.module.js';
import { InMemoryTokenStore } from '../../src/modules/auth/in-memory-token-store.js';
import { JwtTokenService } from '../../src/modules/auth/jwt-token.service.js';
import { TokenStore } from '../../src/modules/auth/token-store.js';
import { CommentController } from '../../src/modules/comment/comment.controller.js';
import { CommentService } from '../../src/modules/comment/comment.service.js';
import type { CommentListResponse } from '../../src/modules/comment/dto/comment-list-response.dto.js';
import {
  type User,
  UserRepository,
} from '../../src/modules/user/user.repository.js';

const USERS = new Map<string, User>([
  ['octo', { githubId: 'octo', role: 'USER', email: null }],
  ['boss', { githubId: 'boss', role: 'ADMIN', email: null }],
  ['waiting', { githubId: 'waiting', role: 'PENDING', email: null }],
  ['newbie', { githubId: 'newbie', role: 'PRE_REGISTER', email: null }],
]);

const COMMENT: CommentListResponse = {
  commentId: 3,
  content: '좋은 글이네요',
  createdAt: '2025-07-27T21:08:37.109',
  postId: 7,
  postTitle: '제목',
};
const PAGE = new PagedResponse<CommentListResponse>([COMMENT], 0, 10, 1, 1);
const DEFAULT_SORT = [{ property: 'createdAt', direction: 'desc' }];

// 서비스는 가짜다. 이 시험은 요청 해석(page, size, sort), 메시지, 접근 규칙을 본다.
// 쿼리의 의미는 comment.repository.spec.ts가 진짜 MySQL로 증명한다. 사용자·토큰 저장소도 가짜라서 DB와 Redis가 필요 없다.
async function createApp() {
  const service = { getMyComments: vi.fn().mockResolvedValue(PAGE) };
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        validate: validateEnv,
      }),
      CommonModule,
      AuthModule,
    ],
    controllers: [CommentController],
    providers: [{ provide: CommentService, useValue: service }],
  })
    .overrideProvider(UserRepository)
    .useValue({
      findByGithubId: (githubId: string) =>
        Promise.resolve(USERS.get(githubId)),
    })
    .overrideProvider(TokenStore)
    .useClass(InMemoryTokenStore)
    .compile();
  const app = moduleRef.createNestApplication();
  await app.listen(0);
  const baseUrl = await app.getUrl();

  const get = async (path: string, headers: Record<string, string> = {}) => {
    const res = await fetch(`${baseUrl}${path}`, { headers });
    return { status: res.status, body: await res.json() };
  };
  const bearer = (githubId: string) => ({
    authorization: `Bearer ${moduleRef.get(JwtTokenService).createAccessToken(githubId)}`,
  });
  return { app, service, get, bearer };
}

type TestApp = Awaited<ReturnType<typeof createApp>>;

describe('GET /api/v1/comment/me/comments', () => {
  let t: TestApp;
  const url = '/api/v1/comment/me/comments';

  beforeAll(async () => {
    t = await createApp();
  });

  afterAll(() => t.app.close());

  beforeEach(() => vi.clearAllMocks());

  it('토큰이 없으면 403 J004다', async () => {
    const res = await t.get(url);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ data: 'J004' });
    expect(t.service.getMyComments).not.toHaveBeenCalled();
  });

  it('로그인한 사용자의 githubId로 조회하고 HTTP 200에 옛 메시지와 쪽 정보를 준다', async () => {
    const res = await t.get(url, t.bearer('octo'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 200,
      message: '내가 단 댓글 목록 조회 성공',
      data: {
        content: [COMMENT],
        page: 0,
        size: 10,
        totalElements: 1,
        totalPages: 1,
      },
      timestamp: expect.any(Number),
    });
  });

  it('아무것도 없으면 0쪽, 크기 10, createdAt 내림차순이다', async () => {
    await t.get(url, t.bearer('octo'));
    expect(t.service.getMyComments).toHaveBeenCalledWith(
      'octo',
      { page: 0, size: 10 },
      DEFAULT_SORT,
    );
  });

  it('page와 size를 읽는다', async () => {
    await t.get(`${url}?page=2&size=5`, t.bearer('octo'));
    expect(t.service.getMyComments.mock.calls[0][1]).toEqual({
      page: 2,
      size: 5,
    });
  });

  // 어떤 값도 오류가 되지 않고 기본값으로 고쳐진다(Spring Data).
  it.each([
    ['page=abc&size=abc', { page: 0, size: 10 }],
    ['page=-3&size=0', { page: 0, size: 10 }],
    ['size=5000', { page: 0, size: 2000 }],
  ])('이상한 값(%s)은 오류 없이 고친다', async (query, expected) => {
    const res = await t.get(`${url}?${query}`, t.bearer('octo'));
    expect(res.status).toBe(200);
    expect(t.service.getMyComments.mock.calls[0][1]).toEqual(expected);
  });

  // 요청의 sort는 서비스까지 넘어가고, 기본 정렬(createdAt 내림차순)을 바꾼다. 그 뒤에 어떻게 붙는지는 저장소 시험이 증명한다.
  it('요청의 sort를 읽어 넘긴다', async () => {
    await t.get(`${url}?sort=content,asc&sort=id`, t.bearer('octo'));
    expect(t.service.getMyComments.mock.calls[0][2]).toEqual([
      { property: 'content', direction: 'asc' },
      { property: 'id', direction: 'asc' },
    ]);
  });

  // Spring은 sort[]를 sort로 읽지 않는다. Express 5의 기본 쿼리 해석기도 sort[]를 다른 이름으로 둬서 같다.
  it('sort[]=content,asc(대괄호)는 sort가 아니라서 기본 정렬이다', async () => {
    await t.get(`${url}?sort[]=content,asc`, t.bearer('octo'));
    expect(t.service.getMyComments.mock.calls[0][2]).toEqual(DEFAULT_SORT);
  });

  it('ADMIN도 부를 수 있다', async () => {
    const res = await t.get(url, t.bearer('boss'));
    expect(res.status).toBe(200);
  });

  // 기본 규칙은 USER, ADMIN이다. 가입을 끝내지 않은 사용자는 거부한다.
  it.each(['waiting', 'newbie'])(
    '%s(PENDING·PRE_REGISTER)는 403 J005다',
    async (id) => {
      const res = await t.get(url, t.bearer(id));
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ data: 'J005' });
      expect(t.service.getMyComments).not.toHaveBeenCalled();
    },
  );
});
