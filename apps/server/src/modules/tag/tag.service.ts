import { Injectable } from '@nestjs/common';
import { TagRepository } from './tag.repository.js';

// 옛 @Cacheable(allTags)은 읽기 캐시 단계(M5-5)에서 이 메서드에 붙인다.
// 홈 피드(PostService)도 이 서비스로 태그를 받는다. 옛 PostServiceImpl도 TagService를 주입받아 같은 방식이었다.
@Injectable()
export class TagService {
  constructor(private readonly tags: TagRepository) {}

  getAllTags() {
    return this.tags.findAllTagNames();
  }
}
