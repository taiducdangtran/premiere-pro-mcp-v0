/* MCP Bridge - CEP Plugin Main Script
 * Polls a temp directory for command files (.jsx), executes them
 * in Premiere Pro's ExtendScript engine, and writes results back. */

var cs = new CSInterface();
var bridgeRunning = false;
var pollInterval = null;
var commandCount = 0;
var tempDir = "";
var POLL_MS = 200;

// ---- Logging ----
function log(msg, cls) {
  var el = document.getElementById("log");
  if (!el) return;
  var entry = document.createElement("div");
  entry.className = "log-entry " + (cls || "");
  var ts = new Date().toLocaleTimeString();
  entry.textContent = "[" + ts + "] " + msg;
  el.appendChild(entry);
  el.scrollTop = el.scrollHeight;
  // Keep max 100 entries
  while (el.children.length > 100) el.removeChild(el.firstChild);
}

function clearLog() {
  var el = document.getElementById("log");
  if (el) el.innerHTML = "";
  log("Log cleared");
}

// ---- Status (Bridge dot + Premiere dot) ----
function setStatus(state, text) {
  var dot = document.getElementById("statusDot");
  if (dot) dot.className = "status-dot " + state;
  var label = document.getElementById("statusText");
  if (label) label.textContent = text;
}

function setServerStatus(state, text) {
  var dot = document.getElementById("serverStatus");
  if (dot) dot.className = "status-dot " + state;
  var label = document.getElementById("serverText");
  if (label) label.textContent = text;
}

// ---- File I/O via Node.js (CEP has access to Node) ----
var fs = require("fs");
var path = require("path");
var os = require("os");
tempDir = path.join(os.tmpdir(), "premiere-mcp-bridge");

function ensureDir(dir) {
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
  } catch (e) {
    log("Error creating dir: " + e.message, "err");
  }
}

function listCommandFiles() {
  try {
    if (!fs.existsSync(tempDir)) return [];
    var files = fs.readdirSync(tempDir);
    return files
      .filter(function (f) { return f.indexOf("cmd_") === 0 && f.indexOf(".jsx") > 0; })
      .sort(); // process in order
  } catch (e) {
    return [];
  }
}

function readFile(filePath) {
  try { return fs.readFileSync(filePath, "utf-8"); }
  catch (e) { return null; }
}

function writeFile(filePath, content) {
  try { fs.writeFileSync(filePath, content, "utf-8"); return true; }
  catch (e) { log("Error writing " + filePath + ": " + e.message, "err"); return false; }
}

function deleteFile(filePath) {
  try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); }
  catch (e) {}
}

// ---- Script Execution ----
function executeScript(script, callback) {
  // Script is already wrapped in an IIFE by the MCP server's buildScript(),
  // so we pass it directly to avoid double-wrapping.
  cs.evalScript(script, function (result) { callback(result); });
}

// ---- Command Processing ----
function processCommands() {
  var cmdFiles = listCommandFiles();
  for (var i = 0; i < cmdFiles.length; i++) {
    processOneCommand(cmdFiles[i]);
  }
}

function processOneCommand(cmdFileName) {
  var cmdFilePath = path.join(tempDir, cmdFileName);
  var script = readFile(cmdFilePath);
  if (!script) {
    log("Failed to read: " + cmdFileName, "err");
    deleteFile(cmdFilePath);
    return;
  }

  // Derive response filename: cmd_12345.jsx -> res_12345.json
  var id = cmdFileName.replace("cmd_", "").replace(".jsx", "");
  var resFilePath = path.join(tempDir, "res_" + id + ".json");

  log("Executing: " + cmdFileName + " (" + script.length + " chars)", "cmd");

  // Delete the command file immediately to avoid re-processing
  deleteFile(cmdFilePath);

  executeScript(script, function (result) {
    commandCount++;
    var counter = document.getElementById("cmdCount");
    if (counter) counter.textContent = commandCount;

    var response;
    try {
      if (result && result !== "undefined" && result !== "null") {
        var parsed = JSON.parse(result);
        response = JSON.stringify(parsed);
      } else {
        response = JSON.stringify({ success: true, data: result || null });
      }
      log("Result: OK", "ok");
    } catch (e) {
      if (result && result.indexOf("Error") === 0) {
        response = JSON.stringify({ success: false, error: result });
        log("Result: " + result, "err");
      } else {
        response = JSON.stringify({ success: true, data: result });
        log("Result: OK (raw)", "ok");
      }
    }

    writeFile(resFilePath, response);
  });
}

