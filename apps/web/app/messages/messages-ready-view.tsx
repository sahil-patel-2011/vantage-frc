"use client";

import {
  type Dispatch,
  type FormEvent,
  type KeyboardEvent,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
} from "react";
import { EmptyState, PageHeader, Button } from "../../components/ui";
import { OfflineBanner } from "../../components/offline-banner";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import { withOrgHref } from "../../lib/nav/product-nav";
import {
  COMPOSER_OBJECT_TYPES,
  type MessageObjectLink,
} from "../../lib/messages/object-links";
import {
  segmentMessageBody,
  type MentionMember,
  type MentionQuery,
  type MentionRef,
} from "../../lib/messages/mentions";
import ChatSafetyPanel from "./chat-safety-panel";
import {
  formatTime,
  isArchived,
  labelFor,
  mentionsForRender,
  objectTypeLabel,
  type ChannelDraft,
  type Conversation,
  type LinkTarget,
  type Member,
  type Message,
} from "./messages-model";

function MessageBody({
  body,
  mentions = [],
  members,
}: {
  body: string;
  mentions?: MentionRef[];
  members: Member[];
}) {
  const segments = segmentMessageBody(body, mentionsForRender(body, mentions, members));
  return (
    <p>
      {segments.map((segment, index) =>
        segment.kind === "mention" ? (
          <span key={`${segment.userId}-${index}`} className="message-mention">
            {segment.value}
          </span>
        ) : (
          <span key={`t-${index}`}>{segment.value}</span>
        ),
      )}
    </p>
  );
}

export type MessagesReadyViewProps = {
  orgId: string;
  embedded: boolean;
  live: boolean;
  inboxUnread: number;
  fromCache: boolean;
  cachedAt: string | null;
  loading: boolean;
  loadError: string | null;
  loadErrorStatus: number | null;
  reloadMessages: () => void;
  sending: boolean;
  openMemberPicker: () => void;
  canManageChannels: boolean;
  channelDraft: ChannelDraft | null;
  setChannelDraft: Dispatch<SetStateAction<ChannelDraft | null>>;
  submitChannelDraft: () => void;
  channels: Conversation[];
  activeId: string | null;
  selectConversation: (id: string) => void;
  channelArchiveSupported: boolean;
  showArchivedChannels: boolean;
  setShowArchivedChannels: Dispatch<SetStateAction<boolean>>;
  loadArchivedChannels: () => void;
  directMessages: Conversation[];
  conversations: Conversation[];
  safetyOpen: boolean;
  setSafetyOpen: Dispatch<SetStateAction<boolean>>;
  active: Conversation | null;
  activeChannelArchived: boolean;
  supervisionNotice: string;
  pinned: Message[];
  members: Member[];
  pinsSupported: boolean;
  togglePin: (message: Message) => void;
  messagesRef: RefObject<HTMLDivElement | null>;
  stickToBottomRef: MutableRefObject<boolean>;
  hasEarlier: boolean;
  messages: Message[];
  loadEarlier: () => void;
  loadingEarlier: boolean;
  bottomRef: RefObject<HTMLDivElement | null>;
  send: (event: FormEvent) => void;
  selectedMentions: Member[];
  pendingObjectLink: MessageObjectLink | null;
  setPendingObjectLink: Dispatch<SetStateAction<MessageObjectLink | null>>;
  linkPickerOpen: boolean;
  setLinkPickerOpen: Dispatch<SetStateAction<boolean>>;
  linkPickerType: MessageObjectLink["objectType"];
  setLinkPickerType: Dispatch<SetStateAction<MessageObjectLink["objectType"]>>;
  linkQuery: string;
  setLinkQuery: Dispatch<SetStateAction<string>>;
  linkTargets: LinkTarget[];
  activeMention: MentionQuery | null;
  mentionSuggestions: MentionMember[];
  mentionIndex: number;
  selectMention: (member: MentionMember) => void;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  text: string;
  updateComposer: (nextText: string, cursor: number, nextMentionIds?: string[]) => void;
  setComposerCursor: Dispatch<SetStateAction<number>>;
  onComposerKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  status: string;
  pickerOpen: boolean;
  setPickerOpen: Dispatch<SetStateAction<boolean>>;
  startDm: (peerUserId: string) => void;
  setChannelArchived: (archived: boolean) => void;
  softDelete: (messageId: string) => void;
};

