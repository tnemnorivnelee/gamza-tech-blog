import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { PrismaService } from './prisma.service.js';

// DB 없이 하는 시험이다. 연결은 첫 쿼리 때 열리므로 부품을 만들기만 해서는 DB에 닿지 않는다.
const serviceWith = (url?: string) =>
  new PrismaService(
    new ConfigService<EnvironmentVariables, true>(
      url === undefined ? {} : { DATABASE_URL: url },
    ),
  );

describe('PrismaService', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // DATABASE_URL은 개발에서 비워 둘 수 있다(env.validation.ts). 어댑터에 undefined가 가면 생성자가 TypeError로 죽으므로 막는다.
  it('DATABASE_URL이 없어도 만들어진다(서버는 뜬다)', () => {
    vi.stubEnv('DATABASE_URL', undefined);
    expect(() => serviceWith()).not.toThrow();
  });

  it('주소가 비어 있으면 첫 쿼리에서 주소 형식 오류로 막힌다', async () => {
    vi.stubEnv('DATABASE_URL', undefined);
    const service = serviceWith();
    await expect(service.$queryRaw`SELECT 1`).rejects.toThrow(
      /connection string/,
    );
    await service.onModuleDestroy();
  });

  // 연결 풀은 스스로 닫히지 않는다. 앱을 닫을 때 연결을 닫지 않으면 프로세스가 끝나지 않을 수 있다.
  it('앱이 닫힐 때 연결을 닫는다', async () => {
    const service = serviceWith('mysql://test@127.0.0.1:3306/test');
    const disconnect = vi.spyOn(service, '$disconnect');
    await service.onModuleDestroy();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
