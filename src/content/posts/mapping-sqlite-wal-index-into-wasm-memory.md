---
title: "Mapping SQLite's WAL-Index into WebAssembly Memory"
author: franchb
pubDatetime: 2026-10-28T08:00:00Z
featured: true
draft: false
tags:
  - golang
  - sqlite
  - webassembly
  - databases
  - open-source
description: "A Windows-only WAL corruption bug in the cgo-free go-sqlite3 driver — traced from my issue #404 and PR #405 to the maintainer's PR #413 — and why mapping the wal-index directly into WebAssembly linear memory is the correct fix."
ogImage: ../../assets/images/wal-index-wasm-memory.png
---

[go-sqlite3](https://github.com/ncruces/go-sqlite3) is a lovely piece of engineering: a SQLite driver for Go that uses no cgo. Instead of linking `libsqlite3`, it compiles SQLite to WebAssembly and then uses [wasm2go](https://github.com/ncruces/wasm2go) to translate that module into plain Go source. The whole database engine — the pager, the b-trees, the WAL machinery — runs as Go code whose entire world is one big `[]byte`: the module's **linear memory**.

That design is elegant until SQLite asks for something a Wasm sandbox can't easily give it: **genuinely shared memory**. In WAL mode, every connection to a database must see the same live wal-index. On Windows, go-sqlite3 faked that shared memory with a per-connection copy — and under concurrent writers across a connection pool, the fake sprang a leak. Databases corrupted.

This is the story of that bug, from the [issue I filed (#404)](https://github.com/ncruces/go-sqlite3/issues/404) through [the fix I proposed (#405)](https://github.com/ncruces/go-sqlite3/pull/405) to [the fix that actually shipped (#413)](https://github.com/ncruces/go-sqlite3/pull/413) — and an honest look at why the maintainer's version superseded mine.

## Table of contents

## cgo-free SQLite lives in linear memory

To run SQLite without cgo, go-sqlite3 compiles the amalgamation to `wasm32` and translates the module to Go with wasm2go. (Older releases executed the same module in the [wazero](https://wazero.io) runtime; the project [switched to wasm2go](https://github.com/ncruces/go-sqlite3/pull/362) in March 2026, months before this bug.) Either way, SQLite's memory is a Go `[]byte` (`Memory.Buf` in `internal/sqlite3_wrap`). SQLite is written to be portable: everything it does to the outside world — opening files, reading and writing pages, locking, shared memory — goes through a VFS (Virtual File System), a struct of function pointers SQLite calls into. Normally that VFS is C (`os_unix.c`, `os_win.c`). Here it is _Go_: `vfs/os_windows.go`, `vfs/shm_windows.go`, and the low-level memory plumbing in `internal/sqlite3_wrap`.

There is one hard constraint that colors everything. The translated C code can only address the module's linear memory. So **any memory SQLite touches has to live inside that `[]byte`** — including the shared-memory wal-index. You cannot just hand SQLite a pointer to some OS shared-memory segment; the pointer has to be an offset into linear memory. Remember this constraint. It is the entire reason the bug exists, and the entire shape of the fix.

## WAL mode and the shared wal-index

In [WAL mode](https://www.sqlite.org/wal.html), writers append new page images to a `-wal` file instead of overwriting the main database in place. Readers reconstruct the current database by consulting the WAL for pages that have been changed. To make "is this page in the WAL, and at which frame?" fast, SQLite maintains the **wal-index**: a hash lookup kept in a shared-memory file conventionally named `-shm`.

The wal-index is accessed through two VFS callbacks on [`sqlite3_io_methods`](https://www.sqlite.org/c3ref/io_methods.html): `xShmMap` maps a region of the `-shm` into the process's address space, and `xShmLock` takes byte-range locks that coordinate access. The critical property — the one the whole design leans on — is that the wal-index is **real, shared, live memory**. When one connection publishes a new WAL frame, other connections in the same process see it through their own mapping of the same memory. `wal.c` synchronizes with lightweight memory barriers (`xShmBarrier`), not with an explicit "flush my copy to everyone" step, because it assumes there is only ever _one_ copy.

## The bug: emulated shared memory goes stale

I hit this while stress-testing a pooled writer workload on Windows. Reduced, [#404](https://github.com/ncruces/go-sqlite3/issues/404) looks like this:

```go
db, _ := sql.Open("sqlite3",
  "file:app.db?_pragma=journal_mode(wal)&_pragma=busy_timeout(10000)&_pragma=synchronous(normal)")
db.SetMaxOpenConns(64) // N > 1 is the trigger

var wg sync.WaitGroup
for w := 0; w < 64; w++ {
  wg.Add(1)
  go func() {
    defer wg.Done()
    for i := 0; i < 2000; i++ {
      tx, _ := db.Begin() // BEGIN DEFERRED
      // insert a parent row, then a child row (~8 KiB blob) that references it
      tx.Commit()
      if i%25 == 0 {
        db.Exec("PRAGMA wal_checkpoint(TRUNCATE)")
      }
    }
  }()
}
wg.Wait()
```

Sixty-four goroutines, one `*sql.DB`, ordinary deferred-transaction writers that serialize on the WAL write-lock via `busy_timeout`. Nothing exotic. On Windows Server 2022 it corrupted the database on every run (3/3). The failures were the scary kind:

```
sqlite3: file is not a database
sqlite3: database disk image is malformed
SQLITE_PROTOCOL (locking protocol)
```

And an `integrity_check` that came back with structural b-tree damage:

```
wrong # of entries in index child_parent_idx
Tree 5 page 18419 cell 2: overflow list length is 1 but should be 2
```

The tell was the platform matrix. The exact same Go code ran clean on Linux (`RESULT=CLEAN`), and native C SQLite — using its own `os_win.c` VFS — sailed through the identical workload with `integrity_check = ok` every time. So this was not SQLite, and it was not my schema. It was go-sqlite3's Windows VFS.

My first suspicion was the file locking — `LockFileEx`/`UnlockFileEx` in `vfs/os_windows.go`, or the `-shm` handling in `vfs/shm_windows.go`. But the locks turned out to be correct. The lie was one level down, in the shared _memory_.

On Windows (and in the `sqlite3_dotlk` build), go-sqlite3 could not map the real `-shm` into linear memory, so it emulated it: each connection kept a private, per-connection copy of the wal-index and reconciled it with the on-disk `-shm` only at `xShmLock`/`xShmUnlock` boundaries. But `wal.c` reads and writes the wal-index between those lock calls, and it relies on seeing other connections' updates _live_. The most likely mechanism: under concurrent writers, a checkpointer working from a stale copy backfills outdated page images into the main database and truncates WAL frames that were never backfilled, corrupting the file on disk. The `SQLITE_PROTOCOL` storms fit the same staleness, showing up as apparent lock-protocol violations. I never captured a trace that proves this exact interleaving; what is established is that removing the copy removed the corruption.

![Two-panel diagram. Left, "before": connections A and B each hold a private -shm copy, synced only at xShmLock, reading stale data between locks, ending in "database disk image is malformed." Right, "after": both connections map one shared -shm region inside the Wasm linear memory via MAP_FIXED / placeholder, giving "integrity_check = ok."](../../assets/images/wal-index-wasm-memory.png)

## Why only Windows

Because on Unix, the copy never existed. Look at how the Unix build maps a `-shm` region — it drops the real file straight into a fixed slot of the Wasm linear memory:

```go file="internal/sqlite3_wrap/mmap_unix.go"
func (r *MappedRegion) mmap(f *os.File, offset int64, readOnly bool) error {
  prot := unix.PROT_READ
  if !readOnly {
    prot |= unix.PROT_WRITE
  }
  _, err := unix.MmapPtr(int(f.Fd()), offset, r.addr, uintptr(r.size),
    prot, unix.MAP_SHARED|unix.MAP_FIXED) // [!code highlight]
  r.used = err == nil
  return err
}
```

`MAP_SHARED|MAP_FIXED` is doing the heavy lifting. [`mmap`](https://man7.org/linux/man-pages/man2/mmap.2.html) places the mapping at exactly `r.addr` — an address _inside_ the module's linear memory — and `MAP_SHARED` means every connection in the process that maps the same `-shm` sees one coherent view. That is real shared memory, handed to SQLite as an offset it can address. No copy, no reconciliation, nothing to go stale.

Windows historically had no safe equivalent. You could ask `MapViewOfFileEx` for a preferred base address, but you could not carve a file view into the middle of a region you had already reserved for linear memory without races. So the Windows VFS punted and copied. That asymmetry — Unix maps, Windows copies — _is_ the bug.

## The fix: Windows placeholder APIs

Windows 10 1803 / Server 2019 added exactly the primitive that was missing: **address-space placeholders**. You reserve a span of address space as a placeholder (`VirtualAlloc2` with `MEM_RESERVE_PLACEHOLDER`), then atomically **replace** a slice of that placeholder with a file view (`MapViewOfFile3` with `MEM_REPLACE_PLACEHOLDER`), and later split the view back out into a placeholder again (`UnmapViewOfFile2` with `MEM_PRESERVE_PLACEHOLDER`). It is, functionally, `MAP_FIXED` for Windows.

My [PR #405](https://github.com/ncruces/go-sqlite3/pull/405) wired those three calls up. This is how they look in the merged tree, where they ended up in `sys_windows.go`; #405 had them in a new `placeholder_windows.go`:

```go file="internal/sqlite3_wrap/sys_windows.go"
const (
  _MEM_PRESERVE_PLACEHOLDER = 0x00000002
  _MEM_REPLACE_PLACEHOLDER  = 0x00004000
  _MEM_RESERVE_PLACEHOLDER  = 0x00040000
)

var (
  kernelbase           = windows.NewLazySystemDLL("kernelbase.dll")
  procVirtualAlloc2    = kernelbase.NewProc("VirtualAlloc2")
  procMapViewOfFile3   = kernelbase.NewProc("MapViewOfFile3")
  procUnmapViewOfFile2 = kernelbase.NewProc("UnmapViewOfFile2")
)

// Reports whether the placeholder APIs are available
// (Windows 10 1803+ / Server 2019+).
func placeholdersSupported() bool {
  return procVirtualAlloc2.Find() == nil &&
    procMapViewOfFile3.Find() == nil &&
    procUnmapViewOfFile2.Find() == nil
}
```

The shape of #405 was: add a new `placeholder_windows.go` wrapping those APIs, rework `mem_windows.go` to reserve linear memory as a placeholder and track file views, delete the old `mmap_windows.go`, rewrite the `sqlite3_dotlk` copy scheme to copy only changed words, refuse shared-memory operation on pre-1803 Windows rather than copy, and add a `wal-repro.yml` CI job plus a stress test to prove it. It worked. But he had his own idea of how the code should look.

## The maintainer's reply

The first sign that this would become a collaboration rather than a merge was a note from [ncruces](https://github.com/ncruces) on July 6:

> I've made this a bit harder to merge, because I committed my non fixes (because they cleaned up some deprecations, mostly). Sorry about that. If it's not too much trouble to fix the conflict, as you drop the old Windows fallback, I'd appreciate it. Otherwise, if it's too much of a bother, I can always merge this to a branch and take over.

"I can always merge this to a branch and take over" turned out to be the pivot. That is roughly what happened: he took my two commits, rebased them onto `main`, and opened a new PR with his own commits on top. On July 25 he asked me, in a one-liner:

> @franchb can you test #413?

## PR #413: the same idea, the project's way

[#413](https://github.com/ncruces/go-sqlite3/pull/413) opened with:

> Superceeds #405 and hopefully fixes #404.

#413 starts from my two commits, unchanged apart from the rebase, and adds four of his: `Revert dotlk.`, `Cleanup.`, `More.` and `Test.`. The result keeps my idea intact — reserve linear memory as placeholders, drop the `-shm` in with `MapViewOfFile3`, mirror `MAP_FIXED` — but re-expresses it inside the project's existing cross-platform abstraction instead of a new parallel file. It was squash-merged as one commit, with me as co-author. The Wasm memory is reserved up front as one big placeholder so its base never moves, and `CanMapFiles()` becomes the single predicate everything hinges on:

```go file="internal/sqlite3_wrap/mem_windows.go"
func (m *Memory) allocate(max uint64) {
  if !placeholdersSupported() {
    return // m.ptr stays 0 -> CanMapFiles() is false
  }
  // ... (round max up to the allocation granularity: res)
  // Reserve res bytes of address space, to ensure we won't need to move it.
  // Use virtual memory placeholders so we can later map files.
  r, err := virtualAlloc2(0, uintptr(res),
    windows.MEM_RESERVE|_MEM_RESERVE_PLACEHOLDER, windows.PAGE_NOACCESS)
  // ...
  m.ptr = r
}

// CanMapFiles reports whether file views can be mapped into this memory.
func (m *Memory) CanMapFiles() bool { return m.ptr != 0 } // [!code highlight]
```

The move I most appreciated is that `mmap_windows.go` was refactored, not deleted. After #413, Windows and Unix expose the _same_ interface — `func (w *Wrapper) MapRegion(f *os.File, offset int64, size int32, readOnly bool) (*MappedRegion, error)` — backed by the same `newRegion`/`MappedRegion` machinery. The two platforms differ only in the one syscall at the bottom: `unix.MmapPtr(..., MAP_SHARED|MAP_FIXED)` on Unix, and on Windows:

```go file="internal/sqlite3_wrap/mmap_windows.go"
func mmap(f *os.File, offset int64, addr uintptr, size int32, prot uint32) error {
  maxSize := offset + int64(size)
  h, err := windows.CreateFileMapping(windows.Handle(f.Fd()), nil, prot,
    uint32(maxSize>>32), uint32(maxSize), nil)
  if h == 0 {
    return err
  }
  defer windows.CloseHandle(h)
  _, err = mapViewOfFile3(h, addr, uint64(offset), uintptr(size),
    _MEM_REPLACE_PLACEHOLDER, prot) // [!code highlight]
  return err
}
```

The consumer, `vfs/shm_windows.go`, then gates the whole WAL-shared-memory path on that one predicate, and degrades explicitly when it can't be satisfied:

```go file="vfs/shm_windows.go"
func (s *vfsShm) shmMap(wrp *sqlite3_wrap.Wrapper, id, size int32, extend bool) (_ ptr_t, err error) {
  // Ensure pages are the expected size, and that we can map files.
  if size != _WALINDEX_PGSZ || !wrp.CanMapFiles() {
    return 0, _IOERR_SHMMAP // [!code highlight]
  }
  // ...
  r, err := wrp.MapRegion(s.File, int64(id)*int64(size), size, false)
  if err != nil {
    return 0, err
  }
  s.regions = append(s.regions, r)
  return r.Ptr, nil
}
```

On a pre-1803 Windows, `CanMapFiles()` is false, `shmMap` returns `_IOERR_SHMMAP`, and shared-memory WAL is refused outright; such systems must use WAL with `EXCLUSIVE` locking mode. No copy, no silent staleness. The copy scheme itself survives, but only for `sqlite3_dotlk` builds: `vfs/shm_copy.go` went from `//go:build windows || sqlite3_dotlk` to `//go:build sqlite3_dotlk`, and his `Revert dotlk.` commit threw out my rewrite of the copying logic, restoring the original. The change was scoped to native Windows, where placeholders exist.

#413 also kept the regression test from #405, `TestWALConcurrentWriters` (the 64-writer stress workload behind a `SQLITE3_TEST_WAL_STRESS` env gate, run by the on-demand `wal-repro.yml` workflow), which his `Test.` commit tightened: `errgroup` instead of hand-rolled channels, `t.TempDir` instead of manual temp-dir cleanup, errors returned instead of strings.

## Why #413 superseded #405

Both PRs land the same fundamental fix, and #413 literally contains #405. What the maintainer's commits changed was integration, structure, and ownership, not the core idea. Four of those changes stand out:

**1. It fit the existing abstraction instead of forking a parallel one.** My PR added a new `placeholder_windows.go` and deleted `mmap_windows.go`; #413 reshaped `mmap_windows.go` to expose the same `MapRegion → *MappedRegion` interface as `mmap_unix.go`. After it, there is _one_ mental model for mapped regions and _one_ place to reason about their lifecycle, with the platform difference isolated to a single syscall. That is the kind of symmetry a maintainer has to live with for years.

**2. It left the `dotlk` path alone.** I had not only moved Windows off the copy scheme but also rewritten the scheme itself, to copy only the words that changed. `Revert dotlk.` undid that rewrite: ncruces made the narrower, safer call to migrate only the native-Windows path to true mapping and leave the existing copy code untouched where placeholders aren't the right tool. Scoping a fix down is often harder — and more valuable — than scoping it up.

**3. It unified the capability check.** The runtime question "can this memory host a file view?" is answered in exactly one place, `CanMapFiles()`, and `shmMap` is its only consumer. One predicate, one degradation path (`_IOERR_SHMMAP`), instead of ad-hoc fallbacks. (`vfs.SupportsSharedMemory` is a separate, build-time constant that was already `true` on Windows; #413 switched the WAL test in `ext/serdes` to gate on it instead of `SupportsFileLocking`.) Rebasing my commits himself also cleared the merge conflicts my branch had picked up against his deprecation cleanups.

**4. It was shaped for maintenance and release.** The regression test and CI job came from #405, but he trimmed and restructured the test into the project's idioms, and merged the fix minutes after bumping SQLite to 3.53.4 so both went out together in v0.35.3. He was building the version he would maintain, not just the version that made the red test go green.

A PR that gets superseded but fixes the bug is not a loss. It's a fix that shipped, and in this case my commits shipped inside it.

## Validation and what changed

ncruces set the bar plainly on July 31:

> Unless you find something terrible, I'm likely to merge this, update SQLite to the latest point release, and tag a release, time permitting, in the next couple of days.

He merged #413 on August 1 (19:48 UTC), right after the SQLite 3.53.4 bump. I kept looking for something terrible against the merged code. On Windows Server 2022, the standalone workload came back 10/10 clean, and the opt-in `TestWALConcurrentWriters` stress test ran 3/3 rounds clean, with Linux clean as a control. My report on August 3 was short: I did not find anything terrible. The fix shipped in [v0.35.3](https://github.com/ncruces/go-sqlite3/releases/tag/v0.35.3), tagged later that day.

For users, the practical change is small but real: on native Windows 10 1803+ / Server 2019+, WAL databases now use a genuinely shared wal-index mapped into linear memory, and the pooled-writer corruption is gone. On older Windows without the placeholder APIs, go-sqlite3 no longer pretends — WAL there requires `EXCLUSIVE` locking mode (and, with `database/sql`, `db.SetMaxOpenConns(1)`) instead of silently copying and risking corruption.

## Lessons

- **Trust the platform matrix.** "Clean on Linux, corrupt on Windows, clean on native SQLite" pointed straight at the Go Windows VFS and saved days of staring at `wal.c`.
- **Emulated shared memory is a trap.** If code assumes one live copy and you give it N reconciled copies, every gap between reconcile points is a window for stale reads.
- **`MAP_FIXED` has a Windows twin now.** Placeholder VirtualAlloc2 / MapViewOfFile3 / UnmapViewOfFile2 are the modern way to map a file view at a chosen address — worth knowing for anything that manages its own address space, Wasm runtime or not.
- **Write the fix so it looks like the codebase.** The technique was the same; the version that shipped was the one shaped like everything around it.
- **Diagnosis and proof are the high-value part.** A reproducible regression test plus a working technique is worth contributing even if the maintainer reshapes the final merge.

## Links

- [go-sqlite3](https://github.com/ncruces/go-sqlite3) — the cgo-free SQLite driver, by ncruces
- [Issue #404](https://github.com/ncruces/go-sqlite3/issues/404) · [PR #405](https://github.com/ncruces/go-sqlite3/pull/405) (mine) · [PR #413](https://github.com/ncruces/go-sqlite3/pull/413) (merged)
- [wasm2go](https://github.com/ncruces/wasm2go) — the Wasm-to-Go translator go-sqlite3 uses since [#362](https://github.com/ncruces/go-sqlite3/pull/362) (it previously ran on [wazero](https://wazero.io))
- [SQLite: Write-Ahead Logging](https://www.sqlite.org/wal.html) and the [`sqlite3_io_methods`](https://www.sqlite.org/c3ref/io_methods.html) VFS interface (`xShmMap`/`xShmLock`)
- [`mmap(2)`](https://man7.org/linux/man-pages/man2/mmap.2.html) — `MAP_SHARED` / `MAP_FIXED`
- Microsoft Learn: [`VirtualAlloc2`](https://learn.microsoft.com/en-us/windows/win32/api/memoryapi/nf-memoryapi-virtualalloc2), [`MapViewOfFile3`](https://learn.microsoft.com/en-us/windows/win32/api/memoryapi/nf-memoryapi-mapviewoffile3), [`UnmapViewOfFile2`](https://learn.microsoft.com/en-us/windows/win32/api/memoryapi/nf-memoryapi-unmapviewoffile2)
- Raymond Chen on address-space placeholders: [The Old New Thing](https://devblogs.microsoft.com/oldnewthing/?p=109346) (the post the fix cites in `mem_windows.go`)
- [`database/sql`: `SetMaxOpenConns`](https://pkg.go.dev/database/sql#DB.SetMaxOpenConns)
