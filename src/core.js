import { readdir, stat, lstat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

/**
 * Recursively walks a directory and returns a deterministic array of entries.
 *
 * Determinism is achieved by sorting entries by their POSIX-style relative path
 * (forward slashes) at every level, so the output does not depend on the order
 * the filesystem returns names. This matters for snapshot comparison: two
 * checkouts of the same tree must produce byte-identical JSON.
 *
 * We follow symlinks by default because a snapshot of a source tree usually
 * wants to see what the files resolve to. Pass `followSymlinks: false` to record
 * the link itself; in that case the `type` is `'symlink'` and `size` is the
 * length of the link target string, matching `lstat` semantics.
 *
 * @param {string} root - Directory to scan.
 * @param {object} [options]
 * @param {boolean} [options.followSymlinks=true] - Resolve symlinks instead of recording them.
 * @param {number} [options.maxDepth=Infinity] - Maximum recursion depth. 0 means only the root's direct children.
 * @returns {Promise<Array<{path: string, size: number, type: 'file'|'directory'|'symlink'}>>}
 */
export async function scanDirectory(root, options = {}) {
  const followSymlinks = options.followSymlinks !== false;
  const maxDepth = options.maxDepth === undefined ? Infinity : options.maxDepth;

  if (typeof root !== 'string' || root.length === 0) {
    throw new TypeError('root must be a non-empty string');
  }
  if (!Number.isInteger(maxDepth) && maxDepth !== Infinity) {
    throw new TypeError('maxDepth must be an integer or Infinity');
  }
  if (maxDepth < 0) {
    throw new RangeError('maxDepth must be >= 0');
  }

  const results = [];
  await walk(root, '', 0);

  // The recursive walk already sorts each directory's children, but sorting the
  // flattened list again makes the guarantee explicit and cheap for typical trees.
  results.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return results;

  async function walk(absDir, relDir, depth) {
    let names;
    try {
      names = await readdir(absDir);
    } catch (err) {
      if (err && err.code === 'ENOENT') return;
      throw err;
    }
    names.sort();

    for (const name of names) {
      const absChild = join(absDir, name);
      const relChild = relDir === '' ? name : `${relDir}/${name}`;

      let stats;
      if (followSymlinks) {
        try {
          stats = await stat(absChild);
        } catch (err) {
          if (err && err.code === 'ENOENT') {
            // Dangling symlink with followSymlinks=true: record it as a symlink
            // so the snapshot still mentions it rather than silently dropping it.
            const linkStats = await lstat(absChild);
            results.push({
              path: relChild,
              size: linkStats.size,
              type: 'symlink',
            });
            continue;
          }
          throw err;
        }
      } else {
        stats = await lstat(absChild);
      }

      if (stats.isDirectory()) {
        results.push({ path: relChild, size: 0, type: 'directory' });
        if (depth < maxDepth) {
          await walk(absChild, relChild, depth + 1);
        }
      } else if (stats.isFile()) {
        results.push({ path: relChild, size: stats.size, type: 'file' });
      } else if (stats.isSymbolicLink()) {
        results.push({ path: relChild, size: stats.size, type: 'symlink' });
      } else {
        // Sockets, FIFOs, block devices: record them as 'file' with their stat
        // size. They are rare in snapshots but should not abort the walk.
        results.push({ path: relChild, size: stats.size, type: 'file' });
      }
    }
  }
}

/**
 * Serializes a directory tree to a JSON string.
 *
 * The JSON shape is intentionally a flat array of `{path, size, type}` objects
 * rather than a nested tree. Flat arrays are easier to diff with line-oriented
 * tools and avoid ambiguity about key ordering in nested objects.
 *
 * @param {string} root - Directory to scan.
 * @param {object} [options] - Same options as `scanDirectory`.
 * @param {number} [options.indent=2] - JSON indentation; 0 for compact output.
 * @returns {Promise<string>}
 */
export async function serializeDirectoryTree(root, options = {}) {
  const indent = options.indent === undefined ? 2 : options.indent;
  if (!Number.isInteger(indent) || indent < 0) {
    throw new TypeError('indent must be a non-negative integer');
  }
  const entries = await scanDirectory(root, options);
  return JSON.stringify(entries, null, indent);
}
