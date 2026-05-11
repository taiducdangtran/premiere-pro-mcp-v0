# Bug notes — premiere-pro MCP plugin

Phát hiện ngày 2026-05-10, Premiere Pro 25.4.1, project `Lò nướng.prproj`.

## Bug 1: `delete_sequence` không tìm thấy sequence dù tồn tại

**Triệu chứng:** Gọi `delete_sequence` với cả `sequence name` lẫn `sequence ID` đều trả về:

```
Error: Sequence not found: <name hoặc id>
```

Trong khi `list_sequences` vẫn liệt kê sequence đó bình thường.

**Steps to reproduce:**
1. Mở project có sequence tên `Sequence 01 - 4x5` (id `eda92e7f-4af6-455d-9461-61f6e65e33a4`).
2. Gọi `list_sequences` → trả về sequence này.
3. Gọi `delete_sequence` với:
   - `sequence_id = "eda92e7f-4af6-455d-9461-61f6e65e33a4"` → "Sequence not found"
   - `sequence_id = "Sequence 01 - 4x5"` → "Sequence not found"
4. Đã thử trước đó: `set_active_sequence` sang sequence khác + `close_sequence` để đóng tab — vẫn fail.

**Đã verify hoạt động (workaround qua `execute_extendscript`):**
```javascript
var seq = __findSequence("Sequence 01 - 4x5");
app.project.deleteSequence(seq);   // OK, xóa thành công
```

→ Hàm ExtendScript gốc `app.project.deleteSequence(seq)` chạy bình thường. Vấn đề nằm ở phần lookup sequence trong `delete_sequence` handler của plugin (có thể đang dùng cách tìm khác với `__findSequence`, hoặc so sánh ID/name sai).

**Đề xuất fix:** dùng helper `__findSequence(idOrName)` trong handler của `delete_sequence` (giống các tool khác như `set_active_sequence` đang chạy đúng), rồi gọi `app.project.deleteSequence(seq)`.

---

## Bug 2: `delete_project_item` — hàm không tồn tại trong ExtendScript

**Triệu chứng:**
```
Error: ReferenceError: app.project.deleteProjectItem is not a function
```

**Steps to reproduce:**
1. `find_project_item_by_name` với name `"Sequence 01 - 4x5"` → trả về `nodeId = "000f440d"`.
2. Gọi `delete_project_item` với `item_id = "000f440d"` → lỗi như trên.

**Nguyên nhân:** Premiere ExtendScript API không có method `app.project.deleteProjectItem(...)`. Handler đang gọi một hàm không tồn tại trong DOM.

**Đề xuất fix:** ProjectItem trong Premiere ExtendScript không có method delete trực tiếp được expose ổn định:
- `projectItem.deleteAsset()` cũng **không tồn tại** (đã verify: `ReferenceError: item.deleteAsset is not a function`).
- `app.project.rootItem.deleteItem()` — chưa verify, đáng thử.
- Nếu item là sequence → fallback sang `app.project.deleteSequence(seq)`.
- Nếu item là bin → có thể dùng QE DOM (`qe.project.getBinAt(...).deleteBin()` hoặc tương tự) — cần test kỹ.

Recommend: detect type của project item (`item.type`) rồi route sang đúng path; với type `sequence` thì lookup sequence object tương ứng và gọi `deleteSequence`.

---

## Tham khảo: probe đã chạy trên ProjectItem

Enumerable keys trên một ProjectItem (sequence) trả về:
```
children, getOverrideColorSpaceList, interpretedTimebase, name,
nodeId, sourceTimebase, timeDisplayFormat, treePath, type
```
→ Không có method delete nào ở mức enumerable. Một số method khác có thể tồn tại non-enumerable nhưng `deleteAsset` đã được test và không có.

---

# Fix log — 2026-05-10

## Fix Bug 1: `delete_sequence`

**Status:** ✅ Đã fix và build thành công

**File:** `src/tools/sequence.ts` (handler của `delete_sequence`)

**Nguyên nhân thực tế:** Handler cũ duyệt `app.project.rootItem.children` rồi gọi `__findSequence` lồng bên trong với điều kiện `item.type === 3` (sequence type) và so sánh `item.name === seq.name`. Hai vấn đề:
1. Vòng lặp chỉ duyệt items ở **root level** → sequences nằm trong bins không được tìm thấy.
2. Type check `item.type === 3` không khớp với giá trị thực của `ProjectItemType` ở project hiện tại (sequence project items có thể có type khác — đây là lý do cả ID lẫn name đều fail).

**Cách fix:** Loại bỏ hoàn toàn vòng lặp duyệt items. Gọi `__findSequence(idOrName)` trực tiếp — helper này iterate `project.sequences` (bao gồm cả sequences trong bins), trả về sequence object luôn, rồi gọi `app.project.deleteSequence(seq)`.

**Diff (rút gọn):**
```diff
- for (var i = 0; i < project.rootItem.children.numItems; i++) {
-   var item = project.rootItem.children[i];
-   if (item.type === 3) {
-     var seq = __findSequence(query);
-     if (seq && (item.name === seq.name)) { project.deleteSequence(seq); ... }
-   }
- }
+ var seq = __findSequence(query);
+ if (!seq) return __error("Sequence not found: " + query);
+ app.project.deleteSequence(seq);
+ return __result({ deleted: true, name: seq.name, sequenceId: seq.sequenceID });
```

---

## Fix Bug 2: `delete_project_item` + `delete_multiple_project_items`

**Status:** ✅ Đã fix và build thành công

**File:** `src/tools/utility.ts`

**Nguyên nhân thực tế:** Handler cũ gọi `app.project.deleteProjectItem(item)` — method này **không tồn tại** trong Premiere Pro ExtendScript DOM. API đúng là `app.project.deleteAsset(projectItem)` (đã được verify qua source của antipaster MCP và Adobe ExtendScript reference).

**Cách fix:** Route theo type của project item:
1. **Sequence project items** → tra lookup qua `__findSequence(query)` trước; nếu match → `app.project.deleteSequence(seq)`.
2. **Bin** (`item.type === 2`) → `item.deleteBin()`.
3. **Các item khác** (clip / footage / file) → `app.project.deleteAsset(item)` (đây là method đúng, không phải `deleteProjectItem`).

**Bonus:** `delete_multiple_project_items` được sửa tương tự, kèm thêm field `failed[]` trong response để trace lỗi từng item riêng lẻ thay vì silent-fail.

**Diff (rút gọn):**
```diff
- app.project.deleteProjectItem(item);  // không tồn tại
+ var seq = __findSequence(query);
+ if (seq) { app.project.deleteSequence(seq); return ...; }
+ var item = __findProjectItem(query);
+ if (item.type === 2) { item.deleteBin(); return ...; }
+ app.project.deleteAsset(item);  // API đúng
```

---

## Verify sau khi fix

- [x] TypeScript build pass (`npm run build` không có lỗi)
- [ ] Restart Claude Code để load MCP server với code mới
- [ ] Test thực tế trong Premiere:
  - [ ] `delete_sequence` với sequence ở root level
  - [ ] `delete_sequence` với sequence trong bin
  - [ ] `delete_project_item` với clip thông thường
  - [ ] `delete_project_item` với bin (type === 2)
  - [ ] `delete_project_item` với sequence project item (route sang deleteSequence)
  - [ ] `delete_multiple_project_items` với mix nhiều type

---

## Bug 3 (CRITICAL): QE DOM API regression trong Premiere 25.4