// ---- Premiere host check (drives serverStatus) ----
function checkPremiere(silent) {
  cs.evalScript("app.version", function (version) {
    if (version && version !== "undefined" && version !== "EvalScript error.") {
      setServerStatus("connected", "Premiere " + version);
      if (!silent) log("Premiere Pro: " + version, "ok");
    } else {
      setServerStatus("error", "Premiere not responding");
      if (!silent) log("Warning: Could not detect Premiere Pro version", "err");
    }
  });
}

// ---- Diagnostics ----
function runDiagnostics() {
  log("Running diagnostics…", "cmd");
  var diagScript = '(function(){ try { var d = { extendscript: true, version: app.version || "unknown", projectOpen: !!app.project, sequenceCount: 0, activeSequence: null, qeDom: false }; if (app.project) { d.sequenceCount = app.project.sequences.numSequences; if (app.project.activeSequence) d.activeSequence = app.project.activeSequence.name; } try { app.enableQE(); if (qe && qe.project) d.qeDom = true; } catch(e) { d.qeDom = false; } return JSON.stringify({ success: true, data: d }); } catch(e) { return JSON.stringify({ success: false, error: e.toString() }); } })()';
  cs.evalScript(diagScript, function (result) {
    try {
      var parsed = JSON.parse(result);
      if (parsed && parsed.success) {
        var d = parsed.data;
        log("Diagnostics OK — Premiere " + d.version + ", project " + (d.projectOpen ? "open" : "none") +
            (d.activeSequence ? ", active=\"" + d.activeSequence + "\"" : "") +
            ", QE=" + (d.qeDom ? "yes" : "no"), "ok");
        setServerStatus("connected", "Premiere " + d.version);
      } else {
        log("Diagnostics failed: " + (parsed && parsed.error), "err");
      }
    } catch (e) {
      log("Diagnostics raw result: " + result, "err");
    }
  });
}

// ---- Bridge Control ----
function startBridge() {
  if (bridgeRunning) {
    log("Bridge already running");
    return;
  }
  tempDir = document.getElementById("tempDir").value.trim();
  if (!tempDir) {
    log("Please set a temp directory", "err");
    return;
  }

  ensureDir(tempDir);
  bridgeRunning = true;
  setStatus("connected", "Running — polling " + tempDir);
  log("Bridge started. Temp dir: " + tempDir);

  document.getElementById("btnStart").disabled = true;
  document.getElementById("btnStop").disabled = false;

  // Verify Premiere Pro connection on the secondary status dot
  checkPremiere(false);

  pollInterval = setInterval(function () {
    if (bridgeRunning) processCommands();
  }, POLL_MS);
}

function stopBridge() {
  bridgeRunning = false;
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = null;

  setStatus("", "Stopped");
  setServerStatus("", "Bridge stopped");
  log("Bridge stopped");

  document.getElementById("btnStart").disabled = false;
  document.getElementById("btnStop").disabled = true;
}

function saveTempDir() {
  tempDir = document.getElementById("tempDir").value.trim();
  log("Temp directory saved: " + tempDir);
  try { localStorage.setItem("mcp_bridge_temp_dir", tempDir); } catch (e) {}
}

// ---- Wire UI events (avoids inline-onclick CSP issues in CEP) ----
function wireEvents() {
  var startBtn = document.getElementById("btnStart");
  var stopBtn = document.getElementById("btnStop");
  var saveBtn = document.getElementById("btnSave");
  var diagBtn = document.getElementById("btnDiag");
  var clearBtn = document.getElementById("btnClear");

  if (startBtn) startBtn.addEventListener("click", startBridge);
  if (stopBtn) stopBtn.addEventListener("click", stopBridge);
  if (saveBtn) saveBtn.addEventListener("click", saveTempDir);
  if (diagBtn) diagBtn.addEventListener("click", runDiagnostics);
  if (clearBtn) clearBtn.addEventListener("click", clearLog);
}

// ---- Init ----
function init() {
  var input = document.getElementById("tempDir");
  if (input) input.value = tempDir;

  // Restore saved temp dir
  try {
    var saved = localStorage.getItem("mcp_bridge_temp_dir");
    if (saved) {
      tempDir = saved;
      if (input) input.value = tempDir;
    }
  } catch (e) {}

  wireEvents();

  log("MCP Bridge CEP plugin loaded");
  setStatus("waiting", "Ready — click Start Bridge");
  setServerStatus("waiting", "Awaiting bridge start");

  // Auto-start if temp dir already exists
  if (fs.existsSync(tempDir)) {
    log("Temp directory exists, auto-starting…");
    setTimeout(startBridge, 500);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
