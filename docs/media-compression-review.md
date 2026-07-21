# Ревизия `feat/media-compress` vs `master`

Пайплайн: **60 критиков (20 линз × 3, изолированно) → 20 синтезаторов (по 3 входа, верификация по коду) → 5 синтезаторов (по 5 входов с пересечениями) → консолидация**. Ключевые CRITICAL перепроверены вручную (`npm test`, `rg`, чтение кода). Спеки/доки не доверялись — только код.

---

## CRITICAL (баги/коррупция/красные тесты — блокеры)

**1. 5 тестов падают на ветке** — `test/compressionPresets.test.ts` + `test/mediaCompression.test.ts:15,28`. Коммиты перетюнили пресеты (low 480→1000px, medium 800→1200px, high 1280→1500px; битрейты 1M→500k и т.д.), а тесты остались со старыми значениями. Из-за `expect()` в начале — все ассёрты на кодек-строки (`opus`/`avc1.64001F`/`avc1.640028`) **unreachable**: кодек-строки фактически непротестированы. Нарушает DoD ("Tests pass"). *Проверено: `npm test` → 5 failed, 21 passed.* Фикс: обновить тесты, ещё лучше — заменить value-pinning на инварианты (`low < medium < high`, `expect(defaultCompressionOptions).toBe(mediumPreset)`), чтобы не гнило снова.

**2. Re-entry race запускает второй конкурентный thunk** — `siquesterSlice.ts:1298` (`bulkCompressionDialogOpened` clobbers state **без phase-guard**) + `:306` (thunk `compressAllPackageMedia` без `condition`/phase-check) + `CompressionPanel.tsx:108` (кнопка "Compress All" всегда enabled). Пока `phase==='running'`, можно reopen CompressionPanel → клик "Compress All" → `phase` сбрасывается в `'confirm'`, `cancelRequested` в `false`, Start запускает **второй конкурентный thunk** на том же `zip`/`pack`/`refs`. Оба диспатчат `bulkMediaCompressed` (`:396`) → ломает all-or-nothing контракт, потенциальная коррупция пакета. *Проверено.* Фикс: `condition: (_, {getState}) => getState().siquester.bulkCompression?.phase !== 'running'` + no-op в `bulkCompressionDialogOpened` когда running + disable триггеров.

**3. B-frame negative `compositionTimeOffset` корраптит `ctts`** — `videoCompression.worker.ts:215`. `compositionTimeOffset = chunk.timestamp - nextDecodeTimestamp` уходит в минус при B-frames (легально для High profile `avc1.64001F`/`640028`). mp4-muxer пишет `ctts` как **version-0 unsigned `u32`** (`mp4-muxer.mjs:637,644`) → `-33334` наматывается в `4294933962`, ломает PTS-порядок на Safari/QuickTime/Edge. `avc:{format:'avc'}` не запрещает B-frames; `latencyMode` не выставлен, так что VideoToolbox/MediaFoundation могут их выдать. Фикс: `latencyMode:'realtime'` (подавить B-frames), либо `Math.max(0, …)`, либо muxer с CTTS v1.

**4. Decompression-bomb guard срабатывает после полного декода** — `compressImage.ts:41,46`. `createImageBitmap(file)` аллоцирует полный растр (~6.4 ГБ для крафтового 40000×40000 PNG) **до** проверки `MAX_IMAGE_PIXELS`. Комментарий "Prevents decompression-bomb OOM" врёт. На Safari/Tauri/WKWebView капы ниже и не гарантированы. Фикс: парсить PNG IHDR/JPEG SOF размеры до декода.

**5. Silent OGG-коррупция: audio output-callback без try/catch** — `audioCompression.worker.ts:59-67`. Если `copyTo`/`push` бросает в output-callback, WebCodecs **не** вызывает error-callback для output-ошибок → encoder продолжает, `flush()` резолвится, worker постит `{type:'done'}` с **обрезанным/битым OGG**. Размер-гард в `compressAudio.ts:80` не ловит надёжно. Видео-воркер правильно имеет try/catch — ассиметрия. Фикс: `try {…} catch(e){ closeEncoder(); reject(e); }`.

