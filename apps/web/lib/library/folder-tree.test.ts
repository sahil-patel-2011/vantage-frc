import { describe, expect, it } from "vitest";
import {
  buildFolderTree,
  flattenFolderTree,
  folderPath,
  folderSubtreeIds,
  wouldCreateCycle,
  type FolderLike,
} from "./folder-tree";

const folder = (id: string, parentId: string | null, name = id): FolderLike => ({
  id,
  parentId,
  name,
});

describe("buildFolderTree", () => {
  it("nests children under parents and sorts siblings by name", () => {
    const roots = buildFolderTree([
      folder("b", null, "Bravo"),
      folder("a", null, "alpha"),
      folder("a1", "a", "Inner"),
    ]);
    expect(roots.map((node) => node.folder.id)).toEqual(["a", "b"]);
    expect(roots[0]!.children.map((node) => node.folder.id)).toEqual(["a1"]);
    expect(roots[0]!.children[0]!.depth).toBe(1);
  });

  it("keeps a visible child of a hidden parent reachable at the root", () => {
    // RLS can hide a restricted parent while its team-wide child stays visible.
    const roots = buildFolderTree([folder("child", "hidden-parent", "Orphan")]);
    expect(roots.map((node) => node.folder.id)).toEqual(["child"]);
    expect(roots[0]!.depth).toBe(0);
  });

  it("treats a corrupt self-parent row as a root instead of looping", () => {
    const roots = buildFolderTree([folder("x", "x", "Self")]);
    expect(roots).toHaveLength(1);
    expect(roots[0]!.children).toHaveLength(0);
  });
});

describe("wouldCreateCycle", () => {
  const chain = [folder("root", null), folder("mid", "root"), folder("leaf", "mid")];

  it("refuses a folder as its own parent", () => {
    expect(wouldCreateCycle(chain, "root", "root")).toBe(true);
  });

  it("refuses moving a folder under its own descendant", () => {
    expect(wouldCreateCycle(chain, "root", "leaf")).toBe(true);
    expect(wouldCreateCycle(chain, "root", "mid")).toBe(true);
  });

  it("allows moving to the root or under an unrelated folder", () => {
    expect(wouldCreateCycle(chain, "leaf", null)).toBe(false);
    expect(wouldCreateCycle([...chain, folder("other", null)], "leaf", "other")).toBe(false);
  });

  it("allows a parent chain that leaves the visible set", () => {
    // The chain walks into a hidden folder and stops; the DB trigger stays
    // authoritative for this case.
    expect(wouldCreateCycle([folder("a", "hidden")], "b", "a")).toBe(false);
  });

  it("refuses when the visible chain is corrupt (loops without reaching the folder)", () => {
    const loop = [folder("p", "q"), folder("q", "p")];
    expect(wouldCreateCycle(loop, "z", "p")).toBe(true);
  });
});

describe("folderSubtreeIds", () => {
  it("collects the folder and every descendant", () => {
    const folders = [
      folder("root", null),
      folder("a", "root"),
      folder("b", "a"),
      folder("stranger", null),
    ];
    expect([...folderSubtreeIds(folders, "root")].sort()).toEqual(["a", "b", "root"]);
    expect([...folderSubtreeIds(folders, "b")]).toEqual(["b"]);
  });
});

describe("folderPath", () => {
  const folders = [folder("root", null, "Root"), folder("mid", "root", "Mid"), folder("leaf", "mid", "Leaf")];

  it("walks from the root to the folder", () => {
    expect(folderPath(folders, "leaf").map((f) => f.name)).toEqual(["Root", "Mid", "Leaf"]);
  });

  it("returns an empty trail for the library root", () => {
    expect(folderPath(folders, null)).toEqual([]);
  });

  it("truncates at a hidden ancestor instead of failing", () => {
    expect(folderPath([folder("leaf", "hidden", "Leaf")], "leaf").map((f) => f.name)).toEqual(["Leaf"]);
  });
});

describe("flattenFolderTree", () => {
  it("emits depth-first rows with depths for indented pickers", () => {
    const roots = buildFolderTree([
      folder("a", null, "A"),
      folder("a1", "a", "A1"),
      folder("b", null, "B"),
    ]);
    expect(flattenFolderTree(roots).map((row) => [row.folder.id, row.depth])).toEqual([
      ["a", 0],
      ["a1", 1],
      ["b", 0],
    ]);
  });
});
