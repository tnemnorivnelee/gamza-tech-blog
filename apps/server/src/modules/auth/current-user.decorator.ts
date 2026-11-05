import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { User } from '../user/user.repository.js';

// 가드가 로그인한 사용자를 request.user에 붙여 둔다. 공개 라우트에서는 붙지 않는다.
export type RequestWithUser = Request & { user?: User };

// 컨트롤러 메서드의 인자에 @CurrentUser() user: User 처럼 쓰면 request.user가 들어온다.
// 옛 @CurrentUser(@AuthenticationPrincipal)와 같은 역할이다.
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext) =>
    context.switchToHttp().getRequest<RequestWithUser>().user,
);
