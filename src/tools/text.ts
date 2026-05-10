import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";

export function getTextTools(bridgeOptions: BridgeOptions) {
  return {
    add_text_overlay: {
      description: "Add a text overlay (title) to the active sequence",
      parameters: {
        type: "object" as const,
        properties: {
          text: {
            type: "string",
            description: "Text content to display",
          },
          track_index: {
            type: "number",
            description: "Video track index to place the text on (default: topmost track)",
          },
          start_seconds: {
            type: "number",
            description: "Start time in seconds (default: 0)",
          },
          duration_seconds: {
            type: "number",
            description: "Duration in seconds (default: 5)",
          },
          font_size: {
            type: "number",
            description: "Font size (default: 60)",
          },
        },
        required: ["text"],
      },
      handler: async (args: {
        text: string;
        track_index?: number;
        start_seconds?: number;
        duration_seconds?: number;
        font_size?: number;
      }) => {
        const startSeconds = args.start_seconds ?? 0;
        const durationSeconds = args.duration_seconds ?? 5;

        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          
          var trackIndex = ${args.track_index !== undefined ? args.track_index : "seq.videoTracks.numTracks - 1"};
          
          // Create a graphics clip using the captions API approach
          var project = app.project;
          
          // Use QE DOM to insert text
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          
          // Add a caption track if needed, then add text
          // Note: Direct text creation requires MOGRT or Graphics workspace
          // For basic text, we use the Graphics approach
          var startTicks = __secondsToTicks(${startSeconds}).toString();
          var endTicks = __secondsToTicks(${startSeconds + durationSeconds}).toString();
          
          // Create text via project item
          var textContent = "${escapeForExtendScript(args.text)}";
          project.activeSequence.createCaptionTrack(textContent, startTicks, "Subtitle");
          
          return __result({
            added: true,
            text: textContent,
            trackIndex: trackIndex,
            startSeconds: ${startSeconds},
            durationSeconds: ${durationSeconds}
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    import_mogrt: {
      description: "Import a Motion Graphics Template (.mogrt) file and add it to the timeline",
      parameters: {
        type: "object" as const,
        properties: {
          mogrt_path: {
            type: "string",
            description: "Full path to the .mogrt file",
          },
          track_index: {
            type: "number",
            description: "Video track index (default: 0)",
          },
          start_seconds: {
            type: "number",
            description: "Start time in seconds (default: 0)",
          },
          duration_seconds: {
            type: "number",
            description: "Duration in seconds (default: 5)",
          },
        },
        required: ["mogrt_path"],
      },
      handler: async (args: {
        mogrt_path: string;
        track_index?: number;
        start_seconds?: number;
        duration_seconds?: number;
      }) => {
        const trackIndex = args.track_index ?? 0;
        const startSeconds = args.start_seconds ?? 0;
        const durationSeconds = args.duration_seconds ?? 5;

        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          
          var mogrtPath = "${escapeForExtendScript(args.mogrt_path)}";
          var startTicks = __secondsToTicks(${startSeconds}).toString();
          var durationTicks = __secondsToTicks(${durationSeconds}).toString();
          
          var success = seq.importMGT(
            mogrtPath,
            startTicks,
            ${trackIndex},
            ${trackIndex}  // audio track index
          );
          
          if (!success) return __error("Failed to import MOGRT");
          
          return __result({
            imported: true,
            mogrtPath: mogrtPath,
            trackIndex: ${trackIndex},
            startSeconds: ${startSeconds},
            durationSeconds: ${durationSeconds}
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    import_mogrt_from_library: {
      description: "Import a MOGRT from an Adobe Library by name",
      parameters: {
        type: "object" as const,
        properties: {
          mogrt_name: {
            type: "string",
            description: "Name of the MOGRT in the library",
          },
          track_index: {
            type: "number",
            description: "Video track index (default: 0)",
          },
          start_seconds: {
            type: "number",
            description: "Start time in seconds (default: 0)",
          },
        },
        required: ["mogrt_name"],
      },
      handler: async (args: { mogrt_name: string; track_index?: number; start_seconds?: number }) => {
        const trackIndex = args.track_index ?? 0;
        const startSeconds = args.start_seconds ?? 0;

        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          
          var mogrtName = "${escapeForExtendScript(args.mogrt_name)}";
          var startTicks = __secondsToTicks(${startSeconds}).toString();
          
          var success = seq.importMGTFromLibrary(mogrtName, startTicks, ${trackIndex}, ${trackIndex});
          if (!success) return __error("Failed to import MOGRT from library: " + mogrtName);

          return __result({ imported: true, mogrtName: mogrtName, trackIndex: ${trackIndex} });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_mogrt_properties: {
      description:
        "List all editable properties of a MOGRT (Motion Graphics Template) clip on the timeline",
      parameters: {
        type: "object" as const,
        properties: {
          track_index: { type: "number", description: "Video track index (0-based)" },
          clip_index: { type: "number", description: "Clip index on the track" },
        },
        required: ["track_index", "clip_index"],
      },
      handler: async (args: { track_index: number; clip_index: number }) => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          if (${args.track_index} >= seq.videoTracks.numTracks) return __error("Track index out of range");
          var track = seq.videoTracks[${args.track_index}];
          if (${args.clip_index} >= track.clips.numItems) return __error("Clip index out of range");
          var clip = track.clips[${args.clip_index}];

          var props = [];
          var mgtFound = false;
          try {
            var mgt = clip.getMGTComponent();
            if (mgt) {
              mgtFound = true;
              for (var i = 0; i < mgt.properties.numItems; i++) {
                var prop = mgt.properties[i];
                var info = { index: i, displayName: prop.displayName };
                try { info.value = prop.getValue(); } catch (ex) {}
                props.push(info);
              }
            }
          } catch (ex) {}

          if (!mgtFound) {
            for (var i = 0; i < clip.components.numItems; i++) {
              var comp = clip.components[i];
              for (var j = 0; j < comp.properties.numItems; j++) {
                var info = {
                  componentIndex: i,
                  componentName: comp.displayName,
                  propertyIndex: j,
                  displayName: comp.properties[j].displayName
                };
                try { info.value = comp.properties[j].getValue(); } catch (ex) {}
                props.push(info);
              }
            }
          }
          return __result({ properties: props, mgtComponent: mgtFound });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_mogrt_property: {
      description:
        "Set a MOGRT (Motion Graphics Template) property value by display name on a timeline clip",
      parameters: {
        type: "object" as const,
        properties: {
          track_index: { type: "number", description: "Video track index" },
          clip_index: { type: "number", description: "Clip index on the track" },
          property_name: {
            type: "string",
            description: "Display name of the property to set (e.g., 'Source Text', 'Position', 'Color')",
          },
          value: {
            description:
              "Value to set. Strings for text, numbers for numeric, [x,y] for positions, [r,g,b] for colors",
          },
        },
        required: ["track_index", "clip_index", "property_name", "value"],
      },
      handler: async (args: {
        track_index: number;
        clip_index: number;
        property_name: string;
        value: any;
      }) => {
        const valueLiteral = JSON.stringify(args.value);
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          if (${args.track_index} >= seq.videoTracks.numTracks) return __error("Track index out of range");
          var track = seq.videoTracks[${args.track_index}];
          if (${args.clip_index} >= track.clips.numItems) return __error("Clip index out of range");
          var clip = track.clips[${args.clip_index}];

          var newValue = ${valueLiteral};
          var propertyName = "${escapeForExtendScript(args.property_name)}";

          try {
            var mgt = clip.getMGTComponent();
            if (mgt) {
              for (var i = 0; i < mgt.properties.numItems; i++) {
                if (mgt.properties[i].displayName === propertyName) {
                  mgt.properties[i].setValue(newValue, true);
                  return __result({ property: propertyName, set: true, viaMGT: true });
                }
              }
            }
          } catch (ex) {}

          for (var i = 0; i < clip.components.numItems; i++) {
            for (var j = 0; j < clip.components[i].properties.numItems; j++) {
              if (clip.components[i].properties[j].displayName === propertyName) {
                clip.components[i].properties[j].setValue(newValue, true);
                return __result({ property: propertyName, set: true, componentIndex: i });
              }
            }
          }
          return __error("Property not found: " + propertyName);
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_available_mogrts: {
      description:
        "Get a list of MOGRT (Motion Graphics Template) project items currently imported into the project",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          var items = [];
          function walk(rootItem) {
            for (var i = 0; i < rootItem.children.numItems; i++) {
              var item = rootItem.children[i];
              if (item.type === 2) {
                walk(item);
              } else {
                var name = item.name || "";
                var path = "";
                try { path = item.getMediaPath ? item.getMediaPath() : ""; } catch (ex) {}
                if (path.toLowerCase().indexOf(".mogrt") >= 0 || name.toLowerCase().indexOf(".mogrt") >= 0) {
                  items.push({ name: name, nodeId: item.nodeId, path: path });
                }
              }
            }
          }
          walk(app.project.rootItem);
          return __result({ mogrts: items, count: items.length });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },
  };
}
