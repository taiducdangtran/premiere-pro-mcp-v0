import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";

export function getTransitionsTools(bridgeOptions: BridgeOptions) {
  return {
    add_transition: {
      description: "Add a video transition between two clips at a cut point. Uses QE DOM.",
      parameters: {
        type: "object" as const,
        properties: {
          transition_name: {
            type: "string",
            description: "Name of the transition (e.g., 'Cross Dissolve', 'Dip to Black')",
          },
          track_index: {
            type: "number",
            description: "Video track index (0-based)",
          },
          cut_point_seconds: {
            type: "number",
            description: "Time position in seconds of the cut point where the transition should be placed",
          },
          duration_seconds: {
            type: "number",
            description: "Duration of the transition in seconds (default: 1.0)",
          },
        },
        required: ["transition_name", "track_index", "cut_point_seconds"],
      },
      handler: async (args: {
        transition_name: string;
        track_index: number;
        cut_point_seconds: number;
        duration_seconds?: number;
      }) => {
        const duration = args.duration_seconds ?? 1.0;
        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          
          var qeTrack = qeSeq.getVideoTrackAt(${args.track_index});
          if (!qeTrack) return __error("Track not found");
          
          var transitionName = "${escapeForExtendScript(args.transition_name)}";
          var transitions = qe.project.getVideoTransitionList();
          var transitionQE = null;
          
          for (var i = 0; i < transitions.numItems; i++) {
            if (transitions[i].name === transitionName) {
              transitionQE = transitions[i];
              break;
            }
          }
          
          if (!transitionQE) return __error("Transition not found: " + transitionName);
          
          var cutTicks = __secondsToTicks(${args.cut_point_seconds}).toString();
          var durationTicks = __secondsToTicks(${duration}).toString();
          
          qeTrack.addTransition(transitionQE, true, cutTicks, durationTicks, "0", false);
          
          return __result({
            added: true,
            transition: transitionName,
            trackIndex: ${args.track_index},
            atSeconds: ${args.cut_point_seconds},
            durationSeconds: ${duration}
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    add_transition_to_clip: {
      description: "Add a transition to a specific clip's start or end",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          transition_name: {
            type: "string",
            description: "Name of the transition",
          },
          position: {
            type: "string",
            enum: ["start", "end", "both"],
            description: "Where to apply the transition (default: end)",
          },
          duration_seconds: {
            type: "number",
            description: "Duration of the transition in seconds (default: 1.0)",
          },
        },
        required: ["node_id", "transition_name"],
      },
      handler: async (args: {
        node_id: string;
        transition_name: string;
        position?: string;
        duration_seconds?: number;
      }) => {
        const position = args.position || "end";
        const duration = args.duration_seconds ?? 1.0;

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          
          var transitionName = "${escapeForExtendScript(args.transition_name)}";
          var transitions = qe.project.getVideoTransitionList();
          var transitionQE = null;
          for (var i = 0; i < transitions.numItems; i++) {
            if (transitions[i].name === transitionName) {
              transitionQE = transitions[i];
              break;
            }
          }
          if (!transitionQE) return __error("Transition not found: " + transitionName);
          
          var qeTrack = qeSeq.getVideoTrackAt(result.trackIndex);
          var durationTicks = __secondsToTicks(${duration}).toString();
          var clip = result.clip;
          var position = "${position}";
          
          if (position === "start" || position === "both") {
            var startTicks = clip.start.ticks;
            qeTrack.addTransition(transitionQE, true, startTicks, durationTicks, "0", false);
          }
          if (position === "end" || position === "both") {
            var endTicks = clip.end.ticks;
            qeTrack.addTransition(transitionQE, true, endTicks, durationTicks, "0", false);
          }
          
          return __result({
            added: true,
            transition: transitionName,
            clipName: clip.name,
            position: position,
            durationSeconds: ${duration}
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    batch_add_transitions: {
      description: "Add the same transition to all cut points on a track",
      parameters: {
        type: "object" as const,
        properties: {
          transition_name: {
            type: "string",
            description: "Name of the transition (e.g., 'Cross Dissolve')",
          },
          track_index: {
            type: "number",
            description: "Video track index (0-based, default: 0)",
          },
          duration_seconds: {
            type: "number",
            description: "Duration of each transition in seconds (default: 1.0)",
          },
        },
        required: ["transition_name"],
      },
      handler: async (args: {
        transition_name: string;
        track_index?: number;
        duration_seconds?: number;
      }) => {
        const trackIndex = args.track_index ?? 0;
        const duration = args.duration_seconds ?? 1.0;

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          
          var transitionName = "${escapeForExtendScript(args.transition_name)}";
          var transitions = qe.project.getVideoTransitionList();
          var transitionQE = null;
          for (var i = 0; i < transitions.numItems; i++) {
            if (transitions[i].name === transitionName) {
              transitionQE = transitions[i];
              break;
            }
          }
          if (!transitionQE) return __error("Transition not found: " + transitionName);
          
          var track = seq.videoTracks[${trackIndex}];
          var qeTrack = qeSeq.getVideoTrackAt(${trackIndex});
          var durationTicks = __secondsToTicks(${duration}).toString();
          var count = 0;
          
          // Add transition at each cut point (between consecutive clips)
          for (var c = 0; c < track.clips.numItems - 1; c++) {
            var cutTicks = track.clips[c].end.ticks;
            try {
              qeTrack.addTransition(transitionQE, true, cutTicks, durationTicks, "0", false);
              count++;
            } catch(e) {}
          }
          
          return __result({
            added: count,
            transition: transitionName,
            trackIndex: ${trackIndex},
            durationSeconds: ${duration}
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    list_available_transitions: {
      description: "List all available video transitions. Uses QE DOM.",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          app.enableQE();
          var transitions = qe.project.getVideoTransitionList();
          var list = [];
          for (var i = 0; i < transitions.numItems; i++) {
            list.push({ name: transitions[i].name, index: i });
          }
          return __result(list);
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    list_available_audio_transitions: {
      description: "List all available audio transitions. Uses QE DOM.",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          app.enableQE();
          var transitions = qe.project.getAudioTransitionList();
          var list = [];
          for (var i = 0; i < transitions.numItems; i++) {
            list.push({ name: transitions[i].name, index: i });
          }
          return __result(list);
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_default_transition: {
      description:
        "Set the default video or audio transition (used by keyboard shortcuts and one-click transition buttons).",
      parameters: {
        type: "object" as const,
        properties: {
          transition_name: {
            type: "string",
            description: "Exact name of the transition (e.g., 'Cross Dissolve', 'Constant Power')",
          },
          track_type: {
            type: "string",
            enum: ["video", "audio"],
            description: "Set as default for video or audio (default: video)",
          },
        },
        required: ["transition_name"],
      },
      handler: async (args: { transition_name: string; track_type?: string }) => {
        const trackType = args.track_type || "video";
        const script = buildToolScript(`
          app.enableQE();
          try {
            var list = ${trackType === "audio" ? "qe.project.getAudioTransitionList()" : "qe.project.getVideoTransitionList()"};
            for (var i = 0; i < list.numItems; i++) {
              if (list[i].name === "${escapeForExtendScript(args.transition_name)}") {
                if (list[i].setAsDefaultTransition) {
                  list[i].setAsDefaultTransition();
                  return __result({ set: true, transition: "${escapeForExtendScript(args.transition_name)}" });
                }
                return __result({ set: false, note: "setAsDefaultTransition API not available; transition exists." });
              }
            }
            return __error("Transition not found: ${escapeForExtendScript(args.transition_name)}");
          } catch (ex) {
            return __error("Failed: " + ex.toString());
          }
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    remove_transition: {
      description:
        "Remove the transition at the start or end of a clip on the timeline. Uses QE DOM.",
      parameters: {
        type: "object" as const,
        properties: {
          track_type: {
            type: "string",
            enum: ["video", "audio"],
            description: "Track type",
          },
          track_index: { type: "number", description: "Track index (0-based)" },
          clip_index: { type: "number", description: "Clip index on the track" },
          position: {
            type: "string",
            enum: ["start", "end"],
            description: "Which transition to remove (default: start)",
          },
        },
        required: ["track_type", "track_index", "clip_index"],
      },
      handler: async (args: {
        track_type: string;
        track_index: number;
        clip_index: number;
        position?: string;
      }) => {
        const position = args.position || "start";
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          app.enableQE();
          try {
            var qeSeq = qe.project.getActiveSequence();
            var qeTrack = ${
              args.track_type === "video"
                ? `qeSeq.getVideoTrackAt(${args.track_index})`
                : `qeSeq.getAudioTrackAt(${args.track_index})`
            };
            if (!qeTrack) return __error("QE track not found");
            var qeClip = qeTrack.getItemAt(${args.clip_index});
            if (!qeClip) return __error("QE clip not found");
            qeClip.removeTransition(${position === "start" ? "true" : "false"});
            return __result({ removed: true, position: "${position}" });
          } catch (ex) {
            return __error("Failed to remove transition: " + ex.toString());
          }
        `);
        return sendCommand(script, bridgeOptions);
      },
    },
  };
}
