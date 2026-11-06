import { Injectable, Logger } from '@nestjs/common';
import { WebSocketGateway, WebSocketServer, OnGatewayConnection } from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import type { Server, Socket } from 'socket.io';
import { DatabaseService } from '../../database/database.service';
import { SessionRevocationService } from '../auth/session-revocation.service';
import type { JwtPayload } from '@engineeringos/types';

// Master spec section 4/8: "real-time notifications... without requiring a
// page refresh". Mirrors ChatGateway's own connection/auth pattern exactly
// (same JWT handshake, same session-validity re-check on connect) -- see
// its own header comment for the single-instance/no-Redis-adapter caveat,
// which applies here too.
//
// Unlike chat's per-channel rooms, every connected client only ever needs
// its OWN notification stream: one room per user (`user:<id>`), joined once
// on connect. NotificationsService.create() emits into that room right
// after the DB write; a client with no open socket simply never gets the
// event and falls back to the existing 30s poll, so a dropped/missed push
// is never a lost notification, only a delayed one.
function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  const allowed = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173').split(',').map(o => o.trim());
  return allowed.includes(origin);
}

@Injectable()
@WebSocketGateway({
  cors: { origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => cb(null, isAllowedOrigin(origin)), credentials: true },
  namespace: '/notifications',
})
export class NotificationsGateway implements OnGatewayConnection {
  private readonly logger = new Logger(NotificationsGateway.name);

  @WebSocketServer() server: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly db: DatabaseService,
    private readonly sessionRevocation: SessionRevocationService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token as string | undefined;
      if (!token) throw new Error('No token');

      const payload = await this.jwtService.verifyAsync<JwtPayload>(token);
      if (!payload.sub || !payload.companyId) throw new Error('Invalid payload');

      if (await this.sessionRevocation.isDenied(payload.sub)) throw new Error('Session revoked');
      const [company] = await this.db.withSystemBypass(sql => sql`
        SELECT id FROM companies WHERE id = ${payload.companyId} AND is_active = true
      `);
      if (!company) throw new Error('Company inactive');

      client.join(`user:${payload.sub}`);
    } catch (err) {
      this.logger.warn(`Rejected notifications socket connection: ${err instanceof Error ? err.message : String(err)}`);
      client.disconnect();
    }
  }

  // Called by NotificationsService right after a notification row is
  // inserted; never called directly from a controller.
  emitToUser(userId: string, event: Record<string, unknown>): void {
    this.server?.to(`user:${userId}`).emit('notification:new', event);
  }
}
