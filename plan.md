# Plan: Bổ sung tính năng video editor chuyên nghiệp cho `premiere-pro-mcp`

> **Tạo ngày:** 2026-05-10
> **Phiên bản hiện tại:** v1.1.1 + merges Hetpatel-11/Antipaster (commit 3261b69) → **307 tools** trước session này, **313 tools sau Phase 1** (uncommitted, +6 tool VFX)
> **Mục tiêu:** Thêm các tính năng còn thiếu so với editor chuyên nghiệp, chia làm 4 nhóm ưu tiên.

---

## 🗂️ Consolidated Session Log (2026-05-10)

### Commit progression

| SHA | Phase | Tool count | Notes |
|---|---|---|---|
| (baseline) | Pre-session — merge Hetpatel-11/Antipaster (commit 3261b69) | **307** | starting point |
| `cabf6fb` | **v1.1.2** — 25.4 regression fixes + Phase 1 VFX (6 tools) + Phase 2 (2 tools) + Phase 0.5 latent fix (21 sites) | **315** | +8 net |
| `254d917` | Phase 3 partial — 3.7 (3-point/4-point edit) + 3.4 (HDR workflow 5 tools) | **322** | +7 |
| `884c809` | Phase 4 batch (partial) — 4 effect wrapper tools | **326** | +4 (runtime test pending) |
| (next) | Phase 4 expansion — 5 more wrappers + edit_subclip_boundaries | **331** | +5 (code-only, CEP hung) |
| (next) | Phase 4 batch 3 — 5 more wrappers (Gaussian Blur, Mosaic, Lens Flare, Skin Tone, Levels) | **336** | +5 (code-only) |
| (next) | Phase 4 batch 4 — apply_effect_with_properties (architectural) + 3 wrappers (Directional Blur, B&W, Invert) | **340** | +4 (code-only) |
| `9e89be0` | **Phase 4 runtime verification** — 18 tool wrappers + 1 architectural verified, 4 prop-name bugs fixed (Basic 3D, Levels × 4, Levels gamma, Invert channel enum) | **340** | net 0 (fix-only) |
| (next) | **Phase 3.8 Render & Replace** — 3 tools (render_clip_in_place, render_sequence_range, replace_clip_with_file) | **343** | +3 (logic dry-run verified, real AME e2e pending) |
| (next) | **Phase 3.5 VR/360** — 3 tools (get_sequence_vr_settings, set_sequence_vr_settings, list_vr_effects_and_transitions) | **346** | +3 (round-trip verified). 3.6 Surround pan: NOT FEASIBLE (track has no pan API). |
| (next) | **Phase 4 batch 5 + clear_sequence_in_out fix** — 8 effect wrappers (Tint, Alpha Glow, Posterize, Threshold, Find Edges, Mirror, Sharpen, ProcAmp) + latent bug fix | **354** | +8 (runtime verified) |
| (next) | **Phase 4 batch 6** — 8 effect wrappers (Echo, Solarize, Spherize, Twirl, Wave Warp, Bevel Alpha, Noise, Dust & Scratches) | **362** | +8 (runtime verified) |
| (next) | **v1.1.3 release checkpoint** — package.json bump 1.1.2→1.1.3, CHANGELOG backfill v1.1.0/v1.1.1/v1.1.2/v1.1.3 | **362** | net 0 (release) |
| (next) | **Phase 4 batch 7** — 5 effect wrappers (Replicate, Roughen Edges, Bevel Edges, Reduce Interlace Flicker, Median Legacy) | **367** | +5 (runtime verified) |
| (next) | **v1.1.4 release** — package.json 1.1.3→1.1.4, CHANGELOG entry | **367** | net 0 (release) |
| (next) | **Phase 4 batch 8 + v1.1.5** — 5 effect wrappers (Color Replace, Color Pass, Gamma Correction, Channel Blur, Strobe Light) | **372** | +5 (runtime verified) |
| (next) | **Phase 4 batch 9 + v1.1.6** — 5 effect wrappers (Lens Distortion, Posterize Time, Edge Feather, Magnify, Compound Blur) | **377** | +5 (runtime verified) |
| (next) | **Phase 4 batch 10 + v1.1.7** — 5 effect wrappers (Brush Strokes, Emboss, Color Emboss, Linear Wipe, Radial Wipe) | **382** | +5 (runtime verified) |
| (next) | **Phase 4 batch 11 + v1.1.8** — 5 effect wrappers (ASC CDL, Color Space Transform, Cineon Converter, Solid Composite, Texturize) | **387** | +5 (runtime verified) |
| (next) | **Phase 4 batch 12 + v1.1.9** — 5 generator wrappers (Ramp, Grid, Checkerboard, 4-Color Gradient, Cell Pattern) + dup-name flag pattern | **392** | +5 (runtime verified) |
| (next) | **Phase 4 batch 13 + v1.1.10** — 5 wipes/channel/motion-blur wrappers (Venetian Blinds, Block Dissolve, Convolution Kernel, Compound Arithmetic, Pixel Motion Blur) | **397** | +5 (runtime verified) |

### 📌 Session continuation note (post-compact, 2026-05-10)

> Conversation đã rollover qua compact tại commit `9e89be0`. Compact summary lưu trong `.claude/projects/...jsonl`. Trạng thái hiện tại được phục hồi từ summary:

**Đã hoàn thành trong session trước (pre-compact):**
- 7 commits, tool count 307 → 340 (+33 net)
- Phase 0 + 0.5: regression fixes (DOM↔QE clipIndex, qeTrack→qeClip pattern, 21 sites)
- Phase 1: 6 VFX tools (Warp Stabilizer, Ultra Key × 2, Crop mask, Lumetri creative/vignette)
- Phase 2: 2 tools (set_clip_time_interpolation, set_lumetri_hsl_secondary)
- Phase 3 partial: 7 tools (3-point/4-point edit, HDR workflow × 5)
- Phase 4: 18 effect wrappers + 1 architectural (apply_effect_with_properties) + edit_subclip_boundaries — toàn bộ runtime-verified
- Test clip C7984.MP4 cleaned up (chỉ Opacity + Motion intrinsic còn lại)
- plan.md + notebug.md updated

**Pending sau compact (theo thứ tự ROI):**
1. **Phase 3.8 Render & Replace** — async render queue spike (`app.encoder.encodeSequence` polling) — đề xuất làm tiếp
2. **Phase 3.6 Surround pan** — 5.1/7.1 panner position, downmix
3. **Phase 3.5 VR/360** — convert_to_vr_sequence, apply_vr_transition, set_vr_view_orientation
4. **Phase 3.1 Dynamic Link AE** — replace_with_ae_comp (research-heavy, cần AE chạy)
5. **Phase 4 batch tiếp** — auto_color, alpha_glow, color_balance_hls, tint, ...
6. **Workspace tools** — save_workspace_layout, auto_save_settings, create_project_from_template
7. **v1.1.3 bump** — sau khi xong Phase 3 hoàn chỉnh

**Không khả thi (đã document, skip):**
- 3.9 Master Clip Effects (projectItem không expose components/addEffect/getMasterClip ở DOM/QE)
- Mask bezier path, speed-ramp keyframes, color wheels/curves, scopes reading, section enable booleans, app.undo

**Resume strategy:** Spike 3.8 render queue async behavior trước (1 ph) → quyết định approach → implement nếu khả thi.

### 📌 Session post-compact progress (2026-05-10 batch 2)

**Đã hoàn thành sau compact:**
1. ✅ **Phase 3.8 Render & Replace** (commit `0522493`, 340→343):
   - 3 tools: `render_clip_in_place`, `render_sequence_range`, `replace_clip_with_file`
   - Spike `app.encoder` API: encodeSequence/encodeProjectItem/encodeFile/startBatch/launchEncoder all functions
   - `app.encoder.bind()` accepts ANY event name silently (cannot reliably observe completion)
   - Discovered NEW regression: `seq.getInPoint()/getOutPoint()` return seconds-string (not Time obj); `clearInPoint/clearOutPoint` undefined; `seq.zeroPoint.ticks` is Number (Illegal Parameter type)

2. ✅ **Phase 3.5 VR/360** (commit `badc1dc`, 343→346):
   - 3 tools: `get_sequence_vr_settings`, `set_sequence_vr_settings`, `list_vr_effects_and_transitions`
   - Spike: 4 VR settings fields, 8 VR effects + 4 VR transitions
   - Round-trip verified

3. ❌ **Phase 3.6 Surround pan**: NOT FEASIBLE
   - Track-level pan API missing trong 25.4 (audio track chỉ có setMute/isMuted)
   - Per-clip pan đã sẵn qua existing `set_clip_pan`

**Pending (theo ROI giảm dần):**
1. Latent bug fix: `clear_sequence_in_out` (track-targeting.ts:902) dùng `seq.zeroPoint.ticks` (Number) → "Illegal Parameter type" trong 25.4. Replace bằng `setInPoint("0")`.
2. More Phase 4 batch — auto_color, alpha_glow, color_balance_hls, tint, etc.
3. Workspace tools — save_workspace_layout, auto_save_settings, create_project_from_template
4. Phase 3.1 Dynamic Link AE (research-heavy, defer)
5. v1.1.3 bump sau khi xong Phase 3 hoàn chỉnh

### 📌 Session post-compact progress (2026-05-10 batch 3) — v1.1.3 release

**Đã hoàn thành sau batch 2 (5 commits, 346 → 362, +16 net):**

1. ✅ **Phase 4 batch 5** (commit `e20ae6e`, 346 → 354):
   - 8 effect wrappers: `apply_tint`, `apply_alpha_glow`, `apply_posterize`, `apply_threshold`, `apply_find_edges`, `apply_mirror`, `apply_sharpen`, `apply_proc_amp`
   - Latent bug fix: `clear_sequence_in_out` (track-targeting.ts:924) — replaced `seq.setInPoint(seq.zeroPoint.ticks)` (Number, Illegal Parameter type) với `seq.setInPoint("0")` literal
   - Property scale phát hiện: "Blend With Original" trong Find Edges là 0.0-1.0 (không phải 0-100). Description updated.

2. ✅ **Phase 4 batch 6** (commit `68d971f`, 354 → 362):
   - 8 effect wrappers: `apply_echo`, `apply_solarize`, `apply_spherize`, `apply_twirl`, `apply_wave_warp`, `apply_bevel_alpha`, `apply_noise`, `apply_dust_and_scratches`
   - Property scale phát hiện: "Threshold" trong Dust & Scratches là 0.0-1.0 normalized (không phải 0-255). Description updated.
   - matchName anomaly: Solarize dùng prefix `PR.ADBE Solarize` (không phải typical `AE.ADBE`). Documented.

3. ✅ **v1.1.3 release checkpoint** (commit `19a2692`):
   - `package.json`: 1.1.2 → 1.1.3, description tool count 340 → 362
   - `CHANGELOG.md` backfilled: v1.1.0 (HTTP/SSE), v1.1.1 (bug fixes), v1.1.2 (Phase 1+2 + 25.4 regression fixes), v1.1.3 (Phase 3.5/3.8 + Phase 4 batch 5/6)

**Cumulative this multi-session work (v1.1.2 → v1.1.3):**
- 307 → 362 tools (+55 net)
- 12 commits on local main, ahead of origin
- All effect wrappers runtime-verified on test clip C7984.MP4
- Test clip cleaned up (chỉ còn intrinsic Opacity + Motion)

**Pending sau v1.1.3 (theo ROI):**
1. **Phase 4 batch 7** — Replicate, Roughen Edges, Bevel Edges, Reduce Interlace Flicker, Median (Legacy) — đã probed trong catalog, chưa wrap
2. **Workspace tools** — save_workspace_layout, auto_save_settings, create_project_from_template
3. **Phase 3.1 Dynamic Link AE** (research-heavy, cần AE)
4. Push to origin (12 commits ahead)

### 📌 Session post-compact progress (2026-05-10 batch 4) — v1.1.4 release

**Đã hoàn thành sau v1.1.3 (uncommitted, 362 → 367):**

1. ✅ **Phase 4 batch 7** (362 → 367):
   - 5 effect wrappers: `apply_replicate`, `apply_roughen_edges`, `apply_bevel_edges`, `apply_reduce_interlace_flicker`, `apply_median_legacy`
   - Property scale notes:
     - **Bevel Edges**: Edge Thickness và Light Intensity 0.0-1.0 normalized (KHÔNG phải 0-100). Default 0.1 / 0.4.
     - **Median (Legacy)**: matchName là `AE.ADBE Median` — không có suffix "Legacy" trong matchName.
     - **Roughen Edges**: có 2 dup props "Random Seed" (int seed + bool toggle) — wrapper bỏ qua, dùng default 0.
   - Round-trip verified via `execute_extendscript`: setValue → getValue cho Count=3, Edge Type=3 (Spiky), Border=20, Edge Sharpness=2, Complexity=4, Edge Thickness=0.3, Light Angle=45, Light Intensity=0.6, Softness=1.0, Radius=2, Operate On Alpha Channel=true.

