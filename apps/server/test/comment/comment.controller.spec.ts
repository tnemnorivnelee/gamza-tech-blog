import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { CommonModule } from '../../src/common/common.module.js';
import { PagedResponse } from '../../src/common/dto/paged-response.dto.js';
import { BusinessException } from '../../src/common/error/business.exception.js';
import { ErrorCode } from '../../src/common/error/error-code.js';
import { validateEnv } from '../../src/config/env.validation.js';
import { AuthModule } from '../../src/modules/auth/auth.module.js';
import { InMemoryTokenStore } from '../../src/modules/auth/in-memory-token-store.js';
import { JwtTokenService } from '../../src/modules/auth/jwt-token.service.js';
import { TokenStore } from '../../src/modules/auth/token-store.js';
import { CommentController } from '../../src/modules/comment/comment.controller.js';
import { CommentService } from '../../src/modules/comment/comment.service.js';
import type { CommentListResponse } from '../../src/modules/comment/dto/comment-list-response.dto.js';
import type { CommentResponse } from '../../src/modules/comment/dto/comment-response.dto.js';
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

const CREATED: CommentResponse = {
  commentId: 9,
  writer: '감자',
  writerProfileImageUrl: null,
  content: '새 댓글',
  createdAt: '2025-07-27T21:08:37.109',
  replies: [],
};

// 서비스는 가짜다. 이 시험은 요청 해석(page, size, sort), 메시지, 접근 규칙을 본다.
// 쿼리의 의미는 comment.repository.spec.ts가 진짜 MySQL로 증명한다. 사용자·토큰 저장소도 가짜라서 DB와 Redis가 필요 없다.
async function createApp() {
  const service = {
    getMyComments: vi.fn().mockResolvedValue(PAGE),
    addComment: vi.fn().mockResolvedValue(CREATED),
    deleteComment: vi.fn().mockResolvedValue(undefined),
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
  // body가 있으면 JSON으로 보낸다. 쓰기 API(POST, DELETE) 시험이 쓴다.
  const send = async (
    method: 'POST' | 'DELETE',
    path: string,
    headers: Record<string, string> = {},
    body?: unknown,
  ) => {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers:
        body === undefined
          ? headers
          : { ...headers, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  const bearer = (githubId: string) => ({
    authorization: `Bearer ${moduleRef.get(JwtTokenService).createAccessToken(githubId)}`,
  });
  return { app, service, get, send, bearer };
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

describe('POST /api/v1/comment/{postId}/comments', () => {
  let t: TestApp;
  const url = '/api/v1/comment/7/comments';

  beforeAll(async () => {
    t = await createApp();
  });

  afterAll(() => t.app.close());

  beforeEach(() => vi.clearAllMocks());

  it('토큰이 없으면 403 J004다', async () => {
    const res = await t.send('POST', url, {}, { content: '내용' });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ data: 'J004' });
    expect(t.service.addComment).not.toHaveBeenCalled();
  });

  // 옛 ResponseDto.of(CREATED, "댓글이 등록되었습니다.", ...)이다: HTTP는 200이고 본문 status만 201이다.
  it('로그인한 사용자의 githubId, 글 번호, 내용으로 쓰고 HTTP 200에 본문 status 201과 만든 댓글을 준다', async () => {
    const res = await t.send('POST', url, t.bearer('octo'), {
      content: '새 댓글',
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 201,
      message: '댓글이 등록되었습니다.',
      data: CREATED,
      timestamp: expect.any(Number),
    });
    expect(t.service.addComment).toHaveBeenCalledWith(
      'octo',
      7n,
      '새 댓글',
      null,
    );
  });

  it('parentCommentId는 bigint로 바꿔 넘기고, 없거나 null이면 null이다', async () => {
    await t.send('POST', url, t.bearer('octo'), {
      content: 'a',
      parentCommentId: 3,
    });
    await t.send('POST', url, t.bearer('octo'), {
      content: 'b',
      parentCommentId: null,
    });
    await t.send('POST', url, t.bearer('octo'), { content: 'c' });
    expect(t.service.addComment.mock.calls.map((call) => call[3])).toEqual([
      3n,
      null,
      null,
    ]);
  });

  // 옛 컨트롤러에 @Valid가 없어서 요청 본문을 검사하지 않았다. 빈 내용도 서비스까지 간다.
  it.each(['', '   ', '가'.repeat(1001)])(
    '내용이 검사 없이 서비스로 간다(길이 %#)',
    async (content) => {
      const res = await t.send('POST', url, t.bearer('octo'), { content });
      expect(res.status).toBe(200);
      expect(t.service.addComment).toHaveBeenCalledWith(
        'octo',
        7n,
        content,
        null,
      );
    },
  );

  it('ADMIN도 쓸 수 있다', async () => {
    const res = await t.send('POST', url, t.bearer('boss'), {
      content: '내용',
    });
    expect(res.status).toBe(200);
    expect(t.service.addComment).toHaveBeenCalledWith('boss', 7n, '내용', null);
  });

  it.each([
    [ErrorCode.POST_NOT_FOUND, 404, 'P001'],
    [ErrorCode.COMMENT_NOT_FOUND, 404, 'CM001'],
    [ErrorCode.COMMENT_INVALID_PARENT, 400, 'CM004'],
  ])(
    '서비스가 던진 오류가 그대로 나간다(%#)',
    async (errorCode, status, code) => {
      t.service.addComment.mockRejectedValueOnce(
        new BusinessException(errorCode),
      );
      const res = await t.send('POST', url, t.bearer('octo'), {
        content: '내용',
      });
      expect(res.status).toBe(status);
      expect(res.body).toMatchObject({ status, code });
    },
  );

  it.each(['abc', '1.5', '9223372036854775808'])(
    '글 번호가 숫자가 아니거나 범위 밖이면(%s) 400 C005다',
    async (raw) => {
      const res = await t.send(
        'POST',
        `/api/v1/comment/${raw}/comments`,
        t.bearer('octo'),
        { content: '내용' },
      );
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        status: 400,
        code: 'C005',
        errors: [{ field: 'postId', value: raw, reason: 'typeMismatch' }],
      });
      expect(t.service.addComment).not.toHaveBeenCalled();
    },
  );

  it.each(['waiting', 'newbie'])(
    '%s(PENDING·PRE_REGISTER)는 403 J005다',
    async (id) => {
      const res = await t.send('POST', url, t.bearer(id), { content: '내용' });
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ data: 'J005' });
      expect(t.service.addComment).not.toHaveBeenCalled();
    },
  );
});

