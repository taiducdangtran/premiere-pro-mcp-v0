# Plan: Bổ sung tính năng video editor chuyên nghiệp cho `premiere-pro-mcp`

> **Tạo ngày:** 2026-05-10
> **Phiên bản hiện tại:** v1.1.1 (269 tools)
> **Mục tiêu:** Thêm các tính năng còn thiếu so với editor chuyên nghiệp, chia làm 4 nhóm ưu tiên.

---

## 0. Bối cảnh & Trạng thái hiện tại

### Trạng thái môi trường khi lập plan
- ⚠️ **Premiere Pro CEP plugin chưa kết nối** (ping/get_premiere_state đều timeout 2026-05-10).
  - Cần chạy lại Premiere + bật CEP panel trước khi test thực tế.
  - Kiểm tra: `bash scripts/install-cep.sh` đã chạy chưa, plugin có ở `~/Library/Application Support/Adobe/CEP/extensions/` chưa.
- ✅ Source code MCP đầy đủ, build hệ thống TypeScript đã hoạt động (đã verify qua các fix gần đây trong [notebug.md](notebug.md)).

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

### Phase 0 — Setup & spike (1 buổi)
- [ ] Verify Premiere CEP plugin reconnect được (`ping` thành công)
- [ ] Spike 4 API rủi ro cao bằng `execute_extendscript`:
  - [ ] Multicam audio sync
  - [ ] Mask path API (set bezier vs preset shape)
  - [ ] Essential Sound auto-ducking
  - [ ] Speech Enhancement / Remix (AI features mới)
- [ ] Document kết quả spike vào `notebug.md` (giống workflow đã có)

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
