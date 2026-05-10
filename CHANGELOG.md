# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