export function MessagesReadyView({
  orgId,
  embedded,
  live,
  inboxUnread,
  fromCache,
  cachedAt,
  loading,
  loadError,
  loadErrorStatus,
  reloadMessages,
  sending,
  openMemberPicker,
  canManageChannels,
  channelDraft,
  setChannelDraft,
  submitChannelDraft,
  channels,
  activeId,
  selectConversation,
  channelArchiveSupported,
  showArchivedChannels,
  setShowArchivedChannels,
  loadArchivedChannels,
  directMessages,
  conversations,
  safetyOpen,
  setSafetyOpen,
  active,
  activeChannelArchived,
  supervisionNotice,
  pinned,
  members,
  pinsSupported,
  togglePin,
  messagesRef,
  stickToBottomRef,
  hasEarlier,
  messages,
  loadEarlier,
  loadingEarlier,
  bottomRef,
  send,
  selectedMentions,
  pendingObjectLink,
  setPendingObjectLink,
  linkPickerOpen,
  setLinkPickerOpen,
  linkPickerType,
  setLinkPickerType,
  linkQuery,
  setLinkQuery,
  linkTargets,
  activeMention,
  mentionSuggestions,
  mentionIndex,
  selectMention,
  composerRef,
  text,
  updateComposer,
  setComposerCursor,
  onComposerKeyDown,
  status,
  pickerOpen,
  setPickerOpen,
  startDm,
  setChannelArchived,
  softDelete,
}: MessagesReadyViewProps) {
  return (
    <main className={`chat-page messages-page${embedded ? " is-embedded" : ""}`}>
      {!embedded ? (
        <PageHeader breadcrumbs="Team / Chat" title="Chat">
          <span className={`messages-live ${live ? "on" : "off"}`}>
            <i aria-hidden="true" />
            {live ? "Live" : "Paused"}
            {inboxUnread > 0 ? ` · ${inboxUnread} unread` : ""}
          </span>
        </PageHeader>
      ) : inboxUnread > 0 ? (
        <div className="messages-embed-status" aria-live="polite">
          <span className="messages-live on">
            {inboxUnread} unread
          </span>
        </div>
      ) : null}

      <OfflineBanner feature="Chat" fromCache={fromCache} cachedAt={cachedAt} />

      {loading ? (
        <EmptyState soft title="Loading…" aria-busy />
      ) : loadError ? (
        (() => {
          const copy = loadFailureCopy(
            classifyLoadFailure({
              status: loadErrorStatus,
              message: loadError,
              online: typeof navigator === "undefined" ? true : navigator.onLine,
            }),
            {
              nextPath:
                typeof window === "undefined"
                  ? null
                  : `${window.location.pathname}${window.location.search}`,
              message: loadError,
            },
          );
          return (
            <EmptyState
              title={copy.title}
              description={copy.description}
              badge="Setup"
              badgeTone="setup"
            >
              {copy.primary ? (
                <Button as="a" variant="primary" href={copy.primary.href}>
                  {copy.primary.label}
                </Button>
              ) : null}
              {copy.showRetry ? (
                <Button variant="secondary" type="button" onClick={() => void reloadMessages()}>
                  Retry
                </Button>
              ) : null}
            </EmptyState>
          );
        })()
      ) : (
        <div className="messages-layout">
          <aside className="chat-sidebar">
            <button
              type="button"
              className="messages-new-dm"
              onClick={() => void openMemberPicker()}
              disabled={sending}
            >
              New Message
            </button>
            <div className="messages-group-heading">
              <span className="eyebrow">Channels</span>
              {canManageChannels ? (
                <button
                  type="button"
                  className="messages-channel-add"
                  onClick={() => setChannelDraft({ mode: "create", value: "" })}
                  disabled={sending}
                >
                  New channel
                </button>
              ) : null}
            </div>

            {channelDraft?.mode === "create" ? (
              <form
                className="messages-channel-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submitChannelDraft();
                }}
              >
                <input
                  autoFocus
                  value={channelDraft.value}
                  maxLength={60}
                  placeholder="Channel name"
                  aria-label="New channel name"
                  onChange={(event) => setChannelDraft({ mode: "create", value: event.target.value })}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") setChannelDraft(null);
                  }}
                />
                <button type="submit" disabled={sending}>
                  Create
                </button>
                <button type="button" onClick={() => setChannelDraft(null)}>
                  Cancel
                </button>
              </form>
            ) : null}

            {channels.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`${activeId === item.id ? "active" : ""}${isArchived(item) ? " is-archived" : ""}`}
                aria-current={activeId === item.id ? "true" : undefined}
                onClick={() => void selectConversation(item.id)}
              >
                <span>
                  {isArchived(item) ? "Archived" : "Channel"}
                  {item.unreadCount > 0 ? (
                    <b className="messages-unread" aria-label={`${item.unreadCount} unread`}>
                      {item.unreadCount > 99 ? "99+" : item.unreadCount}
                    </b>
                  ) : null}
                </span>
                {labelFor(item)}
                {item.lastBody ? <small className="messages-preview">{item.lastBody}</small> : null}
              </button>
            ))}

            {channelArchiveSupported && !showArchivedChannels ? (
              <button
                type="button"
                className="messages-channel-archive-toggle"
                onClick={() => {
                  setShowArchivedChannels(true);
                  void loadArchivedChannels();
                }}
              >
                Show archived channels
              </button>
            ) : null}

            <div className="messages-group-heading">
              <span className="eyebrow">Direct messages</span>
            </div>

            {directMessages.map((item) => (
              <button
                key={item.id}
                type="button"
                className={activeId === item.id ? "active" : ""}
                aria-current={activeId === item.id ? "true" : undefined}
                onClick={() => void selectConversation(item.id)}
              >
                <span>
                  Private
                  {item.unreadCount > 0 ? (
                    <b className="messages-unread" aria-label={`${item.unreadCount} unread`}>
                      {item.unreadCount > 99 ? "99+" : item.unreadCount}
                    </b>
                  ) : null}
                </span>
                {labelFor(item)}
                {item.lastBody ? <small className="messages-preview">{item.lastBody}</small> : null}
              </button>
            ))}

            {directMessages.length === 0 ? (
              <p className="messages-group-empty">No private conversations yet.</p>
            ) : null}

            {conversations.length === 0 ? (
              <EmptyState
                soft
                title="No conversations yet"
                description="Your team channel opens with this team."
              />
            ) : null}
            {/* Visible to every member, not just admins: the people the rule applies to are the
                ones who most need to be able to read it. */}
            <button
              type="button"
              className="chat-safety-toggle"
              onClick={() => setSafetyOpen((open) => !open)}
              aria-expanded={safetyOpen}
            >
              {safetyOpen ? "Hide message settings" : "Message settings"}
            </button>
          </aside>

          <section className="chat-main">
            {safetyOpen ? (
              <ChatSafetyPanel orgId={orgId} />
            ) : !active ? (
              <EmptyState
                soft
                title="Team messages"
                description="The team channel, or a private message."
              >
                <Button variant="primary" type="button" onClick={() => void openMemberPicker()}>
                  Message a teammate
                </Button>
              </EmptyState>
            ) : (
              <>
                <header>
                  <div>
                    <span className="eyebrow">
                      {active.kind !== "team"
                        ? "Private chat"
                        : activeChannelArchived
                          ? "Archived channel"
                          : "Team channel"}
                    </span>
                    {channelDraft?.mode === "rename" ? (
                      <form
                        className="messages-channel-form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void submitChannelDraft();
                        }}
                      >
                        <input
                          autoFocus
                          value={channelDraft.value}
                          maxLength={60}
                          aria-label="Channel name"
                          onChange={(event) => setChannelDraft({ mode: "rename", value: event.target.value })}
                          onKeyDown={(event) => {
                            if (event.key === "Escape") setChannelDraft(null);
                          }}
                        />
                        <button type="submit" disabled={sending}>
                          Save
                        </button>
                        <button type="button" onClick={() => setChannelDraft(null)}>
                          Cancel
                        </button>
                      </form>
                    ) : (
                      <h1>{labelFor(active)}</h1>
                    )}
                  </div>
                  {active.kind === "team" ? (
                    <div className="messages-channel-actions">
                      <strong className="shared-warning">Visible to all org members</strong>
                      {canManageChannels && !active.isDefaultChannel && !channelDraft ? (
                        <>
                          <button
                            type="button"
                            onClick={() => setChannelDraft({ mode: "rename", value: labelFor(active) })}
                            disabled={sending}
                          >
                            Rename
                          </button>
                          {channelArchiveSupported ? (
                            <button
                              type="button"
                              onClick={() => void setChannelArchived(!activeChannelArchived)}
                              disabled={sending}
                            >
                              {activeChannelArchived ? "Reopen" : "Archive"}
                            </button>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </header>

                {activeChannelArchived ? (
                  <div className="chat-supervision-banner" role="note">
                    <span>Archived channel</span>
                    History stays readable and exportable. Reopen the channel to post again.
                  </div>
                ) : null}

                {active.kind === "dm" && supervisionNotice ? (
                  // No dismiss control by design: the two-adult rule is only meaningful if both
                  // people can see, at all times, who else can read what they write.
                  <div className="chat-supervision-banner" role="note" aria-live="polite">
                    <span>Second adult in this chat</span>
                    {supervisionNotice}
                    <small>
                      Required by your team&rsquo;s chat safety policy. It cannot be turned off from
                      inside this conversation.
                    </small>
                  </div>
                ) : null}

                {active.kind === "team" && pinned.length > 0 ? (
                  <div className="messages-pins" aria-label="Pinned match-day notes">
                    <span className="eyebrow">Pinned notes</span>
                    {pinned.map((item) => (
                      <article key={item.id}>
                        <MessageBody body={item.body} mentions={item.mentions} members={members} />
                        <footer>
                          <small>
                            {item.authorName} · {formatTime(item.pinnedAt ?? item.createdAt)}
                          </small>
                          {pinsSupported ? (
                            <button type="button" onClick={() => void togglePin(item)}>
                              Unpin
                            </button>
                          ) : null}
                        </footer>
                      </article>
                    ))}
                  </div>
                ) : null}

                <div
                  className="messages"
                  ref={messagesRef}
                  onScroll={(event) => {
                    const node = event.currentTarget;
                    stickToBottomRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
                  }}
                >
                  {hasEarlier && messages.length > 0 ? (
                    <Button variant="secondary" type="button" className="messages-load-earlier" onClick={() => void loadEarlier()} disabled={loadingEarlier}>
                      {loadingEarlier ? "Loading earlier messages…" : "Show earlier messages"}
                    </Button>
                  ) : null}
                  {messages.length === 0 ? (
                    <EmptyState
                      soft
                      title="No messages yet"
                      description={
                        active.kind === "team"
                          ? "Message the whole team. Use @name to notify someone."
                          : "Private to the two of you."
                      }
                    />
                  ) : (
                    messages.map((item) =>
                      item.deletedAt ? (
                        <article className="deleted" key={item.id}>
                          <span>deleted · {formatTime(item.createdAt)}</span>
                          <p>
                            <em>Message deleted</em>
                          </p>
                        </article>
                      ) : (
                        <article
                          className={`${item.mine ? "user" : "member"}${item.pinnedAt ? " pinned" : ""}`}
                          key={item.id}
                        >
                          <span>
                            {item.mine ? "You" : item.authorName} · {formatTime(item.createdAt)}
                            {item.pinnedAt ? " · pinned" : ""}
                          </span>
                          <MessageBody body={item.body} mentions={item.mentions} members={members} />
                          {item.objectLink ? (
                            <a className="message-object-link" href={item.objectLink.href ?? "#"}>
                              <span className="message-object-link-kind">
                                {objectTypeLabel(item.objectLink.objectType)}
                              </span>
                              {item.objectLink.label}
                            </a>
                          ) : null}
                          <div className="message-actions">
                            {pinsSupported && active.kind === "team" ? (
                              <button type="button" className="message-pin" onClick={() => void togglePin(item)}>
                                {item.pinnedAt ? "Unpin" : "Pin note"}
                              </button>
                            ) : null}
                            {item.mine ? (
                              <button
                                type="button"
                                className="message-delete"
                                onClick={() => void softDelete(item.id)}
                              >
                                Delete
                              </button>
                            ) : null}
                          </div>
                        </article>
                      ),
                    )
                  )}
                  <div ref={bottomRef} />
                </div>

                <form className="chat-composer" onSubmit={send}>
                  {active.kind === "team" ? (
                    <div className="messages-composer-hint">
                      Team channel · type @ to mention · ↑↓ Enter to pick · Esc to dismiss · link a task,
                      CAD, inventory, or event
                    </div>
                  ) : null}
                  {active.kind === "team" && selectedMentions.length > 0 ? (
                    <div className="messages-mention-chips" aria-label="People mentioned in this draft">
                      {selectedMentions.map((member) => (
                        <span key={member.id} className="messages-mention-chip">
                          @{member.name}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {active.kind === "team" && pendingObjectLink ? (
                    <div className="messages-link-chip-row">
                      <span className="messages-link-chip">
                        <span className="messages-link-chip-kind">
                          {objectTypeLabel(pendingObjectLink.objectType)}
                        </span>
                        {pendingObjectLink.label}
                        <button
                          type="button"
                          className="messages-link-chip-clear"
                          aria-label="Remove linked object"
                          onClick={() => setPendingObjectLink(null)}
                        >
                          ×
                        </button>
                      </span>
                    </div>
                  ) : null}
                  <div className="messages-composer-wrap">
                    {active.kind === "team" && linkPickerOpen ? (
                      <div className="messages-link-picker" role="dialog" aria-label="Link an object">
                        <div className="messages-link-picker-head">
                          {COMPOSER_OBJECT_TYPES.map((type) => (
                            <button
                              key={type}
                              type="button"
                              className={linkPickerType === type ? "active" : undefined}
                              onClick={() => {
                                setLinkPickerType(type);
                                setLinkQuery("");
                              }}
                            >
                              {objectTypeLabel(type)}
                            </button>
                          ))}
                        </div>
                        <input
                          className="messages-link-picker-search"
                          value={linkQuery}
                          onChange={(event) => setLinkQuery(event.target.value)}
                          placeholder={`Search ${objectTypeLabel(linkPickerType).toLowerCase()}…`}
                          aria-label="Search link targets"
                        />
                        <ul className="messages-link-picker-list" role="listbox" aria-label="Link targets">
                          {linkTargets.length === 0 ? (
                            <li className="messages-link-picker-empty">
                              No matches in this organization yet.
                            </li>
                          ) : (
                            linkTargets.map((target) => (
                              <li key={`${target.objectType}-${target.objectId}`}>
                                <button
                                  type="button"
                                  role="option"
                                  onMouseDown={(event) => {
                                    event.preventDefault();
                                    setPendingObjectLink(target);
                                    setLinkPickerOpen(false);
                                    setLinkQuery("");
                                  }}
                                >
                                  <strong>{target.label}</strong>
                                  {target.subtitle ? <small>{target.subtitle}</small> : null}
                                </button>
                              </li>
                            ))
                          )}
                        </ul>
                        <button
                          type="button"
                          className="messages-link-picker-close"
                          onClick={() => setLinkPickerOpen(false)}
                        >
                          Close
                        </button>
                      </div>
                    ) : null}
                    {active.kind === "team" && activeMention ? (
                      mentionSuggestions.length > 0 ? (
                        <ul className="messages-mention-menu" role="listbox" aria-label="Mention teammate">
                          {mentionSuggestions.map((member, index) => (
                            <li key={member.id}>
                              <button
                                type="button"
                                role="option"
                                aria-selected={index === mentionIndex}
                                className={index === mentionIndex ? "active" : undefined}
                                onMouseDown={(event) => {
                                  event.preventDefault();
                                  selectMention(member);
                                }}
                              >
                                <strong>{member.name}</strong>
                                <small>{member.email}</small>
                              </button>
                            </li>
                          ))}
                          <li className="messages-mention-hint" aria-hidden="true">
                            ↑↓ move · Enter or Tab select · Esc dismiss
                          </li>
                        </ul>
                      ) : (
                        <div className="messages-mention-empty" role="status">
                          <p>
                            {members.length === 0
                              ? "No teammates to mention yet — invite under Team admin."
                              : activeMention.query
                                ? `No org member matches @${activeMention.query}`
                                : "Type a name to mention a teammate in this organization."}
                          </p>
                          <small>Esc to dismiss · mentions stay inside this team</small>
                          {members.length === 0 ? (
                            <Button as="a" variant="secondary" href={withOrgHref("/team/admin", orgId)}>
                              Team admin
                            </Button>
                          ) : null}
                        </div>
                      )
                    ) : null}
                    <textarea
                      ref={composerRef}
                      aria-label="Message"
                      value={text}
                      onChange={(event) => {
                        updateComposer(
                          event.target.value,
                          event.target.selectionStart ?? event.target.value.length,
                        );
                      }}
                      onClick={(event) => setComposerCursor(event.currentTarget.selectionStart ?? 0)}
                      onKeyUp={(event) => setComposerCursor(event.currentTarget.selectionStart ?? 0)}
                      onSelect={(event) => setComposerCursor(event.currentTarget.selectionStart ?? 0)}
                      onKeyDown={onComposerKeyDown}
                      disabled={activeChannelArchived}
                      placeholder={
                        activeChannelArchived
                          ? "This channel is archived. Reopen it to post."
                          : active.kind === "team"
                            ? "Message the team… use @name to notify someone"
                            : "Private message…"
                      }
                      maxLength={8000}
                    />
                  </div>
                  {active.kind === "team" ? (
                    <button
                      type="button"
                      className="messages-link-toggle"
                      onClick={() => setLinkPickerOpen((open) => !open)}
                      disabled={sending}
                    >
                      Link
                    </button>
                  ) : null}
                  <button type="submit" disabled={!text.trim() || sending || activeChannelArchived}>
                    Send
                  </button>
                </form>
                {status ? (
                  <p className="chat-status" role="status">
                    {status}
                  </p>
                ) : null}
              </>
            )}
          </section>
        </div>
      )}

      {pickerOpen ? (
        <aside className="memory-panel open messages-member-panel" aria-label="Start private message">
          <button type="button" className="memory-panel-close" onClick={() => setPickerOpen(false)}>
            Close
          </button>
          <span className="eyebrow">Team members</span>
          <p>Pick someone to message.</p>
          {/* A DM refused by the org's chat safety policy fails here, with the picker still open
              and no conversation to render into. Without this the refusal was silent. */}
          {status ? (
            <p className="chat-safety-note" role="status">
              {status}
            </p>
          ) : null}
          {members.length === 0 ? (
            <EmptyState
              soft
              title="No teammates yet"
              description="Invite people under Team admin."
            >
              <Button as="a" variant="secondary" href={withOrgHref("/team/admin", orgId)}>
                Team admin
              </Button>
            </EmptyState>
          ) : (
            members.map((member) => (
              <article key={member.id}>
                <small>{member.role}</small>
                <p>
                  {member.name}
                  <br />
                  <span className="app-muted">{member.email}</span>
                </p>
                <button type="button" onClick={() => void startDm(member.id)} disabled={sending}>
                  Message
                </button>
              </article>
            ))
          )}
        </aside>
      ) : null}
    </main>
  );
}
