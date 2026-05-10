# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
