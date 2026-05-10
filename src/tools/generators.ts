import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";

export function getGeneratorTools(bridgeOptions: BridgeOptions) {
  return {
    add_black_video: {
      description:
        "Create a black video clip in the project panel (matches active sequence resolution). Uses QE DOM. After creation, use add_to_timeline to place it.",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          app.enableQE();
          try {
            qe.project.newBlackVideo(
              seq.frameSizeHorizontal,
              seq.frameSizeVertical
            );
            return __result({ created: true, note: "Black video created in project panel. Use add_to_timeline to place it." });
          } catch (ex) {
            return __error("Failed to create black video: " + ex.toString());
          }
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    add_color_matte: {
      description:
        "Create a color matte (solid color) clip in the project panel. Uses QE DOM.",
      parameters: {
        type: "object" as const,
        properties: {
          color_hex: {
            type: "string",
            description: "Hex color code (e.g., '#FF0000' for red)",
          },
          name: {
            type: "string",
            description: "Name for the color matte (default: 'Color Matte')",
          },
        },
        required: ["color_hex"],
      },
      handler: async (args: { color_hex: string; name?: string }) => {
        const name = args.name || "Color Matte";
        const hex = args.color_hex.replace("#", "");
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          app.enableQE();
          try {
            qe.project.newColorMatte(
              seq.frameSizeHorizontal,
              seq.frameSizeVertical,
              ${r}, ${g}, ${b},
              "${escapeForExtendScript(name)}"
            );
            return __result({ created: true, name: "${escapeForExtendScript(name)}", color: "#${hex}", note: "Color matte created in project panel. Use add_to_timeline to place it." });
          } catch (ex) {
            return __error("Failed to create color matte: " + ex.toString());
          }
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    add_universal_counting_leader: {
      description:
        "Create a Universal Counting Leader (8-second SMPTE countdown) in the project panel. Uses QE DOM.",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          app.enableQE();
          try {
            qe.project.newUniversalCountingLeader(
              seq.frameSizeHorizontal,
              seq.frameSizeVertical
            );
            return __result({ created: true, note: "Universal counting leader created in project panel. Use add_to_timeline to place it." });
          } catch (ex) {
            return __error("Failed to create counting leader: " + ex.toString());
          }
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

  };
}
