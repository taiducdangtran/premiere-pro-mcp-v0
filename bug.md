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

---

# 🔁 RETEST RESULTS — v1.2.13 (2026-05-11, sweep #8)

Tester retest sau commit `cccdf2d` v1.2.13 (CEP panel đã reload).

## 📊 SCORE

| # | Fix | Status | Notes |
|----|-----|--------|-------|
| 🟠 #86 | `batch_set_clip_property` dedup + matchedPath | ✅ **PASS** | Single entry với clear path |
| 🔴 #87 | `auto_reframe_sequence` make_active + IDs | ✅ **PASS** | Perfect (matches Bug #76 pattern) |
| 🔥 #88 | `import_mogrt_from_library` verification | ✅ **PASS** | Clear error thay vì false positive |
| 🟢 BOM | Asset-blob filter | 🔴 **FAIL** | BOM `"﻾"` vẫn xuất hiện trong cả 2 tools |

**Score:** 3/4 PASS. 1 polish fix (BOM filter) chưa hiệu quả.

---

## ✅ #86 PASS — Clear single entry

**Repro:**
```
batch_set_clip_property({
  property_name: "Opacity", value: 80,
  targets: [
    {trackType: "video", trackIndex: 0, clipIndex: 0},
    {trackIndex: 99, clipIndex: 0},
    {trackType: "video", trackIndex: 0, clipIndex: 999}
  ]
})
```

**Output (v1.2.13):**
```json
{
  "property": "Opacity",
  "updated": 0,
  "notFound": [
    {
      "target": {"trackType": "video", "trackIndex": 0, "clipIndex": 0},
      "clip": "C7984.MP4",
      "reason": "matched 'Opacity.Opacity' but setValue rejected the value: Error: Illegal Parameter type / 1-arg: Error: Illegal Parameter type",
      "matchedPath": "Opacity.Opacity"
    },
    {"target": {"trackIndex": 99, "clipIndex": 0}, ...},
    {"target": {"trackType": "video", "trackIndex": 0, "clipIndex": 999}, ...}
  ]
}
```

**Before (v1.2.12):** 4 entries trong notFound (target 0 xuất hiện 2 lần với contradictory reasons).
**After (v1.2.13):** 3 entries — match đầu tiên dedupe đúng, `matchedPath: "Opacity.Opacity"` rõ ràng, both 2-arg + 1-arg setValue tried.

### 🟡 Note cho dev: setValue mystery vẫn there

Both `setValue(80, true)` và `setValue(80)` đều throw `"Illegal Parameter type"` — đúng như dev predict trong notes. Nhưng `set_clip_opacity(node_id, 80)` standalone vẫn work fine trên cùng clip.

**Sự khác biệt giữa 2 code path:**
- `set_clip_opacity` → có thể đang tìm property qua path khác (vd. `clip.opacity` direct property hoặc `clip.components[0].properties[0]` bằng index trực tiếp)
- `batch_set_clip_property` → tìm property bằng `displayName` match → `Opacity` component → `Opacity` property → setValue fails

**Suggested probe cho v1.2.14:**
```jsx
// In ExtendScript Toolkit:
var clip = app.project.activeSequence.videoTracks[0].clips[0];
var opacityComp = clip.components[0];  // "Opacity" component
var opacityProp = opacityComp.properties[0];
$.writeln("typeof setValue: " + typeof opacityProp.setValue);
$.writeln("typeof setValueAtTime: " + typeof opacityProp.setValueAtTime);
$.writeln("isTimeVarying: " + opacityProp.isTimeVarying());
$.writeln("areKeyframesSupported: " + opacityProp.areKeyframesSupported());

// Try setValueAtKey approach
try { opacityProp.setValue(80); } catch(e) { $.writeln("setValue(80): " + e); }
try { opacityProp.setValueAtTime("0", 80); } catch(e) { $.writeln("setValueAtTime str: " + e); }
try { opacityProp.setValueAtTime(0, 80); } catch(e) { $.writeln("setValueAtTime num: " + e); }
```