---

## MAJOR (ломают поведение / утечки / OOM / вводящий в заблуждение UX)

### Cancel/abort — всплыла в 4 из 5 синтезов

- **Cancel latency до 60с** — `siquesterSlice.ts:329,358`. `cancelRequested` проверяется только между файлами; in-flight `compressMedia` не прерывается. `AbortSignal`/`AbortController` **отсутствует напрочь** (rg → 0 матчей кроме комментария `:299`). `worker.terminate()` только в `finally` по завершении. После Cancel текущий файл кодируется до конца (до `WORKER_TIMEOUT_MS=60_000`).
- **Modal-trap** — `CompressAllDialog.tsx:70-77` + `Dialog.tsx:17-27`. `Dialog` — голый `<section>`, без Escape/backdrop. Во время `running` `onClose` диспатчит cancel и **возвращается без закрытия**. Юзер заточен на прогресс-бар до минуты.
- **Thunk outlives component** — навигация away / open another package mid-run: диалог анмаунтится, thunk продолжает, `bulkMediaCompressed` молча пишет staged в `state.zip` (zip-identity guard ловит только другой пакет, не same-package re-open).
- **Phantom cancel on package swap** — `openFile.fulfilled`/`createNewPackage.fulfilled` (`:1414`/`:1428`) wipe `bulkCompression=undefined`, тогда `isCancelRequested` (`:326` = `undefined?.cancelRequested===true` → false) — thunk не видит отмены, кодирует все оставшиеся файлы на старый zip.
- **Pre-loop throws strand UI** — thunk может выбросить до `bulkCompressionStarted` (`:312`/`:317`), `phase` остаётся `'confirm'`, `rejected` (`:1447`) гейтится на `phase==='running'` → диалог застревает на confirm, Start остаётся кликабельным, ошибки нет.

### Memory/OOM (3 независимых вектора)

- **Audio PCM на main thread** — `compressAudio.ts:42,110-134`. `decodeAudioData` полностью материализует PCM: 200 МБ MP3 → ~3.6 ГБ peak (audioBuffer + копии каналов). `MAX_MEDIA_BYTES` капает только encoded input, не decoded. Таб-крэш. `limits.ts:4` комментарий "Prevents browser OOM" врёт для аудио.
- **Staged OOM** — `siquesterSlice.ts:322-375`. Все compressed `Uint8Array` копятся в `staged[]` до single all-or-nothing apply (`:396`): 30 файлов × 200 МБ ≈ 6 ГБ.
- **Worker OOM → silent skip** — `videoCompression.worker.ts:104,250-259` + audio. `demuxMp4` буферит все сэмплы, decode/encode в tight loop без `decodeQueueSize`/`encodeQueueSize` backpressure. На длинных файлах — OOM → onerror → passthrough (молча, не data loss, но стабильность).

### Apply atomicity нарушена

`siquesterSlice.ts:1340-1400`. `bulkMediaCompressed` мутирует `state.zip` (JSZip — class instance, Immer его не драфтит, проходит по ссылке) in-place с write-then-remove циклом + rename + clear history + bump zipRevision. Любой throw посередине → Immer откатывает `state.pack`, но **не** `state.zip` → половинчатая модификация, JSDoc "all-or-nothing" врёт. Плюс non-modal dialog + identity-only zip-swap guard → concurrent `setContentItemMedia`/`removeOrphanedMediaFile` (`:966`/`:198`) могут редактировать тот же JSZip mid-run → staged apply затирает юзер-эдиты.

### Undo history сносится полностью

`:1395-1397`. `bulkMediaCompressed` чистит весь `past`/`future` даже для single-file apply. `setContentItemMedia` undoable, bulk — нет. `compressionIrreversible` варнинг не говорит что вся история снесётся.

### Image corruption (молча калечит частые входы)

