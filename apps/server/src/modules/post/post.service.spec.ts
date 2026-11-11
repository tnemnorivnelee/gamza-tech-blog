import type {
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

function setup(page: PostPage = { posts: [summary()], totalElements: 1 }) {
  const repo = {
    findAllPosts: vi.fn().mockResolvedValue(page),
    searchPostsByTitle: vi.fn().mockResolvedValue(page),
    findPostsByWriter: vi.fn().mockResolvedValue(page),
  };
  return { repo, service: new PostService(repo as unknown as PostRepository) };
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
});
