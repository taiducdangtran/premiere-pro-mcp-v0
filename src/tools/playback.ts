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
      description: "Get the current time indicator position in the Source Monitor",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          var pos = app.sourceMonitor.getPosition();
          if (!pos) return __error("No clip open in Source Monitor");
          return __result({ seconds: __ticksToSeconds(pos.ticks), ticks: pos.ticks });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    step_forward: {
      description: "Step the playhead forward by N frames. Uses QE DOM.",
      parameters: {
        type: "object" as const,
        properties: {
          frames: { type: "number", description: "Number of frames to step (default: 1)" },
        },
      },
      handler: async (args: { frames?: number }) => {
        const frames = args.frames ?? 1;
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          app.enableQE();
          try {
            for (var i = 0; i < ${frames}; i++) {
              qe.project.getActiveSequence().player.step(1);
            }
            return __result({ stepped: ${frames} });
          } catch (ex) {
            return __error("Step failed: " + ex.toString());
          }
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    step_backward: {
      description: "Step the playhead backward by N frames. Uses QE DOM.",
      parameters: {
        type: "object" as const,
        properties: {
          frames: { type: "number", description: "Number of frames to step back (default: 1)" },
        },
      },
      handler: async (args: { frames?: number }) => {
        const frames = args.frames ?? 1;
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          app.enableQE();
          try {
            for (var i = 0; i < ${frames}; i++) {
              qe.project.getActiveSequence().player.step(-1);
            }
            return __result({ stepped: -${frames} });
          } catch (ex) {
            return __error("Step failed: " + ex.toString());
          }
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
      description: "Move the playhead to the next edit point on the timeline. Uses QE DOM.",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          app.enableQE();
          try {
            qe.project.getActiveSequence().player.goToNextEdit();
            return __result({ moved: true });
          } catch (ex) {
            return __error("Go to next edit failed: " + ex.toString());
          }
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    go_to_previous_edit: {
      description: "Move the playhead to the previous edit point on the timeline. Uses QE DOM.",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          app.enableQE();
          try {
            qe.project.getActiveSequence().player.goToPreviousEdit();
            return __result({ moved: true });
          } catch (ex) {
            return __error("Go to previous edit failed: " + ex.toString());
          }
        `);
        return sendCommand(script, bridgeOptions);
      },
    },
  };
}
