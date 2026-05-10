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

          var transitionName = "${escapeForExtendScript(args.transition_name)}";
          // Premiere 25.4+: getVideoTransitionList returns string[]; resolve via getVideoTransitionByName.
          var transitionQE = qe.project.getVideoTransitionByName(transitionName);
          if (!transitionQE || !transitionQE.name) return __error("Transition not found: " + transitionName);

          // 25.4: qeTrack.addTransition removed; must call qeClip.addTransition on the clip
          // at the cut. We find the DOM clip whose end matches the cut point, then resolve
          // its QE counterpart (skipping Empty placeholders) via __getQEClip.
          var seq = app.project.activeSequence;
          var domTrack = seq.videoTracks[${args.track_index}];
          if (!domTrack) return __error("DOM track not found");
          var cutTicksNum = __secondsToTicks(${args.cut_point_seconds});
          var pickedClipIndex = -1;
          for (var c = 0; c < domTrack.clips.numItems; c++) {
            var clipEnd = parseFloat(domTrack.clips[c].end.ticks);
            if (Math.abs(clipEnd - cutTicksNum) < 1) { pickedClipIndex = c; break; }
          }
          if (pickedClipIndex === -1) return __error("No clip ends at cut_point_seconds=" + ${args.cut_point_seconds});
          var fakeResult = { trackIndex: ${args.track_index}, clipIndex: pickedClipIndex, trackType: "video", clip: domTrack.clips[pickedClipIndex] };
          var qeClip = __getQEClip(fakeResult);
          if (!qeClip) return __error("QE clip not found for cut point");

          // alignment 1 = transition at clip's END (out-going side of the cut). Verified working in 25.4.
          qeClip.addTransition(transitionQE, 1);

          return __result({
            added: true,
            transition: transitionName,
            trackIndex: ${args.track_index},
            atSeconds: ${args.cut_point_seconds},
            durationSeconds: ${duration},
            note: "Premiere 25.4: duration_seconds is currently ignored (new qeClip.addTransition signature is 2-arg)."
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
          var transitionQE = qe.project.getVideoTransitionByName(transitionName);
          if (!transitionQE || !transitionQE.name) return __error("Transition not found: " + transitionName);

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");
          var clip = result.clip;
          var position = "${position}";

          // 25.4: alignment 0 = transition at clip's START (in-coming), 1 = at clip's END (out-going).
          if (position === "start" || position === "both") {
            qeClip.addTransition(transitionQE, 0);
          }
          if (position === "end" || position === "both") {
            qeClip.addTransition(transitionQE, 1);
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
          var transitionQE = qe.project.getVideoTransitionByName(transitionName);
          if (!transitionQE || !transitionQE.name) return __error("Transition not found: " + transitionName);

          var track = seq.videoTracks[${trackIndex}];
          var count = 0;

          // 25.4: walk DOM clips, resolve each to QE clip via __getQEClip (skips Empty placeholders),
          // call addTransition with alignment 1 (clip's end).
          for (var c = 0; c < track.clips.numItems - 1; c++) {
            var fakeResult = { trackIndex: ${trackIndex}, clipIndex: c, trackType: "video", clip: track.clips[c] };
            var qeClip = __getQEClip(fakeResult);
            if (!qeClip) continue;
            try {
              qeClip.addTransition(transitionQE, 1);
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
          // Premiere 25.4+: returns Array of strings (length, not numItems).
          var transitions = qe.project.getVideoTransitionList();
          var list = [];
          for (var i = 0; i < transitions.length; i++) {
            list.push({ name: String(transitions[i]), index: i });
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
          for (var i = 0; i < transitions.length; i++) {
            list.push({ name: String(transitions[i]), index: i });
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
            var transObj = ${trackType === "audio"
              ? `qe.project.getAudioTransitionByName("${escapeForExtendScript(args.transition_name)}")`
              : `qe.project.getVideoTransitionByName("${escapeForExtendScript(args.transition_name)}")`};
            if (!transObj || !transObj.name) return __error("Transition not found: ${escapeForExtendScript(args.transition_name)}");
            if (transObj.setAsDefaultTransition) {
              transObj.setAsDefaultTransition();
              return __result({ set: true, transition: "${escapeForExtendScript(args.transition_name)}" });
            }
            return __result({ set: false, note: "setAsDefaultTransition API not available; transition exists." });
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
