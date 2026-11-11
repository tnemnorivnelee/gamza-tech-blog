import { ErrorCode } from '../../common/error/error-code.js';
import type { TagService } from '../tag/tag.service.js';
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
  return {
    repo,
    tags,
    service: new PostService(
      repo as unknown as PostRepository,
      tags as unknown as TagService,
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
});
