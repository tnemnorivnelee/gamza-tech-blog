import type { IntroPage, IntroRepository } from './intro.repository.js';
import { IntroService } from './intro.service.js';

const DEFAULT = [{ property: 'createdAt', direction: 'desc' }] as const;

function setup(page: IntroPage) {
  const repo = { findIntroPage: vi.fn().mockResolvedValue(page) };
  return {
    repo,
    service: new IntroService(repo as unknown as IntroRepository),
  };
}

const intro = (introId: number, profileImageUrl: string | null = null) => ({
  introId,
  userId: introId + 100,
  nickname: `감자${introId}`,
  profileImageUrl,
  content: '안녕하세요',
  createdAt: new Date('2025-07-27T21:08:37.120Z'),
});

describe('IntroService', () => {
  it('저장소가 준 값을 응답 모양으로 바꾼다(날짜는 문자열, 값이 없는 이미지 주소는 null)', async () => {
    const { service } = setup({
      intros: [intro(1, 'https://img.test/a.png'), intro(2)],
      totalElements: 2,
    });
    const response = await service.getIntroList({ page: 0, size: 10 }, DEFAULT);
    expect(response.content).toEqual([
      {
        introId: 1,
        userId: 101,
        nickname: '감자1',
        profileImageUrl: 'https://img.test/a.png',
        content: '안녕하세요',
        createdAt: '2025-07-27T21:08:37.12',
      },
      {
        introId: 2,
        userId: 102,
        nickname: '감자2',
        profileImageUrl: null,
        content: '안녕하세요',
        createdAt: '2025-07-27T21:08:37.12',
      },
    ]);
  });

  it('쪽 번호와 크기는 요청에서 고친 값을 그대로 돌려주고, 총 쪽수는 올림이다', async () => {
    const { service } = setup({ intros: [intro(1)], totalElements: 21 });
    const response = await service.getIntroList({ page: 2, size: 10 }, DEFAULT);
    expect(response).toMatchObject({
      page: 2,
      size: 10,
      totalElements: 21,
      totalPages: 3,
    });
  });

  // 글 목록은 범위를 넘기면 0을 돌려주지만 소개 목록은 실제 개수를 그대로 준다(옛 Spring Data의 Page).
  it('범위를 넘긴 쪽도 저장소가 센 전체 개수를 그대로 준다', async () => {
    const { service } = setup({ intros: [], totalElements: 5 });
    const response = await service.getIntroList({ page: 9, size: 2 }, DEFAULT);
    expect(response).toMatchObject({
      content: [],
      page: 9,
      size: 2,
      totalElements: 5,
      totalPages: 3,
    });
  });

  it('하나도 없으면 총 쪽수가 0이다', async () => {
    const { service } = setup({ intros: [], totalElements: 0 });
    const response = await service.getIntroList({ page: 0, size: 10 }, DEFAULT);
    expect(response.totalPages).toBe(0);
  });

  it('쪽과 정렬을 저장소에 그대로 넘긴다', async () => {
    const { service, repo } = setup({ intros: [], totalElements: 0 });
    const orders = [{ property: 'id', direction: 'asc' }] as const;
    await service.getIntroList({ page: 1, size: 4 }, orders);
    expect(repo.findIntroPage).toHaveBeenCalledWith(
      { page: 1, size: 4 },
      orders,
    );
  });
});
