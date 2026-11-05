import { ChatGateway } from './chat.gateway';
import type { JwtService } from '@nestjs/jwt';
import type { Socket } from 'socket.io';
import type { ChatService } from './chat.service';
import type { DatabaseService } from '../../database/database.service';
import type { SessionRevocationService } from '../auth/session-revocation.service';

// The REST API re-checks the deny-list (JwtStrategy) and company status
// (TenancyGuard) on every request. A chat socket must do the same at the
// handshake AND on every event, since it stays open past token expiry and
// past user/company deactivation.
describe('ChatGateway session checks', () => {
  const nowSec = () => Math.floor(Date.now() / 1000);

  function makeGateway(opts: { denied?: boolean; companyActive?: boolean; exp?: number } = {}) {
    const payload = { sub: 'user-1', companyId: 'company-1', companyRole: 'project_engineer', email: 'u@example.com', exp: opts.exp ?? nowSec() + 600 };
    const jwt = { verifyAsync: jest.fn().mockResolvedValue(payload) };
    const sessionRevocation = { isDenied: jest.fn().mockResolvedValue(opts.denied ?? false) };
    const db = {
      withSystemBypass: jest.fn().mockResolvedValue(opts.companyActive === false ? [] : [{ id: 'company-1' }]),
      withTenant: jest.fn().mockResolvedValue([]),
    };
    const chat = {
      canAccessChannel: jest.fn().mockResolvedValue(true),
      sendMessage: jest.fn().mockResolvedValue({ id: 'message-1' }),
    };
    const gateway = new ChatGateway(
      jwt as unknown as JwtService,
      chat as unknown as ChatService,
      db as unknown as DatabaseService,
      sessionRevocation as unknown as SessionRevocationService,
    );
    gateway.server = { to: jest.fn().mockReturnValue({ emit: jest.fn() }) } as never;
    const client = {
      handshake: { auth: { token: 'token' } },
      data: {} as Record<string, unknown>,
      join: jest.fn(),
      disconnect: jest.fn(),
    };
    return { gateway, client, chat, sessionRevocation, db };
  }

  it('accepts a valid session', async () => {
    const { gateway, client } = makeGateway();
    await gateway.handleConnection(client as unknown as Socket);
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it('rejects a deactivated user at the handshake', async () => {
    const { gateway, client } = makeGateway({ denied: true });
    await gateway.handleConnection(client as unknown as Socket);
    expect(client.disconnect).toHaveBeenCalled();
  });

  it('rejects a user whose company is inactive at the handshake', async () => {
    const { gateway, client } = makeGateway({ companyActive: false });
    await gateway.handleConnection(client as unknown as Socket);
    expect(client.disconnect).toHaveBeenCalled();
  });

  it('drops an open socket whose user is deactivated afterwards, without sending', async () => {
    const { gateway, client, chat, sessionRevocation } = makeGateway();
    await gateway.handleConnection(client as unknown as Socket);
    sessionRevocation.isDenied.mockResolvedValue(true);

    await gateway.handleSend(client as unknown as Socket, { channelType: 'project', channelId: 'p-1', body: 'hi' } as never);

    expect(chat.sendMessage).not.toHaveBeenCalled();
    expect(client.disconnect).toHaveBeenCalled();
  });

  it('drops an open socket once its access token has expired', async () => {
    const { gateway, client, chat } = makeGateway({ exp: nowSec() + 1 });
    await gateway.handleConnection(client as unknown as Socket);
    (client.data.session as { tokenExpiresAt: number }).tokenExpiresAt = nowSec() - 1;

    await gateway.handleJoin(client as unknown as Socket, { channelType: 'project', channelId: 'p-1' } as never);

    expect(chat.canAccessChannel).not.toHaveBeenCalled();
    expect(client.disconnect).toHaveBeenCalled();
  });
});
