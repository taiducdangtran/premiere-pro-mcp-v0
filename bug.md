# Bug Report — NEW bugs discovered after v1.2.12 (2026-05-11, sweep #7)

Tester chạy retest cuối cùng sau commit `d86a5df` (v1.2.12) trên project "Lò nướng.prproj" (Premiere 25.4.1), active sequence "Sequence 01 Cắt" (22 clips V1, 17 V2, 5 V3). Đa số bugs từ v1.2.8 → v1.2.12 đã PASS — nhưng phát hiện **3 NEW bugs** chưa được document, dev cần fix trong v1.2.13.

---

## ✅ v1.2.13 FIX STATUS (2026-05-11, dev response)

Tất cả 3 bugs + bonus polish đã apply. Build sạch, commit + push.

| # | Patch | File | LOC |
|---|-------|------|----:|
| 🔥 #88 | Verification pattern — count V-track clips + root items before/after; surface `vClipsAdded`/`rootItemsAdded`; return clear error when nothing inserted; auto-discover `trackItemNodeId` when API returns `null` | `src/tools/text.ts` | ~30 |
| 🔴 #87 | Apply Bug #76 pattern — snapshot `sourceSequenceId` + IDs-before, find new seq by ID delta, accept `make_active: false` (default) to restore via `openSequence(sourceId)`; response includes `sourceSequenceId`, `newSequenceId`, `activeSequenceId`, `activeRestored` | `src/tools/sequence.ts` | ~35 |
| 🟠 #86 | Track `matchFound` separately from `didSet`; break OUTER loop on first match (no double-push); add 1-arg `setValue(val)` fallback after 2-arg fails; failed-set entries carry `matchedPath` ("Opacity.Opacity") to disambiguate | `src/tools/clipboard.ts` | ~25 |
| 🟢 BOM | Filter asset-blob strings = single BOM char (length<4, codepoint 0xFEFF). Applied to both `get_effect_properties` AND `list_clip_effects` | `src/tools/keyframes.ts`, `src/tools/scripting.ts` | 2 |

**Build:** `npm run build` → PASS (TypeScript clean)
**Version:** v1.2.13
**Commit:** see `git log --oneline -1`

### Notes cho tester

**#86 root cause clarification:** kết quả trước có 2 entries cho cùng target vì `didSet=false` sau khi setValue throw → outer loop tiếp tục → cuối hàm `if (!didSet && propsSeen.length > 0)` trigger "not found" branch nữa. Fix track `matchFound` để break outer loop ngay khi gặp match, không quan trọng setValue thành công hay không. Nếu setValue fail, entry duy nhất sẽ là `"matched 'X.Opacity' but setValue rejected the value: ..."` thay vì 2 entries mâu thuẫn.

**#86 setValue failure mystery:** `set_clip_opacity` standalone work với cùng setValue call shape (`setValue(80, true)`). Có thể là time-varying state thoáng qua, hoặc Adobe rejects some specific updateUI flag combo. 1-arg fallback `setValue(80)` được thêm vào để cover trường hợp này. Nếu vẫn fail trong sweep #8, error message giờ chứa cả 2-arg lỗi VÀ 1-arg lỗi → tester có data để narrow down.

**#87 default behavior change:** `make_active: false` là default (preserve original active), trái với Premiere's native behavior. Caller cần `make_active: true` để keep native switch. Đây là pattern thống nhất với `duplicate_sequence` đã fix Bug #76.

**#88 verification thresholds:** tool check `vClipsAfter === vClipsBefore && rootItemsAfter === rootItemsBefore`. Nếu mogrt insert KHÔNG vào V-track (e.g., chỉ tạo project item), `rootItemsAdded > 0` sẽ đủ để pass — không return error. Nếu cần stricter check (must insert into timeline), tester báo lại.

---

## 🔴 NEW BUG #86 — `batch_set_clip_property` Opacity fails with contradictory errors

### Repro

