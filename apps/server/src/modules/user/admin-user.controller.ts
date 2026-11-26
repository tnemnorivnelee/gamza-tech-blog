import { Controller, Get, Param, Put } from '@nestjs/common';
import { ApiOperation, ApiParam } from '@nestjs/swagger';
import { ResponseDto } from '../../common/dto/response.dto.js';
import { BusinessException } from '../../common/error/business.exception.js';
import { ErrorCode } from '../../common/error/error-code.js';
import { parsePathLong } from '../../common/spring-compat.js';
import { OkListOf, OkVoid } from '../../common/swagger/api-decorators.js';
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

  // 없으면 404 U001, PENDING이 아니면 400 C001이다. 사용자 번호가 숫자가 아니면 400 C005다.
  // 옛 @Positive: 0 이하이면 검사가 걸리는데, 옛 전역 예외 처리기에 그 예외(HandlerMethodValidationException)를 다루는 곳이 없어서
  // 마지막의 Exception 처리기가 500 C004로 응답했다고 본다 [추정: Spring Boot 3.4.0의 동작을 코드로만 읽었다].
  @ApiOperation({ summary: '특정 사용자 승인 (PENDING → USER)' })
  @Roles('ADMIN')
  @Put(':id/approve')
  @ApiParam({ name: 'id', type: 'integer', format: 'int64' })
  @OkVoid()
  async approveUserProfile(@Param('id') id: string) {
    const userId = parsePathLong('id', id);
    if (userId <= 0n)
      throw new BusinessException(ErrorCode.INTERNAL_SERVER_ERROR);
    await this.users.approveUserProfile(userId);
    return ResponseDto.of('사용자 승인 완료');
  }
}