- **EXIF orientation игнорируется** — `compressImage.ts:41`. `createImageBitmap(file)` без `{imageOrientation:'from-image'}` → портретные фото с телефона сохраняются боком. One-line fix.
- **Прозрачные PNG → белый JPEG** — все 3 пресета хардкодят `image/jpeg`; `:65-67` white-fill убивает альфу, staged как `wasCompressed:true`.
- **Анимация убивается** — только `.gif` passed through (и то по filename). Animated WebP/APNG/AVIF → первый кадр в JPEG.
- **SVG растеризуется в lossy JPEG** — `.svg` не в passthrough.
- **Color fidelity теряется** — ICC профили стрипаются canvas-реэнкодом, wide-gamut/HDR клипается в 8-bit sRGB.
- **0-dimension edge** — `calculateTargetDimensions` может вернуть `{0,N}`, canvas toBlob выдаёт tiny JPEG, проходит size-гард → silent image destruction.

### Non-AAC audio в MP4 молча дропается

`videoCompression.worker.ts:58`. `isAAC = startsWith('mp4a.40.')` гейтит и muxer config, и passthrough → Opus/AC-3 треки дают немое видео без предупреждения. Opus audio-пресет к видео-аудио никогда не применяется.

### HTML "passthrough" не byte-preserving

`index.ts:69-77`. `file.text()` + `TextEncoder` UTF-8 реэнкодит → стрипает BOM, манглит windows-1251/UTF-16. Тот же файл с compression OFF хранится byte-exact (`ScreensView.tsx:634`). Тихая контент-коррупция от нерелевантного тоггла. Фикс: route на `passthrough(file)`.

### UI не гейтит по поддержке WebCodecs

`CompressionPanel`/`CompressAllDialog` никогда не зовут `isAudio/VideoCompressionSupported` (rg в components → 0). На Tauri-macOS WKWebView (основной desktop-таргет) macOS 14/15 имеет `VideoEncoder` но **нет** `AudioEncoder` (Safari<26) → юзер жмёт Compress, каждый аудиофайл молча passthrough, "Compressed 0 / N" как нормальный done.

### `enabled` flag — ложь для bulk

`siquesterSlice.ts:316`. Bulk-thunk читает только `presets`, никогда `enabled`. "Compress All" кликабелен когда compression OFF, делает полный необратимый реэнкод + сносит undo.

### Bulk silent error swallowing

`:371-374`. Любая per-file ошибка → `skippedCount++`, нет `phase:'failed'`, нет причины. Single-file показывает `compressionFailed` тостом — **противоположная политика** для той же `compressMedia()`. Safari-юзер видит "done" как успех.

### Decode-before-probe

`compressAudio.ts:35-42`/`compressVideo.ts:21`. Полный decode/demux **до** codec-specific `isConfigSupported` (который в воркере). Несаппортенный кодек → минуты работы на каждый файл → молча passthrough. Нет pre-flight в UI.

### H.264 level недостаточен

`compressionPresets.ts`. High `avc1.640028` (L4.0, MaxMBPS=245760) не тянет 1080p60 (489600). Low/medium `64001F` (L3.1) не тянут 720p60. `isConfigSupported` не валидирует level-vs-res/fps. Стрим спек-некомплиант, strict декодеры могут реджектить.

### Audio worker errors mislabeled + DOMException.name теряется

`audioCompression.worker.ts:129-132`. Внешний `.catch` покрывает `isConfigSupported`+configure+encode+flush, хардкодит `"AudioEncoder isConfigSupported error"` для любого throw. Во всех 7 reject-сайтах обоих воркеров `e.name` (NotSupportedError/OutOfMemoryError/…) дропается, остаётся locale-dependent `e.message`. Untriageable телеметрия.

### Unvalidated worker input

`audioCompression.worker.ts:23-24`/`videoCompression.worker.ts:20-21`. `e.data` кастится без runtime-валидации: `numberOfChannels > channels.length` → throw mid-encode; `new Float32Array(buf)` → RangeError на `byteLength % 4 !== 0`/SharedArrayBuffer. `options.codec/bitrate/maxHeight` летят в `VideoEncoderConfig` без bounds (maxHeight≤0 → 0×0 dims).

