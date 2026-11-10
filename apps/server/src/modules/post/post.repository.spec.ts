import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { loadEnv } from 'vite';
import type { PageRequest } from '../../common/pageable.js';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { PrismaClient } from '../../infra/prisma/generated/client.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { PostRepository } from './post.repository.js';

// 진짜 MySQL로 하는 시험이다(docs/m5-read-api-plan.md D5). 태그 필터의 OR, 검색의 와일드카드, 정렬, 개수는 가짜로는 증명할 수 없다.
// 접속 방식은 prisma-user.repository.spec.ts와 같다: CI는 환경변수로, 로컬에서는 apps/server/.env에서 이 시험만 직접 읽는다.
const url =
  process.env.DATABASE_URL ||
  loadEnv('test', process.cwd(), 'DATABASE_').DATABASE_URL;

async function canConnect(): Promise<boolean> {
  if (!url) return false;
  const probeUrl = new URL(url);
  probeUrl.searchParams.set('acquireTimeout', '2000');
  const probe = new PrismaClient({
    adapter: new PrismaMariaDb(probeUrl.toString()),
  });
  try {
    await probe.$queryRaw`SELECT 1 FROM posts LIMIT 1`;
    return true;
  } catch {
    return false;
  } finally {
    await probe.$disconnect();
  }
}

const reachable = await canConnect();
if (!reachable && process.env.CI) {
  throw new Error(
    'CI인데 DB에 연결할 수 없거나 posts 테이블이 없습니다. .github/workflows/ci.yml의 services.mysql과 migrate deploy 단계를 확인하세요.',
  );
}

// 시험이 만든 사용자의 githubId 접두사다. 실제 회원은 g_<숫자>이고, prisma-user.repository.spec.ts의 g_test_와도 겹치지 않게 했다.
// 파일은 병렬로 돌기 때문에, g_test_로 시작하면 저쪽 afterEach가 이쪽 사용자를 지우다 외래 키 오류를 낸다.
const PREFIX = 'post_test_';
const TAG_PREFIX = 'test-tag-';

// 시험 글의 작성 시각은 2099년이다. 복원한 실제 글(2026년까지)보다 늦어서 전체 목록에서도 맨 앞에 온다.
// DB에는 이 Date의 UTC 필드가 그대로 벽시계 값으로 저장된다.
const at = (seconds: number) => new Date(Date.UTC(2099, 0, 1, 0, 0, seconds));
const NOW = new Date(Date.UTC(2099, 0, 1));
const first = (page = 0, size = 10): PageRequest => ({ page, size });

