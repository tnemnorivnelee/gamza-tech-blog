import { InMemoryUserRepository } from './in-memory-user.repository.js';
import type { NewUser } from './user.repository.js';

const user = (email: string | null): NewUser => ({
  githubId: 'g_1',
  role: 'PRE_REGISTER',
  name: 'octo',
  nickname: 'octocat',
  email,
});

describe('InMemoryUserRepository', () => {
  let repository: InMemoryUserRepository;

  beforeEach(() => {
    repository = new InMemoryUserRepository();
  });

  it('만든 사용자를 githubId로 찾고, 없으면 undefined다', async () => {
    await repository.create(user('a@example.com'));

    expect(await repository.findByGithubId('g_1')).toEqual(
      user('a@example.com'),
    );
    expect(await repository.findByGithubId('g_2')).toBeUndefined();
  });

  describe('updateEmailIfEmpty', () => {
    it.each([null, '', '   '])(
      '이메일이 비어 있으면(%j) 채운다',
      async (blank) => {
        await repository.create(user(blank));

        await repository.updateEmailIfEmpty('g_1', 'new@example.com');

        expect((await repository.findByGithubId('g_1'))?.email).toBe(
          'new@example.com',
        );
      },
    );

    it('이메일이 있으면 바꾸지 않는다', async () => {
      await repository.create(user('keep@example.com'));

      await repository.updateEmailIfEmpty('g_1', 'new@example.com');

      expect((await repository.findByGithubId('g_1'))?.email).toBe(
        'keep@example.com',
      );
    });

    it('이메일 말고 다른 값은 그대로 둔다', async () => {
      await repository.create(user(null));

      await repository.updateEmailIfEmpty('g_1', 'new@example.com');

      expect(await repository.findByGithubId('g_1')).toEqual({
        ...user(null),
        email: 'new@example.com',
      });
    });

    it('없는 사용자는 아무것도 하지 않는다', async () => {
      await expect(
        repository.updateEmailIfEmpty('g_none', 'new@example.com'),
      ).resolves.toBeUndefined();
      expect(await repository.findByGithubId('g_none')).toBeUndefined();
    });
  });
});