### AudioData leak on encode throw

`audioCompression.worker.ts:112-113`. `audioData.close()` не в `finally`; throw из `encoder.encode()` → leak. Видео-воркер правильно делает `try/finally` — ассиметрия.

### Encoder/decoder leak на configure throw

`videoCompression.worker.ts:193-275`. Executor body без try/catch вокруг `encoder.configure()`/`decoder.configure()`; sync throw → `closeBoth()` не вызывается → native/GPU state leak до `worker.terminate()`.

### OGG muxer segment-table overflow

`oggOpusMuxer.ts:65`. `setUint8(26, segmentTableSize)` молча truncates mod 256 для пакетов >65024 байт → corrupt page, no throw. Latent для Opus (маленькие пакеты), но нет валидации.

### `timescale === 0` unguarded

`chunkTiming.ts:23`. Деление на ноль → NaN → worker reject → silent passthrough. Сиблинг `videoFramerate.ts:17-19` гейтит — несогласованность.

### Tests: worker pipeline структурно untestable

`workerFactoryMock.js` возвращает stub с `postMessage:()=>{}`, никогда не файрит `onmessage`/`onerror`. Весь postMessage→onmessage pipeline, timeout, error path, size-guards, finally cleanup — **zero coverage**. Воркер-файлы (314+134 строк) никогда не typecheck'аются в CI (mocked at module boundary, ts-loader `noEmitOnError` — единственный реальный гейт). CRC-тест OGG мьюксера self-referential (реимплементирует тот же алгоритм — любой баг в poly/init проходит в обеих копиях, нет golden-вектора).

### i18n

16 новых ключей только en/ru — **sr/uz отсутствуют** (проверено rg), SR/UZ юзеры получают English fallback. `compressionDoneSummary` хардкодит plural без `_2`/`_5` конвенции кодбейса → "1 files" (en) и грамматически wrong в ru/sr. Latin "MB" vs Cyrillic "МБ" в одной фиче; `.toFixed(1)` игнорирует локаль-сепаратор.

### a11y

`Dialog` — голый `<section>`, нет `role='dialog'`/`aria-labelledby`/Escape, focus не перемещается, фоновый контент остаётся в tab-order (WCAG 2.4.3). Preset radio groups без `fieldset`/`legend` → 3 неразличимых "Low/Medium/High" для SR. Done/cancelled summaries без `role='status'`/`aria-live` → completion не анонсируется (паттерн есть рядом в `ScreensView.tsx:696`).

### Build/types

`tsconfig.test.json` `types:["jest","node"]` исключает `@types/dom-webcodecs` → тесты и прод видят разные `VideoEncoder` формы; DoD "tests pass" иллюзорен для типов. `tsconfig.json` без `webworker` lib → воркеры компилятся против DOM (`document`/`window` тайп-доступны в воркерах, `DedicatedWorkerGlobalScope` untyped → root cause `self as unknown as WorkerScope` кастов). `mp4box@2.4.1` `main`/`types` указывают на **несуществующие** файлы в dist — прод работает только через `moduleResolution:"bundler"`, тесты через `paths` shim, любой fallback ломается. `mp4-muxer@5.2.2` **deprecated** (superseded by Mediabunny), миграции нет.

---

## MINOR (сгруппировано — slop/мёртвый код/nits)

