import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";

export function getAdvancedTools(bridgeOptions: BridgeOptions) {
  return {
    ripple_delete: {
      description: "Ripple delete a clip (removes clip and closes the gap). Uses QE DOM.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip to ripple delete",
          },
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string }) => {
        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found: ${escapeForExtendScript(args.node_id)}");
          
          var qeTrack = result.trackType === "video"
            ? qeSeq.getVideoTrackAt(result.trackIndex)
            : qeSeq.getAudioTrackAt(result.trackIndex);
          if (!qeTrack) return __error("QE track not found");
          
          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");
          
          qeClip.rippleDelete();
          return __result({ rippleDeleted: true, clipName: result.clip.name });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    // ⚠️ DATA-CORRUPTION SAFETY: roll/slide/slip in 25.4 QE have a unit-conversion regression
    // that causes massive clip displacement (~69,600s for a 0.5s offset) when called with
    // ticks-string. The exact correct signature is unknown without controlled testing
    // (test reproduction caused real data loss). These tools are DISABLED until verified.
    // Workaround: use the Premiere UI keyboard shortcuts Y (slip), U (slide), N (rolling edit).
    roll_edit: {
      description: "⚠️ DISABLED in 25.4 due to data-corruption bug (clip displaced ~69k seconds). Use UI rolling-edit tool (N) instead. See notebug.md Bug #39.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the clip" },
          offset_seconds: { type: "number", description: "Offset in seconds" },
        },
        required: ["node_id", "offset_seconds"],
      },
      handler: async (_args: { node_id: string; offset_seconds: number }) => {
        return {
          success: false,
          error:
            "roll_edit is temporarily disabled in Premiere 25.4 due to a data-corruption bug — the QE.roll API has a unit-conversion regression that displaces clips by tens of thousands of seconds. Use the Premiere UI rolling-edit tool (keyboard 'N') until the correct ticks/seconds signature is verified. Tracked in notebug.md Bug #39.",
        };
      },
    },

    slide_edit: {
      description: "⚠️ DISABLED in 25.4 due to data-corruption bug. Use UI slide tool (U) instead. See notebug.md Bug #39.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the clip" },
          offset_seconds: { type: "number", description: "Offset in seconds" },
        },
        required: ["node_id", "offset_seconds"],
      },
      handler: async (_args: { node_id: string; offset_seconds: number }) => {
        return {
          success: false,
          error:
            "slide_edit is temporarily disabled in Premiere 25.4 due to a data-corruption bug — QE.slide API has a unit-conversion regression. Use the Premiere UI slide tool (keyboard 'U'). Tracked in notebug.md Bug #39.",
        };
      },
    },

    slip_edit: {
      description: "⚠️ DISABLED in 25.4 due to data-corruption bug. Use UI slip tool (Y) instead. See notebug.md Bug #39.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the clip" },
          offset_seconds: { type: "number", description: "Offset in seconds" },
        },
        required: ["node_id", "offset_seconds"],
      },
      handler: async (_args: { node_id: string; offset_seconds: number }) => {
        return {
          success: false,
          error:
            "slip_edit is temporarily disabled in Premiere 25.4 due to a data-corruption bug — QE.slip API has a unit-conversion regression. Use the Premiere UI slip tool (keyboard 'Y'). Tracked in notebug.md Bug #39.",
        };
      },
    },

    move_clip_to_track: {
      description: "Move a clip to a different track. Uses QE DOM.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          target_track_index: {
            type: "number",
            description: "Target track index (0-based)",
          },
        },
        required: ["node_id", "target_track_index"],
      },
      handler: async (args: { node_id: string; target_track_index: number }) => {
        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          
          var qeTrack = result.trackType === "video"
            ? qeSeq.getVideoTrackAt(result.trackIndex)
            : qeSeq.getAudioTrackAt(result.trackIndex);
          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");
          
          qeClip.moveToTrack(${args.target_track_index});
          return __result({ moved: true, clipName: result.clip.name, newTrackIndex: ${args.target_track_index} });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    remove_all_effects: {
      description: "Remove ALL effects from a clip. Uses QE DOM.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string }) => {
        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          
          var qeTrack = result.trackType === "video"
            ? qeSeq.getVideoTrackAt(result.trackIndex)
            : qeSeq.getAudioTrackAt(result.trackIndex);
          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");
          
          qeClip.removeEffects();
          return __result({ removed: true, clipName: result.clip.name });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_clip_speed_qe: {
      description: "Set clip playback speed using QE DOM (more reliable than ExtendScript). Supports reverse.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          speed_percent: {
            type: "number",
            description: "Speed as percentage (100 = normal, 200 = 2x, 50 = half speed)",
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
          
          var qeTrack = result.trackType === "video"
            ? qeSeq.getVideoTrackAt(result.trackIndex)
            : qeSeq.getAudioTrackAt(result.trackIndex);
          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");
          
          qeClip.setSpeed(${args.speed_percent});
          ${args.reverse ? `qeClip.setReverse(true);` : ""}
          
          return __result({
            speedSet: true,
            clipName: result.clip.name,
            speed: ${args.speed_percent},
            reverse: ${!!args.reverse}
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    reverse_clip: {
      description: "Reverse a clip's playback direction. Uses QE DOM.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          reverse: {
            type: "boolean",
            description: "True to reverse, false for normal (default: true)",
          },
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string; reverse?: boolean }) => {
        const rev = args.reverse !== false;
        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          
          var qeTrack = result.trackType === "video"
            ? qeSeq.getVideoTrackAt(result.trackIndex)
            : qeSeq.getAudioTrackAt(result.trackIndex);
          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");
          
          qeClip.setReverse(${rev});
          return __result({ reversed: ${rev}, clipName: result.clip.name });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_frame_blend: {
      description: "Enable or disable frame blending on a clip. Uses QE DOM.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          enabled: {
            type: "boolean",
            description: "True to enable frame blending, false to disable",
          },
        },
        required: ["node_id", "enabled"],
      },
      handler: async (args: { node_id: string; enabled: boolean }) => {
        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          
          var qeTrack = result.trackType === "video"
            ? qeSeq.getVideoTrackAt(result.trackIndex)
            : qeSeq.getAudioTrackAt(result.trackIndex);
          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");
          
          qeClip.setFrameBlend(${args.enabled});
          return __result({ frameBlend: ${args.enabled}, clipName: result.clip.name });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_time_interpolation: {
      description: "Set time interpolation type for a clip (Frame Sampling, Frame Blending, Optical Flow). Uses QE DOM.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          interpolation_type: {
            type: "number",
            description: "0 = Frame Sampling, 1 = Frame Blending, 2 = Optical Flow",
          },
        },
        required: ["node_id", "interpolation_type"],
      },
      handler: async (args: { node_id: string; interpolation_type: number }) => {
        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          
          var qeTrack = result.trackType === "video"
            ? qeSeq.getVideoTrackAt(result.trackIndex)
            : qeSeq.getAudioTrackAt(result.trackIndex);
          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");
          
          qeClip.setTimeInterpolationType(${args.interpolation_type});
          var typeNames = ["Frame Sampling", "Frame Blending", "Optical Flow"];
          return __result({
            set: true,
            clipName: result.clip.name,
            interpolationType: typeNames[${args.interpolation_type}] || "Unknown"
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    rename_clip: {
      description: "Rename a clip on the timeline. Uses QE DOM.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          new_name: {
            type: "string",
            description: "New name for the clip",
          },
        },
        required: ["node_id", "new_name"],
      },
      handler: async (args: { node_id: string; new_name: string }) => {
        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          
          var qeTrack = result.trackType === "video"
            ? qeSeq.getVideoTrackAt(result.trackIndex)
            : qeSeq.getAudioTrackAt(result.trackIndex);
          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");
          
          var oldName = result.clip.name;
          qeClip.setName("${escapeForExtendScript(args.new_name)}");
          return __result({ renamed: true, oldName: oldName, newName: "${escapeForExtendScript(args.new_name)}" });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_clip_speed: {
      description: "Get the playback speed and reverse state of a clip",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string }) => {
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found: ${escapeForExtendScript(args.node_id)}");
          
          var clip = result.clip;
          var speed = 1;
          var reversed = false;
          try { speed = clip.getSpeed(); } catch(e) {}
          try { reversed = clip.isSpeedReversed() == 1; } catch(e) {}
          
          return __result({
            clipName: clip.name,
            speed: speed,
            reversed: reversed
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_clip_selection: {
      description: "Select or deselect a clip in the active sequence",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          selected: {
            type: "boolean",
            description: "True to select, false to deselect",
          },
        },
        required: ["node_id", "selected"],
      },
      handler: async (args: { node_id: string; selected: boolean }) => {
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          
          result.clip.setSelected(${args.selected ? 1 : 0}, true);
          return __result({ selected: ${args.selected}, clipName: result.clip.name });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    link_selection: {
      description: "Link the currently selected video and audio clips in the active sequence",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          seq.linkSelection();
          return __result({ linked: true });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    unlink_selection: {
      description: "Unlink the currently selected video and audio clips in the active sequence",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          seq.unlinkSelection();
          return __result({ unlinked: true });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    overwrite_clip: {
      description: "Overwrite a project item onto the timeline (replaces existing clips at the insertion point)",
      parameters: {
        type: "object" as const,
        properties: {
          item_id: {
            type: "string",
            description: "Node ID or name of the project item to add",
          },
          start_seconds: {
            type: "number",
            description: "Start time in seconds on the timeline (default: 0)",
          },
          track_index: {
            type: "number",
            description: "Video track index (0-based, default: 0)",
          },
          audio_track_index: {
            type: "number",
            description: "Audio track index (0-based, default: 0)",
          },
        },
        required: ["item_id"],
      },
      handler: async (args: { item_id: string; start_seconds?: number; track_index?: number; audio_track_index?: number }) => {
        const startSeconds = args.start_seconds ?? 0;
        const trackIndex = args.track_index ?? 0;
        const audioTrackIndex = args.audio_track_index ?? 0;

        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          
          var item = __findProjectItem("${escapeForExtendScript(args.item_id)}");
          if (!item) return __error("Project item not found: ${escapeForExtendScript(args.item_id)}");
          
          var startTicks = __secondsToTicks(${startSeconds}).toString();
          seq.overwriteClip(item, startTicks, ${trackIndex}, ${audioTrackIndex});
          
          return __result({
            overwritten: true,
            item: item.name,
            trackIndex: ${trackIndex},
            startSeconds: ${startSeconds}
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    create_sequence_from_clips: {
      description: "Create a new sequence by automatically placing project items in order",
      parameters: {
        type: "object" as const,
        properties: {
          name: {
            type: "string",
            description: "Name for the new sequence",
          },
          item_ids: {
            type: "array",
            description: "Array of project item names or node IDs to include in order",
          },
        },
        required: ["name", "item_ids"],
      },
      handler: async (args: { name: string; item_ids: string[] }) => {
        const itemLookups = args.item_ids
          .map((id, i) => `var item${i} = __findProjectItem("${escapeForExtendScript(id)}"); if (!item${i}) return __error("Item not found: ${escapeForExtendScript(id)}"); items.push(item${i});`)
          .join("\n          ");

        const script = buildToolScript(`
          var items = [];
          ${itemLookups}
          
          var seq = app.project.createNewSequenceFromClips("${escapeForExtendScript(args.name)}", items);
          if (!seq) return __error("Failed to create sequence from clips");
          return __result({ created: true, name: seq.name, id: seq.sequenceID, clipCount: items.length });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    close_sequence: {
      description: "Close a sequence tab in the timeline",
      parameters: {
        type: "object" as const,
        properties: {
          sequence_id: {
            type: "string",
            description: "Sequence name or ID. Uses active sequence if omitted.",
          },
        },
      },
      handler: async (args: { sequence_id?: string }) => {
        const seqLookup = args.sequence_id
          ? `var seq = __findSequence("${escapeForExtendScript(args.sequence_id)}"); if (!seq) return __error("Sequence not found");`
          : `var seq = app.project.activeSequence; if (!seq) return __error("No active sequence");`;

        const script = buildToolScript(`
          ${seqLookup}
          var name = seq.name;
          seq.close();
          return __result({ closed: true, name: name });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    export_as_project: {
      description: "Export a sequence as a standalone Premiere Pro project file",
      parameters: {
        type: "object" as const,
        properties: {
          sequence_id: {
            type: "string",
            description: "Sequence name or ID. Uses active sequence if omitted.",
          },
          output_path: {
            type: "string",
            description: "Full path for the exported .prproj file",
          },
        },
        required: ["output_path"],
      },
      handler: async (args: { sequence_id?: string; output_path: string }) => {
        const seqLookup = args.sequence_id
          ? `var seq = __findSequence("${escapeForExtendScript(args.sequence_id)}"); if (!seq) return __error("Sequence not found");`
          : `var seq = app.project.activeSequence; if (!seq) return __error("No active sequence");`;

        const script = buildToolScript(`
          ${seqLookup}
          seq.exportAsProject("${escapeForExtendScript(args.output_path)}");
          return __result({ exported: true, path: "${escapeForExtendScript(args.output_path)}" });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_zero_point: {
      description: "Set the starting timecode (zero point) of a sequence",
      parameters: {
        type: "object" as const,
        properties: {
          sequence_id: {
            type: "string",
            description: "Sequence name or ID. Uses active sequence if omitted.",
          },
          start_seconds: {
            type: "number",
            description: "Start time in seconds for the timecode origin",
          },
        },
        required: ["start_seconds"],
      },
      handler: async (args: { sequence_id?: string; start_seconds: number }) => {
        const seqLookup = args.sequence_id
          ? `var seq = __findSequence("${escapeForExtendScript(args.sequence_id)}"); if (!seq) return __error("Sequence not found");`
          : `var seq = app.project.activeSequence; if (!seq) return __error("No active sequence");`;

        const script = buildToolScript(`
          ${seqLookup}
          var ticks = __secondsToTicks(${args.start_seconds}).toString();
          seq.setZeroPoint(ticks);
          return __result({ set: true, startSeconds: ${args.start_seconds} });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    scene_edit_detection: {
      description: "Perform scene edit detection on the selected clips in the active sequence",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          seq.performSceneEditDetectionOnSelection();
          return __result({ sceneDetection: true });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    delete_preview_files: {
      description: "Delete all preview/render cache files for the project. Uses QE DOM.",
      parameters: {
        type: "object" as const,
        properties: {
          media_type: {
            type: "string",
            description: "Type of preview files to delete: 'video', 'audio', or 'all' (default: 'all')",
          },
        },
      },
      handler: async (args: { media_type?: string }) => {
        const typeMap: Record<string, string> = {
          video: '"228CDA18-3625-4d2d-951E-348879E4ED93"',
          audio: '"80B8E3D5-6DCA-4195-AEFB-CB5F407AB009"',
          all: '"FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF"',
        };
        const mediaType = typeMap[args.media_type || "all"] || typeMap.all;

        const script = buildToolScript(`
          app.enableQE();
          qe.project.deletePreviewFiles(${mediaType});
          return __result({ deleted: true, mediaType: "${args.media_type || "all"}" });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    add_tracks: {
      description: "Add video and/or audio tracks to the active sequence. Uses QE DOM.",
      parameters: {
        type: "object" as const,
        properties: {
          video_tracks: {
            type: "number",
            description: "Number of video tracks to add (default: 0)",
          },
          audio_tracks: {
            type: "number",
            description: "Number of standard stereo audio tracks to add (default: 0)",
          },
          audio_mono_tracks: {
            type: "number",
            description: "Number of mono audio tracks to add (default: 0)",
          },
          audio_51_tracks: {
            type: "number",
            description: "Number of 5.1 audio tracks to add (default: 0)",
          },
        },
      },
      handler: async (args: {
        video_tracks?: number;
        audio_tracks?: number;
        audio_mono_tracks?: number;
        audio_51_tracks?: number;
      }) => {
        const v = args.video_tracks ?? 0;
        const a = args.audio_tracks ?? 0;
        const aMono = args.audio_mono_tracks ?? 0;
        const a51 = args.audio_51_tracks ?? 0;

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          
          qeSeq.addTracks(${v}, ${a}, ${aMono}, ${a51});
          return __result({
            added: true,
            videoTracks: ${v},
            audioTracks: ${a},
            audioMonoTracks: ${aMono},
            audio51Tracks: ${a51}
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_color_value: {
      description: "Set a color value on an effect property (e.g., tint color, fill color)",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          component_name: {
            type: "string",
            description: "Name of the component/effect",
          },
          property_name: {
            type: "string",
            description: "Name of the color property",
          },
          alpha: {
            type: "number",
            description: "Alpha (0-255)",
          },
          red: {
            type: "number",
            description: "Red (0-255)",
          },
          green: {
            type: "number",
            description: "Green (0-255)",
          },
          blue: {
            type: "number",
            description: "Blue (0-255)",
          },
        },
        required: ["node_id", "component_name", "property_name", "alpha", "red", "green", "blue"],
      },
      handler: async (args: {
        node_id: string;
        component_name: string;
        property_name: string;
        alpha: number;
        red: number;
        green: number;
        blue: number;
      }) => {
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          
          var clip = result.clip;
          var components = clip.components;
          var targetComp = null;
          for (var i = 0; i < components.numItems; i++) {
            if (components[i].displayName === "${escapeForExtendScript(args.component_name)}") {
              targetComp = components[i];
              break;
            }
          }
          if (!targetComp) return __error("Component not found");
          
          var targetProp = null;
          for (var j = 0; j < targetComp.properties.numItems; j++) {
            if (targetComp.properties[j].displayName === "${escapeForExtendScript(args.property_name)}") {
              targetProp = targetComp.properties[j];
              break;
            }
          }
          if (!targetProp) return __error("Property not found");
          
          targetProp.setColorValue(${args.alpha}, ${args.red}, ${args.green}, ${args.blue}, true);
          return __result({
            set: true,
            color: { alpha: ${args.alpha}, red: ${args.red}, green: ${args.green}, blue: ${args.blue} }
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_clip_adjustment_layer: {
      description: "Check if a clip is an adjustment layer",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string }) => {
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          
          var clip = result.clip;
          var isAdj = false;
          try { isAdj = clip.isAdjustmentLayer(); } catch(e) {}
          
          return __result({ clipName: clip.name, isAdjustmentLayer: isAdj });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_linked_items: {
      description: "Get all clips in the sequence that are linked to the same source as a given clip",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string }) => {
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          
          var linked = result.clip.getLinkedItems();
          var items = [];
          if (linked) {
            for (var i = 0; i < linked.numItems; i++) {
              items.push({
                name: linked[i].name,
                nodeId: linked[i].nodeId,
                startSeconds: __ticksToSeconds(linked[i].start.ticks)
              });
            }
          }
          
          return __result({ clipName: result.clip.name, linkedItems: items, count: items.length });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_mogrt_component: {
      description: "Get MOGRT (Motion Graphics Template) component parameters from a clip",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the MOGRT clip on the timeline",
          },
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string }) => {
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          
          var mgtComp = result.clip.getMGTComponent();
          if (!mgtComp) return __error("Not a MOGRT clip or no MGT component found");
          
          var params = [];
          for (var i = 0; i < mgtComp.properties.numItems; i++) {
            var p = mgtComp.properties[i];
            params.push({
              displayName: p.displayName,
              value: p.getValue()
            });
          }
          
          return __result({ clipName: result.clip.name, parameters: params });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    render_clip_in_place: {
      description: "Render a single timeline clip's range to a media file via Adobe Media Encoder, baking effects/transforms. Fire-and-forget — AME runs in background. After AME finishes, call replace_clip_with_file to swap the clip's source. Restores sequence in/out points after kicking off the job.",
      parameters: {
        type: "object" as const,
        properties: {
          clip_node_id: {
            type: "string",
            description: "Node ID of the timeline clip to render",
          },
          output_path: {
            type: "string",
            description: "Full output file path (e.g., '/Users/me/baked-clip.mp4'). Parent directory must exist.",
          },
          preset_path: {
            type: "string",
            description: "Path to an AME preset file (.epr). Uses sequence-match settings if omitted.",
          },
          remove_on_completion: {
            type: "boolean",
            description: "Remove the job from AME queue after completion (default: true)",
          },
        },
        required: ["clip_node_id", "output_path"],
      },
      handler: async (args: {
        clip_node_id: string;
        output_path: string;
        preset_path?: string;
        remove_on_completion?: boolean;
      }) => {
        const removeOnDone = args.remove_on_completion === false ? "0" : "1";
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          var found = __findClip("${escapeForExtendScript(args.clip_node_id)}");
          if (!found) return __error("Clip not found: ${escapeForExtendScript(args.clip_node_id)}");

          var clip = found.clip;
          var clipStart = clip.start;
          var clipEnd = clip.end;
          if (!clipStart || !clipEnd) return __error("Clip has no start/end time");

          // getInPoint/getOutPoint return seconds as a string in 25.4
          var prevInSec = parseFloat(seq.getInPoint());
          var prevOutSec = parseFloat(seq.getOutPoint());

          seq.setInPoint(clipStart.ticks);
          seq.setOutPoint(clipEnd.ticks);

          var enc = app.encoder;
          if (!enc) return __error("Adobe Media Encoder not available");
          enc.launchEncoder();

          var outputPath = "${escapeForExtendScript(args.output_path)}";
          var presetPath = ${args.preset_path
            ? `"${escapeForExtendScript(args.preset_path)}"`
            : `""`
          };

          var queued = enc.encodeSequence(
            seq,
            outputPath,
            presetPath,
            enc.ENCODE_IN_TO_OUT,
            ${removeOnDone}
          );
          enc.startBatch();

          // Restore sequence in/out — 25.4 has no clearInPoint/clearOutPoint
          // so we always set back via __secondsToTicks
          if (!isNaN(prevInSec)) seq.setInPoint(__secondsToTicks(prevInSec).toString());
          if (!isNaN(prevOutSec)) seq.setOutPoint(__secondsToTicks(prevOutSec).toString());

          var durSec = (clipEnd.seconds - clipStart.seconds);
          return __result({
            queued: true,
            clipNodeId: "${escapeForExtendScript(args.clip_node_id)}",
            clipName: clip.name,
            outputPath: outputPath,
            startSeconds: clipStart.seconds,
            endSeconds: clipEnd.seconds,
            durationSeconds: durSec,
            note: "AME running in background. Poll output file existence, then call replace_clip_with_file to swap."
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    render_sequence_range: {
      description: "Render a custom in/out range of the active sequence to a media file via Adobe Media Encoder. Fire-and-forget. Use range_type='in_to_out' to use existing seq in/out, or pass explicit in/out seconds to override.",
      parameters: {
        type: "object" as const,
        properties: {
          output_path: {
            type: "string",
            description: "Full output file path",
          },
          preset_path: {
            type: "string",
            description: "Path to an AME preset file (.epr). Uses sequence-match settings if omitted.",
          },
          range_type: {
            type: "string",
            enum: ["entire", "in_to_out", "work_area"],
            description: "Which range to render (default: 'in_to_out')",
          },
          in_seconds: {
            type: "number",
            description: "Override in-point in seconds. Only honored when range_type is 'in_to_out'.",
          },
          out_seconds: {
            type: "number",
            description: "Override out-point in seconds. Only honored when range_type is 'in_to_out'.",
          },
          remove_on_completion: {
            type: "boolean",
            description: "Remove job from AME queue after completion (default: true)",
          },
        },
        required: ["output_path"],
      },
      handler: async (args: {
        output_path: string;
        preset_path?: string;
        range_type?: "entire" | "in_to_out" | "work_area";
        in_seconds?: number;
        out_seconds?: number;
        remove_on_completion?: boolean;
      }) => {
        const rangeType = args.range_type || "in_to_out";
        const rangeConst =
          rangeType === "entire" ? "ENCODE_ENTIRE" :
          rangeType === "work_area" ? "ENCODE_WORKAREA" :
          "ENCODE_IN_TO_OUT";
        const removeOnDone = args.remove_on_completion === false ? "0" : "1";
        const overrideIn = args.in_seconds !== undefined && rangeType === "in_to_out";
        const overrideOut = args.out_seconds !== undefined && rangeType === "in_to_out";

        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          var prevInSec = NaN, prevOutSec = NaN;
          ${overrideIn || overrideOut ? `
            prevInSec = parseFloat(seq.getInPoint());
            prevOutSec = parseFloat(seq.getOutPoint());
          ` : ""}
          ${overrideIn ? `seq.setInPoint(__secondsToTicks(${args.in_seconds}).toString());` : ""}
          ${overrideOut ? `seq.setOutPoint(__secondsToTicks(${args.out_seconds}).toString());` : ""}

          var enc = app.encoder;
          if (!enc) return __error("Adobe Media Encoder not available");
          enc.launchEncoder();

          var outputPath = "${escapeForExtendScript(args.output_path)}";
          var presetPath = ${args.preset_path
            ? `"${escapeForExtendScript(args.preset_path)}"`
            : `""`
          };

          enc.encodeSequence(
            seq,
            outputPath,
            presetPath,
            enc.${rangeConst},
            ${removeOnDone}
          );
          enc.startBatch();

          ${overrideIn || overrideOut ? `
            if (!isNaN(prevInSec)) seq.setInPoint(__secondsToTicks(prevInSec).toString());
            if (!isNaN(prevOutSec)) seq.setOutPoint(__secondsToTicks(prevOutSec).toString());
          ` : ""}

          return __result({
            queued: true,
            outputPath: outputPath,
            rangeType: "${rangeType}",
            note: "AME running in background. Job will appear in Adobe Media Encoder queue."
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    replace_clip_with_file: {
      description: "Import a media file into the project and replace a timeline clip's source media with it. Keeps clip position and duration. Useful as the second step after render_clip_in_place once AME finishes.",
      parameters: {
        type: "object" as const,
        properties: {
          clip_node_id: {
            type: "string",
            description: "Node ID of the timeline clip to replace media on",
          },
          file_path: {
            type: "string",
            description: "Path to the media file to import and use as new source",
          },
          target_bin: {
            type: "string",
            description: "Optional bin name or node ID to import into. Imports to root if omitted.",
          },
        },
        required: ["clip_node_id", "file_path"],
      },
      handler: async (args: {
        clip_node_id: string;
        file_path: string;
        target_bin?: string;
      }) => {
        const binLookup = args.target_bin
          ? `var targetBin = __findProjectItem("${escapeForExtendScript(args.target_bin)}");
             if (!targetBin) return __error("Bin not found: ${escapeForExtendScript(args.target_bin)}");`
          : `var targetBin = app.project.rootItem;`;

        const script = buildToolScript(`
          var filePath = "${escapeForExtendScript(args.file_path)}";
          var f = new File(filePath);
          if (!f.exists) return __error("File does not exist: " + filePath);

          var clipResult = __findClip("${escapeForExtendScript(args.clip_node_id)}");
          if (!clipResult) return __error("Clip not found: ${escapeForExtendScript(args.clip_node_id)}");

          ${binLookup}

          // Snapshot bin children before import to identify the new item
          var beforeIds = {};
          var binChildren = targetBin.children;
          for (var i = 0; i < binChildren.numItems; i++) {
            beforeIds[binChildren[i].nodeId] = true;
          }

          var importOk = app.project.importFiles([filePath], true, targetBin, false);
          if (!importOk) return __error("Import failed");

          // Find the newly imported item by diffing children
          var newItem = null;
          binChildren = targetBin.children;
          for (var j = 0; j < binChildren.numItems; j++) {
            if (!beforeIds[binChildren[j].nodeId]) {
              newItem = binChildren[j];
              break;
            }
          }
          if (!newItem) return __error("Could not locate imported item");

          var clip = clipResult.clip;
          var seq = app.project.activeSequence;
          var startTicks = clip.start.ticks;
          var trackType = clipResult.trackType;
          var trackIndex = clipResult.trackIndex;

          if (trackType === "video") {
            seq.overwriteClip(newItem, startTicks, trackIndex, -1);
          } else {
            seq.overwriteClip(newItem, startTicks, -1, trackIndex);
          }

          return __result({
            replaced: true,
            clipName: clip.name,
            newSource: newItem.name,
            newItemNodeId: newItem.nodeId,
            filePath: filePath
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },
  };
}