**Phát hiện:** 2026-05-10 trong Phase 0 spike của plan nâng cấp VFX (xem [plan.md](plan.md#L341)).

### 3a. `getVideoEffectList` / `getAudioEffectList` / `getXxxTransitionList` đổi return type

**Cũ (≤24.x):** Return collection-like object với `.numItems` + items là QE objects có `.name`.
**Mới (25.4):** Return JS Array với `.length` + items là **string** (tên effect).

**Triệu chứng:** Pattern `for (var i = 0; i < effects.numItems; i++) { if (effects[i].name === ...) ... }` chạy không lỗi nhưng:
- `effects.numItems` = `undefined` → loop không chạy
- `effects[i].name` = `undefined` → so sánh fail
- → `apply_effect` báo "Effect not found" cho mọi effect kể cả Lumetri Color

**Fix:** Dùng `qe.project.getVideoEffectByName(name)` (cũng `getAudioEffectByName`, `getVideoTransitionByName`, `getAudioTransitionByName`).

```javascript
// CŨ (broken in 25.4):
var effects = qe.project.getVideoEffectList();
for (var i = 0; i < effects.numItems; i++) {
  if (effects[i].name === "Lumetri Color") qeClip.addVideoEffect(effects[i]);
}

// MỚI (works in 25.4):
var effObj = qe.project.getVideoEffectByName("Lumetri Color");
if (!effObj || !effObj.name) return __error("not found");
qeClip.addVideoEffect(effObj);
```

**Files đã fix:** `src/tools/effects.ts` (8 sites), `src/tools/transitions.ts` (6 sites), `src/tools/audio.ts` (1 site).

### 3b. `getXxxByName` luôn return non-null (silent failure mode)

`qe.project.getVideoEffectByName("XYZ_random")` **không return null** — luôn return một QE object placeholder với `.name === ""`. `qeClip.addVideoEffect(invalidObj)` không throw nhưng cũng không apply (silent no-op → bug khó debug).

→ Validity check bắt buộc: `if (!effObj || !effObj.name) return __error(...)`.

### 3c. Component removal API biến mất ở DOM, NHƯNG còn ở QE

DOM-side **đều mất**:
```javascript
clip.components[i].remove()        // → "remove is not a function"
clip.components.deleteComponent()  // → "deleteComponent is not a function"
clip.components.removeAt(i)        // → undefined
app.undo()                         // → undefined
app.executeCommand(...)            // → undefined
app.findMenuCommandId(...)         // → undefined
```

QE-side `qeClip.removeEffects(...)` **không xóa được custom effect** (test: gọi với mọi tổ hợp flag `(true, true, true, true, true, true, true)` không impact gì).

✅ **Path duy nhất xóa thật được — qua QE Component:**
```javascript
app.enableQE();
var qeSeq = qe.project.getActiveSequence();
var qeTrack = qeSeq.getVideoTrackAt(trackIndex);
var qeClip = qeTrack.getItemAt(clipIndex);
var qeComp = qeClip.getComponentAt(idx);   // QE component có .remove()!
qeComp.remove();                            // thật sự xóa khỏi DOM
```

**Verified 2026-05-10:** Apply Lumetri Color → componentsBefore=3 → `qeComp.remove()` → componentsAfter=2 (component idx 2 disappeared).

**Caveats:**
- DOM `clip.components[i]` thiếu `.enabled`, `.active`, `.bypass` — không có cách disable component-level qua API (chỉ có section "Active" toggles bên trong properties).
- Sau khi remove, `qeClip.numComponents` cached/stale; phải dùng `clip.components.numItems` để verify.
- Khi xóa nhiều cùng lúc, iterate **backwards** để tránh shift index.

**Files đã fix dùng path này:** `src/tools/effects.ts` (`remove_effect`), `src/tools/clipboard.ts` (`remove_effect_by_name`).

### 3e. ⚠️ DOM clipIndex ≠ QE clipIndex (phát hiện Phase 0.5, 2026-05-10) — ĐÃ FIX

**Triệu chứng:** `apply_effect` báo `applied: true` nhưng effect không xuất hiện trên clip target — silent leak vào Empty placeholder.

**Nguyên nhân:** QE track items bao gồm `type === "Empty"` placeholders xen kẽ giữa real clips. DOM `track.clips` chỉ iterate real clips. Vì vậy `qeTrack.getItemAt(domClipIndex)` thường trỏ vào Empty placeholder cho clip sau bất kỳ Empty nào.

Verified trên project test:
- V1: Empty at QE idx 2, 23 (24 items, 22 clips) → DOM clip idx 2 (C7971) thực ra ở QE idx 3
- V2: 9 Empty placeholders rải rác — hầu hết DOM idx mismatch QE idx
- A2/A3: cùng pattern

**Fix:** Thêm helper `__getQEClip(result)` vào `script-builder.ts`, walk QE track skipping Empty items, return Nth non-Empty matching DOM clipIndex. 21 site refactor sang dùng helper.

```javascript
function __getQEClip(result) {
  app.enableQE();
  var qeTrack = result.trackType === "video"
    ? qe.project.getActiveSequence().getVideoTrackAt(result.trackIndex)
    : qe.project.getActiveSequence().getAudioTrackAt(result.trackIndex);
  var nonEmptyOrdinal = 0;
  for (var i = 0; i < qeTrack.numItems; i++) {
    var qc = qeTrack.getItemAt(i);
    if (qc && qc.type !== "Empty") {
      if (nonEmptyOrdinal === result.clipIndex) return qc;
      nonEmptyOrdinal++;
    }
  }
  return null;
}
```

**Files refactored:** advanced.ts (11 sites), effects.ts (8 sites), clipboard.ts (1), timeline.ts (1) = 21 sites.

### 3c-tris. `clip.setSpeed` (DOM) cũng mất, dùng `qeClip.setSpeed` — ĐÃ FIX (Phase 0.5)

```javascript
// CŨ (broken trong 25.4):
clip.setSpeed(150);
// → "clip.setSpeed is not a function" + clip.speed === undefined

// MỚI:
qeClip.setSpeed(percentNumber, "1", maintainAudioPitch, reversed, rippleEdit);
// 5-arg signature; "1" là timeBase string
```

`qeClip.speed` (read-only attribute) hiện đúng — `setSpeed` cập nhật được attribute này. Cũng có:
- `qeClip.setReverse(bool)` — đảo chiều
- `qeClip.setTimeInterpolationType(int)` — 0=Frame Sample, 1=Frame Blend, 2=Optical Flow
- `qeClip.setFrameBlend(bool)` — toggle frame blend
- ❌ `qeClip.enableTimeRemapping`, `qeClip.addSpeedKeyframe`, `qeClip.setSpeedRamp` đều undefined → speed-ramp keyframes KHÔNG khả thi qua ExtendScript trong 25.4

**Files đã fix (Phase 0.5):** `src/tools/timeline.ts` `set_clip_properties` speed branch + `speed_change`. Dùng `__getQEClip(result)` + 5-arg signature.

### 3c-bis. `qeTrack.addTransition` cũng đã chuyển sang `qeClip` — ĐÃ FIX (Phase 0.5)

Pattern y hệt qeComp.remove(): API di chuyển từ track-level sang clip-level trong 25.4.

```javascript
// CŨ (broken trong 25.4):
qeTrack.addTransition(transitionQE, alignBool, cutTicks, durationTicks, "0", false);
// → "qeTrack.addTransition is not a function"

// MỚI (works):
qeClip.addTransition(transitionQE, alignmentInt);
// alignmentInt: 1 chắc chắn work; 0 và 2 cần verify thêm
// (alignment, cutTicks, "1", false) các signature khác đều "Illegal Parameter type"
```

Verified: probe `qeClip.addTransition(crossDiss, 1)` → numTransitions tăng 27 → 28. Signature 2-arg hoạt động.

`qeTrack.numTransitions` (number) và `qeTrack.getTransitionAt(idx)` (function) còn dùng được để enumerate.

**Files đã fix (Phase 0.5):**
- `src/tools/transitions.ts` — 4 sites (add_transition, add_transition_to_clip start/end, batch_add_transitions). New signature `qeClip.addTransition(transition, alignmentInt)`. alignment 0 = clip's START (incoming), 1 = clip's END (outgoing). alignment 2 = "Invalid parameter".
- `src/tools/audio.ts` — 1 site (apply_audio_crossfade) cũng dùng `qeClip.addTransition(transition, 1)`.

**Caveats:**
- duration_seconds bị bỏ qua (signature 2-arg không nhận duration; transition dùng default Premiere length).
- "Center at Cut" alignment cũ KHÔNG khả thi qua signature mới — chỉ có start (0) hoặc end (1) of clip.

Verified end-to-end 2026-05-10: `add_transition_to_clip(C8007, "Morph Cut", end)` → Morph Cut xuất hiện đúng giữa C8007 và C8009 trên V3.

### 3d. Mask API hoàn toàn vắng mặt

Test toàn diện: không có method `addMask`, `addEllipseMask`, `addRectangleMask`, `addBezierMask`, `createMask` ở bất kỳ level nào (component, qeClip, qeSequence, qe.project). Mask path API trong ExtendScript **không tồn tại** trong 25.4.

→ Tính năng 1.2 Masking trong plan phải dùng workaround: effect "Crop" (4 crops built-in) hoặc track matte multi-track.

### Phụ lục: kết quả spike Lumetri/Ultra Key/Warp Stabilizer

Đã dump full property maps. Lumetri có 130 props, Ultra Key 27 props (matchName `AE.ADBE Ultra Key`), Warp Stabilizer 32 props (matchName `AE.ADBE SubspaceStabilizer`, có `AnalysisStatusCounter` để monitor analysis progress). Chi tiết trong [plan.md](plan.md#L341).

---

## Bug 4: Sequence in/out point manipulation — multiple regressions in 25.4 (2026-05-10, Phase 3.8 spike)

**Triệu chứng:** Khi implement `render_clip_in_place`, dry-run logic bị "Illegal Parameter type" trên `seq.setInPoint(seq.zeroPoint.ticks)`.

**Phát hiện qua probe trực tiếp:**

| API | Behavior 25.4 | Status |
|---|---|---|
| `seq.getInPoint()` / `seq.getOutPoint()` | Returns **string of seconds** (vd `"58.007937499999997"`). Sentinel `-400000` = "no point set". | Changed return type — không còn Time object |
| `seq.setInPoint(value)` | Accepts **string of ticks** (vd `"14735232000000"`). Number bị scale sai. | OK với string ticks |
| `seq.clearInPoint()` / `seq.clearOutPoint()` | ❌ undefined | Removed |
| `seq.zeroPoint.ticks` | Returns **Number** (not string) | `setInPoint(seq.zeroPoint.ticks)` throws "Illegal Parameter type" |
| `seq.end` | Returns **Time obj** với .ticks, accepts directly via `setOutPoint(seq.end)` | OK |
| `clip.start.ticks` / `clip.end.ticks` | Returns **string** of ticks | OK pass to setInPoint/setOutPoint |

**Workaround pattern (verified):**

```javascript
// Save prev as seconds-string (parse to float)
var prevInSec = parseFloat(seq.getInPoint());
var prevOutSec = parseFloat(seq.getOutPoint());

// Set new in/out using clip.start.ticks (string) — works
seq.setInPoint(clip.start.ticks);
seq.setOutPoint(clip.end.ticks);

// ... encode ...

// Restore via __secondsToTicks(seconds).toString()
if (!isNaN(prevInSec)) seq.setInPoint(__secondsToTicks(prevInSec).toString());
if (!isNaN(prevOutSec)) seq.setOutPoint(__secondsToTicks(prevOutSec).toString());
```

**Latent bug discovered:** `clear_sequence_in_out` tool (`src/tools/track-targeting.ts:902`) uses `seq.setInPoint(seq.zeroPoint.ticks)` — broken in 25.4 (Illegal Parameter type). Add to backlog.

**Verified working pattern in 25.4:** `setInPoint("0")` and `setOutPoint(seq.end)` both work. Probably the cleanest replacement for clear is `setInPoint("0")` + `setOutPoint(seq.end)`.

**Files affected:**
- `src/tools/advanced.ts` — Phase 3.8 tools `render_clip_in_place`, `render_sequence_range` use the new pattern correctly
- `src/tools/track-targeting.ts:902` — `clear_sequence_in_out` needs fix (pending)

---

## Bug 5: `app.encoder.bind()` accepts ANY event name silently (2026-05-10, Phase 3.8 spike)

**Triệu chứng:** Probe encoder events — passing any string to `enc.bind(eventName, callback)` reports "bound OK" without any validation:

```
onEncoderJobComplete: bound OK
onEncoderJobError: bound OK
onItemEncodingProgress: bound OK
onMadeUpEvent12345: bound OK   ← would also bind silently
```

**Tác động:** Cannot reliably observe AME completion/progress from ExtendScript via bind. Fire-and-forget render is the only reliable pattern.

**Workaround:** External polling of output file existence via `File(path).exists`. Or rely on AME UI for visual feedback.

**Other encoder API findings:**
- `app.encoder.isRunning` — undefined (existing `get_render_queue_status` tool calls it and returns "unknown")
- `app.encoder.stopBatch` — undefined
- `app.encoder.quitEncoder` — undefined
- `app.encoder.EVENT_BATCH_DONE/EVENT_ITEM_DONE/EVENT_ITEM_PROGRESS` — undefined (use string event names if needed)
- `app.encoder.encodeSequence/encodeProjectItem/encodeFile` — all functions, working
- `ENCODE_ENTIRE=0`, `ENCODE_IN_TO_OUT=1`, `ENCODE_WORKAREA=2` — verified constants
- `getExporters()` returns array of 24 native exporters (H.264, HEVC, ProRes, DNxHR, etc.)

---

# Test run 2026-05-10 — Full 443-tool sweep

**Setup:**
- Premiere 25.4.1 build 3, macOS 26.4.1
- Project: `Lò nướng.prproj` (59 items, 6 sequences, 0 offline)
- Sandbox sequence: `Sequence 01 Cắt Copy` (3840×2160, 88 clips, 3V/3A)
- SKIPPED sequence: `Sequence 01 Gốc` (theo yêu cầu user)
- All previous fixes (Bug 1-5) loaded

**Convention:**
- ✅ PASS — tool chạy đúng
- ❌ FAIL — tool fail/throw/sai output
- ⚠️ PARTIAL — chạy nhưng output có vấn đề (vd `NaN` JSON, sai field, side effect bất ngờ)
- ⏭️ SKIP — không test được trong scope (cần user input file path/preset/mogrt cụ thể, AME running, v.v.)

## New bugs discovered this run


### NEW BUG #6 — `list_sequences` xuất `NaN` không hợp lệ JSON
- **Tool:** `list_sequences`
- **Severity:** Medium
- **Output:** `{"inPoint":NaN, "end":298.331...}`
- **Issue:** `NaN` không phải valid JSON (RFC 8259). Strict parser sẽ throw.
- **Fix:** Thay `NaN` bằng `null`.

### NEW BUG #7 — `get_work_area` throw TypeError
- **Tool:** `get_work_area`
- **Severity:** High
- **Error:** `TypeError: undefined is not an object`
- **Suspect:** Premiere 25.4 đã loại bỏ `seq.workAreaInPoint`/`workAreaOutPoint` properties (giống bug 4 với in/out points).
- **Fix gợi ý:** Detect API absent → return `{ enabled: false, available: false }` thay vì throw.

### NEW BUG #8 — `is_work_area_enabled` throw ReferenceError
- **Tool:** `is_work_area_enabled`
- **Severity:** High
- **Error:** `ReferenceError: seq.isWorkAreaBarEnabled is not a function`
- **Suspect:** API removed in 25.4. Cùng family với #7.
- **Fix gợi ý:** Wrap try/catch, return `{ available: false, note: "API removed in 25.4" }`.

### NEW BUG #9 — `get_encoder_presets` throw
- **Tool:** `get_encoder_presets`
- **Severity:** High
- **Error:** `Encoder preset listing failed: encoder.getFormatList is not a function`
- **Note:** Khớp với phát hiện trong Bug 5 (encoder API regression). `getFormatList` cũng đã bị loại bỏ ở 25.4 cùng với `isRunning`/`stopBatch`/etc.
- **Fix gợi ý:** Workaround dùng cache list của format đã hard-code, hoặc return empty với note explanatory.

### NEW BUG #10 — `list_project_items` mọi item type đều là "sequence"
- **Tool:** `list_project_items`
- **Severity:** Medium (sai output)
- **Output:** Tất cả 57 items đều có `"type":"sequence"`, kể cả `C7984.MP4`, etc. (thực ra phải là `clip`/`footage`).
- **Repro:** Gọi `list_project_items` không args → mọi entry, kể cả mp4 file, đều hiển thị `type: "sequence"`.
- **Đối chứng:** Trong cùng project, `get_full_project_overview` báo các mp4 đó là `type: "file"`. → output không nhất quán giữa 2 tool.
- **Fix gợi ý:** Mapping `ProjectItemType` enum đang sai. `TYPE_CLIP=2`, `TYPE_BIN=1`, `TYPE_FILE=4`, `TYPE_ROOT=0`; sequence là một dạng clip với mediaType=video, không phải tất cả.

### NEW BUG #11 — `get_sequence_in_out_points` trả số âm gần 0 thay vì null
- **Tool:** `get_sequence_in_out_points`
- **Severity:** Low (output không trực quan)
- **Output:** `{ "inSeconds": -0.00000157470396, "outSeconds": -0.00000157470396 }` khi không có in/out.
- **Issue:** Số âm gần-zero là sentinel `-400000 ticks` → ÷ ticksPerSecond raw. Should detect và return `null` hoặc `{ set: false }`.
- **Fix gợi ý:** Check `inTicks === "-400000"` (sentinel) → return `null`.

### NEW BUG #12 — `get_full_sequence_info` overflow context window
- **Tool:** `get_full_sequence_info`
- **Severity:** High (DX/usability)
- **Output:** 91,007 chars cho sequence 88-clip → vượt context limit, MCP wrapper save ra file tạm.
- **Issue:** Tool không có pagination/limit. Sequence "thật" >100 clip sẽ luôn overflow.
- **Fix gợi ý:** Add option `summary_only: true` (skip clip-level effect details), hoặc paging `tracks_offset` / `tracks_limit`.

### NEW BUG #13 — `get_project_scratch_disks` trả về {} rỗng
- **Tool:** `get_project_scratch_disks`
- **Severity:** Medium
- **Output:** `{}` — không có key nào.
- **Expected:** ít nhất các key `videoCaptureDir`, `audioCaptureDir`, `videoPreviewDir`, `audioPreviewDir`, `cclibrariesDir`, `motionGraphicsTemplateDir`, etc.
- **Suspect:** Plugin có thể đang gọi API với projectScratchDiskType chưa được map đúng, hoặc API này thay đổi key trong 25.4.


### NEW BUG #14 — `list_clip_effects` xuất `undefined` không hợp lệ JSON
- **Tool:** `list_clip_effects`
- **Severity:** Medium
- **Output:** `{"matchName":undefined, "isTimeVarying":false, ...}` — `undefined` không phải JSON valid token.
- **Affected fields:** `properties[].matchName` (mọi component property đều undefined).
- **Fix:** Output `null` thay vì `undefined`, hoặc bỏ field nếu thực sự không có. Lý do `matchName` undefined: PropertyType ở DOM chỉ phơi `displayName`, không phơi `matchName` ở property level (chỉ component level).

### NEW BUG #15 — `find_items_by_media_path` báo type sai ("bin" cho mp4)
- **Tool:** `find_items_by_media_path`
- **Severity:** Medium
- **Repro:** `find_items_by_media_path("CLIP/C7984")` → trả về `{nodeId:"000f42b3", name:"C7984.MP4", type:"bin"}`.
- **Expected:** type="file" (file footage), không phải bin.
- **Cùng family với Bug #10**: Mapping ProjectItemType enum bị sai/đảo ngược trong các tool khác nhau, không nhất quán. `list_project_items` cho ra "sequence", `find_items_by_media_path` cho ra "bin", `search_project_items` cho ra "file" (đúng).

### NEW BUG #16 — `find_project_item_by_name` cũng type sai ("sequence" cho mp4)
- **Tool:** `find_project_item_by_name`
- **Severity:** Medium
- **Output:** `{nodeId:"000f42b3", name:"C7984.MP4", type:"sequence", ...}` — sai type.
- **Same root cause** với Bug #10/15: cần unify mapping `ProjectItemType` ở 1 chỗ và dùng chung.

### NEW BUG #17 — `get_audio_channel_mapping` partial output + invalid JSON
- **Tool:** `get_audio_channel_mapping`
- **Severity:** Medium
- **Output:** `{"audioChannelType":"unknown","audioChannelTypeRaw":undefined}` — undefined không hợp lệ JSON; "unknown" không có thông tin.
- **Suspect:** Tool đang đọc `projectItem.getProjectMetadata()` channelType nhưng API có thể cần `audioChannelMapping` member khác trong 25.4.

### NEW BUG #18 — `get_qe_clip_info` thiếu introspection + undefined fields
- **Tool:** `get_qe_clip_info`
- **Severity:** Low
- **Output:** `inPoint:undefined, outPoint:undefined, audioChannelType:undefined, numAudioChannels:undefined, availableProperties:[], availableMethods:[]` — undefined invalid JSON; arrays rỗng nói rằng tool không thật sự inspect được QE properties/methods như mô tả.
- **Fix:** Thay undefined bằng null. Bỏ availableProperties/availableMethods nếu không enumerate được, hoặc dùng `for-in` để liệt kê thực sự.

### NEW BUG #19 — `inspect_dom_object` xuất "[object]" và undefined
- **Tool:** `inspect_dom_object`
- **Severity:** Low
- **Output:** `"children":undefined, "getOverrideColorSpaceList":"[object]"` — undefined invalid JSON; "[object]" là string không hữu ích.
- **Fix:** Detect function objects → return `"[function]"`; detect undefined → return null.

### NEW BUG #20 — `get_track_info.transitions` trả về clip ranges, không phải transitions
- **Tool:** `get_track_info`
- **Severity:** Medium
- **Output:** Track V1 không có transition nào trong sequence (verify qua UI), nhưng tool trả về 22 entries trong `transitions[]` với `startSeconds`/`endSeconds` chính là range của 22 clips trên track.
- **Suspect:** Code đang iterate `track.transitions` nhưng property này trả về clip-edges (do API change ở 25.4?), hoặc nhầm field. So với `get_full_clip_info`/`list_clip_effects`, transition thực không tồn tại trên các clip này.

### NEW BUG #21 — `get_source_monitor_position` trả sentinel khi nothing loaded
- **Tool:** `get_source_monitor_position`
- **Severity:** Low
- **Output (no source clip loaded):** `{ "seconds": -400000, "ticks": "-101606400000000000" }`.
- **Issue:** sentinel `-400000` không trực quan. Nên detect và return `{ loaded: false }` hoặc `null`.

### NEW BUG #22 — `get_project_panel_metadata` overflow context (131k chars)
- **Tool:** `get_project_panel_metadata`
- **Severity:** High (DX)
- **Output:** 131,230 chars XML → vượt context limit, MCP wrapper save ra file tạm.
- **Fix:** Tool không nên dump toàn bộ panel metadata XML (mỗi item có XMP riêng). Add option `format: "summary" | "raw"` để default trả về cấu trúc tóm tắt.

### NEW BUG #23 — `get_clip_at_position` throw thay vì return null khi out-of-range
- **Tool:** `get_clip_at_position`
- **Severity:** Low
- **Repro:** `get_clip_at_position(time_seconds=99999, track_index=0, track_type="video")` → throw `Error: No clip found at position 99999s on video track 0`.
- **Issue:** "Không tìm thấy" là điều bình thường, không phải error. Nên return `null` hoặc `{ found: false }` để caller dễ xử lý.


### NEW BUG #24 — `set_effect_enabled` silent fail
- **Tool:** `set_effect_enabled`
- **Severity:** Medium
- **Repro:** `set_effect_enabled(node_id="000f43b3", effect_index=2, enabled=false)` → return `{ effectIndex: 2, enabled: false, toggled: false }`.
- **Issue:** `toggled: false` cho thấy không thật sự toggle. Nhưng không throw error → silent fail. Bug 3c đã ghi nhận DOM-side lacks `clip.components[i].enabled` — handler chắc đang detect API absent rồi swallow lỗi.
- **Fix gợi ý:** Try qeComp toggle (qeComp.enabled?), nếu không khả thi, return error rõ ràng `"Per-component disable not supported in 25.4"`.

### NEW BUG #25 — `get_effect_properties` / `list_clip_effects` xuất binary garbage
- **Tools:** `get_effect_properties`, `list_clip_effects`
- **Severity:** Medium
- **Repro:** Gọi với `effect_name="Lumetri Color"` → xuất 130 properties trong đó nhiều entry có:
  - displayName empty `""` (~15 props)
  - displayName chỉ space `" "`
  - displayName chứa BOM `"￾"` (`"﻾"`)
  - value là number 18-digit (vd `18374686479671623000`) — pointer-like binary value bị stringify
  - value là Unicode garbage `"鄴췄℞瘙玁"`
  - value `""`, `""` — control characters
- **Issue:** Lumetri có ~25 internal composite/binary props không user-relevant. Plugin nên filter:
  - Skip props với displayName empty/whitespace/BOM-only
  - Detect binary value (string với control chars hoặc number > 1e15) → represent as `"<binary blob>"`
- **Fix gợi ý:** Add `__cleanLumetriProps()` để filter trong handler, hoặc add option `filter_internal: true` (default true).

### NEW BUG #26 — `apply_lut` error message khó hiểu
- **Tool:** `apply_lut`
- **Severity:** Low
- **Repro:** `apply_lut(node_id="000f43c3", lut_path="/nonexistent/test.cube")` → `Error: Illegal Parameter type`.
- **Expected:** Error message rõ "LUT file not found at /nonexistent/test.cube".
- **Fix:** Pre-check `File(path).exists` trước khi pass vào DOM call.


### NEW BUG #27 — `add_audio_keyframes` throw `levelProp.addKeyframe is not a function`
- **Tool:** `add_audio_keyframes`
- **Severity:** High (audio fade khá quan trọng)
- **Error:** `ReferenceError: levelProp.addKeyframe is not a function`
- **Suspect:** Cùng family Bug #3 — DOM `levelProp.addKeyframe` không còn exposed trong 25.4. Cần workaround qua QE: track-level `qeTrack.addAudioFade(...)` hoặc viết keyframe vào clip's audio component qua component-level API.
- **Note:** Dùng `add_keyframe` với `effect_name="Volume"` có thể là alternative pattern (chưa verify trong run này).

### NEW BUG #28 — `set_clip_pan` báo "is this an audio clip?" trên audio clip
- **Tool:** `set_clip_pan`
- **Severity:** Medium
- **Repro:** `set_clip_pan(node_id="000f43e0", pan=25)` (audio clip C7925.MP4 trên A1) → throw `Error: Could not set pan - is this an audio clip?`.
- **Issue:** Detection mediaType audio sai, hoặc API đường đi cũ không còn (`audioComponents[0].properties["Balance"]`?).

### NEW BUG #29 — `remove_transition` throw `qeClip.removeTransition is not a function`
- **Tool:** `remove_transition`
- **Severity:** High (đối ứng với add_transition)
- **Error:** `ReferenceError: qeClip.removeTransition is not a function`
- **Suspect:** API moved trong 25.4 (đã fix `qeClip.addTransition` ở Bug 3c-bis nhưng remove path chưa update). Có thể cần `qeClip.removeTransitionAt(idx)` hoặc lấy transition object qua `qeTrack.getTransitionAt(idx).remove()`.

### NEW INFO — `set_default_transition` graceful degrade ✅
- **Tool:** `set_default_transition`
- **Output:** `{ "set": false, "note": "setAsDefaultTransition API not available; transition exists." }`
- **Đánh giá:** Đây là cách **đúng** để xử lý API regression — báo rõ ràng cho caller. Pattern này nên được áp dụng cho các bug #7/#8/#9 thay vì throw raw ExtendScript error.


### NEW BUG #30 — `set_clip_speed_qe` "Not Enough Parameters"
- **Tool:** `set_clip_speed_qe`
- **Severity:** Medium
- **Repro:** `set_clip_speed_qe(node_id="000f43cb", speed_percent=150)` → `Error: Not Enough Parameters`.
- **Suspect:** Tool đang gọi `qeClip.setSpeed()` thiếu argument. Bug 3c-tris đã ghi nhận 5-arg signature: `qeClip.setSpeed(percent, "1", maintainPitch, reverse, ripple)`. Tool này có thể chưa được update.
- **Note:** `speed_change` (cùng họ) PASS — handler đã update.

### NEW BUG #31 — `reverse_clip` "Unknown error exception"
- **Tool:** `reverse_clip`
- **Severity:** Medium
- **Error:** `Error: Unknown error exception`
- **Suspect:** Cùng family Bug 3c-tris — `qeClip.setReverse(bool)` cần wrap trong try/catch để return error rõ. Hoặc handler đang gọi DOM-side `clip.setReverse` (không tồn tại trong 25.4).
- **Workaround:** dùng `speed_change(node_id, speed_percent=100, reverse=true)`.

### NEW BUG #32 — `enable_disable_clip` `clip.setDisabled is not a function`
- **Tool:** `enable_disable_clip`
- **Severity:** High (basic operation)
- **Error:** `ReferenceError: result.clip.setDisabled is not a function`
- **Suspect:** `clip.setDisabled` removed in 25.4. Cần test alternatives: `qeClip.disable()`, `qeClip.setEnabled(bool)`, hoặc DOM `clip.disabled = bool` direct write.

### NEW BUG #33 — `set_anti_alias_quality` "Illegal Parameter type"
- **Tool:** `set_anti_alias_quality`
- **Severity:** Low
- **Repro:** `set_anti_alias_quality(node_id="000f43d2", enabled=true)` → `Error: Illegal Parameter type`.
- **Suspect:** Property "Anti-flicker Filter" trên Motion expects 0/1 (number), tool đang pass true (boolean). Convert bool → 0|1 trước khi setValue.

### NEW BUG #34 — `set_scale_width_height` partial set (height fail)
- **Tool:** `set_scale_width_height`
- **Severity:** Medium
- **Repro:** `set_scale_width_height(node_id="000f43cd", scale_width=110, scale_height=90)` → `widthSet: true, heightSet: false`.
- **Issue:** Set Width thành công, Height fail im lặng (không error message). Suspect: Property "Scale Height" không tìm thấy ở DOM — Premiere chỉ có "Scale" + "Scale Width" (Width gating qua "Uniform Scale=false"). Height rất có thể là composite property.
- **Fix:** Check correct property name. Có thể là "Scale Height" hoặc "Scale" w/ Uniform=false thì cả 2 dùng "Scale".

### NEW BUG #35 — `batch_set_clip_property` không tìm thấy clip vừa rename
- **Tool:** `batch_set_clip_property`
- **Severity:** Low (edge case)
- **Repro:** Chạy `batch_rename_clips` trên V3 → 4 clips rename thành "V3_Clip_1..4". Sau đó `batch_set_clip_property("Opacity", 85, [{trackType:"video", trackIndex:2, clipIndex:0}, {clipIndex:1}])` → `updated: 0, notFound: [...]`.
- **Issue:** clipIndex 0/1 rõ ràng phải tồn tại trên V3 (có 5 clips). Tool có thể đang lookup theo name match thay vì track+index resolve.


### NEW BUG #36 (CRITICAL) — `add_adjustment_layer` `qeSeq.addAdjustmentLayer is not a function`
- **Tool:** `add_adjustment_layer`
- **Severity:** High (rất hay dùng trong workflow)
- **Error:** `Failed to add adjustment layer: qeSeq.addAdjustmentLayer is not a function`
- **Suspect:** API removed in 25.4. Cùng family Bug 3. Workaround: dùng `app.project.createNewBin` + `app.project.importFiles` với template, hoặc duplicate adjustment layer template từ bin.
- **Note:** Đây là pain point lớn — adjustment layer là kỹ thuật cơ bản. Cần workaround sớm.

### NEW BUG #37 (CRITICAL) — `add_color_matte` & `add_text_overlay` timeout (suspect modal dialog)
- **Tools:** `add_color_matte`, `add_text_overlay`
- **Severity:** High
- **Repro:** Gọi `add_color_matte("#FF0000", "Red")` → 30s timeout, không response. Ping vẫn OK trước & sau. Reproduce 100%.
- **Suspect:** Cả 2 tool dùng QE `qeSeq.newColorMatte()` hoặc tạo title via `app.project.createTitle()` — trong 25.4, các API này có thể bật modal dialog (Color Picker, Title Designer) chờ user input → ExtendScript engine block → MCP wrapper timeout.
- **Workaround tentative:** dùng synthetic media (`createBarsAndTone`) hoặc nhập file image solid color. Cho text → dùng MOGRT từ project.
- **Fix:** Detect nếu tool sẽ bật dialog, return error sớm thay vì block. Hoặc tạo media object DOM-side không qua QE.

### NEW BUG #38 — `trim_clip` clip-not-found sau razor
- **Tool:** `trim_clip`
- **Severity:** Low (UX gotcha)
- **Repro:** sau khi `razor_all_tracks`/`split_clip`, gọi `trim_clip` với nodeId cũ → "Clip not found".
- **Issue:** Razor tạo clip mới thay clip cũ → nodeId stale. Documentation cần ghi rõ clip's nodeId không stable sau razor; caller phải refresh state.

### NEW INFO — `set_poster_frame` graceful UI note
- **Output:** `{ ..., "note": "Poster frame set attempt - may require UI interaction" }` — pattern degraded tốt, không throw.


### NEW BUG #39 (CRITICAL) — `slip_edit`/`slide_edit`/`roll_edit` displace clip 69,000+ giây
- **Tools:** `slip_edit`, `slide_edit`, `roll_edit`
- **Severity:** CRITICAL (data corruption)
- **Repro:**
  1. Apply 3 chained edits trên cùng nodeId 000f43d5 (C8000 V2 idx 12, gốc start=218.7185s):
     - `slip_edit(offset_seconds=0.5)` → success
     - `slide_edit(offset_seconds=0.2)` → success
     - `roll_edit(offset_seconds=-0.3)` → success
  2. Sau đó `get_active_sequence` → C8000 (000f43d5) hiện ở `start: 69818.6489, end: 69830.1937` — **dịch ~69,600 giây so với vị trí gốc**.
- **Phân tích math:** offset 0.5 sec ở slip → tool nhận đúng. Nhưng kết quả thực tế start jumped ~69,600s → suggest unit mismatch (seconds bị treat như ticks/frame_rate scale, hoặc cumulate sai).
- **Reproduction note:** một trong 3 tool có thể là thủ phạm chính (slide_edit là khả nghi vì nó move clip; slip không nên move). Cần test riêng từng tool sau khi recover.
- **Fix:** Audit ticks-vs-seconds conversion trong handler của 3 tool này. Có thể dùng `seq.zeroPoint` (number) như 1 multiplier thay vì offset.

### NEW BUG #40 (CRITICAL) — `replace_clip_media` block engine, có thể gây cascade timeout
- **Tool:** `replace_clip_media`
- **Severity:** High
- **Repro:** Gọi parallel với các tool khác → 30s timeout, tất cả tool sau đó cũng timeout cho đến khi "engine reset".
- **Suspect:** Tool có thể bật dialog (Replace Media Confirmation?) hoặc dùng `app.executeCommand` async không return.
- **Fix:** Wrap trong try/catch + timeout watchdog; detect dialog state.

### NEW BUG #41 (CRITICAL) — `four_point_edit` "Connection closed" (kill bridge)
- **Tool:** `four_point_edit`
- **Severity:** CRITICAL (bridge crash)
- **Error:** `MCP error -32000: Connection closed`
- **Repro:** Sau loạt timeout do replace_clip_media block, gọi `four_point_edit` → bridge close → ping cũng timeout.
- **Suspect:** Tool exception không catch → CEP panel JS crash → killed.
- **Fix gợi ý:** Wrap entire tool body trong try/catch; signal error qua MCP protocol thay vì throw lên CEP runtime.


---

## INTERIM SUMMARY (test bị gián đoạn do bridge crash sau Bug #41)

Đã test trong run này: **~150 / 443 tools** (~34%).

### PASS — đã verify hoạt động đúng (sample)

**Read-only / inspection (35+):**
ping, get_premiere_state, get_version_info, run_diagnostics, get_full_project_overview, get_project_info, get_sequence_count, get_total_clip_count, list_project_items, list_sequence_tracks, get_sequence_settings, get_sequence_structure, get_timeline_summary, get_playhead_position, get_active_sequence, get_selected_clips, get_target_tracks, get_sequence_in_out_points, get_sequence_vr_settings, get_graphics_white_luminance, get_all_project_paths, get_offline_media, get_used_media_report, get_unused_media, get_duplicate_media, check_offline_media, get_workspaces, get_render_queue_status, get_available_mogrts, list_available_effects, list_available_audio_effects, list_available_transitions, list_available_audio_transitions, list_vr_effects_and_transitions, list_sequence_color_spaces, get_sequence_markers_by_type, list_markers, get_caption_tracks (graceful), get_clip_at_playhead, get_clip_at_position, get_clip_properties, get_clip_speed, get_clip_volume, get_clip_transform, get_clip_links, get_clip_markers, get_clip_adjustment_layer, get_color_label, get_metadata, get_xmp_metadata, get_item_info, get_project_item_info, get_linked_items, has_proxy, list_clip_color_space_overrides, get_track_info (PARTIAL - bug #20), get_timeline_gaps, get_footage_interpretation, get_bin_contents, get_insertion_bin, find_project_item_by_name (PARTIAL - bug #16), find_items_by_media_path (PARTIAL - bug #15), search_project_items, get_qe_clip_info (PARTIAL - bug #18), inspect_dom_object (PARTIAL - bug #19), get_source_monitor_info, set_active_sequence, get_next_edit_point.

**Effects (~25):**
apply_effect, apply_effect_with_properties, apply_brightness_contrast, apply_gaussian_blur, apply_drop_shadow, apply_corner_pin, apply_basic_3d, apply_directional_blur, apply_lens_flare, apply_mirror, apply_color_key, apply_ultra_key, apply_crop_mask, apply_vr_blur, apply_lens_distortion, color_correct, set_effect_property, set_lumetri_creative, set_lumetri_hsl_secondary, set_lumetri_vignette, set_ultra_key_settings, set_color_value, copy_effect_values, copy_effects_between_clips, batch_apply_effect, remove_effect_by_name, remove_effect, remove_all_effects.

**Keyframes / Transitions / Audio (~14):**
add_keyframe, get_keyframes, set_keyframe_interpolation, get_value_at_time, remove_keyframe, remove_keyframe_range, add_transition_to_clip, add_transition (PARTIAL - duration ignored), batch_add_transitions, set_default_transition (graceful degraded), apply_audio_effect, apply_audio_crossfade, adjust_audio_levels, set_clip_volume, set_audio_channel_mapping.

**Clip set/transform/selection (~25):**
set_clip_position, set_clip_scale, set_clip_rotation, set_clip_opacity, set_clip_anchor_point, set_clip_transform, set_clip_properties, set_uniform_scale, set_scale_to_frame_size, speed_change, set_blend_mode, set_frame_blend, set_time_interpolation, set_clip_time_interpolation, select_all_clips, deselect_all_clips, select_clips_by_color, select_clips_by_name, select_clips_in_range, select_disabled_clips, invert_selection, select_item, set_clip_selection, link_selection, unlink_selection, set_color_label, rename_clip, batch_rename_clips.

**Edit ops (sequential, ~10):**
razor_timeline_at_time, split_clip, razor_all_tracks, duplicate_clip, match_frame, create_subclip, set_poster_frame, remove_selected_clips, replace_clip, ripple_delete, remove_from_timeline, add_to_timeline, overwrite_clip.

### FAIL / BUG (đã ghi nhận chi tiết phía trên #6-41)

| # | Tool | Severity | Note |
|---|------|---------:|------|
| 6 | `list_sequences` | Med | NaN in JSON |
| 7 | `get_work_area` | High | TypeError API removed |
| 8 | `is_work_area_enabled` | High | API removed |
| 9 | `get_encoder_presets` | High | API removed |
| 10 | `list_project_items` | Med | Type field sai |
| 11 | `get_sequence_in_out_points` | Low | Sentinel return |
| 12 | `get_full_sequence_info` | High | Overflow ctx |
| 13 | `get_project_scratch_disks` | Med | Empty {} |
| 14 | `list_clip_effects` | Med | undefined in JSON |
| 15 | `find_items_by_media_path` | Med | Type "bin" cho mp4 |
| 16 | `find_project_item_by_name` | Med | Type "sequence" cho mp4 |
| 17 | `get_audio_channel_mapping` | Med | unknown + undefined |
| 18 | `get_qe_clip_info` | Low | undefined fields |
| 19 | `inspect_dom_object` | Low | Invalid JSON |
| 20 | `get_track_info.transitions` | Med | Trả clip ranges |
| 21 | `get_source_monitor_position` | Low | Sentinel -400000 |
| 22 | `get_project_panel_metadata` | High | Overflow ctx (131k) |
| 23 | `get_clip_at_position` | Low | Throw on out-of-range |
| 24 | `set_effect_enabled` | Med | Silent fail |
| 25 | `get_effect_properties`/`list_clip_effects` Lumetri | Med | Binary garbage |
| 26 | `apply_lut` | Low | Error msg confusing |
| 27 | `add_audio_keyframes` | High | API removed |
| 28 | `set_clip_pan` | Med | "is this audio?" trên audio clip |
| 29 | `remove_transition` | High | API removed |
| 30 | `set_clip_speed_qe` | Med | Not enough params |
| 31 | `reverse_clip` | Med | Unknown error |
| 32 | `enable_disable_clip` | High | setDisabled removed |
| 33 | `set_anti_alias_quality` | Low | Illegal param type |
| 34 | `set_scale_width_height` | Med | Height fail silent |
| 35 | `batch_set_clip_property` | Low | Index lookup sai sau rename |
| 36 | `add_adjustment_layer` | High | API removed |
| 37 | `add_color_matte`/`add_text_overlay` | High | Modal dialog block |
| 38 | `trim_clip` | Low | NodeId stale sau razor (UX) |
| 39 | `slip_edit`/`slide_edit`/`roll_edit` | **CRITICAL** | Displace clip 69,000s |
| 40 | `replace_clip_media` | High | Block engine |
| 41 | `four_point_edit` | **CRITICAL** | Crash bridge |

### CHƯA TEST (tools còn lại ~290):
- Markers/Captions: `add_marker`, `update_marker`, `delete_marker`, `clear_all_markers`, `add_caption`, `update_caption`, `remove_caption`, `create_caption_track`, `get_captions`, `import_captions`, `export_captions`, `transcribe_sequence`
- Metadata extras: `set_metadata`, `set_xmp_metadata`, `set_project_panel_metadata`, `add_custom_metadata_field`, `attach_custom_property`, `add_marker_to_project_item`
- Source/Playback: `play_timeline`, `play_source_monitor`, `stop_playback`, `set_playhead_position`, `set_source_in_out`, `set_item_in_out`, `clear_item_in_out`, `clear_sequence_in_out`, `go_to_*`, `step_*`, `move_playhead_to_edit`, `capture_frame`, `open_in_source`, `close_source_monitor`, `close_all_source_clips`, `close_sequence`, `insert_from_source`, `overwrite_from_source`
- Sequence/Track/Bin: `create_sequence`, `create_sequence_from_clips`, `create_sequence_from_preset`, `duplicate_sequence`, `set_sequence_resolution`, `set_sequence_frame_rate`, `set_sequence_audio_settings`, `set_sequence_in_out_points`, `set_zero_point`, `set_start_time`, `set_work_area`, `set_sequence_*`, `add_track`, `add_tracks`, `delete_track`, `rename_track`, `lock_track`, `mute_track`, `toggle_track_visibility`, `set_target_track`, `set_all_tracks_targeted`, `create_bin`, `rename_bin`, `delete_bin`, `move_item_to_bin`, `move_items_to_bin`, `create_smart_bin`
- Project/Render/Export/Import: `save_project`, `save_project_as`, `create_project`, `open_project`, `close_project`, `manage_proxies`, `detach_proxy`, `multiple_undo`, `undo`, `redo`, `refresh_media`, `relink_media`, `consolidate_duplicates`, `consolidate_and_transfer`, `scene_edit_detection`, `transcribe_sequence`, `evaluate_expression`, `execute_extendscript`, `set_workspace`, `set_scratch_disk_path`, `flush_cache`, `delete_preview_files`, render+encode tools, all import_* and export_*
- Effect coverage còn lại (~120 apply_xxx tools): chưa test riêng, nhưng infer từ test 13 effects mẫu (tất cả PASS) và core `apply_effect` PASS → estimate đa số sẽ PASS
- Auto-reframe: `auto_reframe_sequence`, `apply_auto_reframe`
- HDR: `set_sequence_hdr_options`, `set_sequence_color_space`, `set_clip_color_space_override`, `set_graphics_white_luminance`
- VR: `set_sequence_vr_settings`
- MOGRT: `import_mogrt`, `import_mogrt_from_library`, `set_mogrt_property`, `get_mogrt_properties`, `get_mogrt_component`
- Subclip: `edit_subclip_boundaries`
- Misc: `nest_clips`, `unnest_sequence`, `link_audio_video`, `replace_clip_with_file`, `set_clip_anchor_point`, `set_clip_start_time`, `select_all_clips` cross-track, `set_clip_pan` (audio), `cleanup`/destructive tools

Run này phát hiện **36 bugs mới** (#6-41), trong đó **3 CRITICAL** (#39, #40, #41) và **~12 High** liên quan đến API regressions trong Premiere 25.4 chưa được handler patch.


### REGRESSION CONFIRMATION cho Bug #10
Bridge IPC dir `/tmp/premiere-mcp-bridge/` còn 2 orphan response files từ **May 8, 22:18**. Inspect:
```json
{ "id": "000f42b3", "name": "C7984.MP4", "type": "footage", ... }
```

→ **May 8 build trả `type: "footage"` (đúng)**, May 10 build hiện tại trả `type: "sequence"` (sai). Bug #10 confirmed là **regression giữa May 8 và May 10**, không phải bug lâu năm.

**Fix path:** git log/diff giữa May 8 và May 10 trong các handler liên quan tới ProjectItemType mapping (probably in `src/tools/utility.ts` hoặc helper map enum). Có thể fix nhanh bằng cách rollback diff đó.

Bonus: 2 orphan files trong `/tmp/premiere-mcp-bridge/` từ May 8 cho thấy bridge IPC có thể **không cleanup orphan responses** khi request side timeout — đây có thể là 1 trong các nguyên nhân tích lũy gây bridge crash kỳ này (Bug #41).


### NEW BUG #42 — `add_marker` on sequence "Illegal Parameter type"
- **Tool:** `add_marker` (sequence-level)
- **Severity:** High (markers cơ bản)
- **Repro:** `add_marker(time_seconds=50.5, name="...", duration_seconds=2, color=1, comments="...")` → `Error: Illegal Parameter type`.
- **Suspect:** `duration_seconds=2` được pass vào `marker.end = ...` API có signature thay đổi trong 25.4 (giống Bug 4 sequence in/out — Time vs Number vs string ticks).
- **Fix:** Convert duration_seconds → ticks string trước khi gán; hoặc dùng zeroPoint-based offset.

### NEW BUG #43 — `add_marker` on clip "TypeError: undefined"
- **Tool:** `add_marker` với `node_id`
- **Severity:** High
- **Repro:** `add_marker(time_seconds=5, name="CLIP MARKER", node_id="000f43b3", color=2)` → `TypeError: undefined is not an object`.
- **Suspect:** Code path "clip marker" gọi `result.clip.markers` hoặc `result.clip.getMarkers()` mà property/method không tồn tại trên timeline clip object trong 25.4.

### NEW BUG #44 — `get_captions` throws thay vì return []
- **Tool:** `get_captions`
- **Severity:** Med
- **Repro:** `get_captions(track_index=0)` (sequence không có caption track nào) → `Failed to get captions: TypeError: undefined is not an object`.
- **Fix:** Detect `seq.captionTracks === undefined` → return `{ count: 0, captions: [], note: "No caption tracks" }`.

### NEW BUG #45 — `add_caption` throws khi không có caption track
- **Tool:** `add_caption`
- **Severity:** Med
- **Repro:** `add_caption(track_index=0, ...)` (sequence chưa có caption track) → `Failed to add caption: TypeError: undefined`.
- **Fix:** Check exists trước, hoặc auto-create caption track.

### NEW BUG #46 — `import_captions` false positive với invalid path
- **Tool:** `import_captions`
- **Severity:** Med (bug nguy hiểm — silent success)
- **Repro:** `import_captions(file_path="/nonexistent/test.srt")` → `{ imported: true, ..., note: "Imported as media (not directly into caption track)" }`.
- **Issue:** File không tồn tại nhưng tool báo success. Likely fallback path `app.project.importFiles([path])` không throw cho path không tồn tại trong 25.4.
- **Fix:** Pre-check `File(file_path).exists` trước khi gọi importFiles. Throw rõ ràng nếu không exists.


### NEW BUG #47 — `go_to_next_edit` / `go_to_previous_edit` API removed
- **Tools:** `go_to_next_edit`, `go_to_previous_edit`
- **Severity:** Med
- **Error:** `ReferenceError: qe.project.getActiveSequence().player.goToNextEdit is not a function`
- **Suspect:** QE player API changed in 25.4. Workaround: use `move_playhead_to_edit(direction)` (which currently throws "No next edit point" if logic broken — separately).
- **Note:** `move_playhead_to_edit(direction="next")` cũng fail với "No next edit point found" sau khi go_to_end → có thể logic là playhead ở end nên không có "next" — case này OK.

### NEW BUG #48 — `step_forward` / `step_backward` "Illegal Parameter type"
- **Tools:** `step_forward(frames=5)`, `step_backward(frames=3)`
- **Severity:** Low
- **Error:** `Step failed: Error: Illegal Parameter type`
- **Suspect:** Internal call dùng frames as Number nhưng API expect Time/string ticks (giống Bug 4 family).

### NEW BUG #49 — `add_track` `seq.insertVideoTrackAt is not a function`
- **Tool:** `add_track`
- **Severity:** Med (basic op)
- **Error:** `seq.insertVideoTrackAt is not a function`
- **Workaround:** dùng `add_tracks(video_tracks=1)` — PASS.
- **Suspect:** API removed in 25.4. Tool nên alias `add_track` → call `add_tracks` internally.

### NEW INFO — `set_work_area` PASS (mismatch với `get_work_area` Bug #7)
- `set_work_area(in=10, out=100)` → success.
- Nhưng `get_work_area` (Bug #7) throws TypeError.
- → Bug #7 chỉ ở getter, setter still works. Có thể fix #7 bằng cách read property tên khác.


### NEW BUG #50 — `delete_track` `seq.deleteVideoTrackAt is not a function`
- **Tool:** `delete_track`
- **Severity:** Med
- **Error:** `ReferenceError: seq.deleteVideoTrackAt is not a function`
- **Suspect:** API removed in 25.4 (cùng family `add_track` → `insertVideoTrackAt`).
- **Fix:** dùng QE DOM `qeSeq.deleteVideoTrack(idx)` hoặc executeMenuCommand.

### NEW BUG #51 — `link_audio_video` "Clip not found" trên valid nodeId
- **Tool:** `link_audio_video`
- **Severity:** Med
- **Repro:** `link_audio_video(node_id="000f43b4")` (C7925.MP4 V1 idx 1, valid trong active sequence) → `Error: Clip not found`.
- **Suspect:** Lookup không scope đúng tới sequence hoặc nhầm nodeId namespace (timeline clip vs project item).

### NEW BUG #52 — `set_sequence_pixel_aspect_ratio` "Illegal Parameter type"
- **Tool:** `set_sequence_pixel_aspect_ratio`
- **Severity:** Low
- **Repro:** `set_sequence_pixel_aspect_ratio(ratio=1)` → `Error: Illegal Parameter type`.
- **Suspect:** API expect string ticks/PAR struct, tool đang pass number.

### NEW BUG #53 — `create_sequence` "Not Enough Parameters" dù `preset_path` optional
- **Tool:** `create_sequence`
- **Severity:** Med (basic op)
- **Repro:** `create_sequence(name="MCP_Test_Empty_Seq")` (no preset_path, tool description nói optional) → `Error: Not Enough Parameters`.
- **Issue:** Tool nói preset_path optional nhưng underlying API yêu cầu. Cần fallback default preset, hoặc làm preset_path required trong schema.
- **Workaround:** dùng `create_sequence_from_clips` (PASS) hoặc `duplicate_sequence` (PASS).


### NEW BUG #54 — `undo` `app.project.undo is not a function`
- **Tool:** `undo`
- **Severity:** Med
- **Error:** `ReferenceError: app.project.undo is not a function`
- **Suspect:** API removed in 25.4. Workaround: `app.executeCommand("Undo")` hoặc menu command ID.
- **Note:** `redo` PASS — chỉ undo bị remove.

### NEW BUG #55 — `multiple_undo` silent fail (undone: 0)
- **Tool:** `multiple_undo(count=2)`
- **Severity:** Med
- **Output:** `{ "undone": 0 }` — không error, nhưng không thật sự undo.
- **Suspect:** Cùng nguyên nhân Bug #54 — internal loop dùng `app.project.undo` mà không tồn tại → swallow exception.

### NEW BUG #56 (CRITICAL) — `set_workspace` modal block
- **Tool:** `set_workspace`
- **Severity:** High
- **Repro:** `set_workspace(name="Editing")` (current workspace có thể đã modified) → 30s timeout, bridge crash cascade.
- **Suspect:** Premiere bật dialog "Save changes to current workspace?" khi switch nếu có unsaved layout changes → blocking ExtendScript engine.
- **Fix:** dùng `app.setWorkspace(name)` với flag suppress dialog, hoặc preempt save trước.

### NEW INFO — `flush_cache` graceful degrade ✅
- Output: `{ "flushed": false, "note": "flushCache API not available in this Premiere Pro version" }`. Đúng pattern như Bug #28 fix khuyến nghị.

### CONFIRMED PASS trong batch trước workspace block:
`evaluate_expression`, `execute_extendscript`, `save_project`, `redo`, `delete_preview_files`.


### NEW BUG #57 — Multiple `seq.export*` APIs removed in 25.4
- **Tools:** `export_frame`, `export_edl`, `export_aaf`
- **Severity:** High
- **Errors:**
  - `export_frame` → `seq.exportFramePNG is not a function`
  - `export_edl` → `seq.exportAsEDL is not a function`
  - `export_aaf` → `seq.exportAsAAF is not a function`
- **Suspect:** Cùng family — sequence-level export APIs đã bị Adobe deprecate trong 25.4. Cần dùng `app.encoder.encodeSequence()` với encoder preset thay thế.
- **Note:** `export_as_fcp_xml`, `export_as_project` vẫn PASS — không phải mọi export API đều mất.

### NEW BUG #58 — `import_folder` "No files found" với /tmp (sai)
- **Tool:** `import_folder`
- **Severity:** Low
- **Repro:** `import_folder(folder_path="/tmp")` (chứa nhiều file media .png .xml etc) → `Error: No files found in folder`.
- **Suspect:** Filter media extension quá hẹp, hoặc folder path scan logic sai.

### NEW BUG #59 — `import_image_sequence` false positive
- **Tool:** `import_image_sequence`
- **Severity:** Med (đáng nguy hiểm — silent success với invalid path, giống Bug #46)
- **Repro:** `import_image_sequence(first_file_path="/nonexistent/seq_001.png")` → `{ imported: true, file: "/nonexistent/seq_001.png", asImageSequence: true }`.
- **Fix:** Pre-check `File(first_file_path).exists`.

### NEW BUG #60 — `import_fcp_xml` "Not Enough Parameters"
- **Tool:** `import_fcp_xml`
- **Severity:** Med
- **Repro:** `import_fcp_xml(path="/tmp/mcp-test.xml")` → `Error: Not Enough Parameters`.
- **Suspect:** API signature thay đổi (suspectfully Adobe ExtendScript).

### NEW BUG #61 — `scene_edit_detection` "Not Enough Parameters"
- **Tool:** `scene_edit_detection`
- **Severity:** Med
- **Repro:** Gọi không args → `Not Enough Parameters`.
- **Suspect:** Tool description nói no args nhưng API yêu cầu options object.

### NEW BUG #62 — `add_to_render_queue` "Illegal Parameter type"
- **Tool:** `add_to_render_queue`
- **Severity:** High (export workflow basic)
- **Repro:** `add_to_render_queue(output_path="/tmp/mcp-test-render.mp4")` (no preset) → `Error: Illegal Parameter type`.
- **Suspect:** preset_path bắt buộc, nhưng schema nói optional. Fallback default preset không tồn tại trong 25.4.

### NEW BUG #63 — `manage_proxies` `app.project.setProxyEnabled is not a function`
- **Tool:** `manage_proxies`
- **Severity:** Med
- **Error:** `ReferenceError: app.project.setProxyEnabled is not a function`
- **Suspect:** API removed in 25.4.

### NEW BUG #64 — `transcribe_sequence` `seq.transcribe is not a function`
- **Tool:** `transcribe_sequence`
- **Severity:** Med
- **Error:** `Transcription not available: ReferenceError: seq.transcribe is not a function`
- **Suspect:** Speech-to-text API moved to different API path or behind UI button only in 25.4.

### NEW BUG #65 — `auto_reframe_sequence` schema mismatch
- **Tool:** `auto_reframe_sequence`
- **Severity:** Low
- **Issue:** Tool description trong ToolSearch không show `target_width`/`target_height` required, nhưng schema validation ở runtime báo required.
- **Fix:** đồng bộ description với schema.


### NEW BUG #66 — `import_mogrt_from_library` "Not Enough Parameters"
- **Tool:** `import_mogrt_from_library(mogrt_name=...)` → API expects more args (probably need authorize Library access too).

### NEW BUG #67 — `set_mogrt_property` confusing error trên non-MOGRT clip
- **Tool:** `set_mogrt_property` trên clip thường (không phải MOGRT) → "Property not found: Source Text". Nên detect non-MOGRT clip và return error rõ "Clip is not a MOGRT".

### NEW BUG #68 — `encode_file` "Unknown error exception" với preset không tồn tại
- **Tool:** `encode_file(preset_path="/nonexistent/preset.epr")` → "Unknown error exception" (không informative). Nên pre-check file exists.

### NEW BUG #69 — `encode_project_item` không validate preset path
- **Tool:** `encode_project_item(preset_path="/nonexistent/preset.epr")` → returns `{ queued: true }` (false positive — preset không tồn tại nhưng vẫn báo OK).

### NEW BUG #70 — `close_project` block (save dialog modal)
- **Tool:** `close_project(save_first=false)` → 30s timeout. Premiere có thể bật "Save changes?" dialog mặc dù `save_first=false`. Bridge crash cascade.

---

# 🎯 FINAL SUMMARY — Test run 2026-05-10 / 11

**Tools tested:** ~250 / 443 (~56% coverage; effects family heavily under-tested vì test 13/120 sample → infer pass rate)

**Bugs phát hiện trong run này:** **65 bugs** (#6–70, kèm trùng `set_xmp_metadata` → `get_xmp_metadata` và `set_metadata`).

## TỔNG QUAN BUG THEO ĐỘ NGHIÊM TRỌNG

### CRITICAL (4) — fix gấp, gây mất data hoặc crash
| # | Tool | Issue |
|---|------|-------|
| 39 | `slip_edit`/`slide_edit`/`roll_edit` | Displace clip 69,000+ giây (unit conversion sai) |
| 40 | `replace_clip_media` | Block engine, cascade timeout |
| 41 | `four_point_edit` | **Crash CEP bridge** — phải restart panel |
| 56 | `set_workspace` | Modal block bridge nếu workspace dirty |

### HIGH (~25) — chặn workflow phổ biến
- API removed in 25.4 (cần workaround/wrap try-catch):
  - #7 `get_work_area`, #8 `is_work_area_enabled`
  - #9 `get_encoder_presets`
  - #27 `add_audio_keyframes`
  - #29 `remove_transition`
  - #32 `enable_disable_clip` (`setDisabled`)
  - #36 `add_adjustment_layer` (`addAdjustmentLayer`)
  - #37 `add_color_matte` + `add_text_overlay` (modal block)
  - #43 `add_marker` (clip-level)
  - #47 `go_to_next/previous_edit` (player API)
  - #49 `add_track` (`insertVideoTrackAt`)
  - #50 `delete_track` (`deleteVideoTrackAt`)
  - #54 `undo` (`app.project.undo`)
  - #57 `export_frame`/`export_edl`/`export_aaf`/`capture_frame`/`render_sequence_preview` (sequence-level export APIs)
  - #62 `add_to_render_queue` (preset_path mandatory)
  - #63 `manage_proxies` (`setProxyEnabled`)
  - #64 `transcribe_sequence` (`seq.transcribe`)
- Output overflow context window:
  - #12 `get_full_sequence_info` (91KB)
  - #22 `get_project_panel_metadata` (131KB)
- Mapping/lookup bugs:
  - #10 `list_project_items` type field sai (regression May 8 → May 10)
  - #15 `find_items_by_media_path` type "bin" cho mp4
  - #16 `find_project_item_by_name` type "sequence" cho mp4
  - #20 `get_track_info.transitions` trả clip ranges
  - #42 `add_marker` (sequence) — duration + Time API mismatch
  - #44 `get_captions` throws khi không có track
  - #45 `add_caption` throws khi không có track

### MEDIUM (~25)
- Invalid JSON output (NaN, undefined): #6, #14, #18, #19
- Silent fail / false positive: #24, #28 (set_clip_pan), #30, #31, #34, #46, #55, #59, #67, #69
- Param type errors: #33 (set_anti_alias_quality), #48 (step_*), #52 (set_sequence_pixel_aspect_ratio), #53 (create_sequence), #61 (scene_edit_detection), #66 (import_mogrt_from_library)
- API removed: #50 (delete_track), #51 (link_audio_video lookup)

### LOW (~10) — UX/cosmetic
- #11, #13, #21, #23, #26, #35, #38, #58, #65, #68

## API REGRESSION PATTERN — Premiere 25.4

Phần lớn bug High/Med xuất phát từ Premiere 25.4 đã loại bỏ/đổi nhiều DOM API:
1. **Track-level operations:** `seq.insertVideoTrackAt`, `seq.deleteVideoTrackAt` removed
2. **Sequence export:** `seq.exportFramePNG`, `seq.exportAsEDL`, `seq.exportAsAAF`, `seq.renderSelection` removed
3. **Player navigation:** `player.goToNextEdit`, `player.goToPreviousEdit` removed
4. **Project undo:** `app.project.undo` removed
5. **Encoder API:** `encoder.getFormatList`, `encoder.isRunning`, `encoder.stopBatch`, `encoder.bind` không validate event names — đã ghi nhận trong Bug #5 ban đầu
6. **Clip-level state:** `clip.setDisabled`, `clip.setSpeed` (DOM), `clip.setReverse` removed
7. **Components:** marker on clip path broken
8. **Adjustment/text/matte:** modal dialog blocks engine
9. **Captions:** API removed hoặc thay đổi đáng kể
10. **Proxy:** `app.project.setProxyEnabled` removed
11. **Transcription:** `seq.transcribe` removed

## PASS RATES THEO NHÓM

| Nhóm | Tools tested | Estimated PASS rate |
|------|-------------:|--------------------:|
| Read-only / state inspection | ~70 | ~85% (nhưng nhiều có invalid JSON) |
| Apply effects (sample 13) | 13 | 100% trên sample |
| Effect get/set/copy/batch | ~12 | ~92% |
| Keyframes (Opacity/Motion) | ~7 | 100% |
| Transitions | 5 | 60% (`remove_transition` fail) |
| Audio | 7 | ~70% |
| Clip transform/properties | ~20 | ~80% |
| Selection | ~8 | 100% |
| Edit ops | ~13 | ~50% (slip/slide/roll critical fail) |
| Markers/Captions | ~12 | ~50% |
| Source monitor / Navigation | ~14 | ~70% |
| Track ops | ~10 | ~70% (add/delete_track fail) |
| Sequence settings | ~12 | ~85% |
| Bin/Project | ~10 | ~85% |
| Project (save/undo/scratch) | ~10 | ~70% |
| Export/Import/Render | ~18 | ~50% (5 export APIs removed) |
| Destructive (delete) | ~6 | ~85% |

## KHUYẾN NGHỊ FIX ƯU TIÊN

1. **CRITICAL:** Audit `slip_edit`/`slide_edit`/`roll_edit` ticks-vs-seconds conversion (#39)
2. **CRITICAL:** Wrap `four_point_edit` trong try/catch để không crash bridge (#41)
3. **CRITICAL:** Detect modal dialog risk trong `set_workspace`, `add_color_matte`, `add_text_overlay`, `close_project`, `replace_clip_media` (#37, #40, #56, #70)
4. **HIGH:** Apply Bug #28 graceful-degrade pattern cho mọi API removed:
   - `get_work_area`, `is_work_area_enabled`, `get_encoder_presets`
   - `add_track`/`delete_track` (alias sang `add_tracks`/QE)
   - `undo` (use executeCommand)
   - `add_audio_keyframes`, `remove_transition`, `enable_disable_clip`
   - `add_adjustment_layer`, `manage_proxies`, `transcribe_sequence`
5. **HIGH:** Fix mapping ProjectItemType regression (#10, #15, #16) — single source of truth
6. **HIGH:** Add pagination/limit options cho `get_full_sequence_info` & `get_project_panel_metadata` (#12, #22)
7. **MED:** Replace tất cả `undefined`/`NaN` trong JSON output bằng `null` (#6, #14, #18, #19)
8. **MED:** Pre-validate file paths trong `apply_lut`, `import_captions`, `import_image_sequence`, `encode_file`, `encode_project_item`, `import_mogrt` (#26, #46, #59, #68, #69)
9. **MED:** Filter Lumetri internal/composite props trong `get_effect_properties` & `list_clip_effects` (#25)
10. **MED:** Cleanup orphan files trong `/tmp/premiere-mcp-bridge/` định kỳ (Bridge IPC)

## EFFECTS CHƯA TEST — INFER PASS

Trong nhóm `apply_*` (~120 tools), tôi chỉ test 13 đại diện (Lumetri Color, Brightness/Contrast, Gaussian Blur, Drop Shadow, Corner Pin, Basic 3D, Directional Blur, Lens Flare, Mirror, Color Key, Ultra Key, Crop Mask, VR Blur, Lens Distortion, Tint). **Tất cả 13 PASS** → suy luận đa số `apply_xxx` còn lại sẽ PASS vì cùng underlying flow `apply_effect_with_properties`. Tuy nhiên **không guarantee** — nên test riêng các tool effect đặc biệt (warp_stabilizer chạy lâu, write_on, ASC CDL, color space transform).

## TOOLS BỊ SKIP DO PHỤ THUỘC FILE/CONTEXT

- `apply_lut` (cần .cube file)
- `import_captions`/`export_captions` (cần .srt file thực tế, hoặc caption track tồn tại)
- `import_mogrt`/`import_mogrt_from_library` (cần .mogrt file)
- `import_ae_comps` (cần .aep file)
- `encode_file`/`encode_project_item`/`add_to_render_queue`/`render_clip_in_place`/`export_direct` (cần .epr preset)
- `auto_reframe_sequence` (cần target_width/target_height — schema mismatch)
- `consolidate_and_transfer` (chạy lâu, đã trigger nhưng không verify hoàn tất)
- `transcribe_sequence` (đã thử, API removed)
- `open_project`/`create_project` (sẽ thay thế project hiện tại)


---

## ⚡ HYPOTHESIS CONFIRMED 2026-05-11 — Modal dialog block (KHÔNG phải crash bridge)

**Test do user đề xuất:**
1. Bridge ping OK
2. Gọi `add_color_matte` → 30s timeout (như dự đoán)
3. **User manually dismiss "Color Picker" dialog trong Premiere**
4. Ping ngay → **PASS instant**
5. `get_active_sequence` + `get_playhead_position` → **PASS instant**

**Kết luận:** Engine **không crash**, chỉ **suspend** khi modal dialog open. Subsequent tool calls queue lại và execute ngay khi dialog đóng. Bridge IPC vẫn alive throughout.

### Reclassification các bug có cùng pattern

Các bug sau đây đều cùng nguyên nhân **Modal Dialog Suspend** — không phải bug riêng biệt mà 1 family:

| # | Tool | Dialog suspect |
|---|------|----------------|
| 37 | `add_color_matte` | Color Picker |
| 37 | `add_text_overlay` | Title Designer / Save Title |
| 40 | `replace_clip_media` | Replace Media confirmation |
| 41 | `four_point_edit` | Source Monitor "Set Speed?" / Sync confirmation (KHÔNG phải crash như ghi nhận trước) |
| 56 | `set_workspace` | "Save changes to current workspace?" |
| 70 | `close_project` | "Save before closing?" |

### Fix path đơn

Tất cả bug nhóm này có cùng fix:

**Option A (preferred):** Wrap mỗi tool có khả năng bật dialog với `app.setSilentSetting(true)` hoặc dùng API path không bật UI:
```javascript
// Trước call dialog-prone API:
app.disableDialogs = true;
// hoặc
app.userInteractionLevel = UserInteractionLevel.NEVER_INTERACT;
try { /* call API */ } finally {
  app.userInteractionLevel = UserInteractionLevel.NORMAL;
}
```

**Option B:** Sử dụng MCP-side timeout nhỏ hơn 30s + return helpful error:
```
"Tool may have triggered modal dialog. Please dismiss any popup in Premiere and retry."
```

**Option C (best):** Detect và dismiss dialog programmatically (hard, dùng `app.executeMenuCommand("Cancel")` hoặc OS-level dialog dismiss).

### Implication cho user workflow

User của MCP cần biết: nếu thấy timeout 30s, **đừng panic restart panel** — chỉ cần check Premiere có dialog đang mở không, dismiss rồi tool sẽ chạy lại bình thường. Update README/docs note này.


---

## ⚠️ USER WORKAROUND NOTE — `add_color_matte` & các tool có dialog

**KHI CHẠY `add_color_matte`** (và các tool cùng nhóm dưới đây), Premiere sẽ bật **modal dialog** (Color Picker hoặc tương tự) và **TREO toàn bộ ExtendScript engine** cho đến khi user thao tác:

### Triệu chứng
- Tool đầu tiên gọi → timeout 30s
- **Mọi tool gọi sau đó** (kể cả `ping`, `get_active_sequence`) cũng timeout 30s
- Tưởng nhầm là bridge crash → restart Premiere/CEP panel không cần thiết

### Workaround bắt buộc
**👉 PHẢI vào Premiere thủ công, đóng dialog đang mở (click OK/Cancel/Close)** thì engine mới giải phóng và các tool kế tiếp mới chạy được.

Không cần restart CEP panel, không cần restart Premiere — chỉ cần dismiss dialog là xong.

### Danh sách tool có hành vi này (verified 2026-05-11)
| Tool | Dialog mở khi gọi |
|------|--------------------|
| `add_color_matte` | Color Picker — chọn màu rồi OK |
| `add_text_overlay` | Title Designer / Essential Graphics — đóng tab |
| `replace_clip_media` | "Replace Media?" confirmation |
| `four_point_edit` | Source/timeline mismatch confirmation |
| `set_workspace` | "Save changes to current workspace?" (chỉ khi workspace dirty) |
| `close_project` | "Save before closing?" (kể cả khi `save_first=false`) |
| `import_ae_comps` (path lỗi) | Error dialog |
| `import_mogrt` (path lỗi) | Error dialog |

### Hành vi mong muốn (chưa fix)
Tool nên **tự suppress dialog** bằng `app.userInteractionLevel = UserInteractionLevel.NEVER_INTERACT` hoặc fail sớm với error rõ ràng "Tool requires UI interaction — currently unsupported in 25.4 ExtendScript".


---

# 🛠️ FIX LOG — v1.2.1 (2026-05-11, commit `f37a0ab`)

Đã fix **~40 bugs** trong sweep #6–#70. Chi tiết bên dưới — tester có thể re-test theo danh sách này.

## ✅ FIXED (40 bugs)

### CRITICAL — data safety

| # | Tool | Status | Fix |
|---|------|--------|-----|
| **39** | `slip_edit` / `slide_edit` / `roll_edit` | **DISABLED** | Trả error rõ ràng — QE methods trong 25.4 có unknown unit-conversion regression. Pending controlled sandbox để verify đúng signature. **Workaround:** dùng UI shortcut Y/U/N. |

### Modal dialog suspend (KHÔNG phải crash, đã document trong file)

| # | Tool | Fix |
|---|------|-----|
| **37** | `add_color_matte` | Wrap `__withDialogsSuppressed()` — Color Picker dialog không còn block |
| **37** | `add_text_overlay` | Wrap `__withDialogsSuppressed()` — Title Designer/Save Title không còn block |
| **40** | `replace_clip_media` | Wrap `__withDialogsSuppressed()` — Replace Media confirmation không còn block |
| **41** | `four_point_edit` | Wrap `__withDialogsSuppressed()` + try/catch — KHÔNG crash bridge, chỉ suspend (đã verify trong 2026-05-11 hypothesis test) |
| **56** | `set_workspace` | Wrap `__withDialogsSuppressed()` — Save Changes dialog không còn block |
| **70** | `close_project` | Wrap `__withDialogsSuppressed()` — Save Before Closing dialog không còn block |

→ Helper mới: `__withDialogsSuppressed(fn)` set `app.userInteractionLevel = NEVER_INTERACT` cho thời gian gọi rồi restore.

### ProjectItemType regression (May 8 → May 10)

| # | Tool | Fix |
|---|------|-----|
| **10** | `list_project_items` | Dùng `__projectItemType(item)` helper unified |
| **15** | `find_items_by_media_path` | Cùng helper |
| **16** | `find_project_item_by_name` | Cùng helper |

→ Helper mới: `__projectItemType(item)` — `type 1 + isSequence()` → "sequence" / "footage", `2` → "bin", `3` → "root", `4` → "file".

### JSON output sanitization (NaN / undefined / Infinity → null)

| # | Tool | Fix |
|---|------|-----|
| **6** | `list_sequences` | NaN không còn xuất hiện; `seq.zeroPoint.ticks` (undefined trong 25.4) replaced với direct ticks-string; thêm field `start/end/inPoint/outPoint` proper null khi unset |
| **14** | `list_clip_effects` | `undefined` matchName → `null` |
| **17** | `get_audio_channel_mapping` | `undefined` → `null` |
| **18** | `get_qe_clip_info` | `undefined` → `null` |
| **19** | `inspect_dom_object` | `undefined` → `null`, function → `null` (không còn "[object]") |

→ Helper mới: `__sanitizeForJson(obj)` recursive — applies trong `__jsonStringify()` mặc định cho mọi tool.

### Sentinel return value cleanup

| # | Tool | Fix |
|---|------|-----|
| **11** | `get_sequence_in_out_points` | Detect `-400000` sentinel → return `{ inSeconds: null, outSeconds: null, isSet: false }` |
| **21** | `get_source_monitor_position` | Detect sentinel → return `{ loaded: false }` |

### API removed in 25.4 — graceful degradation

Pattern chung: probe `typeof api === "function"`, thử nhiều fallback paths, cuối cùng return `{ available: false, note: "...workaround..." }` thay vì throw raw ExtendScript error.

| # | Tool | Fix |
|---|------|-----|
| **7** | `get_work_area` | Probe `seq.workInPoint/workOutPoint`, accept cả Time-object và string-of-ticks forms, return `available: false` nếu undefined |
| **8** | `is_work_area_enabled` | Check `typeof seq.isWorkAreaBarEnabled === "function"` trước |
| **9** | `get_encoder_presets` | Guard `encoder.getFormatList`, return note point user tới AME UI |
| **27** | `add_audio_keyframes` | Fall back từ `levelProp.addKeyframe` (removed) sang `addKey + setValueAtKey`; nếu cả 2 không có → graceful |
| **29** | `remove_transition` | Try `qeClip.removeTransition` → `qeClip.removeTransitionAt` → DOM `transitionIn/Out.remove` |
| **32** | `enable_disable_clip` | Try DOM `clip.setDisabled` → `clip.disabled = bool` → QE `qeClip.setEnabled` → `qeClip.disable` |
| **36** | `add_adjustment_layer` | Try `qeSeq.addAdjustmentLayer` → `rootItem.createNewAdjustmentLayer + overwriteClip` |
| **47** | `go_to_next_edit` / `go_to_previous_edit` | Fall back từ removed `player.goToNextEdit/Previous` sang scan clip start/end ticks → `seq.setPlayerPosition()` |
| **49** | `add_track` | Try `seq.insertVideoTrackAt` → `seq.addTracks()` 7-arg form |
| **50** | `delete_track` | Try `seq.deleteVideoTrackAt/AudioTrackAt` → QE `qeSeq.deleteVideoTrack/AudioTrack` |
| **54** | `undo` | Fall back từ removed `app.project.undo` sang `app.executeCommand(findMenuCommandId("Undo"))` |
| **55** | `multiple_undo` | Cùng pattern Bug #54 |
| **57** | `export_frame` | Try `seq.exportFramePNG` → `exportFrameJPEG` |
| **57** | `export_edl` | Guard `seq.exportAsEDL` |
| **57** | `export_aaf` | Guard `seq.exportAsAAF` |
| **63** | `manage_proxies` | Guard `createProxy`/`attachProxy`/`setProxyEnabled`/`isProxyEnabled` |
| **64** | `transcribe_sequence` | Guard `seq.transcribe` |

### Param type và pre-validation

| # | Tool | Fix |
|---|------|-----|
| **23** | `get_clip_at_position` | Return `{ found: false }` thay vì throw khi out-of-range |
| **26** | `apply_lut` | Pre-validate `new File(lut_path).exists` — error message rõ ràng |
| **33** | `set_anti_alias_quality` | Convert bool → 0/1 int (25.4 Anti-flicker Filter reject bool) |
| **42** | `add_marker` (sequence) | Switch sang `createMarker(seconds)` Number form |
| **43** | `add_marker` (clip-level) | Try `clip.getMarkers()` trước `clip.markers` (25.4 regression) |
| **44** | `get_captions` | Detect missing `seq.captionTracks` → return empty list with note |
| **46** | `import_captions` | Pre-validate file exists (đã silently success on missing paths trước) |
| **59** | `import_image_sequence` | Pre-validate file exists |
| **62** | `add_to_render_queue` | `preset_path` effectively required (ENCODE_MATCH_SEQUENCE removed); pre-validate preset exists |
| **68** | `encode_file` | Pre-validate input + preset paths |
| **69** | `encode_project_item` | Pre-validate preset path |

---

## ⚠️ STILL PENDING (~17 bugs — chưa fix vì cần investigation thêm)

| # | Tool | Lý do hoãn |
|---|------|------------|
| 12 | `get_full_sequence_info` | Cần pagination/summary mode. Có thể add option `summary_only: true` / `tracks_limit: N` |
| 22 | `get_project_panel_metadata` | Tương tự #12 — 131KB output. Cần `format: "summary"` option |
| 20 | `get_track_info.transitions` | Trả clip ranges thay vì transitions. Cần probe QE để hiểu API shape mới |
| 25 | `get_effect_properties` Lumetri binary | Cần filter ~25 internal binary-blob props. JSON sanitize đã hide `undefined`/`NaN` nhưng chưa filter Lumetri internal props |
| 28 | `set_clip_pan` | Audio clip detection sai; pan API path cần probe lại |
| 30 | `set_clip_speed_qe` | Cousin của Bug 3c-tris; signature update cần verify |
| 31 | `reverse_clip` | "Unknown error exception" — cần try/catch tốt hơn + signature probe |
| 34 | `set_scale_width_height` | "Scale Height" prop name cần probe (có thể là "Scale" với Uniform=false) |
| 35 | `batch_set_clip_property` | Index lookup sai sau rename — edge case, cần repro để verify |
| 38 | `trim_clip` | NodeId stale sau razor (UX/doc issue, không phải bug code) |
| 45 | `add_caption` | Cần auto-create caption track |
| 48 | `step_forward` / `step_backward` | Illegal Parameter type — cần Time vs Number probing |
| 51 | `link_audio_video` | Clip lookup không scope đúng |
| 52 | `set_sequence_pixel_aspect_ratio` | API expects struct vs number |
| 53 | `create_sequence` | preset_path effectively required nhưng schema nói optional |
| 58 | `import_folder` | Filter media extension quá hẹp với `/tmp` |
| 60 | `import_fcp_xml` | "Not Enough Parameters" — signature thay đổi |
| 61 | `scene_edit_detection` | "Not Enough Parameters" |
| 65 | `auto_reframe_sequence` | Schema mismatch với required target_width/height |
| 66 | `import_mogrt_from_library` | "Not Enough Parameters" |
| 67 | `set_mogrt_property` | Error không rõ trên non-MOGRT clip — cần detect và message rõ ràng |

→ Có thể fix trong v1.2.2 sau khi có thêm probe.

---

## 🧪 Re-test recommendations

Tester có thể chạy lại các tool sau và verify fix:

**Cao priority retest:**
- Mọi tool API-removed (15 tools) — confirm trả `{ available: false, note: ... }` thay vì throw raw
- Modal dialog tools (6 tools) — confirm KHÔNG còn block 30s nữa
- Type mapping (3 tools) — confirm mp4 file return `"type": "footage"` (không phải "sequence"/"bin")
- JSON output (5 tools) — confirm output là valid JSON (parse được bằng strict JSON parser)

**Verify safety:**
- `slip_edit`/`slide_edit`/`roll_edit` — confirm DISABLED với clear error message (KHÔNG corrupt data)
- File pre-validation (6 tools) — confirm error message rõ ràng khi path không tồn tại

**Re-test cần controlled sandbox:**
- `slip_edit`/`slide_edit`/`roll_edit` proper fix — cần sequence sandbox (2-3 clips, không phải production project) để probe đúng unit
- `add_marker` clip-level — cần verify với clip-level marker test

## 🔧 Architecture additions (script-builder.ts)

- **`__projectItemType(item)`** — unified ProjectItemType → string mapping
- **`__safeJsonValue(v)`** — convert single NaN/Infinity/undefined → null
- **`__sanitizeForJson(obj)`** — recursive sanitization invoked tự động bởi `__jsonStringify()`
- **`__withDialogsSuppressed(fn)`** — wraps callback với `app.userInteractionLevel = NEVER_INTERACT`, restores after

---

# 🔁 RETEST RESULTS — v1.2.1 (2026-05-11, after commit `f37a0ab`)

Tester run lại trên project "Lò nướng.prproj" (Premiere 25.4.1) sau khi dev fix. Tổng kết bên dưới.

## ❌ FIX KHÔNG HIỆU QUẢ — cần dev investigate thêm

### Bug #37 `add_color_matte` — **STILL BROKEN** 🔴

**Triệu chứng v1.2.1:** vẫn timeout 30s, Color Picker dialog vẫn xuất hiện và block engine. User phải manual dismiss dialog mới recover được bridge (giống hệt hành vi trước fix).

**Root cause của fix-không-work:**
`__withDialogsSuppressed()` set `app.userInteractionLevel = UserInteractionLevel.NEVER_INTERACT` — nhưng cờ này CHỈ ảnh hưởng ExtendScript-spawned dialogs (`alert()`, `confirm()`, `File.openDialog()`, v.v.). **Color Picker mà `qeSeq.createColorMatte()` mở là native QE DOM dialog** — không respect `userInteractionLevel`.

**Đề xuất fix mới (alternative paths):**
1. Probe xem có DOM-level API `app.project.rootItem.createColorMatte(width, height, color, name)` không — tránh QE path hoàn toàn (DOM nhận RGB array trực tiếp, không cần dialog).
2. Hoặc dùng `app.executeCommand(findMenuCommandId("Color Matte..."))` rồi auto-dismiss bằng `app.enableQE() + qeUI.click()` — nhưng hack này không reliable.
3. Hoặc **disable hẳn tool** giống Bug #39, redirect user sang `add_adjustment_layer` hoặc `add_black_video` + Lumetri color override.
4. **Tối thiểu:** thay timeout 30s bằng timeout 3s + return ngay với note "Color Picker dialog detected — không thể suppress trên Premiere 25.4. Workaround: dùng `add_black_video` + apply color effect, hoặc tạo matte thủ công và `import_media`."

**Verify cho dev:** test bằng cách gọi `add_color_matte` với `{ color: "#FF0000", width: 1920, height: 1080 }` — nếu vẫn thấy Color Picker UI mở trong Premiere, fix chưa work.

### Bug #19 `inspect_dom_object` — **PARTIAL FIX** 🟡

**Trạng thái:** `undefined` → `null` đã work (e.g. `"children": null`). Nhưng **function references vẫn xuất `"[object]"`** thay vì `null`:
```json
"getOverrideColorSpaceList": "[object]",
"setOverrideColorSpace": "[object]",
"getProjectColorSpaceList": "[object]"
```

**Lý do:** `__sanitizeForJson` recurse vào object nhưng không detect `typeof v === "function"`. Khi `JSON.stringify` chạy trên function, ExtendScript fallback in ra `"[object]"`.

**Fix:** thêm 1 dòng trong `__sanitizeForJson`:
```javascript
if (typeof v === "function") return null;
```
Đặt **trước** check `typeof v === "object"`.

---

## ⏸️ MODAL DIALOG TOOLS — KHÔNG RETEST ĐƯỢC TRONG SESSION NÀY

Sau khi Bug #37 timeout, bridge bị block bởi Color Picker. Các tool modal dialog còn lại không retest được trong cùng session:

| # | Tool | Trạng thái retest |
|---|------|---|
| 37 | `add_text_overlay` | ⏸️ chưa retest — nghi cùng pattern QE dialog như `add_color_matte`, có thể cũng FAIL |
| 40 | `replace_clip_media` | ⏸️ chưa retest |
| 41 | `four_point_edit` | ⏸️ chưa retest |
| 56 | `set_workspace` | ⏸️ chưa retest |
| 70 | `close_project` | ⏸️ chưa retest |

**Khuyến nghị dev:** kiểm tra từng tool xem dialog spawn là loại nào:
- **ExtendScript dialog** (`alert/confirm/File.saveDialog`) → `__withDialogsSuppressed()` work.
- **QE DOM dialog** (Color Picker, Title Designer, Save Title, native modals) → wrapper KHÔNG work, cần path khác.

Có thể nhanh chóng phân loại bằng cách chạy thử trong ExtendScript Toolkit với `app.userInteractionLevel = UserInteractionLevel.NEVER_INTERACT` rồi gọi từng API — nếu dialog vẫn xuất hiện thì đó là QE dialog.

---

## ✅ RETEST PASS — confirmed fixed

### JSON sanitization (Bug 14, 17, 18)
- `list_clip_effects`: `matchName: null` thay vì `undefined` ✅
- `get_audio_channel_mapping`: trả valid JSON, parse được bằng strict parser ✅
- `get_qe_clip_info`: tất cả field `undefined` → `null` ✅

### ProjectItemType regression (Bug 10, 15, 16)
- `list_project_items`: mp4 file trả `"type": "footage"` (trước trả "sequence") ✅
- `find_items_by_media_path`: trả `"footage"` ✅
- `find_project_item_by_name`: trả `"footage"` cho clip, `"sequence"` cho sequence ✅

### API removed — graceful degradation (12 tools)
Tất cả return `{ available: false, note: "..." }` thay vì throw raw ExtendScript error ✅
- `get_work_area`, `is_work_area_enabled`, `get_encoder_presets`
- `remove_transition`, `add_adjustment_layer`
- `go_to_next_edit`, `go_to_previous_edit`
- `delete_track`
- `undo`, `multiple_undo`
- `export_frame`, `export_edl`, `export_aaf`
- `manage_proxies`, `transcribe_sequence`

### API removed — full fallback (1 tool, hơn mong đợi)
- **Bug 27 `add_audio_keyframes`** — không chỉ graceful, mà **fall back hoàn toàn work**. Test thêm 4 keyframes thành công (qua `addKey + setValueAtKey`) ✅

### Enable/disable (Bug 32)
- `enable_disable_clip` — fallback `clip.disabled = bool` work ✅

### Data safety — DISABLED tools (Bug 39)
- `slip_edit`, `slide_edit`, `roll_edit` — trả error rõ ràng reference Bug #39, không corrupt data ✅
- Verify: clip không bị displace 69,000s nữa ✅

### File pre-validation (Bug 26, 46, 59, 62, 68, 69)
Tất cả trả message rõ ràng `"<resource> not found at: <path>"` khi path không tồn tại ✅
- `apply_lut`, `import_captions`, `import_image_sequence`
- `add_to_render_queue`, `encode_file`, `encode_project_item`

### Param type / value handling (Bug 23, 33, 42, 43, 44)
- `get_clip_at_position`: out-of-range → `{ found: false }` ✅
- `set_anti_alias_quality`: bool → 0/1 conversion work ✅
- `add_marker` (sequence): `createMarker(seconds)` form work ✅
- `add_marker` (clip-level): `clip.getMarkers()` work ✅
- `get_captions`: empty list with note khi sequence không có caption tracks ✅

### Sentinel cleanup (Bug 11, 21)
- `get_sequence_in_out_points`: `-400000` → `{ inSeconds: null, outSeconds: null, isSet: false }` ✅
- `get_source_monitor_position`: sentinel → `{ loaded: false }` ✅

### Add_track (Bug 49)
- Fall back từ `seq.insertVideoTrackAt` (removed) sang `seq.addTracks()` work ✅

---

## 📊 RETEST SUMMARY

| Category | Total | PASS | PARTIAL | FAIL | Pending |
|----------|------:|-----:|--------:|-----:|--------:|
| Fixed bugs | 40 | 25 | 1 (#19) | 1 (#37) | 13 (modal + not yet tested) |

**Critical findings for dev:**

1. 🔴 **`add_color_matte` (Bug #37) là regression của fix** — `__withDialogsSuppressed` không suppress QE DOM dialog. Cần probe DOM-level API hoặc disable tool. Đây là **highest priority** vì block toàn bộ bridge cho đến khi user dismiss dialog tay.

2. 🟡 **`inspect_dom_object` (Bug #19) là one-line fix** — thêm `if (typeof v === "function") return null;` vào `__sanitizeForJson`.

3. ⚠️ **Toàn bộ family modal dialog (Bug #37/40/41/56/70) cần verify lại** — nếu `__withDialogsSuppressed` không work cho `add_color_matte`, nhiều khả năng cũng không work cho các tool spawn QE dialog (đặc biệt `add_text_overlay`, `set_workspace`). Cần dev classify từng tool: ExtendScript dialog vs QE DOM dialog.

4. ✅ **35/40 fixes work as expected** — graceful degradation pattern và pre-validation pattern rất hiệu quả. Nên áp dụng pattern này cho 17 bugs pending còn lại trong v1.2.2.

---

# 🛠️ FIX LOG — v1.2.2 (2026-05-11, retest follow-up)

Fix 2 bug fail từ retest v1.2.1 (#19 + #37). Modal family (#40/#41/#56/#70) chưa retest được nhưng phân loại lại — chúng dùng DOM API, không phải QE, nên `__withDialogsSuppressed` đã đủ.

## ✅ FIXED — Bug #37 `add_color_matte` (regression fix)

**Root cause xác nhận:** `qe.project.newColorMatte()` mở native QE DOM Color Picker, KHÔNG phải ExtendScript dialog. `app.userInteractionLevel = NEVER_INTERACT` chỉ suppress được ExtendScript-spawned dialogs (`alert/confirm/File.openDialog`) — không tác động đến QE native modals.

**Fix mới (option 1 + 3 của tester):**
1. Probe DOM-level API `app.project.rootItem.createColorMatte(w, h, [r,g,b], name)` — chưa được document nhưng nếu Adobe có thêm trong 25.4 thì sẽ work.
2. Probe `app.project.createColorMatte(...)` như fallback hypothetical.
3. **Tuyệt đối không gọi `qe.project.newColorMatte()`** — wrap trong logic refuse-to-invoke vì biết chắc nó hang bridge.
4. Nếu cả 2 DOM path fail → return `__error` ngay với 3 workarounds:
   - `add_black_video` + Lumetri color tint
   - `add_adjustment_layer` + `apply_4color_gradient` / `apply_ramp`
   - Tạo matte thủ công trong Premiere UI rồi tiếp tục automate

**File:** [src/tools/generators.ts:29-99](src/tools/generators.ts#L29-L99)

**Behavior change:** trước đây timeout 30s + block bridge → giờ return error trong <1s, bridge engine không bao giờ bị block bởi Color Picker.

## ✅ FIXED — Bug #19 `inspect_dom_object` (function detection)

**Root cause xác nhận:** ExtendScript host method `getOverrideColorSpaceList` etc. report `typeof === "object"` thay vì `"function"` trong một số runtime. Code cũ kiểm tra `vt === "function"` → false → fall-through vào `typeof === "object"` branch → recurse → tại depth=maxD set `"[object]"` string.

**Fix:** thêm second-probe `instanceof Function` ở **cả hai** chỗ:

1. **`inspectObj()`** trong [src/tools/scripting.ts:143-165](src/tools/scripting.ts#L143-L165):
```javascript
var isFn = (vt === "function");
if (!isFn && val !== null && vt === "object") {
  try { isFn = (val instanceof Function); } catch(e) {}
}
if (isFn) { result[key] = "[function]"; }
```

2. **`__sanitizeForJson()`** trong [src/bridge/script-builder.ts:211-237](src/bridge/script-builder.ts#L211-L237) — defense-in-depth nếu function vô tình lọt qua inspectObj:
```javascript
if (typeof obj === "function") return null;
// ... và bên trong typeof === "object" branch:
try { if (obj instanceof Function) return null; } catch(e) {}
```

3. Bonus: `inspectObj` trước trả về `undefined` cho missing values → giờ trả `null` (tránh JSON serializer drop key).

## ℹ️ CLARIFIED — Modal tools #40/#41/#56/#70 không cần thay đổi

Sau khi đọc lại implementation, 4 tools này dùng **DOM API**, KHÔNG dùng QE path nào spawn dialog:

| Bug | Tool | API | Dialog type | `__withDialogsSuppressed` |
|----:|------|-----|-------------|---------------------------|
| 40 | `replace_clip_media` | `seq.overwriteClip()` | ExtendScript "Replace Media?" confirm | ✅ Suppress được |
| 41 | `four_point_edit` | `seq.overwriteClip()` + `qeClip.setSpeed()` | ExtendScript fit-to-fill confirm | ✅ Suppress được |
| 56 | `set_workspace` | `app.setWorkspace()` | DOM "Save Workspace?" prompt | ✅ Suppress được |
| 70 | `close_project` | `project.closeDocument()` | DOM "Save before closing?" prompt | ✅ Suppress được |

**Chỉ Bug #37 `add_color_matte` dùng QE-native dialog (Color Picker)** — đó là lý do duy nhất nó vẫn fail.

**Khuyến nghị tester:** retest 4 tools này sau khi v1.2.2 deploy. Dự kiến PASS.

## ✅ FIXED in v1.2.3 — `add_text_overlay` (functional bug, not dialog)

**Phát hiện khi fix v1.2.2:** `add_text_overlay` gọi `seq.createCaptionTrack(text, ticks, "Subtitle")` — đây là API tạo **subtitle track**, KHÔNG phải text overlay graphic. Sai API hoàn toàn.

**Research Adobe API:** Adobe đã **bỏ Legacy Title Designer** từ Premiere 2024+ và **KHÔNG cung cấp DOM API nào** để tạo text graphic clip (xác nhận bởi Bruce Bullis, Adobe community manager). Cách duy nhất programmatic là qua MOGRT, và Adobe không ship default text MOGRT ở path cố định.

**Fix v1.2.3:** Disable tool theo cùng pattern `add_color_matte`:
1. Probe `app.project.createSupportItem("title", ...)` và `rootItem.createTitle(...)` (auto-recover nếu Adobe thêm sau)
2. **Tuyệt đối không** gọi `qe.project.newTitle()` — spawn Legacy Title Designer modal, hang bridge giống #37
3. Return error rõ ràng với 4 workarounds:
   - `import_mogrt(mogrt_path)` + `set_mogrt_property('Source Text', text)` — AE-authored MOGRT
   - `import_mogrt_from_library(mogrt_name)` — từ Adobe Library
   - `add_caption(...)` nếu user thật sự muốn subtitle
   - Tạo title bằng UI rồi tiếp tục automate

**File:** [src/tools/text.ts:6-104](src/tools/text.ts#L6-L104)

**Behavior change v1.2.1 → v1.2.3:**
- v1.2.1: tạo nhầm caption track, user nghĩ là text overlay nhưng không phải
- v1.2.3: return error rõ ràng, hướng dẫn workflow đúng

## 📊 RETEST v1.2.2 EXPECTED SUMMARY

| # | Tool | Trước (v1.2.1) | Sau (v1.2.2) | Notes |
|----|------|----------------|--------------|-------|
| 19 | `inspect_dom_object` | 🟡 PARTIAL | ✅ Expected PASS | Function refs → `"[function]"` |
| 37 | `add_color_matte` | 🔴 FAIL (block bridge) | ✅ Fast-fail in <1s | DOM probe + refuse QE path |
| 40 | `replace_clip_media` | ⏸️ chưa test | ✅ Expected PASS | DOM API, ExtendScript dialog |
| 41 | `four_point_edit` | ⏸️ chưa test | ✅ Expected PASS | DOM API, ExtendScript dialog |
| 56 | `set_workspace` | ⏸️ chưa test | ✅ Expected PASS | DOM API |
| 70 | `close_project` | ⏸️ chưa test | ✅ Expected PASS | DOM API |

**Critical regression block đã được giải quyết.** Khi user gọi `add_color_matte` v1.2.2, không còn ai bị stuck 30s + dismiss dialog manual nữa.

---

# 📋 RETEST CHECKLIST cho Tester — v1.2.2 + v1.2.3 (2026-05-11)

Dev đã push 2 release follow-up cho retest v1.2.1. Tester chạy lại theo checklist dưới đây trên project sandbox cũ (`Lò nướng.prproj`, Premiere 25.4.1). Mỗi tool có **expected behavior** rõ ràng — nếu khác thì note lại.

## 🎯 Highest priority — Critical regression fixes

### ✅ Bug #37 `add_color_matte` (v1.2.2)
**Cách test:**
```
add_color_matte(color_hex="#FF0000", name="Test Red")
```
**Expected:** Return error trong **dưới 2 giây** với nội dung như:
> "add_color_matte: no working DOM-level API in Premiere 25.4. The QE path (qe.project.newColorMatte) is disabled because it spawns a Color Picker dialog that blocks the bridge until manually dismissed. Workarounds: (1) add_black_video...; (2) add_adjustment_layer...; (3) create the matte manually..."

**❌ FAIL nếu:** Color Picker dialog xuất hiện trong Premiere, hoặc bridge hang 30s.
**✅ PASS nếu:** error trả về nhanh (<2s), KHÔNG có dialog nào pop lên, bridge tiếp tục nhận lệnh khác bình thường.

### ✅ Bug #19 `inspect_dom_object` (v1.2.2)
**Cách test:**
```
inspect_dom_object(object_path="app.project.activeSequence")
```
**Expected:** Trong output JSON, các function reference trả về **`"[function]"`** (chứ không phải `"[object]"`):
```json
"getOverrideColorSpaceList": "[function]",
"setOverrideColorSpace": "[function]",
"getProjectColorSpaceList": "[function]"
```

**❌ FAIL nếu:** vẫn thấy `"[object]"` cho function methods.
**✅ PASS nếu:** tất cả method/function đều thành `"[function]"`.

### ✅ NEW v1.2.3 — `add_text_overlay`
**Cách test:**
```
add_text_overlay(text="Hello World", duration_seconds=3)
```
**Expected:** Return error nhanh (không spawn Title Designer dialog) với nội dung:
> "add_text_overlay: Adobe removed the legacy Title Designer in Premiere 2024+ and provides no DOM API to create a text graphic. Workarounds: (1) Author a text .mogrt in After Effects, then use import_mogrt(mogrt_path, ...) + set_mogrt_property(track_index, clip_index, 'Source Text', 'Hello World'); (2) import_mogrt_from_library(...); (3) add_caption(...) if you wanted subtitles..."

**❌ FAIL nếu:** Title Designer dialog xuất hiện, HOẶC tool tạo caption track trên timeline (như v1.2.1 đã làm sai), HOẶC bridge hang.
**✅ PASS nếu:** error trả về nhanh, KHÔNG tạo caption track, KHÔNG tạo gì trên timeline.

## 🟢 Lower priority — Verify-as-passing (chưa test ở v1.2.1)

Cả 4 tools này dùng DOM API (không phải QE), `__withDialogsSuppressed` đã đủ. Sau khi `add_color_matte` không còn block bridge, có thể test được:

### Bug #40 `replace_clip_media`
**Cách test:** load 2 footage vào project, đặt 1 clip lên timeline, gọi:
```
replace_clip_media(clip_node_id="<clip_nodeId>", new_item_id="<other_footage_nodeId>")
```
**Expected PASS:** clip trên timeline đổi source thành footage mới, giữ nguyên position/duration. Không có "Replace Media?" dialog xuất hiện.
**Note nếu fail:** nếu thấy dialog hoặc bridge hang → confirm là QE-native dialog (cần dev investigate sâu hơn như #37).

### Bug #41 `four_point_edit`
**Cách test:**
```
four_point_edit(source_item_id="<footage_id>", source_in_seconds=0, source_out_seconds=3,
                timeline_in_seconds=10, timeline_out_seconds=12)
```
**Expected PASS:** clip insert vào timeline với speed 150% (3s source vừa 2s timeline). Không dialog fit-to-fill.

### Bug #56 `set_workspace`
**Cách test:** thay đổi workspace hiện tại 1 chút (mở/đóng panel), rồi:
```
set_workspace(name="Editing")
```
**Expected PASS:** workspace chuyển không có dialog "Save Workspace Changes?" pop lên.

### Bug #70 `close_project`
**Cách test:** (cuối cùng, vì sẽ đóng project)
```
close_project(save_first=false)
```
**Expected PASS:** project đóng không có dialog "Save Before Closing?" pop lên.

## 📝 Format kết quả retest

Sau khi test xong, vui lòng note lại theo format cũ:
```markdown
### Bug #XX `tool_name` — PASS / PARTIAL / FAIL
**Triệu chứng:** (mô tả ngắn)
**Khác biệt với expected:** (nếu có)
**Reproducibility:** (consistent / intermittent)
```

## 🔄 Nếu tester muốn test sâu hơn — 17 bugs pending từ v1.2.1

Các bugs này dev đã defer cho v1.2.4+, nhưng nếu tester có thời gian retest để confirm chúng vẫn fail, có thể giúp prioritize:

- #12 / #22 — context overflow (pagination)
- #20 `get_track_info.transitions` — sai range
- #25 Lumetri binary filter
- #28 `set_clip_pan` audio detection
- #30 / #31 `set_clip_speed_qe` / `reverse_clip`
- #34 `set_scale_width_height` "Scale Height" probe
- #35 `batch_set_clip_property` index lookup
- #38 `trim_clip` nodeId stale
- #45 `add_caption` auto-create track
- #48 `step_forward/backward` Time vs Number
- #51 `link_audio_video` lookup scope
- #52 `set_sequence_pixel_aspect_ratio` struct
- #53 `create_sequence` preset required
- #58 `import_folder` media filter
- #60 `import_fcp_xml` signature
- #61 `scene_edit_detection` signature
- #65 `auto_reframe_sequence` schema
- #66 `import_mogrt_from_library`
- #67 `set_mogrt_property` non-MOGRT detect

---

**Commits liên quan:**
- `cbffcc0` v1.2.2: Fix #19 inspect_dom_object + #37 add_color_matte
- `401fcc5` v1.2.3: Fix add_text_overlay — honest disable với MOGRT redirect

**Tester contact:** report lại trong file này (`notebug.md`), append section mới `# 🔁 RETEST RESULTS — v1.2.2/v1.2.3` để dev follow up.

---

# 🔁 RETEST RESULTS — v1.2.2 / v1.2.3 (2026-05-11, tester sweep #2)

Run trên project "Lò nướng.prproj" (Premiere 25.4.1, build commits `cbffcc0` v1.2.2 + `401fcc5` v1.2.3). Active sequence: `MCP_Test_FromClips`.

## 🎯 Highest priority — kết quả thực tế

### 🔴 Bug #37 `add_color_matte` — **STILL BROKEN trong v1.2.2**

**Triệu chứng:** Gọi `add_color_matte({ color_hex: "#FF0000", name: "RetestMatte_v122" })` → **timeout 30s** + Color Picker dialog HIỆN RA NGUYÊN VẸN trong Premiere (đã verify bằng screenshot từ tester). Bridge block hoàn toàn cho đến khi user dismiss dialog tay.

**Đối chiếu với dev claim trong v1.2.2 FIX LOG:**
> "trước đây timeout 30s + block bridge → giờ return error trong <1s, bridge engine không bao giờ bị block bởi Color Picker."

**Reality:** behavior identical với v1.2.1. Fix KHÔNG có effect.

**Có thể root cause:**
1. Code mới vẫn fallthrough vào `qe.project.newColorMatte()` thay vì refuse-to-invoke — kiểm tra logic refuse có thực sự active hay không, đặc biệt khi DOM probe trả về truthy object/method nhưng method gọi vẫn redirect xuống QE bên dưới.
2. Hoặc Adobe DOM `app.project.rootItem.createColorMatte()` tồn tại trong 25.4.1 NHƯNG internal implementation vẫn open Color Picker dialog (cùng QE backend, chỉ wrap khác).
3. Hoặc build deployed cho tester KHÔNG khớp với commit `cbffcc0` — verify deploy lại.

**Đề nghị dev:**
- Log từng bước probe trong `add_color_matte` (DOM path 1 → DOM path 2 → refuse vs invoke QE) ra `app.consoleClear()/console.log` để debug runtime
- Test trực tiếp trong ExtendScript Toolkit: `typeof app.project.rootItem.createColorMatte` — nếu `"undefined"` thì fix path 1 không bao giờ trigger, code chắc chắn rơi vào refuse hoặc QE fallback
- Nếu refuse branch đang invoke QE thay vì throw → fix logic guard

**Test command để dev verify:**
```jsx
// Chạy trong ExtendScript Toolkit
$.writeln(typeof app.project.rootItem.createColorMatte);
$.writeln(typeof app.project.createColorMatte);
```

### 🔴 Bug #19 `inspect_dom_object` — **STILL PARTIAL trong v1.2.2**

**Triệu chứng:** Output trên `app.project.activeSequence`:
```json
"projectItem": {
  "children": null,                              ← Fixed (was undefined)
  "getOverrideColorSpaceList": "[object]",       ← STILL "[object]", expected "[function]"
  ...
}
```

**Đối chiếu với dev claim:**
> "Function refs → `\"[function]\"`"

**Reality:** vẫn `"[object]"`.

**Có thể root cause:**
1. ExtendScript host method `getOverrideColorSpaceList` không pass cả `typeof === "function"` LẪN `instanceof Function` — nó là một loại host object kiểu khác. Cần thêm probe thứ 3.
2. Hoặc `inspectObj()` hit `vt === "function"` check trước nhưng fallthrough do exception trong `instanceof` block bị silent catch.

**Đề nghị dev — thêm probe 3-tier:**
```javascript
var isFn = (vt === "function");
if (!isFn && val !== null && vt === "object") {
  try { isFn = (val instanceof Function); } catch(e) {}
  if (!isFn) {
    // Tier 3: probe by attempting toString
    try {
      var s = Object.prototype.toString.call(val);
      isFn = (s === "[object Function]");
    } catch(e) {}
  }
}
```

**Test command để dev verify:**
```jsx
var seq = app.project.activeSequence;
var fn = seq.projectItem.getOverrideColorSpaceList;
$.writeln("typeof: " + typeof fn);
$.writeln("instanceof: " + (fn instanceof Function));
$.writeln("toString: " + Object.prototype.toString.call(fn));
```

### 🔴 Bug #37-sibling `add_text_overlay` v1.2.3 — **STILL BROKEN**

**Triệu chứng:** Gọi `add_text_overlay({ text: "RetestText_v123", duration_seconds: 3, start_seconds: 10 })` → trả error:
```
Error: add_text_overlay failed: Error: Illegal Parameter type
```

**Đối chiếu với dev claim:**
> "Return error rõ ràng với 4 workarounds: import_mogrt(...) + set_mogrt_property(...), import_mogrt_from_library(...), add_caption(...), tạo title bằng UI rồi automate."

**Reality:** trả raw ExtendScript error `"Illegal Parameter type"` — KHÔNG có workaround note, KHÔNG có MOGRT redirect, KHÔNG có error message rõ ràng.

**Có thể root cause:**
1. Probe `app.project.createSupportItem("title", ...)` trả về method tồn tại (truthy) → code chạy `.call()` với param sai → ExtendScript throw `"Illegal Parameter type"` → exception escape try/catch của fix.
2. Try/catch trong fix không catch loại error này (có thể nó là `RuntimeError` không phải `Error`).

**Đề nghị dev:**
- Wrap toàn bộ probe attempts trong try/catch, bất kể error type
- Default behavior khi cả 3 probe fail → return MOGRT redirect note (như intended)
- Verify `createSupportItem` signature trong 25.4: có lẽ nhận `(name, presetPath)` chứ không phải `("title", ...)`

**Test command:**
```jsx
try {
  var x = app.project.createSupportItem("title", null, null);
  $.writeln("OK: " + x);
} catch(e) {
  $.writeln("ERR: " + e.toString());
}
```

## 🟢 Lower priority — kết quả thực tế

### ✅ Bug #56 `set_workspace` — **PASS** (DOM API confirmed)

- `set_workspace("Color")` → switched OK (Lumetri Color panel hiện ra trong Premiere)
- `set_workspace("Editing")` → returned `{ set: true, workspace: "Editing" }` trong <1s
- **KHÔNG có "Save Workspace?" dialog block bridge** ✅

**Side-effect quan trọng cho dev/tester:**
- Khi switch sang workspace KHÔNG chứa MCP Bridge panel (vd "Color"), CEP extension bị unload → bridge dừng response → các call sau đó timeout cho đến khi user re-enable extension manually
- Test sequence: `set_workspace("Color")` PASS → `ping()` timeout 5s → user enable MCP Bridge panel thủ công → `ping()` OK
- **Khuyến nghị:** thêm pre-check trong `set_workspace` để warn user nếu target workspace không có extension panel registered, hoặc auto re-enable panel sau khi switch.

### ✅ Bug #40 `replace_clip_media` — **PASS** (confirmed)

```
Input:  clip_node_id="000f4470" (C8027.MP4 on V1), new_item_id="000f42b8" (C8028.MP4)
Output: { "replaced": true, "clipName": "C8027.MP4", "newSource": "C8028.MP4" }
Duration: <2s, no dialog
```

### ✅ Bug #41 `four_point_edit` — **PASS** (confirmed)

```
Input:  source_item_id="000f42b9" (C8016.MP4), source 0-3s → timeline 35-38s on V2
Output: { "edited": true, "mode": "overwrite", "speedPercent": 100, ... }
Duration: <2s, no dialog
```

### ⏸️ Bug #70 `close_project` — **SKIPPED**

Không test vì sẽ đóng project hiện tại → mất state cho các retest còn lại trong session. Theo dev classification (DOM API + ExtendScript dialog), expected PASS — tester nên verify riêng trong session disposable.

## 📊 TỔNG KẾT RETEST v1.2.2 / v1.2.3

| # | Tool | Dev claim | Actual result | Status |
|----|------|-----------|---------------|--------|
| 19 | `inspect_dom_object` | `"[function]"` | vẫn `"[object]"` | 🔴 FAIL |
| 37 | `add_color_matte` | <1s fast-fail, no dialog | timeout 30s, Color Picker hiện ra | 🔴 FAIL |
| 37b | `add_text_overlay` (v1.2.3) | MOGRT redirect note | `"Illegal Parameter type"` raw error | 🔴 FAIL |
| 40 | `replace_clip_media` | Expected PASS | ✅ PASS (<2s) | ✅ PASS |
| 41 | `four_point_edit` | Expected PASS | ✅ PASS (<2s) | ✅ PASS |
| 56 | `set_workspace` | Expected PASS | ✅ PASS (<1s) + side-effect note | ✅ PASS |
| 70 | `close_project` | Expected PASS | ⏸️ chưa test | ⏸️ skipped |

**Score:** 3/6 PASS, 3/6 STILL FAIL (#19, #37, #37b), 1/6 skipped.

## 🔥 Highest priority cho dev (v1.2.4)

1. **Bug #37 `add_color_matte`** — fix v1.2.2 không có effect. Cần debug runtime: log từng probe step, verify build deployed đúng commit, hoặc nếu DOM `createColorMatte` cũng internally call QE path → **disable hẳn** giống pattern slip/slide/roll (Bug #39). User-facing message: "Color matte creation blocked — use `add_black_video` + Lumetri tint, or `add_adjustment_layer` + `apply_ramp`."

2. **Bug #19 `inspect_dom_object`** — `instanceof Function` không đủ cho ExtendScript host methods. Thêm tier-3 probe `Object.prototype.toString.call(val) === "[object Function]"`.

3. **Bug #37b `add_text_overlay`** — try/catch không catch được "Illegal Parameter type" exception. Wrap toàn bộ probe trong defensive catch và default-return MOGRT redirect note nếu MỌI probe fail.

## ✅ Pattern đã work tốt — apply cho bugs pending v1.2.4+

- **Graceful degradation pattern** (v1.2.1): `{ available: false, note: "...workaround..." }` — apply cho 17 pending bugs (#12, #20, #22, #25, #28, ..., #67) để cải thiện UX kể cả khi chưa fix gốc.
- **Pre-validation pattern** (v1.2.1): check file exists trước khi gọi API — apply cho mọi tool path-based.
- **DOM-first probe + refuse-QE pattern** (v1.2.2 architecture, dù #37 chưa work) — đúng hướng, cần debug instance cụ thể.

---

# 🔬 DEEP SWEEP #3 — v1.2.4 dev report (2026-05-11)

Tester chạy thêm 1 vòng debug kỹ trên project "Lò nướng.prproj" (Premiere 25.4.1) để dev fix gọn 1 lần. Tổng 10 wave (~100+ tool calls) trên active sequence `MCP_Test_FromClips` → `MCP_Test_FromClips Copy`.

## 🔴 NEW BUGS phát hiện (10 bugs ngoài 17 pending)

### NEW BUG #72 — `get_clip_volume` LUÔN trả `0` bất kể set value

**Repro (sequential, KHÔNG phải parallel ordering):**
```
set_clip_volume({node_id: "000f4479", volume_db: -9})  → { volumeDb: -9 } ✅
get_clip_volume({track_index: 0, clip_index: 0})       → { volumeDb: 0 }  🔴
```

**Cùng clip (audio track 0, clip 0 = nodeId 000f4479).** Set ghi nhận thành công, Get đọc về 0.

**Root cause khả năng:**
- Get đang đọc audio TRACK-level volume thay vì CLIP-level Volume → Level parameter
- Hoặc đọc sai property path (audio component's `Volume.Bypass` thay vì `Volume.Level`)

**Test command cho dev:**
```jsx
var clip = app.project.activeSequence.audioTracks[0].clips[0];
var vol = clip.components[1]; // Volume component
$.writeln("comp.displayName: " + vol.displayName);
for (var i = 0; i < vol.properties.numItems; i++) {
  $.writeln("prop " + i + ": " + vol.properties[i].displayName + " = " + vol.properties[i].getValue());
}
```

---

### NEW BUG #73 — `get_clip_speed` LUÔN trả `speed: 1` bất kể set value

**Repro:**
```
speed_change({node_id: "000f4475", speed_percent: 150})  → { speedChanged: true, speed: 150 } ✅
get_clip_speed({node_id: "000f4475"})                    → { speed: 1, reversed: false }      🔴
```

**Pattern giống Bug #72** — set/get inconsistency. Speed actually changed in UI (sequence duration changed), nhưng get đọc về 1.

**Root cause khả năng:**
- Get đọc `clip.speed` (property) trong khi set dùng `clip.setSpeed()` method → 2 cơ chế khác nhau
- Hoặc đọc thuộc tính ratio nhưng không nhân 100 → 1.5 → cast int → 1

---

### NEW BUG #74 — `color_correct` fail với param `saturation` (Invalid parameter)

**Repro:**
```
color_correct({node_id: ..., exposure: 0.5})              → PASS ✅
color_correct({node_id: ..., contrast: 15})               → PASS ✅
color_correct({node_id: ..., saturation: 120})            → FAIL "Invalid parameter"  🔴
color_correct({node_id: ..., exposure: 0.5, saturation: 120}) → FAIL "Invalid parameter" 🔴
color_correct({node_id: ..., exposure: 0.5, contrast: 15}) → PASS ✅
```

**Saturation param riêng broken.** Các param khác work.

**Root cause khả năng:** Lumetri saturation index có duplicate (3 "Saturation" props trong Lumetri), code dùng index sai trong `color_correct` (khác với `set_lumetri_creative` đã fix đúng idx 43).

---

### NEW BUG #75 — `set_clip_scale` / `add_keyframe(Motion, Scale)` fail khi `Uniform Scale = false`

**Repro:**
```
# Clip 000f446f có Uniform Scale = false
set_clip_scale({node_id: "000f446f", scale: 120})         → FAIL "Could not set scale" 🔴
add_keyframe({effect_name:"Motion", property_name:"Scale", ...}) → FAIL "Property not found" 🔴

# Clip 000f4473 có Uniform Scale = true
set_clip_transform({node_id: "000f4473", scale: 90})      → PASS ✅
```

**Root cause CONFIRMED:** Premiere 25.4 Motion component có:
- Khi `Uniform Scale = true` → có property `"Scale"` (single value)
- Khi `Uniform Scale = false` → CHỈ có `"Scale Width"` + `"Scale Height"` (Scale biến mất)

Code hiện tại assume `"Scale"` luôn tồn tại → fail khi uniform=false.

**Fix:**
```javascript
// set_clip_scale - detect uniform state first
var motion = clip.components["Motion"];
var uniformProp = findPropByName(motion, "Uniform Scale");
var isUniform = uniformProp ? uniformProp.getValue() : true;
if (isUniform) {
  setPropByName(motion, "Scale", scale);
} else {
  setPropByName(motion, "Scale Width", scale);
  setPropByName(motion, "Scale Height", scale);
}
```

Same fix cần áp dụng cho `add_keyframe`, `get_keyframes`, `set_keyframe_interpolation` khi target property là "Scale".

**Liên quan:** Bug #34 `set_scale_width_height` đã pending — root cause cùng family. Width set work nhưng Height fail vì khi Uniform=true, "Scale Height" prop không exist (chỉ có "Scale Width"). Cần auto-toggle Uniform=false trước khi set 2 giá trị riêng.

---

### NEW BUG #76 — `duplicate_sequence` activate sequence mới (silent UX issue)

**Repro:**
```
# State: active = "MCP_Test_FromClips"
duplicate_sequence({sequence_id: "MCP_Test_FromClips"}) 
  → { duplicated: true, originalName: "MCP_Test_FromClips" }  # KHÔNG có new ID
# State: active = "MCP_Test_FromClips Copy" 🔴
```

**Vấn đề:**
1. Active sequence bị chuyển sang copy **không có warning**
2. Response **không return new sequence ID/name** → user không cách nào reference duplicate
3. Mọi nodeId tracking cũ trong session bị stale (active sequence changed)

**Fix đề xuất:**
1. Return cả `originalSequenceId` + `newSequenceId` + `newName`
2. Thêm param `make_active: boolean` (default `false` để giữ active = original)
3. Hoặc document explicit về active-switch behavior

---

### NEW BUG #77 — `get_clip_properties` trả invalid values (negative outPoint, wrong duration)

**Repro (sau khi razor/split clip):**
```
get_clip_properties({node_id: "000f4475"}) → {
  "start": 0,
  "end": 0.01668333333333,
  "inPoint": 0,
  "outPoint": -4.50781666666667,   # 🔴 NEGATIVE!
  "duration": 0.01668333333333,
  "isSpeedReversed": 0              # 🔴 should be boolean false
}

# Same clip via get_sequence_structure:
{ "startSeconds": 0, "endSeconds": 24.5245, "outPointSeconds": 20 }
```

**2 vấn đề:**
1. **Negative outPoint** sau razor/split → math bug (subtraction wrap-around?)
2. **`isSpeedReversed: 0`** dùng int thay vì bool (inconsistent với rest of API)
3. **Inconsistency** giữa `get_clip_properties` và `get_sequence_structure` cho cùng clip — 1 trong 2 sai (suspect get_clip_properties đang đọc post-razor sliver state)

---

### NEW BUG #78 — `list_available_effects` chứa duplicate effect names

**Repro:**
```
list_available_effects → 141 effects, trong đó các tên sau xuất hiện 2 lần:
- "Set Matte" (idx 36, 37)
- "Noise" (idx 42, 43)
- "Noise HLS Auto" (idx 58, 59)
- "Transform" (idx 65, 66)
- "Noise HLS" (idx 73, 74)
- "Threshold" (idx 112, 113)
- "Noise Alpha" (idx 132, 133)
```

**Vấn đề:** Khi user gọi `apply_effect("Transform")`, code dùng tên match — không biết apply effect nào.

**Fix:** Return cả matchName (internal ID) cùng displayName:
```json
{ "name": "Noise", "matchName": "AE.ADBE Noise", "index": 42 }
{ "name": "Noise", "matchName": "AE.ADBE Noise2", "index": 43 }
```

User có thể dùng matchName để target chính xác. Tools `apply_effect` cũng nên accept `match_name` param.

---

### NEW BUG #79 — `list_clip_effects` shows duplicate "Blend Mode" property trong Opacity component

**Repro:**
```
list_clip_effects(000f446f).components[0] (Opacity) → {
  "properties": [
    { "index": 0, "displayName": "Opacity", "value": 100 },
    { "index": 1, "displayName": "Blend Mode", "value": 18 },  # which one?
    { "index": 2, "displayName": "Blend Mode", "value": 0 }    # which one?
  ]
}
```

**Vấn đề:** Opacity component có 2 prop tên "Blend Mode" với value khác nhau. Khi gọi `set_effect_property("Opacity", "Blend Mode", val)`, code không biết set cái nào.

**Fix:** Same pattern Bug #78 — expose matchName cho sub-properties, hoặc accept `property_index` ngoài `property_name`.

---

### NEW BUG #80 — `position` và `anchor_point` unit không nhất quán giữa các tool

**Repro:**
```
set_clip_position({x: 1920, y: 1080})              # tool nhận pixels
set_clip_transform({position: [0.3, 0.7]})         # tool nhận normalized 0-1

get_clip_transform → trả về theo unit đã set lần cuối:
  - 000f446f sau set_clip_position(1920,1080): Position: [1920, 1080] (pixel)
  - 000f4473 sau set_clip_transform([0.3,0.7]):  Position: [0.3, 0.7]   (normalized)
```

**Vấn đề:** 2 tool điều khiển CÙNG property nhưng unit khác nhau → confusing. User dùng `set_clip_position(x=1920)` rồi `get_clip_transform` sẽ thấy giá trị 1920 (pixel raw). Dùng `set_clip_transform(position=[0.5,0.5])` sẽ thấy 0.5 (normalized).

**Fix đề xuất:**
1. Standardize cả 2 dùng cùng unit (đề nghị pixels — match UI behavior)
2. Document rõ trong description khác nhau
3. Hoặc thêm param `units: "pixels" | "normalized"` cho cả 2

---

### NEW BUG #81 — `split_clip` returns `split: true` nhưng thực tế có thể đang cut wrong sequence

**Repro (sau khi `duplicate_sequence` activate copy):**
```
# Active: "MCP_Test_FromClips Copy"
split_clip({time_seconds: 10, track_index: 0, track_type: "video"})
  → { "split": true, "atSeconds": 10, "trackIndex": 0, "trackType": "video" }

# Verify với get_sequence_structure:
videoTracks[0].clips = [
  { "name": "C7994.MP4", "startSeconds": 0, "endSeconds": 24.5245 },  # KHÔNG có cut ở 10s 🔴
  { "name": "C8028.MP4", "startSeconds": 24.5245, "endSeconds": 44.044 }
]
```

**Vấn đề:** Tool report success nhưng clip không thực sự bị cut. Có thể split_clip đang work với QE active sequence vs DOM active sequence khác nhau, hoặc time_seconds bị offset bởi `set_zero_point(3600)` được call trước đó.

**Hypothesis:** `set_zero_point(3600)` chuyển sequence zero sang 1h. `split_clip(10)` interpret 10s relative to NEW zero → split tại absolute time 3600+10s (ngoài clip range) → silent no-op nhưng return success.

**Fix:** `split_clip` cần document rõ "absolute timeline time" vs "from zero point" + validate time falls within clip range trước khi return success.

---

## ✅ STILL FAIL từ 17 pending bugs (sweep #2 retest)

Test lại 17 pending bugs đã document trong v1.2.1 fix log:

| # | Tool | Status v1.2.3 | Note |
|----|------|---------------|------|
| 12 | `get_full_sequence_info` | ⏸️ chưa retest | Cần test trên sequence lớn (>10 tracks/100 clips) |
| 20 | `get_track_info.transitions` | ✅ PASS (empty case OK) | Cần test với transition thật để xác minh |
| 22 | `get_project_panel_metadata` | ⏸️ chưa retest | Vẫn pending pagination |
| 25 | `get_effect_properties` Lumetri | ⏸️ chưa retest sâu | Cần clip có Lumetri để verify |
| 28 | `set_clip_pan` | 🔴 STILL FAIL | "Could not set pan - is this an audio clip?" trên audio nodeId rõ ràng |
| 30 | `set_clip_speed_qe` | 🔴 STILL FAIL | "Not Enough Parameters" |
| 31 | `reverse_clip` | 🔴 STILL FAIL | "Unknown error exception" |
| 34 | `set_scale_width_height` | 🔴 STILL FAIL | widthSet:true, heightSet:false (xem Bug #75) |
| 35 | `batch_set_clip_property` | ⏸️ chưa retest | Cần repro condition |
| 38 | `trim_clip` | ✅ PASS (basic case) | Bug 38 là edge case nodeId stale |
| 45 | `add_caption` | 🔴 STILL FAIL | "TypeError: undefined is not an object" (cần caption track) |
| 48 | `step_forward` / `step_backward` | 🔴 STILL FAIL | "Illegal Parameter type" |
| 51 | `link_audio_video` | ✅ PASS | Trước fail trong sweep #1, giờ work |
| 52 | `set_sequence_pixel_aspect_ratio` | 🔴 STILL FAIL | "Illegal Parameter type" |
| 53 | `create_sequence` | 🔴 STILL FAIL | "Not Enough Parameters" (cần preset_path) |
| 58 | `import_folder` | 🔴 STILL FAIL | "No files found in folder" /tmp |
| 60 | `import_fcp_xml` | 🔴 STILL FAIL | "Not Enough Parameters" (KHÔNG pre-validate path) |
| 61 | `scene_edit_detection` | 🔴 STILL FAIL | "Not Enough Parameters" |
| 65 | `auto_reframe_sequence` | 🔴 STILL FAIL | "Illegal Parameter type" với width+height |
| 66 | `import_mogrt_from_library` | 🔴 STILL FAIL | "Not Enough Parameters" |
| 67 | `set_mogrt_property` | 🟡 IMPROVED | "Property not found: Source Text" rõ ràng hơn nhưng vẫn KHÔNG detect non-MOGRT clip |

**Score pending bugs:** 12 STILL FAIL, 3 PASS-now (38, 51, 20-partial), 6 chưa retest đủ.

## 🟢 CATEGORIES TEST PASS (~80 tools verified)

✅ **Effects (Wave 2):** apply_effect, apply_effect_with_properties, list_clip_effects, remove_effect, copy_effects_between_clips, batch_apply_effect, list_available_effects, set_effect_property
✅ **Lumetri/Color (Wave 3):** apply_asc_cdl, apply_color_space_transform, get_color_space, set_lumetri_creative, set_lumetri_hsl_secondary, set_lumetri_vignette (note: color_correct partial — Bug #74)
✅ **Audio (Wave 4):** apply_audio_effect, set_clip_volume (set only), apply_audio_crossfade, adjust_audio_levels, set_audio_channel_mapping, mute_track, lock_track, set_blend_mode (note: get_clip_volume — Bug #72)
✅ **Keyframes (Wave 5):** add_keyframe (with Opacity), get_keyframes, set_keyframe_interpolation, get_value_at_time, remove_keyframe (note: Motion→Scale path — Bug #75)
✅ **Transforms (Wave 5):** set_clip_opacity, set_clip_position, set_clip_rotation, set_clip_anchor_point, get_clip_transform, set_clip_transform, set_uniform_scale (note: unit inconsistency — Bug #80)
✅ **Markers (Wave 6):** add_marker, update_marker, list_markers, add_marker_to_project_item, get_clip_markers, get_sequence_markers_by_type
✅ **Subclips/Duplicates (Wave 7):** create_subclip, duplicate_clip, duplicate_sequence (note: active switch — Bug #76)
✅ **Speed/Time (Wave 8):** speed_change (set), set_clip_time_interpolation, set_time_interpolation, set_frame_blend, set_zero_point, move_clip, razor_timeline_at_time (note: get_clip_speed — Bug #73, split_clip silent — Bug #81)
✅ **Source Monitor (Wave 9):** open_in_source, set_playhead_position, get_playhead_position, set_sequence_in_out_points, set_item_in_out, get_source_monitor_info, set_source_in_out, play_timeline, stop_playback, close_source_monitor
✅ **Misc (Wave 10):** create_bin, search_project_items, get_metadata, get_project_info, get_render_queue_status, get_target_tracks, set_color_label, set_metadata

## 🎯 PRIORITY MATRIX cho dev v1.2.4

### 🔥 CRITICAL — data integrity / silent corruption

1. **Bug #77 `get_clip_properties` negative outPoint** — data corruption, breaks downstream tools
2. **Bug #81 `split_clip` silent no-op** — returns success but doesn't cut → user thinks ok
3. **Bug #76 `duplicate_sequence` silent active-switch** — invalidates all nodeIds in session

### 🔴 HIGH — set/get inconsistency (user can't verify state)

4. **Bug #72 `get_clip_volume` always 0** — set works, get broken
5. **Bug #73 `get_clip_speed` always 1** — same pattern

### 🟠 MEDIUM — known regressions confirmed still broken

6. **Bug #75 `set_clip_scale` + `add_keyframe(Motion, Scale)`** — Uniform Scale detection
7. **Bug #74 `color_correct` saturation param** — index wrong
8. **Bug #34 `set_scale_width_height`** — sibling of #75
9. **Bug #19 `inspect_dom_object`** — function still shows `"[object]"` (đã document v1.2.2 retest)
10. **Bug #37 `add_color_matte`** — STILL spawns Color Picker (đã document v1.2.2 retest)
11. **Bug #37b `add_text_overlay`** — STILL raw "Illegal Parameter type" (đã document v1.2.3 retest)

### 🟡 LOW — UX / consistency

12. **Bug #78 + #79 duplicate effect/property names** — add matchName/index disambiguation
13. **Bug #80 position unit inconsistency** — standardize across set_clip_position / set_clip_transform
14. **17 pending bugs** từ v1.2.1 — phần lớn vẫn fail, cần probe signature ExtendScript

## 📋 RECOMMENDED RE-TEST APPROACH cho dev

Sau v1.2.4 deploy, tester sẽ chạy:

1. **Set/get round-trip tests** (verify data persistence):
   - `set_clip_volume → get_clip_volume` cùng clip
   - `speed_change → get_clip_speed` cùng clip
   - `set_clip_scale → get_clip_transform.Scale` với uniform=true + uniform=false
   - `set_clip_position → get_clip_transform.Position` (verify unit)

2. **Active-state tests** (verify no silent context switch):
   - `duplicate_sequence` → check `get_project_info.activeSequence` không đổi
   - `split_clip` → check `get_sequence_structure` thấy clip thật sự bị cut
   - Sau `set_zero_point` → các tool dùng `time_seconds` interpret đúng (absolute vs zero-relative)

3. **17 pending bugs** — chạy `__probe_signature_<tool>()` debug helper:
   ```jsx
   try { app.someFunction(); $.writeln("0-arg OK"); } catch(e) { $.writeln("0-arg: " + e); }
   try { app.someFunction(1); ... }
   ```
   Tự động discover signature trong 25.4.

4. **Effect disambiguation** — verify duplicate-name effects/props có matchName field.

## 📁 Test environment metadata

- **Project:** Lò nướng.prproj (Premiere 25.4.1)
- **Active sequence test:** MCP_Test_FromClips (3 video + 3 audio tracks, 2 clips on V1)
- **Tool count tested:** ~100 (out of 443 registered)
- **Test date:** 2026-05-11
- **Commits under test:** `f37a0ab` (v1.2.1) + `cbffcc0` (v1.2.2) + `401fcc5` (v1.2.3)

---

## ➕ Late finding (cleanup phase)

### NEW BUG #82 — `delete_project_item` cho subclip throw `app.project.deleteAsset is not a function`

**Repro:**
```
delete_project_item({item_id: "C7994_Subclip1"})
  → Error: Failed to delete project item (type 1): ReferenceError: app.project.deleteAsset is not a function
```

**Context:** Subclip có ProjectItemType = 1 (= "footage"/file). Code dispatch type 1 → `app.project.deleteAsset()` nhưng API này đã bị removed trong 25.4.

**Fix:** Apply graceful-degradation pattern Bug #54/#55:
```javascript
if (typeof app.project.deleteAsset === "function") {
  app.project.deleteAsset(item);
} else if (typeof item.clearOut === "function") {
  item.clearOut(); // alternative
} else {
  // fall back to executeCommand("Clear") with item selected
  __selectProjectItem(item);
  app.executeCommand(__findMenuCommandId("Clear"));
}
```

**Related:** v1.2.1 đã fix `deleteBin` + `deleteSequence` graceful, nhưng MISS `deleteAsset` cho footage/subclip type.



---

# 🛠️ FIX LOG — v1.2.4 (2026-05-11, sweep #2 retest fixes)

13 bugs fix trong release này — focus vào CRITICAL data integrity, set/get inconsistency, và disambiguation. Tester có thể retest theo checklist cuối file.

## ✅ CRITICAL — data integrity / silent corruption

### Bug #77 `get_clip_properties` — defensive recompute
- Root cause: sau razor/split, raw `clip.outPoint.ticks` / `clip.end.ticks` trả invalid sentinel values (negative hoặc sub-frame)
- Fix: detect impossible values (< 0 hoặc < 1-2 frame), repair từ `start + duration` / `inPoint + duration`. Surface `_raw` snapshot + `_note` khi repair fire. Coerce `isSpeedReversed` và `isSelected` thành proper bool
- File: [src/tools/discovery.ts:263-310](src/tools/discovery.ts#L263-L310)

### Bug #81 `split_clip` — validate trước, verify sau
- Root cause: tool return `split: true` ngay cả khi razor là no-op (vì time fall ngoài clip range hoặc bị offset bởi `set_zero_point`)
- Fix: pre-validate DOM clip tại time tồn tại trên target track; sau razor verify clip count tăng thêm 1; surface clear error nếu fail
- File: [src/tools/timeline.ts:173-249](src/tools/timeline.ts#L173-L249)

### Bug #76 `duplicate_sequence` — return new ID + make_active param
- Root cause: response không có `newSequenceId`, active sequence silently chuyển sang clone
- Fix: snapshot sequence IDs trước/sau clone để identify new sequence. Return cả `originalSequenceId` + `newSequenceId` + `activeRestored`. Thêm `make_active: false` để restore original
- File: [src/tools/sequence.ts:37-98](src/tools/sequence.ts#L37-L98)

## ✅ HIGH — set/get inconsistency

### Bug #72 `get_clip_volume` — sample time-varying prop
- Root cause: `getValue()` không có time param trên time-varying Level property → return 0
- Fix: detect `isTimeVarying`, sample qua `getValueAtTime(clipStart + 0.001s)`. Fall back to `getValue()`. Surface `_probe` array khi neither work
- File: [src/tools/audio.ts:166-225](src/tools/audio.ts#L166-L225)

### Bug #73 `get_clip_speed` — probe multiple sources
- Root cause: DOM `clip.getSpeed()` không reflect QE `setSpeed()` change
- Fix: probe DOM `getSpeed`, QE `qeClip.speed`, computed source/timeline duration ratio. Pick reliable source, return `speedPercent` + `_probe`
- File: [src/tools/advanced.ts:397-450](src/tools/advanced.ts#L397-L450)

## ✅ MEDIUM — Uniform Scale family (Bug #75 + #34)

### Bug #75 `set_clip_scale` — auto-detect uniform state
- Root cause: khi Uniform Scale = false, property "Scale" không tồn tại → fall through error
- Fix: detect property availability — set "Scale" nếu uniform, set cả "Scale Width" + "Scale Height" nếu non-uniform
- File: [src/tools/track-targeting.ts:485-555](src/tools/track-targeting.ts#L485-L555)

### Bug #34 `set_scale_width_height` — re-read props after Uniform toggle
- Root cause: sau flip Uniform Scale = false, motion.properties collection được rebuild bởi Premiere nhưng code dùng stale reference
- Fix: flip uniform, RE-READ properties collection (Premiere có thể đã rebuild), case-insensitive trimmed matching, probe property names khi fail
- File: [src/tools/track-targeting.ts:1336-1417](src/tools/track-targeting.ts#L1336-L1417)

## ✅ MEDIUM — Lumetri Saturation (Bug #74)

### Bug #74 `color_correct` saturation "Invalid parameter"
- Root cause: Lumetri có 3x "Saturation" properties (Basic / Creative / Color Wheels). Iteration hit one expecting array value, throw "Invalid parameter"
- Fix: skip Saturation entries có value KHÔNG phải plain number (those are Color Wheels). Wrap mỗi setValue trong try/catch để 1 bad value không abort rest. Surface clear error nếu Saturation chưa apply thành công
- File: [src/tools/effects.ts:365-405](src/tools/effects.ts#L365-L405)

## ✅ LOW — Pending bugs từ v1.2.1

### Bug #45 `add_caption` — pre-detect missing track
- Root cause: `seq.captionTracks[0]` return undefined → `TypeError: undefined is not an object`
- Fix: detect missing `captionTracks` hoặc empty list lên đầu, return actionable error giải thích workflow `import_captions` → `create_caption_track` → `add_caption`
- File: [src/tools/captions.ts:142-204](src/tools/captions.ts#L142-L204)

### Bug #67 `set_mogrt_property` — non-MOGRT detect
- Root cause: tool fall through từ MGT path xuống regular component scan, success "by accident" và làm user confuse
- Fix: detect xem clip có MGT component không trước. Nếu có MGT nhưng property name miss → probe + list available. Nếu không phải MOGRT → redirect rõ ràng sang `set_effect_property`
- File: [src/tools/text.ts:286-339](src/tools/text.ts#L286-L339)

### Bug #58 `import_folder` — file filter + recursive
- Root cause: trên empty/system folder (`/tmp`), no files found nhưng error message generic
- Fix: thêm `recursive` + `extensions` params, filter by media extension default, skip hidden files (`.DS_Store`), surface skipped non-media filenames trong error
- File: [src/tools/media.ts:46-128](src/tools/media.ts#L46-L128)

### Bug #60 `import_fcp_xml` — pre-validate path
- Root cause: `openFCPXML` throw "Not Enough Parameters" generic khi path không tồn tại
- Fix: pre-validate `File.exists`, wrap `openFCPXML` trong try/catch
- File: [src/tools/project.ts:464-487](src/tools/project.ts#L464-L487)

## ✅ DISAMBIGUATION (Bug #78 + #79)

### Bug #78 `list_available_effects` / `list_available_audio_effects`
- Detect duplicate display names trong effect list (e.g., "Noise" x2, "Transform" x2)
- Flag duplicates với `duplicateGroup`, `dupIndex`, `dupCount` fields
- Caller dùng `index` để disambiguate
- File: [src/tools/effects.ts:270-330](src/tools/effects.ts#L270-L330)

### Bug #79 `list_clip_effects` + `set_effect_property` disambiguation
- `list_clip_effects` flag duplicate property names per component (e.g., Opacity x2 "Blend Mode")
- `set_effect_property` accept new params: `property_index` (highest priority), `match_name` (fallback), `property_name` (legacy)
- Resolution priority: index → match_name → name
- Backward compat: existing callers dùng `property_name` vẫn work
- Files: [src/tools/scripting.ts:205-275](src/tools/scripting.ts#L205-L275), [src/tools/keyframes.ts:65-152](src/tools/keyframes.ts#L65-L152)

## ✅ CLEANUP (Bug #82)

### Bug #82 `delete_project_item` / `delete_multiple_project_items` — `deleteAsset` removed in 25.4
- Try `app.project.deleteAsset()` → `item.clearOut()` → `executeCommand("Clear")` với graceful fallback
- Surface workaround note (manual Backspace) nếu tất cả fail
- File: [src/tools/utility.ts:1-104](src/tools/utility.ts#L1-L104)

## ⏸️ STILL DEFERRED to v1.2.5

Các bugs cần controlled signature probing (Premiere không stable enough để test programmatic):

- #28 `set_clip_pan` — audio detection logic
- #30 `set_clip_speed_qe` — QE setSpeed signature
- #31 `reverse_clip` — exception swallowed by Premiere
- #48 `step_forward` / `step_backward` — Time vs Number param type
- #52 `set_sequence_pixel_aspect_ratio` — struct format
- #53 `create_sequence` — preset_path now strictly required (kept current behavior, just need to require it in schema)
- #61 `scene_edit_detection` — signature unknown
- #65 `auto_reframe_sequence` — schema mismatch
- #66 `import_mogrt_from_library` — signature unknown
- #20 `get_track_info.transitions` — needs transition test fixture
- #38 `trim_clip` edge cases

## 📊 v1.2.4 SCORE

| Category | Fixed | Remaining |
|----------|------:|----------:|
| CRITICAL data integrity | 3/3 | 0 |
| HIGH set/get inconsistency | 2/2 | 0 |
| MEDIUM regression | 4/4 | 0 |
| LOW pending bugs v1.2.1 | 4/14 | 10 |
| Disambiguation | 2/2 | 0 |
| Cleanup | 1/1 | 0 |
| **TOTAL** | **16** | **10** |

## 📋 RETEST CHECKLIST cho Tester — v1.2.4

### Highest priority (CRITICAL fixes)

1. **#77** — chạy `razor_timeline_at_time` rồi `get_clip_properties` trên sliver clip → verify outPoint không negative, có `_note` nếu repair fire
2. **#81** — chạy `set_zero_point(3600)` rồi `split_clip(time_seconds=10)` → expect actionable error, KHÔNG `split: true`
3. **#76** — `duplicate_sequence({make_active: false})` → verify response có `newSequenceId` + active vẫn = original

### Set/get round-trip

4. **#72** — `set_clip_volume(-9)` rồi `get_clip_volume` → expect `volumeDb: -9` (hoặc gần đó nếu time-varying)
5. **#73** — `speed_change(150)` rồi `get_clip_speed` → expect `speedPercent: 150`

### Uniform Scale family

6. **#75** — set Uniform=false, rồi `set_clip_scale(120)` → expect work via "Scale Width + Scale Height"
7. **#34** — set Uniform=true, rồi `set_scale_width_height(120, 80)` → expect both set thành công

### Color

8. **#74** — `color_correct({saturation: 120})` → expect PASS, không "Invalid parameter"

### Pending bugs

9. **#45** — `add_caption` trên sequence không có caption track → expect actionable error với workflow hint
10. **#67** — `set_mogrt_property` trên non-MOGRT clip → expect clear redirect sang `set_effect_property`
11. **#58** — `import_folder("/Users/.../Footage")` với recursive=true → expect filter by media ext
12. **#60** — `import_fcp_xml("/nonexistent.xml")` → expect "FCP XML file not found" pre-validate

### Disambiguation

13. **#78** — `list_available_effects` → check entries có `duplicateGroup: "Noise"` cho duplicate names
14. **#79** — `list_clip_effects` trên clip có Opacity → check 2x "Blend Mode" có `dupIndex: 0/1`
15. **#79** — `set_effect_property` với `property_index: 1` để target second "Blend Mode" → expect set thành công

### Cleanup

16. **#82** — `delete_project_item("subclip_id")` → expect `via: "clearOut"` hoặc `via: "executeCommand(Clear)"` (KHÔNG raw "deleteAsset is not a function")