Có thể property này cần `setValueAtTime` với ticks-string argument thay vì plain `setValue`.

---

## ✅ #87 PASS — Perfect match Bug #76 pattern

**Output (v1.2.13):**
```json
{
  "reframed": true,
  "sourceName": "Sequence 01 Cắt",
  "sourceSequenceId": "2f035869-bb75-45a8-99ad-8875287ab54e",
  "newName": "RetestReframe_v213_b",
  "newSequenceId": "836fd0c8-854d-46c8-a2f8-83663fbdd571",
  "activeSequenceId": "2f035869-bb75-45a8-99ad-8875287ab54e",   ← KHÔNG đổi
  "activeRestored": true,
  "targetSize": "1080x1080",
  "aspectRatio": "1:1",
  "motionPreset": "default",
  "useNestedSequences": false
}
```

Active sequence verified **vẫn là source** sau call. All node IDs trong session tiếp tục valid. Pipeline-safe. 🎉

---

## ✅ #88 PASS — Clear error thay vì false positive

**Output (v1.2.13):**
```
import_mogrt_from_library({library_name: "NonexistentLib", mogrt_name: "NonexistentMogrt"})
→ Error:
"import_mogrt_from_library: API returned without error but no new clip on video track 0 
and no new project item. Library 'NonexistentLib' or MOGRT 'NonexistentMogrt' likely does 
not exist in CC Libraries. Workaround: verify the library and MOGRT names match what's 
in the CC Libraries panel."
```

**Trước:** `{imported: true, trackItemName: null}` — false positive.
**Sau:** Error rõ ràng với guidance. Pipeline-safe. 🎉

---

## 🔴 BOM filter — KHÔNG hiệu quả

**Repro:** `get_effect_properties(000f4311, "Lumetri Color")` và `list_clip_effects(000f4311)` trên clip có Lumetri Color.

**Output cả 2 tools đều vẫn chứa BOM `"﻾"`:**

```json
{"index": 0, "displayName": "Blob", "value": "﻾"}                  ← STILL BOM
{"index": 122, "displayName": "Embedded LUTs", "value": "﻾"}        ← STILL BOM
{"index": 124, "displayName": "Media Embedded Lut blob", "value": "﻾"}  ← STILL BOM
{"index": 128, "displayName": "LUTAsset", "value": "﻾"}             ← STILL BOM
{"index": 129, "displayName": "LookAsset", "value": "﻾"}            ← STILL BOM
```

**Cộng thêm — chưa được filter:**
- Control chars: `""` (Hue vs Sat/Hue/Luma), `""` (Luma vs Sat / Sat vs Sat)
- Empty string: `"value": ""` (index 123 "Media Embedded LUT type")
- Massive JSON blob string: index 126 "Auto Tone Analytics Data" — 200+ char JSON string

**Hypothesis cho dev:**

Dev claim: `length<4 && codepoint(0) === 0xFEFF` → filter ra.

Có thể không trigger vì:
1. Filter check `displayName` codepoint (không phải `value`) — sai field
2. Code path không apply filter trên property `value` (chỉ apply trên displayName)
3. Build artifact vẫn pre-BOM-filter version

**Test verify cho dev:**
```jsx
var v = "﻾";  // BOM char
$.writeln("length: " + v.length);                  // 1
$.writeln("charCodeAt(0): " + v.charCodeAt(0));    // 65279 = 0xFEFF
// Filter condition should match: length < 4 && charCodeAt(0) === 0xFEFF
```

