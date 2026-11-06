import { Module, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import type { EnvironmentVariables } from '../../config/env.validation.js';

// Redis 연결 하나를 만들어 다른 모듈에 내주는 모듈이다(옛 RedisConfig의 연결 설정에 해당한다).
// 연결을 쓰는 쪽(토큰 저장소, 나중에 챗봇·캐시)이 키 이름과 명령을 따로 정한다.
// provide에 Redis 클래스를 이름표로 쓰면 다른 곳에서 생성자에 `redis: Redis`라고만 적어도 이 연결이 들어온다.
@Module({
  providers: [
    {
      provide: Redis,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) =>
        new Redis({
          host: config.get('REDIS_HOST', { infer: true }),
          port: config.get('REDIS_PORT', { infer: true }),
          password: config.get('REDIS_PASSWORD', { infer: true }),
          // 첫 명령을 보낼 때 연결한다. 모듈을 만들기만 하는 시험이 Redis 없이도 끝나고, 연결이 열려 남지 않는다.
          lazyConnect: true,
        }),
    },
  ],
  exports: [Redis],
})
export class RedisModule implements OnModuleDestroy {
  constructor(private readonly redis: Redis) {}

  // 앱이 닫힐 때(app.close) Nest가 부르는 종료 훅이다. ioredis 연결은 스스로 닫히지 않아서 여기서 닫는다.
  // shortcut: 진행 중인 명령을 기다리지 않고 바로 끊는다(quit도 명령이라 연결 전에 부르면 연결부터 열 수 있다). 종료하는 서버라 괜찮고, 기다려야 하면 연결된 경우에만 quit을 쓴다.
  onModuleDestroy() {
    this.redis.disconnect();
  }
}
