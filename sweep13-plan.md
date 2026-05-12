# Sweep #13 — Test plan cho 31 non-effect tool chưa live-test

**Mục tiêu:** Lấp lỗ hổng live-test cho 31 tool non-effect chưa từng xuất hiện trong `bug.md` / `notebug.md`. Phần lớn là core workflow (export, import, sequence settings, stabilizer, edit ops). 95 `apply_*` effect wrapper còn lại để sweep #14 trở đi.

**Setup chung cho mọi nhóm:**
- Premiere 25.4.1, project test "Lò nướng.prproj" hoặc bất kỳ project có ít nhất 1 sequence active + 3+ clip V1
- 1 still image trong project panel (cho freeze_frame check)
- Output folder ghi được: `/Users/tester/sweep13_out/` (tạo trước)
- Source project có 2+ sequence để test `import_sequences*`: `/Users/tester/sweep13_src.prproj`

**Cách ghi kết quả:** mỗi tool dán cờ ✅ PASS / 🔴 FAIL / 🟡 PARTIAL kèm output JSON tóm tắt (1-2 dòng). FAIL thì copy error message đầy đủ.

---

## Nhóm A — Export & encode (5 tool)

### A1. `get_export_file_extension`
```json
{ "preset_path": "/Applications/Adobe Premiere Pro 2025/Settings/EncoderPresets/.../H.264_Match_Source.epr" }
```
**PASS criteria:** return `{ extension: "mp4" }` (hoặc tương ứng preset).
**Edge:** preset path không tồn tại → expect error rõ ràng.

### A2. `export_sequence`
```json
{ "output_path": "/Users/tester/sweep13_out/sequence_export.mp4", "work_area_only": false }
```
**PASS criteria:** `started: true`, file xuất hiện trong AME queue. **Không** chặn engine.
**Edge:** thư mục output không tồn tại → expect error.

### A3. `export_omf`
```json
{ "output_path": "/Users/tester/sweep13_out/seq.omf", "sample_rate": 48000, "audio_file_format": 1 }
```
**PASS criteria:** file `.omf` được tạo, không có dialog block engine.
**Cẩn thận:** Adobe có thể bật dialog "Audio settings" → nếu engine treo, tool bị Bug #56 pattern, cần `__withDialogsSuppressed` wrapper.

### A4. `start_batch_encode`
*(chạy sau A2 + A3 để queue có item)*
```json
{}
```
**PASS criteria:** AME bắt đầu render queue, return `{ started: true }`.

### A5. `set_transcode_on_ingest`
```json
{ "enabled": true }
```
Sau đó verify trong Project Settings > Ingest. Đảo `false` để revert.

---

## Nhóm B — Import sequences (2 tool)

### B1. `import_sequences`
```json
{ "project_path": "/Users/tester/sweep13_src.prproj" }
```
**PASS criteria:** số `numSequences` của project hiện tại tăng = số sequence trong source.
**Edge:** source không tồn tại → error rõ. Source bị lock → error rõ.

### B2. `import_sequences_from_project`
```json
{ "project_path": "/Users/tester/sweep13_src.prproj", "sequence_ids": ["Sequence 01"] }
```
**PASS criteria:** chỉ 1 sequence được import. So sánh với B1 — kiểm hai tool có trùng functionality hay khác signature.
**Câu hỏi cần trả lời:** Đây có phải là 2 tool khác nhau hay duplicate? Nếu duplicate → đề xuất hợp nhất.

---

## Nhóm C — Generate / synthetic media (2 tool)

### C1. `create_bars_and_tone`
```json
{ "width": 1920, "height": 1080, "name": "TestBars" }
```
**PASS criteria:** project panel có item mới tên "TestBars", type = footage.
**Edge:** call lần 2 với cùng name → dup or rename?

### C2. `add_universal_counting_leader`
```json
{}
```
**PASS criteria:** project panel có "Universal Counting Leader" 8s. Uses QE — nếu QE dialog spawn → fail giống Bug #37.

---

## Nhóm D — Sequence settings (4 tool)

### D1. `set_sequence_field_type`
```json
{ "field_type": 0 }
```
Sau đó verify qua `get_sequence_settings`. Test cả 1 và 2.

### D2. `set_sequence_display_format`
```json
{ "video_display_format": 3, "audio_display_format": 0 }
```
Verify timecode panel hiển thị "29.97 Non-drop".

### D3. `set_override_frame_rate` *(media item, không phải sequence)*
```json
{ "item_id": "<image_seq_or_clip_nodeId>", "frame_rate": 23.976 }
```
**PASS criteria:** `get_full_clip_info` show frameRate = 23.976. Test trên cả image sequence và normal video.

### D4. `set_override_pixel_aspect_ratio`
```json
{ "item_id": "<clip_nodeId>", "numerator": 1, "denominator": 1 }
```
**PASS criteria:** PAR = 1.0 sau setting.

---

## Nhóm E — Burn-in & leader (2 tool)

### E1. `burn_in_timecode`
```json
{ "node_id": "<V1c0_nodeId>", "opacity": 80 }
```
**PASS criteria:** clip có effect "Timecode" + opacity = 80. Verify qua `list_clip_effects`.

### E2. `burn_in_metadata`
```json
{ "node_id": "<V1c0_nodeId>" }
```
**PASS criteria:** effect "Metadata & Timecode Burn-in" được apply. Verify visible trong Source/Program monitor.

---

## Nhóm F — Warp Stabilizer (2 tool)

