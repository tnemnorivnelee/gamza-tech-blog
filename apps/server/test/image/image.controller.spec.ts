import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { CommonModule } from '../../src/common/common.module.js';
import { BusinessException } from '../../src/common/error/business.exception.js';
import { ErrorCode } from '../../src/common/error/error-code.js';
import { validateEnv } from '../../src/config/env.validation.js';
import { MAX_UPLOAD_BYTES } from '../../src/infra/storage/image-upload.js';
import { AuthModule } from '../../src/modules/auth/auth.module.js';
import { InMemoryTokenStore } from '../../src/modules/auth/in-memory-token-store.js';
import { JwtTokenService } from '../../src/modules/auth/jwt-token.service.js';
import { TokenStore } from '../../src/modules/auth/token-store.js';
import { PostImageController } from '../../src/modules/post-image/post-image.controller.js';
import { PostImageService } from '../../src/modules/post-image/post-image.service.js';
import { ProfileImageController } from '../../src/modules/profile-image/profile-image.controller.js';
import { ProfileImageService } from '../../src/modules/profile-image/profile-image.service.js';
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

const RESPONSE = {
  id: 5,
  imageUrl: 'https://bucket.test/profile-images/a.png',
};
const URL_OF_UPLOAD = 'https://bucket.test/tmp_images/b.png';

