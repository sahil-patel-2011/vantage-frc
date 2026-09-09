-- Vantage Drive: one file space per team and per person.
--
-- Why this exists: an FRC team today keeps the handbook in someone's Google
-- Drive, the practice-field video on a phone, the pit flyer in Canva, the STEP
-- export in Onshape and the print files on a USB stick. Onboarding a student
-- means fifty accounts. This is the one place — and it shares to any email
-- address with a link, because half the people a team needs to hand a file to
-- (a parent, a sponsor, a judge, a rookie team) will never have a Vantage
-- account.
--
-- It deliberately does NOT duplicate what already exists. Bytes are routed by
-- the existing storage-routing policy (0492): small files land in Postgres
-- bytea, big ones go to the team's paired storage node (0484), and — new here
-- — an S3-compatible object store when the deployment configures one. The
-- Media Library (0483) and the CAD vault (0474) keep their own rows; Drive
-- surfaces them read-only as virtual folders rather than copying bytes.
--
-- SCOPING HONESTY (the part that matters most):
--   A 'team' row is the team's: every member reads it.
--   A 'personal' row belongs to ONE person. Owners and admins do NOT get to
--   read a student's personal space — there is no has_org_role() escape hatch
--   in any personal-scope policy below, on purpose. A minor's private files
--   are not team property, and a product that quietly lets the adults read
--   them should not claim otherwise in its UI. The only way a personal file
--   leaves its owner's hands is a share the owner deliberately creates.

-- ---------------------------------------------------------------------------
-- Folders
-- ---------------------------------------------------------------------------
CREATE TABLE drive_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('team', 'personal')),
  -- NOT NULL exactly when the folder is personal; always NULL for team
  -- folders, so "who may read this" is decidable from the row alone.
  owner_user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES drive_folders(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (btrim(name) <> '' AND char_length(name) <= 200),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (scope = 'team' AND owner_user_id IS NULL)
    OR (scope = 'personal' AND owner_user_id IS NOT NULL)
  )
);

-- Name uniqueness is per parent, and a NULL parent is a distinct namespace per
-- scope/owner — partial indexes because NULLs never collide in a plain UNIQUE.
CREATE UNIQUE INDEX drive_folders_child_name_idx
  ON drive_folders (parent_id, lower(name)) WHERE parent_id IS NOT NULL;
CREATE UNIQUE INDEX drive_folders_team_root_name_idx
  ON drive_folders (org_id, lower(name)) WHERE parent_id IS NULL AND scope = 'team';
CREATE UNIQUE INDEX drive_folders_personal_root_name_idx
  ON drive_folders (org_id, owner_user_id, lower(name)) WHERE parent_id IS NULL AND scope = 'personal';