### F1. `stabilize_clip`
```json
{ "node_id": "<V1c0_nodeId>", "smoothness": 50, "method": "Subspace Warp" }
```
**PASS criteria:** effect "Warp Stabilizer" được add. **Lưu ý:** Premiere bắt đầu analyze phase (background) → tool có thể return ngay hoặc treo. Document behavior.

### F2. `configure_warp_stabilizer`
*(chạy sau F1, đợi analyze xong ~30s-1min)*
```json
{ "node_id": "<V1c0_nodeId>", "smoothness": 75, "framing": "Stabilize, Crop, Auto-scale", "result": "Smooth Motion" }
```
**PASS criteria:** properties cập nhật. Trả về `AnalysisStatusCount` (theo desc).

---

## Nhóm G — Timeline edit ops (5 tool)

### G1. `three_point_edit`
*(prep: open 1 clip trong Source Monitor)*
```json
{ "source_item_id": "<media_nodeId>", "source_in_seconds": 0, "source_out_seconds": 3, "timeline_in_seconds": 10, "edit_type": "overwrite", "video_track_index": 1 }
```
**PASS criteria:** V2@10s có clip 3s từ source. So sánh với `overwrite_clip` / `insert_from_source` xem có duplicate functionality không.

### G2. `move_clip_to_track`
```json
{ "node_id": "<V1c0_nodeId>", "target_track_index": 2 }
```
**PASS criteria:** clip nhảy từ V1 lên V3. **Cảnh báo:** QE-based — có thể fail nếu V3 không tồn tại (cần `add_track` trước).

### G3. `batch_enable_disable`
```json
{ "enabled": false, "target": "track", "track_type": "video", "track_index": 0 }
```
**PASS criteria:** toàn bộ clip V1 bị disable (greyed out). Đảo `enabled: true` để revert.

### G4. `rename_project_item`
```json
{ "item_id": "<bin_or_clip_nodeId>", "new_name": "TEST_RENAMED" }
```
**PASS criteria:** name update trong project panel. Test cả bin và clip.

### G5. `freeze_frame`
```json
{ "time_seconds": 5, "output_path": "/Users/tester/sweep13_out/freeze.png", "duration_seconds": 2 }
```
**PASS criteria:** file PNG xuất ra, được import lại làm still 2s. Edge: time vượt sequence length.

---

## Nhóm H — Selection lift/extract (2 tool)

### H1. `lift_selection`
*(prep: set sequence in/out điểm bằng `set_sequence_in_out_points`, vd 5s-10s)*
```json
{}
```
**PASS criteria:** content giữa in/out bị xoá nhưng **gap được giữ lại**.

### H2. `extract_selection`
*(prep: tương tự H1)*
```json
{}
```
**PASS criteria:** content xoá VÀ gap được close. So sánh với `ripple_delete`.

---

## Nhóm I — Media interpretation (3 tool)

### I1. `set_offline`
```json
{ "item_id": "<clip_nodeId>" }
```
**PASS criteria:** clip chuyển sang offline (icon đỏ trong project panel). Verify qua `get_offline_media`.

### I2. `set_footage_interpretation`
```json
{ "item_id": "<clip_nodeId>", "frame_rate": 24, "pixel_aspect_ratio": 1.0 }
```
**PASS criteria:** properties áp dụng. So sánh với D3/D4 — có thể overlap.

### I3. `set_project_scratch_disk`
```json
{ "captured_video": "/Users/tester/scratch/video", "video_previews": "/Users/tester/scratch/previews" }
```
**PASS criteria:** Project Settings > Scratch Disks update đúng path. Verify qua `get_project_scratch_disks`.

---

## Nhóm J — Playhead navigation (3 tool)

*(prep: set sequence in@5s, out@15s, đặt playhead random)*

### J1. `go_to_start`
```json
{}
```
**PASS:** `get_playhead_position` = 0.

### J2. `go_to_in_point`
```json
{}
```
**PASS:** playhead = 5.0s.

### J3. `go_to_out_point`
```json
{}
```
**PASS:** playhead = 15.0s.

**Edge cho nhóm J:** sequence không có in/out → expect error hoặc no-op? Document behavior.

---

## 📊 Tóm tắt expected output

| Nhóm | Tool | Risk level | Notes |
|------|-----:|------------|-------|
| A. Export | 5 | 🟠 medium | AME dependency, dialog risk |
| B. Import | 2 | 🟡 low | có thể dup |
| C. Generate | 2 | 🟠 medium | QE Color Picker risk (Bug #37 pattern) |
| D. Sequence settings | 4 | 🟢 low | enum validation |
| E. Burn-in | 2 | 🟢 low | effect apply path đã test trước |
| F. Stabilizer | 2 | 🔴 high | async analyze, có thể treo bridge |
| G. Edit ops | 5 | 🟠 medium | QE-based + cần track setup |
| H. Lift/Extract | 2 | 🟡 low | cần in/out set trước |
| I. Media interp | 3 | 🟢 low | check overlap D3/D4 |
| J. Playhead | 3 | 🟢 low | trivial |
| **Total** | **31** | | |

---

## 🎯 Sweep #13 deliverable

Sau khi chạy xong, tester báo lại theo template:

```
| Nhóm | Tool | Status | Notes |
|------|------|:------:|-------|
| A1 | get_export_file_extension | ✅ | returned "mp4" |
| A2 | export_sequence | 🔴 | error: "AME not running" — cần khởi AME trước |
...
```

Bug rõ ràng → đẩy vào `bug.md` sweep #13 section.
Confirmed PASS → log vào `notebug.md` để khỏi test lại.
Behavior surprise (dup tool, default khác doc) → đánh 🟡 PARTIAL và note rõ — dev sẽ quyết định fix/document/deprecate.
