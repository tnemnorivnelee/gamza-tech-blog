import { Controller, Get } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { ResponseDto } from '../../common/dto/response.dto.js';
import { OkListOf } from '../../common/swagger/api-decorators.js';
import { Roles } from '../auth/access.decorator.js';
import { PendingUserResponse } from './dto/pending-user-response.dto.js';
import { UserService } from './user.service.js';

// 관리자용 경로다. 다른 API와 달리 v1이 없다(/api/admin/...).
@Controller('api/admin/users')
export class AdminUserController {
  constructor(private readonly users: UserService) {}

  // @Roles('ADMIN'): 관리자만 부를 수 있다. 일반 사용자는 가드가 403으로 막는다.
  @ApiOperation({ summary: '대기 중인(PENDING) 사용자 전체 조회' })
  @Roles('ADMIN')
  @Get('pending')
  @OkListOf(PendingUserResponse)
  async getPendingUsers() {
    return ResponseDto.of(
      '대기 중인 사용자 조회 성공',
      await this.users.getPendingUsers(),
    );
  }
}
