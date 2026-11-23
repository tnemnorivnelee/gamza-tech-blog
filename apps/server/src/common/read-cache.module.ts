import { Module } from '@nestjs/common';
import { RedisModule } from '../infra/redis/redis.module.js';
import { ReadCache } from './read-cache.js';

// 읽기 캐시 부품(ReadCache)을 내주는 모듈이다. 캐시를 쓰는 모듈(글, 태그, 소개, 좋아요, 사용자)이 imports에 적는다.
// ReadCache가 Redis 연결을 필요로 해서 RedisModule을 imports에 적는다. 연결은 앱에 하나만 만들어지고 토큰 저장소와 나눠 쓴다.
@Module({
  imports: [RedisModule],
  providers: [ReadCache],
  exports: [ReadCache],
})
export class ReadCacheModule {}
