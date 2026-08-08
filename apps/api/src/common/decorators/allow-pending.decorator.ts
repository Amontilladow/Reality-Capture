import { SetMetadata } from '@nestjs/common';

export const ALLOW_PENDING_KEY = 'allowPending';

/** Mark an endpoint as reachable by a pending-approval user (e.g. /auth/me, logout). */
export const AllowPending = () => SetMetadata(ALLOW_PENDING_KEY, true);
