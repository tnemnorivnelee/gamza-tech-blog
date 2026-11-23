import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import type { PageRequest } from '../../common/pageable.js';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import {
  databaseReachable as reachable,
  databaseUrl as url,
} from '../../../test/support/test-database.js';
import { LikeRepository } from './like.repository.js';

// 진짜 MySQL로 하는 시험이다(docs/m5-read-api-plan.md D5). 정렬, 쪽 나누기, 태그 묶기, 개수는 가짜로는 증명할 수 없다.
// 접속과 건너뛰기 판단은 test/support/test-database.ts가 한다.

// 시험이 만든 사용자의 githubId 접두사다. 다른 DB 시험의 접두사(g_test_, post_test_, intro_test_, user_q_test_, cmt_test_)와 겹치지 않는다.
const PREFIX = 'like_test_';
const TAG_PREFIX = 'like-test-tag-';

// 시험 데이터의 시각은 2099년이다. 복원한 실제 데이터(2026년까지)와 섞이지 않는다(사용자로 걸러 읽어서 어차피 섞이지 않지만 구분하기 쉽다).
const at = (seconds: number) => new Date(Date.UTC(2099, 0, 1, 0, 0, seconds));
const NOW = new Date(Date.UTC(2099, 0, 1));
const first = (page = 0, size = 10): PageRequest => ({ page, size });
const MISSING_POST_ID = 987654321012n;

