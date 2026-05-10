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