// 서비스는 가짜다. 이 시험은 멀티파트 읽기(폼 칸 이름, 한도, 빈 파일, 한글 파일 이름), 메시지, 오류 코드, 접근 규칙을 본다.
// 저장·캐시 규칙은 profile-image.service.spec.ts와 profile-image.repository.spec.ts가 본다.
async function createApp() {
  const profileService = {
    updateProfileImage: vi.fn().mockResolvedValue(RESPONSE),
    deleteProfileImage: vi.fn().mockResolvedValue(undefined),
  };
  const postService = {
    saveTemporaryImage: vi.fn().mockResolvedValue(URL_OF_UPLOAD),
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
    controllers: [ProfileImageController, PostImageController],
    providers: [
      { provide: ProfileImageService, useValue: profileService },
      { provide: PostImageService, useValue: postService },
    ],
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

  const bearer = (githubId: string) => ({
    authorization: `Bearer ${moduleRef.get(JwtTokenService).createAccessToken(githubId)}`,
  });
  const send = async (
    method: 'PUT' | 'POST' | 'DELETE',
    path: string,
    headers: Record<string, string> = {},
    body?: FormData | string,
  ) => {
    const res = await fetch(`${baseUrl}${path}`, { method, headers, body });
    return { status: res.status, body: await res.json() };
  };
  return { app, profileService, postService, bearer, send };
}

type TestApp = Awaited<ReturnType<typeof createApp>>;

// 폼 하나를 만든다. field: 폼 칸 이름, name: 파일 이름, size: 내용의 바이트 수(모두 'a').
function form(field: string, name: string, size = 3) {
  const data = new FormData();
  data.append(field, new Blob(['a'.repeat(size)]), name);
  return data;
}

describe('이미지 쓰기 API', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createApp();
  });

  afterAll(() => t.app.close());

  beforeEach(() => vi.clearAllMocks());

  describe('PUT /api/v1/profile-images', () => {
    const url = '/api/v1/profile-images';

    it('토큰이 없으면 파일을 읽기 전에 403 J004다', async () => {
      const res = await t.send('PUT', url, {}, form('imageFile', 'me.png'));
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ data: 'J004' });
      expect(t.profileService.updateProfileImage).not.toHaveBeenCalled();
    });

    it.each(['waiting', 'newbie'])(
      '%s(PENDING·PRE_REGISTER)는 403 J005다',
      async (who) => {
        const res = await t.send(
          'PUT',
          url,
          t.bearer(who),
          form('imageFile', 'me.png'),
        );
        expect(res.status).toBe(403);
        expect(res.body).toMatchObject({ data: 'J005' });
      },
    );

    it.each(['octo', 'boss'])(
      '%s(USER, ADMIN)는 HTTP 200에 옛 메시지와 {id, imageUrl}을 받는다',
      async (who) => {
        const res = await t.send(
          'PUT',
          url,
          t.bearer(who),
          form('imageFile', 'me.png'),
        );
        expect(res.status).toBe(200);
        expect(res.body).toEqual({
          status: 200,
          message: '프로필 이미지 수정 성공',
          data: RESPONSE,
          timestamp: expect.any(Number),
        });
        expect(t.profileService.updateProfileImage).toHaveBeenCalledWith(who, {
          originalName: 'me.png',
          size: 3,
          buffer: Buffer.from('aaa'),
        });
      },
    );

    // 옛 @Valid @ModelAttribute: 파일 칸이 없으면 400 C001과 필드 오류다. 모르는 파트는 옛 Spring처럼 무시한다.
    it.each([
      ['폼에 파일 칸이 없다', new FormData()],
      ['다른 이름의 칸에 보냈다', form('file', 'me.png')],
    ])(
      '%s: 400 C001과 "이미지 파일은 필수입니다"이고 서비스를 부르지 않는다',
      async (_name, body) => {
        const res = await t.send('PUT', url, t.bearer('octo'), body);
        expect(res.status).toBe(400);
        expect(res.body).toMatchObject({
          status: 400,
          code: 'C001',
          errors: [
            {
              field: 'imageFile',
              value: '',
              reason: '이미지 파일은 필수입니다',
            },
          ],
        });
        expect(t.profileService.updateProfileImage).not.toHaveBeenCalled();
      },
    );

    it('멀티파트가 아닌 요청(JSON)도 파일이 없는 것으로 본다(옛 서버는 415였을 것이다)', async () => {
      const res = await t.send(
        'PUT',
        url,
        { ...t.bearer('octo'), 'content-type': 'application/json' },
        '{}',
      );
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: 'C001' });
    });

    it('이름이 있는 빈 파일은 서비스까지 간다(서비스가 400 U008로 거부한다)', async () => {
      t.profileService.updateProfileImage.mockRejectedValueOnce(
        new BusinessException(ErrorCode.PROFILE_IMAGE_EMPTY),
      );
      const res = await t.send(
        'PUT',
        url,
        t.bearer('octo'),
        form('imageFile', 'me.png', 0),
      );
      expect(t.profileService.updateProfileImage).toHaveBeenCalledWith(
        'octo',
        expect.objectContaining({ originalName: 'me.png', size: 0 }),
      );
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: 'U008' });
    });

    // 브라우저에서 파일을 고르지 않고 보내면 파일 이름이 빈 파트가 온다. 파서가 이런 파트는 건너뛰어 "파일 칸 없음"이 된다.
    // 옛 Spring은 빈 파일로 받아 서비스에서 400 U008이었을 것이다(알려진 차이, m6-write-api-plan.md 6절).
    it('파일 이름이 빈 파트는 건너뛰어 파일 칸이 없는 것과 같다(400 C001)', async () => {
      const boundary = 'x-boundary';
      const raw =
        `--${boundary}\r\n` +
        'Content-Disposition: form-data; name="imageFile"; filename=""\r\n' +
        'Content-Type: application/octet-stream\r\n\r\n' +
        `\r\n--${boundary}--\r\n`;
      const res = await t.send(
        'PUT',
        url,
        {
          ...t.bearer('octo'),
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
        raw,
      );
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: 'C001' });
      expect(t.profileService.updateProfileImage).not.toHaveBeenCalled();
    });

    it('한글 파일 이름을 그대로 읽는다', async () => {
      await t.send(
        'PUT',
        url,
        t.bearer('octo'),
        form('imageFile', '프로필 사진.png'),
      );
      expect(t.profileService.updateProfileImage).toHaveBeenCalledWith(
        'octo',
        expect.objectContaining({ originalName: '프로필 사진.png' }),
      );
    });

    it('폼의 다른 글자 칸은 무시한다', async () => {
      const body = form('imageFile', 'me.png');
      body.append('memo', '무시');
      const res = await t.send('PUT', url, t.bearer('octo'), body);
      expect(res.status).toBe(200);
    });

    // 옛 max-file-size·max-request-size가 3MB다. 한도를 넘으면 컨트롤러에 닿기 전에 거부되어 500 C004였다고 본다 [추정].
    // 그래서 검사 안의 U009는 HTTP로는 나오지 않는다.
    it('파일이 3MB까지는 받고, 1바이트만 넘으면 500 C004로 거부한다', async () => {
      const ok = await t.send(
        'PUT',
        url,
        t.bearer('octo'),
        form('imageFile', 'big.png', MAX_UPLOAD_BYTES),
      );
      expect(ok.status).toBe(200);
      expect(t.profileService.updateProfileImage).toHaveBeenCalledTimes(1);

      t.profileService.updateProfileImage.mockClear();
      const tooBig = await t.send(
        'PUT',
        url,
        t.bearer('octo'),
        form('imageFile', 'big.png', MAX_UPLOAD_BYTES + 1),
      );
      expect(tooBig.status).toBe(500);
      expect(tooBig.body).toMatchObject({ code: 'C004' });
      expect(t.profileService.updateProfileImage).not.toHaveBeenCalled();
    });

    it('서비스의 오류가 그대로 나간다(없는 사용자 400 C003, 옛 이미지 삭제 실패 500 U012)', async () => {
      t.profileService.updateProfileImage.mockRejectedValueOnce(
        new BusinessException(ErrorCode.ENTITY_NOT_FOUND),
      );
      const missing = await t.send(
        'PUT',
        url,
        t.bearer('octo'),
        form('imageFile', 'me.png'),
      );
      expect(missing).toMatchObject({ status: 400, body: { code: 'C003' } });

      t.profileService.updateProfileImage.mockRejectedValueOnce(
        new BusinessException(ErrorCode.PROFILE_IMAGE_DELETE_FAILED),
      );
      const failed = await t.send(
        'PUT',
        url,
        t.bearer('octo'),
        form('imageFile', 'me.png'),
      );
      expect(failed).toMatchObject({ status: 500, body: { code: 'U012' } });
    });
  });

  describe('DELETE /api/v1/profile-images', () => {
    const url = '/api/v1/profile-images';

    it('토큰이 없으면 403 J004다', async () => {
      const res = await t.send('DELETE', url);
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ data: 'J004' });
    });

    it.each(['waiting', 'newbie'])('%s는 403 J005다', async (who) => {
      const res = await t.send('DELETE', url, t.bearer(who));
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ data: 'J005' });
      expect(t.profileService.deleteProfileImage).not.toHaveBeenCalled();
    });

    it('로그인한 사용자는 HTTP 200에 옛 메시지를 받고 data 키는 없다', async () => {
      const res = await t.send('DELETE', url, t.bearer('octo'));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        status: 200,
        message: '프로필 이미지 삭제 성공',
        timestamp: expect.any(Number),
      });
      expect(t.profileService.deleteProfileImage).toHaveBeenCalledWith('octo');
    });

    it('서비스의 오류(없는 사용자 400 C003)가 그대로 나간다', async () => {
      t.profileService.deleteProfileImage.mockRejectedValueOnce(
        new BusinessException(ErrorCode.ENTITY_NOT_FOUND),
      );
      const res = await t.send('DELETE', url, t.bearer('octo'));
      expect(res).toMatchObject({ status: 400, body: { code: 'C003' } });
    });
  });

  describe('POST /api/v1/posts/images', () => {
    const url = '/api/v1/posts/images';

    it('토큰이 없으면 파일을 읽기 전에 403 J004다', async () => {
      const res = await t.send('POST', url, {}, form('file', 'b.png'));
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ data: 'J004' });
      expect(t.postService.saveTemporaryImage).not.toHaveBeenCalled();
    });

    it.each(['waiting', 'newbie'])('%s는 403 J005다', async (who) => {
      const res = await t.send(
        'POST',
        url,
        t.bearer(who),
        form('file', 'b.png'),
      );
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ data: 'J005' });
    });

    it('HTTP 200이고 본문 status만 201이다. data는 올린 파일의 주소다', async () => {
      const res = await t.send(
        'POST',
        url,
        t.bearer('octo'),
        form('file', 'b.png'),
      );
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        status: 201,
        message: '이미지 업로드 성공',
        data: URL_OF_UPLOAD,
        timestamp: expect.any(Number),
      });
      expect(t.postService.saveTemporaryImage).toHaveBeenCalledWith({
        originalName: 'b.png',
        size: 3,
        buffer: Buffer.from('aaa'),
      });
    });

    it('형식과 크기 검사가 없다: 이미지가 아닌 파일도, 빈 파일도 서비스로 간다', async () => {
      const txt = await t.send(
        'POST',
        url,
        t.bearer('octo'),
        form('file', 'notes.txt'),
      );
      const empty = await t.send(
        'POST',
        url,
        t.bearer('octo'),
        form('file', 'empty.png', 0),
      );
      expect(txt.status).toBe(200);
      expect(empty.status).toBe(200);
      expect(t.postService.saveTemporaryImage).toHaveBeenCalledTimes(2);
    });

    // 옛 @RequestPart("file")가 없으면 MissingServletRequestPartException이고 처리기가 없어 500 C004였다고 본다 [추정].
    it.each([
      ['폼에 파일 칸이 없다', new FormData()],
      ['다른 이름의 칸에 보냈다', form('imageFile', 'b.png')],
    ])('%s: 500 C004다 [추정]', async (_name, body) => {
      const res = await t.send('POST', url, t.bearer('octo'), body);
      expect(res.status).toBe(500);
      expect(res.body).toMatchObject({ code: 'C004' });
      expect(t.postService.saveTemporaryImage).not.toHaveBeenCalled();
    });

    it('한글 파일 이름을 그대로 읽는다', async () => {
      await t.send(
        'POST',
        url,
        t.bearer('octo'),
        form('file', '사진 모음.png'),
      );
      expect(t.postService.saveTemporaryImage).toHaveBeenCalledWith(
        expect.objectContaining({ originalName: '사진 모음.png' }),
      );
    });

    it('파일이 3MB까지는 받고, 1바이트만 넘으면 500 C004로 거부한다 [추정]', async () => {
      const ok = await t.send(
        'POST',
        url,
        t.bearer('octo'),
        form('file', 'big.png', MAX_UPLOAD_BYTES),
      );
      expect(ok.status).toBe(200);

      t.postService.saveTemporaryImage.mockClear();
      const tooBig = await t.send(
        'POST',
        url,
        t.bearer('octo'),
        form('file', 'big.png', MAX_UPLOAD_BYTES + 1),
      );
      expect(tooBig.status).toBe(500);
      expect(tooBig.body).toMatchObject({ code: 'C004' });
      expect(t.postService.saveTemporaryImage).not.toHaveBeenCalled();
    });
  });
});