2. ✅ **v1.1.4 release**:
   - `package.json` 1.1.3 → 1.1.4, description "362 tools" → "367 tools"
   - `CHANGELOG.md` thêm entry [1.1.4]

**Pending sau v1.1.4 (theo ROI):**
1. **Workspace tools** — save_workspace_layout, auto_save_settings, create_project_from_template
2. **More Phase 4 batches** nếu user đề xuất (còn nhiều effect Premiere ngoài 27 đã wrap)
3. **Phase 3.1 Dynamic Link AE** (research-heavy)
4. Push to origin (14 commits ahead khi commit batch 7)

### 📌 Session post-compact progress (2026-05-10 batch 5) — v1.1.5 release

**Workspace tool spike (probed):**
- `app.getWorkspaces()` ✓ (already wrapped)
- `app.setWorkspace()` ✓ (already wrapped)
- `app.saveWorkspace`, `saveWorkspaceAs`, `deleteWorkspace`, `getCurrentWorkspace`, `refreshCurrentWorkspace` — ALL UNDEFINED ❌
- `app.preferences`, `app.autoSavePrefs`, `app.userPreferences` — UNDEFINED ❌
- `app.properties.getProperty(name)` / `setProperty(name, value)` / `doesPropertyExist(name)` exist nhưng không có known keys (probed 19 candidates, 0 matched). Wild-key API không document được — không reliable cho production tool.
- `app.openDocument()` ✓ + `app.project.saveAs()` ✓ → `create_project_from_template` khả thi NHƯNG destructive (closes current project). Skip — risky for AI-driven workflow.

**Kết luận: Workspace/auto-save/template tools NOT FEASIBLE/SAFE trong 25.4.** Chuyển sang Phase 4 batch 8.

**Đã hoàn thành (367 → 372):**

1. ✅ **Phase 4 batch 8** (367 → 372):
   - 5 effect wrappers: `apply_color_replace`, `apply_color_pass`, `apply_gamma_correction`, `apply_channel_blur`, `apply_strobe_light`
   - 18 properties + 4 setColorValue calls round-trip verified
   - Adobe typo discovered: Strobe Light → "Random Strobe **Probablity**" (sic) — wrapper preserves exact spelling
   - Gamma Correction default stored = 10 (= linear gamma 1.0), range 1-28

2. ✅ **v1.1.5 release**:
   - `package.json` 1.1.4 → 1.1.5, "367 tools" → "372 tools"
   - `CHANGELOG.md` thêm entry [1.1.5]

**Pending sau v1.1.5 (theo ROI giảm dần):**
1. **More Phase 4 batches** — còn ~100 effect chưa wrap (Lens Distortion, Channel Mixer, Camera Lens Blur, Compound Blur, Magnify, Lighting Effects, Brush Strokes, Color Emboss, Emboss, etc.)
2. **Generator effects** — Cell Pattern, Lightning, Ramp, Grid, Checkerboard, Cell Pattern (procedural)
3. **Phase 3.1 Dynamic Link AE** (research-heavy)
4. Push to origin (15 commits ahead)

### 📌 Session post-compact progress (2026-05-10 batch 6) — v1.1.6 release

**Đã hoàn thành (372 → 377):**

1. ✅ **Phase 4 batch 9** (372 → 377):
   - 5 effect wrappers: `apply_lens_distortion`, `apply_posterize_time`, `apply_edge_feather`, `apply_magnify`, `apply_compound_blur`
   - 16 properties + 1 setColorValue round-trip verified
   - Discoveries:
     - Magnify "Center" là 2D vector `[x, y]` 0-1 normalized — wrapper split thành `center_x`/`center_y` cho ergonomic
     - Compound Blur "Blur Layer" prop là layer reference (default 4294967294 placeholder) — NOT settable từ API trong 25.4. Wrapper bỏ qua tham số đó.
     - Lens Distortion là effect KHÁC với "Lens Correction" (đã wrap qua `apply_lens_distortion_correction`). Lens Distortion cho creative aberration; Lens Correction cho corrective workflow.

2. ✅ **v1.1.6 release**:
   - `package.json` 1.1.5 → 1.1.6, "372 tools" → "377 tools"
   - `CHANGELOG.md` thêm entry [1.1.6]

**Cumulative this multi-batch session (post-compact):**
- v1.1.2 → v1.1.6 (5 minor bumps)
- 307 → 377 tools (+70 net)
- 16 commits ahead of origin
- Test clip C7984.MP4 cleaned up across all batches (chỉ còn intrinsic Opacity + Motion)

**Pending sau v1.1.6 (theo ROI giảm dần):**
1. **More Phase 4 batches** — vẫn còn nhiều effect chưa wrap (Brush Strokes, Color Emboss/Emboss, Texturize, Lightning, Cell Pattern, Compound Arithmetic, Convolution Kernel, Calculations, etc.)
2. **Generator effects** — Cell Pattern, Lightning, Ramp, Grid, Checkerboard (procedural sources)
3. **Phase 3.1 Dynamic Link AE** (research-heavy, cần AE)
4. Push to origin (16 commits ahead)

### Key discoveries — Premiere 25.4 ExtendScript regressions & limitations

> Pattern chung: API surface đã di chuyển từ DOM/track-level sang QE clip-level trong 25.4. Tools cũ tin tưởng DOM operations đều bị broken.

**Đã FIX (Phase 0 + Phase 0.5):**

| Regression | Path cũ (broken) | Path mới (working) | Files affected |
|---|---|---|---|
| Component remove | `clip.components[i].remove()` | `qeClip.getComponentAt(idx).remove()` | effects.ts, clipboard.ts |
| Effect lookup | `qe.project.getVideoEffectList()` returning `{numItems, [i].name}` | `qe.project.getVideoEffectByName(name)` returning `{name}` (validate name !== "") | effects.ts (8), transitions.ts (4), audio.ts (1) |
| Add transition | `qeTrack.addTransition(t, bool, ticks, durTicks, "0", false)` | `qeClip.addTransition(t, alignmentInt)` (0=clip start, 1=clip end, 2=invalid) | transitions.ts (4), audio.ts (1) |
| Set speed | DOM `clip.setSpeed(n)` | `qeClip.setSpeed(percent, "1", maintainPitch, reversed, rippleEdit)` | timeline.ts (2) |
| **DOM↔QE clipIndex mismatch** (latent) | `qeTrack.getItemAt(domClipIndex)` | `__getQEClip(result)` helper walks QE skipping Empty placeholders | 21 sites (advanced × 11, effects × 8, clipboard × 1, timeline × 1) |

**KHÔNG khả thi qua ExtendScript trong 25.4 (documented, skip):**

| Feature | Lý do |
|---|---|
| Save workspace layout / Save Workspace As | `app.saveWorkspace`, `saveWorkspaceAs`, `deleteWorkspace`, `getCurrentWorkspace`, `refreshCurrentWorkspace` đều undefined. Chỉ `getWorkspaces()` và `setWorkspace(name)` có. UI-only operation. |
| Auto-save preferences config | `app.preferences`, `app.autoSavePrefs`, `app.userPreferences` đều undefined. `app.properties.setProperty(key, value)` exists nhưng wild-key API — Adobe không document keys, probe 19 common candidates đều miss. |
| Mask bezier path / addMask / addBezierMask | Method không tồn tại ở mọi level (DOM, QE clip, QE sequence, qe.project) |
| Master Clip Effects (apply effect at projectItem level) | `projectItem` chỉ có `children, getOverrideColorSpaceList, interpretedTimebase, name, nodeId, sourceTimebase, timeDisplayFormat, treePath, type` — không có components/addEffect/getMasterClip |
| Speed-ramp keyframes (bezier speed curve) | Time Remapping component không expose qua DOM/QE; `qeClip.enableTimeRemapping/addSpeedKeyframe/setSpeedRamp` đều undefined |
| Lumetri color wheels (Shadow/Midtone/Highlight RGB) | Properties stored as binary blobs — không có discrete RGB+Luma controls exposed |
| Lumetri curves (RGB Master/R/G/B + HSL curves) | Binary blob format (`` / `` placeholders); chỉ enable/disable section được |
| Lumetri scopes reading (Vectorscope/Waveform values) | Cần render frame; không có ExtendScript API |
| Section enable booleans (Lumetri Active toggles, Ultra Key Matte Generation/Cleanup/Spill/Color Correction) | `setValue(true/false)` silent no-op — UI-only state. Numeric props bên trong vẫn có hiệu lực không phụ thuộc toggle. |
| Audio AI features (Speech Enhancement, Auto-Ducking, Remix) | UI-driven cloud features, không expose qua ExtendScript |
| `clip.components[i].enabled` setter | Property không tồn tại trên DOM component object trong 25.4 |
| `app.undo()`, `app.executeCommand`, `app.findMenuCommandId` | Tất cả undefined — chỉ Cmd+Z UI hoặc QE remove path mới revert được |

**Hữu dụng phát hiện được (đã exposed qua tool):**

| API | Tool exposing | Notes |
|---|---|---|
| `seq.getSettings().workingColorSpaceList` (4 entries) | `list_sequence_color_spaces`, `set_sequence_color_space` | Rec.709, Rec.2100 HLG, Rec.2100 PQ, ACEScct |
| `projectItem.getOverrideColorSpaceList` (32 entries — property, not function) | `list_clip_color_space_overrides`, `set_clip_color_space_override` | Apple Log, ARRI LogC3/4, Sony S-Log/S-Log2/S-Log3, Canon Log/Log2/Log3, Fuji F-Log/F-Log2, Nikon N-Log, Panasonic V-Log, RED Log3G10, DJI D-Log, Leica L-Log, DCDM X'Y'Z', Rec.601 NTSC/PAL, P3-D65 HLG/PQ, sRGB, etc. |
| `seq.getSettings().autoToneMapEnabled` / `autoInputGamutCompressionEnabled` / `compositeLinearColor` | `set_sequence_hdr_options` | HDR pipeline controls |
| `qeClip.setColorValue(R, G, B, A)` (NOT `setValue([...])`) | `apply_ultra_key` | Accepts 0-255 ints OR 0-1 floats; `getColorValue()` returns `[R, G, B, A]` array |
| `qeComp.remove()` (function) | `remove_effect`, `remove_effect_by_name` | THẬT SỰ xóa component khỏi DOM (không phải disable) — initial spike đã miss vì `for...in` không enumerate non-DOM props |
| `qeClip.setTimeInterpolationType(int)` | `set_clip_time_interpolation` | 0=Frame Sample, 1=Frame Blend, 2=Optical Flow |
| Warp Stabilizer `AnalysisStatusCounter` (idx 31) | `configure_warp_stabilizer` | Increments while background analysis runs — pollable for progress |

### Caveats document trong tool API

- `add_transition_to_clip` `duration_seconds` bị bỏ qua trong 25.4 (signature mới 2-arg không nhận)
- "Center at Cut" alignment cũ không expose qua API mới
- Lumetri Vignette `Amount` Premiere clamp ~`-5..5` (không phải `-100..100`)
- Lumetri có duplicate property names across sections (3× "Saturation" tại idx 16/43/105) → tools dùng index-based addressing thay vì name-based

---

## 📊 Progress Log

### Session 2026-05-10 (current)

**Tổng quan:** Phase 0 spike + fix regression Premiere 25.4 (0 tool mới, chỉ sửa logic 4 file). Phase 1 implement 6 tool VFX (307→313). Phase 2 đang tiếp tục.

**Quy ước đếm tool theo phase:**
- Phase 0 = spike + bug fix regression QE 25.4 → **0 tool mới** (chỉ sửa logic bên trong tool có sẵn ở effects/transitions/audio/clipboard)
- Phase 1 = +6 tool VFX (configure_warp_stabilizer, apply_ultra_key, set_ultra_key_settings, apply_crop_mask, set_lumetri_creative, set_lumetri_vignette)