describe.skipIf(!reachable)('PostRepository (진짜 MySQL)', () => {
  let prisma: PrismaService;
  let repo: PostRepository;

  beforeAll(() => {
    prisma = new PrismaService(
      new ConfigService<EnvironmentVariables, true>({ DATABASE_URL: url }),
    );
    repo = new PostRepository(prisma);
  });

  // 자식 행부터 지운다(외래 키). 복원한 실제 데이터는 접두사로 걸러서 건드리지 않는다.
  afterEach(async () => {
    const mine = { githubId: { startsWith: PREFIX } };
    const ofMine = { post: { user: mine } };
    await prisma.like.deleteMany({ where: ofMine });
    await prisma.comment.deleteMany({ where: ofMine });
    await prisma.postImage.deleteMany({ where: ofMine });
    await prisma.postTag.deleteMany({ where: ofMine });
    await prisma.commitHistory.deleteMany({ where: ofMine });
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
        nickname: `nick-${id}`,
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

  type Author = Awaited<ReturnType<typeof createUser>>;

  async function createPost(
    author: Author,
    {
      title = `제목-${randomUUID()}`,
      content = '본문',
      createdAt,
      tags = [],
      images = [],
    }: {
      title?: string;
      content?: string;
      createdAt: Date;
      tags?: string[];
      images?: string[];
    },
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
    // 태그는 차례대로 연결한다(post_tag_id가 오름차순이다). 이미지도 차례대로 올려 id가 오름차순이다.
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

  const titles = (page: { posts: { title: string }[] }) =>
    page.posts.map((post) => post.title);

  describe('findAllPosts', () => {
    it('작성 시각 내림차순이고, 필터가 없는 전체 목록에서도 가장 늦은 글이 맨 앞이다', async () => {
      const author = await createUser();
      await createPost(author, { title: 'old', createdAt: at(1) });
      await createPost(author, { title: 'new', createdAt: at(3) });
      await createPost(author, { title: 'mid', createdAt: at(2) });

      const page = await repo.findAllPosts(first(0, 3), []);
      expect(titles(page)).toEqual(['new', 'mid', 'old']);
      // 복원한 실제 글이 함께 세어진다. 정확한 개수는 모르고 최소한 시험 글 3개는 있다.
      expect(page.totalElements).toBeGreaterThanOrEqual(3);
    });

    it('작성 시각이 같으면 postId가 큰 쪽이 먼저다(쪽을 넘겨도 순서가 흔들리지 않는다)', async () => {
      const author = await createUser();
      const tag = newTag();
      const a = await createPost(author, {
        title: 'a',
        createdAt: at(1),
        tags: [tag],
      });
      const b = await createPost(author, {
        title: 'b',
        createdAt: at(1),
        tags: [tag],
      });
      expect(b.postId).toBeGreaterThan(a.postId);

      expect(titles(await repo.findAllPosts(first(), [tag]))).toEqual([
        'b',
        'a',
      ]);
      expect(titles(await repo.findAllPosts(first(0, 1), [tag]))).toEqual([
        'b',
      ]);
      expect(titles(await repo.findAllPosts(first(1, 1), [tag]))).toEqual([
        'a',
      ]);
    });

    describe('태그 필터', () => {
      it('하나라도 가진 글(OR)을 중복 없이 센다', async () => {
        const author = await createUser();
        const [a, b] = [newTag('a-'), newTag('b-')];
        await createPost(author, {
          title: 'onlyA',
          createdAt: at(1),
          tags: [a],
        });
        await createPost(author, {
          title: 'onlyB',
          createdAt: at(2),
          tags: [b],
        });
        await createPost(author, {
          title: 'both',
          createdAt: at(3),
          tags: [a, b],
        });
        await createPost(author, { title: 'none', createdAt: at(4) });

        const onlyA = await repo.findAllPosts(first(), [a]);
        expect(titles(onlyA)).toEqual(['both', 'onlyA']);
        expect(onlyA.totalElements).toBe(2);

        // both는 두 태그에 모두 걸리지만 한 번만 나오고 한 번만 센다.
        const either = await repo.findAllPosts(first(), [a, b]);
        expect(titles(either)).toEqual(['both', 'onlyB', 'onlyA']);
        expect(either.totalElements).toBe(3);
      });

      it('결과의 tags는 필터와 상관없이 그 글의 모든 태그이고, 연결한 순서다', async () => {
        const author = await createUser();
        const [a, b, c] = [newTag('a-'), newTag('b-'), newTag('c-')];
        await createPost(author, { createdAt: at(1), tags: [b, a, c] });

        const page = await repo.findAllPosts(first(), [a]);
        expect(page.posts[0].tags).toEqual([b, a, c]);
      });

      it('한글 태그도 찾는다', async () => {
        const author = await createUser();
        const tag = newTag('백엔드-');
        await createPost(author, { title: 't', createdAt: at(1), tags: [tag] });
        expect(titles(await repo.findAllPosts(first(), [tag]))).toEqual(['t']);
      });

      it('없는 태그는 빈 쪽이고 개수는 0이다', async () => {
        const page = await repo.findAllPosts(first(), [newTag('none-')]);
        expect(page).toEqual({ posts: [], totalElements: 0 });
      });
    });

    describe('쪽 나누기', () => {
      it('쪽마다 size개씩 나오고 totalElements는 조건에 맞는 전체 개수다', async () => {
        const author = await createUser();
        const tag = newTag();
        for (const n of [1, 2, 3, 4, 5])
          await createPost(author, {
            title: `p${n}`,
            createdAt: at(n),
            tags: [tag],
          });

        const p0 = await repo.findAllPosts(first(0, 2), [tag]);
        const p1 = await repo.findAllPosts(first(1, 2), [tag]);
        const p2 = await repo.findAllPosts(first(2, 2), [tag]);
        expect([titles(p0), titles(p1), titles(p2)]).toEqual([
          ['p5', 'p4'],
          ['p3', 'p2'],
          ['p1'],
        ]);
        expect([p0, p1, p2].map((p) => p.totalElements)).toEqual([5, 5, 5]);
      });

      // 옛 fetchPosts는 id 조회가 비면 개수를 세지 않고 0을 돌려준다(PageImpl(List.of(), pageable, 0)).
      it('범위를 넘긴 쪽은 글이 있어도 totalElements가 0이다(옛 동작)', async () => {
        const author = await createUser();
        const tag = newTag();
        await createPost(author, { createdAt: at(1), tags: [tag] });
        await createPost(author, { createdAt: at(2), tags: [tag] });

        expect(await repo.findAllPosts(first(1, 2), [tag])).toEqual({
          posts: [],
          totalElements: 0,
        });
      });

      it('아주 큰 page도 오류 없이 빈 쪽이다', async () => {
        const page = await repo.findAllPosts(first(2147483647, 2000), []);
        expect(page).toEqual({ posts: [], totalElements: 0 });
      });
    });

    describe('한 줄의 내용', () => {
      it('작성자 닉네임과 프로필 이미지, 작성 시각, 본문 전체를 준다', async () => {
        const author = await createUser('https://img.test/profile.png');
        const tag = newTag();
        await createPost(author, {
          title: '제목',
          content: '본문 전체',
          createdAt: at(7),
          tags: [tag],
        });

        const [post] = (await repo.findAllPosts(first(), [tag])).posts;
        expect(post).toEqual({
          postId: expect.any(Number),
          title: '제목',
          content: '본문 전체',
          writer: author.nickname,
          writerProfileImageUrl: 'https://img.test/profile.png',
          // DB에 적힌 벽시계 값이 Date의 UTC 필드로 그대로 나온다.
          createdAt: at(7),
          tags: [tag],
          thumbnailImageUrl: null,
        });
      });

      it('프로필 이미지가 없으면 null이다(키가 빠지지 않는다)', async () => {
        const author = await createUser();
        const tag = newTag();
        await createPost(author, { createdAt: at(1), tags: [tag] });
        const [post] = (await repo.findAllPosts(first(), [tag])).posts;
        expect(post.writerProfileImageUrl).toBeNull();
      });

      it('태그도 이미지도 없는 글은 tags가 빈 목록이고 썸네일이 null이다', async () => {
        const author = await createUser();
        const title = `제목-${randomUUID()}`;
        await createPost(author, { title, createdAt: at(1) });
        const [post] = (await repo.searchPostsByTitle(first(), title)).posts;
        expect(post.tags).toEqual([]);
        expect(post.thumbnailImageUrl).toBeNull();
      });

      // 이름순이나 주소순이 아니라 id가 가장 작은 것(맨 처음 올린 것)이다. b를 먼저 올렸다.
      it('썸네일은 이미지 중 id가 가장 작은 것이다', async () => {
        const author = await createUser();
        const tag = newTag();
        await createPost(author, {
          createdAt: at(1),
          tags: [tag],
          images: ['https://img.test/b.png', 'https://img.test/a.png'],
        });
        const [post] = (await repo.findAllPosts(first(), [tag])).posts;
        expect(post.thumbnailImageUrl).toBe('https://img.test/b.png');
      });
    });
  });

  describe('searchPostsByTitle', () => {
    // 제목에 시험마다 다른 key를 넣고 검색어도 key를 포함해서, 복원한 실제 글이 섞이지 않게 한다.
    // search는 key 뒤에 붙는 부분만 받아서, 찾은 글의 제목 중 key 뒤 부분을 돌려준다.
    const setup = async (...endings: string[]) => {
      const key = randomUUID();
      const author = await createUser();
      for (const [i, ending] of endings.entries())
        await createPost(author, {
          title: `${key}${ending}`,
          createdAt: at(i + 1),
        });
      const search = async (keyword: string, page = first()) => {
        const result = await repo.searchPostsByTitle(page, `${key}${keyword}`);
        return {
          found: result.posts.map((post) => post.title.slice(key.length)),
          totalElements: result.totalElements,
        };
      };
      return { key, author, search };
    };

    it('제목에 포함되어 있으면 찾는다(앞, 가운데, 뒤 어디든)', async () => {
      const key = randomUUID();
      const author = await createUser();
      await createPost(author, { title: `앞${key}뒤`, createdAt: at(1) });
      expect(titles(await repo.searchPostsByTitle(first(), key))).toEqual([
        `앞${key}뒤`,
      ]);
      expect(
        titles(await repo.searchPostsByTitle(first(), `앞${key}`)),
      ).toHaveLength(1);
      expect(
        titles(await repo.searchPostsByTitle(first(), `${key}뒤`)),
      ).toHaveLength(1);
    });

    it('대소문자를 구분하지 않는다', async () => {
      const { search } = await setup(' Spring Boot');
      expect((await search(' spring boot')).found).toEqual([' Spring Boot']);
      expect((await search(' SPRING BOOT')).found).toEqual([' Spring Boot']);
    });

    it('한글도 찾는다', async () => {
      const { search } = await setup(' 스프링 부트');
      expect((await search(' 스프링')).found).toEqual([' 스프링 부트']);
    });

    it('본문에만 있는 단어는 찾지 않는다(제목만 본다)', async () => {
      const key = randomUUID();
      const author = await createUser();
      await createPost(author, {
        title: '제목',
        content: `본문에 ${key} 가 있다`,
        createdAt: at(1),
      });
      expect((await repo.searchPostsByTitle(first(), key)).posts).toEqual([]);
    });

    // 옛 containsIgnoreCase는 와일드카드(%, _)와 이스케이프 문자(\)를 글자 그대로 취급했다.
    describe('와일드카드와 특수 문자는 글자 그대로다', () => {
      it('%', async () => {
        const { search } = await setup(' 100% 일치', ' 100X 일치');
        expect((await search(' 100%')).found).toEqual([' 100% 일치']);
      });

      it('_', async () => {
        const { search } = await setup('_x', 'Ax');
        expect((await search('_x')).found).toEqual(['_x']);
      });

      it('\\', async () => {
        const { search } = await setup(' a\\b', ' ab');
        expect((await search(' a\\b')).found).toEqual([' a\\b']);
      });

      it('따옴표와 SQL 조각은 값으로만 쓰이고 오류 없이 빈 결과다', async () => {
        const { search } = await setup(' 평범한 제목');
        expect((await search("'; DROP TABLE posts; --")).found).toEqual([]);
        expect(await prisma.post.count()).toBeGreaterThan(0);
      });
    });

    it('최신순이고 totalElements는 일치하는 전체 개수다', async () => {
      const { search } = await setup(' a', ' b', ' c');
      expect(await search(' ')).toEqual({
        found: [' c', ' b', ' a'],
        totalElements: 3,
      });
      expect(await search(' ', first(1, 2))).toEqual({
        found: [' a'],
        totalElements: 3,
      });
    });

    it('일치하는 글이 없으면 빈 쪽이고 개수는 0이다', async () => {
      const { search } = await setup(' a');
      expect(await search(' 없는 제목')).toEqual({
        found: [],
        totalElements: 0,
      });
    });
  });

  describe('findPostsByWriter', () => {
    it('그 작성자의 글만 최신순으로 준다', async () => {
      const [mine, other] = [await createUser(), await createUser()];
      await createPost(mine, { title: 'm1', createdAt: at(1) });
      await createPost(other, { title: 'o1', createdAt: at(2) });
      await createPost(mine, { title: 'm2', createdAt: at(3) });

      const page = await repo.findPostsByWriter(first(), mine.githubId);
      expect(titles(page)).toEqual(['m2', 'm1']);
      expect(page.totalElements).toBe(2);
      expect(
        titles(await repo.findPostsByWriter(first(), other.githubId)),
      ).toEqual(['o1']);
    });

    it('글이 없거나 없는 사용자면 빈 쪽이다', async () => {
      const lonely = await createUser();
      const empty = { posts: [], totalElements: 0 };
      expect(await repo.findPostsByWriter(first(), lonely.githubId)).toEqual(
        empty,
      );
      expect(await repo.findPostsByWriter(first(), `${PREFIX}없음`)).toEqual(
        empty,
      );
    });
  });
});
