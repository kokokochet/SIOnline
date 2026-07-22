# Follow-up: migrate mp4-muxer → Mediabunny

**Status:** Open. **Origin:** `docs/superpowers/plans/_phases/phase_09.md` T59 (deliberate punt).
**Blocks on:** Plan 10 (`10-test-infrastructure.md`) landing an MP4 round-trip integration test that encodes a real sample through `videoCompression.worker.ts` and decodes/inspects the output, so a B-frame / AAC regression is catchable.

## Why migrate

`mp4-muxer@5.2.2` is upstream-deprecated and unmaintained (`node_modules/mp4-muxer/README.md:3-5`). [Mediabunny](https://mediabunny.dev/) (pure-TypeScript, tree-shakable MP4 muxer) supersedes it.

## Why not yet (verified on `feat/media-compress` HEAD)

The migration is **behavioural**, not a rename:

| mp4-muxer (current) | Mediabunny |
|---|---|
| `new Muxer({ target: new ArrayBufferTarget(), video, audio, fastStart })` | `new Output({ format: new Mp4OutputFormat({ fastStart }), target: new BufferTarget() })` + explicit `addVideoTrack`/`addAudioTrack` + `await output.start()` |
| `muxer.addVideoChunk(chunk, meta, ts, compositionTimeOffset)` | `await videoSource.add(EncodedPacket.fromEncodedChunk(chunk), meta)` |
| `muxer.addAudioChunk(chunk, { decoderConfig })` | `await audioSource.add(EncodedPacket.fromEncodedChunk(chunk), meta)` |
| `muxer.finalize()` | `await output.finalize()` |
| Explicit `width/height/codec/sampleRate/numberOfChannels` | Auto-deduced — must be removed |
| `compositionTimeOffset` for B-frames | Removed — muxer auto-computes DTS from PTS in arrival order |
| Encoder `output` callback is sync | Must become `async` (Mediabunny is pipelined, methods are awaited) |

### Behavioural risk in this codebase

1. **B-frame CTS handling is load-bearing.** `videoCompression.worker.ts` computes `compositionTimeOffset = chunk.timestamp - nextDecodeTimestamp` and accumulates `nextDecodeTimestamp` so that mp4-muxer receives monotonically-increasing DTS in arrival orders (the comment in the encoder output callback explains the encoder reorders for B-frames). Mediabunny removes the `compositionTimeOffset` parameter and auto-derives DTS. The migration must verify, via the Plan 10 round-trip test, that the output MP4's CTTS/STTS boxes are byte-equivalent (or decode-equivalent) to today's output.
2. **AAC decoderConfig is hand-rolled.** The `passThroughAudio` path passes a `decoderConfig` with the first AAC chunk because mp4box keeps the AAC config in the parsed `esds` box and mp4-muxer would otherwise overwrite it. Mediabunny's auto-deduction of audio config must be confirmed to handle this case (or the explicit config preserved via the equivalent Mediabunny API).
3. **Encoder callbacks become async.** The current `VideoEncoder`/`AudioEncoder` `output`/`error` callbacks are synchronous; Mediabunny requires `await source.add(...)` inside them. This changes error-propagation timing and must be re-tested against the flush/reject paths.

## Acceptance criteria (for the follow-up issue)

- [ ] Plan 10's MP4 round-trip integration test is green on `master` (pre-migration baseline).
- [ ] A feature branch migrates `videoCompression.worker.ts` (the only importer of `mp4-muxer`) to Mediabunny.
- [ ] The B-frame CTS path is covered: the round-trip test uses a B-frame-containing sample and asserts decoded frame order / CTTS correctness after migration.
- [ ] The AAC passthrough path is covered: the round-trip test includes an AAC audio track and asserts it decodes post-migration.
- [ ] `npm run typecheck:all && npm run build-dev && npm run test && npm run lint` all green.
- [ ] `mp4-muxer` removed from `package.json` `dependencies`; `mediabunny` added.
- [ ] The `// DEPRECATED: mp4-muxer` marker added in T59 is removed.

## Out of scope for this follow-up

- Replacing the manual WebCodecs encode/decode loop with Mediabunny's higher-level `Media*TrackSource` abstractions (the migration guide mentions this is possible). That is a separate, larger refactor and should be evaluated only after the 1:1 migration above is proven.