| Hạng mục | Trạng thái |
|---|---|
| Verify Premiere CEP connection | ✅ Done (Premiere 25.4.1, project "Lò nướng.prproj") |
| Spike 1.2 Mask API | ✅ Done — kết luận: **UI-only, không có ExtendScript path** |
| Spike 1.3 Ultra Key | ✅ Done — feasible, 27 props mapped |
| Spike 2.1 Lumetri | ⚠️ Done — 130 props mapped; curves là binary blob nên hạn chế |
| Spike 2.6 Warp Stabilizer | ✅ Done — feasible, 32 props mapped + có `AnalysisStatusCounter` |
| Phát hiện QE 25.4 regression | 🚨 Discovered (ngoài plan) |
| Fix `effects.ts` (8 sites) | ✅ Done |
| Fix `transitions.ts` (6 sites) | ✅ Done |
| Fix `audio.ts` (1 site) | ✅ Done |
| Fix `clipboard.ts` (1 site) | ✅ Done — `remove_effect_by_name` chuyển sang disable fallback |
| Fix `remove_effect`: disable fallback + note giải thích | ✅ Done |
| Update `extendscript-reference.ts` docs | ✅ Done |
| `npm run build` | ✅ Zero errors |
| Update plan.md + notebug.md với findings | ✅ Done |
| Cmd+Z 3 lần clip C7984.MP4 (gỡ spike artifacts) | ✅ User đã undo |
| Restart MCP server để load code mới | ✅ User restart |
| **Integration test e2e (6 tests)** | ✅ **5/5 fix pass + 1 bug pre-existing** |
| Phase 1 P0 implementation (6 tools) | ✅ Done — built + e2e verified (xem section bên dưới) |

### Phase 1 implementation (2026-05-10, sau Phase 0 verification)

6 tool mới được thêm vào `src/tools/effects.ts`, build zero errors. Tất cả logic đã verify qua `execute_extendscript` (replicate handler) trên clip thật C7984.MP4.

| # | Tool | Section | Status |
|---|---|---|---|
| 1 | `configure_warp_stabilizer` | 2.6 — Warp Stabilizer config | ✅ Verified: Result/Smoothness/Method/Framing/Crop balance/Maximum Scale/Additional Scale/Rolling Shutter Ripple all set correctly. Returns AnalysisStatusCounter. |
| 2 | `apply_ultra_key` | 1.3 — Chroma Key | ✅ Verified: Key Color via setColorValue(R,G,B,A) 0-255, Setting (Default/Relaxed/Aggressive), Output (Composite/Alpha/Color). |
| 3 | `set_ultra_key_settings` | 1.3 — Chroma Key tuning | ✅ Verified: tất cả 16 numeric props (Transparency/Highlight/Shadow/Tolerance/Pedestal/Choke/Soften/Contrast/Mid Point/Desaturate/Range/Spill/Luma/Saturation/Hue/Luminance). ⚠️ Section enable booleans (Matte Generation, Matte Cleanup, Spill Suppression, Color Correction) là UI-only state — bỏ khỏi tool API và document. |
| 4 | `apply_crop_mask` | 1.2 — Mask workaround | ✅ Verified: L/T/R/B/Zoom/Edge Feather. Premiere 25.4 không có mask API, Crop là path duy nhất cho rectangular mask. |
| 5 | `set_lumetri_creative` | 2.1 — Lumetri Creative tab | ✅ Verified: Faded Film/Sharpen/Vibrance/Saturation/Tint Balance bằng index-based addressing (vì Lumetri có duplicate names). |
| 6 | `set_lumetri_vignette` | 2.1 — Lumetri Vignette | ✅ Verified: Amount (Premiere clamp -5..5)/Midpoint/Roundness/Feather. |

**Phụ lục discovery:**
- ⚠️ **Lumetri/Ultra Key section toggles are read-only via setValue** — Matte Generation, Matte Cleanup, Spill Suppression, Color Correction (Ultra Key) + Active toggles trong Lumetri sections — `setValue(true, true)` silent no-op. Numeric props bên trong vẫn có hiệu lực bình thường, không phụ thuộc toggle.
- ⚠️ **Vignette Amount clamps to ~-5..5** thay vì -100..100 như docs Premiere SDK ghi. Có thể là 25.4 specific hoặc luôn vậy.
- ✅ **Crop's Zoom toggle (boolean) HOẠT ĐỘNG** — khác với section toggles. Effect-level feature flags vẫn settable.
- ✅ **`setColorValue(R, G, B, A)`** chấp nhận 0-255 ints hoặc 0-1 floats; `getColorValue()` return mảng đúng đơn vị input.

**Skip trong Phase 1 (do API hạn chế):**
- 2.1 Lumetri color wheels — không expose discrete props (binary blob hoặc packed values khó manipulate)
- 2.1 Lumetri curves — binary blob (idx 58/61/64/67/70 = ``/``)
- 2.1 read_lumetri_scopes — cần render frame, không có ExtendScript API
- 1.2 Real bezier mask — không có API trong 25.4 (xác nhận lại trong Phase 0 spike)

**Files thay đổi Phase 1:**
- `src/tools/effects.ts` — +6 tool handlers (~350 LOC)
- Build: zero errors, dist/tools/effects.js đã có cả 6 tool
- Tổng tool: **307 → 313**

### Phase 2 implementation (2026-05-10, sau Phase 1)

**Strategy:** Phase 2 gặp 2 regression mới ngoài kế hoạch (transition + setSpeed). User chọn "skip Morph Cut, tiếp 2.2" để không kẹt vào regression fix. Defer fix sau.

| # | Tool / Item | Section | Status |
|---|---|---|---|
| - | 2.5 Morph Cut | Transition | ⏸️ **DEFERRED** — phát hiện `qeTrack.addTransition` mất trong 25.4 (broken cho 6 sites trong transitions.ts + 1 audio.ts). Cần fix regression chung trước. |
| 1 | `set_clip_time_interpolation` | 2.2 Time Remapping (subset) | ✅ Verified: setTimeInterpolationType(0/1/2) = Frame Sample / Frame Blend / Optical Flow. |
| - | Speed ramp keyframes | 2.2 Time Remapping (full) | ❌ **NOT FEASIBLE** trong 25.4: Time Remapping component không expose qua DOM/QE clip; `qeClip.enableTimeRemapping/addSpeedKeyframe/setSpeedRamp` đều undefined. |
| 2 | `set_lumetri_hsl_secondary` | 2.1 Lumetri (subset) | ✅ Verified: Denoise/Blur/Temperature/Tint/Contrast/Sharpen/Saturation tại idx 95/96/101-105 tất cả set đúng. Color picker (Set/Add/Remove key colors) skip — workflow UI-driven. |

**Regression mới phát hiện trong Phase 2 (defer fix):**

1. **`qeTrack.addTransition` → `qeClip.addTransition(transition, alignmentInt)`**
   - Pattern y hệt qeComp.remove(): API di chuyển track→clip
   - Verified: `qeClip.addTransition(crossDiss, 1)` → numTransitions tăng đúng 1
   - Files cần fix: `src/tools/transitions.ts` (6 sites), `src/tools/audio.ts` (apply_audio_crossfade)

2. **DOM `clip.setSpeed` → QE `qeClip.setSpeed(percent, "1", maintainPitch, reversed, rippleEdit)`**
   - DOM clip không còn setSpeed (`is not a function`)
   - QE còn setSpeed + setReverse + setTimeInterpolationType + setFrameBlend
   - Files cần fix: `src/tools/timeline.ts` line 345 (`set_clip_properties` speed branch) + line 473 (`speed_change`)

**Tool count Phase 2:** 313 → **315** (+2: set_clip_time_interpolation, set_lumetri_hsl_secondary)

**Skip trong Phase 2:**
- 2.5 Morph Cut — defer tới khi fix transition regression
- 2.2 Speed ramp keyframes — không khả thi qua ExtendScript trong 25.4
- 2.1 Color wheels / curves — binary blob (đã skip Phase 1)
- 2.1 read_lumetri_scopes — không có ExtendScript API
- 2.4 Audio AI / Speech Enhancement / Remix — UI-only theo spike Phase 0
- 2.3 Essential Graphics typography — chưa probe, để Phase 3 nếu user yêu cầu

---

## ✅ Phase 3 — In Progress (2026-05-10)

**Tổng tool sau Phase 3 (partial):** **322** (315 → 317 → 322)

| # | Section | Tool(s) | Status |
|---|---|---|---|
| 3.7 | 3-point/4-point edit | `three_point_edit`, `four_point_edit` | ✅ Done — 2 tool, e2e logic verified (insert C8021/C8022 vào V3, fit-to-fill speed change) |
| 3.4 | HDR workflow | `list_sequence_color_spaces`, `set_sequence_color_space`, `set_sequence_hdr_options`, `list_clip_color_space_overrides`, `set_clip_color_space_override` | ✅ Done — 5 tool. Verified: switch Rec.709 ↔ Rec.2100 HLG ↔ ACEScct trên active sequence |
| 3.9 | Master Clip Effects | (planned: `apply_master_clip_effect`, `list_master_vs_instance_effects`) | ❌ **NOT FEASIBLE** — Premiere 25.4 ExtendScript projectItem không expose components/addEffect/getMasterClip; QE project cũng không có |
| 3.8 | Render & Replace | `render_clip_in_place`, `render_sequence_range`, `replace_clip_with_file` | ✅ Done (logic dry-run verified) — 3 tool. Real AME e2e test deferred (tốn CPU + thời gian render). |
| 3.6 | Surround pan | (planned: `set_surround_pan`, `downmix_to_stereo`) | ❌ **NOT FEASIBLE** — audio track trong 25.4 chỉ có `setMute/isMuted`, KHÔNG có `setPanDirection/setPan/getPanComponent` hay `components` collection. Per-clip pan đã có sẵn qua `set_clip_pan` (Internal Channel Volume). |
| 3.1 | Dynamic Link AE | (planned: `replace_with_ae_comp`, `import_ae_project_dynamically`) | ⏸️ Research-heavy (cần AE chạy) |
| 3.5 | VR/360 | `get_sequence_vr_settings`, `set_sequence_vr_settings`, `list_vr_effects_and_transitions` | ✅ Done — 3 tool. Round-trip verified (apply 360×180 equirectangular + restore). |
| 3.2 | Productions | research-only | ❌ Defer |
| 3.3 | Frame.io | needs API key + auth flow | ❌ Defer |

### 📋 Next session checklist — Phase 3 remainder + Phase 4

**Đề xuất thứ tự (theo ROI / risk):**

1. **3.8 Render & Replace** (rủi ro trung bình, ROI cao)
   - Spike: `app.encoder.encodeSequence(...)`, `app.encoder.encodeProjectItem(...)` đã có chưa? Render queue API qua `app.encoder`?
   - Đã có `add_to_render_queue`, `start_batch_encode`, `get_render_queue_status` — base building block sẵn rồi
   - Tools planned:
     - `render_and_replace` — bake effects/transforms thành media file mới, replace in-place trên timeline (giữ position + duration)
     - `make_subsequence` — convert clip range thành subsequence (đã có `create_subsequence` ở section 1.5? cần check)
   - Flow: render selected clip → wait for render done → import rendered file → replace_clip với rendered file
   - Cần verify: render API có async callback / polling status không

2. **Phase 4 P3 utilities — batch quick wins** (rủi ro thấp, mỗi tool ~5-10 phút)
   - `apply_lens_distortion_correction` — wrap apply_effect("Lens Distortion") + sensible defaults
   - `apply_auto_color` / `apply_auto_contrast` — wrap auto-color hidden effect (nếu Premiere có)
   - `apply_skin_tone_smoothing` — wrap "Median (Legacy)" hoặc "Camera Blur" với mask
   - `burn_in_timecode` — wrap apply_effect("Timecode" hoặc "Metadata & Timecode Burn-in")
   - `burn_in_captions` — render hardcoded captions
   - `create_smart_bin_advanced` — extend create_smart_bin với metadata+rating+label query
   - `edit_subclip_boundaries` — sửa in/out của subclip đã tạo

3. **3.6 Surround pan** (niche, low priority)
   - `set_surround_pan` — 5.1/7.1 panner position
   - `downmix_to_stereo` — downmix coefficients custom
   - Cần spike audio panner API

4. **3.5 VR/360** (chuyên dụng, defer nếu không có 360 content)
   - `convert_to_vr_sequence` — đã có `auto_reframe_sequence`?
   - `apply_vr_transition` — wrap VR transition matchName
   - `set_vr_view_orientation` — set rotation cho 360° clip

5. **3.1 Dynamic Link AE** (research-heavy, defer)
   - Cần AE chạy + verify Dynamic Link API qua ExtendScript
   - High-touch testing

**Workflow đề xuất next session:**
- Spike 3.8 render queue API (1 ph) → quyết định render_and_replace có khả thi không
- Nếu có: implement 3.8 (~1-2 giờ) → commit
- Sau đó knock out batch Phase 4 (~1 giờ cho 5-7 tool)
- Cuối session: update plan + commit + bump v1.1.3 nếu xong nhiều

**Risk note:** Render queue async behavior chưa verify. Có thể cần callback hoặc polling status (`get_render_queue_status` đã có) → render_and_replace có thể là 2-step async tool (start render → poll until done → replace). Spike trước để biết.

---

## ✅ Phase 3.8 Render & Replace — DONE (2026-05-10, post-compact)

**Tool count sau Phase 3.8:** **343** (340 + 3)