CREATE INDEX drive_folders_org_scope_idx ON drive_folders (org_id, scope, parent_id);
CREATE INDEX drive_folders_owner_idx ON drive_folders (owner_user_id) WHERE owner_user_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Files
-- ---------------------------------------------------------------------------
CREATE TABLE drive_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('team', 'personal')),
  owner_user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  folder_id uuid REFERENCES drive_folders(id) ON DELETE SET NULL,
  name text NOT NULL CHECK (btrim(name) <> '' AND char_length(name) <= 255),
  -- Free text on purpose: a team's DXF, .f3z, .3mf or .kicad_pcb is a real
  -- file and an allowlist would reject it. The app normalizes and length-caps
  -- it (apps/web/lib/drive/validation.ts); nothing here is ever executed.
  content_type text NOT NULL CHECK (btrim(content_type) <> '' AND char_length(content_type) <= 255),
  -- The six storage-routing classes (apps/web/lib/storage-routing/types.ts).
  content_class text NOT NULL
    CHECK (content_class IN ('video', 'cad', 'archive', 'photo', 'document', 'other')),
  byte_size bigint NOT NULL CHECK (byte_size >= 0),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  storage_location text NOT NULL CHECK (storage_location IN ('db', 'node', 'object')),
  -- Present only for storage_location='db', and NULL until the bytes actually
  -- arrive: 'pending' means we have a row and no content, and the UI says so
  -- rather than showing a file that cannot be opened.
  bytes bytea,
  node_item_id uuid REFERENCES storage_node_items(id) ON DELETE SET NULL,
  object_key text CHECK (object_key IS NULL OR char_length(object_key) BETWEEN 1 AND 1024),
  -- Small in-database JPEG. Generated for images only, and only on the db
  -- path; there is no server-side video transcoding here or anywhere else.
  thumb bytea,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready')),
  uploaded_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK (
    (scope = 'team' AND owner_user_id IS NULL)
    OR (scope = 'personal' AND owner_user_id IS NOT NULL)
  ),
  -- Each storage location carries exactly its own pointer and nothing else.
  --
  -- A 'node' row is allowed a NULL node_item_id, and that is deliberate. The
  -- FK above is ON DELETE SET NULL, and storage_node_items cascades from
  -- storage_nodes — so if the CHECK demanded a pointer here, unpairing a
  -- storage node would fail with a constraint violation and the team could
  -- never remove their own hardware. A node row with no pointer means exactly
  -- one thing: the node that held these bytes is gone. The app says that in
  -- those words rather than making the file disappear, because the person who
  -- uploaded it deserves to know it existed and where it went.
  CHECK (
    (storage_location = 'db' AND node_item_id IS NULL AND object_key IS NULL)
    OR (storage_location = 'node' AND bytes IS NULL AND object_key IS NULL)
    OR (storage_location = 'object' AND object_key IS NOT NULL AND bytes IS NULL AND node_item_id IS NULL)
  ),
  -- A 'ready' db file must actually hold its bytes. No phantom downloads.
  CHECK (status <> 'ready' OR storage_location <> 'db' OR bytes IS NOT NULL),
  -- The db path is capped at the schema ceiling the media library already
  -- uses (0483). The deployed platform cap is lower and is enforced in the
  -- app (apps/web/lib/storage-routing/caps.ts) because it is a Vercel limit,
  -- not a Postgres one.
  CHECK (storage_location <> 'db' OR byte_size <= 104857600)
);

CREATE INDEX drive_files_org_scope_folder_idx
  ON drive_files (org_id, scope, folder_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX drive_files_owner_idx
  ON drive_files (owner_user_id, created_at DESC) WHERE owner_user_id IS NOT NULL;
CREATE INDEX drive_files_org_sha_idx ON drive_files (org_id, sha256);
CREATE INDEX drive_files_trash_idx ON drive_files (org_id, deleted_at) WHERE deleted_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Shares
-- ---------------------------------------------------------------------------
-- A share grant. `kind='link'` is "anyone with the link"; `kind='email'` names
-- one address the link was mailed to (and is what "Shared with me" matches on
-- for people who DO have an account). Either way the opaque token is the whole
-- authorization, so only its sha256 is stored — a database dump does not hand
-- anyone a working link. The plaintext is returned exactly once, at creation.
CREATE TABLE drive_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  file_id uuid REFERENCES drive_files(id) ON DELETE CASCADE,
  folder_id uuid REFERENCES drive_folders(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('link', 'email')),
  -- Lowercased at write time; the recipient's address for an email share.
  email text CHECK (email IS NULL OR (email = lower(email) AND email LIKE '%_@_%' AND char_length(email) <= 320)),
  -- sha256 of a 32-hex token (16 random bytes).
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  note text CHECK (note IS NULL OR char_length(note) <= 2000),
  can_download boolean NOT NULL DEFAULT true,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  use_count integer NOT NULL DEFAULT 0 CHECK (use_count >= 0),
  -- Exactly one target.
  CHECK ((file_id IS NULL) <> (folder_id IS NULL)),
  -- An email share names an address; a link share does not pretend to.
  CHECK ((kind = 'email' AND email IS NOT NULL) OR (kind = 'link' AND email IS NULL))
);

