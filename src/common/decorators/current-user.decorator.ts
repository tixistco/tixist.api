import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** Returns `req.user` (set by the active Passport strategy). */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest<{ user?: unknown }>();
    return req.user;
  },
);
