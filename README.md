# simple-directory-tree

Walks a directory tree and emits a deterministic JSON structure of paths, sizes, and types suitable for snapshot comparison.

```js
import { scanDirectory, serializeDirectoryTree } from 'simple-directory-tree';

// Flat, sorted array of entries.
const entries = await scanDirectory('/some/project');
// [
//   { path: 'src', size: 0, type: 'directory' },
//   { path: 'src/index.js', size: 312, type: 'file' },
//   ...
// ]

// Or get a JSON string directly.
const json = await serializeDirectoryTree('/some/project');
```

## Why this exists

Snapshot tests need a stable representation of a directory tree. The naive approach — walking the tree and emitting whatever order the filesystem returns — produces diffs that depend on inode ordering, which is not portable across machines or filesystems. This library sorts every directory's children before recursing and emits a flat array rather than a nested object, so the output is byte-identical for the same logical tree. The trade-off is that the flat array loses the parent-child relationship that a nested tree would make explicit; callers that need hierarchy can reconstruct it from the path prefixes.

## Edge cases

Symlinks are followed by default, so a symlink to a file is recorded as a `file` with the target's size. If you want to record the link itself, pass `{ followSymlinks: false }`; the entry's `type` becomes `'symlink'` and `size` is the length of the link target string (matching `lstat`). Dangling symlinks are always recorded as `'symlink'` even when following, so they are not silently dropped. Directories are recorded with `size: 0`; the size of a directory is not meaningful for snapshot comparison. `maxDepth` limits recursion, with `0` meaning only the root's direct children. The root itself is never included in the output.