CREATE INDEX drive_shares_file_idx ON drive_shares (file_id) WHERE file_id IS NOT NULL;
CREATE INDEX drive_shares_folder_idx ON drive_shares (folder_id) WHERE folder_id IS NOT NULL;
CREATE INDEX drive_shares_email_idx ON drive_shares (email) WHERE email IS NOT NULL;
CREATE INDEX drive_shares_org_created_idx ON drive_shares (org_id, created_at DESC);

-- The minimum audit that answers "did they ever open it?" — nothing more.
-- No IP, no user agent, no geolocation: we do not need them, so we do not
-- collect them, and the share dialog does not invent a visitor count it
-- cannot back up.
CREATE TABLE drive_share_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  share_id uuid NOT NULL REFERENCES drive_shares(id) ON DELETE CASCADE,
  file_id uuid REFERENCES drive_files(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN ('opened', 'downloaded')),
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX drive_share_events_share_idx ON drive_share_events (share_id, occurred_at DESC);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
ALTER TABLE drive_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE drive_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE drive_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE drive_share_events ENABLE ROW LEVEL SECURITY;

-- Folders -------------------------------------------------------------------
-- Read: the team's folders, plus YOUR OWN personal folders. There is
-- intentionally no owner/admin branch on the personal side.
CREATE POLICY drive_folders_read ON drive_folders FOR SELECT TO vantage_app
  USING (
    is_org_member(org_id)
    AND (scope = 'team' OR owner_user_id = current_app_user_id())
  );

CREATE POLICY drive_folders_insert ON drive_folders FOR INSERT TO vantage_app
  WITH CHECK (
    is_org_member(org_id)
    AND created_by = current_app_user_id()
    AND (
      (scope = 'team' AND owner_user_id IS NULL)
      OR (scope = 'personal' AND owner_user_id = current_app_user_id())
    )
  );

CREATE POLICY drive_folders_update ON drive_folders FOR UPDATE TO vantage_app
  USING (
    is_org_member(org_id)
    AND (
      (scope = 'personal' AND owner_user_id = current_app_user_id())
      OR (scope = 'team' AND (
            created_by = current_app_user_id()
            OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])))
    )
  )
  WITH CHECK (
    is_org_member(org_id)
    AND (
      (scope = 'personal' AND owner_user_id = current_app_user_id())
      OR (scope = 'team' AND owner_user_id IS NULL)
    )
  );

CREATE POLICY drive_folders_delete ON drive_folders FOR DELETE TO vantage_app
  USING (
    is_org_member(org_id)
    AND (
      (scope = 'personal' AND owner_user_id = current_app_user_id())
      OR (scope = 'team' AND (
            created_by = current_app_user_id()
            OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])))
    )
  );

-- Files ---------------------------------------------------------------------
CREATE POLICY drive_files_read ON drive_files FOR SELECT TO vantage_app
  USING (
    is_org_member(org_id)
    AND (scope = 'team' OR owner_user_id = current_app_user_id())
  );

CREATE POLICY drive_files_insert ON drive_files FOR INSERT TO vantage_app
  WITH CHECK (
    is_org_member(org_id)
    AND uploaded_by = current_app_user_id()
    AND (
      (scope = 'team' AND owner_user_id IS NULL)
      OR (scope = 'personal' AND owner_user_id = current_app_user_id())
    )
  );

-- Soft delete, restore, rename and move are all UPDATEs, so this policy is
-- also the delete policy in practice. Team files: the uploader or a lead.
-- Personal files: the owner, and nobody else.
CREATE POLICY drive_files_update ON drive_files FOR UPDATE TO vantage_app
  USING (
    is_org_member(org_id)
    AND (
      (scope = 'personal' AND owner_user_id = current_app_user_id())
      OR (scope = 'team' AND (
            uploaded_by = current_app_user_id()
            OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])))
    )
  )
  WITH CHECK (
    is_org_member(org_id)
    AND (
      (scope = 'personal' AND owner_user_id = current_app_user_id())
      OR (scope = 'team' AND owner_user_id IS NULL)
    )
  );

