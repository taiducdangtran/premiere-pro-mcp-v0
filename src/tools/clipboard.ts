import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";

export function getClipboardTools(bridgeOptions: BridgeOptions) {
  return {
    copy_effects_between_clips: {
      description: "Copy all effects (or a specific effect) from one clip to another. Does not copy intrinsic properties like Motion/Opacity unless specified.",
      parameters: {
        type: "object" as const,
        properties: {
          source_node_id: {
            type: "string",
            description: "Node ID of the source clip to copy effects from",
          },
          target_node_id: {
            type: "string",
            description: "Node ID of the target clip to paste effects to",
          },
          effect_name: {
            type: "string",
            description: "Specific effect display name to copy (copies all non-intrinsic effects if omitted)",
          },
        },
        required: ["source_node_id", "target_node_id"],
      },
      handler: async (args: { source_node_id: string; target_node_id: string; effect_name?: string }) => {
        const script = buildToolScript(`
          app.enableQE();
          var srcResult = __findClip("${escapeForExtendScript(args.source_node_id)}");
          if (!srcResult) return __error("Source clip not found");
          var tgtResult = __findClip("${escapeForExtendScript(args.target_node_id)}");
          if (!tgtResult) return __error("Target clip not found");

          var src = srcResult.clip;
          var tgt = tgtResult.clip;
          var copied = 0;
          var effectFilter = ${args.effect_name ? `"${escapeForExtendScript(args.effect_name)}"` : "null"};
          var intrinsic = ["Motion", "Opacity", "Time Remapping", "Volume", "Channel Volume", "Panner"];

          // Use QE to copy effects by name
          var qeSeq = qe.project.getActiveSequence();
          var tgtTrackType = tgtResult.trackType;
          var tgtTrack = tgtTrackType === "video" 
            ? qeSeq.getVideoTrackAt(tgtResult.trackIndex) 
            : qeSeq.getAudioTrackAt(tgtResult.trackIndex);
          var qeTgtClip = tgtTrack.getItemAt(tgtResult.clipIndex);

          for (var i = 0; i < src.components.numItems; i++) {
            var comp = src.components[i];
            var name = comp.displayName;

            if (effectFilter && name !== effectFilter) continue;
            if (!effectFilter) {
              var skip = false;
              for (var k = 0; k < intrinsic.length; k++) {
                if (name === intrinsic[k]) { skip = true; break; }
              }
              if (skip) continue;
            }

            // Apply effect via QE
            try {
              var qeEffect = tgtTrackType === "video"
                ? qe.project.getVideoEffectByName(name)
                : qe.project.getAudioEffectByName(name);
              if (qeEffect) {
                if (tgtTrackType === "video") {
                  qeTgtClip.addVideoEffect(qeEffect);
                } else {
                  qeTgtClip.addAudioEffect(qeEffect);
                }
                copied++;
              }
            } catch(e) {}
          }

          return __result({ copiedEffects: copied, source: src.name, target: tgt.name });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    copy_effect_values: {
      description: "Copy all property values from one effect to the matching effect on another clip. Both clips must already have the same effect applied.",
      parameters: {
        type: "object" as const,
        properties: {
          source_node_id: {
            type: "string",
            description: "Node ID of the source clip",
          },
          target_node_id: {
            type: "string",
            description: "Node ID of the target clip",
          },
          effect_name: {
            type: "string",
            description: "Display name of the effect to copy values for",
          },
        },
        required: ["source_node_id", "target_node_id", "effect_name"],
      },
      handler: async (args: { source_node_id: string; target_node_id: string; effect_name: string }) => {
        const script = buildToolScript(`
          var srcResult = __findClip("${escapeForExtendScript(args.source_node_id)}");
          if (!srcResult) return __error("Source clip not found");
          var tgtResult = __findClip("${escapeForExtendScript(args.target_node_id)}");
          if (!tgtResult) return __error("Target clip not found");

          var srcComp = null;
          var tgtComp = null;
          for (var i = 0; i < srcResult.clip.components.numItems; i++) {
            if (srcResult.clip.components[i].displayName === "${escapeForExtendScript(args.effect_name)}") {
              srcComp = srcResult.clip.components[i];
              break;
            }
          }
          if (!srcComp) return __error("Effect not found on source clip: ${escapeForExtendScript(args.effect_name)}");

          for (var i = 0; i < tgtResult.clip.components.numItems; i++) {
            if (tgtResult.clip.components[i].displayName === "${escapeForExtendScript(args.effect_name)}") {
              tgtComp = tgtResult.clip.components[i];
              break;
            }
          }
          if (!tgtComp) return __error("Effect not found on target clip: ${escapeForExtendScript(args.effect_name)}");

          var copied = 0;
          for (var p = 0; p < srcComp.properties.numItems; p++) {
            var srcProp = srcComp.properties[p];
            for (var q = 0; q < tgtComp.properties.numItems; q++) {
              if (tgtComp.properties[q].displayName === srcProp.displayName) {
                try {
                  var val = srcProp.getValue(0, 0);
                  tgtComp.properties[q].setValue(val, true);
                  copied++;
                } catch(e) {}
                break;
              }
            }
          }

          return __result({ copiedProperties: copied, effect: "${escapeForExtendScript(args.effect_name)}" });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    replace_clip_media: {
      description: "Replace the source media of a clip on the timeline with a different project item, keeping the clip's position and duration.",
      parameters: {
        type: "object" as const,
        properties: {
          clip_node_id: {
            type: "string",
            description: "Node ID of the timeline clip to replace media on",
          },
          new_item_id: {
            type: "string",
            description: "Node ID or name of the new source project item",
          },
        },
        required: ["clip_node_id", "new_item_id"],
      },
      handler: async (args: { clip_node_id: string; new_item_id: string }) => {
        const script = buildToolScript(`
          var clipResult = __findClip("${escapeForExtendScript(args.clip_node_id)}");
          if (!clipResult) return __error("Clip not found");
          var newItem = __findProjectItem("${escapeForExtendScript(args.new_item_id)}");
          if (!newItem) return __error("New project item not found: ${escapeForExtendScript(args.new_item_id)}");

          var clip = clipResult.clip;
          var seq = app.project.activeSequence;
          var startTicks = clip.start.ticks;
          var trackType = clipResult.trackType;
          var trackIndex = clipResult.trackIndex;

          // Suppress "Replace Media?" confirmation dialog that 25.4 may pop up (Bug #40).
          return __withDialogsSuppressed(function() {
            if (trackType === "video") {
              seq.overwriteClip(newItem, startTicks, trackIndex, -1);
            } else {
              seq.overwriteClip(newItem, startTicks, -1, trackIndex);
            }
            return __result({ replaced: true, clipName: clip.name, newSource: newItem.name });
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    batch_apply_effect: {
      description: "Apply an effect to multiple clips at once. Can target selected clips, all clips on a track, or all clips in the sequence.",
      parameters: {
        type: "object" as const,
        properties: {
          effect_name: {
            type: "string",
            description: "Display name of the effect to apply (e.g., 'Gaussian Blur', 'Lumetri Color')",
          },
          target: {
            type: "string",
            enum: ["selected", "track", "all"],
            description: "Which clips to apply to: selected clips, all on a track, or all in sequence",
          },
          track_type: {
            type: "string",
            enum: ["video", "audio"],
            description: "Track type (required when target is 'track')",
          },
          track_index: {
            type: "number",
            description: "Track index (required when target is 'track')",
          },
        },
        required: ["effect_name", "target"],
      },
      handler: async (args: { effect_name: string; target: string; track_type?: string; track_index?: number }) => {
        const script = buildToolScript(`
          app.enableQE();
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          var qeSeq = qe.project.getActiveSequence();

          var effectName = "${escapeForExtendScript(args.effect_name)}";
          var qeEffect = qe.project.getVideoEffectByName(effectName);
          var isAudio = false;
          if (!qeEffect) {
            qeEffect = qe.project.getAudioEffectByName(effectName);
            isAudio = true;
          }
          if (!qeEffect) return __error("Effect not found: " + effectName);

          var applied = 0;
          var target = "${args.target}";

          function applyToClip(trackIdx, clipIdx, trackType) {
            try {
              var qeTrack = trackType === "video" ? qeSeq.getVideoTrackAt(trackIdx) : qeSeq.getAudioTrackAt(trackIdx);
              var qeClip = qeTrack.getItemAt(clipIdx);
              if (isAudio || trackType === "audio") {
                qeClip.addAudioEffect(qeEffect);
              } else {
                qeClip.addVideoEffect(qeEffect);
              }
              applied++;
            } catch(e) {}
          }

          if (target === "selected") {
            for (var t = 0; t < seq.videoTracks.numTracks; t++) {
              for (var c = 0; c < seq.videoTracks[t].clips.numItems; c++) {
                if (seq.videoTracks[t].clips[c].isSelected()) applyToClip(t, c, "video");
              }
            }
            for (var t = 0; t < seq.audioTracks.numTracks; t++) {
              for (var c = 0; c < seq.audioTracks[t].clips.numItems; c++) {
                if (seq.audioTracks[t].clips[c].isSelected()) applyToClip(t, c, "audio");
              }
            }
          } else if (target === "track") {
            var tt = "${args.track_type || "video"}";
            var ti = ${args.track_index ?? 0};
            var tracks = tt === "video" ? seq.videoTracks : seq.audioTracks;
            if (ti >= tracks.numTracks) return __error("Track index out of range");
            for (var c = 0; c < tracks[ti].clips.numItems; c++) {
              applyToClip(ti, c, tt);
            }
          } else {
            for (var t = 0; t < seq.videoTracks.numTracks; t++) {
              for (var c = 0; c < seq.videoTracks[t].clips.numItems; c++) applyToClip(t, c, "video");
            }
            for (var t = 0; t < seq.audioTracks.numTracks; t++) {
              for (var c = 0; c < seq.audioTracks[t].clips.numItems; c++) applyToClip(t, c, "audio");
            }
          }

          return __result({ applied: applied, effect: effectName, target: target });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    remove_effect_by_name: {
      description: "Remove all instances of a specific effect from a clip by display name. Uses QE DOM in Premiere 25.4+.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          effect_name: {
            type: "string",
            description: "Display name of the effect to remove (all matching instances will be removed)",
          },
        },
        required: ["node_id", "effect_name"],
      },
      handler: async (args: { node_id: string; effect_name: string }) => {
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");

          var clip = result.clip;
          var beforeCount = clip.components.numItems;

          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("QE sequence unavailable");
          var qeTrack = result.trackType === "video"
            ? qeSeq.getVideoTrackAt(result.trackIndex)
            : qeSeq.getAudioTrackAt(result.trackIndex);
          if (!qeTrack) return __error("QE track not found");
          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          // Iterate backwards so removals do not invalidate later indices.
          var removed = 0;
          for (var i = clip.components.numItems - 1; i >= 0; i--) {
            if (clip.components[i].displayName === "${escapeForExtendScript(args.effect_name)}") {
              var qeComp = qeClip.getComponentAt(i);
              if (qeComp) {
                qeComp.remove();
                removed++;
              }
            }
          }

          if (removed === 0) return __error("Effect not found: ${escapeForExtendScript(args.effect_name)}");
          return __result({
            removed: removed,
            effect: "${escapeForExtendScript(args.effect_name)}",
            clip: clip.name,
            componentsBefore: beforeCount,
            componentsAfter: clip.components.numItems
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_blend_mode: {
      description: "Set the blend mode on a video clip. Uses the Opacity effect's Blend Mode property.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the video clip",
          },
          blend_mode: {
            type: "string",
            enum: [
              "Normal", "Dissolve", "Darken", "Multiply", "Color Burn", "Linear Burn", "Darker Color",
              "Lighten", "Screen", "Color Dodge", "Linear Dodge", "Lighter Color",
              "Overlay", "Soft Light", "Hard Light", "Vivid Light", "Linear Light", "Pin Light", "Hard Mix",
              "Difference", "Exclusion", "Subtract", "Divide",
              "Hue", "Saturation", "Color", "Luminosity"
            ],
            description: "Blend mode name",
          },
        },
        required: ["node_id", "blend_mode"],
      },
      handler: async (args: { node_id: string; blend_mode: string }) => {
        const blendModeMap: Record<string, number> = {
          "Normal": 1, "Dissolve": 2, "Darken": 3, "Multiply": 4, "Color Burn": 5,
          "Linear Burn": 6, "Darker Color": 7, "Lighten": 8, "Screen": 9, "Color Dodge": 10,
          "Linear Dodge": 11, "Lighter Color": 12, "Overlay": 13, "Soft Light": 14,
          "Hard Light": 15, "Vivid Light": 16, "Linear Light": 17, "Pin Light": 18,
          "Hard Mix": 19, "Difference": 20, "Exclusion": 21, "Subtract": 22, "Divide": 23,
          "Hue": 24, "Saturation": 25, "Color": 26, "Luminosity": 27
        };
        const modeValue = blendModeMap[args.blend_mode] ?? 1;

        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");

          var clip = result.clip;
          var set = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            var comp = clip.components[i];
            if (comp.displayName === "Opacity") {
              for (var p = 0; p < comp.properties.numItems; p++) {
                if (comp.properties[p].displayName === "Blend Mode") {
                  comp.properties[p].setValue(${modeValue}, true);
                  set = true;
                  break;
                }
              }
              break;
            }
          }

          if (!set) return __error("Could not find Blend Mode property on clip");
          return __result({ blendMode: "${escapeForExtendScript(args.blend_mode)}", clip: clip.name });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    batch_set_clip_property: {
      description:
        "Set the same property value across multiple timeline clips in one call. " +
        "Bug #35 fix (v1.2.10): each target now validated for required `trackType` + `trackIndex` + `clipIndex` up front; per-target `reason` returned in `notFound` so caller can tell whether it was a missing field, out-of-range track/clip, or property-not-found. " +
        "If `trackType` or `trackIndex` is missing, the target inherits from the previous valid target.",
      parameters: {
        type: "object" as const,
        properties: {
          property_name: {
            type: "string",
            description:
              "Display name of the property to set (e.g., 'Opacity', 'Scale', 'Position'). Case-insensitive match.",
          },
          value: {
            description:
              "Value to apply (number for scalars, [x,y] for points, [r,g,b] for colors)",
          },
          targets: {
            type: "array",
            description:
              "Array of {trackType: 'video'|'audio', trackIndex: number, clipIndex: number}. Missing trackType/trackIndex inherits from previous target.",
          },
        },
        required: ["property_name", "value", "targets"],
      },
      handler: async (args: {
        property_name: string;
        value: any;
        targets: Array<{ trackType?: string; trackIndex?: number; clipIndex: number }>;
      }) => {
        const valueLiteral = JSON.stringify(args.value);
        const targetsLiteral = JSON.stringify(args.targets);
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          var prop = "${escapeForExtendScript(args.property_name)}".toLowerCase();
          var val = ${valueLiteral};
          var targets = ${targetsLiteral};
          var updated = 0;
          var notFound = [];
          var lastTrackType = null;
          var lastTrackIndex = null;

          for (var t = 0; t < targets.length; t++) {
            var tgt = targets[t];
            // Inherit trackType/trackIndex from previous target if missing
            var trackType = (tgt.trackType === "video" || tgt.trackType === "audio") ? tgt.trackType : lastTrackType;
            var trackIndex = (typeof tgt.trackIndex === "number") ? tgt.trackIndex : lastTrackIndex;
            var clipIndex = tgt.clipIndex;

            if (trackType !== "video" && trackType !== "audio") {
              notFound.push({ target: tgt, reason: "missing trackType (must be 'video' or 'audio')" });
              continue;
            }
            if (typeof trackIndex !== "number" || trackIndex < 0) {
              notFound.push({ target: tgt, reason: "missing or invalid trackIndex" });
              continue;
            }
            if (typeof clipIndex !== "number" || clipIndex < 0) {
              notFound.push({ target: tgt, reason: "missing or invalid clipIndex" });
              continue;
            }

            lastTrackType = trackType;
            lastTrackIndex = trackIndex;

            var tracks = trackType === "video" ? seq.videoTracks : seq.audioTracks;
            if (trackIndex >= tracks.numTracks) {
              notFound.push({ target: tgt, resolved: { trackType: trackType, trackIndex: trackIndex }, reason: "trackIndex out of range (" + tracks.numTracks + " tracks)" });
              continue;
            }
            var track = tracks[trackIndex];
            if (clipIndex >= track.clips.numItems) {
              notFound.push({ target: tgt, resolved: { trackType: trackType, trackIndex: trackIndex, clipIndex: clipIndex }, reason: "clipIndex out of range (" + track.clips.numItems + " clips on " + trackType + " " + trackIndex + ")" });
              continue;
            }
            var clip = track.clips[clipIndex];

            // Bug #86 fix (v1.2.13): previously we'd push a "setValue threw" entry
            // AND a "not found" entry for the same target when the first match
            // rejected the value. Track match-found state separately and stop on
            // first match (don't fall through to next component).
            var didSet = false;
            var matchFound = false;
            var setValueError = null;
            var matchedPath = null;
            var propsSeen = [];
            for (var i = 0; i < clip.components.numItems && !matchFound; i++) {
              var comp = clip.components[i];
              for (var j = 0; j < comp.properties.numItems; j++) {
                var pn = comp.properties[j].displayName;
                if (pn && propsSeen.length < 50) propsSeen.push(pn);
                if (pn && pn.toLowerCase() === prop) {
                  matchFound = true;
                  matchedPath = comp.displayName + "." + pn;
                  // Try setValue with the standard 2-arg form, then 1-arg fallback
                  try {
                    comp.properties[j].setValue(val, true);
                    updated++;
                    didSet = true;
                  } catch (ex1) {
                    try {
                      comp.properties[j].setValue(val);
                      updated++;
                      didSet = true;
                    } catch (ex2) {
                      setValueError = ex1.toString() + " / 1-arg: " + ex2.toString();
                    }
                  }
                  break;
                }
              }
            }
            if (!didSet) {
              if (matchFound) {
                notFound.push({
                  target: tgt,
                  clip: clip.name,
                  reason: "matched '" + matchedPath + "' but setValue rejected the value: " + setValueError,
                  matchedPath: matchedPath
                });
              } else {
                notFound.push({
                  target: tgt,
                  clip: clip.name,
                  reason: "property '${escapeForExtendScript(args.property_name)}' not found on this clip",
                  availableProps: propsSeen.slice(0, 20)
                });
              }
            }
          }
          return __result({ property: "${escapeForExtendScript(args.property_name)}", updated: updated, notFound: notFound });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },
  };
}
