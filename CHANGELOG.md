# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.2.15] - 2026-05-11 — Sweep #9 feedback: BOM filter via printable-char count

Sweep #9 confirmed 2/3 PASS from v1.2.14 (#86 setValue chain works, response envelope fixed transitively). BOM filter was PARTIAL — control chars `/` were filtered (5 props gone) but BOM `﻿` still leaked at 5 Lumetri indices. This release replaces the regex anchor strip with a codepoint counting approach.

### Fixed

- **#25 BOM filter** v4 — replaced regex `^[\s﻿...]+|[\s﻿...]+$` with `__countPrintable(s)` that walks codepoints and counts characters in printable ranges (`0x20-0x7E` ASCII, `0x00A1-0x1FFF` and `0x3000-0xFFEF` non-ASCII letters/symbols). Value or name with **zero printable chars** is filtered. Empty strings also filtered. Truncate threshold lowered 500 → 200 to catch Lumetri "Auto Tone Analytics Data" (~250 chars). Vietnamese + CJK preserved by the non-ASCII ranges. Likely root cause of v1.2.14 failure: ExtendScript's regex engine has an edge case with `﻿` in `[...]` character classes that ASCII codepoint counting bypasses.

## [1.2.14] - 2026-05-11 — Sweep #8 feedback: #86 setValue chain, BOM filter root fix

Sweep #8 confirmed 3/4 fixes from v1.2.13 PASS but the BOM filter still leaked (Lumetri "﻾" still in output) and the #86 setValue mystery persisted. Both root-caused this release.

### Fixed

- **#86 `batch_set_clip_property`** v3 — `setValue(val, true)` and `setValue(val)` both reject some Lumetri/time-varying props with "Illegal Parameter type" even though `set_clip_opacity` standalone works on the same clip. Expanded the probe chain to also try `setValueAtKey(clipStart, val, true)` (adding a key first if needed) and `setValueAtTime(clipStart, val)`. Most properties still work via path 1; time-varying ones now fall through to the key/time-based variants. Failed entries surface `isTimeVarying` + `attempts: [...4 errors...]`.

- **#25 BOM filter** v3 — root cause was `prop.getValue(0, 0)` returning a **String wrapper object** (typeof "object") instead of a primitive, so `typeof val === "string"` never matched and the filter skipped. New `__sanitizeBlob(v)` coerces via `String(v)` first, strips BOM/zero-width/control chars (U+0000-U+001F), and reports the prop as internal when the result is empty. Also filters strings > 500 chars (Lumetri "Auto Tone Analytics Data" JSON blob). Applied to both `get_effect_properties` and `list_clip_effects`.

- **Response envelope regression** (indirect) — sweep #8 noted `get_effect_properties` / `list_clip_effects` responses wrapped as `"{\"success\":true,\"data\":{...}}"` JSON-string instead of an object. Root cause: BOM/control chars leaked into ExtendScript's JSON output, breaking the CEP plugin's `JSON.parse(result)` and triggering the fallback path that wraps `data: result` as a string. Fixed transitively by the BOM filter — clean JSON now parses on the CEP side, response shape is restored.

## [1.2.13] - 2026-05-11 — Sweep #7 fixes: #86 dedup, #87 silent-switch, #88 false-positive

Sweep #7 (against v1.2.12) confirmed 13/13 PASS for all prior fixes but surfaced 3 new bugs. All shipped with the patches the tester sketched in `bug.md`.

### Fixed

- **#88 `import_mogrt_from_library`** (CRITICAL) — Adobe's `seq.importMGTFromLibrary` silently succeeds even when the library or MOGRT name doesn't exist, returning `null` instead of throwing. Tool was reporting `imported: true` based on no-exception, breaking downstream pipelines. Now counts video-track clips + project root items before/after and returns a clear error when nothing was inserted. Also fixes `trackItemNodeId` discovery by looking up the new clip from the track when the API returns `null`. Response surfaces `vClipsAdded` and `rootItemsAdded`.

- **#87 `auto_reframe_sequence`** (HIGH) — Premiere natively switches active sequence to the reframed copy. Applied the Bug #76 pattern: snapshot `sourceSequenceId` + sequence-IDs-before, perform reframe, find the new sequence by ID delta, accept `make_active: false` (default) to restore the source as active via `app.project.openSequence(sourceId)`. Response now includes `sourceSequenceId`, `newSequenceId`, `activeSequenceId`, `activeRestored`.

- **#86 `batch_set_clip_property`** (MEDIUM) — same target was appearing twice in `notFound` with contradictory reasons because `didSet=false` after a setValue rejection let the outer loop continue and re-trigger the "not found" branch. Track `matchFound` separately; break the outer loop when a property match is found regardless of setValue outcome. Also added a 1-arg setValue fallback for properties that reject the `updateUI=true` flag. Failed-set entries now carry `matchedPath` ("ComponentName.PropertyName") to disambiguate.

- **#25 BOM polish** — internal-prop filter now also drops asset-blob strings that are just a BOM character (length < 4, codepoint 0xFEFF). Applied to both `get_effect_properties` and `list_clip_effects`.

## [1.2.12] - 2026-05-11 — Adobe ExtendScript docs unlock #61, #65, #66

User pointed to `https://ppro-scripting.docsforadobe.dev/` — the canonical (community-maintained) Premiere Pro ExtendScript reference. Three bugs previously marked "blocked on Adobe docs" or graceful-disabled now have correct signatures.

### Fixed — correct signatures from docs

- **#61 `scene_edit_detection`** — `performSceneEditDetectionOnSelection(actionDesired, applyCutsToLinkedAudio, sensitivity)` where:
  - `actionDesired` is a String enum: `"CreateMarkers"` or `"ApplyCuts"` (NOT a bool flag pair)
  - `applyCutsToLinkedAudio` is a Boolean
  - `sensitivity` is a String enum: `"LowSensitivity"` | `"MediumSensitivity"` | `"HighSensitivity"` (NOT a number 0-100)

  All previous probes (v1.2.6 onward) failed because they passed bool flags + numeric sensitivity. Tool now uses the documented form directly. New params: `action`, `apply_to_linked_audio`, `sensitivity` (with enum strings).

- **#65 `auto_reframe_sequence`** — `autoReframeSequence(numerator, denominator, motionPreset, newName, useNestedSequences)` where:
  - `motionPreset` is a String: `"slower"` | `"default"` | `"faster"` (NOT int 0/1/2 or `"slowerMotion"`/`"fastMotion"`)
  - The 4th arg is `newName` (String), **NOT** a nest flag — this is why every prior probe at 4-arg failed with "Illegal Parameter type"
  - `useNestedSequences` Boolean comes as the 5th arg

  Tool now calls the documented form directly. New params: `motion_preset` (enum updated to slower/default/faster), `new_name`, `use_nested_sequences`. Legacy enum values (`"slowerMotion"`, `"fastMotion"`) auto-mapped to the documented strings for backward compat.

- **#66 `import_mogrt_from_library` (RESTORED)** — sweep #6 graceful-disable was based on a probe of `app.project.importMGTFromLibrary` (undefined), but per docs the method lives on the **Sequence** object: `seq.importMGTFromLibrary(libraryName, mgtName, time, vidTrackOffset, audTrackOffset)`. Tool now calls the correct path; `library_name` is now a required param. Returns the imported TrackItem name.

## [1.2.11] - 2026-05-11 — Final cleanup: #36 graceful disable + #53 preset_path guard

Two cleanup fixes — both were in the codebase but the wrong shape (success-with-`added:false`, or letting Premiere throw a raw "Not Enough Parameters" instead of pre-validating).

### Fixed

- **#36 `add_adjustment_layer`** — previously returned `__result({added: false, available: false, note: ...})` when both QE and DOM paths were unavailable in 25.4, which looks like a success to callers. Now returns proper `__error({reason, _probe})` with workaround hints (import .prproj fragment, manual UI creation, or `add_black_video` + Lumetri).
- **#53 `create_sequence`** — Premiere 25.4 removed the 1-arg `createNewSequence(name)` overload; calling it without `preset_path` threw a raw "Not Enough Parameters". Tool now pre-validates `preset_path` and returns a clear error pointing to common preset locations + `create_sequence_from_clips` / `create_sequence_from_preset` as higher-level alternatives.

## [1.2.10] - 2026-05-11 — Context-overflow guards + Lumetri filter + batch diagnostics

Four bugs that had been deferred since v1.2.1 ("never attempted" per audit): three DX context-overflow issues + one batch-validation bug.

### Fixed — Context-overflow guards

- **#12 `get_full_sequence_info`** — on an 88-clip sequence the response was ~91KB. Added `summary_only`, `tracks_limit`, `clips_per_track_limit`, and `include_effects` params. Default still returns full detail (no breaking change); `summary_only: true` collapses to counts + totals; per-track `clipsTruncated` flag exposes when capping happens. Effects list is the heaviest field and can now be dropped with `include_effects: false`.
- **#22 `get_project_panel_metadata`** — raw XML was 130KB+ on large projects. Default mode is now `summary` (size + `<MetadataEntry>` row count + 1KB head/tail preview). Pass `format: 'raw'` to get the full XML (use when round-tripping back to `set_project_panel_metadata`).

### Fixed — Lumetri binary-blob noise