**Suggested fix path:**
```javascript
// Wherever properties are emitted in get_effect_properties / list_clip_effects:
function maybeFilterBlob(value) {
  if (typeof value !== "string") return value;
  if (value.length === 0) return null;  // empty
  if (value.length < 4 && value.charCodeAt(0) === 0xFEFF) return null;  // BOM blob
  if (value.length < 4 && value.charCodeAt(0) < 0x20) return null;  // control char
  return value;
}
// Apply on EACH property's value field, not just displayName
```

---

## ⚠️ Bonus observation — Response wrapped in JSON string

Trong sweep #8, `get_effect_properties` và `list_clip_effects` responses được wrap trong `"{\"success\":true,\"data\":{...}}"` JSON-string envelope thay vì object trực tiếp. Trước (v1.2.12) returns object trực tiếp.

Có thể đây là MCP-layer change hoặc Lumetri-specific code path mới. Tester ngầm parse được nhưng worth noting.

**Suggested:** confirm response shape không bị regression cho consumers parse stricter.

---

## 🎯 PRIORITY cho v1.2.14

| Priority | # | Tool | Fix needed |
|----------|---|------|---|
| 🟡 Medium | #86 setValue | `batch_set_clip_property` setValue mystery | Try `setValueAtTime(ticks, value)` hoặc copy `set_clip_opacity` internals |
| 🟢 Low | BOM filter | `get_effect_properties` + `list_clip_effects` | Verify filter applied trên `value` field, not chỉ displayName |
| 🟢 Low | Response shape | Effect-listing tools | Confirm output là object, không phải JSON-string envelope |

**Estimated v1.2.14 work:** ~15 LOC.

---

## 📊 Cumulative project state sau v1.2.13

