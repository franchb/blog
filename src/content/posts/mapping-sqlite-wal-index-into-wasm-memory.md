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
description: "A Windows-only WAL corruption bug in the cgo-free go-sqlite3 driver, traced from my issue #404 and PR #405 to the maintainer's PR #413, and why mapping the wal-index directly into WebAssembly linear memory is the right fix."
ogImage: ../../assets/images/wal-index-wasm-memory.png
---

[go-sqlite3](https://github.com/ncruces/go-sqlite3) is a SQLite driver for Go that uses no cgo. Instead of linking `libsqlite3`, it compiles SQLite to WebAssembly and then uses [wasm2go](https://github.com/ncruces/wasm2go) to translate that module into plain Go source. The pager, the b-trees and the WAL code all run as Go code that can see exactly one thing: a `[]byte` that holds the module's linear memory.

The catch is shared memory. SQLite's WAL mode assumes every connection sees one live wal-index, and a Wasm module can only see its own linear memory. On Windows, go-sqlite3 bridged that gap by giving each connection its own copy of the wal-index. With concurrent writers in a connection pool, the copies drifted apart and databases got corrupted.

This post follows that bug from the [issue I filed (#404)](https://github.com/ncruces/go-sqlite3/issues/404), through [my fix (#405)](https://github.com/ncruces/go-sqlite3/pull/405), to [the fix that shipped (#413)](https://github.com/ncruces/go-sqlite3/pull/413), and explains why the maintainer's version was the better one to merge.

## Table of contents

## Why I cared

I run go-sqlite3 in a production service, and some of its deployments are on Windows. The appeal is exactly the no-cgo part: one static Go binary, cross-compiled, with no C toolchain in the build and no DLL to ship. A corrupted SQLite file in that setting means restoring from the last backup and losing every write since. So when a stress test of our write path came back with `database disk image is malformed` on Windows only, I stopped what I was doing and went looking.

## cgo-free SQLite lives in linear memory

go-sqlite3 compiles the SQLite amalgamation to `wasm32` and translates the module to Go with wasm2go. (Older releases ran the same module in the [wazero](https://wazero.io) runtime; the project [switched to wasm2go](https://github.com/ncruces/go-sqlite3/pull/362) in March 2026, months before this bug.) Either way, SQLite's memory is a Go `[]byte`: `Memory.Buf` in `internal/sqlite3_wrap`.

SQLite talks to the outside world through a VFS (Virtual File System), a struct of function pointers it calls to open files, read and write pages, take locks and map shared memory. Normally the VFS is C (`os_unix.c`, `os_win.c`). Here it is Go: `vfs/os_windows.go`, `vfs/shm_windows.go`, and the memory plumbing in `internal/sqlite3_wrap`.

That leaves one hard constraint. The translated C code can only address the module's linear memory, so any memory SQLite touches has to live inside that `[]byte`, including the wal-index. You can't hand SQLite a pointer to an OS shared-memory segment; it needs an offset into linear memory. The bug and the fix both come down to this.

## WAL mode and the shared wal-index

In [WAL mode](https://www.sqlite.org/wal.html), writers append new page images to a `-wal` file instead of overwriting the database in place. Readers find the current version of a page by checking the WAL first. To make "is this page in the WAL, and at which frame?" fast, SQLite keeps the **wal-index**, a hash table stored in a shared-memory file named `-shm`.

The VFS exposes it through two callbacks on [`sqlite3_io_methods`](https://www.sqlite.org/c3ref/io_methods.html): `xShmMap` maps a region of the `-shm` into memory, and `xShmLock` takes byte-range locks to coordinate access. `wal.c` assumes the wal-index is real shared memory. When one connection publishes a new WAL frame, the others see it through their own mapping of the same pages. Synchronization is just memory barriers (`xShmBarrier`). There is no "flush my copy to everyone" step, because SQLite assumes there is only one copy.

## The bug: emulated shared memory goes stale

Reduced, the workload from [#404](https://github.com/ncruces/go-sqlite3/issues/404) looks like this:

```go
// error handling elided
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

Sixty-four goroutines share one `*sql.DB`. They run ordinary deferred transactions and queue on the WAL write lock via `busy_timeout`. Nothing exotic. On Windows Server 2022 it corrupted the database on every run (3/3):

```
sqlite3: file is not a database
sqlite3: database disk image is malformed
SQLITE_PROTOCOL (locking protocol)
```

`integrity_check` reported structural b-tree damage:

```
wrong # of entries in index child_parent_idx
Tree 5 page 18419 cell 2: overflow list length is 1 but should be 2
```

The platform matrix narrowed it down. The same Go code ran clean on Linux (`RESULT=CLEAN`). Native C SQLite, using its own `os_win.c` VFS, ran the identical workload with `integrity_check = ok` every time. So it wasn't SQLite and it wasn't my schema. It was go-sqlite3's Windows VFS.

I suspected file locking first: `LockFileEx`/`UnlockFileEx` in `vfs/os_windows.go`, or the `-shm` handling in `vfs/shm_windows.go`. The locks were correct. The problem was one level down, in the shared memory.

Native Windows go-sqlite3 couldn't map the `-shm` into linear memory, so it emulated it. It mapped a view of the `-shm` file into ordinary Go memory, and each connection kept a private copy of the wal-index in its own linear memory, synced with that view only at `xShmLock`/`xShmUnlock` boundaries. But `wal.c` reads and writes the wal-index between those calls, and expects to see other connections' updates as they happen. The most likely mechanism: under concurrent writers, a checkpointer working from a stale copy backfills outdated page images into the database and truncates WAL frames that were never backfilled. The `SQLITE_PROTOCOL` errors fit the same staleness. I never captured a trace that proves this exact interleaving; what is established is that removing the copy removed the corruption.

The `sqlite3_dotlk` build used the same copying code, but with a different topology. Its shared side is a single in-process buffer guarded by a mutex, and the `.lock` file keeps other processes out. I only ever saw corruption on native Windows.

![Two-panel diagram. Left, "before": on native Windows, connections A and B each hold a private -shm copy, synced only at xShmLock, reading stale data between locks, ending in "database disk image is malformed." Right, "after": both connections map one shared -shm region inside the Wasm linear memory via MAP_FIXED / placeholder, giving "integrity_check = ok."](../../assets/images/wal-index-wasm-memory.png)

## Why only Windows

On Unix the copy never existed. The Unix build maps the `-shm` region straight into a fixed slot of the linear memory:

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

[`mmap`](https://man7.org/linux/man-pages/man2/mmap.2.html) with `MAP_FIXED` places the mapping at exactly `r.addr`, an address inside linear memory. `MAP_SHARED` means every connection that maps the same `-shm` sees the same pages. SQLite gets real shared memory at an offset it can address, and there is nothing to keep in sync.

Windows had no safe equivalent. `MapViewOfFileEx` takes a preferred base address, but you can't place a file view inside a range you've already reserved for linear memory without racing other allocations. So the Windows VFS copied instead. Unix mapped and Windows copied, and that difference was the bug.

## The fix: Windows placeholder APIs

Windows 10 1803 and Server 2019 added the missing primitive: address-space placeholders. You reserve address space as a placeholder (`VirtualAlloc2` with `MEM_RESERVE_PLACEHOLDER`), replace part of it with a file view (`MapViewOfFile3` with `MEM_REPLACE_PLACEHOLDER`), and later turn the view back into a placeholder (`UnmapViewOfFile2` with `MEM_PRESERVE_PLACEHOLDER`). Together they do what `MAP_FIXED` does on Unix.

My [PR #405](https://github.com/ncruces/go-sqlite3/pull/405) wired up those three calls. Here they are in the merged tree, where they ended up in `sys_windows.go`; #405 had them in a new `placeholder_windows.go`:

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

#405 did six things:

- added `placeholder_windows.go` wrapping those APIs;
- reworked `mem_windows.go` to reserve linear memory as a placeholder and track file views;
- deleted the old `mmap_windows.go`;
- rewrote the `sqlite3_dotlk` copy code to copy only the words that changed;
- returned `_IOERR_SHMMAP` on pre-1803 Windows instead of falling back to copying;
- added a 64-writer regression test, `TestWALConcurrentWriters`, behind a `SQLITE3_TEST_WAL_STRESS` gate, plus a `wal-repro.yml` workflow to run it on Windows and Linux.

It fixed the bug. The maintainer had his own idea of how the code should look.

## The maintainer's reply

On July 6, [ncruces](https://github.com/ncruces) wrote:

> I've made this a bit harder to merge, because I committed my non fixes (because they cleaned up some deprecations, mostly). Sorry about that. If it's not too much trouble to fix the conflict, as you drop the old Windows fallback, I'd appreciate it. Otherwise, if it's too much of a bother, I can always merge this to a branch and take over.

He did take over. He rebased my two commits onto `main` and opened a new PR with his own commits on top. On July 25 he asked me on #405:

> @franchb can you test #413?

## PR #413: the same idea, the project's way

[#413](https://github.com/ncruces/go-sqlite3/pull/413) opened with:

> Superceeds #405 and hopefully fixes #404.

It starts from my two commits, unchanged apart from the rebase, and adds four of his: `Revert dotlk.`, `Cleanup.`, `More.` and `Test.`. The approach is the same: reserve linear memory as placeholders, drop the `-shm` in with `MapViewOfFile3`, mirror `MAP_FIXED`. What changed is where the code lives. It was squash-merged as one commit with me as co-author.

The linear memory is reserved up front as one large placeholder so its base never moves, and `CanMapFiles()` is the one check everything else depends on:

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

Instead of deleting `mmap_windows.go` as I had, he rewrote it. After #413, Windows and Unix share one interface, `func (w *Wrapper) MapRegion(f *os.File, offset int64, size int32, readOnly bool) (*MappedRegion, error)`, backed by the same `newRegion`/`MappedRegion` code. The platforms differ only in the syscall at the bottom: `unix.MmapPtr(..., MAP_SHARED|MAP_FIXED)` on Unix, and this on Windows:

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

`vfs/shm_windows.go` gates the whole shared-memory path on that one check and fails loudly when it isn't met:

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

On Windows before 1803, `CanMapFiles()` is false, `shmMap` returns `_IOERR_SHMMAP`, and shared-memory WAL is refused; those systems need WAL with `EXCLUSIVE` locking mode. The copy code survives only for `sqlite3_dotlk` builds: `vfs/shm_copy.go` went from `//go:build windows || sqlite3_dotlk` to `//go:build sqlite3_dotlk`, and his `Revert dotlk.` commit threw out my rewrite of the copying logic and restored the original.

His `Test.` commit tightened my regression test: `errgroup` instead of hand-rolled channels, `t.TempDir` instead of manual cleanup, and errors returned instead of strings.

## What his version did better, and what mine kept

#413 contains #405. The approach, the placeholder calls, the `placeholdersSupported` check, the decision to fail on pre-1803 Windows rather than copy, and the regression test with its CI workflow all came from my PR and are in the release. What his commits changed was where the code sits and how much of it there is.

Three changes were better than what I had:

**One mapping abstraction.** I added `placeholder_windows.go` and deleted `mmap_windows.go`. He rebuilt `mmap_windows.go` behind the same `MapRegion` → `*MappedRegion` interface as `mmap_unix.go`, so there is one model for mapped regions and their lifecycle, and the platform difference is a single syscall. He has to maintain this code for years; I don't.

**A smaller blast radius.** I rewrote the `dotlk` copy code while I was in there. Nothing in #404 required that, and `Revert dotlk.` put it back. The fix ended up touching only native Windows, which is what the bug report was about.

**One runtime check.** "Can this memory host a file view?" is answered in one place, `CanMapFiles()`, and `shmMap` is the only caller. (`vfs.SupportsSharedMemory` is a separate build-time constant, already `true` on Windows; #413 switched the WAL test in `ext/serdes` to gate on it instead of `SupportsFileLocking`.)

He also rebased my commits himself, which cleared the conflicts with his deprecation cleanups, and merged the fix minutes after bumping SQLite to 3.53.4 so both went out in one release.

My PR didn't merge. The bug is fixed, and my commits are in the fix. I'm fine with that trade.

## Validation and what changed

On July 31 he wrote:

> Unless you find something terrible, I'm likely to merge this, update SQLite to the latest point release, and tag a release, time permitting, in the next couple of days.

He merged #413 on August 1 (19:48 UTC), right after the SQLite 3.53.4 bump. I kept testing the merged code. On Windows Server 2022 the standalone workload came back clean 10/10, and `TestWALConcurrentWriters` ran 3/3 rounds clean, with Linux as the control. My report on August 3 was short: I didn't find anything terrible. The fix shipped in [v0.35.3](https://github.com/ncruces/go-sqlite3/releases/tag/v0.35.3), tagged later that day.

For users, on Windows 10 1803+ and Server 2019+, WAL databases now use a real shared wal-index mapped into linear memory, and the pooled-writer corruption is gone. On older Windows, WAL requires `EXCLUSIVE` locking mode (and, with `database/sql`, `db.SetMaxOpenConns(1)`).

That last part is a behavior change: code that ran on old Windows before now gets an error. I think it's the right call. An error at open time costs one support ticket. Silent corruption costs whatever was in the database. The systems without placeholders are Windows 10 before 1803, which has been out of support for years, Windows 8.1 and older, and Server 2016, which left mainstream support in January 2022. Anyone still on them can use `EXCLUSIVE` mode or the `sqlite3_dotlk` build. I'd have made the same choice, and #405 did.

## What I'd do differently

I'd read the existing abstraction before writing code. `mmap_unix.go` already defined the shape of a mapped region; the right move was to give Windows the same shape. I added a parallel file and deleted the old one instead, and he had to restructure that part.

I'd keep the scope to the bug. The `dotlk` rewrite was an improvement I made because I was already in the file, and it gave the maintainer one more thing to review and then revert.

## Lessons

- **Trust the platform matrix.** "Clean on Linux, corrupt on Windows, clean on native SQLite" pointed directly at the Go Windows VFS and saved me days of reading `wal.c`.
- **Emulated shared memory breaks SQLite.** If code assumes one live copy and you give it N copies synced at lock boundaries, every gap between syncs is a chance to read stale data.
- **`MAP_FIXED` has a Windows equivalent.** `VirtualAlloc2`, `MapViewOfFile3` and `UnmapViewOfFile2` with placeholders map a file view at a chosen address. Anything that manages its own address space can use them, Wasm or not.
- **Write the fix so it looks like the codebase.** The technique didn't change between #405 and #413; the merged version was the one shaped like the code around it.
- **A diagnosis and a test are worth sending even if the patch gets reshaped.** The reproduction and the regression test were the parts of my PR he changed least.

## Links

- [go-sqlite3](https://github.com/ncruces/go-sqlite3), the cgo-free SQLite driver by ncruces
- [Issue #404](https://github.com/ncruces/go-sqlite3/issues/404) · [PR #405](https://github.com/ncruces/go-sqlite3/pull/405) (mine) · [PR #413](https://github.com/ncruces/go-sqlite3/pull/413) (merged)
- [wasm2go](https://github.com/ncruces/wasm2go), the Wasm-to-Go translator go-sqlite3 has used since [#362](https://github.com/ncruces/go-sqlite3/pull/362) (it previously ran on [wazero](https://wazero.io))
- [SQLite: Write-Ahead Logging](https://www.sqlite.org/wal.html) and the [`sqlite3_io_methods`](https://www.sqlite.org/c3ref/io_methods.html) VFS interface (`xShmMap`/`xShmLock`)
- [`mmap(2)`](https://man7.org/linux/man-pages/man2/mmap.2.html): `MAP_SHARED` / `MAP_FIXED`
- Microsoft Learn: [`VirtualAlloc2`](https://learn.microsoft.com/en-us/windows/win32/api/memoryapi/nf-memoryapi-virtualalloc2), [`MapViewOfFile3`](https://learn.microsoft.com/en-us/windows/win32/api/memoryapi/nf-memoryapi-mapviewoffile3), [`UnmapViewOfFile2`](https://learn.microsoft.com/en-us/windows/win32/api/memoryapi/nf-memoryapi-unmapviewoffile2)
- Raymond Chen on address-space placeholders: [The Old New Thing](https://devblogs.microsoft.com/oldnewthing/?p=109346) (the post `mem_windows.go` cites)
- [`database/sql`: `SetMaxOpenConns`](https://pkg.go.dev/database/sql#DB.SetMaxOpenConns)
