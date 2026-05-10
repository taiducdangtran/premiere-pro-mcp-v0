import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";

export function getCaptionTools(bridgeOptions: BridgeOptions) {
  return {
    create_caption_track: {
      description:
        "Create a caption/subtitle track in the active sequence from an imported caption file (e.g., .srt, .vtt)",
      parameters: {
        type: "object" as const,
        properties: {
          item_id: {
            type: "string",
            description:
              "Node ID or name of the imported caption project item (e.g., an .srt file)",
          },
          start_seconds: {
            type: "number",
            description:
              "Offset in seconds from the start of the sequence (default: 0)",
          },
          caption_format: {
            type: "string",
            description:
              "Caption format: 'subtitle' (default), '608', '708', 'teletext', 'ebu', 'op42', 'op47'",
          },
        },
        required: ["item_id"],
      },
      handler: async (args: {
        item_id: string;
        start_seconds?: number;
        caption_format?: string;
      }) => {
        const startSeconds = args.start_seconds ?? 0;
        const formatMap: Record<string, string> = {
          subtitle: "Sequence.CAPTION_FORMAT_SUBTITLE",
          "608": "Sequence.CAPTION_FORMAT_608",
          "708": "Sequence.CAPTION_FORMAT_708",
          teletext: "Sequence.CAPTION_FORMAT_TELETEXT",
          ebu: "Sequence.CAPTION_FORMAT_OPEN_EBU",
          op42: "Sequence.CAPTION_FORMAT_OP42",
          op47: "Sequence.CAPTION_FORMAT_OP47",
        };
        const format =
          formatMap[args.caption_format || "subtitle"] ||
          "Sequence.CAPTION_FORMAT_SUBTITLE";

        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          var item = __findProjectItem("${escapeForExtendScript(args.item_id)}");
          if (!item) return __error("Caption item not found: ${escapeForExtendScript(args.item_id)}");

          var result = seq.createCaptionTrack(item, ${startSeconds}, ${format});
          if (!result) return __error("Failed to create caption track");
          return __result({ created: true, item: item.name, startSeconds: ${startSeconds}, format: "${args.caption_format || "subtitle"}" });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_caption_tracks: {
      description:
        "List all caption tracks in the active sequence with their indices, names, and caption counts",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          var tracks = [];
          try {
            for (var i = 0; i < seq.captionTracks.numTracks; i++) {
              var track = seq.captionTracks[i];
              tracks.push({
                index: i,
                name: track.name,
                numCaptions: track.clips ? track.clips.numItems : 0
              });
            }
          } catch (ex) {
            return __result({ note: "Caption tracks API not available in this Premiere Pro version.", tracks: [] });
          }
          return __result({ tracks: tracks });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_captions: {
      description:
        "Get all captions on a specific caption track (text, start/end times)",
      parameters: {
        type: "object" as const,
        properties: {
          track_index: {
            type: "number",
            description: "Index of the caption track (0-based)",
          },
        },
        required: ["track_index"],
      },
      handler: async (args: { track_index: number }) => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          try {
            var captionTrack = seq.captionTracks[${args.track_index}];
            if (!captionTrack) return __error("Caption track not found at index: ${args.track_index}");

            var captions = [];
            if (captionTrack.clips) {
              for (var i = 0; i < captionTrack.clips.numItems; i++) {
                var clip = captionTrack.clips[i];
                captions.push({
                  index: i,
                  text: clip.name || "",
                  startSeconds: __ticksToSeconds(clip.start.ticks),
                  endSeconds: __ticksToSeconds(clip.end.ticks)
                });
              }
            }
            return __result({ captions: captions, count: captions.length });
          } catch (ex) {
            return __error("Failed to get captions: " + ex.toString());
          }
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    add_caption: {
      description:
        "Add a single caption (text + start/end time) to a caption track",
      parameters: {
        type: "object" as const,
        properties: {
          track_index: {
            type: "number",
            description: "Index of the caption track (0-based)",
          },
          text: { type: "string", description: "Caption text content" },
          start_seconds: { type: "number", description: "Start time in seconds" },
          end_seconds: { type: "number", description: "End time in seconds" },
        },
        required: ["track_index", "text", "start_seconds", "end_seconds"],
      },
      handler: async (args: {
        track_index: number;
        text: string;
        start_seconds: number;
        end_seconds: number;
      }) => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          try {
            var captionTrack = seq.captionTracks[${args.track_index}];
            if (!captionTrack) return __error("Caption track not found at index: ${args.track_index}");
            captionTrack.addCaption(${args.start_seconds}, ${args.end_seconds}, "${escapeForExtendScript(args.text)}");
            return __result({ added: true, text: "${escapeForExtendScript(args.text)}" });
          } catch (ex) {
            return __error("Failed to add caption: " + ex.toString());
          }
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    update_caption: {
      description:
        "Update an existing caption's text and/or start/end times",
      parameters: {
        type: "object" as const,
        properties: {
          track_index: { type: "number", description: "Caption track index" },
          caption_index: { type: "number", description: "Caption index on the track" },
          text: { type: "string", description: "New caption text (optional)" },
          start_seconds: { type: "number", description: "New start time in seconds (optional)" },
          end_seconds: { type: "number", description: "New end time in seconds (optional)" },
        },
        required: ["track_index", "caption_index"],
      },
      handler: async (args: {
        track_index: number;
        caption_index: number;
        text?: string;
        start_seconds?: number;
        end_seconds?: number;
      }) => {
        const text = args.text !== undefined ? `"${escapeForExtendScript(args.text)}"` : "null";
        const startSec = args.start_seconds !== undefined ? args.start_seconds : -1;
        const endSec = args.end_seconds !== undefined ? args.end_seconds : -1;
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          try {
            var captionTrack = seq.captionTracks[${args.track_index}];
            if (!captionTrack) return __error("Caption track not found");
            var clip = captionTrack.clips[${args.caption_index}];
            if (!clip) return __error("Caption not found at index: ${args.caption_index}");

            var newText = ${text};
            if (newText !== null) clip.name = newText;
            if (${startSec} >= 0) {
              clip.start = { ticks: __secondsToTicks(${startSec}).toString(), seconds: ${startSec} };
            }
            if (${endSec} >= 0) {
              clip.end = { ticks: __secondsToTicks(${endSec}).toString(), seconds: ${endSec} };
            }
            return __result({ updated: true });
          } catch (ex) {
            return __error("Failed to update caption: " + ex.toString());
          }
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    remove_caption: {
      description: "Remove a caption from a caption track",
      parameters: {
        type: "object" as const,
        properties: {
          track_index: { type: "number", description: "Caption track index" },
          caption_index: { type: "number", description: "Caption index to remove" },
        },
        required: ["track_index", "caption_index"],
      },
      handler: async (args: { track_index: number; caption_index: number }) => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          try {
            var captionTrack = seq.captionTracks[${args.track_index}];
            if (!captionTrack) return __error("Caption track not found");
            var clip = captionTrack.clips[${args.caption_index}];
            if (!clip) return __error("Caption not found");
            clip.remove(false, false);
            return __result({ removed: true });
          } catch (ex) {
            return __error("Failed to remove caption: " + ex.toString());
          }
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    import_captions: {
      description:
        "Import a caption/subtitle file (.srt, .vtt, .scc) into the active sequence",
      parameters: {
        type: "object" as const,
        properties: {
          file_path: {
            type: "string",
            description: "Absolute path to the caption file",
          },
        },
        required: ["file_path"],
      },
      handler: async (args: { file_path: string }) => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          try {
            seq.importCaptionFile("${escapeForExtendScript(args.file_path)}");
            return __result({ imported: true, filePath: "${escapeForExtendScript(args.file_path)}" });
          } catch (ex) {
            try {
              app.project.importFiles(["${escapeForExtendScript(args.file_path)}"], false, app.project.rootItem, false);
              return __result({ imported: true, filePath: "${escapeForExtendScript(args.file_path)}", note: "Imported as media (not directly into caption track)" });
            } catch (ex2) {
              return __error("Failed to import captions: " + ex.toString());
            }
          }
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    export_captions: {
      description:
        "Export captions from the active sequence to a caption file (.srt, .vtt, .scc, etc.)",
      parameters: {
        type: "object" as const,
        properties: {
          output_path: {
            type: "string",
            description: "Absolute output path for the caption file",
          },
        },
        required: ["output_path"],
      },
      handler: async (args: { output_path: string }) => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          try {
            seq.exportCaptionFile("${escapeForExtendScript(args.output_path)}");
            return __result({ exported: true, outputPath: "${escapeForExtendScript(args.output_path)}" });
          } catch (ex) {
            return __error("Failed to export captions: " + ex.toString());
          }
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    transcribe_sequence: {
      description:
        "Start automatic speech-to-text transcription on the active sequence (Premiere generates captions). Progress is shown in Premiere Pro UI.",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          try {
            seq.transcribe();
            return __result({ started: true, note: "Transcription started. Check Premiere Pro for progress." });
          } catch (ex) {
            return __error("Transcription not available: " + ex.toString());
          }
        `);
        return sendCommand(script, bridgeOptions);
      },
    },
  };
}