- **Slop-комментарии:** `compressImage.ts:4` `(≈8192×4096)` — **уже неверный**: 33177600 = 7680×4320. `compressAudio.ts:21` "128 kbps" — неверный для low(64k)/high(192k). `index.ts:49-50` "Chrome/Edge only" противоречит `featureDetection.ts`. `CompressionPanel.tsx:27-28` неверно описывает механизм click-outside. `compressionPresets.ts:50` "Level 4.0 required for 1080p" — только для 1080p30. `compressImage.ts:83-84` "larger-than-original" но predicate `>=`. Magic-number narration везде (`limits.ts:7`, `oggOpusMuxer.ts:132,161`, пресеты).
- **Dead/redundant:** `index.ts` barrel ~80% dead (14/17 re-exports без src-консьюмеров). `validateMediaReferences` (`compressPackageMedia.ts:258`) — test-only code в проде (JSDoc признаёт). Dead `passthrough` helper + unreachable `default:` arms. `OPUS_SAMPLE_RATE` export unused. `getMediaSrc` в `ScreensView.tsx:340` — no-op (обе ветки return value). `compressionQuality` localization key — defined но нигде не referenced.
- **DRY-нарушения (shadow-код уже дрейфит):** `OPUS_SAMPLE_RATE=48000` дублирован main↔worker с ложным "worker can't import" (воркер импортит `oggOpusMuxer` — опровержимо). `WORKER_TIMEOUT_MS` в двух файлах + "60s" в `limits.ts:4` прозой. `e.preventDefault()` в `compressVideo.onerror` есть, в `compressAudio` — **нет** (уже дрейфнуло → dev-overlay noise). `WorkerScope` interface дублирован verbatim в обоих воркерах. AAC fallback `?? 44100`/`?? 2` дважды в одном файле.
- **Perf:** `MediaItem.tsx:18` + `PackageView.tsx:36` подписаны на весь `state.siquester` → O(items × progressTicks) ре-рендеров при bulk (200 файлов × 200 тиков = 40k). `MediaView.tsx:106-119` — `displayedFiles` цикл `new→[]→new` через `setTimeout(0)` → visible flash на каждом zip-rescan. `ScreensView.tsx:175` `resolveCompressionOptions` аллоцирует свежий объект каждый рендер. Inline arrow `onClose` → mousedown listener teardown/re-attach на каждое нажатие в edit-mode.
- **Timing drift (bounded):** `frameDurationFallback` (NTSC 29.97 → ~72ms/2h DTS drift). AAC per-sample duration double-rounding (~600ms/60s при `timescale≠sample_rate`). `videoFramerate.ts:18` систематически недооценивает fps на ~1/N. `chunkTiming.ts:23` overflow `MAX_SAFE_INTEGER` для timescale≥1e6 на ≥3ч (narrow под 200МБ капом).
- **State-machine:** `bulkCompressionFinished`/`bulkCompressionCancelled` flip phase без гейта → late cancel может перетереть done. `bulkCompressionCancelled` оставляет `cancelRequested`/`currentFile`/`completed` stale. Тесты покрывают только happy path.

---

## Что проверено и чисто

CRC32 имплементация (poly 0x04C11DB7, init 0, MSB-first, no final XOR) — корректна против RFC 3533. Codec-строки hex-encoding/constraint-flags корректны. Passthrough preserves original bytes (кроме HTML). `skippedCount+compressedCount === total` инвариант честный. `>= originalData.length` гарды консистентны между типами. Worker spawning termination в `finally` (не leak, просто не прерывается по cancel). `splitChunks` не дублирует mp4box/mp4-muxer между main и worker chunks.

---

## Итог

Фича рабочая для простых кейсов на Chrome, но имеет **5 красных тестов** (DoD нарушен) и набор CRITICAL-багов на краях (B-frame коррупция, re-entry race, decompression-bomb, silent OGG truncation) + системные MAJOR по cancel/abort, памяти, UX-честности и i18n. Рекомендую не мержить без фиксов хотя бы пунктов CRITICAL 1-5 и MAJOR по cancel/abort.

---

## Артефакты ревизии

- `wave1/critic_01.md` … `critic_60.md` — 60 изолированных отчётов критиков (20 линз × 3)
- `wave2/synth_01.md` … `synth_20.md` — 20 синтезаторов (по 3 входа каждый, верификация по коду)
- `wave3/synth3_1.md` … `synth3_5.md` — 5 синтезаторов третьей волны (по 5 входов с пересечениями)
- `CRITIC_BASE.md`, `SYNTH_BASE.md`, `SYNTH3_BASE.md` — промпты-инструкции для каждой волны
- `full_diff.patch` — полный дифф vs master
