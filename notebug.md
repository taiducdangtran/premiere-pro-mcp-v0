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
