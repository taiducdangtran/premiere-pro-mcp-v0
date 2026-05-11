import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";

export function getTextTools(bridgeOptions: BridgeOptions) {
  return {
    add_text_overlay: {
      description:
        "Add a text overlay (title graphic) to the active sequence. NOTE: Adobe removed the legacy Title Designer in Premiere 2024+ and provides NO direct DOM API to create a text graphic (confirmed by Adobe community manager Bruce Bullis). The only programmatic path is via Motion Graphics Templates (.mogrt). This tool probes for hypothetical title APIs and, if none exist, returns clear instructions to use the MOGRT workflow: `import_mogrt` (or `import_mogrt_from_library`) + `set_mogrt_property` to edit the text. Use `add_caption` if you actually want subtitles instead.",
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
          var textContent = "${escapeForExtendScript(args.text)}";
          var w = seq.frameSizeHorizontal;
          var h = seq.frameSizeVertical;
          var attempts = [];

          // Probe hypothetical DOM-level title creation paths. None are documented for
          // Premiere 25.4 — but if Adobe quietly adds one in a future point release, we
          // pick it up automatically. We do NOT call qe.project.newTitle: same trap as
          // qe.project.newColorMatte (Bug #37) — would open Title Designer modal.
          try {
            if (typeof app.project.createSupportItem === "function") {
              var item1 = app.project.createSupportItem("title", textContent);
              if (item1) {
                var startTicks = __secondsToTicks(${startSeconds}).toString();
                seq.overwriteClip(item1, startTicks, trackIndex, -1);
                return __result({ added: true, method: "dom:createSupportItem", text: textContent });
              }
            } else {
              attempts.push("project.createSupportItem: not available");
            }
          } catch(e1) { attempts.push("project.createSupportItem: " + e1.toString()); }

          try {
            var root = app.project.rootItem;
            if (root && typeof root.createTitle === "function") {
              var item2 = root.createTitle(textContent, w, h);
              if (item2) {
                var startTicks2 = __secondsToTicks(${startSeconds}).toString();
                seq.overwriteClip(item2, startTicks2, trackIndex, -1);
                return __result({ added: true, method: "dom:rootItem.createTitle", text: textContent });
              }
            } else {
              attempts.push("rootItem.createTitle: not available");
            }
          } catch(e2) { attempts.push("rootItem.createTitle: " + e2.toString()); }

          // No working DOM path. Refuse to invoke qe.project.newTitle (would spawn
          // Legacy Title Designer dialog and block bridge — same trap as #37).
          // Previous v1.2.1 implementation called createCaptionTrack which created a
          // subtitle track (wrong feature entirely) — that has been removed.
          return __error(
            "add_text_overlay: Adobe removed the legacy Title Designer in Premiere 2024+ " +
            "and provides no DOM API to create a text graphic. " +
            "Workarounds: " +
            "(1) Author a text .mogrt in After Effects, then use import_mogrt(mogrt_path, ...) " +
            "+ set_mogrt_property(track_index, clip_index, 'Source Text', '" + textContent + "'); " +
            "(2) import_mogrt_from_library(mogrt_name, ...) if you have a text MOGRT in your " +
            "Adobe Library; " +
            "(3) add_caption(...) if you wanted subtitles, not a text overlay graphic; " +
            "(4) create the title manually in Premiere then continue automating. " +
            "Probe results: " + attempts.join("; ")
          );
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

          // Bug #67: detect non-MOGRT clip up front and report clearly instead of falling
          // through to a generic "Property not found".
          var isMGT = false;
          var mgt = null;
          try {
            if (typeof clip.getMGTComponent === "function") {
              mgt = clip.getMGTComponent();
              isMGT = !!mgt;
            }
          } catch (exM) {}

          if (isMGT) {
            for (var i = 0; i < mgt.properties.numItems; i++) {
              if (mgt.properties[i].displayName === propertyName) {
                try { mgt.properties[i].setValue(newValue, true); }
                catch(eSv) { return __error("MGT property '" + propertyName + "' setValue failed: " + eSv.toString()); }
                return __result({ property: propertyName, set: true, viaMGT: true });
              }
            }
            // MOGRT clip but the named property isn't in its MGT component — probe sibling props.
            var availMGT = [];
            for (var k = 0; k < mgt.properties.numItems; k++) availMGT.push(mgt.properties[k].displayName);
            return __error(
              "set_mogrt_property: MOGRT clip found but property '" + propertyName + "' not exposed. " +
              "Available MGT properties: " + availMGT.join(" | ")
            );
          }

          // Not a MOGRT clip — refuse with a clear redirect. Previously this fell through
          // to a regular-component scan that succeeded by accident and confused callers.
          var compNames = [];
          for (var c2 = 0; c2 < clip.components.numItems; c2++) compNames.push(clip.components[c2].displayName);
          return __error(
            "set_mogrt_property: clip '" + clip.name + "' is NOT a MOGRT (no MGT component). " +
            "set_mogrt_property is for Motion Graphics Template clips only. " +
            "For regular effects use set_effect_property(node_id, effect_name='" +
            (compNames[0] || "Motion") + "', property_name='" + propertyName + "', ...). " +
            "Clip components: " + compNames.join(" | ")
          );
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