CREATE POLICY drive_files_delete ON drive_files FOR DELETE TO vantage_app
  USING (
    is_org_member(org_id)
    AND (
      (scope = 'personal' AND owner_user_id = current_app_user_id())
      OR (scope = 'team' AND (
            uploaded_by = current_app_user_id()
            OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])))
    )
  );

-- Shares --------------------------------------------------------------------
-- A share is manageable by the person who made it, and — for TEAM files and
-- folders only — by that file's uploader or an owner/admin. Leads can audit
-- every link that leaves the team's own material. They still cannot see a
-- share of a personal file unless they created it, and the nested lookups run
-- under drive_files/drive_folders RLS, so a personal row is invisible there
-- twice over.
CREATE POLICY drive_shares_read ON drive_shares FOR SELECT TO vantage_app
  USING (
    is_org_member(org_id)
    AND (
      created_by = current_app_user_id()
      OR EXISTS (
        SELECT 1 FROM drive_files f
        WHERE f.id = drive_shares.file_id
          AND f.scope = 'team'
          AND (f.uploaded_by = current_app_user_id()
               OR has_org_role(f.org_id, ARRAY['owner', 'admin']::org_role[]))
      )
      OR EXISTS (
        SELECT 1 FROM drive_folders d
        WHERE d.id = drive_shares.folder_id
          AND d.scope = 'team'
          AND (d.created_by = current_app_user_id()
               OR has_org_role(d.org_id, ARRAY['owner', 'admin']::org_role[]))
      )
    )
  );

CREATE POLICY drive_shares_insert ON drive_shares FOR INSERT TO vantage_app
  WITH CHECK (
    is_org_member(org_id)
    AND created_by = current_app_user_id()
    AND (
      EXISTS (
        SELECT 1 FROM drive_files f
        WHERE f.id = drive_shares.file_id
          AND f.org_id = drive_shares.org_id
          AND f.deleted_at IS NULL
          AND (
            (f.scope = 'personal' AND f.owner_user_id = current_app_user_id())
            OR (f.scope = 'team' AND (f.uploaded_by = current_app_user_id()
                 OR has_org_role(f.org_id, ARRAY['owner', 'admin']::org_role[])))
          )
      )
      OR EXISTS (
        SELECT 1 FROM drive_folders d
        WHERE d.id = drive_shares.folder_id
          AND d.org_id = drive_shares.org_id
          AND (
            (d.scope = 'personal' AND d.owner_user_id = current_app_user_id())
            OR (d.scope = 'team' AND (d.created_by = current_app_user_id()
                 OR has_org_role(d.org_id, ARRAY['owner', 'admin']::org_role[])))
          )
      )
    )
  );

CREATE POLICY drive_shares_update ON drive_shares FOR UPDATE TO vantage_app
  USING (
    is_org_member(org_id)
    AND (
      created_by = current_app_user_id()
      OR EXISTS (
        SELECT 1 FROM drive_files f
        WHERE f.id = drive_shares.file_id
          AND f.scope = 'team'
          AND (f.uploaded_by = current_app_user_id()
               OR has_org_role(f.org_id, ARRAY['owner', 'admin']::org_role[]))
      )
      OR EXISTS (
        SELECT 1 FROM drive_folders d
        WHERE d.id = drive_shares.folder_id
          AND d.scope = 'team'
          AND (d.created_by = current_app_user_id()
               OR has_org_role(d.org_id, ARRAY['owner', 'admin']::org_role[]))
      )
    )
  )
  WITH CHECK (is_org_member(org_id));

