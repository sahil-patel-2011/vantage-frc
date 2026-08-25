/**
 * Pure folder-tree helpers for the Team Library. RLS means a member may see a
 * folder whose parent is hidden (restricted), so tree building must never
 * lose such orphans — they surface at the root instead.
 */

export type FolderLike = {
  id: string;
  parentId: string | null;
  name: string;
};

export type FolderTreeNode<T extends FolderLike = FolderLike> = {
  folder: T;
  children: FolderTreeNode<T>[];
  depth: number;
};

/**
 * Builds a navigable tree from the RLS-visible folder list. Folders whose
 * parent is not in the list (hidden or deleted) attach to the root so every
 * visible folder stays reachable. Siblings sort by name.
 */
export function buildFolderTree<T extends FolderLike>(folders: T[]): FolderTreeNode<T>[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const nodes = new Map<string, FolderTreeNode<T>>(
    folders.map((folder) => [folder.id, { folder, children: [], depth: 0 }]),
  );
  const roots: FolderTreeNode<T>[] = [];

  for (const folder of folders) {
    const node = nodes.get(folder.id)!;
    const parent = folder.parentId ? nodes.get(folder.parentId) : undefined;
    // A self-parent row is corrupt; treat it as a root rather than looping.
    if (parent && byId.has(folder.parentId!) && folder.parentId !== folder.id) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortChildren = (list: FolderTreeNode<T>[], depth: number) => {
    list.sort((a, b) => a.folder.name.localeCompare(b.folder.name, undefined, { sensitivity: "base" }));
    for (const node of list) {
      node.depth = depth;
      sortChildren(node.children, depth + 1);
    }
  };
  sortChildren(roots, 0);
  return roots;
}

/**
 * Would re-parenting `folderId` under `newParentId` create a cycle? Mirrors
 * the SECURITY DEFINER trigger in migration 0489 for instant client feedback;
 * the trigger stays authoritative because it sees hidden intermediate folders.
 */
export function wouldCreateCycle(
  folders: FolderLike[],
  folderId: string,
  newParentId: string | null,
): boolean {
  if (!newParentId) return false;
  if (newParentId === folderId) return true;
  const parentOf = new Map(folders.map((folder) => [folder.id, folder.parentId]));
  let current: string | null | undefined = newParentId;
  let hops = 0;
  while (current) {
    if (current === folderId) return true;
    hops += 1;
    if (hops > 100) return true; // corrupt chain — refuse rather than loop
    current = parentOf.get(current);
  }
  return false;
}

/** Ids of `folderId` plus every visible descendant (for move-target pickers). */
export function folderSubtreeIds(folders: FolderLike[], folderId: string): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const folder of folders) {
    if (!folder.parentId) continue;
    const list = childrenOf.get(folder.parentId);
    if (list) list.push(folder.id);
    else childrenOf.set(folder.parentId, [folder.id]);
  }
  const ids = new Set<string>([folderId]);
  const queue = [folderId];
  while (queue.length) {
    const next = queue.pop()!;
    for (const child of childrenOf.get(next) ?? []) {
      if (!ids.has(child)) {
        ids.add(child);
        queue.push(child);
      }
    }
  }
  return ids;
}

/**
 * Breadcrumb from the root to `folderId` using only visible folders; a hidden
 * ancestor simply truncates the trail (the visible part is still honest).
 */
export function folderPath<T extends FolderLike>(folders: T[], folderId: string | null): T[] {
  if (!folderId) return [];
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const path: T[] = [];
  let current = byId.get(folderId);
  let hops = 0;
  while (current && hops <= 100) {
    path.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
    hops += 1;
  }
  return path;
}

/** Flattened tree (depth-first) for indent-style folder pickers. */
export function flattenFolderTree<T extends FolderLike>(
  roots: FolderTreeNode<T>[],
): Array<{ folder: T; depth: number }> {
  const out: Array<{ folder: T; depth: number }> = [];
  const walk = (nodes: FolderTreeNode<T>[]) => {
    for (const node of nodes) {
      out.push({ folder: node.folder, depth: node.depth });
      walk(node.children);
    }
  };
  walk(roots);
  return out;
}
