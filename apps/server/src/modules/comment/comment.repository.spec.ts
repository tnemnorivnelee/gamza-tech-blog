import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { BusinessException } from '../../common/error/business.exception.js';
import { ErrorCode } from '../../common/error/error-code.js';
import { kstWallClockNow } from '../../common/local-date-time.js';
import type { PageRequest, SortOrder } from '../../common/pageable.js';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import {
  databaseReachable as reachable,
  databaseUrl as url,
} from '../../../test/support/test-database.js';
import { CommentRepository } from './comment.repository.js';

// 진짜 MySQL로 하는 시험이다(docs/m5-read-api-plan.md D5). 정렬, 쪽 나누기, 개수는 가짜로는 증명할 수 없다.
// 접속과 건너뛰기 판단은 test/support/test-database.ts가 한다.

// 시험이 만든 사용자의 githubId 접두사다. 다른 DB 시험의 접두사(g_test_, post_test_, intro_test_, user_q_test_, like_test_)와 겹치지 않는다.
const PREFIX = 'cmt_test_';

// 시험 데이터의 시각은 2099년이다. 복원한 실제 데이터(2026년까지)와 구분하기 쉽다(사용자로 걸러 읽어서 어차피 섞이지는 않는다).
const at = (seconds: number) => new Date(Date.UTC(2099, 0, 1, 0, 0, seconds));
const NOW = new Date(Date.UTC(2099, 0, 1));
const first = (page = 0, size = 10): PageRequest => ({ page, size });
const DEFAULT: SortOrder[] = [{ property: 'createdAt', direction: 'desc' }];
const order = (property: string, direction: 'asc' | 'desc'): SortOrder => ({
  property,
  direction,
});