-- Note: revoking is an UPDATE (revoked_at), which is what the product actually
-- does — a revoked share stays on the record so "who shared this, and when did
-- we turn it off" has an answer. DELETE exists for genuine cleanup and mirrors
-- the same permissions, folder branch included.
CREATE POLICY drive_shares_delete ON drive_shares FOR DELETE TO vantage_app
  USING (
    is_org_member(org_id)
    AND (
      created_by = current_app_user_id()
      OR EXISTS (
        SELECT 1 FROM drive_files f
        WHERE f.id = drive_shares.file_id
          AND f.scope = 'team'
          AND (f.uploaded_by = current_app_user_id()
               OR has_org_role(f.org_id, ARRAY['owner', 'admin']::org_role[]))
      )
      OR EXISTS (
        SELECT 1 FROM drive_folders d
        WHERE d.id = drive_shares.folder_id
          AND d.scope = 'team'
          AND (d.created_by = current_app_user_id()
               OR has_org_role(d.org_id, ARRAY['owner', 'admin']::org_role[]))
      )
    )
  );

-- Share events: readable by whoever can read the share; written only by the
-- SECURITY DEFINER recorder below (no INSERT policy for vantage_app).
CREATE POLICY drive_share_events_read ON drive_share_events FOR SELECT TO vantage_app
  USING (
    is_org_member(org_id)
    AND EXISTS (SELECT 1 FROM drive_shares s WHERE s.id = drive_share_events.share_id)
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON drive_folders, drive_files, drive_shares
  TO vantage_app, vantage_worker;
GRANT SELECT ON drive_share_events TO vantage_app;
GRANT SELECT, INSERT, DELETE ON drive_share_events TO vantage_worker;

-- ---------------------------------------------------------------------------
-- Upload grants learn a third purpose
-- ---------------------------------------------------------------------------
-- storage_upload_grants (0492) records one single-use direct-to-node upload.
-- Its `purpose` predates Drive and only knew 'library' and 'media'. Drive
-- could have borrowed 'library', but then the audit trail would name the wrong
-- feature for every Drive upload, and `target_id` would point at a row that is
-- not a library_resource. Naming the real thing is cheaper than explaining the
-- lie later.
ALTER TABLE storage_upload_grants DROP CONSTRAINT IF EXISTS storage_upload_grants_purpose_check;
ALTER TABLE storage_upload_grants
  ADD CONSTRAINT storage_upload_grants_purpose_check
  CHECK (purpose IN ('library', 'media', 'drive'));

-- ---------------------------------------------------------------------------
-- Public share resolution (no session, no account)
-- ---------------------------------------------------------------------------
-- Same shape as get_public_form (0601) and the parent view (0471): the opaque
-- token is the entire authorization, the route is allow-listed by a narrow
-- 32-hex regex in apps/web/proxy.ts, and these functions return the minimum
-- and nothing else. In particular they never return bytes, org internals
-- beyond the team's own display name, other files in the space, who uploaded
-- what, or anything at all for a revoked or expired share.

-- What the recipient may see: the file (or the folder's immediate files).
CREATE OR REPLACE FUNCTION resolve_drive_share(candidate_token text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH live AS (
    SELECT s.*
      FROM drive_shares s
     WHERE s.token_hash = encode(digest(candidate_token, 'sha256'), 'hex')
       AND s.revoked_at IS NULL
       AND (s.expires_at IS NULL OR s.expires_at > now())
  )
  SELECT jsonb_build_object(
           'kind', CASE WHEN live.file_id IS NOT NULL THEN 'file' ELSE 'folder' END,
           'canDownload', live.can_download,
           'expiresAt', live.expires_at,
           'note', live.note,
           -- The recipient's own address is deliberately NOT returned. It adds
           -- nothing the reader does not already know, and a forwarded link
           -- would otherwise hand a stranger somebody's email address.
           'orgName', o.name,
           'teamNumber', o.team_number,
           'folderName', d.name,
           'files', COALESCE(
             (SELECT jsonb_agg(
                       jsonb_build_object(
                         'id', f.id,
                         'name', f.name,
                         'contentType', f.content_type,
                         'contentClass', f.content_class,
                         'byteSize', f.byte_size,
                         'hasThumb', f.thumb IS NOT NULL,
                         'createdAt', f.created_at
                       ) ORDER BY f.name)
                FROM drive_files f
               WHERE f.deleted_at IS NULL
                 AND f.status = 'ready'
                 AND (
                   f.id = live.file_id
                   OR (live.folder_id IS NOT NULL AND f.folder_id = live.folder_id)
                 )),
             '[]'::jsonb)
         )
    FROM live
    JOIN organizations o ON o.id = live.org_id
    LEFT JOIN drive_folders d ON d.id = live.folder_id
$$;

-- One file's bytes/pointer for a live share. Separate from the listing so the
-- listing never carries file contents, and so a caller cannot name a file that
-- the share does not actually cover.
CREATE OR REPLACE FUNCTION resolve_drive_share_file(candidate_token text, candidate_file_id uuid)
RETURNS TABLE (
  org_id uuid,
  file_id uuid,
  name text,
  content_type text,
  byte_size bigint,
  storage_location text,
  bytes bytea,
  node_item_id uuid,
  object_key text,
  can_download boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT f.org_id, f.id, f.name, f.content_type, f.byte_size,
         f.storage_location, f.bytes, f.node_item_id, f.object_key,
         s.can_download
    FROM drive_shares s
    JOIN drive_files f
      ON f.deleted_at IS NULL
     AND f.status = 'ready'
     AND (f.id = s.file_id OR (s.folder_id IS NOT NULL AND f.folder_id = s.folder_id))
   WHERE s.token_hash = encode(digest(candidate_token, 'sha256'), 'hex')
     AND s.revoked_at IS NULL
     AND (s.expires_at IS NULL OR s.expires_at > now())
     AND f.id = candidate_file_id
   LIMIT 1
$$;

-- Record one use. VOLATILE because it writes — Postgres refuses DML inside a
-- STABLE function, and this repo has hit that before. Returns nothing and
-- fails silently on a dead token: a share recipient must not be able to probe
-- which tokens exist by watching this call's behaviour.
CREATE OR REPLACE FUNCTION record_drive_share_use(candidate_token text, candidate_action text, candidate_file_id uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target drive_shares%ROWTYPE;
BEGIN
  IF candidate_action NOT IN ('opened', 'downloaded') THEN
    RETURN;
  END IF;

  SELECT * INTO target
    FROM drive_shares
   WHERE token_hash = encode(digest(candidate_token, 'sha256'), 'hex')
     AND revoked_at IS NULL
     AND (expires_at IS NULL OR expires_at > now());

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE drive_shares
     SET last_used_at = now(),
         use_count = use_count + 1
   WHERE id = target.id;

  INSERT INTO drive_share_events (org_id, share_id, file_id, action)
  VALUES (
    target.org_id,
    target.id,
    (SELECT f.id FROM drive_files f
      WHERE f.id = candidate_file_id
        AND f.deleted_at IS NULL
        AND (f.id = target.file_id OR (target.folder_id IS NOT NULL AND f.folder_id = target.folder_id))),
    candidate_action
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- "Shared with me"
-- ---------------------------------------------------------------------------
-- The recipient's side of an email share. This needs SECURITY DEFINER for a
-- reason worth stating: the RLS policies above are written from the SENDER's
-- point of view (creator, uploader, lead), and a recipient may not even be a
-- member of the sending organization. Without this, a share addressed to you
-- would be invisible to you inside the app.
--
-- The address is taken from current_app_user_id() and NEVER from a parameter,
-- so this cannot be used to enumerate somebody else's shares by naming their
-- address. There is deliberately no email argument at all.
CREATE OR REPLACE FUNCTION list_drive_shares_for_me()
RETURNS TABLE (
  share_id uuid,
  note text,
  can_download boolean,
  expires_at timestamptz,
  shared_at timestamptz,
  shared_by_name text,
  org_name text,
  file_id uuid,
  file_name text,
  folder_id uuid,
  folder_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.id, s.note, s.can_download, s.expires_at, s.created_at,
         sender.name, o.name,
         s.file_id, f.name, s.folder_id, d.name
    FROM drive_shares s
    JOIN users me ON me.id = current_app_user_id()
    JOIN organizations o ON o.id = s.org_id
    LEFT JOIN users sender ON sender.id = s.created_by
    LEFT JOIN drive_files f ON f.id = s.file_id AND f.deleted_at IS NULL
    LEFT JOIN drive_folders d ON d.id = s.folder_id
   WHERE s.kind = 'email'
     AND s.email = lower(me.email)
     AND s.revoked_at IS NULL
     AND (s.expires_at IS NULL OR s.expires_at > now())
     AND (s.file_id IS NULL OR f.id IS NOT NULL)
   ORDER BY s.created_at DESC
   LIMIT 200
$$;

-- One file from a share addressed to ME. Same identity check, same minimum
-- return shape as the token resolver — used by the signed-in "Shared with me"
-- rail so a recipient who has an account does not need to dig the emailed
-- link out of their inbox.
CREATE OR REPLACE FUNCTION resolve_drive_share_file_for_me(candidate_share_id uuid, candidate_file_id uuid)
RETURNS TABLE (
  org_id uuid,
  file_id uuid,
  name text,
  content_type text,
  byte_size bigint,
  storage_location text,
  bytes bytea,
  node_item_id uuid,
  object_key text,
  can_download boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT f.org_id, f.id, f.name, f.content_type, f.byte_size,
         f.storage_location, f.bytes, f.node_item_id, f.object_key,
         s.can_download
    FROM drive_shares s
    JOIN users me ON me.id = current_app_user_id()
    JOIN drive_files f
      ON f.deleted_at IS NULL
     AND f.status = 'ready'
     AND (f.id = s.file_id OR (s.folder_id IS NOT NULL AND f.folder_id = s.folder_id))
   WHERE s.id = candidate_share_id
     AND s.kind = 'email'
     AND s.email = lower(me.email)
     AND s.revoked_at IS NULL
     AND (s.expires_at IS NULL OR s.expires_at > now())
     AND f.id = candidate_file_id
   LIMIT 1
$$;

-- The files a share addressed to ME covers (a single file, or a folder's
-- immediate contents) — the listing the "Shared with me" rail expands.
CREATE OR REPLACE FUNCTION list_drive_share_files_for_me(candidate_share_id uuid)
RETURNS TABLE (
  file_id uuid,
  name text,
  content_type text,
  content_class text,
  byte_size bigint,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT f.id, f.name, f.content_type, f.content_class, f.byte_size, f.created_at
    FROM drive_shares s
    JOIN users me ON me.id = current_app_user_id()
    JOIN drive_files f
      ON f.deleted_at IS NULL
     AND f.status = 'ready'
     AND (f.id = s.file_id OR (s.folder_id IS NOT NULL AND f.folder_id = s.folder_id))
   WHERE s.id = candidate_share_id
     AND s.kind = 'email'
     AND s.email = lower(me.email)
     AND s.revoked_at IS NULL
     AND (s.expires_at IS NULL OR s.expires_at > now())
   ORDER BY f.name
   LIMIT 500
$$;

REVOKE ALL ON FUNCTION list_drive_shares_for_me() FROM PUBLIC;
REVOKE ALL ON FUNCTION resolve_drive_share_file_for_me(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION list_drive_share_files_for_me(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_drive_shares_for_me() TO vantage_app;
GRANT EXECUTE ON FUNCTION resolve_drive_share_file_for_me(uuid, uuid) TO vantage_app;
GRANT EXECUTE ON FUNCTION list_drive_share_files_for_me(uuid) TO vantage_app;

REVOKE ALL ON FUNCTION resolve_drive_share(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION resolve_drive_share_file(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION record_drive_share_use(text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_drive_share(text) TO vantage_app, vantage_worker;
GRANT EXECUTE ON FUNCTION resolve_drive_share_file(text, uuid) TO vantage_app, vantage_worker;
GRANT EXECUTE ON FUNCTION record_drive_share_use(text, text, uuid) TO vantage_app, vantage_worker;
