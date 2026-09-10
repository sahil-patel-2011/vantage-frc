-- Copy ready Team Library rows into Drive so /library can stay a redirect
-- and students look in one place. Restricted library grants are NOT copied
-- into team-scope Drive files — those stay in the virtual "Team Library"
-- folder until an owner re-shares them. Node-backed library files are skipped
-- because library_resources.node_item_id is text and drive_files.node_item_id
-- is a uuid FK to storage_node_items.

INSERT INTO drive_folders (org_id, scope, owner_user_id, parent_id, name, created_by)
SELECT s.org_id, 'team', NULL, NULL, 'From Team Library', s.created_by
FROM (
  SELECT DISTINCT r.org_id,
    COALESCE(
      (
        SELECT m.user_id
        FROM memberships m
        WHERE m.org_id = r.org_id AND m.role = 'owner'
        LIMIT 1
      ),
      (
        SELECT r2.created_by
        FROM library_resources r2
        WHERE r2.org_id = r.org_id
        ORDER BY r2.created_at
        LIMIT 1
      )
    ) AS created_by
  FROM library_resources r
  WHERE r.status = 'ready'
) s
WHERE s.created_by IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM drive_folders d
    WHERE d.org_id = s.org_id
      AND d.scope = 'team'
      AND d.parent_id IS NULL
      AND lower(d.name) = 'from team library'
  );

-- Links become text/uri-list files (bytes = the URL). Team-wide only.
INSERT INTO drive_files (
  org_id, scope, owner_user_id, folder_id, name, content_type, content_class,
  byte_size, sha256, storage_location, bytes, status, uploaded_by
)
SELECT
  r.org_id,
  'team',
  NULL,
  d.id,
  left(r.title, 255),
  'text/uri-list',
  'document',
  octet_length(convert_to(r.url, 'UTF8')),
  encode(digest(r.url, 'sha256'), 'hex'),
  'db',
  convert_to(r.url, 'UTF8'),
  'ready',
  r.created_by
FROM library_resources r
JOIN drive_folders d
  ON d.org_id = r.org_id
 AND d.scope = 'team'
 AND d.parent_id IS NULL
 AND lower(d.name) = 'from team library'
WHERE r.kind = 'link'
  AND r.status = 'ready'
  AND r.url IS NOT NULL
  AND r.visibility = 'team'
  AND NOT EXISTS (
    SELECT 1
    FROM drive_files f
    WHERE f.org_id = r.org_id
      AND f.folder_id = d.id
      AND f.sha256 = encode(digest(r.url, 'sha256'), 'hex')
      AND f.deleted_at IS NULL
  );

-- Database-backed files copy their bytes. Node items stay in the virtual folder.
INSERT INTO drive_files (
  org_id, scope, owner_user_id, folder_id, name, content_type, content_class,
  byte_size, sha256, storage_location, bytes, status, uploaded_by
)
SELECT
  r.org_id,
  'team',
  NULL,
  d.id,
  left(COALESCE(r.file_name, r.title), 255),
  r.content_type,
  CASE
    WHEN r.content_type LIKE 'video/%' THEN 'video'
    WHEN r.content_type LIKE 'image/%' THEN 'photo'
    WHEN r.content_type LIKE '%zip%' OR r.content_type LIKE '%gzip%' OR r.content_type LIKE '%tar%' THEN 'archive'
    WHEN r.content_type LIKE '%step%' OR r.content_type LIKE '%cad%' OR r.content_type LIKE '%stl%' THEN 'cad'
    WHEN r.content_type LIKE 'application/pdf' OR r.content_type LIKE 'text/%' THEN 'document'
    ELSE 'other'
  END,
  r.byte_size,
  r.sha256,
  'db',
  r.bytes,
  'ready',
  r.created_by
FROM library_resources r
JOIN drive_folders d
  ON d.org_id = r.org_id
 AND d.scope = 'team'
 AND d.parent_id IS NULL
 AND lower(d.name) = 'from team library'
WHERE r.kind = 'file'
  AND r.status = 'ready'
  AND r.storage_location = 'db'
  AND r.bytes IS NOT NULL
  AND r.sha256 IS NOT NULL
  AND r.byte_size IS NOT NULL
  AND r.content_type IS NOT NULL
  AND r.visibility = 'team'
  AND NOT EXISTS (
    SELECT 1
    FROM drive_files f
    WHERE f.org_id = r.org_id
      AND f.folder_id = d.id
      AND f.sha256 = r.sha256
      AND f.deleted_at IS NULL
  );