- **#25 `get_effect_properties`** & **`list_clip_effects`** — Lumetri Color exposes ~25 internal binary-blob properties (whitespace/BOM-only displayNames + pointer-style 18-digit numbers). Both tools now filter these by default via `__isInternalProp(name, val)` and surface a `filteredInternalCount` field. Pass `include_internal: true` to see the unfiltered list. Per-component `filteredInternalCount` in `list_clip_effects` shows where the noise lives.

### Fixed — Batch validation

- **#35 `batch_set_clip_property`** — when a target was missing `trackType`/`trackIndex` (e.g. `{clipIndex:1}` shorthand) the tool silently mis-resolved to audio track 0. Each target is now validated: missing `trackType`/`trackIndex` inherits from the previous valid target; per-target `notFound` entries carry a `reason` (missing field, out-of-range track/clip, property-not-found) plus `availableProps` when the property name doesn't match anything on the clip.

## [1.2.9] - 2026-05-11 — Expanded probe matrices for #61 and #65

Tester sweep #6 dev report flagged `scene_edit_detection` and `auto_reframe_sequence` as "needs Adobe docs" because prior probes exhausted obvious bool/string variants. This release adds the two probe shapes that were missing from the matrix per ExtendScript convention.

### Probing — expanded signature matrices

- **#65 `auto_reframe_sequence`** — added 5-arg all-int form `(num, den, motionInt, nestInt, useUndoLog)` per older Adobe ExtendScript reference. `motionInt` maps `"slowerMotion"→0`, `"default"→1`, `"fastMotion"→2`; `nestInt` maps `false→0`, `true→1`. Also added 4-arg all-int and `(w,h, motionInt, nestInt)` variants. Existing string/bool variants kept as fallbacks. 9 total signatures probed.
- **#61 `scene_edit_detection`** — added bool-as-int variants per ExtendScript convention (Premiere often refuses `true`/`false` and requires `1`/`0`). New probes: 3-arg `(1/0, 1/0, sensInt)`, `(1/0, 1/0, sensFloat)`, 4-arg `(1/0, 1/0, sens01, 0)`, 2-arg `(1/0, 1/0)`, 1-arg `(1/0)`. Sensitivity also probed as both int and 0..1 normalized. 10 total signatures probed.

## [1.2.8] - 2026-05-11 — Sweep #6 dev-report fixes: dbToLinear, Channel Volume, graceful disables

Sweep #6 tester ran live ExtendScript probes in Premiere 25.4.1 to gather concrete fix data (rather than guesses). Each finding shipped with a proven test sequence; this release applies those patches.

### Fixed — Critical write paths

- **#72 `set_clip_volume`** v3 — `Volume.Level` expects **linear amplitude** (10^(db/20)), not dB. Tester live-probe confirmed `setValue(-6)` clamps to 0 while `setValue(dbToLinear(-6)) = 0.5012` persists correctly. Tool now converts dB → linear before writing and dB → linear → dB round-trip on readback. Surfaces both `verifiedLinear` and `verifiedDb`.
- **#28 `set_clip_pan`** v3 — Premiere 25.4 removed the `Panner`/`Balance` component; pan now routes through `Channel Volume` (matchName "Internal Channel Volume Stereo") Left/Right linear gains. Tool finds `Channel Volume` by matchName, computes L/R gains from pan (-100..100), writes both, verifies by readback.
- **#19 `inspect_dom_object`** v4 — host properties like `getOverrideColorSpaceList` are actually **arrays**, not methods, despite the `get`-prefix name. Tool now checks `Object.prototype.toString.call(val) === "[object Array]"` BEFORE generic object handling and renders `[array: N items]`. Removed the (incorrect) 3rd/4th-stage function-detection probes.

### Fixed — Honest disables (with workarounds in error)

- **#66 `import_mogrt_from_library`** v2 — `app.project.importMGTFromLibrary`, `app.project.libraries`, `app.project.importMGT`, `app.project.importMOGRT` are all `undefined` in Premiere 25.4 (live probe). Adobe removed the CC Library MOGRT import API. Tool returns a clear error with three workarounds: (1) manual download + `import_mogrt`, (2) sequence + XML, (3) `add_caption`.
- **#52 `set_sequence_pixel_aspect_ratio`** v2 — `seq.videoPixelAspectRatio` is `undefined` in Premiere 25.4 (property removed; all writes silently no-op). Tool returns a clear error with three workarounds: (1) Sequence Settings dialog, (2) `set_sequence_settings`, (3) `create_sequence` with preset.

### Fixed — Polish

- **#83 `get_clip_volume._probe[].name`** — strengthened with `String().trim()` + fallback to `p.name` so whitespace-only `displayName` no longer reads as empty.
- **#85 `get_clip_speed._probe`** — renamed `computedRatio_sourceDurOverTimelineDur` → `qeTickInverse` with `_note` explaining it's QE-DOM-internal and to rely on `speedPercent` for user-facing values.
- **#65 `auto_reframe_sequence`** — confirmed `autoReframeSequence` (camelCase) is the right method name; signature still undocumented in Adobe ExtendScript reference. Updated description to flag this clearly.
- **#72 `get_clip_volume`** — companion read-side fix: now applies `linearToDb` to the stored linear value and surfaces both `volumeDb` and `volumeLinear`.

## [1.2.7] - 2026-05-11 — Sweep #4 retest fixes: foundation + #72 inversion + v1.2.6 rewrap

Addresses sweep #4 retest (`notebug.md`) which showed 12/24 PASS overall but exposed two systemic issues:

### Fixed — FOUNDATION

- **`__error()` now accepts an object payload** (`{reason, _probe, ...}`) — previously string-only, so `__error({reason, _probe})` produced `"[object Object]"`. Object form merges all fields into the error response so callers see probe context.
- **`__probeState` global slot** — a tool can set `__probeState = {tool, attempts, ...}` at the start; if an exception escapes the inner try/catch, the outer wrapper's catch auto-merges this state into the error response. Solves the v1.2.6 "raw error, no _probe" leak.
- **Outer wrapper marks `_outerCatch: true`** when the safety-net catch fires, so callers know the leak path took over.

### Fixed — INVERTED ROOT CAUSE (Bug #72 v2 — HIGHEST priority)

- **#72 `set_clip_volume`** — sweep #4 _probe revealed `get_clip_volume` was actually correct: `Volume.Level = 0` after `setValue(-9, true)`. The SET was the silent-fail because `setValue(value, true)` with `true` updateUI flag adds a keyframe at t=0 (outside clip range) on time-varying properties. Now detects `isTimeVarying`, prefers `setValueAtKey(clipStart, target, true)` for time-varying, falls back through `setValue(target)` → `setValue(target, false)` → legacy `setValue(target, true)`. **Verifies persistence by reading back** at `clipStart + 0.001s`. Returns `verifiedValue` + write-attempt log.

### Fixed — v1.2.6 REWRAP (8 tools)

Previous v1.2.6 try/catch chains leaked raw exceptions despite intent. Rewrapped with structured `__probeState` accumulator so tester sees `_probe` data on failure:

- **#30 `set_clip_speed_qe`** — 5-variant signature probe with per-attempt `{signature, thrown, error}` entries.
- **#31 `reverse_clip`** — 3-path chain (setReverse → setSpeed 5-arg → DOM setSpeed) with attempt log.
- **#48 `step_forward` / `step_backward`** — probes `setPlayerPosition(String)` vs `setPlayerPosition(Number)`.
- **#52 `set_sequence_pixel_aspect_ratio`** — now also probes struct `{num, den}` form + `seq.setPixelAspectRatio` method.
- **#28 `set_clip_pan`** — handles both string `"Audio"` and integer enum `mediaType` (sweep #4 hint). Per-component property probe.
- **#61 `scene_edit_detection`** — captures `selectionCount` + per-signature attempt log.
- **#65 `auto_reframe_sequence`** — same probe format with target W/H/num/den context.
- **#66 `import_mogrt_from_library`** — probes with/without `library_name` first arg.

### Fixed — Carry-over polish

- **#19 `inspect_dom_object`** — added 3rd-stage function detection (`String(val).indexOf("function") === 0`) and 4th stage (`val.call/apply` existence check) for host methods that escape `instanceof Function`.
- **#83 `_probe[0].name` empty for Bypass** — `prop.displayName || "(unnamed)"` fallback.
- **#85 `computedRatio: 870` unclear** — renamed to `computedRatio_sourceDurOverTimelineDur` with explicit `note` field clarifying it's informational only.
- **#84 `set_clip_transform.position` unit inconsistency** — added `position_unit` param ("pixels" default, matches `set_clip_position` and Premiere UI; "normalized" available as opt-in). Anchor point follows same unit. Response surfaces `positionUnit` + `sequenceFrameSize`.

## [1.2.6] - 2026-05-11 — Deferred bugs from v1.2.4 (10 bugs, signature probing)

Addresses the 10 deferred bugs from v1.2.4 retest. Each tool now probes multiple signature variants and surfaces probe results in the error when nothing works — so tester can directly tell dev what API surface is actually exposed in their Premiere build.

### Fixed — signature probe family

