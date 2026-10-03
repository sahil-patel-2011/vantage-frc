-- Private chat could not store the AI's reply.
--
-- The assistant's message has no author (author_user_id IS NULL). messages_insert (0011)
-- accepted that in a team thread but required author_user_id = the caller in a private
-- one, so every private turn ended in "new row violates row-level security policy for
-- table agent_messages" after the provider had already answered. It went unseen because
-- it needs a working provider key to get that far.
--
-- A private thread now accepts an author-less row only when it is the assistant's, in a
-- thread the caller created, and not shared. Nothing else is loosened.
--
-- The thread/message org match is also qualified. Written as "t.org_id = org_id" inside the
-- subquery it resolved to t.org_id = t.org_id, which is always true.

DROP POLICY messages_insert ON agent_messages;
CREATE POLICY messages_insert ON agent_messages FOR INSERT TO vantage_app WITH CHECK (
  is_org_member(org_id) AND EXISTS (
    SELECT 1 FROM agent_threads t
    WHERE t.id = agent_messages.thread_id
      AND t.org_id = agent_messages.org_id
      AND (
        (
          t.scope = 'private'
          AND t.created_by = current_app_user_id()
          AND NOT agent_messages.explicitly_shared
          AND (
            agent_messages.author_user_id = current_app_user_id()
            OR (agent_messages.author_user_id IS NULL AND agent_messages.role = 'assistant')
          )
        )
        OR (
          t.scope = 'team'
          AND (agent_messages.author_user_id = current_app_user_id() OR agent_messages.author_user_id IS NULL)
          AND agent_messages.explicitly_shared
        )
      )
  )
);
