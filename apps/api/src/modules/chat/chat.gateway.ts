import { Injectable, Logger, UsePipes, ValidationPipe } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import type { Server, Socket } from 'socket.io';
import { ChatService } from './chat.service';
import { ChatJoinDto, ChatSendDto } from './dto/chat-gateway.dto';
import { DatabaseService } from '../../database/database.service';
import { SessionRevocationService } from '../auth/session-revocation.service';
import type { JwtPayload, AuthenticatedUser } from '@engineeringos/types';

// NOTE (scaling): single-instance deployment only. Socket.io rooms live in
// this process's memory -- there is no Redis (or other) adapter wired in, so
// this gateway will NOT broadcast across multiple API instances/replicas.
// Nothing else in this codebase runs horizontally scaled either, so that
// matches current deployment shape, but if the API is ever scaled out
// behind a load balancer, a socket.io-redis (or similar) adapter is
// required for chat:message broadcasts to reach every connected client.

// Same allow-list as the REST API's CORS (main.ts). Read per handshake, not
// at decoration time, so it sees ALLOWED_ORIGINS however it was loaded.
function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true; // non-browser clients (mobile app) send no Origin
  const allowed = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173').split(',').map(o => o.trim());
  return allowed.includes(origin);
}

// Stored on client.data alongside the user, so every event can re-check
// the session -- a socket outlives the access token it connected with.
interface ChatSocketSession {
  user: AuthenticatedUser;
  tokenExpiresAt: number; // epoch seconds, from the JWT's exp claim
}

@Injectable()
@WebSocketGateway({
  cors: { origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => cb(null, isAllowedOrigin(origin)), credentials: true },
  namespace: '/chat',
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(ChatGateway.name);

  @WebSocketServer() server: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly chat: ChatService,
    private readonly db: DatabaseService,
    private readonly sessionRevocation: SessionRevocationService,
  ) {}

  // The REST equivalent of this is JwtStrategy.validate() (deny-list) plus
  // TenancyGuard (company still active), which run on every HTTP request.
  // The handshake alone isn't enough: a socket stays open after its token
  // expires or its user/company is deactivated, so every event re-checks.
  private async isSessionValid(session: ChatSocketSession): Promise<boolean> {
    if (Date.now() / 1000 >= session.tokenExpiresAt) return false;
    if (await this.sessionRevocation.isDenied(session.user.id)) return false;
    const [company] = await this.db.withSystemBypass(sql => sql`
      SELECT id FROM companies WHERE id = ${session.user.companyId} AND is_active = true
    `);
    return !!company;
  }

  // Returns the socket's user if its session is still valid; otherwise
  // disconnects it and returns undefined.
  private async requireUser(client: Socket): Promise<AuthenticatedUser | undefined> {
    const session = client.data.session as ChatSocketSession | undefined;
    if (session && await this.isSessionValid(session)) return session.user;
    client.disconnect();
    return undefined;
  }

  // ── Connection: verify the same JWT used for REST auth, then join rooms ─
  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token as string | undefined;
      if (!token) throw new Error('No token');

      const payload = await this.jwtService.verifyAsync<JwtPayload>(token);
      if (!payload.sub || !payload.companyId || !payload.exp) throw new Error('Invalid payload');

      // Mirrors JwtStrategy.validate()'s exact null-coalescing/field mapping.
      const user: AuthenticatedUser = {
        id: payload.sub,
        email: payload.email,
        companyId: payload.companyId,
        companyRole: payload.companyRole,
        firstName: payload.firstName ?? '',
        lastName: payload.lastName ?? '',
        pendingApproval: payload.pendingApproval ?? false,
      };
      const session: ChatSocketSession = { user, tokenExpiresAt: payload.exp };
      if (!(await this.isSessionValid(session))) throw new Error('Session revoked or company inactive');
      client.data.session = session;

      // Join every project room this user belongs to.
      const projects = await this.db.withTenant(user.companyId, sql => sql`
        SELECT project_id FROM project_members WHERE user_id = ${user.id}
      `);
      for (const p of projects) client.join(`project:${p.projectId}`);

      // Join every existing DM room this user is already part of.
      const dms = await this.db.withTenant(user.companyId, sql => sql`
        SELECT id FROM chat_dm_channels WHERE user_a_id = ${user.id} OR user_b_id = ${user.id}
      `);
      for (const d of dms) client.join(`dm:${d.id}`);
    } catch (err) {
      this.logger.warn(`Rejected chat socket connection: ${err instanceof Error ? err.message : String(err)}`);
      client.disconnect();
    }
  }

  handleDisconnect(_client: Socket) {
    // No per-disconnect cleanup needed -- socket.io drops room membership
    // automatically when a socket disconnects.
  }

  @SubscribeMessage('chat:join')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: ChatJoinDto,
  ) {
    const user = await this.requireUser(client);
    if (!user) return;

    // Verify membership the same way sendMessage() does before joining --
    // don't let a client join an arbitrary room just by asking.
    const allowed = await this.chat.canAccessChannel(
      user.companyId,
      user.id,
      user.companyRole,
      payload.channelType,
      payload.channelId,
    );
    if (!allowed) return;

    client.join(`${payload.channelType}:${payload.channelId}`);
  }

  @SubscribeMessage('chat:send')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async handleSend(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: ChatSendDto,
  ) {
    const user = await this.requireUser(client);
    if (!user) return;

    const message = await this.chat.sendMessage(
      user.companyId,
      user.id,
      user.companyRole,
      payload.channelType,
      payload.channelId,
      payload.body,
    );

    const room = `${payload.channelType}:${payload.channelId}`;
    client.join(room); // idempotent -- covers a DM channel created after this socket's initial connect
    this.server.to(room).emit('chat:message', message); // broadcasts to EVERYONE in the room, including the sender
  }
}
