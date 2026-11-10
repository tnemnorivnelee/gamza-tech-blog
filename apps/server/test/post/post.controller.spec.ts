import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { CommonModule } from '../../src/common/common.module.js';
import { PagedResponse } from '../../src/common/dto/paged-response.dto.js';
import { validateEnv } from '../../src/config/env.validation.js';
import { AuthModule } from '../../src/modules/auth/auth.module.js';
import { InMemoryTokenStore } from '../../src/modules/auth/in-memory-token-store.js';
import { JwtTokenService } from '../../src/modules/auth/jwt-token.service.js';
import { TokenStore } from '../../src/modules/auth/token-store.js';
import type { PostListResponse } from '../../src/modules/post/dto/post-list-response.dto.js';
import { PostController } from '../../src/modules/post/post.controller.js';
import { PostService } from '../../src/modules/post/post.service.js';
import {
  type User,
  UserRepository,
} from '../../src/modules/user/user.repository.js';

const USERS = new Map<string, User>([
  ['octo', { githubId: 'octo', role: 'USER', email: null }],
  ['waiting', { githubId: 'waiting', role: 'PENDING', email: null }],
]);

const EMPTY_PAGE = new PagedResponse<PostListResponse>([], 0, 10, 0, 0);

// 서비스는 가짜다. 이 시험은 요청 해석(page, size, tags, keyword), 메시지, 오류 코드, 접근 규칙을 본다.
// 쿼리의 의미는 post.repository.spec.ts가 진짜 MySQL로 증명한다. 사용자·토큰 저장소도 가짜라서 DB와 Redis가 필요 없다.
async function createApp() {
  const service = {
    getPosts: vi.fn().mockResolvedValue(EMPTY_PAGE),
    getPostsByTag: vi.fn().mockResolvedValue(EMPTY_PAGE),
    searchPostsByTitle: vi.fn().mockResolvedValue(EMPTY_PAGE),
    getMyPosts: vi.fn().mockResolvedValue(EMPTY_PAGE),
  };
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
    controllers: [PostController],
    providers: [{ provide: PostService, useValue: service }],
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

describe('글 목록 조회 API', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createApp();
  });

  afterAll(() => t.app.close());

  beforeEach(() => vi.clearAllMocks());

  describe('GET /api/v1/posts', () => {
    it('토큰 없이도 부를 수 있고, HTTP 200에 옛 메시지와 쪽 정보를 준다', async () => {
      const res = await t.get('/api/v1/posts');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        status: 200,
        message: '게시물 목록 조회 성공',
        data: {
          content: [],
          page: 0,
          size: 10,
          totalElements: 0,
          totalPages: 0,
        },
        timestamp: expect.any(Number),
      });
    });

    it('아무것도 없으면 0쪽, 크기 10, 태그 필터 없음이다', async () => {
      await t.get('/api/v1/posts');
      expect(t.service.getPosts).toHaveBeenCalledWith(
        { page: 0, size: 10 },
        [],
      );
    });

    it('page, size, tags를 읽는다', async () => {
      await t.get('/api/v1/posts?page=2&size=5&tags=nest');
      expect(t.service.getPosts).toHaveBeenCalledWith({ page: 2, size: 5 }, [
        'nest',
      ]);
    });

    it('tags는 쉼표로 이어도, 반복해도 받는다', async () => {
      await t.get('/api/v1/posts?tags=a,b');
      await t.get('/api/v1/posts?tags=a&tags=b');
      await t.get('/api/v1/posts?tags=a,b&tags=c');
      expect(t.service.getPosts.mock.calls.map(([, tags]) => tags)).toEqual([
        ['a', 'b'],
        ['a', 'b'],
        ['a,b', 'c'],
      ]);
    });

    it('한글 태그를 URL 인코딩해서 보내도 받는다', async () => {
      await t.get(`/api/v1/posts?tags=${encodeURIComponent('백엔드')}`);
      expect(t.service.getPosts.mock.calls[0][1]).toEqual(['백엔드']);
    });

    // 어떤 값도 오류가 되지 않고 기본값으로 고쳐진다(Spring Data).
    it.each([
      ['page=abc&size=abc', { page: 0, size: 10 }],
      ['page=-3&size=0', { page: 0, size: 10 }],
      ['page=&size=', { page: 0, size: 10 }],
      ['page=1.5&size=1e1', { page: 0, size: 10 }],
      ['size=5000', { page: 0, size: 2000 }],
      ['page=3&size=-1', { page: 3, size: 10 }],
    ])('이상한 값(%s)은 오류 없이 고친다', async (query, expected) => {
      const res = await t.get(`/api/v1/posts?${query}`);
      expect(res.status).toBe(200);
      expect(t.service.getPosts.mock.calls[0][0]).toEqual(expected);
    });

    it('요청의 sort는 무시한다(항상 최신순)', async () => {
      const res = await t.get('/api/v1/posts?sort=title,asc&sort=nope');
      expect(res.status).toBe(200);
      expect(t.service.getPosts).toHaveBeenCalledWith(
        { page: 0, size: 10 },
        [],
      );
    });

    it('잘못된 토큰을 같이 보내도 공개 라우트라 무시한다', async () => {
      const res = await t.get('/api/v1/posts', {
        authorization: 'Bearer broken',
      });
      expect(res.status).toBe(200);
    });
  });

  describe('GET /api/v1/posts/tags/:tagName', () => {
    it('경로의 태그로 조회하고 메시지에 태그 이름이 들어간다', async () => {
      const res = await t.get('/api/v1/posts/tags/nest?page=1&size=3');
      expect(res.status).toBe(200);
      expect(res.body.message).toBe("'nest' 태그 게시물 조회 성공");
      expect(t.service.getPostsByTag).toHaveBeenCalledWith('nest', {
        page: 1,
        size: 3,
      });
    });

    it('한글 태그(URL 인코딩)도 풀어서 받는다', async () => {
      const res = await t.get(
        `/api/v1/posts/tags/${encodeURIComponent('백엔드')}`,
      );
      expect(res.body.message).toBe("'백엔드' 태그 게시물 조회 성공");
      expect(t.service.getPostsByTag.mock.calls[0][0]).toBe('백엔드');
    });

    it('기본 크기는 10이다', async () => {
      await t.get('/api/v1/posts/tags/nest');
      expect(t.service.getPostsByTag.mock.calls[0][1]).toEqual({
        page: 0,
        size: 10,
      });
    });
  });

  describe('GET /api/v1/posts/search', () => {
    it('keyword와 평평한 page, size로 검색하고 옛 메시지를 준다', async () => {
      const res = await t.get(
        '/api/v1/posts/search?keyword=nest&page=1&size=3',
      );
      expect(res.status).toBe(200);
      expect(res.body.message).toBe('게시물 검색 조회 성공');
      expect(t.service.searchPostsByTitle).toHaveBeenCalledWith(
        { page: 1, size: 3 },
        'nest',
      );
    });

    it('검색어를 다듬지 않고 그대로 넘긴다(와일드카드 문자 포함)', async () => {
      await t.get(
        `/api/v1/posts/search?keyword=${encodeURIComponent(' 100%_ ')}`,
      );
      expect(t.service.searchPostsByTitle.mock.calls[0][1]).toBe(' 100%_ ');
    });

    it('전각 공백만 있는 검색어는 통과한다(Java trim 기준)', async () => {
      const res = await t.get(
        `/api/v1/posts/search?keyword=${encodeURIComponent('　')}`,
      );
      expect(res.status).toBe(200);
    });

    // 옛 예외 처리기가 검증 실패와 파라미터 누락을 따로 다루지 않아서 마지막 처리기(500)로 갔다(개선 후보 22번).
    it.each(['', '?keyword=', '?keyword=%20%20', '?keyword=%0A%09'])(
      '검색어가 없거나 공백뿐이면(%j) 500 C004다',
      async (query) => {
        const res = await t.get(`/api/v1/posts/search${query}`);
        expect(res.status).toBe(500);
        expect(res.body).toEqual({
          message: expect.any(String),
          status: 500,
          errors: [],
          code: 'C004',
        });
        expect(t.service.searchPostsByTitle).not.toHaveBeenCalled();
      },
    );

    it('프론트 생성 클라이언트의 중첩 형식(pageable[page])은 못 읽고 기본값이다', async () => {
      await t.get(
        '/api/v1/posts/search?keyword=a&pageable[page]=2&pageable[size]=4',
      );
      expect(t.service.searchPostsByTitle.mock.calls[0][0]).toEqual({
        page: 0,
        size: 10,
      });
    });
  });

  describe('GET /api/v1/posts/me', () => {
    it('토큰이 없으면 403 J004다', async () => {
      const res = await t.get('/api/v1/posts/me');
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ data: 'J004' });
      expect(t.service.getMyPosts).not.toHaveBeenCalled();
    });

    it('로그인한 사용자의 githubId로 조회하고 옛 메시지를 준다', async () => {
      const res = await t.get(
        '/api/v1/posts/me?page=1&size=4',
        t.bearer('octo'),
      );
      expect(res.status).toBe(200);
      expect(res.body.message).toBe('내가 쓴 게시물 조회 성공');
      expect(t.service.getMyPosts).toHaveBeenCalledWith('octo', {
        page: 1,
        size: 4,
      });
    });

    it('USER·ADMIN이 아닌 role(승인 대기)은 거부한다', async () => {
      const res = await t.get('/api/v1/posts/me', t.bearer('waiting'));
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ data: 'J005' });
    });

    // /me가 /tags/:tagName 같은 다른 경로와 헷갈리지 않는다.
    it('"me"를 태그 이름으로 조회하는 것과 구분된다', async () => {
      await t.get('/api/v1/posts/tags/me');
      expect(t.service.getPostsByTag.mock.calls[0][0]).toBe('me');
      expect(t.service.getMyPosts).not.toHaveBeenCalled();
    });
  });
});
