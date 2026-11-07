import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanDirectory, serializeDirectoryTree } from '../src/index.js';

async function withFixture(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'sdt-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('scanDirectory returns sorted flat entries with types and sizes', async () => {
  await withFixture(async (root) => {
    await mkdir(join(root, 'b-dir'));
    await mkdir(join(root, 'a-dir'));
    await writeFile(join(root, 'z.txt'), 'zzz');
    await writeFile(join(root, 'a.txt'), 'a');
    await writeFile(join(root, 'a-dir', 'inner.txt'), 'inner');

    const entries = await scanDirectory(root);
    assert.deepEqual(entries, [
      { path: 'a-dir', size: 0, type: 'directory' },
      { path: 'a-dir/inner.txt', size: 5, type: 'file' },
      { path: 'a.txt', size: 1, type: 'file' },
      { path: 'b-dir', size: 0, type: 'directory' },
      { path: 'z.txt', size: 3, type: 'file' },
    ]);
  });
});

test('scanDirectory records symlinks when followSymlinks is false', async () => {
  await withFixture(async (root) => {
    await writeFile(join(root, 'target.txt'), 'target');
    await symlink('target.txt', join(root, 'link.txt'));

    const entries = await scanDirectory(root, { followSymlinks: false });
    const link = entries.find((e) => e.path === 'link.txt');
    assert.ok(link, 'expected link entry');
    assert.equal(link.type, 'symlink');
    assert.equal(link.size, 'target.txt'.length);
  });
});

test('scanDirectory follows symlinks by default', async () => {
  await withFixture(async (root) => {
    await writeFile(join(root, 'target.txt'), 'hello');
    await symlink('target.txt', join(root, 'link.txt'));

    const entries = await scanDirectory(root);
    const link = entries.find((e) => e.path === 'link.txt');
    assert.ok(link, 'expected link entry');
    assert.equal(link.type, 'file');
    assert.equal(link.size, 5);
  });
});

test('scanDirectory records dangling symlinks as symlinks even when following', async () => {
  await withFixture(async (root) => {
    await symlink('missing.txt', join(root, 'dangling.txt'));

    const entries = await scanDirectory(root);
    const link = entries.find((e) => e.path === 'dangling.txt');
    assert.ok(link, 'expected dangling entry');
    assert.equal(link.type, 'symlink');
    assert.equal(link.size, 'missing.txt'.length);
  });
});

test('scanDirectory respects maxDepth', async () => {
  await withFixture(async (root) => {
    await mkdir(join(root, 'a'));
    await mkdir(join(root, 'a', 'b'));
    await writeFile(join(root, 'a', 'b', 'c.txt'), 'deep');

    const entries = await scanDirectory(root, { maxDepth: 0 });
    assert.deepEqual(entries, [{ path: 'a', size: 0, type: 'directory' }]);
  });
});

test('scanDirectory returns empty array for an empty directory', async () => {
  await withFixture(async (root) => {
    const entries = await scanDirectory(root);
    assert.deepEqual(entries, []);
  });
});

test('scanDirectory throws for invalid root', async () => {
  await assert.rejects(() => scanDirectory(''), TypeError);
  await assert.rejects(() => scanDirectory(null), TypeError);
});

test('scanDirectory throws for invalid maxDepth', async () => {
  await withFixture(async (root) => {
    await assert.rejects(() => scanDirectory(root, { maxDepth: -1 }), RangeError);
    await assert.rejects(() => scanDirectory(root, { maxDepth: 1.5 }), TypeError);
  });
});

test('serializeDirectoryTree produces deterministic JSON', async () => {
  await withFixture(async (root) => {
    await mkdir(join(root, 'x'));
    await writeFile(join(root, 'x', 'y.txt'), 'y');

    const json = await serializeDirectoryTree(root, { indent: 0 });
    const parsed = JSON.parse(json);
    assert.deepEqual(parsed, [
      { path: 'x', size: 0, type: 'directory' },
      { path: 'x/y.txt', size: 1, type: 'file' },
    ]);
  });
});

test('serializeDirectoryTree rejects invalid indent', async () => {
  await withFixture(async (root) => {
    await assert.rejects(() => serializeDirectoryTree(root, { indent: -1 }), TypeError);
  });
});

test('scanDirectory does not include the root itself', async () => {
  await withFixture(async (root) => {
    await writeFile(join(root, 'only.txt'), 'x');
    const entries = await scanDirectory(root);
    assert.deepEqual(entries, [{ path: 'only.txt', size: 1, type: 'file' }]);
  });
});
