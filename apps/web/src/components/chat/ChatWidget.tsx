import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../../store/auth.store';
import { getProject } from '../../lib/projects.api';
import { listUsers, type CompanyUser } from '../../lib/users.api';
import {
  listProjectChatMessages, listDmThreads, listDmMessages, markChatRead, getChatUnreadCount,
  type ChatMessage, type ChatDmThread,
} from '../../lib/chat.api';
import { subscribeToChatSocket, getChatSocketSnapshot } from '../../lib/chat-socket';

// Floating live-chat widget: a persistent launcher button + compact panel
// with a real-time project team channel and real-time 1-to-1 DMs, over the
// Socket.io /chat gateway. Deliberately separate from the async, threaded
// "Messages" inbox (MessagesPage.tsx / MessagesBell.tsx) -- no subjects, no
// threads, just a running live conversation.

type ActiveChannel = {
  channelType: 'project' | 'dm';
  channelId: string;
  otherUserId?: string; // dm only
  label: string;
};

function timeShort(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export function ChatWidget() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const currentUser = useAuthStore((s) => s.user);
  const params = useParams<{ projectId?: string }>();
  const projectId = params.projectId;
  const queryClient = useQueryClient();

  const socket = useSyncExternalStore(subscribeToChatSocket, getChatSocketSnapshot);
  const [connected, setConnected] = useState(false);

  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'list' | 'conversation'>('list');
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [activeChannel, setActiveChannel] = useState<ActiveChannel | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [draft, setDraft] = useState('');

  const activeChannelRef = useRef<ActiveChannel | null>(null);
  useEffect(() => {
    activeChannelRef.current = activeChannel;
  }, [activeChannel]);

  // ── Socket connection state (honest "not connected yet" indicator) ──────
  useEffect(() => {
    if (!socket) {
      setConnected(false);
      return;
    }
    setConnected(socket.connected);
    function onConnect() {
      setConnected(true);
      // Reconnected (e.g. after a token refresh swapped the socket) --
      // rejoin whatever room is currently open so live messages keep
      // flowing without the user having to reselect the conversation.
      const active = activeChannelRef.current;
      if (active) {
        socket?.emit('chat:join', { channelType: active.channelType, channelId: active.channelId });
      }
    }
    function onDisconnect() {
      setConnected(false);
    }
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, [socket]);

  // ── Incoming messages ────────────────────────────────────────────────────
  // Server broadcasts to every socket in the room, including the sender --
  // we never optimistically render our own composed message; every message
  // shown (ours or anyone else's) arrives through this listener.
  useEffect(() => {
    if (!socket) return;
    function onMessage(msg: ChatMessage) {
      queryClient.invalidateQueries({ queryKey: ['chat-unread-count'] });
      if (msg.channelType === 'dm') {
        queryClient.invalidateQueries({ queryKey: ['chat-dm-threads'] });
      }
      const active = activeChannelRef.current;
      if (active && active.channelType === msg.channelType && active.channelId === msg.channelId) {
        setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
      }
    }
    socket.on('chat:message', onMessage);
    return () => {
      socket.off('chat:message', onMessage);
    };
  }, [socket, queryClient]);

  // ── Unread badge (mirrors NotificationBell's polling convention) ────────
  const unreadQuery = useQuery({
    queryKey: ['chat-unread-count'],
    queryFn: getChatUnreadCount,
    refetchInterval: 30_000,
    enabled: Boolean(accessToken),
  });
  const unreadCount = unreadQuery.data?.count ?? 0;

  // ── DM thread list ───────────────────────────────────────────────────────
  const dmThreadsQuery = useQuery({
    queryKey: ['chat-dm-threads'],
    queryFn: listDmThreads,
    enabled: open && view === 'list',
  });

  // ── Current project (to label the team-chat entry) ──────────────────────
  const projectQuery = useQuery({
    queryKey: ['chat-project-label', projectId],
    queryFn: () => getProject(projectId as string),
    enabled: open && view === 'list' && Boolean(projectId),
  });

  // ── Company member directory (DM starter) ────────────────────────────────
  const directoryQuery = useQuery({
    queryKey: ['chat-user-directory'],
    queryFn: listUsers,
    enabled: directoryOpen,
  });

  const markReadMutation = useMutation({
    mutationFn: markChatRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chat-unread-count'] });
      queryClient.invalidateQueries({ queryKey: ['chat-dm-threads'] });
    },
  });

  // loadMessages() always resolves the CHANNEL'S REAL ID alongside its
  // messages (for a project channel this is just projectId again; for a DM
  // it's the server-assigned chat_dm_channels.id, which the initial
  // `channel` argument only approximates with a same-tick placeholder --
  // see openDm() below). Reading that resolved id back out here, rather
  // than reusing the `channel` parameter's own (possibly-stale) channelId,
  // is what keeps chat:join/markChatRead targeting the real room instead of
  // a placeholder that nothing on the server ever broadcasts to.
  async function openChannel(
    channel: ActiveChannel,
    loadMessages: () => Promise<{ channelId: string; messages: ChatMessage[] }>,
  ) {
    setDirectoryOpen(false);
    setActiveChannel(channel);
    setView('conversation');
    setMessages([]);
    setMessagesLoading(true);
    let resolvedChannelId = channel.channelId;
    try {
      const { channelId, messages } = await loadMessages();
      resolvedChannelId = channelId;
      setActiveChannel((current) => (current ? { ...current, channelId } : current));
      setMessages(messages);
    } finally {
      setMessagesLoading(false);
    }
    // Fire right after history load resolves, for both channel kinds, so
    // the room is always fresh -- including a DM channel created moments
    // ago by the history call itself.
    socket?.emit('chat:join', { channelType: channel.channelType, channelId: resolvedChannelId });
    markReadMutation.mutate({ channelType: channel.channelType, channelId: resolvedChannelId });
  }

  function openTeamChat() {
    if (!projectId) return;
    const label = projectQuery.data?.name ? `${projectQuery.data.name} team chat` : 'Team chat';
    void openChannel(
      { channelType: 'project', channelId: projectId, label },
      async () => {
        const res = await listProjectChatMessages(projectId, { perPage: 50 });
        return { channelId: projectId, messages: res.data };
      },
    );
  }

  function openDm(otherUserId: string, otherUserName?: string) {
    void openChannel(
      { channelType: 'dm', channelId: otherUserId, otherUserId, label: otherUserName ?? 'Direct message' },
      async () => {
        const res = await listDmMessages(otherUserId, { perPage: 50 });
        return { channelId: res.data.channelId, messages: res.data.messages };
      },
    );
  }

  function handleSend() {
    const body = draft.trim();
    // messagesLoading guard closes the same race as the channelId fix above:
    // activeChannel.channelId is still the DM placeholder until history
    // finishes loading, so a send fired before then would target the wrong
    // room the same way an unfixed chat:join did.
    if (!body || !activeChannel || !socket || messagesLoading) return;
    socket.emit('chat:send', { channelType: activeChannel.channelType, channelId: activeChannel.channelId, body });
    setDraft('');
  }

  function backToList() {
    setView('list');
    setActiveChannel(null);
    setMessages([]);
  }

  if (!accessToken) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end">
      {open && (
        <div className="mb-3 w-80 h-[28rem] tick-frame panel overflow-hidden flex flex-col shadow-xl">
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-base-600 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              {view === 'conversation' && (
                <button onClick={backToList} className="text-ink-500 hover:text-ink-100 shrink-0" aria-label="Back">
                  <IconArrowLeft className="w-3.5 h-3.5" />
                </button>
              )}
              <span className="text-xs font-mono uppercase tracking-widest text-ink-500 truncate">
                {view === 'list' ? 'Chat' : activeChannel?.label}
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span
                className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-signal' : 'bg-ink-500'}`}
                title={connected ? 'Connected' : 'Not connected'}
              />
              <button onClick={() => setOpen(false)} className="text-ink-500 hover:text-ink-100" aria-label="Close chat">
                <IconClose className="w-4 h-4" />
              </button>
            </div>
          </div>

          {view === 'list' && (
            <div className="overflow-y-auto flex-1">
              {projectId && (
                <button
                  onClick={openTeamChat}
                  className="block w-full text-left px-3 py-2.5 border-b border-base-600 hover:bg-base-800 transition-colors"
                >
                  <div className="text-xs text-ink-100">
                    {projectQuery.data?.name ? `${projectQuery.data.name} team chat` : 'Project team chat'}
                  </div>
                  <div className="text-[10px] font-mono text-ink-500 mt-0.5">This project · everyone</div>
                </button>
              )}

              <div className="flex items-center justify-between px-3 pt-3 pb-1.5">
                <span className="text-[10px] font-mono uppercase tracking-widest text-ink-500">Direct messages</span>
                <button
                  onClick={() => setDirectoryOpen((v) => !v)}
                  className="text-[11px] text-blueprint hover:text-blueprint-hover"
                >
                  {directoryOpen ? 'Cancel' : '+ New'}
                </button>
              </div>

              {directoryOpen && (
                <div className="px-3 pb-2 border-b border-base-600">
                  {directoryQuery.isLoading && <p className="text-xs text-ink-500 py-1">Loading people…</p>}
                  {directoryQuery.data && (
                    <div className="max-h-40 overflow-y-auto space-y-0.5">
                      {directoryQuery.data.data
                        .filter((u) => u.id !== currentUser?.id)
                        .map((u) => (
                          <button
                            key={u.id}
                            onClick={() => openDm(u.id, displayName(u))}
                            className="block w-full text-left px-2 py-1.5 rounded text-xs text-ink-300 hover:bg-base-800 hover:text-ink-100"
                          >
                            {displayName(u)}
                          </button>
                        ))}
                      {directoryQuery.data.data.filter((u) => u.id !== currentUser?.id).length === 0 && (
                        <p className="text-xs text-ink-500 py-1">No other company members yet.</p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {dmThreadsQuery.isLoading && <p className="p-4 text-sm text-ink-500">Loading conversations…</p>}
              {dmThreadsQuery.data && dmThreadsQuery.data.length === 0 && (
                <p className="p-4 text-sm text-ink-500">No DM conversations yet.</p>
              )}
              {dmThreadsQuery.data?.map((t: ChatDmThread) => (
                <button
                  key={t.channelId}
                  onClick={() => openDm(t.otherUserId, t.otherUserName)}
                  className="block w-full text-left px-3 py-2.5 border-b border-base-600 last:border-b-0 hover:bg-base-800 transition-colors"
                >
                  <div className="flex items-start gap-2">
                    {t.unread && <span className="w-1.5 h-1.5 rounded-full bg-blueprint mt-1.5 shrink-0" />}
                    <div className="min-w-0 flex-1">
                      <div className={`text-xs ${t.unread ? 'text-ink-100' : 'text-ink-300'}`}>
                        {t.otherUserName ?? 'Unknown user'}
                      </div>
                      {t.lastMessageBody && (
                        <div className="text-[10px] text-ink-500 mt-0.5 truncate">{t.lastMessageBody}</div>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {view === 'conversation' && (
            <>
              <div className="overflow-y-auto flex-1 px-3 py-2 space-y-2">
                {messagesLoading && <p className="text-sm text-ink-500 py-4 text-center">Loading messages…</p>}
                {!messagesLoading && messages.length === 0 && (
                  <p className="text-sm text-ink-500 py-4 text-center">No messages yet. Say hello.</p>
                )}
                {messages.map((m) => {
                  const mine = m.fromUserId === currentUser?.id;
                  return (
                    <div key={m.id} className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
                      {!mine && (
                        <span className="text-[10px] font-mono text-ink-500 mb-0.5">
                          {m.fromUserName ?? 'Unknown'}
                        </span>
                      )}
                      <div
                        className={`max-w-[85%] rounded px-2.5 py-1.5 text-xs break-words ${
                          mine ? 'bg-blueprint/20 border border-blueprint/40 text-ink-100' : 'bg-base-800 text-ink-100'
                        }`}
                      >
                        {m.body}
                      </div>
                      <span className="text-[9px] font-mono text-ink-500 mt-0.5">{timeShort(m.createdAt)}</span>
                    </div>
                  );
                })}
              </div>
              <div className="border-t border-base-600 p-2 shrink-0">
                {!connected && (
                  <p className="text-[10px] text-ink-500 mb-1">Not connected — reconnecting…</p>
                )}
                <div className="flex items-center gap-1.5">
                  <input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleSend();
                      }
                    }}
                    disabled={messagesLoading}
                    placeholder="Message…"
                    className="flex-1 min-w-0 bg-base-900 border border-base-600 rounded px-2 py-1.5 text-xs text-ink-100 placeholder:text-ink-500 focus:outline-none focus:border-blueprint disabled:opacity-50"
                  />
                  <button
                    onClick={handleSend}
                    disabled={!draft.trim() || !connected || messagesLoading}
                    className="shrink-0 px-2.5 py-1.5 rounded bg-signal text-base-950 text-xs font-semibold disabled:opacity-40"
                  >
                    Send
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        className="relative w-12 h-12 rounded-full bg-signal text-base-950 flex items-center justify-center shadow-xl hover:brightness-95 transition"
        aria-label="Open chat"
      >
        <IconChat className="w-5 h-5" />
        {!open && unreadCount > 0 && (
          <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full bg-blueprint text-ink-100 text-[9px] font-mono font-bold flex items-center justify-center">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>
    </div>
  );
}

function displayName(u: CompanyUser): string {
  const name = `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim();
  return name || u.email;
}

function IconChat({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 5h16v11H8l-4 4V5z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconClose({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
    </svg>
  );
}
function IconArrowLeft({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M19 12H5M11 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