- **#30 `set_clip_speed_qe`** — `qeClip.setSpeed(speed)` (1-arg) throws "Not Enough Parameters" in 25.4. Tool probes 5/4/3/2/1-arg variants of `setSpeed(speed, frameRate, maintainAudioPitch, reverse, rippleEdit)`. Returns `signatureUsed`.
- **#31 `reverse_clip`** — `qeClip.setReverse(bool)` throws "Unknown error exception" in 25.4. Falls back to `qeClip.setSpeed(currentSpeed, "1", false, reverse, false)` (the 5-arg form), preserving the clip's current speed. Probes 3 paths total.
- **#61 `scene_edit_detection`** — `performSceneEditDetectionOnSelection()` (no-arg) throws "Not Enough Parameters" in 25.4. Probes 5 signature shapes (object with flags, 3-arg bool+bool+num, 2-arg, 1-arg, no-arg). Adds new `apply_cuts` / `create_markers` / `sensitivity` params.
- **#65 `auto_reframe_sequence`** — `autoReframeSequence(w, h, false)` throws "Illegal Parameter type" in 25.4. Tool now computes the GCD of width/height and probes 7 variants including the new `(numerator, denominator, motionPreset, nest)` signature. Adds `motion_preset` / `nest_clips` params.
- **#66 `import_mogrt_from_library`** — `importMGTFromLibrary(name, ticks, v, a)` throws "Not Enough Parameters" in 25.4. Adobe added a required `libraryName` first arg in 25.4. Tool now accepts `library_name` and probes both new and legacy signatures.

### Fixed — Param type / property assignment

- **#48 `step_forward` / `step_backward`** — `player.step(1)` threw "Illegal Parameter type" in 25.4. Replaced with pure DOM approach: read sequence frame rate via `getSettings().videoFrameRate.ticks`, compute new playhead position, call `seq.setPlayerPosition(ticks)`. No QE dependency.
- **#52 `set_sequence_pixel_aspect_ratio`** — `settings.videoPixelAspectRatio = float` threw "Illegal Parameter type" in 25.4. Tool probes number → string → parseFloat formats; reports the original value's type in the response so caller can pick the right form.
- **#38 `trim_clip`** — `clip.inPoint = ticksString` is read-only in 25.4 (silent no-op). Now uses `setInPoint(ticks, mediaType)` method (where mediaType=1 for video, 2 for audio), probes 1-arg fallback, then direct assignment. Validates by comparing before/after ticks and reports `inPointChanged` / `outPointChanged` flags.

### Fixed — Component / iteration logic

- **#28 `set_clip_pan`** — "Could not set pan - is this an audio clip?" was false-negative because the panner component name varies in 25.4 ("Panner" / "Panner › Balance" / "Channel Volume"). Tool now does case-insensitive substring match across multiple hint names; probes "Balance" / "Pan" / "Pan/Balance" property names. Returns track type validation up front; surfaces full component list on miss.
- **#20 `get_track_info.transitions`** — DOM `track.transitions` enumerates clip-adjacent slots in 25.4 (caller saw clip range pairs, not transitions). Replaced with QE `qeTrack.getTransitionAt(i)` iteration, which only yields real transition objects. Adds `name`, `duration`, `alignment` to the response. `transitionsSource: "qe"` indicates path.

## [1.2.5] - 2026-05-11 — `delete_project_item` proper fallback chain (Bug #82 v2)

The v1.2.4 fix for Bug #82 was incomplete — it used `item.clearOut()` (which doesn't exist on `ProjectItem` — that was confused with `clearOutPoint()`) and a hardcoded `executeCommand(20012)` cmdId that varies across Premiere builds.

After researching the API surface in Premiere 25.4, replaced with a proper 5-path fallback chain:

1. **`app.project.deleteAsset(item)`** — legacy (still present in some 25.x builds)
2. **`item.deleteBin()`** — works on ANY ProjectItem in 25.4, not just bins (community-documented quirk)
3. **`qe.project.deleteAsset(item)`** — QE parallel that often survives DOM strip
4. **`item.select()` + `executeCommand(findMenuCommandId("Clear"))`** — Bruce Bullis pattern with DYNAMIC cmdId lookup (falls through "Clear" → "Edit.Clear" → "Delete")
5. **`item.moveBin(__mcp_trash)`** — soft-delete to a `__mcp_trash` bin as graceful last resort

Tool now returns `via` field showing which path succeeded, plus `_probe` snapshot of which delete APIs the running Premiere build exposes. Same chain applied to `delete_multiple_project_items`.

## [1.2.4] - 2026-05-11 — Sweep #2 retest fixes (12 bugs)

Addresses sweep #2 retest results in `notebug.md`. CRITICAL data-integrity bugs first, then set/get inconsistencies, then probe/disambiguation improvements.

### Fixed — CRITICAL data integrity

- **#77 `get_clip_properties` negative outPoint / sub-frame end / int `isSpeedReversed`** — after razor/split, `clip.outPoint.ticks` and `clip.end.ticks` can return invalid sentinel values. Now reads raw values, repairs via `start + duration` / `inPoint + duration` when impossible (negative or sub-frame). Surfaces a `_raw` snapshot + `_note` when repair fires. `isSpeedReversed` and `isSelected` coerced to proper booleans.
- **#81 `split_clip` silent no-op** — previously returned `split: true` even when the razor was a no-op (e.g., time fell outside any clip on the target track because `set_zero_point` shifted the coordinate system). Now pre-validates that a DOM clip on the target track contains `time_seconds`, returns a clear error with the available clip range otherwise; verifies post-razor that the clip count actually increased.
- **#76 `duplicate_sequence` silent active-switch + missing new sequence ID** — returns both `originalSequenceId` and `newSequenceId` (snapshotted via before/after sequence-ID diff). Adds `make_active: boolean` param — `false` restores the original as active after cloning.

### Fixed — set/get inconsistency

- **#72 `get_clip_volume` always returns 0** — was calling `getValue()` on a time-varying Level property without specifying time. Now detects `isTimeVarying`, samples via `getValueAtTime(clipStart + 0.001s)`, falls back to `getValue()`, and surfaces a `_probe` array of all Volume sub-properties when neither works.
- **#73 `get_clip_speed` always returns 1** — DOM `clip.getSpeed()` doesn't always reflect QE `setSpeed()`. Now probes three sources (DOM `getSpeed`, QE `qeClip.speed`, computed source/timeline duration ratio), picks the most reliable, returns `speedPercent` + `_probe`.

### Fixed — Uniform Scale family (Bug #75 / #34)

- **#75 `set_clip_scale`** — auto-detects Uniform Scale state. If "Scale" property exists (uniform=true) sets it directly; if only "Scale Width"+"Scale Height" exist (uniform=false), sets both. Previously failed silently when uniform=false because "Scale" didn't exist on the Motion component.
- **#34 `set_scale_width_height`** — flips Uniform Scale OFF first, **re-reads** the property collection (Premiere rebuilds it after the toggle in 25.4), uses case-insensitive trimmed matching, and emits a probe of available Motion property names when one isn't found.

### Fixed — Lumetri Saturation (Bug #74)

- **#74 `color_correct` saturation param "Invalid parameter"** — Lumetri has 3x "Saturation" properties (Basic / Creative / Color Wheels). Now skips Saturation entries whose current value isn't a plain number (those are Color Wheels color arrays), wraps each property set in `try/catch` so a single bad value doesn't abort the rest, and surfaces a clear error if Saturation never got applied.

### Fixed — Pending bugs from v1.2.1 retest

- **#45 `add_caption`** — detects missing `captionTracks` collection or zero tracks up front; returns actionable error explaining the `import_captions` → `create_caption_track` → `add_caption` workflow instead of a raw `TypeError: undefined is not an object`.
- **#67 `set_mogrt_property`** — detects whether the clip actually has an MGT component before iterating. If it's a regular video clip, returns a clear redirect to `set_effect_property` with the available component list. If MOGRT but property name not exposed, probes and lists available MGT properties.
- **#58 `import_folder`** — adds `recursive` and `extensions` params, filters by common media extensions by default, skips hidden/system files, and surfaces the skipped non-media filenames in the error when nothing matches so callers can debug.
- **#60 `import_fcp_xml`** — pre-validates the FCPXML file path with `File.exists` and wraps `openFCPXML` in try/catch (was throwing generic "Not Enough Parameters" on bad paths).

### Fixed — Cleanup-phase findings

- **#82 `delete_project_item` + `delete_multiple_project_items`** — `app.project.deleteAsset()` was removed in Premiere 25.4. Now tries `deleteAsset` → `item.clearOut()` → `executeCommand("Clear")` in order with graceful fallbacks; surfaces a workaround note (manual Backspace in Project panel) if all paths fail.

### Fixed — Duplicate-name disambiguation (Bug #78 / #79)

- **#78 `list_available_effects` / `list_available_audio_effects`** — annotates duplicate display names (e.g., "Noise" appears 2x, "Transform" appears 2x) with `duplicateGroup`, `dupIndex`, `dupCount`. Callers can disambiguate by `index`.
- **#79 `list_clip_effects` + `set_effect_property`** — `list_clip_effects` flags duplicate property names per component (e.g., Opacity has 2x "Blend Mode"). `set_effect_property` accepts new optional params `property_index` and `match_name` for precise targeting; resolution priority is property_index → match_name → property_name. Existing callers using only `property_name` keep working.

## [1.2.3] - 2026-05-11 — `add_text_overlay` honest disable

### Fixed — `add_text_overlay` (out-of-scope retest finding)

