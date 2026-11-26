import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBody, ApiOperation } from '@nestjs/swagger';
import { ResponseDto } from '../../common/dto/response.dto.js';
import { parsePageable } from '../../common/pageable.js';
import {
  ApiPageable,
  OkOf,
  OkString,
} from '../../common/swagger/api-decorators.js';
import { Public, Roles } from '../auth/access.decorator.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { readProfileRequest } from './dto/profile-request.js';
import { UpdateProfileRequest } from './dto/update-profile-request.dto.js';
import { UserActivityResponse } from './dto/user-activity-response.dto.js';
import { UserProfileRequest } from './dto/user-profile-request.dto.js';
import { UserProfileResponse } from './dto/user-profile-response.dto.js';
import { UserPublicProfileResponse } from './dto/user-public-profile-response.dto.js';
import type { User } from './user.repository.js';
import { UserService } from './user.service.js';

// 옛 공개 프로필에는 @PageableDefault가 없어서 Spring의 기본 크기 20이다(다른 목록은 10).
const PUBLIC_PROFILE_PAGE_SIZE = 20;

// @Controller: 이 클래스의 메서드들이 /api/v1/users 아래 라우트가 된다. 생성자의 UserService는 Nest가 찾아 넣어 준다(주입).
@Controller('api/v1/users')
export class UserController {
  constructor(private readonly users: UserService) {}

  // 기본 규칙(로그인 필요)이라 데코레이터가 없다. 가드가 request.user를 붙여 두고, @CurrentUser()가 꺼낸다.
  @ApiOperation({ summary: '정보 조회' })
  @Get('me/get/profile')
  @OkOf(UserProfileResponse)
  async getCurrentUserProfile(@CurrentUser() user: User) {
    return ResponseDto.of(
      '프로필 조회 성공',
      await this.users.getCurrentUserProfile(user.githubId),
    );
  }

  // 기본 규칙(USER, ADMIN)이다. 요청 내용은 서비스에 가기 전에 검사한다(옛 @Valid): 위반하면 400 C001이다.
  // 성공하면 그 사용자의 userProfile 캐시를 지운다.
  @ApiOperation({ summary: '정보 업데이트(마이페이지용)' })
  @Put('me/update/profile')
  @ApiBody({ type: UpdateProfileRequest })
  @OkOf(UserProfileResponse)
  async updateProfile(
    @CurrentUser() user: User,
    @Body() body: UpdateProfileRequest,
  ) {
    const fields = readProfileRequest(body, { emailRequired: true });
    return ResponseDto.of(
      '프로필이 수정되었습니다',
      await this.users.updateProfile(user.githubId, fields),
    );
  }

  // @Roles('PRE_REGISTER'): 가입 화면에서 막 로그인한 사용자만 부른다(옛 hasRole('PRE_REGISTER')). 저장하면 role이 PENDING이 되어 관리자의 승인을 기다린다.
  @ApiOperation({ summary: '추가 정보 입력(회원가입용)' })
  @Roles('PRE_REGISTER')
  @Post('me/complete')
  @ApiBody({ type: UserProfileRequest })
  @OkOf(UserProfileResponse)
  async completeProfile(
    @CurrentUser() user: User,
    @Body() body: UserProfileRequest,
  ) {
    const fields = readProfileRequest(body, { emailRequired: false });
    return ResponseDto.of(
      '프로필이 성공적으로 완성되었습니다.',
      await this.users.completeProfile(user.githubId, fields),
    );
  }

  @ApiOperation({ summary: '유저 활동(내가 쓴 글/댓글/좋아요 개수) 조회' })
  @Get('me/activity')
  @OkOf(UserActivityResponse)
  async getActivitySummary(@CurrentUser() user: User) {
    return ResponseDto.of(
      '유저 활동 정보 조회 성공',
      await this.users.getActivitySummary(user.githubId),
    );
  }

  // @Roles: 기본 허용(USER, ADMIN) 대신 이 목록으로 바꾼다. 가입을 끝내지 않은 사용자(PRE_REGISTER, PENDING)도 부른다(프론트가 role을 보고 화면을 정한다).
  // role은 가드가 요청마다 DB에서 읽어 붙인 값이라 따로 읽지 않는다(옛 코드도 principal의 role을 그대로 줬다).
  @ApiOperation({ summary: '역할 조회' })
  @Roles('USER', 'PRE_REGISTER', 'PENDING', 'ADMIN')
  @Get('me/role')
  @OkString()
  getCurrentUserRole(@CurrentUser() user: User) {
    return ResponseDto.of('역할 조회 성공', user.role);
  }

  // @Param: 경로의 :nickname 자리 값을 받는다. Nest가 URL 인코딩(한글 닉네임)을 풀어서 준다. 요청의 sort는 무시한다(옛 동작).
  @ApiOperation({ summary: '상대방 공개 프로필 조회' })
  @Public()
  @Get('public/profile/:nickname')
  @ApiPageable(PUBLIC_PROFILE_PAGE_SIZE)
  @OkOf(UserPublicProfileResponse)
  async getPublicProfileByNickname(
    @Param('nickname') nickname: string,
    @Query() query: Record<string, unknown>,
  ) {
    return ResponseDto.of(
      '공개 프로필 조회 성공',
      await this.users.getPublicProfileByNickname(
        nickname,
        parsePageable(query, PUBLIC_PROFILE_PAGE_SIZE),
      ),
    );
  }
}
