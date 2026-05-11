/**
 * Builds ExtendScript strings with helper functions prepended.
 * All generated code must be ES3-compatible (var, no arrow functions, no let/const).
 */

const HELPERS = `
// === MCP Bridge Helpers (auto-prepended) ===

var TICKS_PER_SECOND = 254016000000;

function __ticksToSeconds(ticks) {
  return parseFloat(ticks) / TICKS_PER_SECOND;
}

function __secondsToTicks(seconds) {
  return Math.round(parseFloat(seconds) * TICKS_PER_SECOND);
}

function __ticksToTimecode(ticks, fps) {
  var totalSeconds = __ticksToSeconds(ticks);
  var hours = Math.floor(totalSeconds / 3600);
  var minutes = Math.floor((totalSeconds % 3600) / 60);
  var secs = Math.floor(totalSeconds % 60);
  var frames = Math.floor((totalSeconds % 1) * fps);
  return __pad(hours) + ":" + __pad(minutes) + ":" + __pad(secs) + ":" + __pad(frames);
}

function __pad(n) {
  return n < 10 ? "0" + n : "" + n;
}

function __findSequence(idOrName) {
  var project = app.project;
  for (var i = 0; i < project.sequences.numSequences; i++) {
    var seq = project.sequences[i];
    if (seq.sequenceID === idOrName || seq.name === idOrName) {
      return seq;
    }
  }
  return null;
}

function __findProjectItem(nodeIdOrName, rootItem) {
  if (!rootItem) rootItem = app.project.rootItem;
  for (var i = 0; i < rootItem.children.numItems; i++) {
    var item = rootItem.children[i];
    if (item.nodeId === nodeIdOrName || item.name === nodeIdOrName) {
      return item;
    }
    if (item.type === 2) { // Bin
      var found = __findProjectItem(nodeIdOrName, item);
      if (found) return found;
    }
  }
  return null;
}

function __findClip(nodeId) {
  var seq = app.project.activeSequence;
  if (!seq) return null;

  // Search video tracks
  for (var t = 0; t < seq.videoTracks.numTracks; t++) {
    var track = seq.videoTracks[t];
    for (var c = 0; c < track.clips.numItems; c++) {
      var clip = track.clips[c];
      if (clip.nodeId === nodeId) {
        return { clip: clip, trackIndex: t, clipIndex: c, trackType: "video" };
      }
    }
  }

  // Search audio tracks
  for (var t = 0; t < seq.audioTracks.numTracks; t++) {
    var track = seq.audioTracks[t];
    for (var c = 0; c < track.clips.numItems; c++) {
      var clip = track.clips[c];
      if (clip.nodeId === nodeId) {
        return { clip: clip, trackIndex: t, clipIndex: c, trackType: "audio" };
      }
    }
  }

  return null;
}

// Translate __findClip result (DOM-indexed) to a QE clip object.
// Critical in Premiere 25.4: QE tracks include "Empty" placeholders between/around clips,
// so DOM clipIndex (e.g. 2) does NOT match QE getItemAt index (which would return an Empty).
// This helper walks the QE track skipping Empty items to find the Nth real clip,
// where N matches DOM clip ordinal.
function __getQEClip(result) {
  if (!result) return null;
  app.enableQE();
  var qeSeq = qe.project.getActiveSequence();
  if (!qeSeq) return null;
  var qeTrack = result.trackType === "video"
    ? qeSeq.getVideoTrackAt(result.trackIndex)
    : qeSeq.getAudioTrackAt(result.trackIndex);
  if (!qeTrack) return null;

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

// Same as __getQEClip but also returns the QE track for callers that need it
// (e.g. transition tools that read qeTrack.numTransitions).
function __getQEClipAndTrack(result) {
  if (!result) return null;
  app.enableQE();
  var qeSeq = qe.project.getActiveSequence();
  if (!qeSeq) return null;
  var qeTrack = result.trackType === "video"
    ? qeSeq.getVideoTrackAt(result.trackIndex)
    : qeSeq.getAudioTrackAt(result.trackIndex);
  if (!qeTrack) return null;

  var nonEmptyOrdinal = 0;
  for (var i = 0; i < qeTrack.numItems; i++) {
    var qc = qeTrack.getItemAt(i);
    if (qc && qc.type !== "Empty") {
      if (nonEmptyOrdinal === result.clipIndex) return { qeClip: qc, qeTrack: qeTrack, qeSeq: qeSeq };
      nonEmptyOrdinal++;
    }
  }
  return null;
}

function __getAllClips(seq) {
  if (!seq) seq = app.project.activeSequence;
  if (!seq) return [];
  var clips = [];

  for (var t = 0; t < seq.videoTracks.numTracks; t++) {
    var track = seq.videoTracks[t];
    for (var c = 0; c < track.clips.numItems; c++) {
      var clip = track.clips[c];
      clips.push({
        nodeId: clip.nodeId,
        name: clip.name,
        trackIndex: t,
        trackType: "video",
        inPoint: __ticksToSeconds(clip.inPoint.ticks),
        outPoint: __ticksToSeconds(clip.outPoint.ticks),
        start: __ticksToSeconds(clip.start.ticks),
        end: __ticksToSeconds(clip.end.ticks),
        duration: __ticksToSeconds(clip.duration.ticks),
        mediaType: clip.mediaType
      });
    }
  }

  for (var t = 0; t < seq.audioTracks.numTracks; t++) {
    var track = seq.audioTracks[t];
    for (var c = 0; c < track.clips.numItems; c++) {
      var clip = track.clips[c];
      clips.push({
        nodeId: clip.nodeId,
        name: clip.name,
        trackIndex: t,
        trackType: "audio",
        inPoint: __ticksToSeconds(clip.inPoint.ticks),
        outPoint: __ticksToSeconds(clip.outPoint.ticks),
        start: __ticksToSeconds(clip.start.ticks),
        end: __ticksToSeconds(clip.end.ticks),
        duration: __ticksToSeconds(clip.duration.ticks),
        mediaType: clip.mediaType
      });
    }
  }

  return clips;
}

// Map a Premiere ProjectItemType numeric value to a string label.
// CLIP=1, BIN=2, ROOT=3, FILE=4. A type-1 item that isSequence() returns "sequence".
function __projectItemType(item) {
  if (!item) return "unknown";
  var t = item.type;
  if (t === 1) {
    try { if (typeof item.isSequence === "function" && item.isSequence()) return "sequence"; } catch(e) {}
    return "footage";
  }
  if (t === 2) return "bin";
  if (t === 3) return "root";
  if (t === 4) return "file";
  return "unknown";
}

// Sanitize a value for JSON: convert NaN/Infinity/undefined to null so output is valid JSON.
function __safeJsonValue(v) {
  if (v === undefined) return null;
  if (typeof v === "number") {
    // ES3: NaN is the only value that fails self-equality
    if (v !== v) return null; // NaN
    if (v === Infinity || v === -Infinity) return null;
  }
  return v;
}

// Recursively replace NaN/undefined/Infinity in nested data with null.
// Functions are coerced to null. NOTE: in some ExtendScript hosts typeof on a host
// method returns "object" not "function", so we use instanceof Function as a second probe.
function __sanitizeForJson(obj) {
  if (obj === undefined || obj === null) return null;
  if (typeof obj === "function") return null;
  if (typeof obj === "number") {
    if (obj !== obj) return null;
    if (obj === Infinity || obj === -Infinity) return null;
    return obj;
  }
  if (typeof obj === "string" || typeof obj === "boolean") return obj;
  if (obj instanceof Array) {
    var arr = [];
    for (var i = 0; i < obj.length; i++) arr.push(__sanitizeForJson(obj[i]));
    return arr;
  }
  if (typeof obj === "object") {
    // Detect ExtendScript host methods that report typeof === "object" (Bug #19 retest).
    try { if (obj instanceof Function) return null; } catch(e) {}
    var out = {};
    for (var k in obj) {
      if (obj.hasOwnProperty(k)) {
        var sanitized = __sanitizeForJson(obj[k]);
        // Drop properties with non-finite original values? No — keep as null so caller knows the key existed.
        out[k] = sanitized;
      }
    }
    return out;
  }
  // any other type — coerce to null (don't leak "[object]")
  return null;
}

function __jsonStringify(obj) {
  // ES3-compatible JSON stringify with NaN/undefined/Infinity sanitization.
  var safe = __sanitizeForJson(obj);
  if (typeof JSON !== "undefined" && JSON.stringify) {
    return JSON.stringify(safe);
  }
  // Fallback for very old ExtendScript
  if (safe === null) return "null";
  if (typeof safe === "string") return '"' + safe.replace(/\\\\/g, "\\\\\\\\").replace(/"/g, '\\\\"').replace(/\\n/g, "\\\\n") + '"';
  if (typeof safe === "number" || typeof safe === "boolean") return String(safe);
  if (safe instanceof Array) {
    var arr = [];
    for (var i = 0; i < safe.length; i++) {
      arr.push(__jsonStringify(safe[i]));
    }
    return "[" + arr.join(",") + "]";
  }
  if (typeof safe === "object") {
    var parts = [];
    for (var k in safe) {
      if (safe.hasOwnProperty(k)) {
        parts.push(__jsonStringify(k) + ":" + __jsonStringify(safe[k]));
      }
    }
    return "{" + parts.join(",") + "}";
  }
  return "null";
}

// Wrap a tool body that may trigger a Premiere modal dialog (Color Picker, Save Workspace,
// Replace Media confirmation, Save Title, etc.). Sets userInteractionLevel to NEVER_INTERACT
// for the duration of the call so dialogs are auto-suppressed instead of blocking the engine.
function __withDialogsSuppressed(fn) {
  var prev = null;
  var hasUI = false;
  try {
    if (typeof UserInteractionLevel !== "undefined" && app && typeof app.userInteractionLevel !== "undefined") {
      hasUI = true;
      prev = app.userInteractionLevel;
      app.userInteractionLevel = UserInteractionLevel.NEVER_INTERACT;
    }
    return fn();
  } finally {
    if (hasUI && prev !== null) {
      try { app.userInteractionLevel = prev; } catch(e) {}
    }
  }
}

function __result(data) {
  return __jsonStringify({ success: true, data: data });
}

function __error(msg) {
  return __jsonStringify({ success: false, error: String(msg) });
}

// === End MCP Bridge Helpers ===
`;

/**
 * Build a complete ExtendScript by wrapping user code in an IIFE with helpers.
 */
export function buildScript(code: string): string {
  return `${HELPERS}
(function() {
  try {
    ${code}
  } catch(e) {
    return __error(e.toString());
  }
})();`;
}

/**
 * Escape a string for safe embedding in ExtendScript.
 */
export function escapeForExtendScript(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

/**
 * Build a script that wraps code returning a value.
 * The code should use `return __result(...)` or `return __error(...)`.
 * @deprecated Use buildScript() directly. This is an alias kept for backward compatibility.
 */
export const buildToolScript = buildScript;