While fixing v1.2.2, discovered that `add_text_overlay` was calling `seq.createCaptionTrack(text, ticks, "Subtitle")` — which creates a closed-caption track (for subtitles), **not** a text overlay graphic. Wrong API, wrong feature.

After researching Premiere 25.4 APIs: Adobe removed the legacy Title Designer in Premiere 2024+ and **provides no DOM-level API to create a text graphic** (confirmed by Adobe community manager Bruce Bullis). The only programmatic path is Motion Graphics Templates (.mogrt), and Adobe does not ship default text MOGRTs at known paths.

Applied the same disable pattern as `add_color_matte`:
- Probe hypothetical `app.project.createSupportItem("title", ...)` and `rootItem.createTitle(...)` paths (so the tool auto-recovers if Adobe adds one later).
- **Deliberately refuse** to invoke `qe.project.newTitle()` — would open the Legacy Title Designer modal and block the bridge (same trap as Color Picker in Bug #37).
- Return a clear error with four workarounds: (1) `import_mogrt` + `set_mogrt_property("Source Text", ...)`, (2) `import_mogrt_from_library`, (3) `add_caption` if user wanted subtitles, (4) manual UI creation.

## [1.2.2] - 2026-05-11 — Retest follow-up (Bug #19 + Bug #37)

Addresses the two bugs that failed the v1.2.1 retest. See `notebug.md` "RETEST RESULTS — v1.2.1".

### Fixed — `add_color_matte` (Bug #37) — proper fast-fail

- The v1.2.1 `__withDialogsSuppressed()` wrapper did **not** suppress the Color Picker dialog because `qe.project.newColorMatte()` opens a native QE DOM modal, not an ExtendScript dialog — `userInteractionLevel = NEVER_INTERACT` only affects ExtendScript dialogs.
- New behaviour: probe DOM-level paths (`rootItem.createColorMatte`, `app.project.createColorMatte`) first, and **deliberately refuse** to invoke the QE path. If no DOM API exists, return a clear error with three workarounds (`add_black_video` + Lumetri tint, `add_adjustment_layer` + color effect, manual UI creation). Bridge no longer blocks on a Color Picker.

### Fixed — `inspect_dom_object` (Bug #19) — function references no longer leak `"[object]"`

- ExtendScript host methods sometimes report `typeof === "object"` instead of `"function"`, so the previous function-detection path missed them and the inspector recursed into them then emitted `"[object]"` strings at the leaf.
- Added second-probe `val instanceof Function` in both `__sanitizeForJson()` and `inspectObj()` so host methods are coerced to `"[function]"` (in the inspector) and `null` (in the JSON sanitizer) reliably.
- Also fixed an edge case where `inspectObj` left a property `undefined` instead of `null` for missing values.

### Confirmed working — no changes needed

- Modal dialog tools `replace_clip_media` (#40), `four_point_edit` (#41), `set_workspace` (#56), `close_project` (#70) all invoke DOM-level APIs (`overwriteClip`, `setWorkspace`, `closeDocument`) — `__withDialogsSuppressed()` correctly suppresses their "Save?"/"Replace?" prompts. These were not retested in v1.2.1 because the bridge was blocked by Bug #37; with #37 fixed, they should work as designed.

## [1.2.1] - 2026-05-11 — Tester sweep bug fixes (Bugs #6–#70)

Addresses ~40 bugs from the 443-tool tester sweep (`notebug.md` Test run 2026-05-10).

### Fixed — CRITICAL safety

- **#39 `slip_edit` / `slide_edit` / `roll_edit` data-corruption bug** — these QE methods in 25.4 have an unknown unit-conversion regression that displaces clips by ~69,600 seconds for a 0.5s offset. **Tools temporarily DISABLED** with a clear error pointing users to UI keyboard shortcuts (Y / U / N) until the correct signature is verified on a controlled sandbox.

### Fixed — Modal dialog suspend (was misdiagnosed as bridge crash)

- **#37 / #40 / #41 / #56 / #70** — wrapped `add_color_matte`, `add_text_overlay`, `replace_clip_media`, `four_point_edit`, `set_workspace`, `close_project` in a new `__withDialogsSuppressed()` helper that sets `app.userInteractionLevel = NEVER_INTERACT` for the call's duration. Premiere modal dialogs that previously froze the ExtendScript engine for 30s+ (Color Picker, Title Designer, Replace Media confirmation, Save Workspace, Save Before Closing) are now auto-suppressed.

### Fixed — ProjectItemType mapping regression (May 8 → May 10)

- **#10 / #15 / #16** — `list_project_items`, `find_project_item_by_name`, `find_items_by_media_path` all reported wrong `type` (mp4 files appearing as "sequence" / "bin"). Added unified `__projectItemType(item)` helper in script-builder.ts (handles `type 1` + `isSequence()` discrimination → "footage" vs "sequence", `type 2` → "bin", `type 3` → "root", `type 4` → "file") and used it in all 3 sites.

### Fixed — JSON output sanitization

- **#6 / #14 / #17 / #18 / #19 / #25** — `__jsonStringify()` and new `__sanitizeForJson()` helpers now recursively replace `NaN`, `Infinity`, `-Infinity`, and `undefined` with `null` so output is RFC 8259-valid. Functions and other non-serializable objects coerce to `null` instead of leaking `"[object]"`. Applies to all tools.

### Fixed — Sentinel return values

- **#11 `get_sequence_in_out_points`** — detect Premiere's `-400000` sentinel and return `null` with `isSet: false` instead of the raw negative-near-zero seconds value.
- **#21 `get_source_monitor_position`** — detect the same sentinel and return `loaded: false` cleanly when no clip is open.

### Fixed — API-removed graceful degradation

Wrapped the following tools to detect API absence and return `{ available: false, note: ... }` with a workaround hint instead of throwing raw ExtendScript errors:

- **#7 `get_work_area`** — defensively probes `seq.workInPoint/workOutPoint`, accepts both Time-object and string-of-ticks forms, reports unavailable cleanly.
- **#8 `is_work_area_enabled`** — checks `typeof seq.isWorkAreaBarEnabled === "function"` first.
- **#9 `get_encoder_presets`** — guards `encoder.getFormatList`, returns helpful note pointing to AME UI for preset discovery.
- **#27 `add_audio_keyframes`** — falls back from removed `levelProp.addKeyframe` to `levelProp.addKey` + `setValueAtKey`; reports unavailable with workaround if neither exposed.
- **#29 `remove_transition`** — tries `qeClip.removeTransition`, then `qeClip.removeTransitionAt`, then DOM `transitionIn/Out.remove`.
- **#32 `enable_disable_clip`** — tries DOM `clip.setDisabled`, then `clip.disabled` property assignment, then QE `qeClip.setEnabled`/`disable`.
- **#36 `add_adjustment_layer`** — tries `qeSeq.addAdjustmentLayer`, then `rootItem.createNewAdjustmentLayer + overwriteClip`.
- **#47 `go_to_next_edit` / `go_to_previous_edit`** — falls back from removed QE `player.goToNextEdit/goToPreviousEdit` to scanning all clip start/end ticks for the nearest boundary, then `seq.setPlayerPosition()`.
- **#49 `add_track`** — tries `seq.insertVideoTrackAt`, then `seq.addTracks()` 7-arg form.
- **#50 `delete_track`** — tries `seq.deleteVideoTrackAt`/`deleteAudioTrackAt`, then QE `qeSeq.deleteVideoTrack/deleteAudioTrack`.
- **#54 `undo` / #55 `multiple_undo`** — falls back from removed `app.project.undo` to `app.executeCommand(findMenuCommandId("Undo"))`.
- **#57 `export_frame` / `export_edl` / `export_aaf`** — guard each `seq.exportFramePNG`/`exportAsEDL`/`exportAsAAF` call; for frame export also probes `exportFrameJPEG`.
- **#63 `manage_proxies`** — guards `item.createProxy`/`item.attachProxy`/`app.project.setProxyEnabled`/`isProxyEnabled`.
- **#64 `transcribe_sequence`** — guards `seq.transcribe`.

### Fixed — Param-type and pre-validation

- **#23 `get_clip_at_position`** — returns `{ found: false, ... }` instead of throwing when no clip overlaps the queried position.
- **#26 `apply_lut`** — pre-validates LUT file existence with `new File(path).exists` so error message is meaningful.
- **#33 `set_anti_alias_quality`** — converts boolean to 0/1 integer (25.4 "Anti-flicker Filter" property rejects bool).
- **#42 / #43 `add_marker`** — switches to `createMarker(seconds)` (Number) form, tries `clip.getMarkers()` before `clip.markers` for clip-level markers.
- **#44 `get_captions`** — detects missing `seq.captionTracks` and returns empty list with note instead of throwing.
- **#46 `import_captions`** — pre-validates file existence (was silently succeeding on missing paths via importFiles fallback).
- **#59 `import_image_sequence`** — same pre-validation pattern.
- **#62 `add_to_render_queue`** — `preset_path` now effectively required (ENCODE_MATCH_SEQUENCE fallback removed in 25.4); pre-validates preset exists.
- **#68 `encode_file`** — pre-validates input + preset paths.
- **#69 `encode_project_item`** — pre-validates preset path.
- **#6 `list_sequences`** — replaces broken `seq.zeroPoint.ticks` (undefined in 25.4) with direct string-of-ticks form; adds `start`/`end`/`inPoint`/`outPoint` fields properly null when unset.

### Known limitations still pending

- **#12 `get_full_sequence_info` / #22 `get_project_panel_metadata`** — context-window overflow (91KB / 131KB outputs). Need pagination/summary mode — not yet implemented.
- **#20 `get_track_info.transitions`** — returns clip ranges instead of real transitions (suspect API field shape change). Needs deeper QE investigation.
- **#25 `get_effect_properties` Lumetri binary garbage** — Lumetri exposes ~25 internal binary-blob properties. JSON sanitization now hides `undefined`/`NaN` but doesn't filter Lumetri's internal-only props.
- **#28 `set_clip_pan`** — audio-clip detection still wrong; pan API path needs probing.
- **#30 `set_clip_speed_qe` / #31 `reverse_clip`** — likely cousins of fixed Bug 3c-tris; need signature update.
- **#34 `set_scale_width_height`** — "Scale Height" property name likely needs probing.
- **#39 slip/slide/roll** — disabled (not fixed) — need controlled sandbox to verify correct unit.
- **#48 `step_forward` / `step_backward`** — Illegal Parameter type; needs Time vs Number probing.
- **#52 / #53 / #58 / #60 / #61 / #65 / #66 / #67** — schema/param mismatches with 25.4 APIs (need individual verification).

### Architecture

- Added to `src/bridge/script-builder.ts`:
  - `__projectItemType(item)` — unified type-string mapping
  - `__safeJsonValue(v)` — value-level NaN/Infinity/undefined → null
  - `__sanitizeForJson(obj)` — recursive sanitization invoked by `__jsonStringify`
  - `__withDialogsSuppressed(fn)` — runs callback with `app.userInteractionLevel = NEVER_INTERACT` and restores

### Changed

- Version: 1.2.0 → 1.2.1

## [1.2.0] - 2026-05-10 — Comprehensive effect-wrapping milestone

### Highlights

- **+136 net tools** since v1.1.1 baseline (307 → 443) — most of which are ergonomic effect wrappers added across 22 batches in this multi-session work.
- **~100 effect-specific wrappers** for nearly all practical Premiere Pro 25.4 video effects (color/blur/keying/distortion/stylize/generators/wipes/VR/burn-ins).
- **Phase 3.5 VR/360 + Phase 3.8 Render & Replace** features added (Phase 3.6 Surround pan and Phase 3.9 Master Clip Effects marked NOT FEASIBLE in 25.4 — documented).
- Multiple **25.4 ExtendScript regression fixes** — DOM↔QE clipIndex mismatch (21 sites), `qeTrack.addTransition` migration, `clip.components[i].remove` migration, sequence in/out point regressions.
- Five **reusable patterns** documented in plan.md: dup-name flag handling, layer-ref skip, binary-blob skip, normalized vs percent, Adobe quirks.

### Documented limitations (in 25.4)

- `app.saveWorkspace`/`saveWorkspaceAs`/`deleteWorkspace` — undefined.
- `app.preferences`/`autoSavePrefs`/`userPreferences` — undefined.
- Mask bezier path APIs — not exposed at any level.
- Master Clip Effects — `projectItem` doesn't expose components/addEffect.
- Effects with binary-blob properties (Shape's Path/Appearance, Color Space Transform's Arb Data) — only numeric/enum props settable.
- Effects with layer-reference properties (Compound Blur's Blur Layer, Texturize's Texture Layer, Compound Arithmetic's Second Source Layer, Calculations's Second Layer, Set Matte's Take Matte From Layer, Difference Matte/Track Matte/Image Matte) — placeholder `4294967295` returned, setValue rejected. Wrappers expose all OTHER props with the limitation documented.

### Changed

- Tool count: 443 (unchanged from v1.1.19; v1.2.0 is a milestone designation)
- All 19 minor bumps from this session (v1.1.2 through v1.1.19) consolidated under this 1.2.0 line in the changelog.

### Notes

This release closes the long-haul effect-wrapping work that started post-Hetpatel-11/Antipaster merge. From here, future work focuses on Phase 3.1 Dynamic Link AE (research-heavy, requires AE running) and downstream features.

## [1.1.19] - 2026-05-10 — Phase 4 effect-wrapping complete

### Added — 6 new tools (437 → 443)

#### Phase 4 batch 22 — VR group B (final batch, 6 tools, `src/tools/effects.ts`)

- **`apply_vr_color_gradients`** — 360° gradient generator (up to 8 control points). Wrapper exposes global params; per-point colors via apply_effect_with_properties.
- **`apply_vr_projection`** — converts between 360° projection types (equirectangular, fisheye, cubemap variants). Input + output projection/layout/FoV plus pan/tilt/roll.
- **`apply_vr_digital_glitch`** — seamless 360° glitch (color/geometry distortion radiating from POI). Animate Master Amplitude or Distortion Evolution.
- **`apply_vr_chromatic_aberrations`** — seamless 360° per-channel RGB displacement. POI + Aberration Red/Green/Blue + falloff distance.
- **`apply_vr_fractal_noise`** — seamless 360° fractal noise generator. Animate Evolution for movement.
- **`apply_vr_de_noise`** — seamless 360° denoising. Noise Type + Noise Level (0-1 normalized).

### Changed

- Tool count: 437 → 443
- Updated `package.json` description

### Verified

- 16 properties round-trip verified.
- Discovery: VR Digital Glitch `Master Amplitude` clamps to max 100 (set 150 → stored 100).

### 🎯 Phase 4 effect-wrapping work complete

After 16 minor releases (v1.1.4 → v1.1.19) and 22 batches across this session, **all practical Premiere Pro 25.4 video effects are now wrapped** as ergonomic MCP tools (~100 effect-specific wrappers + intrinsic helpers). Skipped due to API limitations: Shape (binary blob Path/Appearance), Mask (no API), Set Matte / Track Matte / Image Matte / Difference Matte (require external layer references not settable from API in 25.4).

**Cumulative session impact**: 307 → 443 tools (+136 net). Test clip C7984.MP4 cleaned up across all 22 batches.

## [1.1.18] - 2026-05-10

### Added — 5 new tools (432 → 437)

#### Phase 4 batch 21 — VR group A: projection/rotation/seamless blur-sharpen-glow (5 tools, `src/tools/effects.ts`)

- **`apply_vr_plane_to_sphere`** — projects flat content into 360° equirectangular VR (logos, text, graphics). Configure FoV, scale, source orientation (tilt/pan/roll) and projection orientation. 16 props.
- **`apply_vr_rotate_sphere`** — rotates entire 360° sphere (tilt/pan/roll) for horizon adjustment or animated head-turn.
- **`apply_vr_blur`** — seamless 360° blur respecting spherical wraparound (no edge artifacts).
- **`apply_vr_sharpen`** — seamless 360° sharpening.
- **`apply_vr_glow`** — seamless 360° bloom/glow with luma threshold + radius + brightness/saturation + tint color.

### Changed

- Tool count: 432 → 437
- Updated `package.json` description

### Verified

- 10 properties round-trip verified.
- All 5 VR effects share standard VR header props: Frame Layout (mono/stereo), Horizontal/Vertical Field of View — exposed consistently across wrappers.

## [1.1.17] - 2026-05-10

### Added — 5 new tools (427 → 432)

#### Phase 4 batch 20 — HDR/flip/lighting/wipe (5 tools, `src/tools/effects.ts`)

- **`apply_sdr_conform`** — quick brightness/contrast/soft-knee for HDR→SDR or SDR delivery.
- **`apply_vertical_flip`** — flip top-to-bottom (no params, toggle).
- **`apply_horizontal_flip`** — flip left-to-right (no params, toggle).
- **`apply_lighting_effects`** — Photoshop-style multi-light (5 lights + ambient + bump). Wrapper exposes Light 1 + ambient/surface params using seen-flag pattern. Light 2-5 require apply_effect_with_properties.
- **`apply_gradient_wipe`** — luminance-mapped wipe (Gradient Layer ref NOT settable from API).

### Changed

- Tool count: 427 → 432
- Updated `package.json` description

### Verified

- 13 properties + 2 toggle effects round-trip verified.

### Discovery

- **Gradient Wipe `Transition Completion` / `Transition Softness` are 0.0-1.0 normalized** (NOT 0-100 like Linear/Radial Wipe). Set 50 clamps to 1.0. Documented in description.
- **Lighting Effects has 5 lights × 9 props each = 45 dup-named props**. Wrapper uses 8 seen-flag vars (lightTypeSeen, lightColorSeen, centerSeen, majSeen, minSeen, angleSeen, intensitySeen, focusSeen) to target Light 1 only.

## [1.1.16] - 2026-05-10

### Added — 5 new tools (422 → 427)

#### Phase 4 batch 19 — Noise/matte/animation/retiming (5 tools, `src/tools/effects.ts`)

- **`apply_noise_hls_auto`** — animated HLS-channel noise with built-in Noise Animation Speed fps (no keyframing needed).
- **`apply_noise_alpha`** — alpha-channel noise (grungy edges, weathered overlays).
- **`apply_remove_matte`** — removes premultiplied edge fringing (White or Black matte cleanup).
- **`apply_write_on`** — animated brush stroke. Animate brush_position to draw; stroke_length controls trail fade.
- **`apply_timewarp`** — frame-accurate retiming with optical-flow / pixel-motion / frame-blend (preserves motion blur). Wrapper exposes stable numeric/enum props; Smoothing/Tuning/Weighting/Motion Blur panel toggles return object — skipped from wrapper.

### Changed

- Tool count: 422 → 427
- Updated `package.json` description

### Verified

- 15 properties round-trip verified.

## [1.1.15] - 2026-05-10

### Added — 5 new tools (417 → 422)

#### Phase 4 batch 18 — Corrective/burn-in/broadcast/noise (5 tools, `src/tools/effects.ts`)

- **`apply_rolling_shutter_repair`** — corrects rolling-shutter skew/wobble (Warp or Pixel Motion methods).
- **`apply_clip_name_burn_in`** — overlays source clip name as text (QC/dailies/review use).
- **`apply_timecode_burn_in`** — overlays running timecode as text. Configure format/source/time-display/offset.
- **`apply_video_limiter`** — broadcast-safe luminance/chroma limiter.
- **`apply_noise_hls`** — color-aware HLS-channel noise (separate Hue/Lightness/Saturation amounts + grain size).

### Skipped from batch 18

- **Metadata & Timecode Burn-in** — has 6 metadata-line groups with duplicate Position/Size/Format/Time Display/etc. property names, making single-line wrapper ergonomics poor. Skipped in favor of Noise HLS.

### Changed

- Tool count: 417 → 422
- Updated `package.json` description

### Verified / Discovery

- 19 properties round-trip verified (Rolling Shutter Repair, Clip Name, Timecode, Noise HLS).
- **Video Limiter quirk in 25.4**: `Clip Level` / `Compression before clipping` `setValue()` silently no-ops (always returns 0) — appears to require an internal panel toggle that's not addressable via API. Wrapper still applies the effect; users must fine-tune values via UI. Documented in tool description.

## [1.1.14] - 2026-05-10

### Added — 5 new tools (412 → 417)

#### Phase 4 batch 17 — Geometry/blur/key (5 tools, `src/tools/effects.ts`)

- **`apply_corner_pin`** — 4-corner perspective transform (screen replacement, billboards, fitting content into a TV/phone in shot). All 4 corners 0-1 normalized.
- **`apply_transform`** — alternate transform with skew + opacity + motion-blur sampling (stack with intrinsic Motion).
- **`apply_offset`** — pixel-shift wrap (tiling/seamless loops/sky pan).
- **`apply_fast_blur`** — quick approximate blur (faster than Gaussian).
- **`apply_extract`** — luminance-based key with histogram-style controls (black/white input + softness + invert).

### Changed

- Tool count: 412 → 417
- Updated `package.json` description

### Verified

- 15 properties round-trip verified.

## [1.1.13] - 2026-05-10

### Added — 5 new tools (407 → 412)

#### Phase 4 batch 16 — Distort/math/AI/shadow/fill (5 tools, `src/tools/effects.ts`)

- **`apply_turbulent_displace`** — fractal-noise displacement (water/heat-haze/twist looks). 9 modes (Turbulent/Bulge/Twist + variants).
- **`apply_arithmetic`** — simple per-channel arithmetic with constant RGB color (And/Or/Xor/Add/Sub/Mul/Diff/Max/Min). Lighter than Compound Arithmetic.
- **`apply_auto_reframe`** — Adobe Sensei AI-driven reframing for aspect-ratio change. Wrapper exposes Motion Tracking enum, Reframe Offset/Scale/Rotation, and Overwrite generated path.
- **`apply_radial_shadow`** — drop shadow with point light source (radial casting). Opacity 0-1 normalized.
- **`apply_paint_bucket`** — flood-fill contiguous color region (animated color replacement on solid-color UI/cartoon).

### Changed

- Tool count: 407 → 412
- Updated `package.json` description

### Verified

- 17 properties round-trip verified (Auto Reframe verified separately for Motion Tracking, Reframe Scale/Rotation, Overwrite generated path).

### Discovery

- **Auto Reframe `Adjust Position`**: `getValue()` returns object (not boolean) and `setValue(true/false)` throws "Illegal Parameter type". Likely backed by a non-bool internal type. Removed from wrapper params; Premiere manages this internally based on Overwrite generated path.
- **Radial Shadow `Opacity`**: 0.0-1.0 normalized (NOT 0-100). Documented.

## [1.1.12] - 2026-05-10

### Added — 5 new tools (402 → 407)

#### Phase 4 batch 15 — Mixed effects (5 tools, `src/tools/effects.ts`)

- **`apply_lightning`** — animated lightning generator. 25 properties — wrapper exposes the most useful subset (start/end points, branching, color, width, speed, random_seed, rerun_at_each_frame).
- **`apply_vector_motion`** — secondary motion stack (position/scale/rotation/anchor) on top of intrinsic Motion.
- **`apply_eyedropper_fill`** — fill clip with sampled color from a point (animate sample_point to drive color from moving feature).
- **`apply_calculations`** — channel math operators between input and second source. Note: `Second Layer` reference NOT settable from API.
- **`apply_alpha_adjust`** — alpha channel control: opacity multiplier, ignore alpha, invert alpha, mask-only output.

### Skipped from batch 15

- **Shape** — has binary blob `Path` and `Appearance` properties (encoded shape definition); only transform props would be settable, making the wrapper of limited utility. Skipped in favor of Alpha Adjust.

### Changed

- Tool count: 402 → 407
- Updated `package.json` description

### Verified

- 23 properties round-trip verified.
- Discovery: Calculations `Second Layer Opacity` is 0.0-1.0 normalized (NOT 0-100 like UI suggests — set 50 clamps to 1.0). Wrapper description updated.

## [1.1.11] - 2026-05-10

### Added — 5 new tools (397 → 402)

#### Phase 4 batch 14 — Legacy keyers + shape generators (5 tools, `src/tools/effects.ts`)

- **`apply_color_key`** — legacy chroma key (single solid color removal). Modern alternative: `apply_ultra_key`.
- **`apply_luma_key`** — legacy luminance-based key (threshold + cutoff).
- **`apply_non_red_key`** — legacy blue/green-screen keyer (threshold/cutoff/defringing/smoothing).
- **`apply_circle`** — circle shape generator with feather, invert, blend mode. Dup `Feather Inner Edge` handled with seen-flag.
- **`apply_ellipse`** — outlined ellipse with inside/outside colors, thickness, softness.

### Changed

- Tool count: 397 → 402 (**402 tools** — passing 400-tool milestone)
- Updated `package.json` description

### Verified

- 23 properties round-trip verified across 5 effects.
- Legacy keyers (Color/Luma/Non Red Key) kept for project compatibility — modern workflows should use `apply_ultra_key` instead.
- Circle effect property layout: outer feather + inner feather are at indices 5-6; the duplicate "Feather Inner Edge" at index 7 is a panel toggle.

## [1.1.10] - 2026-05-10

### Added — 5 new tools (392 → 397)

#### Phase 4 batch 13 — Wipes / channel ops / motion blur (5 tools, `src/tools/effects.ts`)

- **`apply_venetian_blinds`** — louvre-style wipe-on-clip. Params: transition_completion 0-100, direction deg, width, feather.
- **`apply_block_dissolve`** — randomized block dissolve. Params: transition_completion, block_width/height, feather, soft_edges.
- **`apply_convolution_kernel`** — custom 3x3 matrix filter (sharpen/edge/emboss/blur kernels). 9 matrix coefficients M11-M33 + offset + scale + process_alpha.
- **`apply_compound_arithmetic`** — channel math operators (Add/Subtract/Multiply/Divide/Max/Min). Note: `Second Source Layer` reference NOT settable from API.
- **`apply_pixel_motion_blur`** — analyzed inter-frame motion blur. Params: shutter_control (Auto/Manual), shutter_angle deg, shutter_samples, vector_detail.

### Changed

- Tool count: 392 → 397
- Updated `package.json` description

### Verified

- 19 properties round-trip verified.
- Convolution Kernel default kernel is a 3x3 box blur (sum=6, scale=6 → identity-ish). Sharpen kernel example: M11=-1, M22=9, M33=-1, scale=1 → strong sharpen.
- Pixel Motion Blur uses analyzed pixel motion vectors; doesn't need keyframes — works on any moving footage.

## [1.1.9] - 2026-05-10

### Added — 5 new tools (387 → 392)

#### Phase 4 batch 12 — Generator wrappers (5 tools, `src/tools/effects.ts`)

- **`apply_ramp`** — linear/radial gradient generator. Params: start_x/y + start_color, end_x/y + end_color, ramp_shape (0=Linear, 1=Radial), ramp_scatter, blend_with_original.
- **`apply_grid`** — grid overlay. Params: anchor_x/y, size_from (0=Corner Point, 1=Width Slider, 2=Width&Height), width, height, border, invert_grid, color, opacity, blending_mode.
- **`apply_checkerboard`** — checker pattern. Params: anchor, size_from, width, height, color, opacity, blending_mode.
- **`apply_4color_gradient`** — 4-color anchored gradient. Params: point1-4 + color1-4, blend, jitter, opacity, blending_mode.
- **`apply_cell_pattern`** — procedural voronoi/cell noise. Params: cell_pattern (0=Bubbles), invert, contextual_slider, disperse, size, offset, enable_tiling, cells_horizontal/vertical, evolution, random_seed.

### Changed

- Tool count: 387 → 392
- Updated `package.json` description

### Verified

- 27 properties round-trip verified including duplicate-name handling.
- New pattern: declared `var widthSeen/heightSeen/color4Seen/cellsVerticalSeen = false` before property loop and guarded duplicate-named props with `&& !flag` to set only first occurrence (the slider, not the feather/toggle dup).
- Grid/Checkerboard `Width`/`Height` props at index 7-8 are feather widths (default 0); first match (index 3-4) is the actual cell size — flag pattern correctly targets the first.
- 4-Color Gradient `Color 4` at index 9 is a panel-toggle bool; first match at index 8 is the actual color.

## [1.1.8] - 2026-05-10

### Added — 5 new tools (382 → 387)

#### Phase 4 batch 11 — Color/grading workflow wrappers (5 tools, `src/tools/effects.ts`)

- **`apply_asc_cdl`** — industry-standard ASC Color Decision List. 10 params: red/green/blue × slope/offset/power + saturation. All default to identity (1/0/1, sat=1). Round-trips across DaVinci/Avid/Nuke.
- **`apply_color_space_transform`** — explicit color space conversion. Numeric SCS/TCS enums + Tone Map Method/Gain/Desaturation/Knee/GC Methods. Note: SCS/TCS Arb Data are binary blobs — only numeric properties exposed.
- **`apply_cineon_converter`** — Cineon log↔linear conversion. Params: conversion_type (0=Log→Lin, 1=Lin→Log default, 2=Log→Log), 10-bit/internal black/white points, gamma (default 1.7), highlight_rolloff.
- **`apply_solid_composite`** — solid-color overlay with blend mode. Params: source_opacity, color [R,G,B,A], opacity, blending_mode int.
- **`apply_texturize`** — light-direction + contrast on a texture from another layer. Note: `Texture Layer` reference NOT settable from API in 25.4 (same as Compound Blur).

### Changed

- Tool count: 382 → 387
- Updated `package.json` description

### Verified

- 17 numeric properties + 1 setColorValue round-trip verified.
- Texture Contrast clamps to max 2.0 (set 2.5 → stored 2.0). Documented.
- ASC CDL is the industry-standard portable grading metadata; preferable over Lumetri for cross-tool grading exchange.

## [1.1.7] - 2026-05-10

### Added — 5 new tools (377 → 382)

#### Phase 4 batch 10 — Stylize/Wipe wrappers (5 tools, `src/tools/effects.ts`)

- **`apply_brush_strokes`** — painterly look. Params: stroke_angle, brush_size, stroke_length, stroke_density, stroke_randomness, paint_surface (0=Original/1=Transparent/2=White/3=Black), blend_with_original.
- **`apply_emboss`** — grayscale embossed relief. Params: direction, relief, contrast, blend_with_original.
- **`apply_color_emboss`** — colored embossed relief (preserves original colors). Same param shape as Emboss.
- **`apply_linear_wipe`** — directional wipe-on-clip. Params: transition_completion 0-100, wipe_angle deg, feather. Animate transition_completion for the actual wipe.
- **`apply_radial_wipe`** — clock-style wipe-on-clip. Params: transition_completion, start_angle, center_x/y (0-1), wipe (0=CW, 1=CCW, 2=Both), feather.

### Changed

- Tool count: 377 → 382
- Updated `package.json` description

### Verified

- 19 properties round-trip verified.
- Linear Wipe / Radial Wipe are EFFECTS (act on a single clip), distinct from track-level Transitions. Animate `transition_completion` over time for actual wipe motion.

## [1.1.6] - 2026-05-10

### Added — 5 new tools (372 → 377)

#### Phase 4 batch 9 — Distortion/Time/Vignette wrappers (5 tools, `src/tools/effects.ts`)

- **`apply_lens_distortion`** — barrel/pincushion + decentering + chromatic prism (different from existing `apply_lens_distortion_correction`). Params: curvature -100..100, vertical/horizontal_decentering, vertical/horizontal_prism_fx, fill_alpha bool, fill_color [R,G,B,A].
- **`apply_posterize_time`** — frame-rate hold (stop-motion / anime stutter). Param: frame_rate fps.
- **`apply_edge_feather`** — soft fade frame edges to transparent. Param: amount (pixels).
- **`apply_magnify`** — circular/rectangular magnifying-glass overlay zoom. Params: shape, center_x/y (0-1 normalized), magnification %, link mode, size, feather, opacity, scaling, resize_layer.
- **`apply_compound_blur`** — variable blur via luminance map (own layer). Params: maximum_blur, stretch_map_to_fit, invert_blur. Note: `Blur Layer` external-layer reference NOT settable from API in 25.4.

### Changed

- Tool count: 372 → 377
- Updated `package.json` description

### Verified

- All 16 properties + 1 setColorValue round-trip verified.
- Magnify Center is a 2D vector `[x, y]` 0-1 normalized — wrapper takes individual `center_x`/`center_y` and packs them.

## [1.1.5] - 2026-05-10

### Added — 5 new tools (367 → 372)

#### Phase 4 batch 8 — Color/Channel/Light wrappers (5 tools, `src/tools/effects.ts`)

- **`apply_color_replace`** — swap a target color with a replacement. Params: target_color/replace_color [R,G,B,A] 0-255, similarity 0-100, solid_colors bool.
- **`apply_color_pass`** — preserve only one color, desaturate the rest (selective color look). Params: color [R,G,B,A], similarity, reverse.
- **`apply_gamma_correction`** — midtone-only adjustment. Param: gamma (raw slider value 1-28, default 10 = no change).
- **`apply_channel_blur`** — independent R/G/B/A blur radii. Params: red/green/blue/alpha_blurriness, repeat_edge_pixels, blur_dimensions (0=Both, 1=Horizontal, 2=Vertical).
- **`apply_strobe_light`** — rhythmic flashes with configurable color, duration, period, randomness, and combine operator. Params: strobe_color, blend_with_original, strobe_duration, strobe_period, random_strobe_probability, strobe (transparency mode), strobe_operator.

### Changed

- Tool count: 367 → 372
- Updated `package.json` description to reflect new total

### Verified

- All 5 effects probed in 25.4.1; property names canonicalized; setValue() round-trip verified for: 18 properties + 4 setColorValue calls.
- Discoveries: Strobe Light has Adobe typo `Random Strobe Probablity` (sic) — wrapper uses exact spelling. Gamma Correction default stored value is 10 (= linear/no change), range 1-28.

## [1.1.4] - 2026-05-10

### Added — 5 new tools (362 → 367)

#### Phase 4 batch 7 — Stylize/Distort/Quality wrappers (5 tools, `src/tools/effects.ts`)

- **`apply_replicate`** — divide screen into NxN grid, each cell shows a scaled copy of the clip (warhol effect). Param: count (integer 2-10).
- **`apply_roughen_edges`** — fractal-noise distortion of alpha edges with 9 styles (Roughen/Cut/Spiky/Stained Glass/Photocopy/Rusty + color variants). Params: edge_type, border, edge_sharpness, fractal_influence, scale, complexity, evolution.
- **`apply_bevel_edges`** — 3D bevel along rectangular frame (use `apply_bevel_alpha` for alpha-shaped bevel). Params: edge_thickness (0-1 normalized), light_angle, light_intensity (0-1 normalized).
- **`apply_reduce_interlace_flicker`** — vertical softening to suppress interlace flicker on 1080i/SD output. Param: softness.
- **`apply_median_legacy`** — median-filter neighborhoods, removes salt-and-pepper noise; painterly look at higher radii. Params: radius (pixels), operate_on_alpha.

### Changed

- Tool count: 362 → 367
- Updated `package.json` description to reflect new total

### Verified

- All 5 effects probed in 25.4.1; property names canonicalized; setValue() round-trip verified for: Count, Edge Type/Border/Edge Sharpness/Complexity, Edge Thickness/Light Angle/Light Intensity, Softness, Radius/Operate On Alpha Channel.
- Property scale notes captured in tool descriptions (Bevel Edges thickness/intensity are 0-1 normalized, not 0-100).

## [1.1.3] - 2026-05-10

### Added — 22 new tools (340 → 362)

#### Phase 3.8 — Render & Replace (3 tools, `src/tools/advanced.ts`)

- **`render_clip_in_place`** — render a single timeline clip's range to a media file via Adobe Media Encoder. Sets sequence in/out to clip range, calls `encodeSequence(ENCODE_IN_TO_OUT)`, then restores in/out. Fire-and-forget AME render.
- **`render_sequence_range`** — general-purpose render of any sequence range (entire/in_to_out/work_area) with optional explicit in/out seconds.
- **`replace_clip_with_file`** — import a media file and replace a clip's source media in-place. Diffs bin children to identify the newly imported item; preserves clip position and duration.

#### Phase 3.5 — VR/360 (3 tools, `src/tools/sequence.ts`)

- **`get_sequence_vr_settings`** — read VR layout/projection/captured-view settings of active sequence.
- **`set_sequence_vr_settings`** — configure VR mode (vrLayout, vrProjection, vrHorzCapturedView, vrVertCapturedView). Partial updates supported — only provided fields are changed.
- **`list_vr_effects_and_transitions`** — discovery tool: probe which VR effects (8 found: Plane to Sphere, Rotate Sphere, Sharpen, Glow, Color Gradients, Projection, Digital Glitch, Chromatic Aberrations) and VR transitions (4 found: Chroma Leaks, Light Rays, Mobius Zoom, Random Blocks) are available.

#### Phase 4 — Effect wrappers (16 tools, `src/tools/effects.ts`)

Batch 5 (color/stylize):
- **`apply_tint`** — color tint with adjustable amount
- **`apply_alpha_glow`** — alpha-based glow for titles/logos
- **`apply_posterize`** — color quantization
- **`apply_threshold`** — high-contrast B&W cutoff
- **`apply_find_edges`** — edge detection / sketch look
- **`apply_mirror`** — image reflection around configurable axis
- **`apply_sharpen`** — simple sharpening (alternative to Unsharp Mask)
- **`apply_proc_amp`** — broadcast Brightness/Contrast/Hue/Saturation in one wrapper

Batch 6 (distortion/film-look):
- **`apply_echo`** — frame ghosting/trails
- **`apply_solarize`** — luminance reversal at threshold
- **`apply_spherize`** — bulge/pinch lens distortion
- **`apply_twirl`** — swirl distortion
- **`apply_wave_warp`** — sinusoidal/triangle/square wave distortion
- **`apply_bevel_alpha`** — 3D bevel on alpha edges
- **`apply_noise`** — film grain / noise generator
- **`apply_dust_and_scratches`** — scratch artifact reduction

### Fixed

- **`clear_sequence_in_out`** (track-targeting.ts) — Premiere 25.4 regression: `seq.zeroPoint.ticks` returns Number (not string), so `setInPoint(seq.zeroPoint.ticks)` threw "Illegal Parameter type". Replaced with `setInPoint("0")`.

### Changed

- Tool count: 340 → 362
- Updated `package.json` description to reflect new total

### Discovery / Documentation

- **app.encoder API on Premiere 25.4**: encodeSequence/encodeProjectItem/encodeFile/startBatch/launchEncoder all functions; `isRunning`/`stopBatch`/`quitEncoder` undefined; `bind()` accepts ANY event name without validation. Range constants: ENCODE_ENTIRE=0, ENCODE_IN_TO_OUT=1, ENCODE_WORKAREA=2.
- **Sequence in/out manipulation regression in 25.4**: `getInPoint()/getOutPoint()` return string-of-seconds (not Time obj); `clearInPoint`/`clearOutPoint` undefined; `seq.zeroPoint.ticks` returns Number (Illegal Parameter type).
- **Threshold properties inconsistent across effects**: 0-1 normalized in Find Edges/Dust & Scratches, 0-255 in Solarize. Always probe `getValue()` after `setValue()`.
- **Phase 3.6 Surround pan marked NOT FEASIBLE**: audio track API in 25.4 only exposes `setMute/isMuted` — no `setPan`/`setPanDirection`/`getPanComponent`. Per-clip pan still available via existing `set_clip_pan`.
- **Phase 3.9 Master Clip Effects marked NOT FEASIBLE**: projectItem in 25.4 doesn't expose components/addEffect/getMasterClip.

## [1.1.2] - 2026-05-10

### Added — 8 net new tools (307 → 315)

#### Phase 1 — VFX Color & Keying (6 tools, `src/tools/effects.ts`)

- **`configure_warp_stabilizer`** — set Warp Stabilizer Result/Smoothness/Method/Framing/Crop balance/Maximum Scale/Additional Scale/Rolling Shutter Ripple. Returns AnalysisStatusCounter for monitoring background analysis progress.
- **`apply_ultra_key`** — Ultra Key chroma keyer with key color via `setColorValue(R,G,B,A)` (accepts 0-255 ints or 0-1 floats), Setting (Default/Relaxed/Aggressive), Output (Composite/Alpha/Color).
- **`set_ultra_key_settings`** — fine-tune all 16 Ultra Key numeric properties (Transparency/Highlight/Shadow/Tolerance/Pedestal/Choke/Soften/Contrast/Mid Point/Desaturate/Range/Spill/Luma/Saturation/Hue/Luminance).
- **`apply_crop_mask`** — Crop effect as a workaround for rectangular mask (L/T/R/B/Zoom/Edge Feather). Mask APIs do not exist in 25.4.
- **`set_lumetri_creative`** — Lumetri Creative tab: Faded Film/Sharpen/Vibrance/Saturation/Tint Balance using index-based addressing (Lumetri has duplicate property names).
- **`set_lumetri_vignette`** — Lumetri Vignette: Amount (Premiere clamps to ~-5..5)/Midpoint/Roundness/Feather.

#### Phase 2 — Time Remapping & Color (2 tools)

- **`set_clip_time_interpolation`** (`src/tools/timeline.ts`) — Frame Sample / Frame Blend / Optical Flow.
- **`set_lumetri_hsl_secondary`** (`src/tools/effects.ts`) — Denoise/Blur/Temperature/Tint/Contrast/Sharpen/Saturation in HSL Secondary section.

### Fixed — Premiere 25.4 ExtendScript regressions

- **Component remove**: `clip.components[i].remove()` was undefined; replaced with `qeClip.getComponentAt(idx).remove()`. Affects `effects.ts`, `clipboard.ts`.
- **Effect lookup**: `qe.project.getVideoEffectList()` changed return type. Now use `getVideoEffectByName(name)` and validate `name !== ""` (placeholder objects return empty name). Affects 8 sites in effects.ts, 4 in transitions.ts, 1 in audio.ts.
- **Add transition**: `qeTrack.addTransition(...)` is undefined. Now `qeClip.addTransition(transition, alignmentInt)` where 0=clip start, 1=clip end. Affects 4 sites in transitions.ts, 1 in audio.ts.
- **Set speed**: DOM `clip.setSpeed(n)` undefined. Now `qeClip.setSpeed(percent, "1", maintainPitch, reversed, rippleEdit)`. Affects 2 sites in timeline.ts.
- **DOM↔QE clipIndex mismatch (latent)**: `qeTrack.getItemAt(domClipIndex)` returns Empty placeholder for clips after gaps. Fixed by adding `__getQEClip(result)` helper that walks QE skipping Empty placeholders. Affects 21 sites across advanced/effects/clipboard/timeline.

### Changed

- Tool count: 307 → 315
- Added auto-prepended `__getQEClip(result)` and `__getQEClipAndTrack(result)` helpers to `src/bridge/script-builder.ts` for reliable QE clip access.

## [1.1.1] - 2025

### Fixed

- Bug fixes across multiple tools
- Removed duplicate tools
- Security patch

## [1.1.0] - 2025

### Added

- HTTP/SSE transport mode (`start:http` script)
- Fly.io deployment configuration
- Updated README

## [1.0.0] - 2025-02-26

### Added

- **269 tools** across **28 modules** covering nearly the entire Premiere Pro ExtendScript and QE DOM API surface
- File-based IPC bridge for reliable communication between Node.js MCP server and CEP plugin
- CEP plugin with panel UI for bridge status monitoring and configuration
- Cross-platform support (macOS and Windows)
- Two MCP resources for LLM context: `premiere-instructions` and `extendscript-reference`
- Security validation for generated scripts (blocks eval, new Function, System.callSystem)
- Automated CEP plugin installer script

#### Tool Modules

- **discovery** (10) — Project info, item listing, clip queries
- **project** (26) — Save/open, import, bins, AE comps, bars & tone, scratch disks
- **media** (16) — Proxy management, offline, frame rate override, XMP, color space
- **sequence** (11) — Create, duplicate, delete, settings, auto-reframe, unnest, captions
- **timeline** (10) — Add/remove/move/trim/split clips, properties, replace
- **effects** (8) — Apply/remove effects, color correction, LUTs, stabilization
- **transitions** (5) — Add transitions by name (QE DOM)
- **audio** (3) — Levels, keyframes, mute
- **text** (3) — Text overlays, MOGRTs
- **markers** (4) — Add/delete/update/list markers
- **tracks** (4) — Add/delete/lock/visibility
- **playhead** (6) — Position, work area, in/out points
- **metadata** (9) — XMP, project metadata, color labels, footage interpretation
- **export** (14) — Sequence export, frame capture (base64), FCP XML, AAF, OMF, encoding
- **advanced** (27) — QE DOM: ripple delete, roll/slide/slip edits, speed, reverse, frame blend
- **keyframes** (8) — Full CRUD: add, get, remove, range remove, interpolation, value at time
- **scripting** (6) — Execute arbitrary ExtendScript, expression eval, DOM inspection
- **inspection** (10) — Deep project/sequence/clip analysis, timeline gaps, media reports
- **selection** (7) — Select by name, range, color; invert; select disabled
- **clipboard** (6) — Copy effects, batch apply, replace media, blend modes
- **source-monitor** (7) — Open/close, in/out points, insert/overwrite from source
- **track-targeting** (31) — Target tracks, motion/transform properties, audio properties
- **utility** (29) — Batch rename, enable/disable, project analysis, navigation
- **health** (1) — Connectivity ping
- **workspace** (2) — Get/set workspace layouts
- **captions** (1) — Create caption tracks
- **playback** (4) — Timeline and source monitor playback control
- **project-manager** (1) — Project consolidation and transfer
