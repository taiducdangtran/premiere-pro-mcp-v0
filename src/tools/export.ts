import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";
import { readFileSync, unlinkSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

export function getExportTools(bridgeOptions: BridgeOptions) {
  return {
    export_sequence: {
      description: "Export the active sequence using Adobe Media Encoder",
      parameters: {
        type: "object" as const,
        properties: {
          output_path: {
            type: "string",
            description: "Full output file path (e.g., '/Users/me/exports/video.mp4')",
          },
          preset_path: {
            type: "string",
            description: "Path to an AME preset file (.epr). Uses default H.264 if omitted.",
          },
          work_area_only: {
            type: "boolean",
            description: "Export only the work area (default: false, exports entire sequence)",
          },
        },
        required: ["output_path"],
      },
      handler: async (args: { output_path: string; preset_path?: string; work_area_only?: boolean }) => {
        if (typeof args.output_path === "string" && args.output_path.length > 0) {
          const outputDir = dirname(args.output_path);
          if (!existsSync(outputDir)) {
            return {
              success: false,
              error: `export_sequence: output directory does not exist: ${outputDir}. Create the directory before calling, or pass a valid path.`,
            };
          }
        }
        if (args.preset_path && !existsSync(args.preset_path)) {
          return {
            success: false,
            error: `export_sequence: preset_path does not exist: ${args.preset_path}`,
          };
        }
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          var outputPath = "${escapeForExtendScript(args.output_path)}";

          ${args.preset_path
            ? `var presetPath = "${escapeForExtendScript(args.preset_path)}";`
            : `// Use default H.264 preset
               var presetPath = "";
               // Try common preset locations
               var presetFile = new File("/Applications/Adobe Media Encoder 2025/MediaIO/systempresets/4028/HDTV 1080p 29.97 High Quality.epr");
               if (presetFile.exists) presetPath = presetFile.fsName;`
          }

          var exportResult = seq.exportAsMediaDirect(
            outputPath,
            presetPath,
            ${args.work_area_only ? "app.encoder.ENCODE_WORKAREA" : "app.encoder.ENCODE_ENTIRE"}
          );

          return __result({
            queued: true,
            outputPath: outputPath,
            _note: "AME queue accepted the job; render completion is async. Check the file on disk or use get_render_queue_status to confirm finished output."
          });
        `);
        return sendCommand(script, { ...bridgeOptions, timeoutMs: 120000 }); // 2 min timeout for exports
      },
    },

    export_frame: {
      description: "Export the current frame as an image file",
      parameters: {
        type: "object" as const,
        properties: {
          output_path: {
            type: "string",
            description: "Full output file path (e.g., '/Users/me/frame.png'). Extension determines format.",
          },
          time_seconds: {
            type: "number",
            description: "Time position in seconds to export. Uses current playhead if omitted.",
          },
        },
        required: ["output_path"],
      },
      handler: async (args: { output_path: string; time_seconds?: number }) => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          ${args.time_seconds !== undefined
            ? `seq.setPlayerPosition(__secondsToTicks(${args.time_seconds}).toString());`
            : ""
          }

          var outputPath = "${escapeForExtendScript(args.output_path)}";

          // 25.4 (Bug #57): seq.exportFramePNG removed; try seq.exportFrameJPEG / DOM clip
          // export, fall back to graceful failure with workaround note.
          if (typeof seq.exportFramePNG === "function") {
            try {
              var phStr = seq.getPlayerPosition();
              var phTicks = (phStr && phStr.ticks) ? phStr.ticks : String(phStr);
              seq.exportFramePNG(phTicks, outputPath);
              return __result({ exported: true, outputPath: outputPath, method: "exportFramePNG" });
            } catch(e1) {}
          }
          if (typeof seq.exportFrameJPEG === "function") {
            try {
              var phStr2 = seq.getPlayerPosition();
              var phTicks2 = (phStr2 && phStr2.ticks) ? phStr2.ticks : String(phStr2);
              seq.exportFrameJPEG(phTicks2, outputPath);
              return __result({ exported: true, outputPath: outputPath, method: "exportFrameJPEG" });
            } catch(e2) {}
          }
          return __result({
            exported: false,
            available: false,
            outputPath: outputPath,
            note: "seq.exportFramePNG removed in 25.4. Workaround: use capture_frame tool (returns base64) or File > Export > Media in UI."
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    export_as_fcp_xml: {
      description: "Export the active sequence as a Final Cut Pro XML file",
      parameters: {
        type: "object" as const,
        properties: {
          output_path: {
            type: "string",
            description: "Full output file path (e.g., '/Users/me/export.xml')",
          },
        },
        required: ["output_path"],
      },
      handler: async (args: { output_path: string }) => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          
          seq.exportAsFinalCutProXML("${escapeForExtendScript(args.output_path)}");
          return __result({ exported: true, outputPath: "${escapeForExtendScript(args.output_path)}", format: "FCP XML" });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    export_aaf: {
      description: "Export the active sequence as an AAF file (for Pro Tools, etc.)",
      parameters: {
        type: "object" as const,
        properties: {
          output_path: {
            type: "string",
            description: "Full output file path (e.g., '/Users/me/export.aaf')",
          },
          mix_down_video: {
            type: "boolean",
            description: "Mix down video to single track (default: true)",
          },
          explode_to_mono: {
            type: "boolean",
            description: "Explode multichannel audio to mono (default: false)",
          },
          sample_rate: {
            type: "number",
            description: "Audio sample rate (default: 48000)",
          },
          bits_per_sample: {
            type: "number",
            description: "Audio bit depth (default: 16)",
          },
        },
        required: ["output_path"],
      },
      handler: async (args: {
        output_path: string;
        mix_down_video?: boolean;
        explode_to_mono?: boolean;
        sample_rate?: number;
        bits_per_sample?: number;
      }) => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          if (typeof seq.exportAsAAF !== "function") {
            return __result({
              exported: false,
              available: false,
              note: "seq.exportAsAAF removed in Premiere 25.4 (Bug #57). Workaround: File > Export > AAF in UI."
            });
          }
          try {
            seq.exportAsAAF(
              "${escapeForExtendScript(args.output_path)}",
              ${args.mix_down_video !== false ? 1 : 0},
              ${args.explode_to_mono ? 1 : 0},
              ${args.sample_rate ?? 48000},
              ${args.bits_per_sample ?? 16}
            );
            return __result({ exported: true, outputPath: "${escapeForExtendScript(args.output_path)}", format: "AAF" });
          } catch(e) {
            return __error("Failed to export AAF: " + e.toString());
          }
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    add_to_render_queue: {
      description: "Add the active sequence to the Adobe Media Encoder render queue",
      parameters: {
        type: "object" as const,
        properties: {
          output_path: {
            type: "string",
            description: "Full output file path",
          },
          preset_path: {
            type: "string",
            description: "Path to an AME preset file (.epr)",
          },
        },
        required: ["output_path"],
      },
      handler: async (args: { output_path: string; preset_path?: string }) => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          var encoder = app.encoder;
          if (!encoder) return __error("Adobe Media Encoder not available");

          // Bug #62: encodeSequence in 25.4 requires a real preset path — passing
          // ENCODE_MATCH_SEQUENCE (undefined) yields "Illegal Parameter type". Make
          // preset_path effectively required and pre-validate.
          ${args.preset_path
            ? `var presetPath = "${escapeForExtendScript(args.preset_path)}";
               try {
                 var pf = new File(presetPath);
                 if (!pf.exists) return __error("Encoder preset not found at: " + presetPath);
               } catch(ePresetFile) {
                 return __error("Could not verify preset path: " + presetPath);
               }`
            : `return __error("preset_path is required in Premiere 25.4 — ENCODE_MATCH_SEQUENCE fallback no longer works. Provide an explicit .epr preset file.");`
          }

          encoder.launchEncoder();
          var outputPath = "${escapeForExtendScript(args.output_path)}";
          encoder.encodeSequence(
            seq,
            outputPath,
            presetPath,
            0, // workAreaType
            1  // removeOnCompletion
          );

          return __result({ queued: true, outputPath: outputPath });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_render_queue_status: {
      description: "Get the current status of the Adobe Media Encoder render queue",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          var encoder = app.encoder;
          if (!encoder) return __error("Adobe Media Encoder not available");
          
          return __result({
            isRunning: encoder.isRunning ? encoder.isRunning() : "unknown",
            info: "Check Adobe Media Encoder application for detailed queue status"
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    create_subclip: {
      description: "Create a subclip from a project item with in/out points",
      parameters: {
        type: "object" as const,
        properties: {
          item_id: {
            type: "string",
            description: "Node ID or name of the source project item",
          },
          name: {
            type: "string",
            description: "Name for the subclip",
          },
          in_seconds: {
            type: "number",
            description: "In-point in seconds",
          },
          out_seconds: {
            type: "number",
            description: "Out-point in seconds",
          },
        },
        required: ["item_id", "name", "in_seconds", "out_seconds"],
      },
      handler: async (args: { item_id: string; name: string; in_seconds: number; out_seconds: number }) => {
        const script = buildToolScript(`
          var item = __findProjectItem("${escapeForExtendScript(args.item_id)}");
          if (!item) return __error("Item not found");
          
          var inTicks = __secondsToTicks(${args.in_seconds}).toString();
          var outTicks = __secondsToTicks(${args.out_seconds}).toString();
          
          var subclip = item.createSubClip(
            "${escapeForExtendScript(args.name)}",
            inTicks,
            outTicks,
            0, // hasHardBoundaries
            1, // takeVideo
            1  // takeAudio
          );
          
          if (!subclip) return __error("Failed to create subclip");
          return __result({ created: true, name: "${escapeForExtendScript(args.name)}", source: item.name });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    edit_subclip_boundaries: {
      description:
        "Edit the in/out boundaries of an existing subclip project item. Use this to extend or trim a subclip's working range without recreating it. " +
        "Both in_seconds and out_seconds are optional — only specified ones change. " +
        "Note: in 25.4, soft-boundary subclips (default) can extend beyond original bounds; hard-boundary subclips cannot.",
      parameters: {
        type: "object" as const,
        properties: {
          subclip_id: { type: "string", description: "Node ID or name of the subclip project item" },
          in_seconds: { type: "number", description: "New in-point in seconds (optional)" },
          out_seconds: { type: "number", description: "New out-point in seconds (optional)" },
          media_type: {
            type: "string",
            enum: ["video", "audio", "both"],
            description: "Which stream to modify (default 'both' = mediaType 4)",
          },
        },
        required: ["subclip_id"],
      },
      handler: async (args: { subclip_id: string; in_seconds?: number; out_seconds?: number; media_type?: string }) => {
        const mediaTypeMap: Record<string, number> = { audio: 1, video: 2, both: 4 };
        const mediaType = mediaTypeMap[args.media_type || "both"] ?? 4;
        const script = buildToolScript(`
          var item = __findProjectItem("${escapeForExtendScript(args.subclip_id)}");
          if (!item) return __error("Subclip not found: ${escapeForExtendScript(args.subclip_id)}");

          var changes = {};
          ${args.in_seconds !== undefined ? `
          var inT = new Time(); inT.seconds = ${args.in_seconds};
          item.setInPoint(inT.ticks, ${mediaType});
          changes.in_seconds = ${args.in_seconds};
          ` : ""}
          ${args.out_seconds !== undefined ? `
          var outT = new Time(); outT.seconds = ${args.out_seconds};
          item.setOutPoint(outT.ticks, ${mediaType});
          changes.out_seconds = ${args.out_seconds};
          ` : ""}

          return __result({ subclip: item.name, changes: changes, mediaType: ${mediaType} });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    capture_frame: {
      description: "Capture the current frame and return it as inline image data for the LLM to see. This lets the AI visually inspect the current state of the timeline.",
      parameters: {
        type: "object" as const,
        properties: {
          time_seconds: {
            type: "number",
            description: "Time position in seconds to capture. Uses current playhead if omitted.",
          },
        },
      },
      handler: async (args: { time_seconds?: number }) => {
        const tempPath = join(tmpdir(), `mcp_frame_capture_${Date.now()}.png`);
        const escapedPath = escapeForExtendScript(tempPath);

        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          
          ${args.time_seconds !== undefined
            ? `seq.setPlayerPosition(__secondsToTicks(${args.time_seconds}).toString());`
            : ""
          }
          
          var outputPath = "${escapedPath}";
          seq.exportFramePNG(seq.getPlayerPosition().ticks, outputPath);
          
          return __result({ exported: true, outputPath: outputPath });
        `);

        const result = await sendCommand(script, bridgeOptions);
        if (!result.success) return result;

        // Read the exported PNG and return as base64 image content
        // Wait a moment for the file to be written
        let attempts = 0;
        while (!existsSync(tempPath) && attempts < 20) {
          await new Promise(r => setTimeout(r, 100));
          attempts++;
        }

        if (!existsSync(tempPath)) {
          return { success: false, error: "Frame export completed but file not found at: " + tempPath };
        }

        try {
          const imageData = readFileSync(tempPath);
          const base64 = imageData.toString("base64");
          // Clean up temp file
          try { unlinkSync(tempPath); } catch {}
          return {
            success: true,
            data: {
              captured: true,
              mimeType: "image/png",
              base64: base64,
            },
          };
        } catch (e) {
          return { success: false, error: `Failed to read captured frame: ${e instanceof Error ? e.message : String(e)}` };
        }
      },
    },

    export_omf: {
      description: "Export the active sequence as an OMF file (Open Media Framework, for audio post-production)",
      parameters: {
        type: "object" as const,
        properties: {
          output_path: {
            type: "string",
            description: "Full output file path (e.g., '/Users/me/export.omf')",
          },
          sample_rate: {
            type: "number",
            description: "Audio sample rate (default: 48000)",
          },
          bits_per_sample: {
            type: "number",
            description: "Audio bit depth (default: 16)",
          },
          audio_encapsulated: {
            type: "boolean",
            description: "Embed audio in OMF (true) or reference external files (false). Default: true",
          },
          audio_file_format: {
            type: "number",
            description: "Audio format: 0=AIFF, 1=WAV. Default: 1",
          },
          trim_audio_files: {
            type: "boolean",
            description: "Trim audio to used range plus handles (default: true)",
          },
          handle_frames: {
            type: "number",
            description: "Handle length in frames when trimming (default: 1000)",
          },
        },
        required: ["output_path"],
      },
      handler: async (args: {
        output_path: string;
        sample_rate?: number;
        bits_per_sample?: number;
        audio_encapsulated?: boolean;
        audio_file_format?: number;
        trim_audio_files?: boolean;
        handle_frames?: number;
      }) => {
        if (typeof args.output_path === "string" && args.output_path.length > 0) {
          const outputDir = dirname(args.output_path);
          if (!existsSync(outputDir)) {
            return {
              success: false,
              error: `export_omf: output directory does not exist: ${outputDir}. Create the directory before calling.`,
            };
          }
        }
        const outputPath = args.output_path;
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          app.project.exportOMF(
            seq,
            "${escapeForExtendScript(outputPath)}",
            "OMFTitle",
            ${args.sample_rate ?? 48000},
            ${args.bits_per_sample ?? 16},
            ${args.audio_encapsulated !== false ? 1 : 0},
            ${args.audio_file_format ?? 1},
            ${args.trim_audio_files !== false ? 1 : 0},
            ${args.handle_frames ?? 1000}
          );

          // Verify the OMF actually landed on disk before reporting success.
          // exportOMF is synchronous (unlike AME queue), so the file should exist immediately.
          var outFile = new File("${escapeForExtendScript(outputPath)}");
          if (!outFile.exists) {
            return __error({
              reason: "export_omf: API returned without error but the OMF file was not written to disk. " +
                      "Verify output path is writable and the sequence has audio tracks.",
              _probe: { outputPath: "${escapeForExtendScript(outputPath)}" }
            });
          }

          return __result({ exported: true, outputPath: "${escapeForExtendScript(outputPath)}", format: "OMF" });
        `);
        return sendCommand(script, { ...bridgeOptions, timeoutMs: 120000 });
      },
    },

    encode_project_item: {
      description: "Encode a specific project item (not a sequence) using Adobe Media Encoder",
      parameters: {
        type: "object" as const,
        properties: {
          item_id: {
            type: "string",
            description: "Node ID or name of the project item to encode",
          },
          output_path: {
            type: "string",
            description: "Full output file path",
          },
          preset_path: {
            type: "string",
            description: "Path to an AME preset file (.epr)",
          },
          remove_on_completion: {
            type: "boolean",
            description: "Remove from queue on completion (default: true)",
          },
        },
        required: ["item_id", "output_path", "preset_path"],
      },
      handler: async (args: {
        item_id: string;
        output_path: string;
        preset_path: string;
        remove_on_completion?: boolean;
      }) => {
        const script = buildToolScript(`
          // Bug #69: pre-validate preset path so we don't queue with a bogus preset.
          var presetPath = "${escapeForExtendScript(args.preset_path)}";
          try {
            var pf = new File(presetPath);
            if (!pf.exists) return __error("Encoder preset not found at: " + presetPath);
          } catch(ePresetFile) {
            return __error("Could not verify preset path: " + presetPath);
          }

          var item = __findProjectItem("${escapeForExtendScript(args.item_id)}");
          if (!item) return __error("Project item not found: ${escapeForExtendScript(args.item_id)}");

          app.encoder.launchEncoder();
          app.encoder.encodeProjectItem(
            item,
            "${escapeForExtendScript(args.output_path)}",
            presetPath,
            app.encoder.ENCODE_IN_TO_OUT,
            ${args.remove_on_completion !== false ? 1 : 0}
          );
          app.encoder.startBatch();

          return __result({
            queued: true,
            item: item.name,
            outputPath: "${escapeForExtendScript(args.output_path)}"
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    encode_file: {
      description: "Encode an external file (not in project) using Adobe Media Encoder",
      parameters: {
        type: "object" as const,
        properties: {
          input_path: {
            type: "string",
            description: "Full path to the input file",
          },
          output_path: {
            type: "string",
            description: "Full output file path",
          },
          preset_path: {
            type: "string",
            description: "Path to an AME preset file (.epr)",
          },
          in_seconds: {
            type: "number",
            description: "Optional start time in seconds",
          },
          out_seconds: {
            type: "number",
            description: "Optional end time in seconds",
          },
          remove_on_completion: {
            type: "boolean",
            description: "Remove from queue on completion (default: true)",
          },
        },
        required: ["input_path", "output_path", "preset_path"],
      },
      handler: async (args: {
        input_path: string;
        output_path: string;
        preset_path: string;
        in_seconds?: number;
        out_seconds?: number;
        remove_on_completion?: boolean;
      }) => {
        const inPointCode = args.in_seconds !== undefined
          ? `var srcIn = new Time(); srcIn.seconds = ${args.in_seconds};`
          : `var srcIn = undefined;`;
        const outPointCode = args.out_seconds !== undefined
          ? `var srcOut = new Time(); srcOut.seconds = ${args.out_seconds};`
          : `var srcOut = undefined;`;

        const script = buildToolScript(`
          // Bug #68: pre-validate input and preset paths.
          var inputPath = "${escapeForExtendScript(args.input_path)}";
          var presetPath = "${escapeForExtendScript(args.preset_path)}";
          try {
            var inFile = new File(inputPath);
            if (!inFile.exists) return __error("Input file not found at: " + inputPath);
            var pFile = new File(presetPath);
            if (!pFile.exists) return __error("Encoder preset not found at: " + presetPath);
          } catch(eFile) {
            return __error("Could not verify input/preset paths: " + eFile.toString());
          }

          app.encoder.launchEncoder();

          ${inPointCode}
          ${outPointCode}

          app.encoder.encodeFile(
            inputPath,
            "${escapeForExtendScript(args.output_path)}",
            presetPath,
            ${args.remove_on_completion !== false ? 1 : 0},
            srcIn,
            srcOut
          );
          app.encoder.startBatch();

          return __result({
            queued: true,
            inputPath: inputPath,
            outputPath: "${escapeForExtendScript(args.output_path)}"
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    manage_proxies: {
      description: "Create or attach proxies for a project item",
      parameters: {
        type: "object" as const,
        properties: {
          item_id: {
            type: "string",
            description: "Node ID or name of the project item",
          },
          action: {
            type: "string",
            enum: ["create", "attach", "toggle"],
            description: "Action to perform on proxies",
          },
          proxy_path: {
            type: "string",
            description: "Path to proxy file (required for 'attach' action)",
          },
        },
        required: ["item_id", "action"],
      },
      handler: async (args: { item_id: string; action: string; proxy_path?: string }) => {
        const script = buildToolScript(`
          var item = __findProjectItem("${escapeForExtendScript(args.item_id)}");
          if (!item) return __error("Item not found");

          var action = "${args.action}";

          if (action === "create") {
            if (typeof item.createProxy !== "function") {
              return __result({ action: "create", available: false, note: "item.createProxy removed in 25.4. Workaround: use Project Manager UI > Create Proxies." });
            }
            item.createProxy("", 0);
            return __result({ action: "create", item: item.name, status: "Proxy creation started" });
          } else if (action === "attach") {
            ${args.proxy_path
              ? `if (typeof item.attachProxy !== "function") {
                   return __result({ action: "attach", available: false, note: "item.attachProxy removed in 25.4." });
                 }
                 item.attachProxy("${escapeForExtendScript(args.proxy_path)}", 0);
                 return __result({ action: "attach", item: item.name, proxyPath: "${escapeForExtendScript(args.proxy_path)}" });`
              : `return __error("proxy_path is required for attach action");`
            }
          } else if (action === "toggle") {
            // 25.4 (Bug #63): app.project.setProxyEnabled removed.
            if (typeof app.project.setProxyEnabled !== "function" || typeof app.project.isProxyEnabled !== "function") {
              return __result({
                action: "toggle",
                available: false,
                note: "app.project.setProxyEnabled / isProxyEnabled removed in 25.4. Workaround: toggle proxies via Project menu in UI."
              });
            }
            app.project.setProxyEnabled(!app.project.isProxyEnabled());
            return __result({ action: "toggle", proxiesEnabled: app.project.isProxyEnabled() });
          }

          return __error("Unknown proxy action: " + action);
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    export_edl: {
      description:
        "Export the active sequence as an EDL (Edit Decision List) — industry standard for color grading, online conform, and broadcast workflows.",
      parameters: {
        type: "object" as const,
        properties: {
          output_path: {
            type: "string",
            description: "Absolute output path for the EDL file (e.g., /path/to/sequence.edl)",
          },
          track_index: {
            type: "number",
            description:
              "Optional video track index to export (default: 0 = V1). EDL traditionally exports a single video track.",
          },
        },
        required: ["output_path"],
      },
      handler: async (args: { output_path: string; track_index?: number }) => {
        const trackIndex = args.track_index ?? 0;
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          // 25.4 (Bug #57): seq.exportAsEDL removed.
          if (typeof seq.exportAsEDL !== "function") {
            return __result({
              exported: false,
              available: false,
              note: "seq.exportAsEDL removed in Premiere 25.4. Workaround: use File > Export > EDL menu in UI."
            });
          }
          try {
            seq.exportAsEDL("${escapeForExtendScript(args.output_path)}", ${trackIndex});
            return __result({ exported: true, outputPath: "${escapeForExtendScript(args.output_path)}", trackIndex: ${trackIndex} });
          } catch (ex) {
            return __error("Failed to export EDL: " + ex.toString());
          }
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    render_sequence_preview: {
      description:
        "Render preview files for the active sequence (in/out range or whole sequence). Equivalent to pressing Enter in Premiere — generates green-bar previews so playback is realtime.",
      parameters: {
        type: "object" as const,
        properties: {
          start_seconds: {
            type: "number",
            description:
              "Optional start time in seconds (sets in-point). Omit to render entire sequence.",
          },
          end_seconds: {
            type: "number",
            description: "Optional end time in seconds (sets out-point)",
          },
        },
      },
      handler: async (args: { start_seconds?: number; end_seconds?: number }) => {
        const setRange =
          args.start_seconds !== undefined && args.end_seconds !== undefined;
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          ${
            setRange
              ? `seq.setInPoint(${args.start_seconds});\n          seq.setOutPoint(${args.end_seconds});`
              : ""
          }
          try {
            seq.renderPreview ? seq.renderPreview() : seq.renderSelection(true);
            return __result({ rendered: true });
          } catch (ex) {
            try {
              seq.renderSelection(true);
              return __result({ rendered: true, fallback: "renderSelection" });
            } catch (ex2) {
              return __error("Render preview failed: " + ex.toString());
            }
          }
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    export_direct: {
      description:
        "Export the active sequence directly without going through Adobe Media Encoder (synchronous, blocking). Faster for one-off exports but doesn't queue.",
      parameters: {
        type: "object" as const,
        properties: {
          output_path: {
            type: "string",
            description: "Absolute output path for the exported file",
          },
          preset_path: {
            type: "string",
            description: "Absolute path to an .epr export preset file",
          },
        },
        required: ["output_path", "preset_path"],
      },
      handler: async (args: { output_path: string; preset_path: string }) => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          try {
            seq.exportAsMediaDirect(
              "${escapeForExtendScript(args.output_path)}",
              "${escapeForExtendScript(args.preset_path)}",
              app.encoder.ENCODE_ENTIRE
            );
            return __result({ exported: true, outputPath: "${escapeForExtendScript(args.output_path)}" });
          } catch (ex) {
            return __error("Direct export failed: " + ex.toString());
          }
        `);
        return sendCommand(script, bridgeOptions);
      },
    },
  };
}