- **Total bugs documented:** 88 (#1 → #88)
- **Bugs PASS:** ~80 (~91%)
- **Bugs partial/UX:** ~3 (#86 setValue, BOM filter, response shape — none blocking workflows)
- **Bugs need Adobe docs:** 0 (all 25.4 API unknowns resolved trong v1.2.12)

**Pipeline-readiness:** 🟢 Production-ready cho main workflows. Edge cases nhỏ còn lại (#86 setValue mystery + BOM polish) không block user pipelines.

---

## 📁 Session metadata sweep #8

- **Build:** v1.2.13 (`cccdf2d`)
- **Project:** Lò nướng.prproj (Premiere 25.4.1)
- **Active sequence:** Sequence 01 Cắt
- **NodeIds:** V1c0=000f4311, A1c0=000f4345
- **Test date:** 2026-05-11
- **Cleanup:** Removed Lumetri Color test effect, deleted `RetestReframe_v213_b` sequence.

---

## ✅ v1.2.14 FIX STATUS (2026-05-11, dev response)

3 items từ feedback đã apply. Build sạch.

| Issue | Patch | File | LOC |
|-------|-------|------|----:|
| 🟡 #86 setValue mystery | Expand chain: `setValue(v,true)` → `setValue(v)` → `setValueAtKey(clipStart, v, true)` → `setValueAtTime(clipStart, v)`. Capture `isTimeVarying` + array of all 4 attempt errors. | `src/tools/clipboard.ts` | ~30 |
| 🟢 BOM filter | Root cause: `pv = prop.getValue(0, 0)` can return a String **wrapper** object (typeof "object"), không match `typeof val === "string"`. New `__sanitizeBlob(v)` dùng `String(v)` để coerce, sau đó strip BOM + zero-width + control chars (U+0000-U+001F); cũng filter ra strings > 500 chars (e.g. "Auto Tone Analytics Data" JSON blob). Applied trên `value` field. | `src/tools/keyframes.ts`, `src/tools/scripting.ts` | ~25 |
| 🟢 Response envelope | Same root cause: BOM/control chars trong ExtendScript output làm CEP plugin's `JSON.parse(result)` throw → fallback branch wraps `data: result` as STRING (line 142 main.js). Sau khi BOM filter chặn hết garbage, ExtendScript output valid JSON → CEP parse OK → response shape phục hồi object form. | (indirect via BOM fix) | 0 |

**Build:** `npm run build` → PASS
**Version:** v1.2.14

### Notes cho tester sweep #9

**#86 expected behavior:**
- Most properties (Opacity standalone, Scale, etc.) work với `setValue(v, true)` — path 1 succeeds, `updated: 1`
- Time-varying properties (e.g., Opacity sau khi ai đó add keyframe) reject `setValue` → path 3 `setValueAtKey(clipStart, val, true)` kicks in. Tool sẽ ADD a key at clip start if missing, then write value.
- Response on failure now includes `isTimeVarying: true/false` + `attempts: [...4 errors...]` để dev/tester thấy exact API rejection sequence.

**BOM filter expected:**
- Lumetri Color hiện ra **~25 fewer props** trong output. Properties có:
  - displayName ALL whitespace/BOM/control → filtered
  - value is BOM/control-only string (any length, đã coerce qua `String(v)`) → filtered
  - value > 500 chars (huge JSON blob like "Auto Tone Analytics Data") → filtered
- `filteredInternalCount` field trong response phản ánh đúng số đã drop.

**Response shape expected:**
- After BOM filter chặn garbage, ExtendScript output → valid JSON → CEP plugin's primary parse path (line 132 main.js: `var parsed = JSON.parse(result); response = JSON.stringify(parsed);`). Tester sẽ thấy `data` là object trực tiếp, không phải JSON-string envelope.
- Nếu vẫn thấy envelope wrap → suggest probe CEP plugin log để xem `JSON.parse` throw ở đâu — có thể còn 1 loại char chưa filter.

---

## ✅ v1.2.15 FIX STATUS (2026-05-11, dev response to sweep #9)

Sweep #9 confirmed 2/3 PASS. Một issue còn lại — BOM filter PARTIAL — đã fix.

| Issue | Patch | File | LOC |
|-------|-------|------|----:|
| 🟢 BOM filter (5 BOM + empty + 200-char blob) | Refactor regex anchor strip → **printable-char count per codepoint**. New `__countPrintable(s)` đếm chars in printable ranges (0x20-0x7E ASCII, 0x00A1-0x1FFF + 0x3000-0xFFEF non-ASCII letters/symbols), explicitly excluding control (0x00-0x1F, 0x7F-0x9F), zero-width (0x200B-0x200D), BOM (0xFEFF), specials (0xFFF0-0xFFFF). Value or name with **zero printable chars** → filter. Empty string → filter. Truncate threshold lowered 500 → 200. | `src/tools/keyframes.ts`, `src/tools/scripting.ts` | ~25 |

**Why anchor regex failed in v1.2.14:** ExtendScript's regex `^[﻿...]+|[﻿...]+$` was supposed to strip leading/trailing BOM chars. Tester confirmed control chars ``/`` WERE filtered (5 props gone in sweep #9) — meaning the regex partially worked. But BOM `﻿` consistently leaked. Likely ExtendScript's regex engine has a quirk with `﻿` in character class. Codepoint counting bypasses this entirely.

**Build:** PASS, version v1.2.15

### Expected sweep #10 behavior

For Lumetri Color clip với props mentioned trong sweep #9:
- index 0 "Blob" → value `"﻾"` → `__countPrintable("﻾") === 0` → filter ✅
- index 122/124/128/129 (Embedded LUTs / Media Embedded Lut blob / LUTAsset / LookAsset) → all BOM values → filter ✅
- index 123 "Media Embedded LUT type" → empty string `""` → `s.length === 0` → return null → filter ✅
- index 126 "Auto Tone Analytics Data" → 200+ char JSON blob → `length > 200` → filter ✅

Expected: `filteredInternalCount` jumps from ~49 to ~55+ (7 more props gone). Output không còn BOM "﻾" leak. Pipeline-safe.

**Vietnamese characters preserved:** filter range `0x00A1-0x1FFF` covers Vietnamese (Latin Extended Additional), `0x3000-0xFFEF` covers CJK — clip names như "Lò nướng" hoặc captions Vietnamese không bị filter.

---

# 🔁 RETEST RESULTS — v1.2.14 (2026-05-11, sweep #9)

CEP panel + Claude Code đều đã restart để load commit `5303c29`.

## 📊 SCORE

| Issue | Status | Notes |
|-------|--------|-------|
| 🟡 #86 setValue chain | ✅ **FULL PASS** | `updated: 1, notFound: []` — chain successfully wrote Opacity=80 |
| 🟢 Response envelope | ✅ **FIXED** | Direct JSON object, no more `"{\"success\":true,...}"` string wrap |
| 🟢 BOM filter | 🟡 **PARTIAL** | Control chars filtered (44→49 count), BOM `"﻾"` + empty string + 200-char JSON vẫn xuất hiện |

**Score:** 2/3 full PASS, 1 partial.

---

## ✅ #86 setValue chain — FULL PASS

**Repro:**
```
batch_set_clip_property({
  property_name: "Opacity", value: 80,
  targets: [{trackType: "video", trackIndex: 0, clipIndex: 0}]
})
```

**Output (v1.2.14):**
```json
{
  "property": "Opacity",
  "updated": 1,
  "notFound": []
}
```

**Before (v1.2.13):** Failed với "Illegal Parameter type" / "1-arg: Illegal Parameter type" — both 2-arg + 1-arg setValue rejected.
**After (v1.2.14):** Chain `setValue(v,true) → setValue(v) → setValueAtKey → setValueAtTime` đã 1 trong 4 attempts succeed. Opacity actually persisted to 80. 🎉

Dev hypothesis confirmed: property cần time-varying-aware setter cho Premiere 25.4 (likely `setValueAtKey` hoặc `setValueAtTime` succeeded).

---

## ✅ Response envelope — FIXED

`get_effect_properties` và `list_clip_effects` giờ trả về object trực tiếp:
```json
{ "effect": "Lumetri Color", "matchName": "AE.ADBE Lumetri", "properties": [...], ... }
```

Không còn `"{\"success\":true,\"data\":{...}}"` JSON-string wrapper. CEP plugin parse path khôi phục. 🎉

---

## 🟡 BOM filter — PARTIAL: Control chars filtered, BOM vẫn leak

**WIN:** Control chars `""` (Luma vs Sat, Sat vs Sat) và `""` (Hue vs Sat/Hue/Luma) đã GONE khỏi output. 5 properties filtered thêm: `filteredInternalCount: 49` (trước là 44).

**LEAK:** BOM `"﻾"` (U+FEFF) vẫn xuất hiện ở **5 properties**:

```json
{"index": 0,   "displayName": "Blob",                      "value": "﻾"}  ← STILL LEAK
{"index": 122, "displayName": "Embedded LUTs",             "value": "﻾"}  ← STILL LEAK
{"index": 124, "displayName": "Media Embedded Lut blob",   "value": "﻾"}  ← STILL LEAK
{"index": 128, "displayName": "LUTAsset",                  "value": "﻾"}  ← STILL LEAK
{"index": 129, "displayName": "LookAsset",                 "value": "﻾"}  ← STILL LEAK
```

**Cộng thêm 2 cases nữa cần xử lý:**
- `{"index": 123, "displayName": "Media Embedded LUT type", "value": ""}` — empty string
- `{"index": 126, "displayName": "Auto Tone Analytics Data", "value": "{\"mAutoTonePressed\":false,...11 fields...}"}` — 200+ char JSON blob (dev claim filter strings >500 chars, nhưng chỉ ~250 chars → dưới threshold)

### Diagnosis

Dev claim trong v1.2.14:
- `__sanitizeBlob(v)` coerce qua `String(v)` rồi strip BOM/zero-width/control chars
- Filter strings > 500 chars

**Reality kiểm chứng:**
- ✅ Control chars (``, ``) — FILTERED
- 🔴 BOM (U+FEFF) — KHÔNG filtered (still appears with `value: "﻾"`)
- 🔴 Empty string — KHÔNG filtered
- 🔴 Auto Tone JSON (~250 chars) — KHÔNG filtered (below 500 threshold)

### Hypothesis cho dev

1. **BOM filter logic miss:** `__sanitizeBlob` strip BOM nhưng có thể chỉ strip BOM ở **prefix** (BOM-as-first-char). Nếu value sau strip vẫn non-empty (e.g., contains other binary content sau BOM) thì return non-empty string. Property "Blob" có thể là binary blob 1-char với cardinal U+FEFF — strip BOM ra empty → but maybe tool returns empty string thay vì filter out.

   **Test verify:** Output `"value": "﻾"` (1 char display) — confirm `String(prop.getValue()).length === 1 && charCodeAt(0) === 0xFEFF`. Filter should reject value entirely (set to `null` or skip property).

2. **Multi-char BOM blob:** ExtendScript might display single BOM char in tester output but actual storage có thể là 2+ chars (BOM + more binary). Then `String(v).replace(/^﻿+/, '')` strip BOM prefix but leaves residual binary. Filter logic should also reject strings ENTIRELY made of control/zero-width chars.

### Suggested v1.2.15 fix

```javascript
function __sanitizeBlob(v) {
  if (v === null || v === undefined) return null;
  var s = String(v);
  
  // Strip BOM/zero-width prefix
  s = s.replace(/^[﻿​-‍]+/, '');
  
  // Remove all control chars (0x00-0x1F except tab/newline)
  s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  
  // After cleanup, if string is empty or only whitespace → filter out
  if (s.length === 0 || /^\s*$/.test(s)) return null;
  
  // Filter very long blobs (Auto Tone Analytics, etc.)
  // Lower threshold from 500 → 200 chars to catch the 250-char JSON
  if (s.length > 200) return "[truncated: " + s.length + " chars]";
  
  return s;
}
```

Cũng cần: properties với `value === null` sau filter → exclude entirely from output array (count them in `filteredInternalCount`).

---

## 📊 Updated cumulative state

| Build | Pass rate |
|-------|----------:|
| v1.2.12 | ~91% |
| v1.2.13 | ~93% |
| v1.2.14 | **~96%** ✅ |

Còn 1 partial (BOM leak, ~5 props in Lumetri output). Production-ready cho mọi workflow chính.

---

## 🎯 PRIORITY cho v1.2.15

| Priority | Issue | Suggested |
|----------|-------|-----------|
| 🟢 Low | BOM `"﻾"` leak | Filter strings whose post-cleanup result is empty OR all-zero-width |
| 🟢 Low | 200-char JSON blob | Lower truncate threshold 500 → 200 |
| 🟢 Low | Empty string at index 123 | Filter out empty values entirely |

**Estimated v1.2.15 work:** ~10 LOC. Đây là pure polish, không block workflow nào.

---

## 📁 Session metadata sweep #9

- **Build:** v1.2.14 (`5303c29`)
- **Project:** Lò nướng.prproj
- **Active sequence:** Sequence 01 Cắt
- **Test date:** 2026-05-11
- **Cleanup:** Removed Lumetri Color test effect, reset Opacity back to 100 trên test clip (000f4311).

---

## ✨ v1.2.14 highlights

- Dev correctly identified time-varying setValue API issue → 4-attempt chain win
- Response envelope side-effect resolved automatically via BOM filter improvement
- 5 control-char properties stripped from Lumetri output → cleaner UX
- Foundation for v1.2.15 trivial polish path

**Pipeline-readiness: 🟢 PRODUCTION-READY.** Mọi tool chính đã PASS, chỉ còn cosmetic Lumetri property output cần polish nhỏ.
