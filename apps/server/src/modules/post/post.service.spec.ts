import { ErrorCode } from '../../common/error/error-code.js';
import { createReadCache } from '../../../test/support/fake-redis.js';
import { TagService } from '../tag/tag.service.js';
import type { TagRepository } from '../tag/tag.repository.js';
import type {
  PopularPost,
  PostDetail,
  PostPage,
  PostRepository,
  PostSummary,
} from './post.repository.js';
import { PostService } from './post.service.js';

const summary = (overrides: Partial<PostSummary> = {}): PostSummary => ({
  postId: 7,
  title: '제목',
  content: '본문',
  writer: '감자',
  writerProfileImageUrl: null,
  createdAt: new Date('2025-07-27T21:08:37.109Z'),
  tags: ['nest'],
  thumbnailImageUrl: null,
  ...overrides,
});

const detail = (overrides: Partial<PostDetail> = {}): PostDetail => ({
  postId: 7,
  title: '제목',
  content: '본문 ![x](https://img.test/x.png)',
  writer: '감자',
  writerProfileImageUrl: null,
  githubId: 'octo',
  likesCount: 3,
  createdAt: new Date('2025-07-27T21:08:37.109Z'),
  updatedAt: new Date('2025-07-28T09:00:00.000Z'),
  tags: ['nest', 'prisma'],
  comments: [],
  ...overrides,
});

const popular = (postId: number): PopularPost => ({
  postId,
  title: `인기${postId}`,
  writer: '감자',
  writerProfileImageUrl: null,
});

function setup(page: PostPage = { posts: [summary()], totalElements: 1 }) {
  const repo = {
    findAllPosts: vi.fn().mockResolvedValue(page),
    searchPostsByTitle: vi.fn().mockResolvedValue(page),
    findPostsByWriter: vi.fn().mockResolvedValue(page),
    findPostDetail: vi.fn().mockResolvedValue(detail()),
    findWeeklyPopularPosts: vi.fn().mockResolvedValue([popular(1)]),
  };
  const tags = { getAllTags: vi.fn().mockResolvedValue(['nest', 'prisma']) };
  // 캐시는 가짜 Redis 위의 진짜 ReadCache다. 시험마다 새로 만들어서 앞 시험의 캐시가 남지 않는다.
  const { redis, cache } = createReadCache();
  return {
    repo,
    tags,
    redis,
    cache,
    service: new PostService(
      repo as unknown as PostRepository,
      tags as unknown as TagService,
      cache,
    ),
  };
}

