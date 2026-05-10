import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";

export function getAudioTools(bridgeOptions: BridgeOptions) {
  return {
    adjust_audio_levels: {
      description: "Adjust the audio level (volume) of a clip in dB",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the audio or video clip",
          },
          level_db: {
            type: "number",
            description: "Audio level in dB (0 = unity, negative = quieter, positive = louder)",
          },
        },
        required: ["node_id", "level_db"],
      },
      handler: async (args: { node_id: string; level_db: number }) => {
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          
          var clip = result.clip;
          // Find the Volume component
          for (var i = 0; i < clip.components.numItems; i++) {
            var comp = clip.components[i];
            if (comp.displayName === "Volume" || comp.matchName === "audioVolume") {
              for (var p = 0; p < comp.properties.numItems; p++) {
                if (comp.properties[p].displayName === "Level") {
                  comp.properties[p].setValue(${args.level_db}, true);
                  return __result({ adjusted: true, clipName: clip.name, levelDb: ${args.level_db} });
                }
              }
            }
          }
          
          return __error("Could not find Volume/Level property on clip");
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    add_audio_keyframes: {
      description: "Add audio level keyframes to create fades or level changes",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          keyframes: {
            type: "array",
            items: {
              type: "object",
              properties: {
                time_seconds: { type: "number", description: "Time in seconds relative to clip start" },
                level_db: { type: "number", description: "Audio level in dB" },
              },
              required: ["time_seconds", "level_db"],
            },
            description: "Array of keyframe objects with time_seconds and level_db",
          },
        },
        required: ["node_id", "keyframes"],
      },
      handler: async (args: { node_id: string; keyframes: Array<{ time_seconds: number; level_db: number }> }) => {
        const keyframeCode = args.keyframes
          .map(
            (kf) => `
            var kfTime = __secondsToTicks(${kf.time_seconds}).toString();
            levelProp.addKeyframe(kfTime);
            levelProp.setValueAtKey(kfTime, ${kf.level_db});`
          )
          .join("\n");

        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          
          var clip = result.clip;
          var levelProp = null;
          
          for (var i = 0; i < clip.components.numItems; i++) {
            var comp = clip.components[i];
            if (comp.displayName === "Volume" || comp.matchName === "audioVolume") {
              for (var p = 0; p < comp.properties.numItems; p++) {
                if (comp.properties[p].displayName === "Level") {
                  levelProp = comp.properties[p];
                  break;
                }
              }
            }
          }
          
          if (!levelProp) return __error("Could not find audio Level property");
          
          levelProp.setTimeVarying(true);
          ${keyframeCode}
          
          return __result({ keyframesAdded: ${args.keyframes.length}, clipName: clip.name });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    mute_track: {
      description: "Mute or unmute an audio track",
      parameters: {
        type: "object" as const,
        properties: {
          track_index: {
            type: "number",
            description: "Audio track index (0-based)",
          },
          muted: {
            type: "boolean",
            description: "True to mute, false to unmute",
          },
        },
        required: ["track_index", "muted"],
      },
      handler: async (args: { track_index: number; muted: boolean }) => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          
          if (${args.track_index} >= seq.audioTracks.numTracks) return __error("Track index out of range");
          
          var track = seq.audioTracks[${args.track_index}];
          track.setMute(${args.muted ? 1 : 0});

          return __result({ trackIndex: ${args.track_index}, muted: ${args.muted}, trackName: track.name });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_clip_volume: {
      description: "Get the audio volume (in dB) of an audio clip on the active sequence",
      parameters: {
        type: "object" as const,
        properties: {
          track_index: { type: "number", description: "Audio track index (0-based)" },
          clip_index: { type: "number", description: "Clip index on the track (0-based)" },
        },
        required: ["track_index", "clip_index"],
      },
      handler: async (args: { track_index: number; clip_index: number }) => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          if (${args.track_index} >= seq.audioTracks.numTracks) return __error("Track index out of range");
          var track = seq.audioTracks[${args.track_index}];
          if (${args.clip_index} >= track.clips.numItems) return __error("Clip index out of range");
          var clip = track.clips[${args.clip_index}];

          for (var i = 0; i < clip.components.numItems; i++) {
            var comp = clip.components[i];
            if (comp.displayName.toLowerCase() === "volume") {
              for (var j = 0; j < comp.properties.numItems; j++) {
                if (comp.properties[j].displayName.toLowerCase() === "level") {
                  return __result({ volumeDb: comp.properties[j].getValue() });
                }
              }
            }
          }
          return __error("Volume component not found");
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    apply_audio_crossfade: {
      description:
        "Apply an audio crossfade transition to a clip on an audio track. Uses QE DOM.",
      parameters: {
        type: "object" as const,
        properties: {
          track_index: { type: "number", description: "Audio track index" },
          clip_index: { type: "number", description: "Clip index on the track" },
          type: {
            type: "string",
            enum: ["constant_gain", "constant_power", "exponential_fade"],
            description: "Crossfade type (default: constant_power)",
          },
          duration_seconds: {
            type: "number",
            description: "Duration of the crossfade in seconds (default: 1.0)",
          },
        },
        required: ["track_index", "clip_index"],
      },
      handler: async (args: {
        track_index: number;
        clip_index: number;
        type?: string;
        duration_seconds?: number;
      }) => {
        const type = args.type || "constant_power";
        const nameMap: Record<string, string> = {
          constant_gain: "Constant Gain",
          constant_power: "Constant Power",
          exponential_fade: "Exponential Fade",
        };
        const transitionName = nameMap[type] || "Constant Power";
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          app.enableQE();
          try {
            var qeSeq = qe.project.getActiveSequence();
            var qeTrack = qeSeq.getAudioTrackAt(${args.track_index});
            if (!qeTrack) return __error("QE audio track not found");
            var qeClip = qeTrack.getItemAt(${args.clip_index});
            if (!qeClip) return __error("QE clip not found");

            var transitions = qe.project.getAudioTransitionList();
            for (var i = 0; i < transitions.numItems; i++) {
              if (transitions[i].name === "${transitionName}") {
                qeClip.addTransition(transitions[i], true);
                return __result({ transition: "${transitionName}", added: true });
              }
            }
            return __error("Audio transition not found: ${transitionName}");
          } catch (ex) {
            return __error("Failed: " + ex.toString());
          }
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_audio_channel_mapping: {
      description:
        "Get the audio channel interpretation (mono/stereo/5.1/adaptive) of a project item",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID or name of the project item" },
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string }) => {
        const script = buildToolScript(`
          var item = __findProjectItem("${escapeForExtendScript(args.node_id)}");
          if (!item) return __error("Item not found");
          var interp = item.getFootageInterpretation();
          if (!interp) return __error("Cannot get footage interpretation");

          var typeMap = { 0: "mono", 1: "stereo", 2: "5.1", 3: "adaptive" };
          return __result({
            audioChannelType: typeMap[interp.audioChannelType] || "unknown",
            audioChannelTypeRaw: interp.audioChannelType
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_audio_channel_mapping: {
      description:
        "Set the audio channel interpretation of a project item (mono/stereo/5.1/adaptive)",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID or name of the project item" },
          channel_type: {
            type: "string",
            enum: ["mono", "stereo", "5.1", "adaptive"],
            description: "Channel interpretation",
          },
        },
        required: ["node_id", "channel_type"],
      },
      handler: async (args: { node_id: string; channel_type: string }) => {
        const map: Record<string, number> = { mono: 0, stereo: 1, "5.1": 2, adaptive: 3 };
        const channelInt = map[args.channel_type] ?? 1;
        const script = buildToolScript(`
          var item = __findProjectItem("${escapeForExtendScript(args.node_id)}");
          if (!item) return __error("Item not found");
          var interp = item.getFootageInterpretation();
          if (!interp) return __error("Cannot get footage interpretation");
          interp.audioChannelType = ${channelInt};
          item.setFootageInterpretation(interp);
          return __result({ channelType: "${args.channel_type}" });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },
  };
}