describe('DELETE /api/v1/comment/{commentId}', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createApp();
  });

  afterAll(() => t.app.close());

  beforeEach(() => vi.clearAllMocks());

  it('토큰이 없으면 403 J004다', async () => {
    const res = await t.send('DELETE', '/api/v1/comment/3');
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ data: 'J004' });
    expect(t.service.deleteComment).not.toHaveBeenCalled();
  });

  it('로그인한 사용자의 githubId와 댓글 번호로 지우고, 본문 status 200과 옛 메시지를 준다(data 없음)', async () => {
    const res = await t.send('DELETE', '/api/v1/comment/3', t.bearer('octo'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 200,
      message: '댓글이 삭제되었습니다.',
      timestamp: expect.any(Number),
    });
    expect(res.body).not.toHaveProperty('data');
    expect(t.service.deleteComment).toHaveBeenCalledWith('octo', 3n);
  });

  it('댓글이 없으면 404 CM001, 쓴 사람이 아니면 403 CM002가 그대로 나간다', async () => {
    t.service.deleteComment.mockRejectedValueOnce(
      new BusinessException(ErrorCode.COMMENT_NOT_FOUND),
    );
    t.service.deleteComment.mockRejectedValueOnce(
      new BusinessException(ErrorCode.COMMENT_FORBIDDEN),
    );
    const missing = await t.send(
      'DELETE',
      '/api/v1/comment/999',
      t.bearer('octo'),
    );
    const forbidden = await t.send(
      'DELETE',
      '/api/v1/comment/3',
      t.bearer('octo'),
    );
    expect(missing).toMatchObject({ status: 404, body: { code: 'CM001' } });
    expect(forbidden).toMatchObject({ status: 403, body: { code: 'CM002' } });
  });

  // GET me/comments가 내 댓글 목록이다. DELETE는 'me'를 댓글 번호로 읽으려다 실패한다.
  it.each(['abc', 'me', '12abc'])(
    '댓글 번호가 숫자가 아니면(%s) 400 C005다',
    async (raw) => {
      const res = await t.send(
        'DELETE',
        `/api/v1/comment/${raw}`,
        t.bearer('octo'),
      );
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        status: 400,
        code: 'C005',
        errors: [{ field: 'commentId', value: raw, reason: 'typeMismatch' }],
      });
      expect(t.service.deleteComment).not.toHaveBeenCalled();
    },
  );

  it.each(['waiting', 'newbie'])(
    '%s(PENDING·PRE_REGISTER)는 403 J005다',
    async (id) => {
      const res = await t.send('DELETE', '/api/v1/comment/3', t.bearer(id));
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ data: 'J005' });
      expect(t.service.deleteComment).not.toHaveBeenCalled();
    },
  );
});