describe('PostService', () => {
  it('저장소가 준 값을 응답 모양으로 바꾼다(날짜는 문자열, 값이 없는 이미지 주소는 null)', async () => {
    const { service } = setup();
    const response = await service.getPosts({ page: 0, size: 10 }, []);
    expect(response.content).toEqual([
      {
        postId: 7,
        title: '제목',
        contentSnippet: '본문',
        writer: '감자',
        writerProfileImageUrl: null,
        createdAt: '2025-07-27T21:08:37.109',
        tags: ['nest'],
        thumbnailImageUrl: null,
      },
    ]);
  });

  it('값이 있는 이미지 주소는 그대로 싣는다', async () => {
    const { service } = setup({
      posts: [
        summary({
          writerProfileImageUrl: 'https://img.test/p.png',
          thumbnailImageUrl: 'https://img.test/t.png',
        }),
      ],
      totalElements: 1,
    });
    const [post] = (await service.getPosts({ page: 0, size: 10 }, [])).content;
    expect(post.writerProfileImageUrl).toBe('https://img.test/p.png');
    expect(post.thumbnailImageUrl).toBe('https://img.test/t.png');
  });

  describe('쪽 정보', () => {
    it.each([
      [0, 10, 0], // 개수가 0이면 총 쪽수도 0이다
      [1, 10, 1],
      [10, 10, 1],
      [11, 10, 2],
      [58, 10, 6],
      [58, 20, 3],
      [4000, 2000, 2],
    ])(
      'totalElements %i, size %i → totalPages %i',
      async (total, size, pages) => {
        const { service } = setup({ posts: [], totalElements: total });
        const response = await service.getPosts({ page: 3, size }, []);
        expect(response).toMatchObject({
          page: 3,
          size,
          totalElements: total,
          totalPages: pages,
        });
      },
    );

    // size는 요청에서 고친 값이다. 내용이 size보다 적게 와도 줄어들지 않는다.
    it('page와 size는 요청에서 고친 값 그대로이고 내용의 개수가 아니다', async () => {
      const { service } = setup({ posts: [summary()], totalElements: 1 });
      const response = await service.getPosts({ page: 0, size: 50 }, []);
      expect(response.content).toHaveLength(1);
      expect(response.size).toBe(50);
    });
  });

  describe('저장소에 넘기는 값', () => {
    const page = { page: 2, size: 5 };

    it('getPosts는 태그 목록을 그대로 넘긴다', async () => {
      const { service, repo } = setup();
      await service.getPosts(page, ['a', 'b']);
      expect(repo.findAllPosts).toHaveBeenCalledWith(page, ['a', 'b']);
    });

    it('getPostsByTag는 태그 하나짜리 목록으로 같은 조회를 한다', async () => {
      const { service, repo } = setup();
      await service.getPostsByTag('백엔드', page);
      expect(repo.findAllPosts).toHaveBeenCalledWith(page, ['백엔드']);
    });

    it('searchPostsByTitle은 검색어를 그대로 넘긴다', async () => {
      const { service, repo } = setup();
      await service.searchPostsByTitle(page, ' Nest ');
      expect(repo.searchPostsByTitle).toHaveBeenCalledWith(page, ' Nest ');
    });

    it('getMyPosts는 작성자의 githubId를 넘긴다', async () => {
      const { service, repo } = setup();
      await service.getMyPosts('octo', page);
      expect(repo.findPostsByWriter).toHaveBeenCalledWith(page, 'octo');
    });
  });

  describe('getPostDetail', () => {
    it('저장소가 준 값을 응답 모양으로 바꾼다(날짜는 문자열, 본문은 그대로, 댓글은 트리)', async () => {
      const { service, repo } = setup();
      repo.findPostDetail.mockResolvedValue(
        detail({
          comments: [
            {
              commentId: 12,
              parentCommentId: 11,
              writer: '답글러',
              writerProfileImageUrl: null,
              content: '답글',
              createdAt: new Date('2025-07-27T22:00:00.000Z'),
            },
            {
              commentId: 11,
              parentCommentId: null,
              writer: '댓글러',
              writerProfileImageUrl: 'https://img.test/c.png',
              content: '댓글',
              createdAt: new Date('2025-07-27T21:30:00.000Z'),
            },
          ],
        }),
      );

      expect(await service.getPostDetail(7n)).toEqual({
        postId: 7,
        title: '제목',
        content: '본문 ![x](https://img.test/x.png)',
        writer: '감자',
        writerProfileImageUrl: null,
        likesCount: 3,
        githubId: 'octo',
        createdAt: '2025-07-27T21:08:37.109',
        updatedAt: '2025-07-28T09:00:00',
        tags: ['nest', 'prisma'],
        comments: [
          {
            commentId: 11,
            writer: '댓글러',
            writerProfileImageUrl: 'https://img.test/c.png',
            content: '댓글',
            createdAt: '2025-07-27T21:30:00',
            replies: [
              {
                commentId: 12,
                writer: '답글러',
                writerProfileImageUrl: null,
                content: '답글',
                createdAt: '2025-07-27T22:00:00',
                replies: [],
              },
            ],
          },
        ],
      });
      expect(repo.findPostDetail).toHaveBeenCalledWith(7n);
    });

    it('글이 없으면 404 P001이다', async () => {
      const { service, repo } = setup();
      repo.findPostDetail.mockResolvedValue(null);
      await expect(service.getPostDetail(7n)).rejects.toMatchObject({
        errorCode: ErrorCode.POST_NOT_FOUND,
      });
    });
  });

  describe('getWeeklyPopularPosts', () => {
    afterEach(() => vi.useRealTimers());

    // 기준 시각은 "서울 벽시계의 지금 - 7일"이다(DB에 서울 벽시계 값이 들어 있다). 코드의 +9시간 상수를 쓰지 않고
    // Intl로 따로 구한 서울 시각과 비교한다. 상수나 7일이 틀리면 여기서 잡힌다.
    const seoulWallClock = (instant: Date) =>
      new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Asia/Seoul',
        dateStyle: 'short',
        timeStyle: 'medium',
      }).format(instant);

    it('서울 시각 기준 1주 전보다 늦은 글 3개를 요청하고 저장소의 결과를 그대로 준다', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-11-11T07:00:00Z')); // 서울 2026-11-11 16:00
      const { service, repo } = setup();
      repo.findWeeklyPopularPosts.mockResolvedValue([popular(3), popular(1)]);

      expect(await service.getWeeklyPopularPosts()).toEqual([
        popular(3),
        popular(1),
      ]);
      const [since, limit] = repo.findWeeklyPopularPosts.mock.calls[0];
      // Date의 UTC 필드가 DB에 적힐 서울 벽시계 값이다.
      expect(since.toISOString().slice(0, 19).replace('T', ' ')).toBe(
        seoulWallClock(new Date('2026-11-04T07:00:00Z')),
      );
      expect(since.toISOString()).toBe('2026-11-04T16:00:00.000Z');
      expect(limit).toBe(3);
    });
  });

  describe('getHomeFeed', () => {
    it('인기 글, 최신 글 한 쪽, 전체 태그를 한 응답으로 묶는다', async () => {
      const { service, repo, tags } = setup({
        posts: [summary()],
        totalElements: 25,
      });
      repo.findWeeklyPopularPosts.mockResolvedValue([popular(2)]);

      const feed = await service.getHomeFeed({ page: 1, size: 10 }, ['nest']);
      expect(feed).toEqual({
        weeklyPopular: [popular(2)],
        latest: {
          content: [expect.objectContaining({ postId: 7 })],
          page: 1,
          size: 10,
          totalElements: 25,
          totalPages: 3,
        },
        allTags: ['nest', 'prisma'],
      });
      expect(repo.findAllPosts).toHaveBeenCalledWith({ page: 1, size: 10 }, [
        'nest',
      ]);
      expect(tags.getAllTags).toHaveBeenCalledTimes(1);
    });

    it('최신 글이 없어도 인기 글과 태그는 나간다(빈 쪽은 개수 0)', async () => {
      const { service } = setup({ posts: [], totalElements: 0 });
      const feed = await service.getHomeFeed({ page: 5, size: 10 }, []);
      expect(feed.latest).toMatchObject({
        content: [],
        page: 5,
        totalElements: 0,
        totalPages: 0,
      });
      expect(feed.weeklyPopular).toHaveLength(1);
      expect(feed.allTags).toEqual(['nest', 'prisma']);
    });
  });

  // 옛 @Cacheable과 같은지 본다: 캐시 이름·키·만료, 빈 쪽을 저장하지 않는 unless, 그리고 캐시를 거치지 않는 안쪽 조회.
  // 적중한 값은 JSON을 거쳐 돌아오므로, 두 번째 호출이 첫 호출과 같은 값인지도 같이 본다.
  describe('읽기 캐시', () => {
    const first = { page: 0, size: 10 };
    const empty: PostPage = { posts: [], totalElements: 0 };

    type Repo = ReturnType<typeof setup>['repo'];
    const lists = [
      [
        'getPosts',
        'postsList',
        '0-10-all',
        (s: PostService) => s.getPosts(first, []),
        'findAllPosts',
      ],
      [
        'getPosts(태그)',
        'postsList',
        '0-10-[nest, prisma]',
        (s: PostService) => s.getPosts(first, ['nest', 'prisma']),
        'findAllPosts',
      ],
      [
        'getPostsByTag',
        'postsByTag',
        '백엔드-0-10',
        (s: PostService) => s.getPostsByTag('백엔드', first),
        'findAllPosts',
      ],
      [
        'searchPostsByTitle',
        'searchPosts',
        'Nest-0-10',
        (s: PostService) => s.searchPostsByTitle(first, 'Nest'),
        'searchPostsByTitle',
      ],
      [
        'getMyPosts',
        'myPosts',
        'octo-0-10',
        (s: PostService) => s.getMyPosts('octo', first),
        'findPostsByWriter',
      ],
    ] as const;

    describe.each(lists)('%s', (_name, cacheName, key, call, repoMethod) => {
      const redisKey = `cache:${cacheName}:${key}`;

      it(`${cacheName} 이름과 키로 5분 동안 저장하고, 다시 부르면 저장소를 부르지 않고 같은 값을 준다`, async () => {
        const { service, repo, redis } = setup();
        const miss = await call(service);
        expect(redis.ttls.get(redisKey)).toBe(300);
        const hit = await call(service);
        expect(hit).toEqual(miss);
        expect((repo as Repo)[repoMethod]).toHaveBeenCalledTimes(1);
      });

      // 옛 unless = "#result.content.isEmpty()": 빈 쪽은 저장하지 않아서 다음에도 저장소를 부른다.
      it('빈 쪽은 저장하지 않는다', async () => {
        const { service, repo, redis } = setup(empty);
        await call(service);
        await call(service);
        expect(redis.values.size).toBe(0);
        expect((repo as Repo)[repoMethod]).toHaveBeenCalledTimes(2);
      });
    });

    it('쪽 번호, 크기, 태그가 다르면 따로 저장한다', async () => {
      const { service, repo, redis } = setup();
      await service.getPosts(first, []);
      await service.getPosts({ page: 1, size: 10 }, []);
      await service.getPosts({ page: 0, size: 20 }, []);
      await service.getPosts(first, ['a']);
      await service.getPosts(first, ['a', 'b']);
      expect([...redis.values.keys()].sort()).toEqual(
        [
          'cache:postsList:0-10-all',
          'cache:postsList:1-10-all',
          'cache:postsList:0-20-all',
          'cache:postsList:0-10-[a]',
          'cache:postsList:0-10-[a, b]',
        ].sort(),
      );
      expect(repo.findAllPosts).toHaveBeenCalledTimes(5);
    });

    it('getMyPosts는 사용자마다 따로 저장한다', async () => {
      const { service, redis } = setup();
      await service.getMyPosts('octo', first);
      await service.getMyPosts('boss', first);
      expect([...redis.values.keys()].sort()).toEqual([
        'cache:myPosts:boss-0-10',
        'cache:myPosts:octo-0-10',
      ]);
    });

    describe('getPostDetail', () => {
      it('postDetail 이름에 글 번호 키로 5분 동안 저장하고, 댓글 트리까지 같은 값으로 돌려준다', async () => {
        const { service, repo, redis } = setup();
        repo.findPostDetail.mockResolvedValue(
          detail({
            comments: [
              {
                commentId: 11,
                parentCommentId: null,
                writer: '댓글러',
                writerProfileImageUrl: null,
                content: '댓글',
                createdAt: new Date('2025-07-27T21:30:00.000Z'),
              },
            ],
          }),
        );
        const miss = await service.getPostDetail(7n);
        expect(redis.ttls.get('cache:postDetail:7')).toBe(300);
        expect(await service.getPostDetail(7n)).toEqual(miss);
        expect(repo.findPostDetail).toHaveBeenCalledTimes(1);
      });

      it('글이 없는 404는 저장하지 않는다', async () => {
        const { service, repo, redis } = setup();
        repo.findPostDetail.mockResolvedValue(null);
        await expect(service.getPostDetail(7n)).rejects.toThrow();
        await expect(service.getPostDetail(7n)).rejects.toThrow();
        expect(redis.values.size).toBe(0);
        expect(repo.findPostDetail).toHaveBeenCalledTimes(2);
      });
    });

    describe('getWeeklyPopularPosts', () => {
      it('hotPosts 이름에 weekly 키로 30분 동안 저장한다', async () => {
        const { service, repo, redis } = setup();
        const miss = await service.getWeeklyPopularPosts();
        expect(redis.ttls.get('cache:hotPosts:weekly')).toBe(1800);
        expect(await service.getWeeklyPopularPosts()).toEqual(miss);
        expect(repo.findWeeklyPopularPosts).toHaveBeenCalledTimes(1);
      });

      // 지금 데이터에서는 최근 7일 글이 없어서 항상 빈 목록이고, 그래서 저장되지 않는다.
      it('빈 목록은 저장하지 않는다', async () => {
        const { service, repo, redis } = setup();
        repo.findWeeklyPopularPosts.mockResolvedValue([]);
        await service.getWeeklyPopularPosts();
        await service.getWeeklyPopularPosts();
        expect(redis.values.size).toBe(0);
        expect(repo.findWeeklyPopularPosts).toHaveBeenCalledTimes(2);
      });
    });

    describe('getHomeFeed', () => {
      it('homeFeed 이름에 "쪽-크기-태그" 키로 5분 동안 저장하고, 다시 부르면 아무것도 읽지 않고 같은 값을 준다', async () => {
        const { service, repo, tags, redis } = setup();
        const miss = await service.getHomeFeed(first, []);
        expect(redis.ttls.get('cache:homeFeed:0-10-all')).toBe(300);
        const hit = await service.getHomeFeed(first, []);
        expect(hit).toEqual(miss);
        expect(repo.findAllPosts).toHaveBeenCalledTimes(1);
        expect(repo.findWeeklyPopularPosts).toHaveBeenCalledTimes(1);
        expect(tags.getAllTags).toHaveBeenCalledTimes(1);
      });

      it('태그가 있으면 키에 "[a, b]"가 들어간다', async () => {
        const { service, redis } = setup();
        await service.getHomeFeed(first, ['a', 'b']);
        expect(redis.values.has('cache:homeFeed:0-10-[a, b]')).toBe(true);
      });

      // 옛 unless = "#result.latest.content.isEmpty()": 최신 글이 비면 저장하지 않는다(인기 글과 태그가 있어도).
      it('최신 글이 비면 저장하지 않는다', async () => {
        const { service, repo, redis } = setup(empty);
        await service.getHomeFeed(first, []);
        await service.getHomeFeed(first, []);
        expect(redis.values.size).toBe(0);
        expect(repo.findAllPosts).toHaveBeenCalledTimes(2);
      });

      // 옛 getHomeFeed는 같은 클래스의 getWeeklyPopularPosts와 getPosts를 직접 불렀다. 스프링 캐시는 프록시를 거쳐야 걸려서
      // 그 안쪽 두 호출에는 캐시가 걸리지 않았다. 그래서 홈 피드를 읽어도 postsList와 hotPosts는 저장되지 않는다.
      it('안쪽의 최신 글·인기 글 조회는 캐시를 거치지 않는다', async () => {
        const { service, repo, redis } = setup();
        await service.getHomeFeed(first, []);
        expect([...redis.values.keys()]).toEqual(['cache:homeFeed:0-10-all']);

        // 같은 조건으로 getPosts를 불러도 홈 피드가 채워 준 캐시가 없어서 저장소를 다시 부른다.
        await service.getPosts(first, []);
        expect(repo.findAllPosts).toHaveBeenCalledTimes(2);
      });

      // 태그는 다른 빈(TagService)의 호출이라서 옛 코드에서도 프록시를 거쳐 allTags 캐시가 걸렸다.
      it('태그는 TagService의 캐시(allTags)를 거친다', async () => {
        const repo = {
          findAllPosts: vi
            .fn()
            .mockResolvedValue({ posts: [summary()], totalElements: 1 }),
          findWeeklyPopularPosts: vi.fn().mockResolvedValue([popular(1)]),
        };
        const tagRepo = {
          findAllTagNames: vi.fn().mockResolvedValue(['nest']),
        };
        const { redis, cache } = createReadCache();
        const service = new PostService(
          repo as unknown as PostRepository,
          new TagService(tagRepo as unknown as TagRepository, cache),
          cache,
        );

        await service.getHomeFeed(first, []);
        expect(redis.ttls.get('cache:allTags:all')).toBe(3600);

        // 홈 피드 캐시만 지우고 다시 읽으면 태그는 allTags 캐시에서 나온다.
        redis.values.delete('cache:homeFeed:0-10-all');
        await service.getHomeFeed(first, []);
        expect(tagRepo.findAllTagNames).toHaveBeenCalledTimes(1);
        expect(repo.findAllPosts).toHaveBeenCalledTimes(2);
      });
    });

    // 공개 프로필(UserService)이 쓰는 캐시 없는 조회다. 옛 UserServiceImpl이 캐시가 붙은 getMyPosts가 아니라 postQueryPort를 직접 불렀다.
    it('findPostsByWriter는 캐시를 거치지 않는다', async () => {
      const { service, repo, redis } = setup();
      await service.findPostsByWriter('octo', first);
      await service.findPostsByWriter('octo', first);
      expect(redis.values.size).toBe(0);
      expect(repo.findPostsByWriter).toHaveBeenCalledTimes(2);
    });
  });
});