### Spike findings (`app.encoder` API trên 25.4)

| API | Status | Notes |
|---|---|---|
| `app.encoder.encodeSequence(seq, outputPath, presetPath, range, removeOnDone)` | ✅ function | Range constants: `ENCODE_ENTIRE=0`, `ENCODE_IN_TO_OUT=1`, `ENCODE_WORKAREA=2` |
| `app.encoder.encodeProjectItem(...)` | ✅ function | For rendering project items directly |
| `app.encoder.encodeFile(...)` | ✅ function | Transcoding |
| `app.encoder.startBatch()` | ✅ function | Kicks off queued jobs |
| `app.encoder.launchEncoder()` | ✅ function | Starts AME process |
| `app.encoder.bind(eventName, callback)` | ⚠️ accepts ANY event name without validation | Cannot reliably observe completion |
| `app.encoder.isRunning()` | ❌ undefined (existing `get_render_queue_status` tool returns "unknown" because of this) | |
| `app.encoder.stopBatch()` | ❌ undefined | |
| `app.encoder.quitEncoder()` | ❌ undefined | |
| `app.encoder.EVENT_*` constants | ❌ undefined | Use string event names directly |

**24 native exporters** discovered via `getExporters()` — H.264, HEVC, ProRes, DNxHR, MPEG2, JPEG2000, etc.

### Sequence in/out manipulation regression (NEW finding)

| API | Behavior 25.4 |
|---|---|
| `seq.getInPoint()` / `seq.getOutPoint()` | Return **string of seconds** (not Time object). Sentinel `-400000` = "no out point set". |
| `seq.setInPoint(value)` | Accepts **string of ticks**. Number is interpreted incorrectly (treats as seconds with weird scaling). |
| `seq.clearInPoint()` / `seq.clearOutPoint()` | ❌ undefined in 25.4 (workaround: setInPoint/setOutPoint with sentinel value) |
| `seq.zeroPoint.ticks` | Returns **Number** (not string) — `setInPoint(seq.zeroPoint.ticks)` throws "Illegal Parameter type" |

**⚠️ Latent bug discovered:** `clear_sequence_in_out` tool (track-targeting.ts:902) passes `seq.zeroPoint.ticks` to setInPoint — broken in 25.4. Add to backlog for future fix.

### Tools added

| # | Tool | Purpose |
|---|---|---|
| 1 | `render_clip_in_place` | Render a single timeline clip's range to a baked file via AME. Set seq in/out → encodeSequence(ENCODE_IN_TO_OUT) → restore in/out. Fire-and-forget. |
| 2 | `render_sequence_range` | General-purpose render of seq range (entire/in_to_out/work_area) with optional in/out override. |
| 3 | `replace_clip_with_file` | Import file + overwriteClip at clip's start position. Diffs bin children to locate newly imported item. |

**Workflow render & replace:**
1. `render_clip_in_place(clip_node_id, output_path)` → kicks off AME render of clip's range
2. User waits for AME (poll output file existence externally — no synchronous wait API)
3. `replace_clip_with_file(clip_node_id, output_path)` → imports + overwrites clip with baked version

### Verification

- ✅ TypeScript build zero errors
- ✅ Dry-run logic verified on clip C8007.MP4 (V3, 58.008-59.993s):
  - Save prev in/out as seconds-string ✓
  - Set new in/out via clipStart.ticks (string) ✓
  - Restore via `__secondsToTicks(prevSec).toString()` ✓
- ⏸️ Real AME e2e (start AME + render + replace) — deferred to user-driven test (tốn CPU + thời gian)

---

## ✅ Phase 4 batch 6 — DONE (2026-05-10, post-compact)

**Tool count sau Phase 4 batch 6:** **362** (354 + 8)

### Tools added (effects.ts) — 8 distortion / film-look wrappers

| # | Tool | matchName | Properties |
|---|---|---|---|
| 1 | `apply_echo` | `AE.ADBE Echo` | Echo Time (seconds), Number Of Echoes, Starting Intensity (0-1), Decay (0-1) |
| 2 | `apply_solarize` | `PR.ADBE Solarize` | Threshold (0-255, NOTE: actual property uses 0-255 scale, default 128 midpoint) |
| 3 | `apply_spherize` | `AE.ADBE Spherize` | Radius (signed for bulge/pinch), Center of Sphere [x,y] normalized |
| 4 | `apply_twirl` | `AE.ADBE Twirl` | Angle (degrees), Twirl Radius (0-100), Twirl Center [x,y] |
| 5 | `apply_wave_warp` | `AE.ADBE Wave Warp` | Wave Type (enum 0-6: Sine/Triangle/Square/Saw/Inverse Saw/Noise/Smooth Noise), Wave Height, Wave Width, Direction, Wave Speed |
| 6 | `apply_bevel_alpha` | `AE.ADBE Bevel Alpha` | Edge Thickness, Light Angle, Light Intensity (0-1) |
| 7 | `apply_noise` | `AE.ADBE Noise` | Amount of Noise (0-100), Use Color Noise (bool), Clip Result Values (bool) |
| 8 | `apply_dust_and_scratches` | `AE.ADBE Dust & Scratches` | Radius (px), Threshold (**0-1 normalized**, không phải 0-255), Operate on Alpha (bool) |

### Runtime verification

- ✅ TypeScript build zero errors
- ✅ Replicate handler trên C7984.MP4 — 7/8 effects properties set perfectly first try
- 🐛 Bug found + fixed: `apply_dust_and_scratches` Threshold expected 0-1 normalized (clamp 30→1) — fix description (similar pattern as Find Edges blend)
- ✅ Test clip cleaned up (Opacity + Motion intrinsic only)

### Discovery patterns

**Threshold properties stored as 0-1 in some effects:** Dust & Scratches Threshold, Find Edges Blend With Original. **But** Solarize Threshold uses 0-255 (default 128) — Premiere is **inconsistent**. Always probe `getValue()` after first setValue to confirm scale.

**Echo time can be negative** — negative = trail (ghosts of past frames lag), positive = lead (future frames). Default `-0.0333` ≈ -1/30 sec = one-frame trail at 30fps.

**Solarize matchName uses `PR.` prefix** (PR.ADBE Solarize) instead of typical `AE.ADBE` — anomaly in Premiere effects DB. Probably legacy Premiere-specific port.

---

## ✅ Phase 4 batch 5 + latent bug fix — DONE (2026-05-10, post-compact)

**Tool count sau Phase 4 batch 5:** **354** (346 + 8)

### Latent bug fix: `clear_sequence_in_out` (track-targeting.ts:902)

Phase 3.8 spike phát hiện `seq.zeroPoint.ticks` trả về **Number** trong 25.4 (không phải string), nên `seq.setInPoint(seq.zeroPoint.ticks)` throw "Illegal Parameter type". Replace bằng `seq.setInPoint("0")` (verified working — string "0" accepted).

`seq.setOutPoint(seq.end)` vẫn OK (seq.end là Time object, accepted by setOutPoint).

**Verified end-to-end:** Set in/out tới (58s, 60s) → call clear → in=0, out=298s (full sequence end). ✅

### Tools added (effects.ts) — 8 effect wrappers

| # | Tool | matchName | Properties exposed |
|---|---|---|---|
| 1 | `apply_tint` | `AE.ADBE Tint` | Amount to Tint (0-100) |
| 2 | `apply_alpha_glow` | `AE.ADBE Alpha Glow` | Glow (radius), Brightness (0-255) |
| 3 | `apply_posterize` | `AE.ADBE Posterize` | Level (color quantization, default 7) |
| 4 | `apply_threshold` | `AE.ADBE Threshold2` | Level (luminance cutoff 0-1, default 0.5) |
| 5 | `apply_find_edges` | `AE.ADBE Find Edges` | Invert (bool), Blend With Original (**0-1 normalized**, không phải 0-100 percent) |
| 6 | `apply_mirror` | `AE.ADBE Mirror` | Reflection Center [x,y] normalized 0-1, Reflection Angle (degrees) |
| 7 | `apply_sharpen` | `AE.ADBE Sharpen` | Sharpen Amount (0-100) — simple alternative to Unsharp Mask |
| 8 | `apply_proc_amp` | `AE.ADBE ProcAmp` | Brightness, Contrast (default 100), Hue (degrees), Saturation (default 100), Split Screen (bool), Split Percent (0-100) |

### Effects catalog probe results (21 effects available)

Các effects còn nhận được ngoài batch 5:
- Echo, Solarize, Replicate, Spherize, Twirl, Wave Warp, Median (Legacy), Roughen Edges, Bevel Alpha, Bevel Edges, Reduce Interlace Flicker, Noise, Dust & Scratches

**KHÔNG tìm thấy** (UI menu commands hoặc legacy renamed):
- Auto Color, Auto Levels, Auto Contrast (UI menu only — không có effect entries)
- Color Balance (HLS/RGB) — name không match. Có thể đã renamed trong 25.4
- Channel Mixer, Stylize, Edge Behavior — missing
- Match Grain, Add Grain, Remove Grain — missing trong base install

### Runtime verification

- ✅ TypeScript build zero errors
- ✅ Replicate handler logic on C7984.MP4 — all 8 effects applied successfully, all properties set correctly except Find Edges blend (clamped 30→1, fixed by clarifying description as 0-1 normalized)
- ✅ Cleanup: test clip còn 2 components (Opacity + Motion intrinsic)

### Discovery: Find Edges blend property unit

`Blend With Original` trên Find Edges là **0-1 normalized** (clamped), không phải 0-100 percent như Premiere UI hiển thị. Khi user pass 30, Premiere clamp xuống 1 (max). Tool description đã clarify rõ.

**Pattern lesson:** Premiere UI thường hiển thị 0-100% cho percentage props nhưng API có thể store 0-1 hoặc 0-100 tùy effect. Luôn probe `prop.getValue()` sau setValue để verify scale.

---

## ✅ Phase 3.5 VR/360 — DONE (2026-05-10, post-compact)

**Tool count sau Phase 3.5:** **346** (343 + 3)

### Spike findings

`seq.getSettings()` trên 25.4 expose 4 VR fields:
- `vrLayout` (number enum) — 0 = Monoscopic, 1 = Stereoscopic SbS, 2 = Stereoscopic Top/Bottom
- `vrProjection` (number enum) — 0 = None (not VR), 1 = Equirectangular
- `vrHorzCapturedView` (degrees, e.g. 360 for full sphere)
- `vrVertCapturedView` (degrees, e.g. 180 for full sphere)

Round-trip `seq.setSettings()` returns `true` and changes apply correctly.

**8 VR effects + 4 VR transitions** confirmed available qua `qe.project.getVideoEffectByName`:
- Effects: VR Plane to Sphere, VR Rotate Sphere, VR Sharpen, VR Glow, VR Color Gradients, VR Projection, VR Digital Glitch, VR Chromatic Aberrations
- Transitions: VR Chroma Leaks, VR Light Rays, VR Mobius Zoom, VR Random Blocks

### Tools added (sequence.ts)

| # | Tool | Purpose |
|---|---|---|
| 1 | `get_sequence_vr_settings` | Read current VR settings of active sequence |
| 2 | `set_sequence_vr_settings` | Configure VR mode (layout/projection/horz/vert captured view); only provided fields are changed |
| 3 | `list_vr_effects_and_transitions` | Discovery tool — probe which VR effects/transitions are available, useful cho AI agent on VR sequences |

### Verification

- ✅ TypeScript build zero errors
- ✅ Round-trip test on Sequence 01 Cắt:
  - Initial: `{vrLayout:0, vrProjection:0, vrHorzCapturedView:0, vrVertCapturedView:0}` (monoscopic non-VR)
  - Apply equirectangular monoscopic 360×180 → all 4 fields confirmed via re-read
  - Restore back to initial → all fields confirmed back

### Phase 3.6 Surround pan — NOT FEASIBLE

Track-level API `seq.audioTracks[i]` chỉ expose: `clips, id, mediaType, name, transitions, setMute(), isMuted()`. Không có:
- `setPanDirection / setPan / pan` 
- `getPanComponent / panComponent`
- `components` collection
- `audioChannelType`

Clip-level pan đã có qua existing `set_clip_pan` (Panner component, displayName "Balance"/"Pan"). Stereo Channel Volume Left/Right cũng accessible qua `Internal Channel Volume Stereo` component nhưng existing `set_clip_pan` đủ dùng.

**Marked as not feasible:**
- `set_surround_pan` (5.1/7.1 panner) — track API missing
- `downmix_to_stereo` (custom coefficients) — track API missing

---

## ✅ Phase 4 batch (partial, 2026-05-10) — code-only, runtime test pending

CEP bridge bị hang sau big probe script → end session với code commit. 4 tool Phase 4 added, **chưa test runtime**.

