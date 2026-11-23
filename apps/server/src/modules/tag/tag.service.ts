import { Injectable } from '@nestjs/common';
import { ReadCache } from '../../common/read-cache.js';
import { TagRepository } from './tag.repository.js';

// 옛 @Cacheable(allTags, 키 'all', 만료 60분)을 여기에 건다. 옛 코드는 unless가 없어서 빈 목록도 저장했다.
// 홈 피드(PostService)도 이 서비스로 태그를 받는다. 옛 PostServiceImpl도 TagService를 주입받아 같은 방식이었고,
// 다른 빈의 호출이라서 홈 피드 안에서도 이 캐시를 거친다(옛 동작).
@Injectable()
export class TagService {
  constructor(
    private readonly tags: TagRepository,
    private readonly cache: ReadCache,
  ) {}

  getAllTags() {
    return this.cache.cached('allTags', 'all', () =>
      this.tags.findAllTagNames(),
    );
  }
}
