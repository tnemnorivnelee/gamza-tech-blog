import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { PrismaClient } from './generated/client.js';

// DB 연결 하나를 들고 있는 부품이다(옛 JPA의 EntityManager에 해당한다). 쿼리 메서드(user.findUnique 등)는 부모 PrismaClient가 준다.
// 이 클래스는 연결만 맡는다. 어떤 테이블을 어떻게 읽을지는 쓰는 쪽(*.repository.ts)이 정한다.
// @Injectable: Nest가 생성자에 필요한 부품(ConfigService)을 찾아 넣어 주는 대상이라는 표시다.
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(config: ConfigService<EnvironmentVariables, true>) {
    // 어댑터는 MySQL에 실제로 말을 거는 드라이버다. 연결은 첫 쿼리를 보낼 때 열려서, 부품을 만들기만 하는 시험은 DB 없이도 끝난다.
    // DATABASE_URL은 개발에서 비워 둘 수 있다. 빈 문자열을 넘기면 서버는 뜨고, 첫 쿼리에서 어댑터가 "연결 주소 형식" 오류로 막는다
    // (undefined를 그대로 넘기면 생성자가 알아보기 어려운 TypeError로 죽는다).
    // shortcut: 연결 풀 설정(대기 시간, 최대 연결 수)은 어댑터 기본값이다. 옛 서버는 HikariCP 기본값으로 연결 대기 10초, 유휴 10분, 최대 수명 약 28분을 뒀다.
    // 닿지 않는 DB에는 첫 요청이 약 20초 뒤에 실패한다. 운영 DB(RDS)를 만들 때 주소의 옵션(acquireTimeout 등)으로 맞춘다.
    super({
      adapter: new PrismaMariaDb(
        config.get('DATABASE_URL', { infer: true }) ?? '',
      ),
    });
  }

  // 앱이 닫힐 때(app.close) Nest가 부르는 종료 훅이다. 연결 풀은 스스로 닫히지 않아서 여기서 닫는다.
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