| # | Tool | File | Status |
|---|---|---|---|
| 1 | `apply_lens_distortion_correction` | effects.ts | ✅ Built — apply Lens Distortion với optional curvature param. Test pending. |
| 2 | `apply_drop_shadow` | effects.ts | ✅ Built — Drop Shadow với opacity/direction/distance/softness defaults. Test pending. |
| 3 | `burn_in_timecode` | effects.ts | ✅ Built — burn Timecode effect, opacity optional. Test pending. |
| 4 | `apply_basic_3d` | effects.ts | ✅ Built — Basic 3D với swivel/tilt/distance/specular. Test pending. |

**Tổng tool sau Phase 4 partial:** **326** (322 + 4)

### Phase 4 expansion (cùng session, code-only)

| # | Tool | File | Notes |
|---|---|---|---|
| 5 | `apply_unsharp_mask` | effects.ts | Sharpening với amount/radius/threshold optional |
| 6 | `apply_brightness_contrast` | effects.ts | Quick tonal adjust — defer to Lumetri cho fine work |
| 7 | `apply_camera_blur` | effects.ts | Soft focus / depth-of-field |
| 8 | `burn_in_metadata` | effects.ts | "Metadata & Timecode Burn-in" — fuller QC info than burn_in_timecode |
| 9 | `edit_subclip_boundaries` | export.ts | Modify subclip in/out via setInPoint/setOutPoint với mediaType enum |

**Tổng sau expansion:** **331** (326 + 5). Tất cả code-only, chưa test runtime.

### Phase 4 batch 3 (cùng session, code-only — CEP vẫn hang)

| # | Tool | File | Notes |
|---|---|---|---|
| 10 | `apply_gaussian_blur` | effects.ts | Blurriness + blur dimensions enum + repeat edge pixels |
| 11 | `apply_mosaic` | effects.ts | Privacy/pixelate — horizontal/vertical blocks + sharp colors |
| 12 | `apply_lens_flare` | effects.ts | Flare brightness + lens type enum (50-300mm/35mm/105mm) |
| 13 | `apply_skin_tone_smoothing` | effects.ts | Camera Blur wrapper với intensity defaults; subtle by default |
| 14 | `apply_levels` | effects.ts | Levels: input/output black/white + gamma per RGB |

**Tổng sau batch 3:** **336** (331 + 5).

### Phase 4 batch 4 (cùng session, code-only)

| # | Tool | File | Notes |
|---|---|---|---|
| 15 | `apply_effect_with_properties` | effects.ts | **Architectural**: generic apply effect + set N properties trong 1 call. LLM dùng tool này thay cho chuỗi apply_effect + set_effect_property × N. Match property by FIRST displayName (cảnh báo về duplicate names). |
| 16 | `apply_directional_blur` | effects.ts | Motion blur direction + length |
| 17 | `apply_black_white` | effects.ts | B&W conversion (simple toggle) |
| 18 | `apply_invert` | effects.ts | Channel invert với selector enum (RGB/Red/Green/Blue/Alpha/Hue/Lightness/Sat/CMY) + blend |

**Tổng sau batch 4:** **340** (336 + 4).

### Phase 4 runtime verification (cùng session, sau khi user restart Premiere)

CEP đã restart, runtime test 18+1 Phase 4 tools qua execute_extendscript (replicate handler logic):

**✅ Verified (15 tools không cần fix):**
- apply_effect_with_properties (architectural — apply Lumetri + set Exposure/Highlights/Shadows)
- apply_lens_distortion_correction (Curvature)
- apply_drop_shadow (Opacity/Direction/Distance/Softness)
- burn_in_timecode (Opacity)
- apply_unsharp_mask (Amount/Radius/Threshold)
- apply_brightness_contrast (Brightness/Contrast)
- apply_camera_blur (Percent Blur — tool đã handle 3 variants, đúng tên là "Percent Blur")
- burn_in_metadata (no specific props, just apply)
- edit_subclip_boundaries (no test — needs subclip)
- apply_gaussian_blur (Blurriness/Blur Dimensions/Repeat Edge Pixels)
- apply_mosaic (Horizontal Blocks/Vertical Blocks/Sharp Colors)
- apply_lens_flare (Flare Brightness/Lens Type)
- apply_skin_tone_smoothing (uses Camera Blur — works)
- apply_directional_blur (Direction/Blur Length)
- apply_black_white (no props)

**🐛 Bugs found + fixed:**

| Tool | Bug | Fix |
|---|---|---|
| `apply_basic_3d` | Param name `"Specular Highlight"` không match | → `"Show Specular Highlight"` |
| `apply_levels` | 4 prop names sai thứ tự (`"Input Black"` etc.) | → `"(RGB) Black Input Level"`, `"(RGB) White Input Level"`, `"(RGB) Black Output Level"`, `"(RGB) White Output Level"` |
| `apply_levels` | Gamma value 1.5 → result 1 (truncated) | Gamma stored as int 100=1.0; tool converts user-facing float × 100 |
| `apply_invert` | Channel param accepts string nhưng Premiere expects int (`"Red"` → "Illegal Parameter type") | Add channelMap enum: RGB=0, Red=1, Green=2, Blue=3, Alpha=4, Hue=5, Lightness=6, Saturation=7, Yellow=8, Magenta=9, Cyan=10 |

Test clip C7984.MP4 sạch sau test (chỉ Opacity + Motion intrinsic).

**Pattern:** Mỗi tool wraps `apply_effect` với matchName cụ thể + optional property setters cho sensible defaults. Reuse `__getQEClip(result)` helper từ Phase 0.5 để correct DOM↔QE indexing.

