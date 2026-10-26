/**
 * One catalog read for the chat features that otherwise probe information_schema
 * one table at a time, each inside its own savepoint.
 */

import type { PoolClient } from "@neondatabase/serverless";
import { rememberChannelArchive, channelArchiveCached } from "./channels";
import { rememberTeamChatFlag, rememberYouthProtection, teamChatFlagCached, youthProtectionSupportCached } from "./supervision";

let messagePinsCache: boolean | null = null;
let messageMentionsCache: boolean | null = null;
let objectLinksCache: boolean | null = null;
let priming: Promise<void> | null = null;

export function messagePinsCached(): boolean | null {
  return messagePinsCache;
}

export function messageMentionsCached(): boolean | null {
  return messageMentionsCache;
}

export function messageObjectLinksCached(): boolean | null {
  return objectLinksCache;
}

export function rememberMessagePins(value: boolean): void {
  messagePinsCache = value;
}

export function rememberMessageMentions(value: boolean): void {
  messageMentionsCache = value;
}

export function rememberObjectLinks(value: boolean): void {
  objectLinksCache = value;
}

function schemaKnown(): boolean {
  return (
    youthProtectionSupportCached() != null &&
    teamChatFlagCached() != null &&
    channelArchiveCached() != null &&
    messagePinsCache != null &&
    messageMentionsCache != null &&
    objectLinksCache != null
  );
}

/** Fills every chat capability cache. A second caller in the same turn shares the read. */
export function primeChatSchema(client: PoolClient): Promise<void> {
  if (schemaKnown()) return Promise.resolve();
  if (!priming) {
    priming = client
      .query<{
        youthProtection: boolean;
        teamChatColumn: boolean;
        channelArchive: boolean;
        messagePins: boolean;
        messageMentions: boolean;
        objectLinks: boolean;
      }>(
        `SELECT
           (
             EXISTS (
               SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = 'org_chat_policy'
             )
             AND EXISTS (
               SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = 'org_conversation_supervisors'
             )
           ) AS "youthProtection",
           EXISTS (
             SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'org_chat_policy' AND column_name = 'team_chat_enabled'
           ) AS "teamChatColumn",
           EXISTS (
             SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'org_conversations' AND column_name = 'archived_at'
           ) AS "channelArchive",
           EXISTS (
             SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'org_messages' AND column_name = 'pinned_at'
           ) AS "messagePins",
           EXISTS (
             SELECT 1 FROM information_schema.tables
              WHERE table_schema = 'public' AND table_name = 'org_message_mentions'
           ) AS "messageMentions",
           EXISTS (
             SELECT 1 FROM information_schema.tables
              WHERE table_schema = 'public' AND table_name = 'org_message_object_links'
           ) AS "objectLinks"`,
      )
      .then((result) => {
        const row = result.rows[0];
        rememberYouthProtection(row?.youthProtection === true);
        rememberTeamChatFlag(row?.teamChatColumn === true);
        rememberChannelArchive(row?.channelArchive === true);
        messagePinsCache = row?.messagePins === true;
        messageMentionsCache = row?.messageMentions === true;
        objectLinksCache = row?.objectLinks === true;
      })
      .finally(() => {
        priming = null;
      });
  }
  return priming;
}