describe.skipIf(!reachable)('CommentRepository (진짜 MySQL)', () => {
  let prisma: PrismaService;
  let repo: CommentRepository;

  beforeAll(() => {
    prisma = new PrismaService(
      new ConfigService<EnvironmentVariables, true>({ DATABASE_URL: url }),
    );
    repo = new CommentRepository(prisma);
  });

  // 자식 행부터 지운다(외래 키). 복원한 실제 데이터는 접두사로 걸러서 건드리지 않는다.
  afterEach(async () => {
    const mine = { githubId: { startsWith: PREFIX } };
    const ofMine = { OR: [{ user: mine }, { post: { user: mine } }] };
    // 답글(대댓글)이 부모 댓글을 가리키는 외래 키가 있어서, 답글이 없는 댓글(맨 아래)부터 층별로 지운다. 여러 층이어도 끝까지 반복한다.
    for (;;) {
      const { count } = await prisma.comment.deleteMany({
        where: { ...ofMine, replies: { none: {} } },
      });
      if (count === 0) break;
    }
    await prisma.post.deleteMany({ where: { user: mine } });
    await prisma.profileImage.deleteMany({ where: { user: mine } });
    await prisma.repository.deleteMany({ where: { user: mine } });
    await prisma.user.deleteMany({ where: mine });
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  async function createUser() {
    const id = randomUUID();
    const user = await prisma.user.create({
      data: {
        githubId: `${PREFIX}${id}`,
        name: '시험 사용자',
        nickname: `${PREFIX}nick-${id}`,
        role: 'USER',
        createdAt: NOW,
        updatedAt: NOW,
      },
    });
    // 글은 작성자의 GitHub 저장소(사용자당 하나)가 있어야 만들 수 있다.
    const repository = await prisma.repository.create({
      data: {
        name: 'test',
        userId: user.userId,
        createdAt: NOW,
        updatedAt: NOW,
      },
    });
    return { ...user, repositoryId: repository.repositoryId };
  }

  type Person = Awaited<ReturnType<typeof createUser>>;

  const createPost = (author: Person, title = `제목-${randomUUID()}`) =>
    prisma.post.create({
      data: {
        title,
        content: '본문',
        createdAt: at(1),
        updatedAt: at(1),
        userId: author.userId,
        repositoryId: author.repositoryId,
      },
    });

  // updatedAt은 따로 주지 않으면 createdAt과 같다. 답글은 parent로 부모 댓글을 준다.
  const commentFor = (
    user: { userId: bigint },
    post: { postId: bigint },
    content: string,
    createdAt: Date,
    {
      updatedAt = createdAt,
      parentCommentId,
    }: {
      updatedAt?: Date;
      parentCommentId?: bigint;
    } = {},
  ) =>
    prisma.comment.create({
      data: {
        content,
        createdAt,
        updatedAt,
        userId: user.userId,
        postId: post.postId,
        parentCommentId,
      },
    });

  const contents = (page: { comments: { content: string }[] }) =>
    page.comments.map((comment) => comment.content);

  // 한 사용자가 한 글에 단 댓글만 시험하는 경우가 많아서 묶어 둔다.
  async function setup() {
    const me = await createUser();
    const post = await createPost(await createUser());
    return { me, post };
  }

  describe('범위', () => {
    it('내가 쓴 댓글만 나오고, 답글도 최상위 댓글과 구분 없이 나온다', async () => {
      const me = await createUser();
      const other = await createUser();
      const post = await createPost(await createUser());
      const top = await commentFor(me, post, '내 최상위', at(1));
      const otherTop = await commentFor(other, post, '남의 댓글', at(2));
      await commentFor(me, post, '내 답글', at(3), {
        parentCommentId: otherTop.commentId,
      });
      await commentFor(other, post, '남의 답글', at(4), {
        parentCommentId: top.commentId,
      });

      const page = await repo.findMyCommentPage(me.githubId, first(), DEFAULT);
      expect(contents(page)).toEqual(['내 답글', '내 최상위']);
      expect(page.totalElements).toBe(2);
    });

    it('댓글이 없으면 빈 목록과 0이다', async () => {
      const me = await createUser();
      const page = await repo.findMyCommentPage(me.githubId, first(), DEFAULT);
      expect(page).toEqual({ comments: [], totalElements: 0 });
    });

    it('댓글 번호, 내용, 단 시각, 글 번호, 글 제목을 준다', async () => {
      const me = await createUser();
      const author = await createUser();
      const postA = await createPost(author, '글 A');
      const postB = await createPost(author, '글 B');
      const onA = await commentFor(me, postA, '가', at(5));
      const onB = await commentFor(me, postB, '나', at(6));

      const { comments } = await repo.findMyCommentPage(
        me.githubId,
        first(),
        DEFAULT,
      );
      expect(comments).toEqual([
        {
          commentId: Number(onB.commentId),
          content: '나',
          createdAt: at(6),
          postId: Number(postB.postId),
          postTitle: '글 B',
        },
        {
          commentId: Number(onA.commentId),
          content: '가',
          createdAt: at(5),
          postId: Number(postA.postId),
          postTitle: '글 A',
        },
      ]);
    });
  });

  describe('정렬', () => {
    // 네 댓글: a(1초), b(3초), c(2초), d(3초, b와 같은 시각이고 나중에 만들어 commentId가 크다).
    async function createFour() {
      const { me, post } = await setup();
      await commentFor(me, post, 'a', at(1));
      await commentFor(me, post, 'b', at(3));
      await commentFor(me, post, 'c', at(2));
      await commentFor(me, post, 'd', at(3));
      return me;
    }

    it('기본은 단 시각 내림차순이고, 같은 시각이면 commentId가 큰 쪽이 먼저다', async () => {
      const me = await createFour();
      const page = await repo.findMyCommentPage(me.githubId, first(), DEFAULT);
      expect(contents(page)).toEqual(['d', 'b', 'c', 'a']);
    });

    // 옛 쿼리 메서드 이름의 createdAt 내림차순이 먼저이고 요청의 sort는 그 뒤에 붙는다(Spring Data 3.4.0).
    // 소개 목록처럼 요청의 sort가 기본 정렬을 바꾸는 것이 아니다.
    it('요청의 createdAt 오름차순도 단 시각 내림차순을 뒤집지 못한다', async () => {
      const me = await createFour();
      const page = await repo.findMyCommentPage(me.githubId, first(), [
        order('createdAt', 'asc'),
      ]);
      expect(contents(page)).toEqual(['d', 'b', 'c', 'a']);
    });

    // 가장 늦은 y(9초)의 내용 m은 글자 순서로 a와 z 사이에 있다. 요청의 content가 단 시각을 이기면 [a, m, z]가 된다.
    it('요청의 sort는 같은 시각 안에서만 순서를 정한다', async () => {
      const { me, post } = await setup();
      await commentFor(me, post, 'a', at(5));
      await commentFor(me, post, 'z', at(5));
      await commentFor(me, post, 'm', at(9));

      const byDefault = await repo.findMyCommentPage(
        me.githubId,
        first(),
        DEFAULT,
      );
      expect(contents(byDefault)).toEqual(['m', 'z', 'a']);
      const byContent = await repo.findMyCommentPage(me.githubId, first(), [
        order('content', 'asc'),
      ]);
      expect(contents(byContent)).toEqual(['m', 'a', 'z']);
    });

    // 같은 시각(5초)의 세 댓글을 만든 순서 i1, i2, i3으로 부른다. 내용은 m, z, a이고 updatedAt은 30, 10, 20초라서
    // id, updatedAt, content로 정렬하면 순서가 모두 다르다.
    describe('같은 시각의 세 댓글', () => {
      async function createTies() {
        const { me, post } = await setup();
        await commentFor(me, post, 'm', at(5), { updatedAt: at(30) });
        await commentFor(me, post, 'z', at(5), { updatedAt: at(10) });
        await commentFor(me, post, 'a', at(5), { updatedAt: at(20) });
        return me;
      }

      it.each([
        // 요청이 없으면(기본 createdAt desc) 같은 시각은 commentId 내림차순이다.
        ['기본', DEFAULT, ['a', 'z', 'm']],
        ['id 오름차순', [order('id', 'asc')], ['m', 'z', 'a']],
        ['id 내림차순', [order('id', 'desc')], ['a', 'z', 'm']],
        ['updatedAt 오름차순', [order('updatedAt', 'asc')], ['z', 'a', 'm']],
        ['updatedAt 내림차순', [order('updatedAt', 'desc')], ['m', 'a', 'z']],
        ['content 오름차순', [order('content', 'asc')], ['a', 'm', 'z']],
        ['content 내림차순', [order('content', 'desc')], ['z', 'm', 'a']],
        // createdAt은 이미 첫 키라서 같은 시각 안에서는 아무 효과가 없고, 마지막 마무리(commentId 내림차순)가 남는다.
        ['createdAt 오름차순', [order('createdAt', 'asc')], ['a', 'z', 'm']],
        // 여러 항목은 적은 순서대로 적용된다.
        [
          'content 오름차순 다음 id',
          [order('content', 'asc'), order('id', 'asc')],
          ['a', 'm', 'z'],
        ],
      ] as const)('%s', async (_name, orders, expected) => {
        const me = await createTies();
        const page = await repo.findMyCommentPage(me.githubId, first(), orders);
        expect(contents(page)).toEqual(expected);
      });
    });

    // 옛 Spring Data는 없는 속성이면 예외를 던졌고 옛 예외 처리기는 이것을 따로 다루지 않아 500으로 보냈다 [추정, docs/m5-read-api-plan.md 3.1].
    // 연관 이름(post, user)은 옛 서버가 받았지만 옮기지 않았다(comment.repository.ts의 shortcut).
    it.each([
      'commentId',
      'postId',
      'post',
      'user',
      'parent',
      'replies',
      'user.nickname',
      'ID',
      'constructor',
      '__proto__',
    ])('허용 목록에 없는 속성(%s)은 500 C004다', async (property) => {
      const { me } = await setup();
      await expect(
        repo.findMyCommentPage(me.githubId, first(), [order(property, 'asc')]),
      ).rejects.toThrow(new BusinessException(ErrorCode.INTERNAL_SERVER_ERROR));
    });
  });

  describe('쪽 나누기', () => {
    // 다섯 댓글이 모두 같은 시각이라 순서는 commentId 내림차순(e5부터 e1)이다.
    async function createFive() {
      const { me, post } = await setup();
      for (const n of [1, 2, 3, 4, 5])
        await commentFor(me, post, `e${n}`, at(5));
      return me;
    }

    it('크기 2로 나누면 2, 2, 1개이고 이어 붙이면 전체 순서와 같다', async () => {
      const me = await createFive();
      const pages = await Promise.all(
        [0, 1, 2].map((page) =>
          repo.findMyCommentPage(me.githubId, first(page, 2), DEFAULT),
        ),
      );
      expect(pages.map(contents)).toEqual([['e5', 'e4'], ['e3', 'e2'], ['e1']]);
      expect(pages.map((page) => page.totalElements)).toEqual([5, 5, 5]);
    });

    // 글 목록은 빈 쪽이면 0을 돌려주지만(옛 PageImpl(List.of(), pageable, 0)) 내 댓글 목록은 개수를 항상 센다.
    it('범위를 넘긴 쪽은 비어 있어도 실제 전체 개수를 준다', async () => {
      const me = await createFive();
      const page = await repo.findMyCommentPage(
        me.githubId,
        first(99, 2),
        DEFAULT,
      );
      expect(page).toEqual({ comments: [], totalElements: 5 });
    });
  });

  // 쓰기 시험의 준비물: 사용자 둘과 글 하나. 프로필 이미지는 필요할 때만 만든다.
  async function writeSetup() {
    const me = await createUser();
    const other = await createUser();
    const post = await createPost(other);
    return { me, other, post };
  }

  const rowsOf = (post: { postId: bigint }) =>
    prisma.comment.findMany({
      where: { postId: post.postId },
      orderBy: { commentId: 'asc' },
    });

  describe('createComment', () => {
    it('글이 없으면 POST_NOT_FOUND이고 아무것도 쓰지 않는다', async () => {
      const { me } = await writeSetup();
      const result = await repo.createComment(
        me.githubId,
        987654321012n,
        '내용',
        null,
      );
      expect(result).toEqual({ status: 'POST_NOT_FOUND' });
      expect(await prisma.comment.count({ where: { userId: me.userId } })).toBe(
        0,
      );
    });

    it('최상위 댓글을 쓰면 CREATED와 만든 댓글(작성자 닉네임, 이미지 없음은 null, 부모 없음)을 준다', async () => {
      const { me, post } = await writeSetup();
      const result = await repo.createComment(
        me.githubId,
        post.postId,
        '첫 댓글',
        null,
      );
      expect(result.status).toBe('CREATED');
      if (result.status !== 'CREATED') return;
      expect(result.comment).toMatchObject({
        parentCommentId: null,
        writer: me.nickname,
        writerProfileImageUrl: null,
        content: '첫 댓글',
      });
      const [row] = await rowsOf(post);
      expect(row).toMatchObject({
        commentId: BigInt(result.comment.commentId),
        userId: me.userId,
        parentCommentId: null,
        content: '첫 댓글',
      });
    });

    it('작성자의 프로필 이미지 주소를 준다', async () => {
      const { me, post } = await writeSetup();
      await prisma.profileImage.create({
        data: {
          profileImageUrl: 'https://img.test/me.png',
          userId: me.userId,
          createdAt: NOW,
          updatedAt: NOW,
        },
      });
      const result = await repo.createComment(
        me.githubId,
        post.postId,
        '내용',
        null,
      );
      expect(result).toMatchObject({
        status: 'CREATED',
        comment: { writerProfileImageUrl: 'https://img.test/me.png' },
      });
    });

    // 옛 컨트롤러에 @Valid가 없어서 검사하지 않았다. 빈 내용도, 1000자를 넘는 내용도 저장된다.
    it.each([
      ['빈 문자열', ''],
      ['공백만', '   '],
      ['1001자', '가'.repeat(1001)],
    ])('내용이 %s이어도 저장한다', async (_label, content) => {
      const { me, post } = await writeSetup();
      const result = await repo.createComment(
        me.githubId,
        post.postId,
        content,
        null,
      );
      expect(result.status).toBe('CREATED');
      expect((await rowsOf(post))[0].content).toBe(content);
    });

    // 내용이 아예 없으면 DB의 NOT NULL이 막는다(옛 Hibernate의 nullable = false). 던지고 아무것도 쓰지 않는다.
    it('내용이 없으면 던지고 아무것도 쓰지 않는다', async () => {
      const { me, post } = await writeSetup();
      await expect(
        repo.createComment(
          me.githubId,
          post.postId,
          undefined as unknown as string,
          null,
        ),
      ).rejects.toThrow();
      expect(await rowsOf(post)).toEqual([]);
    });

    // DB에 DATETIME 기본값이 없어서 코드가 채운다. 서울 벽시계 값(UTC 필드)의 지금이고 두 값이 같다.
    it('만든 시각과 고친 시각이 같고 서울 벽시계 값의 지금이다', async () => {
      const { me, post } = await writeSetup();
      await repo.createComment(me.githubId, post.postId, '시각', null);
      const [row] = await rowsOf(post);
      expect(row.updatedAt).toEqual(row.createdAt);
      expect(
        Math.abs(row.createdAt.getTime() - kstWallClockNow().getTime()),
      ).toBeLessThan(10_000);
    });

    it('같은 글의 댓글에 답글을 달면 부모 번호가 붙는다', async () => {
      const { me, other, post } = await writeSetup();
      const parent = await commentFor(other, post, '부모', at(5));
      const result = await repo.createComment(
        me.githubId,
        post.postId,
        '답글',
        parent.commentId,
      );
      expect(result).toMatchObject({
        status: 'CREATED',
        comment: { parentCommentId: Number(parent.commentId) },
      });
      expect((await rowsOf(post)).map((row) => row.parentCommentId)).toEqual([
        null,
        parent.commentId,
      ]);
    });

    it('답글에도 답글을 달 수 있다(깊이에 제한이 없다)', async () => {
      const { me, other, post } = await writeSetup();
      const top = await commentFor(other, post, '최상위', at(5));
      const reply = await commentFor(other, post, '답글', at(6), {
        parentCommentId: top.commentId,
      });
      const result = await repo.createComment(
        me.githubId,
        post.postId,
        '답답글',
        reply.commentId,
      );
      expect(result.status).toBe('CREATED');
    });

    it('부모 댓글이 없으면 PARENT_NOT_FOUND이고 아무것도 쓰지 않는다', async () => {
      const { me, post } = await writeSetup();
      const result = await repo.createComment(
        me.githubId,
        post.postId,
        '내용',
        987654321012n,
      );
      expect(result).toEqual({ status: 'PARENT_NOT_FOUND' });
      expect(await rowsOf(post)).toEqual([]);
    });

    it('부모 댓글이 다른 글의 것이면 PARENT_OF_OTHER_POST이고 아무것도 쓰지 않는다', async () => {
      const { me, other, post } = await writeSetup();
      const elsewhere = await createPost(other);
      const parent = await commentFor(
        other,
        elsewhere,
        '다른 글의 댓글',
        at(5),
      );
      const result = await repo.createComment(
        me.githubId,
        post.postId,
        '내용',
        parent.commentId,
      );
      expect(result).toEqual({ status: 'PARENT_OF_OTHER_POST' });
      expect(await rowsOf(post)).toEqual([]);
    });

    // 글이 없는 것이 부모 검사보다 먼저다(옛 createComment의 검사 순서).
    it('글도 없고 부모도 없으면 글 쪽 오류가 먼저다', async () => {
      const { me } = await writeSetup();
      const result = await repo.createComment(
        me.githubId,
        987654321012n,
        '내용',
        987654321013n,
      );
      expect(result).toEqual({ status: 'POST_NOT_FOUND' });
    });

    it('같은 사용자가 같은 글에 여러 번 달 수 있다', async () => {
      const { me, post } = await writeSetup();
      await repo.createComment(me.githubId, post.postId, '하나', null);
      await repo.createComment(me.githubId, post.postId, '둘', null);
      expect((await rowsOf(post)).map((row) => row.content)).toEqual([
        '하나',
        '둘',
      ]);
    });
  });

  describe('deleteComment', () => {
    it('댓글이 없으면 COMMENT_NOT_FOUND다', async () => {
      const { me } = await writeSetup();
      expect(await repo.deleteComment(me.githubId, 987654321012n)).toEqual({
        status: 'COMMENT_NOT_FOUND',
      });
    });

    it('남의 댓글이면 FORBIDDEN이고 지우지 않는다', async () => {
      const { me, other, post } = await writeSetup();
      const theirs = await commentFor(other, post, '남의 댓글', at(5));
      expect(await repo.deleteComment(me.githubId, theirs.commentId)).toEqual({
        status: 'FORBIDDEN',
      });
      expect(await rowsOf(post)).toHaveLength(1);
    });

    it('내 댓글이면 DELETED와 그 댓글이 달린 글의 번호를 주고 행이 사라진다', async () => {
      const { me, post } = await writeSetup();
      const mine = await commentFor(me, post, '내 댓글', at(5));
      expect(await repo.deleteComment(me.githubId, mine.commentId)).toEqual({
        status: 'DELETED',
        postId: Number(post.postId),
      });
      expect(await rowsOf(post)).toEqual([]);
    });

    it('다른 댓글은 남기고 그 댓글만 지운다', async () => {
      const { me, other, post } = await writeSetup();
      const mine = await commentFor(me, post, '내 댓글', at(5));
      await commentFor(other, post, '남의 댓글', at(6));
      await commentFor(me, post, '내 다른 댓글', at(7));
      await repo.deleteComment(me.githubId, mine.commentId);
      expect((await rowsOf(post)).map((row) => row.content)).toEqual([
        '남의 댓글',
        '내 다른 댓글',
      ]);
    });

    // 옛 JPA의 cascade = ALL: 댓글을 지우면 답글(과 답글의 답글)도 함께 지워진다. 외래키가 막기 때문에 가장 깊은 층부터 지운다.
    it('답글과 답글의 답글까지 모두 함께 지운다(다른 사람이 쓴 답글도)', async () => {
      const { me, other, post } = await writeSetup();
      const top = await commentFor(me, post, '최상위', at(5));
      const reply1 = await commentFor(other, post, '답글1', at(6), {
        parentCommentId: top.commentId,
      });
      const reply2 = await commentFor(me, post, '답답글', at(7), {
        parentCommentId: reply1.commentId,
      });
      await commentFor(other, post, '답답답글', at(8), {
        parentCommentId: reply2.commentId,
      });
      await commentFor(other, post, '다른 답글', at(9), {
        parentCommentId: top.commentId,
      });
      const survivor = await commentFor(other, post, '무관한 최상위', at(10));

      expect(await repo.deleteComment(me.githubId, top.commentId)).toEqual({
        status: 'DELETED',
        postId: Number(post.postId),
      });
      expect((await rowsOf(post)).map((row) => row.commentId)).toEqual([
        survivor.commentId,
      ]);
    });

    it('답글을 지우면 부모와 형제는 남고 그 답글의 아래만 지워진다', async () => {
      const { me, other, post } = await writeSetup();
      const top = await commentFor(other, post, '최상위', at(5));
      const mine = await commentFor(me, post, '내 답글', at(6), {
        parentCommentId: top.commentId,
      });
      await commentFor(other, post, '내 답글의 답글', at(7), {
        parentCommentId: mine.commentId,
      });
      await commentFor(other, post, '형제 답글', at(8), {
        parentCommentId: top.commentId,
      });

      await repo.deleteComment(me.githubId, mine.commentId);

      expect((await rowsOf(post)).map((row) => row.content)).toEqual([
        '최상위',
        '형제 답글',
      ]);
    });

    it('다른 글의 댓글은 건드리지 않는다', async () => {
      const { me, other, post } = await writeSetup();
      const elsewhere = await createPost(other);
      const mine = await commentFor(me, post, '내 댓글', at(5));
      await commentFor(me, elsewhere, '다른 글의 내 댓글', at(6));
      await repo.deleteComment(me.githubId, mine.commentId);
      expect(await rowsOf(elsewhere)).toHaveLength(1);
    });

    // 남의 댓글에 대한 거부는 답글이 있어도 아무것도 지우지 않는다.
    it('남의 댓글을 지우려 하면 답글도 그대로다', async () => {
      const { me, other, post } = await writeSetup();
      const theirs = await commentFor(other, post, '남의 댓글', at(5));
      await commentFor(me, post, '내 답글', at(6), {
        parentCommentId: theirs.commentId,
      });
      await repo.deleteComment(me.githubId, theirs.commentId);
      expect(await rowsOf(post)).toHaveLength(2);
    });
  });
});