```
batch_set_clip_property({
  property_name: "Opacity",
  value: 80,
  targets: [
    { trackType: "video", trackIndex: 0, clipIndex: 0 },
    { trackIndex: 99, clipIndex: 0 },
    { trackType: "video", trackIndex: 0, clipIndex: 999 }
  ]
})
```

### Output (problematic)

```json
{
  "property": "Opacity",
  "updated": 0,
  "notFound": [
    {
      "target": { "trackType": "video", "trackIndex": 0, "clipIndex": 0 },
      "clip": "C7984.MP4",
      "reason": "setValue threw: Error: Illegal Parameter type"
    },
    {
      "target": { "trackType": "video", "trackIndex": 0, "clipIndex": 0 },
      "clip": "C7984.MP4",
      "reason": "property 'Opacity' not found on this clip",
      "availableProps": [
        "Opacity",         ← contradiction! Opacity IS in availableProps
        "Position", "Scale", "Scale Width", "Uniform Scale",
        "Rotation", "Anchor Point", "Anti-flicker Filter",
        "Crop Left", "Crop Top", "Crop Right", "Crop Bottom"
      ]
    },
    {
      "target": { "trackIndex": 99, "clipIndex": 0 },
      "reason": "trackIndex out of range (3 tracks)"
    },
    {
      "target": { "trackType": "video", "trackIndex": 0, "clipIndex": 999 },
      "reason": "clipIndex out of range (22 clips on video 0)"
    }
  ]
}
```

### Problems

1. **First target appears TWICE in notFound** với 2 reasons khác nhau:
   - Entry 0: `"setValue threw: Error: Illegal Parameter type"` — tool found Opacity property nhưng setValue rejected the value
   - Entry 1: `"property 'Opacity' not found on this clip"` — same target, same clip, but property allegedly not found

2. **`availableProps` mâu thuẫn với "not found" message** — Opacity ROOT là phần tử đầu trong availableProps array, vậy mà tool nói không tìm thấy.

