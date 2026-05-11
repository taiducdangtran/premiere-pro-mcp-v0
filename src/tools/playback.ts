import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";

export function getPlaybackTools(bridgeOptions: BridgeOptions) {
  return {
    play_timeline: {
      description: "Start playback of the active sequence timeline. Uses QE DOM.",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          app.enableQE();
          qe.startPlayback();
          return __result({ playing: true });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    stop_playback: {
      description: "Stop playback of the active sequence timeline. Uses QE DOM.",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          app.enableQE();
          qe.stopPlayback();
          return __result({ stopped: true });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    play_source_monitor: {
      description: "Start playback of the clip in the Source Monitor",
      parameters: {
        type: "object" as const,
        properties: {
          speed: {
            type: "number",
            description: "Playback speed (1.0 = normal, 2.0 = 2x, -1.0 = reverse). Default: 1.0",
          },
        },
      },
      handler: async (args: { speed?: number }) => {
        const speed = args.speed ?? 1.0;
        const script = buildToolScript(`
          app.sourceMonitor.play(${speed});
          return __result({ playing: true, speed: ${speed} });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_source_monitor_position: {
      description: "Get the current time indicator position in the Source Monitor (returns loaded=false when no clip is open).",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          var pos;
          try { pos = app.sourceMonitor.getPosition(); } catch(e) {}
          if (!pos) return __result({ loaded: false });
          // Bug #21: returns sentinel "-400000" / equivalent ticks when nothing's loaded.
          var ticksStr = (pos && pos.ticks) ? String(pos.ticks) : String(pos);
          var ticksNum = parseFloat(ticksStr);
          // Sentinel checks: -400000 seconds OR equivalent ticks (-400000 * TICKS_PER_SECOND).
          var SENTINEL_SEC = -400000;
          var SENTINEL_TICKS = SENTINEL_SEC * TICKS_PER_SECOND;
          if (ticksStr === "-400000" || ticksNum === SENTINEL_SEC || ticksNum === SENTINEL_TICKS) {
            return __result({ loaded: false });
          }
          return __result({ loaded: true, seconds: __ticksToSeconds(ticksStr), ticks: ticksStr });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    step_forward: {
      description:
        "Step the playhead forward by N frames. " +
        "Bug #48 fix: previously called `player.step(1)` which throws 'Illegal Parameter type' in Premiere 25.4. " +
        "Now computes the frame duration from sequence frame rate and uses DOM-level `seq.setPlayerPosition(ticks)` (frame-accurate, no QE).",
      parameters: {
        type: "object" as const,
        properties: {
          frames: { type: "number", description: "Number of frames to step (default: 1)" },
        },
      },
      handler: async (args: { frames?: number }) => {
        const frames = args.frames ?? 1;
        const script = buildToolScript(`
          __probeState = { tool: "step_forward", attempts: [], frames: ${frames} };

          var seq = app.project.activeSequence;
          if (!seq) return __error({ reason: "No active sequence", _probe: __probeState });

          var frameTicks = null;
          try {
            var settings = seq.getSettings();
            if (settings && settings.videoFrameRate && settings.videoFrameRate.ticks) {
              frameTicks = parseFloat(settings.videoFrameRate.ticks);
              __probeState.frameTicksSource = "getSettings().videoFrameRate.ticks";
            }
          } catch(eS) { __probeState.frameTicksError = eS.toString(); }
          if (!frameTicks || frameTicks <= 0) {
            frameTicks = TICKS_PER_SECOND / 30;
            __probeState.frameTicksSource = "fallback 1/30";
          }
          __probeState.frameTicks = frameTicks;

          var curTicks = null;
          try { curTicks = parseFloat(seq.getPlayerPosition().ticks); }
          catch(eGP) { __probeState.attempts.push({ op: "getPlayerPosition", error: eGP.toString() }); }
          if (curTicks === null) return __error({ reason: "cannot read playhead", _probe: __probeState });
          __probeState.fromTicks = curTicks;

          var newTicks = curTicks + (frameTicks * ${frames});
          __probeState.toTicks = newTicks;

          // Probe both string and number forms — Premiere version varies.
          var setOk = false;
          var setVia = null;
          var setSigs = [
            { v: String(newTicks), label: "setPlayerPosition(String(ticks))" },
            { v: newTicks, label: "setPlayerPosition(Number(ticks))" }
          ];
          for (var i = 0; i < setSigs.length && !setOk; i++) {
            var a = { signature: setSigs[i].label, thrown: false };
            try { seq.setPlayerPosition(setSigs[i].v); setOk = true; setVia = setSigs[i].label; }
            catch(eSP) { a.thrown = true; a.error = eSP.toString(); }
            __probeState.attempts.push(a);
          }
          if (!setOk) return __error({ reason: "setPlayerPosition failed all variants", _probe: __probeState });

          __probeState = null;
          return __result({
            stepped: ${frames},
            frameTicks: frameTicks,
            fromTicks: curTicks,
            toTicks: newTicks,
            via: setVia
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    step_backward: {
      description:
        "Step the playhead backward by N frames. " +
        "Bug #48 fix: same as step_forward — uses DOM `setPlayerPosition` instead of broken QE `player.step()`.",
      parameters: {
        type: "object" as const,
        properties: {
          frames: { type: "number", description: "Number of frames to step back (default: 1)" },
        },
      },
      handler: async (args: { frames?: number }) => {
        const frames = args.frames ?? 1;
        const script = buildToolScript(`
          __probeState = { tool: "step_backward", attempts: [], frames: ${frames} };

          var seq = app.project.activeSequence;
          if (!seq) return __error({ reason: "No active sequence", _probe: __probeState });

          var frameTicks = null;
          try {
            var settings = seq.getSettings();
            if (settings && settings.videoFrameRate && settings.videoFrameRate.ticks) {
              frameTicks = parseFloat(settings.videoFrameRate.ticks);
              __probeState.frameTicksSource = "getSettings().videoFrameRate.ticks";
            }
          } catch(eS) { __probeState.frameTicksError = eS.toString(); }
          if (!frameTicks || frameTicks <= 0) {
            frameTicks = TICKS_PER_SECOND / 30;
            __probeState.frameTicksSource = "fallback 1/30";
          }
          __probeState.frameTicks = frameTicks;

          var curTicks = null;
          try { curTicks = parseFloat(seq.getPlayerPosition().ticks); }
          catch(eGP) { __probeState.attempts.push({ op: "getPlayerPosition", error: eGP.toString() }); }
          if (curTicks === null) return __error({ reason: "cannot read playhead", _probe: __probeState });
          __probeState.fromTicks = curTicks;

          var newTicks = curTicks - (frameTicks * ${frames});
          if (newTicks < 0) newTicks = 0;
          __probeState.toTicks = newTicks;

          var setOk = false;
          var setVia = null;
          var setSigs = [
            { v: String(newTicks), label: "setPlayerPosition(String(ticks))" },
            { v: newTicks, label: "setPlayerPosition(Number(ticks))" }
          ];
          for (var i = 0; i < setSigs.length && !setOk; i++) {
            var a = { signature: setSigs[i].label, thrown: false };
            try { seq.setPlayerPosition(setSigs[i].v); setOk = true; setVia = setSigs[i].label; }
            catch(eSP) { a.thrown = true; a.error = eSP.toString(); }
            __probeState.attempts.push(a);
          }
          if (!setOk) return __error({ reason: "setPlayerPosition failed all variants", _probe: __probeState });

          __probeState = null;
          return __result({
            stepped: -${frames},
            frameTicks: frameTicks,
            fromTicks: curTicks,
            toTicks: newTicks,
            via: setVia
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    go_to_start: {
      description: "Move the playhead to the start of the active sequence",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          seq.setPlayerPosition(seq.zeroPoint);
          return __result({ moved: true, position: 0 });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    go_to_end: {
      description: "Move the playhead to the end of the active sequence",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          var endTicks = seq.end;
          seq.setPlayerPosition(endTicks);
          return __result({ moved: true, positionSeconds: __ticksToSeconds(endTicks) });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    go_to_in_point: {
      description: "Move the playhead to the sequence in-point",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          try {
            var inTime = seq.getInPointAsTime();
            seq.setPlayerPosition(inTime.ticks);
            return __result({ moved: true, positionSeconds: __ticksToSeconds(inTime.ticks) });
          } catch (ex) {
            var inTicks = seq.getInPoint();
            seq.setPlayerPosition(inTicks);
            return __result({ moved: true, positionSeconds: __ticksToSeconds(inTicks) });
          }
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    go_to_out_point: {
      description: "Move the playhead to the sequence out-point",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          try {
            var outTime = seq.getOutPointAsTime();
            seq.setPlayerPosition(outTime.ticks);
            return __result({ moved: true, positionSeconds: __ticksToSeconds(outTime.ticks) });
          } catch (ex) {
            var outTicks = seq.getOutPoint();
            seq.setPlayerPosition(outTicks);
            return __result({ moved: true, positionSeconds: __ticksToSeconds(outTicks) });
          }
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    go_to_next_edit: {
      description: "Move the playhead to the next edit point on the timeline. Falls back to move_playhead_to_edit if QE player API removed in 25.4.",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          // 25.4 (Bug #47): qeSeq.player.goToNextEdit removed. Compute next edit point
          // from clip starts/ends across all tracks.
          if (qeSeq.player && typeof qeSeq.player.goToNextEdit === "function") {
            try { qeSeq.player.goToNextEdit(); return __result({ moved: true, method: "qeSeq.player.goToNextEdit" }); } catch(e) {}
          }
          // Fallback: scan all clips for the next edit boundary after current playhead.
          var phStr = (typeof seq.getPlayerPosition === "function") ? seq.getPlayerPosition() : null;
          if (phStr === null) return __error("Cannot get playhead position");
          var phTicks = parseFloat(String(phStr));
          var bestNext = null;
          for (var t = 0; t < seq.videoTracks.numTracks; t++) {
            var tr = seq.videoTracks[t];
            for (var c = 0; c < tr.clips.numItems; c++) {
              var cc = tr.clips[c];
              var s = parseFloat(cc.start.ticks); var e = parseFloat(cc.end.ticks);
              if (s > phTicks && (bestNext === null || s < bestNext)) bestNext = s;
              if (e > phTicks && (bestNext === null || e < bestNext)) bestNext = e;
            }
          }
          if (bestNext === null) return __result({ moved: false, note: "No next edit point" });
          seq.setPlayerPosition(String(bestNext));
          return __result({ moved: true, method: "fallback scan", playheadTicks: bestNext });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    go_to_previous_edit: {
      description: "Move the playhead to the previous edit point on the timeline. Falls back to move_playhead_to_edit if QE player API removed in 25.4.",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (qeSeq.player && typeof qeSeq.player.goToPreviousEdit === "function") {
            try { qeSeq.player.goToPreviousEdit(); return __result({ moved: true, method: "qeSeq.player.goToPreviousEdit" }); } catch(e) {}
          }
          var phStr = (typeof seq.getPlayerPosition === "function") ? seq.getPlayerPosition() : null;
          if (phStr === null) return __error("Cannot get playhead position");
          var phTicks = parseFloat(String(phStr));
          var bestPrev = null;
          for (var t = 0; t < seq.videoTracks.numTracks; t++) {
            var tr = seq.videoTracks[t];
            for (var c = 0; c < tr.clips.numItems; c++) {
              var cc = tr.clips[c];
              var s = parseFloat(cc.start.ticks); var e = parseFloat(cc.end.ticks);
              if (s < phTicks && (bestPrev === null || s > bestPrev)) bestPrev = s;
              if (e < phTicks && (bestPrev === null || e > bestPrev)) bestPrev = e;
            }
          }
          if (bestPrev === null) return __result({ moved: false, note: "No previous edit point" });
          seq.setPlayerPosition(String(bestPrev));
          return __result({ moved: true, method: "fallback scan", playheadTicks: bestPrev });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },
  };
}
