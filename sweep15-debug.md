# Sweep #15 Debug — Group B (#101 + 4 DOM signature)

**Phạm vi:** rà sâu 5 bug để dev fix v1.2.20.
**Build base:** v1.2.19 (`6a1bb9d`).
**Phương pháp:** đọc handler hiện tại + đối chiếu với `notebug.md` API-regression pattern + Adobe historical signatures. Mỗi bug có **probe script** dev nên chạy trên Premiere thật để xác định signature đúng trước khi commit fix.

---

## 🔥 #101 — `undo` / `multiple_undo` broken

### Hiện trạng

[src/tools/project.ts:89-133](src/tools/project.ts#L89-L133) đã có fallback chain:
1. `app.project.undo()` — undefined (Bug #54)
2. `app.executeCommand(findMenuCommandId("Undo"))` — cả 2 functions undefined (notebug.md L185-187)
3. Fallback: return `__result({ undone: 0, available: false, note: ... })`

[src/tools/track-targeting.ts:1286-1326](src/tools/track-targeting.ts#L1286-L1326) đối với `multiple_undo` — y hệt logic.

### Root cause của #101

**Không phải code sai** — tất cả 3 API Adobe đã liệt kê đều thật sự undefined trong 25.4 (notebug.md xác nhận từ Bug #54/#55). Vấn đề là **handler trả `success: true`** với `undone: 0`. Caller check `result.success` → true → giả định undo xong → tiếp tục flow → state không revert → false-positive cascade.

### Bằng chứng

```js
// src/tools/project.ts:125-129
return __result({
  undone: 0,
  available: false,
  note: "undo API removed in 25.4..."
});
```

`__result` → MCP response `success: true`. Caller phải check `data.available === false` thì mới biết — không LLM nào làm việc này.

### Fix Option A (minimum viable — đổi sang error response)

[src/tools/project.ts:125](src/tools/project.ts#L125) và [src/tools/track-targeting.ts:1319](src/tools/track-targeting.ts#L1319): đổi `__result(...)` → `__error(...)`:

```js
return __error({
  reason: "undo API removed in Premiere 25.4 — no replacement found",
  undone: 0,
  available: false,
  triedPaths: ["app.project.undo", "app.executeCommand(findMenuCommandId('Undo'))"],
  workaround: "Press Cmd/Ctrl+Z in Premiere UI",
});
```

→ `success: false` về MCP, caller biết ngay tool không khả dụng.

### Fix Option B (deeper — thêm probe path mới)

Thêm 3 path nữa **trước khi** fallback error. Dev probe thực tế xem path nào chạy được:

```js
// Path 3: qe.project.undo()
try {
  app.enableQE();
  if (qe && qe.project && typeof qe.project.undo === "function") {
    for (var k = 0; k < count; k++) {
      try { qe.project.undo(); undone++; } catch(eQU) { break; }
    }
    return __result({ undone: undone, method: "qe.project.undo" });
  }
} catch(eQE) {}

// Path 4: qe.executeCommand("Edit/Undo") — undocumented QE menu invocation
try {
  if (qe && typeof qe.executeCommand === "function") {
    for (var m = 0; m < count; m++) {
      try { qe.executeCommand("Edit/Undo"); undone++; } catch(eQC) { break; }
    }
    return __result({ undone: undone, method: "qe.executeCommand" });
  }
} catch(eQE2) {}

// Path 5: qe.ui.undo() — undocumented
try {
  if (qe && qe.ui && typeof qe.ui.undo === "function") {
    for (var n = 0; n < count; n++) {
      try { qe.ui.undo(); undone++; } catch(eUU) { break; }
    }
    return __result({ undone: undone, method: "qe.ui.undo" });
  }
} catch(eUE) {}
```

### Probe script dev chạy trước khi quyết Option

Paste vào `execute_extendscript`:

```js
app.enableQE();
var probes = [];
function add(name, fn) {
  try { var ok = !!fn(); probes.push(name + ": " + (ok ? "OK" : "returned falsy")); }
  catch(e) { probes.push(name + ": " + e.toString()); }
}
add("typeof qe", function(){ return typeof qe; });
add("typeof qe.project", function(){ return typeof qe.project; });
add("typeof qe.project.undo", function(){ return typeof qe.project.undo; });
add("typeof qe.executeCommand", function(){ return typeof qe.executeCommand; });
add("typeof qe.ui", function(){ return typeof qe.ui; });
add("typeof qe.ui && qe.ui.undo", function(){ return qe.ui && typeof qe.ui.undo; });
add("typeof app.enableQE", function(){ return typeof app.enableQE; });
return __result({ probes: probes });
```

→ Dev báo lại output, dev sẽ biết chọn Option A (chỉ sửa error) hay Option B (có path mới hoạt động).

### Khuyến nghị

**Option A trước** (fix nhanh, không hối tiếc). Song song chạy probe Option B. Nếu probe có path work → bump Option B vào v1.2.21.

---

## 🔴 #95 — `create_bars_and_tone` "Illegal Parameter type"

### Hiện trạng

[src/tools/project.ts:458](src/tools/project.ts#L458):

```js
app.project.newBarsAndTone(${w}, ${h}, timebase, "${name}");
// → newBarsAndTone(1920, 1080, "254016000000", "Bars and Tone")
```

### Root cause (suspect)

Adobe historical signature cho `newBarsAndTone` có nhiều bản:
- **Pre-2018:** `newBarsAndTone(width, height, timebase, name)` — 4 args, tool đang dùng signature này
- **2018+:** `newBarsAndTone(width, height, pixelAspectRatio, fields, timebase, sampleRate, name)` — 7 args
- **2020+:** `newBarsAndTone(width, height, pixelAspectRatio, timebase, fields, sampleRate, channelType, name)` — 8 args

"Illegal Parameter type" xảy ra khi Adobe match arg position với type khác — ví dụ position 3 expect number (PAR) nhưng nhận string (timebase). Đây là dấu hiệu signature 25.4 đã thay đổi.

### Probe script

```js
var p = app.project;
var info = {
  typeOfFn: typeof p.newBarsAndTone,
  fnLength: (typeof p.newBarsAndTone === "function") ? p.newBarsAndTone.length : null,
};
// Adobe sometimes exposes arity via Function.length
return __result(info);
```

Nếu `fnLength` = 4 → signature hiện tại đúng → vấn đề là `timebase` string sai format. Thử pass `254016000000` (raw number, không quote).

Nếu `fnLength` = 7 hoặc 8 → cần thêm args. Thử:

```js
// Trial 8-arg signature
app.project.newBarsAndTone(1920, 1080, 1.0, "254016000000", 0, 48000, 1, "Test");
//                          w     h    par  timebase           field  rate    chan  name
```

### Fix proposal

Wrap multi-signature probe:

```js
var attempts = [];
function tryCall(sig, fn) {
  try { fn(); return { ok: true, sig: sig }; }
  catch(e) { attempts.push(sig + ": " + e.toString()); return null; }
}
var r = tryCall("4-arg(w,h,timebase,name)", function() {
  return app.project.newBarsAndTone(w, h, timebase, name);
});
if (!r) r = tryCall("8-arg(w,h,par,timebase,fields,rate,chan,name)", function() {
  return app.project.newBarsAndTone(w, h, 1.0, timebase, 0, 48000, 1, name);
});
if (!r) r = tryCall("7-arg(w,h,par,fields,timebase,rate,name)", function() {
  return app.project.newBarsAndTone(w, h, 1.0, 0, timebase, 48000, name);
});
if (!r) return __error({ reason: "all signatures rejected", attempts: attempts });
return __result({ created: true, signature: r.sig, ... });
```

---

## 🔴 #96 — `add_universal_counting_leader` "Not Enough Parameters"

### Hiện trạng

[src/tools/generators.ts:113](src/tools/generators.ts#L113):

```js
qe.project.newUniversalCountingLeader(
  seq.frameSizeHorizontal,
  seq.frameSizeVertical
);
```

### Root cause (suspect)

Error là **"Not Enough Parameters"** — QE rõ ràng nói "thiếu args". Adobe historical QE signature cho `newUniversalCountingLeader`:
- **CC2017+:** `newUniversalCountingLeader(width, height, pixelAspectRatio, timebase, fields, sampleRate, channelType)` — 7 args

Tool đang pass 2 args (width, height). Thiếu 5 args.

### Probe script

```js
app.enableQE();
var info = {
  typeOfFn: typeof qe.project.newUniversalCountingLeader,
  fnLength: (typeof qe.project.newUniversalCountingLeader === "function")
    ? qe.project.newUniversalCountingLeader.length : null,
};
return __result(info);
```

### Fix proposal

```js
var seq = app.project.activeSequence;
app.enableQE();
var w = seq.frameSizeHorizontal;
var h = seq.frameSizeVertical;
var par = (seq.getSettings && seq.getSettings().videoPixelAspectRatio) || 1.0;
var timebase = String(seq.timebase || "254016000000");
var fields = 0;          // 0 = progressive
var sampleRate = 48000;
var channelType = 1;     // 1 = stereo

try {
  qe.project.newUniversalCountingLeader(w, h, par, timebase, fields, sampleRate, channelType);
  return __result({ created: true, signature: "7-arg" });
} catch(e7) {
  // Fallback to 4-arg
  try {
    qe.project.newUniversalCountingLeader(w, h, par, timebase);
    return __result({ created: true, signature: "4-arg" });
  } catch(e4) {
    return __error({ reason: "all signatures failed", e7: e7.toString(), e4: e4.toString() });
  }
}
```

**Lưu ý:** `add_black_video` cũng dùng pattern 2-arg tương tự ([generators.ts:16-19](src/tools/generators.ts#L16-L19)) → nếu #96 bị "Not Enough Parameters", `add_black_video` cũng có thể bị (chưa được tester verify trong sweep #13). Cần probe cả 2.

---

## 🔴 #98 — `move_clip_to_track` "Not Enough Parameters"

### Hiện trạng

[src/tools/advanced.ts:135](src/tools/advanced.ts#L135):

```js
qeClip.moveToTrack(${args.target_track_index});
```

### Root cause (suspect)

[src/resources/extendscript-reference.ts:219](src/resources/extendscript-reference.ts#L219) ghi `qeClip.moveToTrack(trackIndex)` — 1 arg. Nhưng tester báo "Not Enough Parameters".

Adobe historical signature cho `qeClip.moveToTrack`:
- **Old QE:** `moveToTrack(targetVTrack, targetA1Track, targetA2Track, targetA3Track, targetA4Track)` — 5 args (cho linked V+A clips)
- **Newer QE:** `moveToTrack(targetTrackIndex, isAudio)` — 2 args
- **Reference docs claim:** 1 arg

Bug có thể do clip là V+A linked → QE yêu cầu cả target cho video AND audio track.

### Probe script

```js
app.enableQE();
var qeSeq = qe.project.getActiveSequence();
var qeTrack = qeSeq.getVideoTrackAt(0);
var qeClip = null;
for (var i = 0; i < qeTrack.numItems; i++) {
  var qc = qeTrack.getItemAt(i);
  if (qc && qc.type !== "Empty") { qeClip = qc; break; }
}
return __result({
  typeOfMove: typeof qeClip.moveToTrack,
  fnLength: (typeof qeClip.moveToTrack === "function") ? qeClip.moveToTrack.length : null,
});
```

### Fix proposal

```js
var target = ${args.target_track_index};
var attempts = [];

// Attempt 1: 1-arg
try {
  qeClip.moveToTrack(target);
  return __result({ moved: true, signature: "1-arg" });
} catch(e1) { attempts.push("1-arg: " + e1.toString()); }

// Attempt 2: 2-arg (target, isAudio)
try {
  var isAudio = (result.trackType === "audio");
  qeClip.moveToTrack(target, isAudio ? 1 : 0);
  return __result({ moved: true, signature: "2-arg" });
} catch(e2) { attempts.push("2-arg: " + e2.toString()); }

// Attempt 3: 5-arg legacy (vT, a1, a2, a3, a4) — for linked V+A clip
try {
  if (result.trackType === "video") {
    qeClip.moveToTrack(target, -1, -1, -1, -1);
  } else {
    qeClip.moveToTrack(-1, target, -1, -1, -1);
  }
  return __result({ moved: true, signature: "5-arg-legacy" });
} catch(e3) { attempts.push("5-arg: " + e3.toString()); }

return __error({ reason: "all moveToTrack signatures failed", attempts: attempts });
```

---

## 🔴 #100 — `freeze_frame` `seq.exportFramePNG is not a function`

### Hiện trạng

[src/tools/utility.ts:316](src/tools/utility.ts#L316):

```js
seq.exportFramePNG(timeTicks, "${args.output_path}");
```

### Root cause (đã xác nhận)

`seq.exportFramePNG` đã removed trong Premiere 25.4 (notebug.md L1004, Bug #57). [src/tools/export.ts:104-127](src/tools/export.ts#L104-L127) — `export_frame` đã có defensive pattern → tier xuống `exportFrameJPEG` → fallback error.

### Bonus bug phát hiện: `capture_frame` cũng broken

[src/tools/export.ts:408](src/tools/export.ts#L408) — `capture_frame` cũng gọi `seq.exportFramePNG` **không** defensive. Sweep #13 chưa test → chưa report. Cùng v1.2.20 nên fix cả 2.

### Fix proposal

Copy paste defensive pattern từ `export_frame` (export.ts:104-127) vào cả `freeze_frame` và `capture_frame`:

```js
// freeze_frame fix
var outputPath = "${escapeForExtendScript(args.output_path)}";
var exported = false;
var method = null;

if (typeof seq.exportFramePNG === "function") {
  try { seq.exportFramePNG(timeTicks, outputPath); exported = true; method = "exportFramePNG"; }
  catch(e1) {}
}
if (!exported && typeof seq.exportFrameJPEG === "function") {
  try { seq.exportFrameJPEG(timeTicks, outputPath); exported = true; method = "exportFrameJPEG"; }
  catch(e2) {}
}
if (!exported) {
  return __error({
    reason: "seq.exportFramePNG and exportFrameJPEG both unavailable in 25.4",
    workaround: "Use capture_frame tool (returns base64) or File > Export > Frame in UI"
  });
}

// Import back
app.project.importFiles([outputPath], false, app.project.rootItem, false);
return __result({ exported: true, method: method, ... });
```

### Probe script

```js
var seq = app.project.activeSequence;
return __result({
  exportFramePNG: typeof seq.exportFramePNG,
  exportFrameJPEG: typeof seq.exportFrameJPEG,
  exportFrame: typeof seq.exportFrame,
  // Bonus: check newer 25.x APIs
  exportToFile: typeof seq.exportToFile,
});
```

### Khuyến nghị bổ sung

Update [src/resources/extendscript-reference.ts:33](src/resources/extendscript-reference.ts#L33) — đang ghi `app.project.undo()` như API valid. Sửa thành comment "REMOVED in 25.4". Cũng update [extendscript-reference.ts:219](src/resources/extendscript-reference.ts#L219) cho `qeClip.moveToTrack` ghi rõ arity uncertainty.

---

## 📊 Tóm tắt fix priority cho v1.2.20

| Bug | Complexity | Risk | Action |
|---|:-:|:-:|---|
| **#101** | Low (Opt A) / Med (Opt B) | 🔴 blocker | Đổi `__result` → `__error` ngay (Opt A). Probe Opt B song song. |
| **#100** | Low | 🟠 high | Copy defensive pattern từ `export_frame`. Sửa cả `capture_frame`. |
| **#96** | Med | 🟠 high | Probe arity → wrap 4/7-arg signatures. Cũng audit `add_black_video`. |
| **#95** | Med | 🟠 high | Probe arity → wrap 4/7/8-arg signatures. |
| **#98** | Med | 🟠 high | Wrap 1/2/5-arg probes. |

**Tổng:** 5 fix + 2 audit (`add_black_video`, `capture_frame`) + 2 doc update (`extendscript-reference.ts`).

---

## 🧪 Test plan sau khi dev fix

Tester chạy lại nhóm cụ thể:
1. `undo`, `multiple_undo` — expect `success: false` với error rõ (hoặc `success: true` nếu Opt B tìm được path).
2. `create_bars_and_tone`, `add_universal_counting_leader`, `add_black_video` — expect project panel có item mới.
3. `move_clip_to_track` — expect clip nhảy track thật (verify qua `list_sequence_tracks`).
4. `freeze_frame`, `capture_frame` — expect file PNG/JPEG xuất ra hoặc `success: false` rõ.

Mỗi tool dán probe output trước/sau để dev có baseline cho v1.2.21+ nếu cần debug tiếp.
