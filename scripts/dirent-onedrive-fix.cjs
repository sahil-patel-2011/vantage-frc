/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS preload; loaded via NODE_OPTIONS --require before any ESM exists. */
/**
 * Node 24 + OneDrive known-folder backup: every file carries a cloud reparse
 * tag, and fs.readdir({ withFileTypes: true }) reports it as a symbolic link
 * (isFile() === false). Next's app-router discovery and Playwright's test
 * collector both trust Dirent, so they see an empty tree.
 *
 * Preload with NODE_OPTIONS="--require ./scripts/dirent-onedrive-fix.cjs".
 * Falls back to a real stat() for reparse entries only; everything else is
 * untouched.
 */
const fs = require("node:fs");
const path = require("node:path");

const proto = fs.Dirent && fs.Dirent.prototype;
if (proto && !proto.__onedriveFixed) {
  const origIsFile = proto.isFile;
  const origIsDirectory = proto.isDirectory;
  const origIsSymbolicLink = proto.isSymbolicLink;

  function resolved(dirent) {
    if (dirent.__stat !== undefined) return dirent.__stat;
    const parent = dirent.parentPath || dirent.path;
    if (!parent || !origIsSymbolicLink.call(dirent)) {
      dirent.__stat = null;
      return null;
    }
    try {
      const st = fs.statSync(path.join(parent, dirent.name));
      // Only claim it is a regular entry if the reparse resolves to one.
      dirent.__stat = st.isFile() || st.isDirectory() ? st : null;
    } catch {
      dirent.__stat = null;
    }
    return dirent.__stat;
  }

  proto.isFile = function isFile() {
    const st = resolved(this);
    return st ? st.isFile() : origIsFile.call(this);
  };
  proto.isDirectory = function isDirectory() {
    const st = resolved(this);
    return st ? st.isDirectory() : origIsDirectory.call(this);
  };
  proto.isSymbolicLink = function isSymbolicLink() {
    const st = resolved(this);
    return st ? false : origIsSymbolicLink.call(this);
  };
  Object.defineProperty(proto, "__onedriveFixed", { value: true });
}
