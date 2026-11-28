# Legacy sync modules (frozen)

Verbatim copies of `src/lib/{storage,syncMeta,syncMerge,syncKeys}.js` as of commit
`c38c76f` — the production build before the Nov 2026 egress rework. The protocol tests use
them to play a device that has not refreshed to a newer build yet (an installed PWA can
run an old build for days), so mixed-fleet behaviour stays covered.

Never edit these to make a test pass: they stand for code already running on real devices.