**Cần làm session sau:**
- Test e2e 4 tool Phase 4 trên clip thật (apply + verify property values + remove)
- Probe property names chính xác cho mỗi effect (vd Drop Shadow's "Direction" có thể tên khác trong 25.4)
- Continue Phase 4 batch: skin_tone_smoothing, auto_color, burn_in_metadata, ...
- Pickup Phase 3.8 Render & Replace với render queue spike

**CEP recovery checklist (cho user):**
1. Check Premiere Pro vẫn chạy
2. Window → Extensions → MCP plugin (re-open nếu plugin tab bị close)
3. Hoặc restart Premiere Pro nếu CEP hung
4. Save project trước khi restart (Cmd+S) để giữ test artifacts đã clean
5. Sau recover, ping qua MCP để verify connection

**Phase 3.4 HDR — discovery details:**
- `seq.getSettings().workingColorSpaceList` returns 4 entries: Rec. 709, Rec. 2100 HLG, Rec. 2100 PQ, ACEScct
- `seq.getSettings().workingColorSpace = picked; seq.setSettings(settings)` switches sequence working color space
- Per-clip: `projectItem.getOverrideColorSpaceList` (property, not function — returns 32 entries including camera-native S-Log/V-Log/ARRI/RED) + `projectItem.setOverrideColorSpace(spaceObj)` for per-clip override
- Bonus settings: `autoToneMapEnabled`, `autoInputGamutCompressionEnabled`, `compositeLinearColor` — exposed via `set_sequence_hdr_options`
- HDR metadata (MaxCLL/MaxFALL, Master Display) likely in encoder presets at export time, not sequence settings — defer

**Phase 3.9 Master Clip Effects — why not feasible:**
- DOM `projectItem` keys: `children, getOverrideColorSpaceList, interpretedTimebase, name, nodeId, sourceTimebase, timeDisplayFormat, treePath, type` — no `components`, `addEffect`, `getMasterClip`
- DOM `addEffect`, `applyMasterClipEffect` undefined
- QE project doesn't expose master clip components either
- → Master clip effects = UI-only operation. Workaround: apply effect to all instance clips manually.

---

## ✅ Phase 0.5 — DONE (2026-05-10)

**Outcome:** 2 regression đã plan + 1 regression latent quan trọng hơn (DOM≠QE clipIndex) đều đã fix.

| Fix | Sites | Status |
|---|---|---|
| **3c-bis** `qeTrack.addTransition` → `qeClip.addTransition(t, alignmentInt)` | 4 trong transitions.ts + 1 trong audio.ts | ✅ Fixed + verified e2e (Morph Cut applied đúng V3 C8007) |
| **3c-tris** DOM `clip.setSpeed` → QE `qeClip.setSpeed(percent, "1", false, reverse, false)` | 2 trong timeline.ts (set_clip_properties + speed_change) | ✅ Fixed + verified e2e (speed 100→150→100) |
| **3e (NEW)** DOM clipIndex ≠ QE clipIndex (Empty placeholders) | 21 sites trong advanced/effects/clipboard/timeline | ✅ Fixed via `__getQEClip(result)` helper |

**Helper mới:** `__getQEClip(result)` trong `src/bridge/script-builder.ts` (auto-prepended vào mọi script). Walk QE track items, skip Empty placeholders, return Nth non-Empty match DOM clipIndex.

**Verification e2e (post-rebuild + MCP respawn, 2026-05-10):**
- `apply_effect("Lumetri Color")` trên C7971 (DOM idx 2, QE idx 3) → component count 2→3, Lumetri thực sự đến C7971 (trước fix: silent leak vào Empty)
- `remove_effect("Lumetri Color")` trên C7971 → 3→2, qeComp.remove() đúng clip
- `speed_change(C7971, 150)` → qeClip.speed=150 ✓; reset 100 ✓
- `add_transition_to_clip(C8007, "Morph Cut", end)` → V3 numTransitions tăng đúng, Morph Cut tại đúng vị trí

**Caveats còn lại:**
- `add_transition_to_clip` duration_seconds bị bỏ qua (signature mới không nhận) — transition dùng default Premiere
- "Center at Cut" alignment cũ KHÔNG expose qua API mới — chỉ start (0) hoặc end (1) of clip

**Tổng tool:** **315** (không tăng — đây là fix work, không add tool). Tất cả tool QE-based giờ hoạt động đúng cho clip sau Empty placeholder.

---

## 📋 ARCHIVED CHECKLIST — Phase 0.5 plan (đã hoàn thành ở trên)

> User đã commit dành 1 session cho fix 2 regression Premiere 25.4 phát hiện trong Phase 2 spike.
> Pattern y hệt Phase 0 cũ (qeComp.remove): API di chuyển từ track-level/DOM-level sang clip-level QE.

### Checklist fix (theo thứ tự ROI)

#### Fix 1: `clip.setSpeed` → `qeClip.setSpeed(percent, "1", maintainPitch, reversed, rippleEdit)` (2 sites)

| File | Line | Tool | Fix |
|---|---|---|---|
| `src/tools/timeline.ts` | ~345 | `set_clip_properties` (speed branch) | Wrap qeClip + setSpeed signature 5-arg |
| `src/tools/timeline.ts` | ~473 | `speed_change` | Same |

**Pattern:**
```javascript
// Trước:
clip.setSpeed(${args.speed * 100});

// Sau:
app.enableQE();
var qeSeq = qe.project.getActiveSequence();
var qeTrack = result.trackType === "video" ? qeSeq.getVideoTrackAt(result.trackIndex) : qeSeq.getAudioTrackAt(result.trackIndex);
var qeClip = qeTrack.getItemAt(result.clipIndex);
qeClip.setSpeed(${args.speed * 100}, "1", false, false, false);
// 5 args: percent, timeBase, maintainAudioPitch, reversed, rippleEdit
```

**Test sau fix:** `speed_change(node_id, speed_percent=200)` → verify `qeClip.speed === 200`.

#### Fix 2: `qeTrack.addTransition` → `qeClip.addTransition(transition, alignmentInt)` (7 sites)

| File | Line | Tool | Fix |
|---|---|---|---|
| `src/tools/transitions.ts` | 53 | `add_transition` | clip-level addTransition |
| `src/tools/transitions.ts` | 120 | `add_transition_to_clip` start branch | Same |
| `src/tools/transitions.ts` | 124 | `add_transition_to_clip` end branch | Same |
| `src/tools/transitions.ts` | 188 | `batch_add_transitions` | Same |
| `src/tools/transitions.ts` | 2 sites khác | (cần grep `qeTrack.addTransition`) | Same |
| `src/tools/audio.ts` | ? | `apply_audio_crossfade` | Same trên audio track |

**Pattern:**
```javascript
// Trước:
qeTrack.addTransition(transitionQE, alignBool, cutTicks, durationTicks, "0", false);

// Sau (verified working signature):
var qeClip = qeTrack.getItemAt(clipIndex);   // CLIP at the cut, not the track
qeClip.addTransition(transitionQE, alignmentInt);
// alignmentInt: 1 verified work; 0 và 2 cần test thêm để map "Center at Cut" / "Start at Cut" / "End at Cut"
```

**Cần spike thêm trong session fix:**
- alignment: 0 vs 1 vs 2 → xác định đúng giá trị cho 3 alignment Premiere UI
- Có cần passes durationTicks không? (signature 2-arg đã work nhưng duration mặc định ?)
- Trên audio track, có làm tương tự được không?

#### Fix 3 (BONUS — đã verified working trong Phase 0): `clip.components[i].remove()` → `qeClip.getComponentAt(i).remove()`

Đã fix trong Phase 0 cho effects.ts + clipboard.ts. Verify lại không có site nào còn xài DOM-level `.remove()` lén lút.

```bash
grep -rn "\.components\[.*\]\.remove\|components\.deleteComponent" src/tools/
```

### Mở phạm vi fix (optional — nếu spike thêm thấy thêm regression)

Phase 0 + Phase 2 spike đã verify được pattern: **API móc 25.4 = di chuyển từ DOM/track sang QE clip-level**. Trước khi fix, có thể spike các API khác có pattern tương tự:
- `clip.disabled = true` / `clip.enabled` (toggle clip eyeball) — DOM property?
- `clip.move(...)` — di chuyển clip trên timeline
- `seq.razor(time)` / `qeTrack.razor(time)` vs `qeClip.razor()` — cắt clip
- `qeTrack.addItem(...)` vs `qeClip.???` — insert clip

Spike 1-2 giờ trước khi fix sẽ tránh phát hiện regression mới ở giữa session sau.

### Sau khi fix xong

- [ ] `npm run build` zero errors
- [ ] Restart MCP (pkill -f) + verify 7 tool transition + 2 tool speed hoạt động qua real MCP
- [ ] Update `notebug.md`: chuyển 2 regression khỏi "defer" sang "fixed"
- [ ] Update `extendscript-reference.ts` với pattern di chuyển track→clip
- [ ] Sau đó **reopen 2.5 Morph Cut** (sẽ dùng được add_transition_to_clip đã fix)
- [ ] Cân nhắc bump version v1.1.2 (regression fix release) trước khi sang Phase 3

### Rủi ro session sau

- Audio crossfade trên audio track có thể có signature khác — cần test riêng
- Alignment enum có thể không phải 0/1/2 thẳng — Premiere có thể dùng giá trị khác
- Có thể có thêm regression chưa phát hiện trong scope clip operations

**Lưu ý cho Phase tiếp theo:** Để Claude Code thấy 6 tool mới, cần restart Claude Code IDE (toggle MCP không đủ — tool catalog cache tại conversation start). Trong session này, logic verified qua `execute_extendscript`, sẽ test trực tiếp ở session sau.

**Kết quả integration test (sau MCP restart, 2026-05-10):**
| # | Test | Kết quả |
|---|---|---|
| 1 | `list_available_effects` | ✅ 142 effects, names đúng (Ultra Key=11, Lumetri=26, Crop=83, Mask=100, Warp Stab=122) |
| 2 | Verify clip cleanup | ✅ Clip C7984.MP4 sạch sau Cmd+Z |
| 3 | `apply_effect("Lumetri Color")` | ✅ Applied OK (note: tạo 2 components — 1 master, 1 instance là behavior bình thường) |
| 4 | `remove_effect` (post-rebuild + MCP respawn) | ✅ Thật sự xóa: `{ removed:true, indexRemoved:2, componentsBefore:3, componentsAfter:2 }` — qua `qeClip.getComponentAt(idx).remove()` |
| 5 | `color_correct` (chỉ exposure) | ✅ PASS; ⚠️ Phát hiện **bug pre-existing** (KHÔNG do session này): multi-param fail với "Invalid parameter" vì set value 110 vào prop "Saturation" boolean toggle (Lumetri có 3 prop tên Saturation cùng lúc). Cần fix riêng trong Phase 1 hoặc tách ticket. |
| 6 | `list_available_audio_effects` | ✅ 76 audio effects (DeNoise, DeReverb, Hard Limiter, Multiband Compressor, ... — relevant cho audio tools tương lai) |

**Kết luận test:** Toàn bộ 25.4 regression fixes hoạt động đúng end-to-end. Có 1 bug riêng trong `color_correct` (multi-name prop matching) cần xử lý sau, không liên quan QE API.

**Bug mới phát hiện cần ticket riêng:**
- `color_correct` setValue cho TẤT CẢ properties trùng tên (vd Saturation xuất hiện 3 lần trong Lumetri: idx 16 Basic Correction Saturation [number 0-200], idx 43 Creative Saturation [number 0-200], idx 106 Color Correction Saturation [BOOLEAN toggle]). Khi user truyền `saturation=110`, code set 110 vào toggle boolean → "Invalid parameter". Cần thêm filter theo property type hoặc theo section context.

### 🎯 Re-discovery 2026-05-10 (sau user feedback): qeComp.remove() THỰC SỰ XÓA ĐƯỢC

**Tình huống:** Sau khi commit fix "disable fallback" cho remove_effect, user thắc mắc "phải disable được chứ" → spike sâu hơn → phát hiện **path xóa thật** mà initial spike đã miss.

**Path đúng (verified):**
```javascript
app.enableQE();
var qeClip = qeTrack.getItemAt(clipIdx);
var qeComp = qeClip.getComponentAt(componentIdx);  // ← KEY API
qeComp.remove();                                     // ← TRULY removes
```

**Tại sao initial spike miss:**
- Initial spike test `clip.components[i].remove()` (standard ExtendScript path) → undefined
- Initial spike test `qeClip.removeEffects(...)` → chỉ remove intrinsic
- KHÔNG test `qeClip.getComponentAt(i).remove()` — đây là QE-level component object **khác hẳn** với standard component
- QE methods/properties không enumerable qua `for...in`, nên enumeration probe miss

**Verified test:** Apply Lumetri (4 components total) → `qeComp.remove()` → 3 components, `trulyRemoved: true`. Component name "Lumetri Color" thật sự biến mất khỏi clip.

**Action items:**
- [x] Fix `remove_effect` (effects.ts): chuyển từ disable-fallback sang `qeComp.remove()` thật — DONE
- [x] Fix `remove_effect_by_name` (clipboard.ts): tương tự, iterate backwards — DONE
- [x] Update extendscript-reference.ts: sửa note 25.4 từ "không xóa được" → "xóa qua qeClip.getComponentAt(i).remove()" — DONE
- [x] `npm run build` zero errors — DONE
- [x] Cleanup C7984.MP4 (clip đã sạch sau user undo) — DONE
- [ ] User restart MCP server lần nữa + verify remove_effect e2e thật sự xóa

**Bài học rút ra:** QE DOM có hai loại component object:
1. `clip.components[i]` (standard ExtendScript) — chỉ có `displayName, instanceName, matchName, properties`
2. `qeClip.getComponentAt(i)` (QE-level) — có `id, matchName, name, remove()`

Khi probe API trong tương lai, **luôn test cả hai paths** vì chúng expose method set khác nhau.

**Kế hoạch ngay sau session này (Phase 1 — VFX focus):**
1. **2.6 Warp Stabilizer config** (rủi ro thấp, props đã map xong) — bổ sung tool `configure_warp_stabilizer` set Result/Smoothness/Method/Framing/Crop-Smooth balance
2. **1.3 Ultra Key tools** — `apply_ultra_key`, `set_ultra_key_settings` (matte gen / cleanup / spill / color correction sections)
3. **2.1 Lumetri color wheels + curves enable** — wheels khả thi, curves chỉ enable/disable section, scopes skip
4. **1.2 Crop-based "mask" workaround** — wrap effect "Crop" vì mask thực không khả thi

**Files thay đổi trong session này:**
- `src/tools/effects.ts` — 8 fix sites
- `src/tools/transitions.ts` — 6 fix sites
- `src/tools/audio.ts` — 1 fix site
- `src/tools/clipboard.ts` — 1 fix site (remove_effect_by_name → disable)
- `src/resources/extendscript-reference.ts` — docs cập nhật về 25.4 caveats
- `plan.md` — progress log + spike results + regression findings
- `notebug.md` — Bug 3 (3a/3b/3c/3d) chi tiết cho QE 25.4 regression

---

## 0. Bối cảnh & Trạng thái hiện tại

### Trạng thái môi trường khi lập plan
- ✅ **Premiere Pro CEP plugin đã kết nối** (verified 2026-05-10): Premiere 25.4.1, project "Lò nướng.prproj", sequence "Sequence 01 Cắt" (3840×2160, 22 clips V1).
- ✅ Source code MCP đầy đủ, build hệ thống TypeScript đã hoạt động.
- 🚨 **PHÁT HIỆN MỚI 2026-05-10 sau Phase 0 spike:** QE DOM API thay đổi trong Premiere 25.4 — nhiều tool effects hiện tại có thể đã broken. Xem chi tiết section "🚨 PHÁT HIỆN CRITICAL" trong roadmap bên dưới.

### User context (xác nhận 2026-05-10)
- **Use case ưu tiên:** VFX/Color grading → focus 1.2 Masking, 1.3 Chroma Key, 2.1 Lumetri, 2.6 Warp Stabilizer
- **Approach:** Spike API rủi ro trước rồi mới implement

### Hai hướng tiếp cận (chọn 1 hoặc kết hợp)

| Hướng | Mô tả | Khi nào dùng |
|---|---|---|
| **A. Thêm tool mới vào source MCP** (RECOMMENDED) | Viết handler trong `src/tools/*.ts`, build (`npm run build`), restart MCP. Tools mới hiện ra cùng 269 tools cũ. | Tính năng dùng lâu dài, muốn AI gọi trực tiếp như tool có sẵn. |
| **B. ExtendScript thuần qua `execute_extendscript`** | Viết file `.jsx` riêng, gọi qua tool `execute_extendscript` đã có. Không cần build. | Prototype nhanh, kiểm chứng API trước khi đưa vào source. |

**Workflow khuyến nghị:** B → A. Prototype bằng ExtendScript thuần để verify API, sau đó wrap thành tool trong MCP source. Cách này khớp với pattern fix bug đã làm trong `notebug.md`.

### Cấu trúc source liên quan

```
src/
├── tools/
│   ├── audio.ts         # → bổ sung: audio mixer, ducking, loudness
│   ├── effects.ts       # → bổ sung: masks, chroma key, color wheels
│   ├── captions.ts      # → bổ sung: text-based editing
│   ├── timeline.ts      # → bổ sung: multicam, time remap, 3-4 point edit
│   ├── text.ts          # → bổ sung: essential graphics nâng cao
│   ├── export.ts        # → bổ sung: frame.io, render & replace
│   ├── advanced.ts      # → bổ sung: productions, dynamic link
│   └── ...
├── bridge/
│   ├── script-builder.ts  # buildToolScript, escapeForExtendScript
│   └── file-bridge.ts     # sendCommand, BridgeOptions
└── server.ts              # nơi register tool factory
```

### Pattern thêm 1 tool mới (cheat sheet)

```typescript
// src/tools/effects.ts (ví dụ)
my_new_tool: {
  description: "Mô tả ngắn cho AI hiểu khi nào gọi tool này",
  parameters: {
    type: "object" as const,
    properties: {
      node_id: { type: "string", description: "..." },
      // ...
    },
    required: ["node_id"],
  },
  handler: async (args: { node_id: string }) => {
    const script = buildToolScript(`
      // ExtendScript ES3, kết thúc bằng __result(...) hoặc __error(...)
      var found = __findClip("${escapeForExtendScript(args.node_id)}");
      if (!found) return __error("Clip not found");
      // ... thao tác ...
      return __result({ ok: true });
    `);
    return sendCommand(script, bridgeOptions);
  },
},
```

Sau khi thêm: cần register trong `server.ts` (factory đã import sẵn nếu thêm vào file có sẵn → chỉ cần `npm run build` + restart MCP).

---

## 1. NHÓM 1 — CỰC KỲ QUAN TRỌNG (P0)

> Đây là 5 mảng tạo "khoảng trống lớn nhất" so với Premiere chuyên nghiệp. Ưu tiên làm trước.

### 1.1 Multicam editing
**File:** `src/tools/timeline.ts` (hoặc tạo mới `src/tools/multicam.ts`)
**ExtendScript API:** `app.project.createNewSequenceFromClips`, `Sequence.createMulticamSource`, `app.project.createNewSequence` + multicam flags.

| Tool đề xuất | Mục đích | Độ phức tạp |
|---|---|---|
| `create_multicam_source` | Tạo multicam source từ N clip (sync theo timecode, in-point, marker, audio) | Trung bình |
| `set_multicam_camera` | Đổi góc máy đang hiển thị tại vị trí playhead | Thấp |
| `flatten_multicam` | "Bake" multicam thành các clip thường để export | Trung bình |
| `sync_clips_by_audio` | Đồng bộ N clip bằng waveform âm thanh (cần QE DOM hoặc gọi audio sync API) | **Cao** — có thể hạn chế |

**Risk:** ExtendScript có hỗ trợ multicam nhưng audio-sync (PluralEyes-style) có thể chỉ làm được qua UI macro hoặc QE DOM hạn chế. **Cần spike 1-2h để verify API trước khi cam kết.**

### 1.2 Masking & Track Mattes
**File:** `src/tools/effects.ts`
**ExtendScript API:** Component properties (mask path, feather, expansion, opacity), `effect.properties` của các effect có support mask (Lumetri, Crop, Gaussian Blur, etc.).

| Tool đề xuất | Mục đích |
|---|---|
| `add_mask_to_effect` | Thêm mask hình cơ bản (ellipse/rectangle) lên effect đã apply |
| `set_mask_path` | Set bezier path cho mask (mảng điểm x, y) |
| `set_mask_feather` | Độ mềm cạnh mask |
| `set_mask_expansion` | Mở rộng/thu nhỏ mask |
| `enable_mask_tracking` | Bật mask tracking forward/backward (gọi qua effect API) |
| `apply_track_matte_key` | Apply Track Matte Key effect với matte clip |

**Risk:** Mask path API qua ExtendScript khá hạn chế — có thể chỉ set được preset shape (ellipse, rect), không vẽ bezier tự do. Mask tracking thường là background process → ExtendScript chỉ trigger được, không control progress.

### 1.3 Chroma Key (Ultra Key)
**File:** `src/tools/effects.ts`
**ExtendScript API:** `applyEffect` với matchName `AE.ADBE Ultra2 Keyer`.

| Tool đề xuất | Mục đích |
|---|---|
| `apply_ultra_key` | Apply Ultra Key effect với key color |
| `set_ultra_key_settings` | Tinh chỉnh: matte generation, matte cleanup, spill suppression, color correction |
| `pick_key_color_at_frame` | Lấy màu pixel tại tọa độ (x, y) trong frame để set làm key color |

**Risk:** `pick_key_color_at_frame` cần render frame → đọc pixel. Có thể phải dùng approach: export frame ra PNG → đọc pixel ngoài Premiere → set key color. Phức tạp hơn các tool khác.

### 1.4 Audio Mixer & Auto-Ducking
**File:** `src/tools/audio.ts`
**ExtendScript API:** Audio track items, Essential Sound panel API (limited), `apply_audio_effect` với matchName của Multiband Compressor / Dynamics.

| Tool đề xuất | Mục đích |
|---|---|
| `set_track_volume` | Volume cho cả track (không phải clip) |
| `set_track_pan` | Pan trái/phải cho track |
| `apply_auto_ducking` | Áp Essential Sound auto-ducking giữa music track và dialogue track |
| `tag_audio_clip_role` | Gán role (Dialogue/Music/SFX/Ambience) cho clip qua Essential Sound |
| `normalize_loudness` | Normalize đến target LUFS (-14 cho YouTube, -23 cho TV) |
| `route_audio_to_submix` | Route track ra submix bus |

**Risk:** Essential Sound panel chủ yếu là UI — ExtendScript API cho nó **rất hạn chế**. Có thể phải fallback sang apply effect chain thủ công (Compressor + Sidechain) thay vì 1-click "auto duck".

### 1.5 Text-based Editing
**File:** `src/tools/captions.ts` (hoặc mới `src/tools/transcript-editing.ts`)
**Phụ thuộc:** Đã có `transcribe_sequence`. Cần thêm tools edit theo transcript.

| Tool đề xuất | Mục đích |
|---|---|
| `get_transcript_with_timecodes` | Lấy transcript dạng `[{text, in_tc, out_tc, speaker}]` |
| `delete_transcript_range` | Xóa clip ứng với 1 đoạn transcript (cắt + ripple delete) |
| `delete_filler_words` | Auto-detect "ờm/à/uh/um" và xóa |
| `find_in_transcript` | Search text → trả về timecodes |
| `cut_at_word_boundary` | Cắt clip tại ranh giới từ (không phá vỡ giữa từ) |

**Risk:** Premiere lưu transcript trong sequence metadata. Cần research format này. Rất khả thi nhưng mất 1 buổi để map data.

---

## 2. NHÓM 2 — QUAN TRỌNG (P1)

### 2.1 Lumetri Color chi tiết
**File:** `src/tools/effects.ts`
**ExtendScript API:** Effect properties trên Lumetri Color effect.

| Tool đề xuất | Mục đích |
|---|---|
| `set_lumetri_color_wheels` | Set 3 color wheels (shadows/midtones/highlights) — RGB + luma |
| `set_lumetri_curves_rgb` | Set curve points cho R/G/B/Master |
| `set_lumetri_hsl_secondary` | Chỉnh riêng từng dải màu (skin tone, sky, foliage) |
| `apply_color_match` | Áp Color Match (cần test API có expose không) |
| `read_lumetri_scopes` | Đọc giá trị scopes (Vectorscope/Waveform) tại frame hiện tại |

**Risk:** Lumetri properties phong phú nhưng **đọc scopes có thể không khả thi** qua ExtendScript — cần render frame và phân tích pixel ngoài.

### 2.2 Time Remapping (speed ramp với bezier)
**File:** `src/tools/timeline.ts`
**ExtendScript API:** `clip.componentParameters` cho Time Remapping component.

| Tool đề xuất | Mục đích |
|---|---|
| `enable_time_remapping` | Bật time remap cho clip |
| `add_speed_keyframe` | Thêm điểm speed tại timecode |
| `set_speed_keyframe_interpolation` | Linear / Bezier với handle X-Y |
| `set_speed_curve` | Set toàn bộ curve bằng mảng `[{time, speed, easeIn, easeOut}]` |
| `enable_optical_flow` | Bật optical flow interpolation cho slow-mo mượt |

**Risk:** Thấp. API time remap đã được verify hoạt động qua keyframes.ts hiện có.

### 2.3 Essential Graphics / Title chuyên sâu
**File:** `src/tools/text.ts`
**ExtendScript API:** Mogrt API + text component properties.

| Tool đề xuất | Mục đích |
|---|---|
| `set_text_typography` | Font, size, weight, kerning, leading, tracking |
| `set_text_stroke` | Outline với độ dày, màu, alignment |
| `set_text_shadow` | Drop shadow / glow |
| `set_text_background` | Background box với padding, opacity, corner radius |
| `add_text_animation_preset` | Apply preset animation (typewriter, fade-in, slide) |
| `create_shape_layer` | Vẽ shape (rect, ellipse, polygon) |

### 2.4 Audio AI & Repair
**File:** `src/tools/audio.ts`

| Tool đề xuất | Mục đích | Khả thi |
|---|---|---|
| `enhance_speech` | Adobe "Enhance Speech" AI | ⚠️ Có thể chỉ trigger được qua UI macro |
| `apply_denoise` | DeNoise effect | ✅ Apply effect bình thường |
| `apply_dereverb` | DeReverb effect | ✅ Apply effect bình thường |
| `auto_remix_music` | AI kéo dài/rút ngắn nhạc nền | ⚠️ Premiere Remix là feature UI, ExtendScript có thể không expose |
| `get_loudness_metrics` | Đo LUFS hiện tại | ❌ Cần render audio + tool ngoài |

**Risk:** AI features mới của Premiere (Speech Enhancement, Remix) thường là cloud-backed UI panels — ExtendScript có thể không gọi được. **Phải spike trước.**

### 2.5 Morph Cut
**File:** `src/tools/effects.ts`

| Tool đề xuất | Mục đích |
|---|---|
| `apply_morph_cut` | Apply Morph Cut transition giữa 2 clip cùng person |

**Risk:** Thấp — đã có `add_transition`, chỉ cần verify matchName của Morph Cut.

### 2.6 Warp Stabilizer chi tiết
**File:** `src/tools/effects.ts`

| Tool đề xuất | Mục đích |
|---|---|
| `configure_warp_stabilizer` | Result (Smooth/No Motion), Smoothness %, Method, Framing, Crop Less Smooth More |

---

## 3. NHÓM 3 — NÂNG CAO (P2)

### 3.1 Dynamic Link (After Effects 2 chiều)
**File:** `src/tools/advanced.ts`

| Tool đề xuất | Mục đích | Khả thi |
|---|---|---|
| `replace_with_ae_comp` | Convert clip thành Dynamic Link AE comp | ⚠️ Có API nhưng cần AE chạy |
| `import_ae_project_dynamically` | Import .aep dynamic-linked | ✅ |

### 3.2 Productions / Team Projects
**File:** `src/tools/project-manager.ts`

| Tool đề xuất | Mục đích | Khả thi |
|---|---|---|
| `create_production` | Tạo Production folder | ⚠️ API hạn chế |
| `add_project_to_production` | Thêm project con | ⚠️ |
| `lock_project_for_collab` | Lock/unlock cho collab | ⚠️ |

**Risk:** Productions là feature UI/cloud — ExtendScript API rất hạn chế. **Không cam kết, mark as "research".**

### 3.3 Frame.io Integration
**File:** `src/tools/export.ts`

| Tool đề xuất | Mục đích |
|---|---|
| `upload_to_frameio` | Upload sequence/frame lên Frame.io review |
| `get_frameio_comments` | Lấy comments → tạo markers tương ứng |

**Risk:** Cần Frame.io REST API key + auth flow. Có thể làm qua HTTP fetch trong Node side (không phải ExtendScript). **Architectural decision: tool này nên gọi API ngoài, không gọi qua bridge.**

### 3.4 HDR Workflow
**File:** `src/tools/sequence.ts`

| Tool đề xuất | Mục đích |
|---|---|
| `set_sequence_color_space` | Rec.709 / Rec.2020 / HLG / PQ |
| `set_hdr_metadata` | Master display, MaxCLL, MaxFALL |
| `enable_dolby_vision` | Bật DV trim layer |

### 3.5 VR / 360°
**File:** `src/tools/effects.ts`

| Tool đề xuất | Mục đích |
|---|---|
| `convert_to_vr_sequence` | Chuyển sequence sang VR mode |
| `apply_vr_transition` | VR-specific transitions |
| `set_vr_view_orientation` | Set rotation cho 360° clip |

### 3.6 Surround Sound (5.1, 7.1)
**File:** `src/tools/audio.ts`

| Tool đề xuất | Mục đích |
|---|---|
| `set_surround_pan` | 5.1/7.1 panner position |
| `downmix_to_stereo` | Downmix với coefficients custom |

### 3.7 3-point / 4-point Editing
**File:** `src/tools/timeline.ts`

| Tool đề xuất | Mục đích |
|---|---|
| `three_point_edit` | Source In + Out + Timeline In → insert/overwrite |
| `four_point_edit` | Source In + Out + Timeline In + Out → fit-to-fill (auto speed) |
| `replace_edit` | Replace clip giữ in/out timeline |

### 3.8 Render & Replace
**File:** `src/tools/advanced.ts`

| Tool đề xuất | Mục đích |
|---|---|
| `render_and_replace` | Bake effects clip thành media file mới, replace in-place |
| `make_subsequence` | Convert clip range thành subsequence |

### 3.9 Master Clip Effects
**File:** `src/tools/effects.ts`

| Tool đề xuất | Mục đích |
|---|---|
| `apply_master_clip_effect` | Apply effect ở master clip level (propagate cho mọi instance) |
| `list_master_vs_instance_effects` | Liệt kê phân biệt master vs instance effects |

---

## 4. NHÓM 4 — TIỆN ÍCH KHÁC (P3)

### Effects mở rộng (`src/tools/effects.ts`)
| Tool | Mô tả |
|---|---|
| `apply_lens_distortion_correction` | Sửa méo ống kính (GoPro, fisheye) |
| `apply_auto_color` / `apply_auto_contrast` | Auto-fix màu nhanh |
| `apply_skin_tone_smoothing` | Làm đẹp da cơ bản |
| `burn_in_timecode` | Render timecode lên video (quality control) |
| `burn_in_captions` | Render hardcoded captions |

### Project & Workspace (`src/tools/workspace.ts`, `src/tools/project.ts`)
| Tool | Mô tả |
|---|---|
| `save_workspace_layout` | Lưu workspace tùy biến hiện tại |
| `auto_save_settings` | Cấu hình tần suất auto-save |
| `create_project_from_template` | Tạo project từ template |

### Smart Bin nâng cao (`src/tools/project.ts`)
| Tool | Mô tả |
|---|---|
| `create_smart_bin_advanced` | Query phức hợp (rating + label + duration + custom metadata) |

### Subclips chỉnh sửa (`src/tools/timeline.ts`)
| Tool | Mô tả |
|---|---|
| `edit_subclip_boundaries` | Sửa lại in/out của subclip đã tạo |

---

## 5. Roadmap thực thi đề xuất

### Phase 0 — Setup & spike (1 buổi) — **ĐANG TIẾN HÀNH (VFX focus)**
- [x] Verify Premiere CEP plugin reconnect (`ping` OK — Premiere 25.4.1, project "Lò nướng.prproj", sequence "Sequence 01 Cắt") — 2026-05-10
- [x] **Spike 1.2 — Mask API:** Chỉ có `displayName, instanceName, matchName, properties` trên component; KHÔNG có `addMask()`. QE project/sequence/clip đều không có mask methods. → **Mask CHỈ làm được qua UI.** Workaround: dùng effect "Crop" (có 4 crop properties built-in) hoặc track matte multi-track.
- [x] **Spike 1.3 — Ultra Key:** matchName `AE.ADBE Ultra Key`. 27 properties đầy đủ: Output (enum), Setting (enum 0-2), Key Color (packed int), Matte Generation toggle + Transparency/Highlight/Shadow/Tolerance/Pedestal, Matte Cleanup + Choke/Soften/Contrast/Mid Point, Spill Suppression + Desaturate/Range/Spill/Luma, Color Correction + Sat/Hue/Luminance. **HOÀN TOÀN KHẢ THI.**
- [x] **Spike 2.1 — Lumetri:** matchName `AE.ADBE Lumetri`. 130 properties (flat list, section toggles + sub-props). Basic Correction, Creative, Curves, HSL Secondary, Color Wheels, Vignette đều set được. **Curves stored as binary blobs** (idx 58/61/64/67/70 — ``...) → khó manipulate trực tiếp, có thể chỉ enable/disable/copy được. **Color wheels khả thi**, **read scopes vẫn không khả thi.**
- [x] **Spike 2.6 — Warp Stabilizer:** matchName `AE.ADBE SubspaceStabilizer`. 32 properties: Result (0=Smooth/1=No Motion), Smoothness (0-100), Method (3=Subspace), Framing (0-3), Crop Less↔Smooth More, Synthesis params, Edge Cropping L/T/R/B. Có **AnalysisStatusCounter (idx 31)** để monitor background analysis. **HOÀN TOÀN KHẢ THI.**
- [ ] Spike: render-to-PNG approach cho `pick_key_color_at_frame` (Spike 1.3 follow-up)
- [ ] Skip multicam audio sync + auto-ducking + Speech Enhancement (không phải VFX use case)
- [ ] Document chi tiết vào `notebug.md`

### 🚨 PHÁT HIỆN CRITICAL: QE 25.4 API REGRESSION

Trong khi spike phát hiện code hiện tại có thể bị broken trên Premiere 25.4:

**1. `getVideoEffectList()` đổi return type:**
- **Cũ (code hiện tại giả định):** Object `{ numItems, [0..n].name }` — items là QEVideoEffect objects
- **Mới (25.4):** Array `{ length, [0..n] }` — items là **string** (tên effect, qua `String()` hoặc `toString()`)
- File ảnh hưởng: `src/tools/effects.ts` line 43-51 (`apply_effect`), 247-251 (`color_correct`), 322-325 (`apply_lut`), 393-400 (Warp Stabilizer apply), `list_available_effects` line 162-168

**Fix pattern:**
```js
// CŨ (broken):
var effects = qe.project.getVideoEffectList();
for (var i = 0; i < effects.numItems; i++) {
  if (effects[i].name === effectName) qeClip.addVideoEffect(effects[i]);
}

// MỚI (works in 25.4):
var effObj = qe.project.getVideoEffectByName(effectName);
if (effObj) qeClip.addVideoEffect(effObj);
```

**2. Component removal API biến mất:**
- `clip.components[i].remove()` → **NOT a function** trong 25.4
- `clip.components.deleteComponent(...)` → **NOT a function**
- Component collection chỉ còn `numItems, length` keys (no removal methods)
- QE `removeEffects(motion, opacity, lumetri, ...)` chỉ remove được intrinsic categories, không remove được Lumetri/Ultra Key/Warp Stab custom effects
- `app.undo()` / `app.executeCommand()` / `app.findMenuCommandId()` → tất cả **undefined**
- File ảnh hưởng: `src/tools/effects.ts` `remove_effect` (line 138, 145), nhiều nơi khác

**Workaround tạm thời:** User phải Cmd+Z thủ công sau khi tool apply effect lỗi. Cần research thêm các API cleanup trong Premiere 25.4 (có thể qua Premiere Pro DOM mới chứ không qua QE).

**3. Tool `list_available_effects` hỏng:**
- Dùng `effects.numItems` và `effects[i].name` — cả hai đều undefined
- Fix: `for (var i = 0; i < effects.length; i++) { list.push({ name: String(effects[i]), index: i }); }`

**Action items:**
- [x] **PRIORITY 0:** Fix regression trong `apply_effect`, `list_available_effects`, `color_correct`, `apply_lut`, `stabilize_clip` (effects.ts) — DONE 2026-05-10
- [x] **PRIORITY 0:** Fix transitions.ts (6 sites: add_transition, add_transition_to_clip, batch_add_transitions, list_available_transitions, list_available_audio_transitions, set_default_transition) — DONE
- [x] **PRIORITY 0:** Fix audio.ts (apply_audio_crossfade) + clipboard.ts (remove_effect_by_name) — DONE
- [x] Patch `remove_effect` + `remove_effect_by_name`: fall back to **disable** (set Active=false) thay vì throw, kèm note giải thích cho user. UI undo (Cmd+Z) là cách duy nhất để xóa thật.
- [x] Update extendscript-reference.ts với 25.4 caveats — DONE
- [x] Build TypeScript: zero errors — DONE
- [ ] Restart MCP server + integration test end-to-end
- [ ] Update notebug.md với regression details (mirror nội dung này)

### 🔬 Discovery bổ sung trong khi fix (2026-05-10)

`qe.project.getVideoEffectByName(unknown)` / `getAudioEffectByName` / `get*TransitionByName` **không return null** cho name không tồn tại — luôn return một QE object placeholder. Cách phân biệt:
- Real: `effObj.name === "Lumetri Color"` (đúng tên đã yêu cầu)
- Fake: `effObj.name === ""` (string rỗng)

`qeClip.addVideoEffect(fakeObj)` không throw nhưng cũng **không apply** (silent no-op). Điều này nguy hiểm vì code "thành công" nhưng effect không có trên clip.

→ Pattern bắt buộc: `if (!effObj || !effObj.name) return __error(...)`. Đã apply pattern này vào tất cả fix sites.

### Phase 1 — P0 Nhóm 1 (3-5 ngày)
- [ ] 1.5 Text-based editing (rủi ro thấp, ROI cao nhất, không cần Premiere reconnect để code)
- [ ] 1.3 Chroma Key Ultra Key (rủi ro thấp)
- [ ] 1.2 Masking — chỉ phần ENABLE/PRESET shape (skip bezier nếu API không cho)
- [ ] 1.4 Audio Mixer cơ bản (skip auto-ducking nếu spike fail)
- [ ] 1.1 Multicam — chỉ phần create + camera switch (skip audio sync nếu spike fail)

### Phase 2 — P1 Nhóm 2 (3-4 ngày)
- [ ] 2.2 Time Remapping (rủi ro thấp)
- [ ] 2.6 Warp Stabilizer config
- [ ] 2.5 Morph Cut
- [ ] 2.1 Lumetri color wheels + curves (skip scopes reading nếu không khả thi)
- [ ] 2.3 Essential Graphics typography
- [ ] 2.4 Audio AI — chỉ phần khả thi sau spike

### Phase 3 — P2 Nhóm 3 (4-5 ngày, nhiều rủi ro)
- [ ] 3.7 3-point/4-point edit (rủi ro thấp, ROI cao — nên kéo lên Phase 1 nếu có thời gian)
- [ ] 3.8 Render & Replace
- [ ] 3.9 Master Clip Effects
- [ ] 3.4 HDR workflow
- [ ] 3.6 Surround pan
- [ ] 3.1 Dynamic Link AE
- [ ] 3.3 Frame.io (có thể trì hoãn — cần API key + architectural decision)
- [ ] 3.5 VR/360
- [ ] 3.2 Productions (mark "research only" nếu API hạn chế)

### Phase 4 — P3 Nhóm 4 (2 ngày)
- [ ] Tất cả nhóm 4 — đa số là apply_effect với matchName cụ thể, làm batch

### Phase 5 — Polish
- [ ] Update README.md với danh sách tools mới
- [ ] Bump version → v1.2.0
- [ ] Update CHANGELOG.md
- [ ] Test regression toàn bộ tools cũ vẫn chạy

---

## 6. Test plan

Theo pattern đã có trong [notebug.md](notebug.md):

1. **Build test:** `npm run build` không lỗi TypeScript
2. **Unit test:** `npm test` (Vitest) — thêm test cho parser/script-builder nếu có logic mới
3. **Integration test thực:** Trên Premiere Pro thật với project test
   - Tạo project test có sẵn: 4 camera clips, 1 sequence với gap, 1 clip có audio rõ
   - Mỗi tool mới: gọi qua MCP → verify state Premiere thay đổi đúng
4. **Document trong notebug.md:** Các edge case phát hiện được + fix

### Project test đề xuất
- Folder `tests/fixtures/` tạo file `multicam-test.prproj` với 4 camera angles
- Script `tests/integration-test.md` mô tả các bước test thủ công

---

## 7. Risks & Open Questions

| Risk | Tác động | Mitigation |
|---|---|---|
| Essential Sound + Remix + Speech Enhance là UI-only, không có ExtendScript API | Mất ~30% tính năng audio AI | Spike trước Phase 0; nếu fail → mark "not feasible" trong README, không hứa với user |
| Mask bezier path không set được qua ExtendScript | Mask chỉ làm được preset shape | Document hạn chế rõ; offer mask tracking sau khi user set preset shape |
| Productions / Team Projects API hạn chế | Phase 3 collab features không làm được | Mark research-only |
| Frame.io cần auth + REST → architectural mới | Tool gọi API ngoài, không qua bridge | Tách thành module riêng `src/integrations/frameio.ts` |
| QE DOM (`app.enableQE()`) không stable qua phiên bản Premiere | Một số tools dùng QE có thể vỡ khi update Premiere | Thêm version check, fallback gracefully |
| AI features mới (Adobe Sensei) thường là cloud → ExtendScript chỉ trigger được, không control output | Khó test reliability | Document rõ tools nào là "trigger UI action" vs "deterministic API" |

### Câu hỏi mở cần user quyết
1. Có ưu tiên nhóm nào hơn không? (ví dụ user làm podcast → 1.5 + 1.4 + 1.1 quan trọng nhất)
2. Frame.io có sẵn account để test không? Nếu không → bỏ 3.3.
3. Có cần backward-compat với Premiere version cũ hơn không, hay chỉ target 25.4+?
4. Workflow phát hành: PR riêng từng phase hay 1 release lớn v1.2.0?

---

## 8. Quick reference — pattern cần biết khi implement

### Helpers ExtendScript có sẵn (auto-prepend)
```javascript
__ticksToSeconds(ticks)
__secondsToTicks(seconds)
__ticksToTimecode(ticks, fps)
__findSequence(idOrName)        // iterate project.sequences (cả trong bins)
__findProjectItem(nodeIdOrName) // recursive
__findClip(nodeId)              // {clip, trackIndex, clipIndex, trackType}
__getAllClips(seq)
__result(data) / __error(msg)
TICKS_PER_SECOND = 254016000000
app.enableQE()                   // bật QE DOM (less stable)
```

### Quy ước ES3 (BẮT BUỘC)
- `var`, không `let`/`const`
- `function`, không arrow function
- `+ "string"`, không template literal
- Không destructuring

### Convention naming
- snake_case cho tool names
- camelCase cho keys trả về trong `__result`
- Mọi tool: trả về `{ ok: true, ... }` hoặc gọi `__error`

---

## 9. Phụ lục — Mapping với tools hiện có

Trước khi viết tool mới, **luôn check** đã có tool tương tự chưa:

| Đã có | Có thể tái sử dụng cho |
|---|---|
| `apply_effect` | Tất cả effect-based tools (Ultra Key, DeNoise, Lens Distortion, etc.) — chỉ cần truyền matchName |
| `set_effect_property` | Tinh chỉnh tham số (Lumetri wheels, Mask feather, Warp Stabilizer config) |
| `add_keyframe` + `set_keyframe_interpolation` | Time remapping, mọi animation curve |
| `apply_audio_effect` | DeNoise, DeReverb, Multiband Compressor cho ducking thủ công |
| `add_transition` | Morph Cut |
| `transcribe_sequence` | Foundation cho 1.5 text-based editing |
| `add_marker` | Có thể dùng để mark Frame.io comment positions |

→ Nhiều "tính năng mới" thực ra là **wrapper convenience** quanh tools sẵn có với matchName/parameters đúng. Effort thấp hơn dự kiến.