describe.skipIf(!reachable)('LikeRepository (진짜 MySQL)', () => {
  let prisma: PrismaService;
  let repo: LikeRepository;

  beforeAll(() => {
    prisma = new PrismaService(
      new ConfigService<EnvironmentVariables, true>({ DATABASE_URL: url }),
    );
    repo = new LikeRepository(prisma);
  });

  // 자식 행부터 지운다(외래 키). 복원한 실제 데이터는 접두사로 걸러서 건드리지 않는다.
  afterEach(async () => {
    const mine = { githubId: { startsWith: PREFIX } };
    await prisma.like.deleteMany({
      where: { OR: [{ user: mine }, { post: { user: mine } }] },
    });
    await prisma.postImage.deleteMany({ where: { post: { user: mine } } });
    await prisma.postTag.deleteMany({ where: { post: { user: mine } } });
    await prisma.post.deleteMany({ where: { user: mine } });
    await prisma.tag.deleteMany({
      where: { tagName: { startsWith: TAG_PREFIX } },
    });
    await prisma.profileImage.deleteMany({ where: { user: mine } });
    await prisma.repository.deleteMany({ where: { user: mine } });
    await prisma.user.deleteMany({ where: mine });
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  // 시험마다 새 값을 쓴다. 서로 겹치지 않고 개발용 DB의 실제 데이터와도 겹치지 않는다.
  const newTag = (label = '') => `${TAG_PREFIX}${label}${randomUUID()}`;

  async function createUser(profileImageUrl?: string) {
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
    if (profileImageUrl)
      await prisma.profileImage.create({
        data: {
          profileImageUrl,
          userId: user.userId,
          createdAt: NOW,
          updatedAt: NOW,
        },
      });
    return { ...user, repositoryId: repository.repositoryId };
  }

  type Person = Awaited<ReturnType<typeof createUser>>;

  async function createPost(
    author: Person,
    {
      title = `제목-${randomUUID()}`,
      content = '본문',
      createdAt = at(1),
      tags = [],
      images = [],
    }: {
      title?: string;
      content?: string;
      createdAt?: Date;
      tags?: string[];
      images?: string[];
    } = {},
  ) {
    const post = await prisma.post.create({
      data: {
        title,
        content,
        createdAt,
        updatedAt: createdAt,
        userId: author.userId,
        repositoryId: author.repositoryId,
      },
    });
    // 태그는 차례대로 연결한다(post_tag_id가 오름차순이다). 같은 태그를 두 번 적으면 연결 행도 둘이 생긴다.
    // 이미지도 차례대로 올려 id가 오름차순이다.
    for (const tagName of tags) {
      const tag = await prisma.tag.upsert({
        where: { tagName },
        create: { tagName, createdAt: NOW, updatedAt: NOW },
        update: {},
      });
      await prisma.postTag.create({
        data: {
          postId: post.postId,
          tagId: tag.tagId,
          createdAt: NOW,
          updatedAt: NOW,
        },
      });
    }
    for (const imageUrl of images)
      await prisma.postImage.create({
        data: { imageUrl, postId: post.postId, createdAt: NOW, updatedAt: NOW },
      });
    return { ...post, title };
  }

  // 좋아요 행은 (사용자, 글)에 unique가 없어서 같은 쌍을 여러 번 만들 수 있다(개선 후보 33번).
  const likeFor = (
    user: { userId: bigint },
    post: { postId: bigint },
    createdAt: Date,
  ) =>
    prisma.like.create({
      data: {
        userId: user.userId,
        postId: post.postId,
        createdAt,
        updatedAt: createdAt,
      },
    });

  const titles = (page: { likes: { title: string }[] }) =>
    page.likes.map((like) => like.title);

  describe('findMyLikePage 정렬', () => {
    // 좋아요를 누른 시각, 글을 쓴 시각, 좋아요 번호의 순서가 모두 다르게 만든다. 어느 기준으로 바뀌어도 시험이 깨진다.
    it('좋아요를 누른 시각 내림차순이다(글을 쓴 시각도 좋아요 번호도 아니다)', async () => {
      const liker = await createUser();
      const author = await createUser();
      const p1 = await createPost(author, { title: 'p1', createdAt: at(1) });
      const p2 = await createPost(author, { title: 'p2', createdAt: at(2) });
      const p3 = await createPost(author, { title: 'p3', createdAt: at(3) });
      // 만든 순서(likeId 오름차순)는 p1(12초), p2(13초), p3(11초)이다.
      await likeFor(liker, p1, at(12));
      await likeFor(liker, p2, at(13));
      await likeFor(liker, p3, at(11));

      const page = await repo.findMyLikePage(liker.githubId, first());
      expect(titles(page)).toEqual(['p2', 'p1', 'p3']);
    });

    // 같은 시각의 마무리는 likeId 오름차순이다. 글 목록·소개·댓글의 id 내림차순 마무리와 반대다(옛 쿼리가 둘 다 적었다).
    it('같은 시각이면 likeId 오름차순이다(글 번호 순서가 아니다)', async () => {
      const liker = await createUser();
      const author = await createUser();
      const p1 = await createPost(author, { title: 'p1' });
      const p2 = await createPost(author, { title: 'p2' });
      const p3 = await createPost(author, { title: 'p3' });
      const p4 = await createPost(author, { title: 'p4' });
      // 같은 시각(5초)에 p3, p1, p2 순서로 누르고, 마지막에 더 늦은 시각(9초)의 p4를 누른다.
      await likeFor(liker, p3, at(5));
      await likeFor(liker, p1, at(5));
      await likeFor(liker, p2, at(5));
      await likeFor(liker, p4, at(9));

      const page = await repo.findMyLikePage(liker.githubId, first());
      expect(titles(page)).toEqual(['p4', 'p3', 'p1', 'p2']);
    });
  });

  describe('findMyLikePage 범위', () => {
    it('내 좋아요만 나오고 개수도 내 것만 센다', async () => {
      const me = await createUser();
      const other = await createUser();
      const author = await createUser();
      const p1 = await createPost(author, { title: 'p1' });
      const p2 = await createPost(author, { title: 'p2' });
      const p3 = await createPost(author, { title: 'p3' });
      await likeFor(other, p1, at(20));
      await likeFor(other, p2, at(21));
      await likeFor(me, p3, at(5));

      const page = await repo.findMyLikePage(me.githubId, first());
      expect(titles(page)).toEqual(['p3']);
      expect(page.totalElements).toBe(1);
    });

    it('좋아요가 없으면 빈 목록과 0이다', async () => {
      const me = await createUser();
      const page = await repo.findMyLikePage(me.githubId, first());
      expect(page).toEqual({ likes: [], totalElements: 0 });
    });

    it('같은 글에 같은 사용자의 좋아요 행이 둘이면 둘 다 나오고 개수도 둘이다', async () => {
      const me = await createUser();
      const author = await createUser();
      const post = await createPost(author, { title: 'p' });
      await likeFor(me, post, at(5));
      await likeFor(me, post, at(6));

      const page = await repo.findMyLikePage(me.githubId, first());
      expect(titles(page)).toEqual(['p', 'p']);
      expect(page.totalElements).toBe(2);
    });
  });

  describe('findMyLikePage 쪽 나누기', () => {
    // 다섯 좋아요가 모두 같은 시각이라 순서는 likeId 오름차순(q1부터 q5)이다.
    async function createFiveLikes() {
      const me = await createUser();
      const author = await createUser();
      for (const n of [1, 2, 3, 4, 5]) {
        const post = await createPost(author, { title: `q${n}` });
        await likeFor(me, post, at(5));
      }
      return me;
    }

    it('크기 2로 나누면 2, 2, 1개이고 이어 붙이면 전체 순서와 같다', async () => {
      const me = await createFiveLikes();
      const pages = await Promise.all(
        [0, 1, 2].map((page) =>
          repo.findMyLikePage(me.githubId, first(page, 2)),
        ),
      );
      expect(pages.map(titles)).toEqual([['q1', 'q2'], ['q3', 'q4'], ['q5']]);
      expect(pages.map((page) => page.totalElements)).toEqual([5, 5, 5]);
    });

    // 글 목록은 빈 쪽이면 0을 돌려주지만(옛 PageImpl(List.of(), pageable, 0)) 좋아요 목록은 개수를 항상 센다.
    it('범위를 넘긴 쪽은 비어 있어도 실제 전체 개수를 준다', async () => {
      const me = await createFiveLikes();
      const page = await repo.findMyLikePage(me.githubId, first(99, 2));
      expect(page).toEqual({ likes: [], totalElements: 5 });
    });
  });

  describe('findMyLikePage 값', () => {
    it('좋아요 번호, 글 번호, 제목, 본문, 좋아요를 누른 시각을 준다(글을 쓴 시각이 아니다)', async () => {
      const me = await createUser();
      const author = await createUser();
      const post = await createPost(author, {
        title: '제목',
        content: '본문 내용',
        createdAt: at(100),
      });
      const like = await likeFor(me, post, at(7));

      const [row] = (await repo.findMyLikePage(me.githubId, first())).likes;
      expect(row).toMatchObject({
        likeId: Number(like.likeId),
        postId: Number(post.postId),
        title: '제목',
        content: '본문 내용',
        createdAt: at(7),
      });
    });

    it('글쓴이의 닉네임과 프로필 이미지를 준다(좋아요를 누른 사람의 것이 아니다)', async () => {
      const me = await createUser('https://img.test/me.png');
      const author = await createUser('https://img.test/author.png');
      await likeFor(me, await createPost(author), at(5));

      const [row] = (await repo.findMyLikePage(me.githubId, first())).likes;
      expect(row.writer).toBe(author.nickname);
      expect(row.writerProfileImageUrl).toBe('https://img.test/author.png');
    });

    it('글쓴이의 프로필 이미지가 없으면 null이다', async () => {
      const me = await createUser('https://img.test/me.png');
      const author = await createUser();
      await likeFor(me, await createPost(author), at(5));

      const [row] = (await repo.findMyLikePage(me.githubId, first())).likes;
      expect(row.writerProfileImageUrl).toBeNull();
    });

    // 올린 순서(z, a)와 주소의 글자 순서(a, z)가 다르다. 가장 먼저 올린 이미지(id가 가장 작은 것)가 썸네일이다.
    it('썸네일은 가장 먼저 올린 이미지이고, 이미지가 없으면 null이다', async () => {
      const me = await createUser();
      const author = await createUser();
      const withImages = await createPost(author, {
        title: 'img',
        images: ['https://img.test/z.png', 'https://img.test/a.png'],
      });
      const without = await createPost(author, { title: 'none' });
      await likeFor(me, withImages, at(6));
      await likeFor(me, without, at(5));

      const { likes } = await repo.findMyLikePage(me.githubId, first());
      expect(likes.map((like) => like.thumbnailImageUrl)).toEqual([
        'https://img.test/z.png',
        null,
      ]);
    });
  });

  describe('findMyLikePage 태그', () => {
    // 태그 이름의 글자 순서(a, z)와 붙인 순서(z, a)가 다르다. 붙인 순서로 나온다.
    it('글에 붙인 순서대로 준다', async () => {
      const me = await createUser();
      const author = await createUser();
      const z = newTag('z-');
      const a = newTag('a-');
      await likeFor(me, await createPost(author, { tags: [z, a] }), at(5));

      const [row] = (await repo.findMyLikePage(me.githubId, first())).likes;
      expect(row.tags).toEqual([z, a]);
    });

    // 글 목록과 달리 같은 이름은 한 번만 나온다(옛 코드가 tags를 distinct()로 만든다).
    it('같은 태그가 두 번 붙은 글도 한 번만 나온다', async () => {
      const me = await createUser();
      const author = await createUser();
      const a = newTag('a-');
      const b = newTag('b-');
      await likeFor(me, await createPost(author, { tags: [a, a, b] }), at(5));

      const [row] = (await repo.findMyLikePage(me.githubId, first())).likes;
      expect(row.tags).toEqual([a, b]);
    });

    // 옛 코드가 왼쪽 조인의 null을 걸러내지 않아서 생기는 결과다(docs/m5-read-api-plan.md 3.9). 옛 동작 그대로 옮긴다.
    it('태그가 없는 글은 빈 목록이 아니라 [null]이다', async () => {
      const me = await createUser();
      const author = await createUser();
      await likeFor(me, await createPost(author), at(5));

      const [row] = (await repo.findMyLikePage(me.githubId, first())).likes;
      expect(row.tags).toEqual([null]);
    });

    it('좋아요마다 그 글의 태그만 나온다', async () => {
      const me = await createUser();
      const author = await createUser();
      const x = newTag('x-');
      const y = newTag('y-');
      await likeFor(
        me,
        await createPost(author, { title: 'px', tags: [x] }),
        at(6),
      );
      await likeFor(
        me,
        await createPost(author, { title: 'py', tags: [y] }),
        at(5),
      );

      const { likes } = await repo.findMyLikePage(me.githubId, first());
      expect(likes.map((like) => [like.title, like.tags])).toEqual([
        ['px', [x]],
        ['py', [y]],
      ]);
    });
  });

  describe('isPostLikedBy', () => {
    it('글이 없으면 null이다', async () => {
      const me = await createUser();
      expect(await repo.isPostLikedBy(me.githubId, MISSING_POST_ID)).toBeNull();
    });

    it('좋아요를 안 눌렀으면 false다', async () => {
      const me = await createUser();
      const post = await createPost(await createUser());
      expect(await repo.isPostLikedBy(me.githubId, post.postId)).toBe(false);
    });

    it('좋아요를 눌렀으면 true다', async () => {
      const me = await createUser();
      const post = await createPost(await createUser());
      await likeFor(me, post, at(5));
      expect(await repo.isPostLikedBy(me.githubId, post.postId)).toBe(true);
    });

    it('다른 사용자의 좋아요는 세지 않는다', async () => {
      const me = await createUser();
      const other = await createUser();
      const post = await createPost(await createUser());
      await likeFor(other, post, at(5));
      expect(await repo.isPostLikedBy(me.githubId, post.postId)).toBe(false);
    });

    it('다른 글에 누른 좋아요는 세지 않는다', async () => {
      const me = await createUser();
      const author = await createUser();
      const liked = await createPost(author);
      const notLiked = await createPost(author);
      await likeFor(me, liked, at(5));
      expect(await repo.isPostLikedBy(me.githubId, notLiked.postId)).toBe(
        false,
      );
    });

    it('같은 글에 좋아요 행이 여럿이어도 true다', async () => {
      const me = await createUser();
      const post = await createPost(await createUser());
      await likeFor(me, post, at(5));
      await likeFor(me, post, at(6));
      expect(await repo.isPostLikedBy(me.githubId, post.postId)).toBe(true);
    });
  });
});
