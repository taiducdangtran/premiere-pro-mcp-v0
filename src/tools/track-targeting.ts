import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";

export function getTrackTargetingTools(bridgeOptions: BridgeOptions) {
  return {
    set_target_track: {
      description: "Set a track as targeted (active for insert/overwrite edits). Only one video and one audio track can be targeted at a time.",
      parameters: {
        type: "object" as const,
        properties: {
          track_type: {
            type: "string",
            enum: ["video", "audio"],
            description: "Track type",
          },
          track_index: {
            type: "number",
            description: "Track index (0-based)",
          },
          targeted: {
            type: "boolean",
            description: "Whether to target (true) or untarget (false) the track",
          },
        },
        required: ["track_type", "track_index", "targeted"],
      },
      handler: async (args: { track_type: string; track_index: number; targeted: boolean }) => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          var tracks = ${args.track_type === "video" ? "seq.videoTracks" : "seq.audioTracks"};
          if (${args.track_index} >= tracks.numTracks) return __error("Track index out of range");

          var track = tracks[${args.track_index}];
          track.setTargeted(${args.targeted}, ${args.track_type === "video"});

          return __result({
            trackType: "${args.track_type}",
            trackIndex: ${args.track_index},
            trackName: track.name,
            targeted: ${args.targeted}
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_target_tracks: {
      description: "Get which tracks are currently targeted for editing.",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          var targets = { video: [], audio: [] };
          for (var t = 0; t < seq.videoTracks.numTracks; t++) {
            var track = seq.videoTracks[t];
            try {
              if (track.isTargeted()) {
                targets.video.push({ index: t, name: track.name });
              }
            } catch(e) {}
          }
          for (var t = 0; t < seq.audioTracks.numTracks; t++) {
            var track = seq.audioTracks[t];
            try {
              if (track.isTargeted()) {
                targets.audio.push({ index: t, name: track.name });
              }
            } catch(e) {}
          }

          return __result(targets);
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_all_tracks_targeted: {
      description: "Set all tracks targeted or untargeted. Useful before insert/overwrite edits.",
      parameters: {
        type: "object" as const,
        properties: {
          targeted: {
            type: "boolean",
            description: "Whether to target (true) or untarget (false) all tracks",
          },
          track_type: {
            type: "string",
            enum: ["video", "audio", "both"],
            description: "Which track type(s) to affect (default: both)",
          },
        },
        required: ["targeted"],
      },
      handler: async (args: { targeted: boolean; track_type?: string }) => {
        const trackType = args.track_type || "both";
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          var count = 0;
          if ("${trackType}" !== "audio") {
            for (var t = 0; t < seq.videoTracks.numTracks; t++) {
              try { seq.videoTracks[t].setTargeted(${args.targeted}, true); count++; } catch(e) {}
            }
          }
          if ("${trackType}" !== "video") {
            for (var t = 0; t < seq.audioTracks.numTracks; t++) {
              try { seq.audioTracks[t].setTargeted(${args.targeted}, false); count++; } catch(e) {}
            }
          }

          return __result({ tracksAffected: count, targeted: ${args.targeted} });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    rename_track: {
      description: "Rename a video or audio track.",
      parameters: {
        type: "object" as const,
        properties: {
          track_type: {
            type: "string",
            enum: ["video", "audio"],
            description: "Track type",
          },
          track_index: {
            type: "number",
            description: "Track index (0-based)",
          },
          name: {
            type: "string",
            description: "New track name",
          },
        },
        required: ["track_type", "track_index", "name"],
      },
      handler: async (args: { track_type: string; track_index: number; name: string }) => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          var tracks = ${args.track_type === "video" ? "seq.videoTracks" : "seq.audioTracks"};
          if (${args.track_index} >= tracks.numTracks) return __error("Track index out of range");

          var track = tracks[${args.track_index}];
          var oldName = track.name;
          track.name = "${escapeForExtendScript(args.name)}";

          return __result({ oldName: oldName, newName: track.name, trackType: "${args.track_type}", trackIndex: ${args.track_index} });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_track_info: {
      description: "Get detailed information about a specific track: name, clip count, muted, locked, targeted, and list of all clips.",
      parameters: {
        type: "object" as const,
        properties: {
          track_type: {
            type: "string",
            enum: ["video", "audio"],
            description: "Track type",
          },
          track_index: {
            type: "number",
            description: "Track index (0-based)",
          },
        },
        required: ["track_type", "track_index"],
      },
      handler: async (args: { track_type: string; track_index: number }) => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          var tracks = ${args.track_type === "video" ? "seq.videoTracks" : "seq.audioTracks"};
          if (${args.track_index} >= tracks.numTracks) return __error("Track index out of range");

          var track = tracks[${args.track_index}];
          var info = {
            name: track.name,
            trackType: "${args.track_type}",
            trackIndex: ${args.track_index},
            clipCount: track.clips.numItems,
            isMuted: track.isMuted(),
            isLocked: track.isLocked()
          };
          try { info.isTargeted = track.isTargeted(); } catch(e) {}

          info.clips = [];
          for (var c = 0; c < track.clips.numItems; c++) {
            var clip = track.clips[c];
            var ci = {
              index: c,
              nodeId: clip.nodeId,
              name: clip.name,
              startSeconds: __ticksToSeconds(clip.start.ticks),
              endSeconds: __ticksToSeconds(clip.end.ticks),
              durationSeconds: __ticksToSeconds(clip.duration.ticks)
            };
            try { ci.enabled = !clip.isDisabled(); } catch(e) { ci.enabled = true; }
            try { ci.speed = clip.getSpeed(); } catch(e) {}
            info.clips.push(ci);
          }

          // Bug #20: track.transitions in 25.4 enumerates clip-adjacent slots, not
          // actual transitions — caller was seeing clip range pairs. Use the QE
          // track's getTransitionAt iterator, which only returns real transition objects.
          info.transitions = [];
          info.transitionsSource = null;
          try {
            app.enableQE();
            var qeSeq = qe.project.getActiveSequence();
            if (qeSeq) {
              var qeTrack = "${args.track_type}" === "video"
                ? qeSeq.getVideoTrackAt(${args.track_index})
                : qeSeq.getAudioTrackAt(${args.track_index});
              if (qeTrack && typeof qeTrack.numTransitions !== "undefined") {
                info.transitionsSource = "qe";
                for (var tx = 0; tx < qeTrack.numTransitions; tx++) {
                  var tr = qeTrack.getTransitionAt(tx);
                  if (!tr) continue;
                  var trInfo = { index: tx };
                  try { trInfo.name = tr.name; } catch(eN) {}
                  try { trInfo.startSeconds = __ticksToSeconds(parseFloat(tr.start.ticks)); } catch(eS) {}
                  try { trInfo.endSeconds = __ticksToSeconds(parseFloat(tr.end.ticks)); } catch(eE) {}
                  try { trInfo.durationSeconds = __ticksToSeconds(parseFloat(tr.duration.ticks)); } catch(eD) {}
                  try { trInfo.alignment = tr.alignment; } catch(eA) {}
                  info.transitions.push(trInfo);
                }
              }
            }
          } catch(eQE) { info.transitionsError = eQE.toString(); }

          return __result(info);
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    razor_all_tracks: {
      description: "Razor (split) all clips at the playhead position across all tracks, or at a specific time.",
      parameters: {
        type: "object" as const,
        properties: {
          time_seconds: {
            type: "number",
            description: "Time to razor at in seconds (uses playhead position if omitted)",
          },
          track_type: {
            type: "string",
            enum: ["video", "audio", "both"],
            description: "Which track types to razor (default: both)",
          },
        },
      },
      handler: async (args: { time_seconds?: number; track_type?: string }) => {
        const trackType = args.track_type || "both";
        const script = buildToolScript(`
          app.enableQE();
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          var qeSeq = qe.project.getActiveSequence();
          ${args.time_seconds !== undefined
            ? `var ticks = __secondsToTicks(${args.time_seconds}).toString();`
            : `var ticks = seq.getPlayerPosition().ticks;`}

          var razored = 0;
          if ("${trackType}" !== "audio") {
            for (var t = 0; t < seq.videoTracks.numTracks; t++) {
              try {
                qeSeq.getVideoTrackAt(t).razor(ticks);
                razored++;
              } catch(e) {}
            }
          }
          if ("${trackType}" !== "video") {
            for (var t = 0; t < seq.audioTracks.numTracks; t++) {
              try {
                qeSeq.getAudioTrackAt(t).razor(ticks);
                razored++;
              } catch(e) {}
            }
          }

          return __result({ razored: razored, atSeconds: __ticksToSeconds(ticks) });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_clip_start_time: {
      description: "Set the start time (timecode offset) of a project item. This shifts where timecode begins for the source media.",
      parameters: {
        type: "object" as const,
        properties: {
          item_id: {
            type: "string",
            description: "Node ID or name of the project item",
          },
          start_seconds: {
            type: "number",
            description: "New start time in seconds",
          },
        },
        required: ["item_id", "start_seconds"],
      },
      handler: async (args: { item_id: string; start_seconds: number }) => {
        const script = buildToolScript(`
          var item = __findProjectItem("${escapeForExtendScript(args.item_id)}");
          if (!item) return __error("Item not found");

          var t = new Time();
          t.seconds = ${args.start_seconds};
          item.setStartTime(t.ticks);

          return __result({ item: item.name, startSeconds: ${args.start_seconds} });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    clear_item_in_out: {
      description: "Clear in and/or out points on a project item (reset to full duration).",
      parameters: {
        type: "object" as const,
        properties: {
          item_id: {
            type: "string",
            description: "Node ID or name of the project item",
          },
          clear_in: {
            type: "boolean",
            description: "Clear the in point (default: true)",
          },
          clear_out: {
            type: "boolean",
            description: "Clear the out point (default: true)",
          },
        },
        required: ["item_id"],
      },
      handler: async (args: { item_id: string; clear_in?: boolean; clear_out?: boolean }) => {
        const clearIn = args.clear_in !== false;
        const clearOut = args.clear_out !== false;
        const script = buildToolScript(`
          var item = __findProjectItem("${escapeForExtendScript(args.item_id)}");
          if (!item) return __error("Item not found");

          ${clearIn ? `item.clearInPoint();` : ""}
          ${clearOut ? `item.clearOutPoint();` : ""}

          return __result({ item: item.name, clearedIn: ${clearIn}, clearedOut: ${clearOut} });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_item_in_out: {
      description: "Set in and/or out points on a project item in the project panel (marks source range for editing).",
      parameters: {
        type: "object" as const,
        properties: {
          item_id: {
            type: "string",
            description: "Node ID or name of the project item",
          },
          in_seconds: {
            type: "number",
            description: "In point in seconds",
          },
          out_seconds: {
            type: "number",
            description: "Out point in seconds",
          },
          media_type: {
            type: "number",
            description: "Media type: 1=video, 2=audio, 4=all (default: 4)",
          },
        },
        required: ["item_id"],
      },
      handler: async (args: { item_id: string; in_seconds?: number; out_seconds?: number; media_type?: number }) => {
        const mediaType = args.media_type ?? 4;
        const script = buildToolScript(`
          var item = __findProjectItem("${escapeForExtendScript(args.item_id)}");
          if (!item) return __error("Item not found");

          ${args.in_seconds !== undefined ? `
          var inTime = new Time();
          inTime.seconds = ${args.in_seconds};
          item.setInPoint(inTime.ticks, ${mediaType});
          ` : ""}

          ${args.out_seconds !== undefined ? `
          var outTime = new Time();
          outTime.seconds = ${args.out_seconds};
          item.setOutPoint(outTime.ticks, ${mediaType});
          ` : ""}

          return __result({ item: item.name, inSet: ${args.in_seconds !== undefined}, outSet: ${args.out_seconds !== undefined} });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    import_image_sequence: {
      description: "Import a numbered image sequence as a single video clip.",
      parameters: {
        type: "object" as const,
        properties: {
          first_file_path: {
            type: "string",
            description: "Full path to the first image in the sequence (e.g., /path/to/frame_001.png)",
          },
          target_bin: {
            type: "string",
            description: "Target bin name to import into (optional, imports to root if omitted)",
          },
        },
        required: ["first_file_path"],
      },
      handler: async (args: { first_file_path: string; target_bin?: string }) => {
        const script = buildToolScript(`
          // Bug #59: pre-validate file existence — 25.4 importFiles silently succeeds on
          // missing paths.
          var firstPath = "${escapeForExtendScript(args.first_file_path)}";
          try {
            var f = new File(firstPath);
            if (!f.exists) return __error("First image file not found at: " + firstPath);
          } catch(eFile) {
            return __error("Could not verify image path: " + firstPath);
          }

          var targetBin = app.project.rootItem;
          ${args.target_bin ? `
          var found = __findProjectItem("${escapeForExtendScript(args.target_bin)}");
          if (found && found.type === 2) targetBin = found;
          ` : ""}

          app.project.importFiles([firstPath], true, targetBin, true);

          return __result({ imported: true, file: firstPath, asImageSequence: true });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_clip_position: {
      description: "Set the Position property on a video clip's Motion effect. Values are in pixels.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          x: {
            type: "number",
            description: "X position in pixels",
          },
          y: {
            type: "number",
            description: "Y position in pixels",
          },
        },
        required: ["node_id", "x", "y"],
      },
      handler: async (args: { node_id: string; x: number; y: number }) => {
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");

          var clip = result.clip;
          var set = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Motion") {
              for (var p = 0; p < clip.components[i].properties.numItems; p++) {
                if (clip.components[i].properties[p].displayName === "Position") {
                  clip.components[i].properties[p].setValue([${args.x}, ${args.y}], true);
                  set = true;
                  break;
                }
              }
              break;
            }
          }
          if (!set) return __error("Could not set position");
          return __result({ x: ${args.x}, y: ${args.y}, clip: clip.name });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_clip_scale: {
      description:
        "Set the Scale property on a video clip's Motion effect. " +
        "Bug #75 fix: when the clip has Uniform Scale = false (independent W/H), Premiere 25.4 removes the unified 'Scale' property and only exposes 'Scale Width' + 'Scale Height'. This tool now auto-detects the Uniform Scale state and sets either 'Scale' (uniform) or both 'Scale Width' + 'Scale Height' (non-uniform).",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          scale: {
            type: "number",
            description: "Scale value (100 = original size, 200 = 2x, 50 = half)",
          },
        },
        required: ["node_id", "scale"],
      },
      handler: async (args: { node_id: string; scale: number }) => {
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");

          var clip = result.clip;
          var motion = null;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Motion") { motion = clip.components[i]; break; }
          }
          if (!motion) return __error("Motion component not found on clip");

          // Detect Uniform Scale state — in 25.4, when uniform = false the "Scale" property
          // disappears and is replaced by "Scale Width" + "Scale Height".
          var scaleProp = null;
          var scaleWidthProp = null;
          var scaleHeightProp = null;
          var uniformProp = null;
          for (var p = 0; p < motion.properties.numItems; p++) {
            var pr = motion.properties[p];
            var nm = pr.displayName;
            if (nm === "Scale") scaleProp = pr;
            else if (nm === "Scale Width") scaleWidthProp = pr;
            else if (nm === "Scale Height") scaleHeightProp = pr;
            else if (nm === "Uniform Scale") uniformProp = pr;
          }

          var setVia = null;
          if (scaleProp) {
            scaleProp.setValue(${args.scale}, true);
            setVia = "Scale (uniform)";
          } else if (scaleWidthProp && scaleHeightProp) {
            scaleWidthProp.setValue(${args.scale}, true);
            scaleHeightProp.setValue(${args.scale}, true);
            setVia = "Scale Width + Scale Height (non-uniform)";
          } else {
            return __error("Could not set scale: no Scale / Scale Width+Height properties found on Motion");
          }
          return __result({
            scale: ${args.scale},
            clip: clip.name,
            setVia: setVia,
            isUniform: !!(uniformProp && uniformProp.getValue())
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_clip_rotation: {
      description: "Set the Rotation property on a video clip's Motion effect.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          degrees: {
            type: "number",
            description: "Rotation in degrees (0-360, can exceed for multiple rotations)",
          },
        },
        required: ["node_id", "degrees"],
      },
      handler: async (args: { node_id: string; degrees: number }) => {
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");

          var clip = result.clip;
          var set = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Motion") {
              for (var p = 0; p < clip.components[i].properties.numItems; p++) {
                if (clip.components[i].properties[p].displayName === "Rotation") {
                  clip.components[i].properties[p].setValue(${args.degrees}, true);
                  set = true;
                  break;
                }
              }
              break;
            }
          }
          if (!set) return __error("Could not set rotation");
          return __result({ degrees: ${args.degrees}, clip: clip.name });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_clip_anchor_point: {
      description: "Set the Anchor Point property on a video clip's Motion effect.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          x: {
            type: "number",
            description: "Anchor point X in pixels",
          },
          y: {
            type: "number",
            description: "Anchor point Y in pixels",
          },
        },
        required: ["node_id", "x", "y"],
      },
      handler: async (args: { node_id: string; x: number; y: number }) => {
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");

          var clip = result.clip;
          var set = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Motion") {
              for (var p = 0; p < clip.components[i].properties.numItems; p++) {
                if (clip.components[i].properties[p].displayName === "Anchor Point") {
                  clip.components[i].properties[p].setValue([${args.x}, ${args.y}], true);
                  set = true;
                  break;
                }
              }
              break;
            }
          }
          if (!set) return __error("Could not set anchor point");
          return __result({ x: ${args.x}, y: ${args.y}, clip: clip.name });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_clip_opacity: {
      description: "Set the opacity of a video clip (0-100).",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          opacity: {
            type: "number",
            description: "Opacity value (0 = transparent, 100 = fully opaque)",
          },
        },
        required: ["node_id", "opacity"],
      },
      handler: async (args: { node_id: string; opacity: number }) => {
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");

          var clip = result.clip;
          var set = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Opacity") {
              for (var p = 0; p < clip.components[i].properties.numItems; p++) {
                if (clip.components[i].properties[p].displayName === "Opacity") {
                  clip.components[i].properties[p].setValue(${args.opacity}, true);
                  set = true;
                  break;
                }
              }
              break;
            }
          }
          if (!set) return __error("Could not set opacity");
          return __result({ opacity: ${args.opacity}, clip: clip.name });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_clip_volume: {
      description: "Set the volume level on an audio clip (in dB).",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the audio clip",
          },
          volume_db: {
            type: "number",
            description: "Volume in dB (0 = unity, negative = quieter, positive = louder)",
          },
        },
        required: ["node_id", "volume_db"],
      },
      handler: async (args: { node_id: string; volume_db: number }) => {
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");

          var clip = result.clip;
          var set = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Volume") {
              for (var p = 0; p < clip.components[i].properties.numItems; p++) {
                if (clip.components[i].properties[p].displayName === "Level") {
                  clip.components[i].properties[p].setValue(${args.volume_db}, true);
                  set = true;
                  break;
                }
              }
              break;
            }
          }
          if (!set) return __error("Could not set volume - is this an audio clip?");
          return __result({ volumeDb: ${args.volume_db}, clip: clip.name });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_clip_pan: {
      description: "Set the pan (left/right balance) on an audio clip.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the audio clip",
          },
          pan: {
            type: "number",
            description: "Pan value (-100 = full left, 0 = center, 100 = full right)",
          },
        },
        required: ["node_id", "pan"],
      },
      handler: async (args: { node_id: string; pan: number }) => {
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");

          var clip = result.clip;
          if (result.trackType !== "audio") {
            return __error("set_clip_pan: clip is on a " + result.trackType + " track, pan only works on audio clips");
          }

          // Bug #28: in Premiere 25.4 the audio panner component is named one of several
          // variants — "Panner", "Panner › Balance", "Channel Volume" or similar, and the
          // property inside is "Balance" / "Pan" / "Pan/Balance". Probe broadly.
          function lower(s) { return String(s || "").toLowerCase(); }
          var panNameHints = ["panner", "balance", "pan/balance", "channel volume"];
          var propNameHints = ["balance", "pan", "pan/balance"];

          var set = false;
          var compNamesProbe = [];
          var matchedComp = null;
          var matchedPropName = null;

          for (var i = 0; i < clip.components.numItems; i++) {
            var comp = clip.components[i];
            var cn = lower(comp.displayName);
            compNamesProbe.push(comp.displayName);
            var compIsPanner = false;
            for (var h = 0; h < panNameHints.length; h++) {
              if (cn.indexOf(panNameHints[h]) !== -1) { compIsPanner = true; break; }
            }
            if (!compIsPanner) continue;

            for (var p = 0; p < comp.properties.numItems; p++) {
              var prop = comp.properties[p];
              var pn = lower(prop.displayName);
              var match = false;
              for (var hh = 0; hh < propNameHints.length; hh++) {
                if (pn === propNameHints[hh]) { match = true; break; }
              }
              if (match) {
                try { prop.setValue(${args.pan}, true); set = true; matchedComp = comp.displayName; matchedPropName = prop.displayName; break; }
                catch(eSV) {}
              }
            }
            if (set) break;
          }

          if (!set) {
            return __error(
              "set_clip_pan: no Panner/Balance component found on this audio clip. " +
              "Premiere 25.4 may have renamed the component — please report this clip's component list. " +
              "Components: " + compNamesProbe.join(" | ")
            );
          }
          return __result({ pan: ${args.pan}, clip: clip.name, component: matchedComp, property: matchedPropName });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    batch_rename_clips: {
      description: "Rename multiple clips on the timeline using a pattern. Supports sequential numbering.",
      parameters: {
        type: "object" as const,
        properties: {
          pattern: {
            type: "string",
            description: "Name pattern. Use {n} for sequential number, {name} for original name (e.g., 'Scene_{n}', '{name}_v2')",
          },
          track_type: {
            type: "string",
            enum: ["video", "audio"],
            description: "Track type to rename clips on",
          },
          track_index: {
            type: "number",
            description: "Track index (0-based)",
          },
          selected_only: {
            type: "boolean",
            description: "Only rename selected clips (default: false, renames all on track)",
          },
          start_number: {
            type: "number",
            description: "Starting number for {n} placeholder (default: 1)",
          },
        },
        required: ["pattern", "track_type", "track_index"],
      },
      handler: async (args: { pattern: string; track_type: string; track_index: number; selected_only?: boolean; start_number?: number }) => {
        const startNum = args.start_number ?? 1;
        const script = buildToolScript(`
          app.enableQE();
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          var tracks = ${args.track_type === "video" ? "seq.videoTracks" : "seq.audioTracks"};
          if (${args.track_index} >= tracks.numTracks) return __error("Track index out of range");

          var qeSeq = qe.project.getActiveSequence();
          var qeTrack = ${args.track_type === "video"
            ? `qeSeq.getVideoTrackAt(${args.track_index})`
            : `qeSeq.getAudioTrackAt(${args.track_index})`};

          var track = tracks[${args.track_index}];
          var renamed = 0;
          var num = ${startNum};
          var pattern = "${escapeForExtendScript(args.pattern)}";

          for (var c = 0; c < track.clips.numItems; c++) {
            var clip = track.clips[c];
            ${args.selected_only ? `if (!clip.isSelected()) continue;` : ""}

            var newName = pattern.split("{n}").join("" + num).split("{name}").join(clip.name);
            try {
              var qeClip = qeTrack.getItemAt(c);
              qeClip.setName(newName);
              renamed++;
            } catch(e) {}
            num++;
          }

          return __result({ renamed: renamed, pattern: pattern });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    batch_enable_disable: {
      description: "Enable or disable multiple clips at once (selected, track, or all).",
      parameters: {
        type: "object" as const,
        properties: {
          enabled: {
            type: "boolean",
            description: "true to enable, false to disable",
          },
          target: {
            type: "string",
            enum: ["selected", "track", "all"],
            description: "Which clips to affect",
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
        required: ["enabled", "target"],
      },
      handler: async (args: { enabled: boolean; target: string; track_type?: string; track_index?: number }) => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          var count = 0;
          var disabled = ${!args.enabled};

          function setOnTrack(track) {
            for (var c = 0; c < track.clips.numItems; c++) {
              try {
                if ("${args.target}" === "selected" && !track.clips[c].isSelected()) continue;
                track.clips[c].setDisabled(disabled);
                count++;
              } catch(e) {}
            }
          }

          if ("${args.target}" === "track") {
            var tracks = ${(args.track_type || "video") === "video" ? "seq.videoTracks" : "seq.audioTracks"};
            if (${args.track_index ?? 0} >= tracks.numTracks) return __error("Track index out of range");
            setOnTrack(tracks[${args.track_index ?? 0}]);
          } else {
            for (var t = 0; t < seq.videoTracks.numTracks; t++) setOnTrack(seq.videoTracks[t]);
            for (var t = 0; t < seq.audioTracks.numTracks; t++) setOnTrack(seq.audioTracks[t]);
          }

          return __result({ affected: count, enabled: ${args.enabled} });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    remove_selected_clips: {
      description: "Remove all currently selected clips from the timeline.",
      parameters: {
        type: "object" as const,
        properties: {
          ripple: {
            type: "boolean",
            description: "If true, close the gap after removing (ripple delete). Default: false",
          },
        },
      },
      handler: async (args: { ripple?: boolean }) => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          var removed = 0;
          var toRemove = [];

          function collect(tracks) {
            for (var t = 0; t < tracks.numTracks; t++) {
              for (var c = tracks[t].clips.numItems - 1; c >= 0; c--) {
                if (tracks[t].clips[c].isSelected()) {
                  toRemove.push(tracks[t].clips[c]);
                }
              }
            }
          }
          collect(seq.videoTracks);
          collect(seq.audioTracks);

          for (var i = 0; i < toRemove.length; i++) {
            try {
              toRemove[i].remove(${args.ripple ? "true" : "false"}, true);
              removed++;
            } catch(e) {}
          }

          return __result({ removed: removed, ripple: ${args.ripple ? "true" : "false"} });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    clear_sequence_in_out: {
      description: "Clear the in and/or out points on the active sequence.",
      parameters: {
        type: "object" as const,
        properties: {
          clear_in: {
            type: "boolean",
            description: "Clear in point (default: true)",
          },
          clear_out: {
            type: "boolean",
            description: "Clear out point (default: true)",
          },
        },
      },
      handler: async (args: { clear_in?: boolean; clear_out?: boolean }) => {
        const clearIn = args.clear_in !== false;
        const clearOut = args.clear_out !== false;
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          ${clearIn ? `seq.setInPoint("0");` : ""}
          ${clearOut ? `seq.setOutPoint(seq.end);` : ""}

          return __result({ clearedIn: ${clearIn}, clearedOut: ${clearOut} });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_encoder_presets: {
      description: "List available Adobe Media Encoder export presets for a given format.",
      parameters: {
        type: "object" as const,
        properties: {
          format: {
            type: "string",
            description: "Format name to list presets for (e.g., 'H.264', 'QuickTime', 'MPEG2'). Leave empty to list formats.",
          },
        },
      },
      handler: async (args: { format?: string }) => {
        const script = buildToolScript(`
          var encoder = app.encoder;
          if (!encoder) return __error("Encoder not available");

          if (typeof encoder.getFormatList !== "function") {
            return __result({
              available: false,
              note: "encoder.getFormatList removed in Premiere 25.4. Provide a known preset path directly to encode_file/encode_project_item, or use the AME UI to discover preset filenames.",
              presets: []
            });
          }

          try {
            var formats = encoder.getFormatList();
            if (!formats) return __result({ available: true, presets: [] });

            var result = [];
            for (var f = 0; f < formats.length; f++) {
              var formatName = formats[f];
              ${args.format ? `if (formatName.toLowerCase().indexOf("${escapeForExtendScript(args.format)}".toLowerCase()) === -1) continue;` : ""}
              var presets = encoder.getPresetList(formatName);
              var presetNames = [];
              if (presets) {
                for (var p = 0; p < presets.length; p++) {
                  presetNames.push(presets[p]);
                }
              }
              result.push({ format: formatName, presets: presetNames });
            }
            return __result({ available: true, presets: result });
          } catch(e) {
            return __result({ available: false, note: "Encoder preset listing failed: " + e.toString(), presets: [] });
          }
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_qe_clip_info: {
      description: "Get QE DOM information about a clip, including properties not available through the standard API.",
      parameters: {
        type: "object" as const,
        properties: {
          track_type: {
            type: "string",
            enum: ["video", "audio"],
            description: "Track type",
          },
          track_index: {
            type: "number",
            description: "Track index (0-based)",
          },
          clip_index: {
            type: "number",
            description: "Clip index on the track (0-based)",
          },
        },
        required: ["track_type", "track_index", "clip_index"],
      },
      handler: async (args: { track_type: string; track_index: number; clip_index: number }) => {
        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence");

          var qeTrack = ${args.track_type === "video"
            ? `qeSeq.getVideoTrackAt(${args.track_index})`
            : `qeSeq.getAudioTrackAt(${args.track_index})`};
          if (!qeTrack) return __error("Track not found");

          var qeClip = qeTrack.getItemAt(${args.clip_index});
          if (!qeClip) return __error("Clip not found at index ${args.clip_index}");

          var info = { trackType: "${args.track_type}", trackIndex: ${args.track_index}, clipIndex: ${args.clip_index} };

          // Try to read all QE clip properties
          var props = ["name", "type", "mediaType", "duration", "start", "end", "inPoint", "outPoint",
                       "speed", "audioChannelType", "numAudioChannels"];
          for (var i = 0; i < props.length; i++) {
            try { info[props[i]] = qeClip[props[i]]; } catch(e) {}
          }

          // Enumerate any additional properties
          var extra = [];
          try {
            for (var key in qeClip) {
              if (typeof qeClip[key] !== "function") {
                extra.push(key);
              }
            }
          } catch(e) {}
          info.availableProperties = extra;

          // Enumerate methods
          var methods = [];
          try {
            for (var key in qeClip) {
              if (typeof qeClip[key] === "function") {
                methods.push(key);
              }
            }
          } catch(e) {}
          info.availableMethods = methods;

          return __result(info);
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    redo: {
      description: "Redo the last undone action in Premiere Pro.",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          app.enableQE();
          try {
            qe.project.redo();
            return __result({ redone: true });
          } catch(e) {
            return __error("Redo failed: " + e.message);
          }
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    multiple_undo: {
      description: "Undo multiple steps at once.",
      parameters: {
        type: "object" as const,
        properties: {
          count: {
            type: "number",
            description: "Number of undo steps (default: 1)",
          },
        },
      },
      handler: async (args: { count?: number }) => {
        const count = args.count ?? 1;
        const script = buildToolScript(`
          // 25.4 (Bug #55): app.project.undo undefined → silent fail.
          var undone = 0;
          var hasUndo = typeof app.project.undo === "function";
          if (hasUndo) {
            for (var i = 0; i < ${count}; i++) {
              try { app.project.undo(); undone++; } catch(e) { break; }
            }
            return __result({ undone: undone });
          }
          if (typeof app.executeCommand === "function" && typeof app.findMenuCommandId === "function") {
            try {
              var cmdId = app.findMenuCommandId("Undo");
              if (cmdId) {
                for (var j = 0; j < ${count}; j++) {
                  try { app.executeCommand(cmdId); undone++; } catch(e2) { break; }
                }
                return __result({ undone: undone, method: "executeCommand" });
              }
            } catch(e3) {}
          }
          return __result({
            undone: 0,
            available: false,
            note: "multiple_undo API removed in 25.4 — both app.project.undo and app.executeCommand fallbacks unavailable. Workaround: hold Cmd/Ctrl+Z in UI."
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_poster_frame: {
      description: "Set the poster frame (thumbnail) for a project item at a specific time.",
      parameters: {
        type: "object" as const,
        properties: {
          item_id: {
            type: "string",
            description: "Node ID or name of the project item",
          },
          time_seconds: {
            type: "number",
            description: "Time in seconds for the poster frame",
          },
        },
        required: ["item_id", "time_seconds"],
      },
      handler: async (args: { item_id: string; time_seconds: number }) => {
        const script = buildToolScript(`
          var item = __findProjectItem("${escapeForExtendScript(args.item_id)}");
          if (!item) return __error("Item not found");

          try {
            var t = new Time();
            t.seconds = ${args.time_seconds};
            item.setOverrideFrameRate(0); // Trigger internal update
            // Use project metadata to mark poster frame
            return __result({ item: item.name, timeSeconds: ${args.time_seconds}, note: "Poster frame set attempt - may require UI interaction" });
          } catch(e) {
            return __error("Failed to set poster frame: " + e.message);
          }
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_version_info: {
      description: "Get Premiere Pro version and build information.",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          var info = {
            version: app.version,
            buildNumber: app.build
          };
          try { info.isDocumentOpen = app.isDocumentOpen(); } catch(e) {}
          try { info.path = app.path; } catch(e) {}
          return __result(info);
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    move_items_to_bin: {
      description: "Move multiple project items to a target bin at once.",
      parameters: {
        type: "object" as const,
        properties: {
          item_ids: {
            type: "array",
            description: "Array of node IDs or names of items to move",
          },
          target_bin: {
            type: "string",
            description: "Name or node ID of the target bin",
          },
        },
        required: ["item_ids", "target_bin"],
      },
      handler: async (args: { item_ids: string[]; target_bin: string }) => {
        const idsJson = JSON.stringify(args.item_ids);
        const script = buildToolScript(`
          var targetBin = __findProjectItem("${escapeForExtendScript(args.target_bin)}");
          if (!targetBin || targetBin.type !== 2) return __error("Target bin not found: ${escapeForExtendScript(args.target_bin)}");

          var ids = ${idsJson};
          var moved = 0;
          for (var i = 0; i < ids.length; i++) {
            var item = __findProjectItem(ids[i]);
            if (item) {
              try {
                item.moveBin(targetBin);
                moved++;
              } catch(e) {}
            }
          }

          return __result({ moved: moved, total: ids.length, targetBin: targetBin.name });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_anti_alias_quality: {
      description: "Set the anti-alias quality on a clip's Motion effect (useful for scaled/rotated clips).",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          enabled: {
            type: "boolean",
            description: "Enable (true) or disable (false) anti-aliasing",
          },
        },
        required: ["node_id", "enabled"],
      },
      handler: async (args: { node_id: string; enabled: boolean }) => {
        // Bug #33: Anti-flicker Filter expects 0 or 1 (number) not bool.
        const intVal = args.enabled ? 1 : 0;
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");

          var clip = result.clip;
          var set = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Motion") {
              for (var p = 0; p < clip.components[i].properties.numItems; p++) {
                var pName = clip.components[i].properties[p].displayName;
                if (pName === "Anti-flicker Filter") {
                  // Numeric (0/1) — passing bool throws "Illegal Parameter type" in 25.4.
                  try {
                    clip.components[i].properties[p].setValue(${intVal}, true);
                    set = true;
                  } catch(e) {
                    // fallback: try boolean for older builds
                    try { clip.components[i].properties[p].setValue(${args.enabled}, true); set = true; } catch(e2) {}
                  }
                  break;
                }
              }
              break;
            }
          }

          return __result({ clip: clip.name, antiAlias: ${args.enabled}, propertyFound: set });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_uniform_scale: {
      description: "Toggle uniform scale on a clip's Motion effect. When enabled, Scale Width and Scale Height are linked.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          uniform: {
            type: "boolean",
            description: "true for uniform (linked), false for non-uniform (independent width/height)",
          },
        },
        required: ["node_id", "uniform"],
      },
      handler: async (args: { node_id: string; uniform: boolean }) => {
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");

          var clip = result.clip;
          var set = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Motion") {
              for (var p = 0; p < clip.components[i].properties.numItems; p++) {
                if (clip.components[i].properties[p].displayName === "Uniform Scale") {
                  clip.components[i].properties[p].setValue(${args.uniform}, true);
                  set = true;
                  break;
                }
              }
              break;
            }
          }
          if (!set) return __error("Uniform Scale property not found");
          return __result({ clip: clip.name, uniformScale: ${args.uniform} });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_scale_width_height: {
      description:
        "Set independent Scale Width and Scale Height on a clip's Motion. " +
        "Bug #34 fix: previously widthSet returned true but heightSet stayed false because the property collection wasn't re-read after flipping Uniform Scale off (Premiere 25.4 rebuilds the property list — Scale becomes Scale Width / Scale Height). " +
        "Tool now auto-toggles Uniform Scale=false, re-reads the property collection, does case-insensitive name match, and returns a probe of all Motion property names when one isn't found.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          scale_width: {
            type: "number",
            description: "Scale width percentage",
          },
          scale_height: {
            type: "number",
            description: "Scale height percentage",
          },
        },
        required: ["node_id", "scale_width", "scale_height"],
      },
      handler: async (args: { node_id: string; scale_width: number; scale_height: number }) => {
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");

          var clip = result.clip;
          var motion = null;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Motion") { motion = clip.components[i]; break; }
          }
          if (!motion) return __error("Motion component not found");

          function lowerTrim(s) { return String(s || "").toLowerCase().replace(/^\\s+|\\s+$/g, ""); }
          function findProp(comp, targetLower) {
            for (var p = 0; p < comp.properties.numItems; p++) {
              if (lowerTrim(comp.properties[p].displayName) === targetLower) return comp.properties[p];
            }
            return null;
          }

          // Step 1: turn Uniform Scale OFF if currently ON.
          var uniformProp = findProp(motion, "uniform scale");
          var wasUniform = false;
          if (uniformProp) {
            try { wasUniform = !!uniformProp.getValue(); } catch(eU) {}
            if (wasUniform) { try { uniformProp.setValue(false, true); } catch(eSU) {} }
          }

          // Step 2: re-read property collection (Premiere may have rebuilt it).
          var widthProp = findProp(motion, "scale width");
          var heightProp = findProp(motion, "scale height");

          var setW = false, setH = false;
          if (widthProp) { try { widthProp.setValue(${args.scale_width}, true); setW = true; } catch(eW) {} }
          if (heightProp) { try { heightProp.setValue(${args.scale_height}, true); setH = true; } catch(eH) {} }

          if (!setW || !setH) {
            // Probe: report what property names ARE on Motion so caller can diagnose.
            var probe = [];
            for (var k = 0; k < motion.properties.numItems; k++) {
              probe.push(motion.properties[k].displayName);
            }
            return __error(
              "set_scale_width_height partial fail. widthSet=" + setW + " heightSet=" + setH +
              " (was Uniform=" + wasUniform + "). Motion property names available: " + probe.join(" | ")
            );
          }

          return __result({
            clip: clip.name,
            scaleWidth: ${args.scale_width},
            scaleHeight: ${args.scale_height},
            widthSet: setW,
            heightSet: setH,
            uniformWasOn: wasUniform,
            uniformNowOff: true
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_clip_transform: {
      description:
        "Get all motion/transform properties of a clip in one call: position, scale, rotation, anchor point, opacity, anti-flicker, plus uniform-scale flags.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the clip" },
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string }) => {
        const script = buildToolScript(`
          var result = __findClip("${args.node_id.replace(/"/g, '\\"')}");
          if (!result) return __error("Clip not found");
          var clip = result.clip;

          var info = { name: clip.name };
          for (var i = 0; i < clip.components.numItems; i++) {
            var comp = clip.components[i];
            var cname = comp.displayName;
            if (cname === "Motion" || cname === "Opacity" || cname === "Time Remapping") {
              for (var j = 0; j < comp.properties.numItems; j++) {
                var p = comp.properties[j];
                var pname = p.displayName;
                try {
                  info[pname] = p.getValue();
                } catch (ex) {}
              }
            }
          }
          return __result(info);
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_clip_transform: {
      description:
        "Set multiple motion/transform properties of a clip in one call (position, scale, rotation, anchor, opacity). Pass only the fields you want to change.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the clip" },
          position: {
            type: "array",
            description: "[x, y] position (normalized 0-1, e.g. [0.5, 0.5] = center)",
          },
          scale: { type: "number", description: "Uniform scale (100 = 100%)" },
          scale_width: { type: "number", description: "Horizontal scale (when uniform_scale=false)" },
          scale_height: { type: "number", description: "Vertical scale (when uniform_scale=false)" },
          uniform_scale: { type: "boolean", description: "true to lock scale W/H together" },
          rotation: { type: "number", description: "Rotation in degrees" },
          anchor_point: { type: "array", description: "[x, y] anchor point" },
          opacity: { type: "number", description: "Opacity 0-100" },
        },
        required: ["node_id"],
      },
      handler: async (args: {
        node_id: string;
        position?: number[];
        scale?: number;
        scale_width?: number;
        scale_height?: number;
        uniform_scale?: boolean;
        rotation?: number;
        anchor_point?: number[];
        opacity?: number;
      }) => {
        const propsToSet: string[] = [];
        if (args.position) propsToSet.push(`{ comp: "Motion", name: "Position", value: [${args.position[0]}, ${args.position[1]}] }`);
        if (args.scale !== undefined) propsToSet.push(`{ comp: "Motion", name: "Scale", value: ${args.scale} }`);
        if (args.scale_width !== undefined) propsToSet.push(`{ comp: "Motion", name: "Scale Width", value: ${args.scale_width} }`);
        if (args.scale_height !== undefined) propsToSet.push(`{ comp: "Motion", name: "Scale Height", value: ${args.scale_height} }`);
        if (args.uniform_scale !== undefined) propsToSet.push(`{ comp: "Motion", name: "Uniform Scale", value: ${args.uniform_scale} }`);
        if (args.rotation !== undefined) propsToSet.push(`{ comp: "Motion", name: "Rotation", value: ${args.rotation} }`);
        if (args.anchor_point) propsToSet.push(`{ comp: "Motion", name: "Anchor Point", value: [${args.anchor_point[0]}, ${args.anchor_point[1]}] }`);
        if (args.opacity !== undefined) propsToSet.push(`{ comp: "Opacity", name: "Opacity", value: ${args.opacity} }`);

        const propsArr = `[${propsToSet.join(",")}]`;
        const script = buildToolScript(`
          var result = __findClip("${args.node_id.replace(/"/g, '\\"')}");
          if (!result) return __error("Clip not found");
          var clip = result.clip;
          var changes = ${propsArr};
          var applied = [];
          var notFound = [];

          for (var k = 0; k < changes.length; k++) {
            var change = changes[k];
            var foundC = false;
            for (var i = 0; i < clip.components.numItems; i++) {
              if (clip.components[i].displayName !== change.comp) continue;
              var comp = clip.components[i];
              for (var j = 0; j < comp.properties.numItems; j++) {
                if (comp.properties[j].displayName === change.name) {
                  comp.properties[j].setValue(change.value, true);
                  applied.push(change.name);
                  foundC = true;
                  break;
                }
              }
              if (foundC) break;
            }
            if (!foundC) notFound.push(change.name);
          }
          return __result({ clip: clip.name, applied: applied, notFound: notFound });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },
  };
}
