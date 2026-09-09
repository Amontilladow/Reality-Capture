import { Injectable, Logger } from '@nestjs/common';
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
import { ChatService, type ChatChannelType } from './chat.service';
import { DatabaseService } from '../../database/database.service';
import type { JwtPayload, AuthenticatedUser } from '@engineeringos/types';

// NOTE (scaling): single-instance deployment only. Socket.io rooms live in
// this process's memory -- there is no Redis (or other) adapter wired in, so
// this gateway will NOT broadcast across multiple API instances/replicas.
// Nothing else in this codebase runs horizontally scaled either, so that
// matches current deployment shape, but if the API is ever scaled out
// behind a load balancer, a socket.io-redis (or similar) adapter is
// required for chat:message broadcasts to reach every connected client.

@Injectable()
@WebSocketGateway({ cors: { origin: true, credentials: true }, namespace: '/chat' })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(ChatGateway.name);

  @WebSocketServer() server: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly chat: ChatService,
    private readonly db: DatabaseService,
  ) {}

  // ── Connection: verify the same JWT used for REST auth, then join rooms ─
  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token as string | undefined;
      if (!token) throw new Error('No token');

      const payload = await this.jwtService.verifyAsync<JwtPayload>(token);
      if (!payload.sub || !payload.companyId) throw new Error('Invalid payload');

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
      client.data.user = user;

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
  async handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { channelType: ChatChannelType; channelId: string },
  ) {
    const user = client.data.user as AuthenticatedUser | undefined;
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
  async handleSend(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { channelType: ChatChannelType; channelId: string; body: string },
  ) {
    const user = client.data.user as AuthenticatedUser | undefined;
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
