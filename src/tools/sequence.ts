import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";

export function getSequenceTools(bridgeOptions: BridgeOptions) {
  return {
    create_sequence: {
      description: "Create a new sequence in the project",
      parameters: {
        type: "object" as const,
        properties: {
          name: {
            type: "string",
            description: "Name for the new sequence",
          },
          preset_path: {
            type: "string",
            description: "Optional path to a sequence preset file (.sqpreset). Uses default if omitted.",
          },
        },
        required: ["name"],
      },
      handler: async (args: { name: string; preset_path?: string }) => {
        const presetCode = args.preset_path
          ? `app.project.createNewSequenceFromPreset("${escapeForExtendScript(args.name)}", "${escapeForExtendScript(args.preset_path)}");`
          : `app.project.createNewSequence("${escapeForExtendScript(args.name)}");`;

        const script = buildToolScript(`
          ${presetCode}
          var seq = app.project.activeSequence;
          if (!seq) return __error("Failed to create sequence");
          return __result({ created: true, name: seq.name, id: seq.sequenceID });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    duplicate_sequence: {
      description: "Duplicate an existing sequence",
      parameters: {
        type: "object" as const,
        properties: {
          sequence_id: {
            type: "string",
            description: "Sequence name or ID to duplicate",
          },
        },
        required: ["sequence_id"],
      },
      handler: async (args: { sequence_id: string }) => {
        const script = buildToolScript(`
          var seq = __findSequence("${escapeForExtendScript(args.sequence_id)}");
          if (!seq) return __error("Sequence not found: ${escapeForExtendScript(args.sequence_id)}");
          
          seq.clone();
          return __result({ duplicated: true, originalName: seq.name });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    delete_sequence: {
      description: "Delete a sequence from the project (works for sequences in bins too)",
      parameters: {
        type: "object" as const,
        properties: {
          sequence_id: {
            type: "string",
            description: "Sequence name or ID to delete",
          },
        },
        required: ["sequence_id"],
      },
      handler: async (args: { sequence_id: string }) => {
        const script = buildToolScript(`
          var seq = __findSequence("${escapeForExtendScript(args.sequence_id)}");
          if (!seq) return __error("Sequence not found: ${escapeForExtendScript(args.sequence_id)}");

          var name = seq.name;
          var id = seq.sequenceID;
          app.project.deleteSequence(seq);
          return __result({ deleted: true, name: name, sequenceId: id });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_sequence_settings: {
      description: "Modify sequence settings (frame size, frame rate, etc.)",
      parameters: {
        type: "object" as const,
        properties: {
          sequence_id: {
            type: "string",
            description: "Sequence name or ID. Uses active sequence if omitted.",
          },
          width: {
            type: "number",
            description: "Frame width in pixels",
          },
          height: {
            type: "number",
            description: "Frame height in pixels",
          },
        },
      },
      handler: async (args: { sequence_id?: string; width?: number; height?: number }) => {
        const seqLookup = args.sequence_id
          ? `var seq = __findSequence("${escapeForExtendScript(args.sequence_id)}"); if (!seq) return __error("Sequence not found");`
          : `var seq = app.project.activeSequence; if (!seq) return __error("No active sequence");`;

        const setters: string[] = [];
        if (args.width) setters.push(`seq.frameSizeHorizontal = ${args.width};`);
        if (args.height) setters.push(`seq.frameSizeVertical = ${args.height};`);

        const script = buildToolScript(`
          ${seqLookup}
          var settings = seq.getSettings();
          ${setters.join("\n          ")}
          seq.setSettings(settings);
          return __result({ updated: true, name: seq.name });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    list_sequence_color_spaces: {
      description:
        "List the available working color spaces for the sequence (Rec. 709, Rec. 2100 HLG, Rec. 2100 PQ, ACEScct, ...). " +
        "Returns the index, name, and properties for each entry, plus the currently active color space. " +
        "Use the index/name with set_sequence_color_space to switch.",
      parameters: {
        type: "object" as const,
        properties: {
          sequence_id: { type: "string", description: "Sequence name or ID. Uses active sequence if omitted." },
        },
      },
      handler: async (args: { sequence_id?: string }) => {
        const seqLookup = args.sequence_id
          ? `var seq = __findSequence("${escapeForExtendScript(args.sequence_id)}"); if (!seq) return __error("Sequence not found");`
          : `var seq = app.project.activeSequence; if (!seq) return __error("No active sequence");`;
        const script = buildToolScript(`
          ${seqLookup}
          var settings = seq.getSettings();
          var list = settings.workingColorSpaceList;
          var current = settings.workingColorSpace;
          var spaces = [];
          if (list && list.length !== undefined) {
            for (var i = 0; i < list.length; i++) {
              var s = list[i];
              spaces.push({
                index: i,
                name: s.name,
                primaries: s.primaries,
                transferCharacteristic: s.transferCharacteristic,
                isSceneReferred: s.isSceneReferred,
                matrixEquation: s.matrixEquation,
                isCurrent: current && (current.name === s.name)
              });
            }
          }
          return __result({ sequence: seq.name, spaces: spaces, current: current ? current.name : null });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_sequence_color_space: {
      description:
        "Set the working color space of a sequence (HDR workflow). " +
        "Common values: 'Rec. 709' (SDR default), 'Rec. 2100 HLG' (HDR for broadcast), 'Rec. 2100 PQ' (HDR for streaming/Dolby Vision), 'ACEScct' (color science). " +
        "Use list_sequence_color_spaces first to see exact names available in your project.",
      parameters: {
        type: "object" as const,
        properties: {
          sequence_id: { type: "string", description: "Sequence name or ID. Uses active sequence if omitted." },
          color_space_name: {
            type: "string",
            description: "Color space name from workingColorSpaceList (e.g. 'Rec. 709', 'Rec. 2100 HLG').",
          },
          color_space_index: {
            type: "number",
            description: "Alternative to name: 0-based index into workingColorSpaceList.",
          },
        },
        required: [],
      },
      handler: async (args: { sequence_id?: string; color_space_name?: string; color_space_index?: number }) => {
        if (args.color_space_name === undefined && args.color_space_index === undefined) {
          throw new Error("Provide either color_space_name or color_space_index");
        }
        const seqLookup = args.sequence_id
          ? `var seq = __findSequence("${escapeForExtendScript(args.sequence_id)}"); if (!seq) return __error("Sequence not found");`
          : `var seq = app.project.activeSequence; if (!seq) return __error("No active sequence");`;
        const lookup = args.color_space_index !== undefined
          ? `var picked = list[${args.color_space_index}]; if (!picked) return __error("color_space_index out of range");`
          : `var wantedName = "${escapeForExtendScript(args.color_space_name!)}"; var picked = null; for (var i = 0; i < list.length; i++) { if (list[i].name === wantedName) { picked = list[i]; break; } } if (!picked) return __error("Color space not found: " + wantedName);`;
        const script = buildToolScript(`
          ${seqLookup}
          var settings = seq.getSettings();
          var list = settings.workingColorSpaceList;
          if (!list || list.length === undefined) return __error("workingColorSpaceList not available");
          ${lookup}
          var prevName = settings.workingColorSpace ? settings.workingColorSpace.name : null;
          settings.workingColorSpace = picked;
          seq.setSettings(settings);
          var verifySettings = seq.getSettings();
          return __result({
            sequence: seq.name,
            previous: prevName,
            current: verifySettings.workingColorSpace ? verifySettings.workingColorSpace.name : null
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_sequence_hdr_options: {
      description:
        "Toggle sequence-level HDR/color rendering options: auto tone mapping, automatic input gamut compression, and linear-light compositing. " +
        "All parameters are optional; only specified ones are changed. These settings affect how Premiere blends and tone-maps clips with mismatched color ranges (e.g. SDR clips in an HDR sequence).",
      parameters: {
        type: "object" as const,
        properties: {
          sequence_id: { type: "string", description: "Sequence name or ID. Uses active sequence if omitted." },
          auto_tone_map_enabled: {
            type: "boolean",
            description: "Auto-tone-map clips with mismatched dynamic range (e.g. HDR clip into SDR sequence).",
          },
          auto_input_gamut_compression_enabled: {
            type: "boolean",
            description: "Compress out-of-gamut colors when input clip's gamut exceeds working color space.",
          },
          composite_linear_color: {
            type: "boolean",
            description: "Compose layers in linear light (correct blending math; recommended for HDR pipelines).",
          },
        },
      },
      handler: async (args: {
        sequence_id?: string;
        auto_tone_map_enabled?: boolean;
        auto_input_gamut_compression_enabled?: boolean;
        composite_linear_color?: boolean;
      }) => {
        const seqLookup = args.sequence_id
          ? `var seq = __findSequence("${escapeForExtendScript(args.sequence_id)}"); if (!seq) return __error("Sequence not found");`
          : `var seq = app.project.activeSequence; if (!seq) return __error("No active sequence");`;
        const setters: string[] = [];
        if (args.auto_tone_map_enabled !== undefined) setters.push(`settings.autoToneMapEnabled = ${args.auto_tone_map_enabled}; changes.auto_tone_map_enabled = ${args.auto_tone_map_enabled};`);
        if (args.auto_input_gamut_compression_enabled !== undefined) setters.push(`settings.autoInputGamutCompressionEnabled = ${args.auto_input_gamut_compression_enabled}; changes.auto_input_gamut_compression_enabled = ${args.auto_input_gamut_compression_enabled};`);
        if (args.composite_linear_color !== undefined) setters.push(`settings.compositeLinearColor = ${args.composite_linear_color}; changes.composite_linear_color = ${args.composite_linear_color};`);

        const script = buildToolScript(`
          ${seqLookup}
          var settings = seq.getSettings();
          var changes = {};
          ${setters.join("\n          ")}
          seq.setSettings(settings);
          return __result({ sequence: seq.name, changes: changes });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    list_clip_color_space_overrides: {
      description:
        "List the color space overrides available for a project item (master clip). " +
        "These include camera-native spaces (S-Log, V-Log, ARRI, RED, etc.) plus standard SDR/HDR spaces. " +
        "Use the name with set_clip_color_space_override to override how a clip is interpreted by the sequence.",
      parameters: {
        type: "object" as const,
        properties: {
          item_id: { type: "string", description: "Project item nodeId or name" },
        },
        required: ["item_id"],
      },
      handler: async (args: { item_id: string }) => {
        const script = buildToolScript(`
          var item = __findProjectItem("${escapeForExtendScript(args.item_id)}");
          if (!item) return __error("Project item not found: ${escapeForExtendScript(args.item_id)}");
          var list = item.getOverrideColorSpaceList;
          if (!list || list.length === undefined) return __error("Override color space list not available for this item");
          var spaces = [];
          for (var i = 0; i < list.length; i++) {
            var s = list[i];
            spaces.push({
              index: i,
              name: s.name,
              primaries: s.primaries,
              transferCharacteristic: s.transferCharacteristic,
              isSceneReferred: s.isSceneReferred
            });
          }
          return __result({ item: item.name, count: spaces.length, spaces: spaces });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_clip_color_space_override: {
      description:
        "Override the color space of a master clip (project item). The override takes precedence over the auto-detected source color space and propagates to all timeline instances of this master clip. " +
        "Use list_clip_color_space_overrides to see available options for the item (typically includes camera-native spaces and standard SDR/HDR spaces).",
      parameters: {
        type: "object" as const,
        properties: {
          item_id: { type: "string", description: "Project item nodeId or name" },
          color_space_name: { type: "string", description: "Color space name (use list_clip_color_space_overrides to see options)" },
          color_space_index: { type: "number", description: "Alternative to name: 0-based index into the override list" },
        },
        required: ["item_id"],
      },
      handler: async (args: { item_id: string; color_space_name?: string; color_space_index?: number }) => {
        if (args.color_space_name === undefined && args.color_space_index === undefined) {
          throw new Error("Provide either color_space_name or color_space_index");
        }
        const lookup = args.color_space_index !== undefined
          ? `var picked = list[${args.color_space_index}]; if (!picked) return __error("color_space_index out of range");`
          : `var wantedName = "${escapeForExtendScript(args.color_space_name!)}"; var picked = null; for (var i = 0; i < list.length; i++) { if (list[i].name === wantedName) { picked = list[i]; break; } } if (!picked) return __error("Color space not found: " + wantedName);`;
        const script = buildToolScript(`
          var item = __findProjectItem("${escapeForExtendScript(args.item_id)}");
          if (!item) return __error("Project item not found");
          var list = item.getOverrideColorSpaceList;
          if (!list || list.length === undefined) return __error("Override color space list not available");
          ${lookup}
          item.setOverrideColorSpace(picked);
          return __result({ item: item.name, override: picked.name });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    create_subsequence: {
      description: "Create a subsequence (nested sequence) from selected clips or a time range",
      parameters: {
        type: "object" as const,
        properties: {
          ignore_track_targeting: {
            type: "boolean",
            description: "Whether to ignore track targeting (default: false)",
          },
        },
      },
      handler: async (args: { ignore_track_targeting?: boolean }) => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          
          var newSeq = seq.createSubsequence(${args.ignore_track_targeting ? "true" : "false"});
          if (!newSeq) return __error("Failed to create subsequence");
          return __result({ created: true, name: newSeq.name, id: newSeq.sequenceID });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    auto_reframe_sequence: {
      description: "Auto-reframe a sequence for a different aspect ratio",
      parameters: {
        type: "object" as const,
        properties: {
          sequence_id: {
            type: "string",
            description: "Sequence name or ID to reframe. Uses active sequence if omitted.",
          },
          target_width: {
            type: "number",
            description: "Target frame width in pixels",
          },
          target_height: {
            type: "number",
            description: "Target frame height in pixels",
          },
        },
        required: ["target_width", "target_height"],
      },
      handler: async (args: { sequence_id?: string; target_width: number; target_height: number }) => {
        const seqLookup = args.sequence_id
          ? `var seq = __findSequence("${escapeForExtendScript(args.sequence_id)}"); if (!seq) return __error("Sequence not found");`
          : `var seq = app.project.activeSequence; if (!seq) return __error("No active sequence");`;

        const script = buildToolScript(`
          ${seqLookup}
          seq.autoReframeSequence(${args.target_width}, ${args.target_height}, false);
          return __result({ reframed: true, name: seq.name, targetSize: "${args.target_width}x${args.target_height}" });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    unnest_sequence: {
      description: "Unnest a nested sequence on the timeline, replacing it with the contents of the nested sequence",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the nested sequence clip on the timeline to unnest",
          },
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string }) => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found: ${escapeForExtendScript(args.node_id)}");
          
          var clip = result.clip;
          var clipName = clip.name;
          var projectItem = clip.projectItem;
          
          if (!projectItem) return __error("Cannot find project item for this clip");
          
          // Check if the project item is a sequence (type 3 = sequence)
          // For nested sequences, the projectItem should reference another sequence
          var nestedSeq = null;
          for (var i = 0; i < app.project.sequences.numSequences; i++) {
            var s = app.project.sequences[i];
            if (s.name === projectItem.name || s.sequenceID === projectItem.nodeId) {
              nestedSeq = s;
              break;
            }
          }
          
          if (!nestedSeq) return __error("Clip is not a nested sequence: " + clipName);
          
          var startTicks = clip.start.ticks;
          var trackIndex = result.trackIndex;
          var trackType = result.trackType;
          
          // Remove the nested sequence clip
          clip.remove(false, false);
          
          // Copy clips from the nested sequence to the current timeline
          var addedClips = [];
          var tracks = trackType === "video" ? nestedSeq.videoTracks : nestedSeq.audioTracks;
          for (var t = 0; t < tracks.numTracks; t++) {
            var track = tracks[t];
            for (var c = 0; c < track.clips.numItems; c++) {
              var nestedClip = track.clips[c];
              if (nestedClip.projectItem) {
                var insertTime = (parseFloat(startTicks) + parseFloat(nestedClip.start.ticks)).toString();
                var targetTrack = trackIndex + t;
                if (trackType === "video") {
                  seq.insertClip(nestedClip.projectItem, insertTime, targetTrack, targetTrack);
                } else {
                  seq.insertClip(nestedClip.projectItem, insertTime, 0, targetTrack);
                }
                addedClips.push(nestedClip.name);
              }
            }
          }
          
          return __result({
            unnested: true,
            nestedSequence: clipName,
            clipsAdded: addedClips.length,
            clips: addedClips
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    create_sequence_from_preset: {
      description: "Create a new sequence from a specific preset file (.sqpreset)",
      parameters: {
        type: "object" as const,
        properties: {
          name: {
            type: "string",
            description: "Name for the new sequence",
          },
          preset_path: {
            type: "string",
            description: "Full path to the .sqpreset file",
          },
        },
        required: ["name", "preset_path"],
      },
      handler: async (args: { name: string; preset_path: string }) => {
        const script = buildToolScript(`
          app.project.createNewSequenceFromPreset("${escapeForExtendScript(args.name)}", "${escapeForExtendScript(args.preset_path)}");
          var seq = app.project.activeSequence;
          if (!seq) return __error("Failed to create sequence from preset");
          return __result({ created: true, name: seq.name, id: seq.sequenceID });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    attach_custom_property: {
      description: "Attach a custom property (key/value pair) to the active sequence",
      parameters: {
        type: "object" as const,
        properties: {
          property_id: {
            type: "string",
            description: "Unique identifier for the custom property",
          },
          property_value: {
            type: "string",
            description: "Value for the custom property",
          },
        },
        required: ["property_id", "property_value"],
      },
      handler: async (args: { property_id: string; property_value: string }) => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          seq.attachCustomProperty("${escapeForExtendScript(args.property_id)}", "${escapeForExtendScript(args.property_value)}");
          return __result({ attached: true, propertyId: "${escapeForExtendScript(args.property_id)}", value: "${escapeForExtendScript(args.property_value)}" });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    is_work_area_enabled: {
      description: "Check whether the work area bar is enabled on the active sequence",
      parameters: {
        type: "object" as const,
        properties: {},
      },
      handler: async () => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          var enabled = seq.isWorkAreaBarEnabled();
          return __result({ sequenceName: seq.name, workAreaEnabled: enabled });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_export_file_extension: {
      description: "Get the file extension that would be used when exporting the active sequence with a given preset",
      parameters: {
        type: "object" as const,
        properties: {
          preset_path: {
            type: "string",
            description: "Full path to the export preset file (.epr)",
          },
        },
        required: ["preset_path"],
      },
      handler: async (args: { preset_path: string }) => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          var ext = seq.getExportFileExtension("${escapeForExtendScript(args.preset_path)}");
          return __result({ sequenceName: seq.name, presetPath: "${escapeForExtendScript(args.preset_path)}", extension: ext });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_sequence_vr_settings: {
      description: "Read VR/360 sequence settings (layout, projection, captured view angles). Use this before set_sequence_vr_settings to inspect current values.",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          var s = seq.getSettings();
          return __result({
            sequenceName: seq.name,
            vrLayout: s.vrLayout,
            vrProjection: s.vrProjection,
            vrHorzCapturedView: s.vrHorzCapturedView,
            vrVertCapturedView: s.vrVertCapturedView,
            note: "vrLayout/vrProjection are integer enums. 0 typically means 'monoscopic / not VR'. Set to non-zero values to enable VR. Captured view fields are degrees (e.g. 360 horz / 180 vert for full equirectangular)."
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_sequence_vr_settings: {
      description: "Configure VR/360 settings on the active sequence. Switches a regular sequence into VR mode (or back) by setting layout, projection, and captured view angles. All parameters optional — only provided fields are changed.",
      parameters: {
        type: "object" as const,
        properties: {
          vr_layout: {
            type: "number",
            description: "VR layout enum (0 = Monoscopic / not VR, 1 = Stereoscopic Side by Side, 2 = Stereoscopic Top/Bottom). Default unchanged.",
          },
          vr_projection: {
            type: "number",
            description: "VR projection enum (0 = None / not VR, 1 = Equirectangular). Default unchanged.",
          },
          vr_horz_captured_view: {
            type: "number",
            description: "Horizontal captured view in degrees (e.g. 360 for full equirectangular, 180 for half-sphere)",
          },
          vr_vert_captured_view: {
            type: "number",
            description: "Vertical captured view in degrees (e.g. 180 for full equirectangular, 90 for half-sphere)",
          },
        },
      },
      handler: async (args: {
        vr_layout?: number;
        vr_projection?: number;
        vr_horz_captured_view?: number;
        vr_vert_captured_view?: number;
      }) => {
        const setLines: string[] = [];
        if (args.vr_layout !== undefined) setLines.push(`s.vrLayout = ${args.vr_layout};`);
        if (args.vr_projection !== undefined) setLines.push(`s.vrProjection = ${args.vr_projection};`);
        if (args.vr_horz_captured_view !== undefined) setLines.push(`s.vrHorzCapturedView = ${args.vr_horz_captured_view};`);
        if (args.vr_vert_captured_view !== undefined) setLines.push(`s.vrVertCapturedView = ${args.vr_vert_captured_view};`);

        if (setLines.length === 0) {
          return { success: false, error: "No VR settings provided to update" };
        }

        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          var s = seq.getSettings();
          ${setLines.join("\n          ")}
          var ok = seq.setSettings(s);
          if (!ok) return __error("setSettings failed");
          var s2 = seq.getSettings();
          return __result({
            sequenceName: seq.name,
            applied: {
              vrLayout: s2.vrLayout,
              vrProjection: s2.vrProjection,
              vrHorzCapturedView: s2.vrHorzCapturedView,
              vrVertCapturedView: s2.vrVertCapturedView
            }
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    list_vr_effects_and_transitions: {
      description: "List VR/360-specific video effects and transitions available in Premiere. Useful for AI agents working on VR sequences to discover usable effects without scanning the full effects catalog.",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          app.enableQE();
          var effectNames = [
            "VR Plane to Sphere", "VR Rotate Sphere", "VR Sharpen", "VR Glow",
            "VR Color Gradients", "VR Projection", "VR Digital Glitch",
            "VR Chromatic Aberrations", "VR Blur", "VR De-Noise", "VR Fractal Noise"
          ];
          var transitionNames = [
            "VR Chroma Leaks", "VR Light Rays", "VR Mobius Zoom",
            "VR Random Blocks", "VR Iris Wipe", "VR Spherical Blur",
            "VR Gradient Wipe"
          ];
          var availableEffects = [];
          for (var i = 0; i < effectNames.length; i++) {
            var e = qe.project.getVideoEffectByName(effectNames[i]);
            if (e && e.name && e.name.length > 0) availableEffects.push(e.name);
          }
          var availableTransitions = [];
          for (var j = 0; j < transitionNames.length; j++) {
            var t = qe.project.getVideoTransitionByName(transitionNames[j]);
            if (t && t.name && t.name.length > 0) availableTransitions.push(t.name);
          }
          return __result({
            videoEffects: availableEffects,
            videoTransitions: availableTransitions,
            note: "Apply via apply_effect / add_transition_to_clip with the names above."
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },
  };
}
