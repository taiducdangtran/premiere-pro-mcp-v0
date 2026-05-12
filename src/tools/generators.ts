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
          // Bug #96 sibling audit (v1.2.20): same QE family as newUniversalCountingLeader.
          // 2-arg may hit "Not Enough Parameters" in 25.4; probe wider signatures.
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          app.enableQE();
          var w = seq.frameSizeHorizontal;
          var h = seq.frameSizeVertical;
          var par = (seq.getSettings && seq.getSettings().videoPixelAspectRatio) || 1.0;
          var timebase = String(seq.timebase || "254016000000");
          var fields = 0;
          var sampleRate = 48000;
          var channelType = 1;
          var fnLength = (typeof qe.project.newBlackVideo === "function") ? qe.project.newBlackVideo.length : null;
          var attempts = [];

          function trySig(label, fn) {
            try { fn(); attempts.push(label + ": OK"); return label; }
            catch(e) { attempts.push(label + ": " + e.toString()); return null; }
          }

          var sig = null;
          if (!sig) sig = trySig("2-arg(w,h)", function() {
            qe.project.newBlackVideo(w, h);
          });
          if (!sig) sig = trySig("4-arg(w,h,par,timebase)", function() {
            qe.project.newBlackVideo(w, h, par, timebase);
          });
          if (!sig) sig = trySig("7-arg(w,h,par,timebase,fields,rate,chan)", function() {
            qe.project.newBlackVideo(w, h, par, timebase, fields, sampleRate, channelType);
          });

          if (!sig) {
            return __error({
              reason: "add_black_video: every known newBlackVideo signature was rejected by Premiere 25.4 QE.",
              fnLength: fnLength,
              attempts: attempts
            });
          }
          return __result({
            created: true,
            signature: sig,
            fnLength: fnLength,
            note: "Black video created in project panel. Use add_to_timeline to place it."
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    add_color_matte: {
      description:
        "Create a color matte (solid color) clip in the project panel. NOTE: In Premiere 25.4 the QE path `qe.project.newColorMatte` spawns a Color Picker dialog that blocks the bridge engine — Bug #37 retest. This tool now probes DOM-level alternatives and refuses to invoke the QE path; if no DOM API exists it returns an error with workarounds (use `add_black_video` + Lumetri color override, or `add_adjustment_layer` + Color effect).",
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
          var w = seq.frameSizeHorizontal;
          var h = seq.frameSizeVertical;
          var name = "${escapeForExtendScript(name)}";
          var rgb = [${r}, ${g}, ${b}];

          // Probe DOM-level paths in order of preference. None of these are documented
          // for 25.4 — they may not exist. If they do, we avoid the QE Color Picker.
          var root = app.project.rootItem;
          var attempts = [];

          // Attempt 1: ProjectItem.createColorMatte(w, h, [r,g,b], name) — hypothetical DOM
          try {
            if (root && typeof root.createColorMatte === "function") {
              var item1 = root.createColorMatte(w, h, rgb, name);
              if (item1) return __result({ created: true, name: name, color: "#${hex}", method: "dom:rootItem.createColorMatte" });
            } else {
              attempts.push("rootItem.createColorMatte: not available");
            }
          } catch(e1) { attempts.push("rootItem.createColorMatte: " + e1.toString()); }

          // Attempt 2: app.project.createColorMatte — hypothetical
          try {
            if (typeof app.project.createColorMatte === "function") {
              var item2 = app.project.createColorMatte(w, h, rgb, name);
              if (item2) return __result({ created: true, name: name, color: "#${hex}", method: "dom:project.createColorMatte" });
            } else {
              attempts.push("project.createColorMatte: not available");
            }
          } catch(e2) { attempts.push("project.createColorMatte: " + e2.toString()); }

          // We deliberately DO NOT call qe.project.newColorMatte: in Premiere 25.4 it
          // spawns a native Color Picker that blocks the entire bridge engine until
          // dismissed manually (Bug #37 retest). userInteractionLevel doesn't suppress
          // it. See notebug.md.
          return __error(
            "add_color_matte: no working DOM-level API in Premiere 25.4. The QE path " +
            "(qe.project.newColorMatte) is disabled because it spawns a Color Picker " +
            "dialog that blocks the bridge until manually dismissed. " +
            "Workarounds: (1) add_black_video then apply Lumetri color tint; " +
            "(2) add_adjustment_layer then apply_4color_gradient or apply_ramp; " +
            "(3) create the matte manually in Premiere then continue automating. " +
            "Probe results: " + attempts.join("; ")
          );
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
          // Bug #96 fix (v1.2.20): QE rejects 2-arg with "Not Enough Parameters" in 25.4.
          // Probe 7-arg → 4-arg → 2-arg; surface attempts so tester can pin the live signature.
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          app.enableQE();
          var w = seq.frameSizeHorizontal;
          var h = seq.frameSizeVertical;
          var par = (seq.getSettings && seq.getSettings().videoPixelAspectRatio) || 1.0;
          var timebase = String(seq.timebase || "254016000000");
          var fields = 0;
          var sampleRate = 48000;
          var channelType = 1;
          var fnLength = (typeof qe.project.newUniversalCountingLeader === "function") ? qe.project.newUniversalCountingLeader.length : null;
          var attempts = [];

          function trySig(label, fn) {
            try { fn(); attempts.push(label + ": OK"); return label; }
            catch(e) { attempts.push(label + ": " + e.toString()); return null; }
          }

          var sig = null;
          if (!sig) sig = trySig("7-arg(w,h,par,timebase,fields,rate,chan)", function() {
            qe.project.newUniversalCountingLeader(w, h, par, timebase, fields, sampleRate, channelType);
          });
          if (!sig) sig = trySig("4-arg(w,h,par,timebase)", function() {
            qe.project.newUniversalCountingLeader(w, h, par, timebase);
          });
          if (!sig) sig = trySig("2-arg(w,h)", function() {
            qe.project.newUniversalCountingLeader(w, h);
          });

          if (!sig) {
            return __error({
              reason: "add_universal_counting_leader: every known newUniversalCountingLeader signature was rejected by Premiere 25.4 QE.",
              fnLength: fnLength,
              attempts: attempts
            });
          }
          return __result({
            created: true,
            signature: sig,
            fnLength: fnLength,
            note: "Universal counting leader created in project panel. Use add_to_timeline to place it."
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

  };
}