3. **`set_clip_opacity(node_id, opacity=80)` riêng lẻ WORK** trên cùng clip này (đã verify trong sweep #1) — vậy code path của `batch_set_clip_property` khác với `set_clip_opacity` và bị broken.

### Root cause hypothesis

- `batch_set_clip_property` iterate qua các component, tìm property tên "Opacity"
- Có 2 components chứa property "Opacity":
  - **Opacity component** → property "Opacity" (the actual opacity, value 0-100)
  - **Motion component** → KHÔNG có property tên Opacity nhưng có "Position", "Scale", etc.
- Tool tries first match (Opacity → Opacity), calls `setValue(80)` → throws "Illegal Parameter type" (maybe setValue signature requires explicit time param like `setValue(80, time, true)`)
- On failure, tool continues to next component (Motion), doesn't find "Opacity" → reports "not found"
- Bug: should stop on first match found regardless of setValue failure, OR setValue with correct signature

### Suggested fix

```javascript
// In batch_set_clip_property, after finding matching property:
try {
  prop.setValue(value, true);  // ← add updateUI flag = true
  // OR use setValueAtKey if time-varying
  return { updated: true };
} catch (e) {
  return { 
    notFound: false, 
    setValueError: e.toString(),
    propPath: comp.displayName + "." + prop.displayName 
  };
}
// Don't continue to next component if property name MATCHED on this one
```

Also: when reporting `notFound`, dedupe per target — same target shouldn't appear twice.

---

## 🔴 NEW BUG #87 — `auto_reframe_sequence` SILENTLY activates new reframed sequence

### Repro

```
# State: active = "Sequence 01 Cắt"
auto_reframe_sequence({
  target_width: 1080,
  target_height: 1920,
  motion_preset: "default",
  new_name: "RetestReframe_v128"
})
→ { reframed: true, sourceName: "Sequence 01 Cắt", newName: "RetestReframe_v128", ... }

# State changed silently:
ping → activeSequence: "RetestReframe_v128"  🔴 silent switch
```

### Problem

Tool returns success but **silently switches active sequence to the new reframed copy** — identical UX issue như Bug #76 (`duplicate_sequence`) đã fix bằng cách thêm `make_active: false` param + return both IDs.

User's subsequent calls expect to work on the ORIGINAL sequence → all nodeIds invalidate, silent failures cascade.

### Impact

Cao — `auto_reframe_sequence` thường được dùng trong batch pipelines. User pipeline:
```
auto_reframe → modify_clip → modify_clip → render
```
Sẽ FAIL on step 2 vì active sequence changed silently.

### Suggested fix (same pattern as Bug #76)

```javascript
// In auto_reframe_sequence — add make_active param + return both IDs
{
  "reframed": true,
  "sourceName": "...",
  "sourceSequenceId": "2f035869-...",   // ADD
  "newName": "RetestReframe_v128",
  "newSequenceId": "be48b220-...",      // ADD
  "activeSequenceId": "2f035869-...",   // ADD
  "activeRestored": true                  // ADD (if make_active=false)
}
```

Schema addition:
```javascript
"make_active": {
  "description": "Make the reframed sequence active (default: false to preserve original active)",
  "type": "boolean"
}
```

---

## 🔴 NEW BUG #88 — `import_mogrt_from_library` FALSE POSITIVE for nonexistent library/mogrt

### Repro

```
import_mogrt_from_library({
  library_name: "NonexistentLib",
  mogrt_name: "NonexistentMogrt"
})
→ { 
  "imported": true,                  🔴 says success!
  "libraryName": "NonexistentLib",
  "mogrtName": "NonexistentMogrt",
  "videoTrackIndex": 0,
  "audioTrackIndex": 0,
  "trackItemName": null              🔴 but trackItemName is null
}
```

### Verification (ExtendScript probe)

```jsx
// Before call: rootItems = 55, V1=22, V2=17, V3=5
// After call:  rootItems = 55, V1=22, V2=17, V3=5  ← NO change
// scanBin() found no items matching "Nonexistent" or "Mogrt"
```

**Adobe API `seq.importMGTFromLibrary` silently succeeded but inserted nothing.** Tool reported `imported: true` based on no-exception, but didn't verify the item was actually inserted.

### Problem

User pipeline:
```
import_mogrt_from_library(lib_name, mogrt_name) → set_mogrt_property(...) → render
```
Step 1 says success but no clip inserted → step 2 fails with cryptic "Clip not found" error.

### Suggested fix (verification pattern like `split_clip`)

```javascript
// In import_mogrt_from_library:
var v1Before = seq.videoTracks[track_index].clips.numItems;
var rootBefore = app.project.rootItem.children.numItems;

seq.importMGTFromLibrary(library_name, mogrt_name, ticks, vidTrack, audTrack);

var v1After = seq.videoTracks[track_index].clips.numItems;
var rootAfter = app.project.rootItem.children.numItems;

if (v1After === v1Before && rootAfter === rootBefore) {
  return __error({
    reason: "import_mogrt_from_library: API returned without error but " +
            "no new clip on video track " + track_index + " or new project item. " +
            "Likely library_name or mogrt_name not found in CC Libraries. " +
            "Workaround: verify library exists in CC Libraries panel.",
    _probe: {
      libraryName: library_name,
      mogrtName: mogrt_name,
      v1ClipsBefore: v1Before,
      v1ClipsAfter: v1After,
      rootItemsBefore: rootBefore,
      rootItemsAfter: rootAfter
    }
  });
}

// Find the inserted clip
var newClip = seq.videoTracks[track_index].clips[v1After - 1];
return __result({
  imported: true,
  libraryName: library_name,
  mogrtName: mogrt_name,
  trackItemName: newClip.name,
  trackItemNodeId: newClip.nodeId
});
```

---

## 🟢 Bonus observation — #25 Lumetri filter still has BOM `"﻾"` values

`get_effect_properties(node, "Lumetri Color")` filtered ra 44 internal properties (PASS), nhưng output vẫn còn các props có value = BOM char `"﻾"`:
- idx 0 "Blob" → "﻾"
- idx 122 "Embedded LUTs" → "﻾"
- idx 124 "Media Embedded Lut blob" → "﻾"
- idx 128 "LUTAsset" → "﻾"
- idx 129 "LookAsset" → "﻾"

Đây là binary blob value cho asset references. **Không phải bug critical** — tester có thể skip — nhưng dev có thể filter thêm nếu muốn output clean hơn. One-line fix:

```javascript
if (typeof value === "string" && value.length > 0 && value.charCodeAt(0) === 0xFEFF) {
  // BOM-only or blob with BOM prefix → mark as binary
  filtered.value = "[binary blob]";
}
```

---

## 📊 Final test summary

| Category | Tools tested | PASS | FAIL | NEW bugs |
|----------|------------:|-----:|-----:|---------:|
| v1.2.8 fixes (#72, #28, #19, #52, #65, #83, #85) | 7 | 7 | 0 | 0 |
| v1.2.9–12 fixes (#53, #36, #61, #12, #22, #25) | 6 | 6 | 0 | 0 |
| v1.2.6 carry-over (`#66` import_mogrt) | 1 | 0 | 1 | 1 (#88) |
| v1.2.10 (`#35` batch) | 1 | 0 | 1 | 1 (#86) |
| v1.2.12 (`#65` auto_reframe — full impl) | 1 | 0.5 (functional but) | 0.5 | 1 (#87) |

**Bottom line:** 14/16 tools PASS, 2 functional fixes but with critical UX bugs (#87 silent active switch, #88 false positive), 1 contradictory error (#86).

---

## 🎯 PRIORITY cho v1.2.13

| # | Severity | LOC estimate |
|----|----------|--------------|
| #88 `import_mogrt_from_library` false positive | 🔥 Critical (silent failure, breaks pipelines) | 15 lines (verification pattern) |
| #87 `auto_reframe_sequence` silent active switch | 🔴 High (breaks nodeId tracking) | 10 lines (apply Bug #76 pattern) |
| #86 `batch_set_clip_property` contradictory errors | 🟠 Medium (UX confusion) | 5-10 lines (fix dedup + setValue signature) |
| Bonus: BOM filter for Lumetri | 🟢 Polish | 3 lines |

**Estimated total v1.2.13 work:** ~30 LOC. After v1.2.13, project should be at ~95% pass rate (all major workflow paths working).

---

## 📁 Session metadata

- **Build under test:** v1.2.12 (`d86a5df`)
- **Project:** Lò nướng.prproj (Premiere 25.4.1)
- **Active sequence:** Sequence 01 Cắt
- **Test sequence cleanup:** RetestReframe_v128 deleted, audio volume + pan reset to 0
- **Test date:** 2026-05-11
- **NodeIds reference:** V1c0=000f4311, A1c0=000f4345

---

## ✨ Major patterns dev đã làm RẤT TỐT trong v1.2.8 → v1.2.12

1. **dB→linear conversion với verification** (#72) — tool returns `volumeLinear`, `verifiedLinear`, `verifiedDb` so tester biết roundtrip
2. **Channel Volume Left/Right approach** (#28) — đúng API path
3. **Array detection in inspect** (#19) — `"[array: N items]"` is user-friendly
4. **Graceful disable với clear workarounds** (#52, #36, #66 base) — KHÔNG spawn dialogs, KHÔNG silent fail
5. **Adobe docs unlock pattern** (#61, #65) — đọc Adobe SDK docs để find correct signature thay vì guess
6. **Summary mode cho large outputs** (#12, #22) — context-overflow guards với `_note` hint
7. **Property filter cho Lumetri** (#25) — filtered 44 internal blob props
8. **Diagnostics cho batch ops** (#35) — per-target `reason` + `availableProps` + `resolved` field

Apply pattern #8 cho mọi batch operation trong project.
