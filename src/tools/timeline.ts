import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";

export function getTimelineTools(bridgeOptions: BridgeOptions) {
  return {
    add_to_timeline: {
      description: "Add a project item (clip) to the timeline at a specific position",
      parameters: {
        type: "object" as const,
        properties: {
          item_id: {
            type: "string",
            description: "Node ID or name of the project item to add",
          },
          track_index: {
            type: "number",
            description: "Video track index (0-based, default: 0)",
          },
          start_seconds: {
            type: "number",
            description: "Start time in seconds on the timeline (default: 0)",
          },
          audio_track_index: {
            type: "number",
            description: "Audio track index for the audio portion (default: 0)",
          },
        },
        required: ["item_id"],
      },
      handler: async (args: { item_id: string; track_index?: number; start_seconds?: number; audio_track_index?: number }) => {
        const trackIndex = args.track_index ?? 0;
        const startSeconds = args.start_seconds ?? 0;
        const audioTrackIndex = args.audio_track_index ?? 0;

        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          
          var item = __findProjectItem("${escapeForExtendScript(args.item_id)}");
          if (!item) return __error("Project item not found: ${escapeForExtendScript(args.item_id)}");
          
          var startTicks = __secondsToTicks(${startSeconds}).toString();
          seq.insertClip(item, startTicks, ${trackIndex}, ${audioTrackIndex});
          
          return __result({
            added: true,
            item: item.name,
            trackIndex: ${trackIndex},
            startSeconds: ${startSeconds}
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    remove_from_timeline: {
      description: "Remove a clip from the timeline",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip to remove",
          },
          ripple: {
            type: "boolean",
            description: "Whether to ripple delete (close the gap). Default: false",
          },
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string; ripple?: boolean }) => {
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found: ${escapeForExtendScript(args.node_id)}");
          
          var clip = result.clip;
          clip.remove(${args.ripple ? "true" : "false"}, ${args.ripple ? "true" : "false"});
          return __result({ removed: true, clipName: clip.name });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    move_clip: {
      description: "Move a clip to a new position on the timeline",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip to move",
          },
          new_start_seconds: {
            type: "number",
            description: "New start time in seconds",
          },
          new_track_index: {
            type: "number",
            description: "Optional new track index to move the clip to",
          },
        },
        required: ["node_id", "new_start_seconds"],
      },
      handler: async (args: { node_id: string; new_start_seconds: number; new_track_index?: number }) => {
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found: ${escapeForExtendScript(args.node_id)}");
          
          var clip = result.clip;
          var newStartTicks = __secondsToTicks(${args.new_start_seconds}).toString();
          clip.start = newStartTicks;
          
          ${args.new_track_index !== undefined ? `
          // Move to different track if specified
          var seq = app.project.activeSequence;
          var targetTracks = result.trackType === "video" ? seq.videoTracks : seq.audioTracks;
          if (${args.new_track_index} < targetTracks.numTracks) {
            clip.moveToTrack(targetTracks[${args.new_track_index}]);
          }
          ` : ""}
          
          return __result({
            moved: true,
            clipName: clip.name,
            newStart: ${args.new_start_seconds}
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    trim_clip: {
      description: "Trim a clip's in or out point",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip to trim",
          },
          new_in_seconds: {
            type: "number",
            description: "New in-point in seconds (relative to clip's source media)",
          },
          new_out_seconds: {
            type: "number",
            description: "New out-point in seconds (relative to clip's source media)",
          },
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string; new_in_seconds?: number; new_out_seconds?: number }) => {
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found: ${escapeForExtendScript(args.node_id)}");
          
          var clip = result.clip;
          ${args.new_in_seconds !== undefined ? `clip.inPoint = __secondsToTicks(${args.new_in_seconds}).toString();` : ""}
          ${args.new_out_seconds !== undefined ? `clip.outPoint = __secondsToTicks(${args.new_out_seconds}).toString();` : ""}
          
          return __result({
            trimmed: true,
            clipName: clip.name,
            inPoint: __ticksToSeconds(clip.inPoint.ticks),
            outPoint: __ticksToSeconds(clip.outPoint.ticks)
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    split_clip: {
      description: "Split (razor) a clip at a specific time position. Requires QE DOM.",
      parameters: {
        type: "object" as const,
        properties: {
          time_seconds: {
            type: "number",
            description: "Time position in seconds where to split",
          },
          track_index: {
            type: "number",
            description: "Track index (0-based)",
          },
          track_type: {
            type: "string",
            enum: ["video", "audio"],
            description: "Track type (default: video)",
          },
        },
        required: ["time_seconds"],
      },
      handler: async (args: { time_seconds: number; track_index?: number; track_type?: string }) => {
        const trackType = args.track_type || "video";
        const trackIndex = args.track_index ?? 0;

        const script = buildToolScript(`
          app.enableQE();
          var seq = qe.project.getActiveSequence();
          if (!seq) return __error("No active sequence (QE)");
          
          var track = ${trackType === "video" ? `seq.getVideoTrackAt(${trackIndex})` : `seq.getAudioTrackAt(${trackIndex})`};
          if (!track) return __error("Track not found");
          
          var timeTicks = __secondsToTicks(${args.time_seconds}).toString();
          track.razor(timeTicks);
          
          return __result({ split: true, atSeconds: ${args.time_seconds}, trackIndex: ${trackIndex}, trackType: "${trackType}" });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    duplicate_clip: {
      description: "Duplicate a clip on the timeline (copy to same position on next available track)",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip to duplicate",
          },
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string }) => {
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found: ${escapeForExtendScript(args.node_id)}");
          
          var clip = result.clip;
          var seq = app.project.activeSequence;
          var projectItem = clip.projectItem;
          
          if (!projectItem) return __error("Cannot find source project item for clip");
          
          var newTrackIndex = result.trackIndex + 1;
          var startTicks = clip.start.ticks;
          
          seq.insertClip(projectItem, startTicks, newTrackIndex, newTrackIndex);
          
          return __result({ duplicated: true, clipName: clip.name, newTrackIndex: newTrackIndex });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    enable_disable_clip: {
      description: "Enable or disable a clip on the timeline",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          enabled: {
            type: "boolean",
            description: "Set to true to enable, false to disable",
          },
        },
        required: ["node_id", "enabled"],
      },
      handler: async (args: { node_id: string; enabled: boolean }) => {
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found: ${escapeForExtendScript(args.node_id)}");
          
          result.clip.setDisabled(${args.enabled ? "false" : "true"});
          return __result({ clipName: result.clip.name, enabled: ${args.enabled} });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_clip_properties: {
      description: "Set properties on a clip (opacity, speed, etc.)",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          opacity: {
            type: "number",
            description: "Opacity value (0-100)",
          },
          speed: {
            type: "number",
            description: "Playback speed multiplier (1.0 = normal, 2.0 = double speed)",
          },
          scale: {
            type: "number",
            description: "Scale percentage (100 = original size)",
          },
          position_x: {
            type: "number",
            description: "Horizontal position",
          },
          position_y: {
            type: "number",
            description: "Vertical position",
          },
          rotation: {
            type: "number",
            description: "Rotation in degrees",
          },
        },
        required: ["node_id"],
      },
      handler: async (args: {
        node_id: string;
        opacity?: number;
        speed?: number;
        scale?: number;
        position_x?: number;
        position_y?: number;
        rotation?: number;
      }) => {
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found: ${escapeForExtendScript(args.node_id)}");
          
          var clip = result.clip;
          var changes = {};
          
          ${args.opacity !== undefined ? `
          // Set opacity via Motion component
          for (var i = 0; i < clip.components.numItems; i++) {
            var comp = clip.components[i];
            if (comp.matchName === "AE.ADBE Opacity" || comp.displayName === "Opacity") {
              for (var p = 0; p < comp.properties.numItems; p++) {
                if (comp.properties[p].displayName === "Opacity") {
                  comp.properties[p].setValue(${args.opacity}, true);
                  changes.opacity = ${args.opacity};
                }
              }
            }
          }
          ` : ""}
          
          ${args.speed !== undefined ? `
          // Premiere 25.4: DOM clip.setSpeed removed; use QE clip with 5-arg signature.
          var __qeClipForSpeed = __getQEClip(result);
          if (!__qeClipForSpeed) return __error("QE clip not found for setSpeed");
          __qeClipForSpeed.setSpeed(${args.speed * 100}, "1", false, false, false);
          changes.speed = ${args.speed};
          ` : ""}
          
          ${args.scale !== undefined || args.position_x !== undefined || args.position_y !== undefined || args.rotation !== undefined ? `
          for (var i = 0; i < clip.components.numItems; i++) {
            var comp = clip.components[i];
            if (comp.matchName === "AE.ADBE Motion" || comp.displayName === "Motion") {
              for (var p = 0; p < comp.properties.numItems; p++) {
                var prop = comp.properties[p];
                ${args.scale !== undefined ? `
                if (prop.displayName === "Scale") {
                  prop.setValue(${args.scale}, true);
                  changes.scale = ${args.scale};
                }` : ""}
                ${args.position_x !== undefined || args.position_y !== undefined ? `
                if (prop.displayName === "Position") {
                  var posVal = prop.getValue();
                  var px = posVal && typeof posVal === "object" && posVal.length >= 2 ? posVal[0] : 0;
                  var py = posVal && typeof posVal === "object" && posVal.length >= 2 ? posVal[1] : 0;
                  ${args.position_x !== undefined ? `px = ${args.position_x}; changes.position_x = ${args.position_x};` : ""}
                  ${args.position_y !== undefined ? `py = ${args.position_y}; changes.position_y = ${args.position_y};` : ""}
                  prop.setValue([px, py], true);
                }` : ""}
                ${args.rotation !== undefined ? `
                if (prop.displayName === "Rotation") {
                  prop.setValue(${args.rotation}, true);
                  changes.rotation = ${args.rotation};
                }` : ""}
              }
            }
          }
          ` : ""}
          
          return __result({ updated: true, clipName: clip.name, changes: changes });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    replace_clip: {
      description: "Replace a clip on the timeline with a different project item, preserving position and duration",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip to replace",
          },
          new_item_id: {
            type: "string",
            description: "Node ID or name of the new project item to replace with",
          },
        },
        required: ["node_id", "new_item_id"],
      },
      handler: async (args: { node_id: string; new_item_id: string }) => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found: ${escapeForExtendScript(args.node_id)}");
          
          var newItem = __findProjectItem("${escapeForExtendScript(args.new_item_id)}");
          if (!newItem) return __error("Replacement project item not found: ${escapeForExtendScript(args.new_item_id)}");
          
          var clip = result.clip;
          var oldName = clip.name;
          var startTicks = clip.start.ticks;
          var trackIndex = result.trackIndex;
          var trackType = result.trackType;
          
          // Remove old clip
          clip.remove(false, false);
          
          // Insert new clip at same position
          if (trackType === "video") {
            seq.insertClip(newItem, startTicks, trackIndex, trackIndex);
          } else {
            seq.insertClip(newItem, startTicks, 0, trackIndex);
          }
          
          return __result({
            replaced: true,
            oldClip: oldName,
            newClip: newItem.name,
            trackIndex: trackIndex,
            trackType: trackType
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    three_point_edit: {
      description:
        "3-point edit: provide source In/Out + timeline In, Premiere computes timeline Out from source duration. " +
        "Atomic operation that sets source in/out, then insert or overwrite at timeline_in_seconds. " +
        "Use insert mode to shift existing clips; overwrite mode replaces overlapping clips in the target track range.",
      parameters: {
        type: "object" as const,
        properties: {
          source_item_id: {
            type: "string",
            description: "Project item nodeId or name to edit from (must already be a usable source — usually opened in Source Monitor first). Required.",
          },
          source_in_seconds: { type: "number", description: "Source clip in-point in seconds" },
          source_out_seconds: { type: "number", description: "Source clip out-point in seconds" },
          timeline_in_seconds: { type: "number", description: "Timeline insert position in seconds" },
          edit_type: {
            type: "string",
            enum: ["insert", "overwrite"],
            description: "'insert' shifts existing clips right; 'overwrite' replaces (default: overwrite)",
          },
          video_track_index: { type: "number", description: "Target video track index (default: 0)" },
          audio_track_index: { type: "number", description: "Target audio track index (default: 0)" },
        },
        required: ["source_item_id", "source_in_seconds", "source_out_seconds", "timeline_in_seconds"],
      },
      handler: async (args: {
        source_item_id: string;
        source_in_seconds: number;
        source_out_seconds: number;
        timeline_in_seconds: number;
        edit_type?: string;
        video_track_index?: number;
        audio_track_index?: number;
      }) => {
        const editType = args.edit_type || "overwrite";
        const vTrack = args.video_track_index ?? 0;
        const aTrack = args.audio_track_index ?? 0;
        const editFn = editType === "insert" ? "insertClip" : "overwriteClip";

        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          var item = __findProjectItem("${escapeForExtendScript(args.source_item_id)}");
          if (!item) return __error("Source item not found: ${escapeForExtendScript(args.source_item_id)}");

          // Apply source in/out
          var inT = new Time(); inT.seconds = ${args.source_in_seconds};
          var outT = new Time(); outT.seconds = ${args.source_out_seconds};
          item.setInPoint(inT.ticks, 4);
          item.setOutPoint(outT.ticks, 4);

          // Edit at timeline_in
          var tlT = new Time(); tlT.seconds = ${args.timeline_in_seconds};
          seq.${editFn}(item, tlT.ticks, ${vTrack}, ${aTrack});

          var sourceDuration = ${args.source_out_seconds} - ${args.source_in_seconds};
          return __result({
            edited: true,
            mode: "${editType}",
            item: item.name,
            sourceIn: ${args.source_in_seconds},
            sourceOut: ${args.source_out_seconds},
            timelineIn: ${args.timeline_in_seconds},
            timelineOut: ${args.timeline_in_seconds} + sourceDuration,
            duration: sourceDuration,
            videoTrack: ${vTrack},
            audioTrack: ${aTrack}
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    four_point_edit: {
      description:
        "4-point edit (fit-to-fill): provide source In/Out + timeline In/Out, Premiere stretches/compresses source via speed change to fit the timeline range. " +
        "Used when you want to lock both source range and timeline range — e.g. fit a 3s shot into a 2s gap (= 150% speed). " +
        "After the edit, the inserted clip's speed is set so source duration maps to timeline duration.",
      parameters: {
        type: "object" as const,
        properties: {
          source_item_id: { type: "string", description: "Project item nodeId or name. Required." },
          source_in_seconds: { type: "number", description: "Source clip in-point in seconds" },
          source_out_seconds: { type: "number", description: "Source clip out-point in seconds" },
          timeline_in_seconds: { type: "number", description: "Timeline range start in seconds" },
          timeline_out_seconds: { type: "number", description: "Timeline range end in seconds" },
          edit_type: {
            type: "string",
            enum: ["insert", "overwrite"],
            description: "'insert' shifts existing clips; 'overwrite' replaces (default: overwrite)",
          },
          video_track_index: { type: "number", description: "Target video track index (default: 0)" },
          audio_track_index: { type: "number", description: "Target audio track index (default: 0)" },
        },
        required: ["source_item_id", "source_in_seconds", "source_out_seconds", "timeline_in_seconds", "timeline_out_seconds"],
      },
      handler: async (args: {
        source_item_id: string;
        source_in_seconds: number;
        source_out_seconds: number;
        timeline_in_seconds: number;
        timeline_out_seconds: number;
        edit_type?: string;
        video_track_index?: number;
        audio_track_index?: number;
      }) => {
        const editType = args.edit_type || "overwrite";
        const vTrack = args.video_track_index ?? 0;
        const aTrack = args.audio_track_index ?? 0;
        const editFn = editType === "insert" ? "insertClip" : "overwriteClip";

        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          var item = __findProjectItem("${escapeForExtendScript(args.source_item_id)}");
          if (!item) return __error("Source item not found: ${escapeForExtendScript(args.source_item_id)}");

          var sourceDur = ${args.source_out_seconds} - ${args.source_in_seconds};
          var timelineDur = ${args.timeline_out_seconds} - ${args.timeline_in_seconds};
          if (sourceDur <= 0) return __error("source_out must be greater than source_in");
          if (timelineDur <= 0) return __error("timeline_out must be greater than timeline_in");
          var speedPercent = (sourceDur / timelineDur) * 100;

          // Apply source in/out
          var inT = new Time(); inT.seconds = ${args.source_in_seconds};
          var outT = new Time(); outT.seconds = ${args.source_out_seconds};
          item.setInPoint(inT.ticks, 4);
          item.setOutPoint(outT.ticks, 4);

          // Edit at timeline_in
          var tlT = new Time(); tlT.seconds = ${args.timeline_in_seconds};
          seq.${editFn}(item, tlT.ticks, ${vTrack}, ${aTrack});

          // Find newly inserted clip. Premiere rounds insert position to nearest frame, so the
          // resulting clip's start may differ from tlInTicks by up to ~1 frame. Use 1-second
          // tolerance which is well above any reasonable frame rate's frame duration.
          var targetTrack = seq.videoTracks[${vTrack}];
          var newClip = null;
          var newClipIndex = -1;
          var tlInTicks = parseFloat(tlT.ticks);
          var TOLERANCE = TICKS_PER_SECOND; // 1 second
          for (var c = 0; c < targetTrack.clips.numItems; c++) {
            var cc = targetTrack.clips[c];
            if (Math.abs(parseFloat(cc.start.ticks) - tlInTicks) < TOLERANCE) {
              newClip = cc;
              newClipIndex = c;
              break;
            }
          }
          if (!newClip) return __error("Newly inserted clip not located on target track");

          var fakeResult = { trackIndex: ${vTrack}, clipIndex: newClipIndex, trackType: "video", clip: newClip };
          var qeClip = __getQEClip(fakeResult);
          if (!qeClip) return __error("QE clip not found for fit-to-fill speed adjustment");
          qeClip.setSpeed(speedPercent, "1", false, false, false);

          return __result({
            edited: true,
            mode: "${editType}",
            item: item.name,
            sourceIn: ${args.source_in_seconds},
            sourceOut: ${args.source_out_seconds},
            timelineIn: ${args.timeline_in_seconds},
            timelineOut: ${args.timeline_out_seconds},
            sourceDuration: sourceDur,
            timelineDuration: timelineDur,
            speedPercent: speedPercent,
            videoTrack: ${vTrack},
            audioTrack: ${aTrack}
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    speed_change: {
      description: "Change the playback speed of a clip",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          speed_percent: {
            type: "number",
            description: "Speed as percentage (100 = normal, 200 = double, 50 = half)",
          },
          reverse: {
            type: "boolean",
            description: "Reverse playback direction (default: false)",
          },
        },
        required: ["node_id", "speed_percent"],
      },
      handler: async (args: { node_id: string; speed_percent: number; reverse?: boolean }) => {
        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          
          var clip = result.clip;
          // Premiere 25.4: DOM clip.setSpeed removed; use QE clip with 5-arg signature.
          // Reversed flag is the 4th arg (no longer encoded in negative speed string).
          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");
          qeClip.setSpeed(${args.speed_percent}, "1", false, ${args.reverse ? "true" : "false"}, false);
          return __result({ speedChanged: true, clipName: clip.name, speed: ${args.speed_percent}, reverse: ${!!args.reverse} });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_clip_time_interpolation: {
      description:
        "Set how Premiere generates intermediate frames when a clip's speed differs from native (e.g., slow-mo). " +
        "Frame Sample (default) drops/duplicates frames; Frame Blend cross-fades adjacent frames; Optical Flow uses motion estimation for smoother results (recommended for slow-mo). " +
        "Note: Premiere 25.4 does NOT expose speed-ramp keyframes via ExtendScript — use this for the clip's flat interpolation method, and combine with `speed_change` for flat speed.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          interpolation: {
            type: "string",
            enum: ["Frame Sample", "Frame Blend", "Optical Flow"],
            description: "Time interpolation algorithm",
          },
        },
        required: ["node_id", "interpolation"],
      },
      handler: async (args: { node_id: string; interpolation: string }) => {
        const interpMap: Record<string, number> = {
          "Frame Sample": 0,
          "Frame Blend": 1,
          "Optical Flow": 2,
        };
        const v = interpMap[args.interpolation];
        if (v === undefined) throw new Error(`Invalid interpolation: ${args.interpolation}`);

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Time interpolation applies only to video clips");

          var qeTrack = qeSeq.getVideoTrackAt(result.trackIndex);
          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");
          if (typeof qeClip.setTimeInterpolationType !== "function") return __error("setTimeInterpolationType unavailable in this Premiere build");

          qeClip.setTimeInterpolationType(${v});
          return __result({
            clipName: result.clip.name,
            interpolation: "${escapeForExtendScript(args.interpolation)}",
            interpolationType: ${v}
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    razor_timeline_at_time: {
      description:
        "Razor (cut) across multiple tracks at an absolute timeline time. If no track indices are provided, all video and audio tracks are cut. Uses QE DOM.",
      parameters: {
        type: "object" as const,
        properties: {
          time_seconds: {
            type: "number",
            description: "Absolute timeline time in seconds where to cut",
          },
          video_track_indices: {
            type: "array",
            description: "Optional list of video track indices. Defaults to all video tracks.",
          },
          audio_track_indices: {
            type: "array",
            description: "Optional list of audio track indices. Defaults to all audio tracks.",
          },
        },
        required: ["time_seconds"],
      },
      handler: async (args: {
        time_seconds: number;
        video_track_indices?: number[];
        audio_track_indices?: number[];
      }) => {
        const videoIndices = JSON.stringify(args.video_track_indices ?? []);
        const audioIndices = JSON.stringify(args.audio_track_indices ?? []);
        const script = buildToolScript(`
          try {
            app.enableQE();
            var seq = app.project.activeSequence;
            if (!seq) return __error("No active sequence");

            var fps = seq.timebase ? (254016000000 / parseInt(seq.timebase, 10)) : 30;
            var totalFrames = Math.round(${args.time_seconds} * fps);
            var hours = Math.floor(totalFrames / (fps * 3600));
            var mins = Math.floor((totalFrames % (fps * 3600)) / (fps * 60));
            var secs = Math.floor((totalFrames % (fps * 60)) / fps);
            var frames = Math.round(totalFrames % fps);
            var tc = __pad(hours) + ":" + __pad(mins) + ":" + __pad(secs) + ":" + __pad(frames);

            var qeSeq = qe.project.getActiveSequence();
            if (!qeSeq) return __error("QE active sequence unavailable");

            function buildIndices(count, requested) {
              if (!requested || requested.length === 0) {
                var all = [];
                for (var idx = 0; idx < count; idx++) all.push(idx);
                return all;
              }
              return requested;
            }

            var requestedV = ${videoIndices};
            var requestedA = ${audioIndices};
            var finalV = buildIndices(seq.videoTracks.numTracks, requestedV);
            var finalA = buildIndices(seq.audioTracks.numTracks, requestedA);
            var cutV = [], cutA = [];

            for (var i = 0; i < finalV.length; i++) {
              var vi = finalV[i];
              if (vi < 0 || vi >= seq.videoTracks.numTracks) continue;
              var qv = qeSeq.getVideoTrackAt(vi);
              if (qv) { qv.razor(tc); cutV.push(vi); }
            }
            for (var j = 0; j < finalA.length; j++) {
              var ai = finalA[j];
              if (ai < 0 || ai >= seq.audioTracks.numTracks) continue;
              var qa = qeSeq.getAudioTrackAt(ai);
              if (qa) { qa.razor(tc); cutA.push(ai); }
            }

            return __result({
              timeSeconds: ${args.time_seconds},
              timecode: tc,
              cutVideoTracks: cutV,
              cutAudioTracks: cutA
            });
          } catch (e) {
            return __error("Razor failed: " + e.toString());
          }
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    link_audio_video: {
      description:
        "Link or unlink the audio and video components of a clip on the timeline so they move/edit together.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the clip (audio or video portion)" },
          linked: { type: "boolean", description: "true to link (default), false to unlink" },
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string; linked?: boolean }) => {
        const linked = args.linked !== false;
        const script = buildToolScript(`
          var result = __findClip("${args.node_id.replace(/"/g, '\\"')}");
          if (!result) return __error("Clip not found");
          var clip = result.clip;
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          try {
            seq.setSelection([clip], true);
            if (${linked}) {
              if (app.project.executeCommand) {
                app.project.executeCommand(7, "Link"); // best-effort
              }
              if (clip.linkedItems) {
                return __result({ linked: true, hasLinkedItems: true });
              }
            } else {
              if (clip.unlink) clip.unlink();
            }
            return __result({ linked: ${linked}, clipName: clip.name });
          } catch (ex) {
            return __error("Link/unlink failed: " + ex.toString());
          }
        `);
        return sendCommand(script, bridgeOptions);
      },
    },
  };
}
