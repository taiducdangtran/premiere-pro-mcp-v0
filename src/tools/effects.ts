import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";

export function getEffectsTools(bridgeOptions: BridgeOptions) {
  return {
    apply_effect: {
      description: "Apply a video effect to a clip. Uses QE DOM for effect lookup.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip to apply the effect to",
          },
          effect_name: {
            type: "string",
            description: "Name of the effect (e.g., 'Gaussian Blur', 'Lumetri Color')",
          },
        },
        required: ["node_id", "effect_name"],
      },
      handler: async (args: { node_id: string; effect_name: string }) => {
        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found: ${escapeForExtendScript(args.node_id)}");
          
          // Find the effect in QE
          var effectName = "${escapeForExtendScript(args.effect_name)}";
          var qeTrack = result.trackType === "video" 
            ? qeSeq.getVideoTrackAt(result.trackIndex)
            : qeSeq.getAudioTrackAt(result.trackIndex);
          
          if (!qeTrack) return __error("QE track not found");
          
          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");
          
          // Look up the effect by name (Premiere 25.4+: getVideoEffectList returns string[],
          // not collection of objects, so we use getVideoEffectByName).
          // Caveat: getVideoEffectByName always returns a QEVideoEffect; for unknown names
          // the .name field is "" — that's the only validity signal.
          var effObj = qe.project.getVideoEffectByName(effectName);
          if (!effObj || !effObj.name) return __error("Effect not found: " + effectName);
          qeClip.addVideoEffect(effObj);
          return __result({ applied: true, effect: effectName, clipName: result.clip.name });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    apply_audio_effect: {
      description: "Apply an audio effect to a clip",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          effect_name: {
            type: "string",
            description: "Name of the audio effect",
          },
        },
        required: ["node_id", "effect_name"],
      },
      handler: async (args: { node_id: string; effect_name: string }) => {
        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          
          var effectName = "${escapeForExtendScript(args.effect_name)}";
          var qeTrack = qeSeq.getAudioTrackAt(result.trackIndex);
          if (!qeTrack) return __error("QE audio track not found");
          
          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");
          
          var effObj = qe.project.getAudioEffectByName(effectName);
          if (!effObj || !effObj.name) return __error("Audio effect not found: " + effectName);
          qeClip.addAudioEffect(effObj);
          return __result({ applied: true, effect: effectName });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    remove_effect: {
      description: "Remove an effect from a clip by its index or name. Uses QE DOM in Premiere 25.4+.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          effect_index: {
            type: "number",
            description: "Index of the effect to remove (0-based). Use get_clip_properties to see effects list.",
          },
          effect_name: {
            type: "string",
            description: "Name of the effect to remove (alternative to effect_index). Removes the LAST occurrence if multiple match.",
          },
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string; effect_index?: number; effect_name?: string }) => {
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");

          var clip = result.clip;
          var targetIdx = -1;
          var effectName = "";
          ${args.effect_index !== undefined ? `
          if (${args.effect_index} >= clip.components.numItems) return __error("Effect index out of range");
          targetIdx = ${args.effect_index};
          effectName = clip.components[targetIdx].displayName;
          ` : `
          var wantedName = "${escapeForExtendScript(args.effect_name || "")}";
          for (var i = clip.components.numItems - 1; i >= 0; i--) {
            if (clip.components[i].displayName === wantedName) {
              targetIdx = i;
              effectName = wantedName;
              break;
            }
          }
          if (targetIdx === -1) return __error("Effect not found: " + wantedName);
          `}

          // Premiere 25.4: clip.components[i].remove() returns "not a function".
          // The working path is the QE-level component: qeClip.getComponentAt(idx).remove()
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("QE sequence unavailable");
          var qeTrack = result.trackType === "video"
            ? qeSeq.getVideoTrackAt(result.trackIndex)
            : qeSeq.getAudioTrackAt(result.trackIndex);
          if (!qeTrack) return __error("QE track not found");
          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");
          var qeComp = qeClip.getComponentAt(targetIdx);
          if (!qeComp) return __error("QE component not found at index " + targetIdx);

          var beforeCount = clip.components.numItems;
          qeComp.remove();
          var afterCount = clip.components.numItems;

          return __result({
            removed: afterCount < beforeCount,
            effect: effectName,
            indexRemoved: targetIdx,
            componentsBefore: beforeCount,
            componentsAfter: afterCount
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    list_available_effects: {
      description: "List all available video effects in Premiere Pro. Uses QE DOM.",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          app.enableQE();
          // Premiere 25.4+: getVideoEffectList returns an Array of strings (length, not numItems).
          var effects = qe.project.getVideoEffectList();
          var list = [];
          for (var i = 0; i < effects.length; i++) {
            list.push({ name: String(effects[i]), index: i });
          }
          return __result(list);
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    list_available_audio_effects: {
      description: "List all available audio effects in Premiere Pro. Uses QE DOM.",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          app.enableQE();
          var effects = qe.project.getAudioEffectList();
          var list = [];
          for (var i = 0; i < effects.length; i++) {
            list.push({ name: String(effects[i]), index: i });
          }
          return __result(list);
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    color_correct: {
      description: "Apply basic color correction to a clip using Lumetri Color",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          exposure: { type: "number", description: "Exposure adjustment (-4.0 to 4.0)" },
          contrast: { type: "number", description: "Contrast adjustment (-100 to 100)" },
          highlights: { type: "number", description: "Highlights adjustment (-100 to 100)" },
          shadows: { type: "number", description: "Shadows adjustment (-100 to 100)" },
          whites: { type: "number", description: "Whites adjustment (-100 to 100)" },
          blacks: { type: "number", description: "Blacks adjustment (-100 to 100)" },
          temperature: { type: "number", description: "Color temperature adjustment" },
          tint: { type: "number", description: "Tint adjustment" },
          saturation: { type: "number", description: "Saturation (0-200, 100 = normal)" },
        },
        required: ["node_id"],
      },
      handler: async (args: {
        node_id: string;
        exposure?: number;
        contrast?: number;
        highlights?: number;
        shadows?: number;
        whites?: number;
        blacks?: number;
        temperature?: number;
        tint?: number;
        saturation?: number;
      }) => {
        // First apply Lumetri Color effect, then set its properties
        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          
          // Apply Lumetri Color if not already present
          var clip = result.clip;
          var hasLumetri = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Lumetri Color") {
              hasLumetri = true;
              break;
            }
          }
          
          if (!hasLumetri) {
            var qeTrack = qeSeq.getVideoTrackAt(result.trackIndex);
            var qeClip = __getQEClip(result);
            var lumetriEff = qe.project.getVideoEffectByName("Lumetri Color");
            if (!lumetriEff || !lumetriEff.name) return __error("Lumetri Color effect unavailable in this Premiere build");
            qeClip.addVideoEffect(lumetriEff);
          }

          // Set Lumetri properties
          var changes = {};
          for (var i = 0; i < clip.components.numItems; i++) {
            var comp = clip.components[i];
            if (comp.displayName === "Lumetri Color") {
              for (var p = 0; p < comp.properties.numItems; p++) {
                var prop = comp.properties[p];
                var name = prop.displayName;
                ${args.exposure !== undefined ? `if (name === "Exposure") { prop.setValue(${args.exposure}, true); changes.exposure = ${args.exposure}; }` : ""}
                ${args.contrast !== undefined ? `if (name === "Contrast") { prop.setValue(${args.contrast}, true); changes.contrast = ${args.contrast}; }` : ""}
                ${args.highlights !== undefined ? `if (name === "Highlights") { prop.setValue(${args.highlights}, true); changes.highlights = ${args.highlights}; }` : ""}
                ${args.shadows !== undefined ? `if (name === "Shadows") { prop.setValue(${args.shadows}, true); changes.shadows = ${args.shadows}; }` : ""}
                ${args.whites !== undefined ? `if (name === "Whites") { prop.setValue(${args.whites}, true); changes.whites = ${args.whites}; }` : ""}
                ${args.blacks !== undefined ? `if (name === "Blacks") { prop.setValue(${args.blacks}, true); changes.blacks = ${args.blacks}; }` : ""}
                ${args.temperature !== undefined ? `if (name === "Temperature") { prop.setValue(${args.temperature}, true); changes.temperature = ${args.temperature}; }` : ""}
                ${args.tint !== undefined ? `if (name === "Tint") { prop.setValue(${args.tint}, true); changes.tint = ${args.tint}; }` : ""}
                ${args.saturation !== undefined ? `if (name === "Saturation") { prop.setValue(${args.saturation}, true); changes.saturation = ${args.saturation}; }` : ""}
              }
              break;
            }
          }
          
          return __result({ colorCorrected: true, clipName: clip.name, changes: changes });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    apply_lens_distortion_correction: {
      description:
        "Apply Lens Distortion effect to correct fisheye/wide-angle camera distortion (GoPro, action cam, fisheye lenses). " +
        "Uses Premiere's 'Lens Distortion' effect. Tune curvature/decentering via set_effect_property after apply.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          curvature: { type: "number", description: "Lens curvature -100 to 100. Positive = correct barrel distortion (fisheye), negative = pincushion. Default: -50 for typical GoPro." },
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string; curvature?: number }) => {
        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Lens Distortion is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Lens Distortion") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Lens Distortion");
            if (!eff || !eff.name) return __error("Lens Distortion effect not found");
            qeClip.addVideoEffect(eff);
          }

          ${args.curvature !== undefined ? `
          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Lens Distortion") {
              for (var p = 0; p < comp.properties.numItems; p++) {
                if (comp.properties[p].displayName === "Curvature") {
                  comp.properties[p].setValue(${args.curvature}, true);
                  break;
                }
              }
              break;
            }
          }
          ` : ""}

          return __result({ applied: !already, clipName: clip.name, curvature: ${args.curvature !== undefined ? args.curvature : "null"} });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    apply_drop_shadow: {
      description:
        "Apply Drop Shadow effect to a clip with sensible defaults (45° angle, 50% opacity, 5px distance, soft edge). " +
        "Useful for making titles/graphics pop on busy backgrounds. All visual params optional.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          opacity: { type: "number", description: "Shadow opacity 0-100 (default 50)" },
          direction: { type: "number", description: "Shadow angle in degrees 0-360 (default 135 = down-right)" },
          distance: { type: "number", description: "Shadow distance in pixels (default 5)" },
          softness: { type: "number", description: "Edge softness 0-100 (default 10)" },
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string; opacity?: number; direction?: number; distance?: number; softness?: number }) => {
        const setLines: string[] = [];
        if (args.opacity !== undefined) setLines.push(`if (n === "Opacity") prop.setValue(${args.opacity}, true);`);
        if (args.direction !== undefined) setLines.push(`if (n === "Direction") prop.setValue(${args.direction}, true);`);
        if (args.distance !== undefined) setLines.push(`if (n === "Distance") prop.setValue(${args.distance}, true);`);
        if (args.softness !== undefined) setLines.push(`if (n === "Softness") prop.setValue(${args.softness}, true);`);

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Drop Shadow is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Drop Shadow") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Drop Shadow");
            if (!eff || !eff.name) return __error("Drop Shadow effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Drop Shadow") {
              for (var p = 0; p < comp.properties.numItems; p++) {
                var prop = comp.properties[p];
                var n = prop.displayName;
                ${setLines.join("\n                ")}
              }
              break;
            }
          }

          return __result({ applied: !already, clipName: clip.name });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    burn_in_timecode: {
      description:
        "Apply the 'Timecode' effect to burn the timecode into the rendered video — useful for dailies, QC reviews, " +
        "and reference cuts. Adds the effect with default settings; use set_effect_property to tune position/opacity/size.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          opacity: { type: "number", description: "Burn-in opacity 0-100 (default: leave Premiere default)" },
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string; opacity?: number }) => {
        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Timecode is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Timecode") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Timecode");
            if (!eff || !eff.name) return __error("Timecode effect not found");
            qeClip.addVideoEffect(eff);
          }

          ${args.opacity !== undefined ? `
          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Timecode") {
              for (var p = 0; p < comp.properties.numItems; p++) {
                if (comp.properties[p].displayName === "Opacity") {
                  comp.properties[p].setValue(${args.opacity}, true);
                  break;
                }
              }
              break;
            }
          }
          ` : ""}

          return __result({ applied: !already, clipName: clip.name });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    apply_basic_3d: {
      description:
        "Apply Basic 3D effect (swivel/tilt/distance/specular highlight). " +
        "Useful for tilting titles/clips for stylistic 3D look. All transform params optional.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          swivel: { type: "number", description: "Horizontal rotation in degrees -180 to 180 (default 0)" },
          tilt: { type: "number", description: "Vertical rotation in degrees -180 to 180 (default 0)" },
          distance_to_image: { type: "number", description: "Distance to image (perspective) -1000 to 1000 (default 0)" },
          specular_highlight: { type: "boolean", description: "Show specular highlight (default false)" },
        },
        required: ["node_id"],
      },
      handler: async (args: {
        node_id: string;
        swivel?: number;
        tilt?: number;
        distance_to_image?: number;
        specular_highlight?: boolean;
      }) => {
        const setLines: string[] = [];
        if (args.swivel !== undefined) setLines.push(`if (n === "Swivel") prop.setValue(${args.swivel}, true);`);
        if (args.tilt !== undefined) setLines.push(`if (n === "Tilt") prop.setValue(${args.tilt}, true);`);
        if (args.distance_to_image !== undefined) setLines.push(`if (n === "Distance to Image") prop.setValue(${args.distance_to_image}, true);`);
        if (args.specular_highlight !== undefined) setLines.push(`if (n === "Specular Highlight") prop.setValue(${args.specular_highlight}, true);`);

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Basic 3D is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Basic 3D") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Basic 3D");
            if (!eff || !eff.name) return __error("Basic 3D effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Basic 3D") {
              for (var p = 0; p < comp.properties.numItems; p++) {
                var prop = comp.properties[p];
                var n = prop.displayName;
                ${setLines.join("\n                ")}
              }
              break;
            }
          }

          return __result({ applied: !already, clipName: clip.name });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    apply_lut: {
      description: "Apply a LUT file to a clip via Lumetri Color",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          lut_path: {
            type: "string",
            description: "Full path to the .cube or .3dl LUT file",
          },
        },
        required: ["node_id", "lut_path"],
      },
      handler: async (args: { node_id: string; lut_path: string }) => {
        const script = buildToolScript(`
          app.enableQE();
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          
          var clip = result.clip;
          
          // Find or apply Lumetri Color
          var lumetriComp = null;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Lumetri Color") {
              lumetriComp = clip.components[i];
              break;
            }
          }
          
          if (!lumetriComp) {
            var qeSeq = qe.project.getActiveSequence();
            var qeTrack = qeSeq.getVideoTrackAt(result.trackIndex);
            var qeClip = __getQEClip(result);
            var lumetriEff = qe.project.getVideoEffectByName("Lumetri Color");
            if (!lumetriEff || !lumetriEff.name) return __error("Lumetri Color effect unavailable");
            qeClip.addVideoEffect(lumetriEff);
            // Re-find the component
            for (var i = 0; i < clip.components.numItems; i++) {
              if (clip.components[i].displayName === "Lumetri Color") {
                lumetriComp = clip.components[i];
                break;
              }
            }
          }
          
          if (!lumetriComp) return __error("Could not apply Lumetri Color effect");
          
          // Set the LUT path
          for (var p = 0; p < lumetriComp.properties.numItems; p++) {
            var prop = lumetriComp.properties[p];
            if (prop.displayName === "Input LUT") {
              prop.setValue("${escapeForExtendScript(args.lut_path)}", true);
              break;
            }
          }
          
          return __result({ lutApplied: true, clipName: clip.name, lutPath: "${escapeForExtendScript(args.lut_path)}" });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    stabilize_clip: {
      description: "Apply the Warp Stabilizer effect to a clip for video stabilization. Uses QE DOM.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip to stabilize",
          },
          smoothness: {
            type: "number",
            description: "Stabilization smoothness percentage (default: 50). Higher = smoother but more cropping.",
          },
          method: {
            type: "string",
            enum: ["Subspace Warp", "Position", "Position, Scale, Rotation"],
            description: "Stabilization method (default: 'Subspace Warp')",
          },
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string; smoothness?: number; method?: string }) => {
        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found: ${escapeForExtendScript(args.node_id)}");
          
          var qeTrack = result.trackType === "video"
            ? qeSeq.getVideoTrackAt(result.trackIndex)
            : null;
          if (!qeTrack) return __error("Warp Stabilizer can only be applied to video clips");
          
          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");
          
          // Find and apply Warp Stabilizer
          var warpEff = qe.project.getVideoEffectByName("Warp Stabilizer");
          if (!warpEff || !warpEff.name) return __error("Warp Stabilizer effect not found");
          qeClip.addVideoEffect(warpEff);
          
          // Set properties if specified
          var clip = result.clip;
          var changes = { stabilized: true };
          ${args.smoothness !== undefined || args.method !== undefined ? `
          for (var i = 0; i < clip.components.numItems; i++) {
            var comp = clip.components[i];
            if (comp.displayName === "Warp Stabilizer") {
              for (var p = 0; p < comp.properties.numItems; p++) {
                var prop = comp.properties[p];
                ${args.smoothness !== undefined ? `
                if (prop.displayName === "Smoothness") {
                  prop.setValue(${args.smoothness}, true);
                  changes.smoothness = ${args.smoothness};
                }` : ""}
                ${args.method !== undefined ? `
                if (prop.displayName === "Method") {
                  prop.setValue("${escapeForExtendScript(args.method)}", true);
                  changes.method = "${escapeForExtendScript(args.method)}";
                }` : ""}
              }
              break;
            }
          }
          ` : ""}
          
          return __result({ clipName: clip.name, info: "Warp Stabilizer applied. Analysis will begin automatically.", changes: changes });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    configure_warp_stabilizer: {
      description:
        "Configure Warp Stabilizer parameters on a clip. The effect must already be applied (use stabilize_clip first). " +
        "All parameters are optional — only specified ones are changed. " +
        "Returns AnalysisStatusCounter so callers can poll background analysis progress.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the clip with Warp Stabilizer applied" },
          result: {
            type: "string",
            enum: ["Smooth Motion", "No Motion"],
            description: "Stabilization goal. 'Smooth Motion' (default) preserves general camera movement; 'No Motion' attempts to fully lock the shot.",
          },
          smoothness: {
            type: "number",
            description: "Smoothness percentage 0-100 (only effective when result='Smooth Motion'). Higher = smoother but more cropping.",
          },
          method: {
            type: "string",
            enum: ["Position", "Position, Scale, Rotation", "Perspective", "Subspace Warp"],
            description: "Tracking method. 'Subspace Warp' (default) is most powerful; fall back to simpler methods if it produces artifacts.",
          },
          framing: {
            type: "string",
            enum: ["Stabilize Only", "Stabilize, Crop", "Stabilize, Crop, Auto-scale", "Stabilize, Synthesize Edges"],
            description: "How to handle borders after stabilization. 'Stabilize, Crop, Auto-scale' (default) zooms in to hide borders.",
          },
          crop_smooth_balance: {
            type: "number",
            description: "Crop Less <-> Smooth More slider, 0-100. Higher = more aggressive smoothing at the cost of more cropping.",
          },
          maximum_scale: {
            type: "number",
            description: "Maximum auto-scale percentage (used when framing has Auto-scale).",
          },
          additional_scale: {
            type: "number",
            description: "Additional manual scale percentage on top of stabilization.",
          },
          rolling_shutter_ripple: {
            type: "number",
            description: "Rolling shutter compensation 0-100. Use for footage from CMOS cameras with strong rolling shutter.",
          },
        },
        required: ["node_id"],
      },
      handler: async (args: {
        node_id: string;
        result?: string;
        smoothness?: number;
        method?: string;
        framing?: string;
        crop_smooth_balance?: number;
        maximum_scale?: number;
        additional_scale?: number;
        rolling_shutter_ripple?: number;
      }) => {
        const resultMap: Record<string, number> = {
          "Smooth Motion": 0,
          "No Motion": 1,
        };
        const methodMap: Record<string, number> = {
          "Position": 1,
          "Position, Scale, Rotation": 2,
          "Perspective": 4,
          "Subspace Warp": 3,
        };
        const framingMap: Record<string, number> = {
          "Stabilize Only": 0,
          "Stabilize, Crop": 1,
          "Stabilize, Crop, Auto-scale": 2,
          "Stabilize, Synthesize Edges": 3,
        };

        const setLines: string[] = [];
        if (args.result !== undefined) {
          const v = resultMap[args.result];
          if (v === undefined) throw new Error(`Invalid result: ${args.result}`);
          setLines.push(`if (prop.displayName === "Result") { prop.setValue(${v}, true); changes.result = "${escapeForExtendScript(args.result)}"; }`);
        }
        if (args.smoothness !== undefined) {
          setLines.push(`if (prop.displayName === "Smoothness") { prop.setValue(${args.smoothness}, true); changes.smoothness = ${args.smoothness}; }`);
        }
        if (args.method !== undefined) {
          const v = methodMap[args.method];
          if (v === undefined) throw new Error(`Invalid method: ${args.method}`);
          setLines.push(`if (prop.displayName === "Method") { prop.setValue(${v}, true); changes.method = "${escapeForExtendScript(args.method)}"; }`);
        }
        if (args.framing !== undefined) {
          const v = framingMap[args.framing];
          if (v === undefined) throw new Error(`Invalid framing: ${args.framing}`);
          setLines.push(`if (prop.displayName === "Framing") { prop.setValue(${v}, true); changes.framing = "${escapeForExtendScript(args.framing)}"; }`);
        }
        if (args.crop_smooth_balance !== undefined) {
          setLines.push(`if (prop.displayName === "Crop Less <-> Smooth More") { prop.setValue(${args.crop_smooth_balance}, true); changes.crop_smooth_balance = ${args.crop_smooth_balance}; }`);
        }
        if (args.maximum_scale !== undefined) {
          setLines.push(`if (prop.displayName === "Maximum Scale") { prop.setValue(${args.maximum_scale}, true); changes.maximum_scale = ${args.maximum_scale}; }`);
        }
        if (args.additional_scale !== undefined) {
          setLines.push(`if (prop.displayName === "Additional Scale") { prop.setValue(${args.additional_scale}, true); changes.additional_scale = ${args.additional_scale}; }`);
        }
        if (args.rolling_shutter_ripple !== undefined) {
          setLines.push(`if (prop.displayName === "Rolling Shutter Ripple") { prop.setValue(${args.rolling_shutter_ripple}, true); changes.rolling_shutter_ripple = ${args.rolling_shutter_ripple}; }`);
        }

        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          var clip = result.clip;

          var warp = null;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Warp Stabilizer") {
              warp = clip.components[i];
              break;
            }
          }
          if (!warp) return __error("Warp Stabilizer not applied. Call stabilize_clip first.");

          var changes = {};
          var analysisStatus = -1;
          for (var p = 0; p < warp.properties.numItems; p++) {
            var prop = warp.properties[p];
            ${setLines.join("\n            ")}
            if (prop.displayName === "AnalysisStatusCounter") {
              analysisStatus = prop.getValue();
            }
          }

          return __result({
            clipName: clip.name,
            changes: changes,
            analysisStatusCounter: analysisStatus,
            note: "AnalysisStatusCounter increments while background analysis runs. Poll this tool to check progress."
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    apply_ultra_key: {
      description:
        "Apply Ultra Key (chroma key) effect to a clip with optional key color and quality preset. " +
        "Use set_ultra_key_settings afterwards for fine-tuning matte generation, cleanup, spill suppression, and color correction.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          key_color: {
            type: "array",
            items: { type: "number" },
            description: "Key color as [R, G, B] with each component 0-255 (default: [0, 255, 0] green screen). Optionally a 4th element for alpha 0-255.",
          },
          setting: {
            type: "string",
            enum: ["Default", "Relaxed", "Aggressive"],
            description: "Quality preset. 'Default' balances speed/quality; 'Aggressive' keys harder but may chew into subject; 'Relaxed' preserves detail but lets more spill through.",
          },
          output: {
            type: "string",
            enum: ["Composite", "Alpha Channel", "Color Channel"],
            description: "Output mode. 'Composite' (default) shows the keyed result; 'Alpha Channel' shows the matte for inspection.",
          },
        },
        required: ["node_id"],
      },
      handler: async (args: {
        node_id: string;
        key_color?: number[];
        setting?: string;
        output?: string;
      }) => {
        const settingMap: Record<string, number> = { "Default": 0, "Relaxed": 1, "Aggressive": 2 };
        const outputMap: Record<string, number> = { "Composite": 0, "Alpha Channel": 1, "Color Channel": 2 };

        const kc = args.key_color ?? [0, 255, 0];
        if (kc.length < 3 || kc.length > 4) throw new Error("key_color must be [R,G,B] or [R,G,B,A]");
        const r = kc[0], g = kc[1], b = kc[2], a = kc.length === 4 ? kc[3] : 255;

        const settingVal = args.setting !== undefined ? settingMap[args.setting] : undefined;
        if (args.setting !== undefined && settingVal === undefined) throw new Error(`Invalid setting: ${args.setting}`);
        const outputVal = args.output !== undefined ? outputMap[args.output] : undefined;
        if (args.output !== undefined && outputVal === undefined) throw new Error(`Invalid output: ${args.output}`);

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Ultra Key requires a video clip");

          var qeTrack = qeSeq.getVideoTrackAt(result.trackIndex);
          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          // Skip if already applied
          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Ultra Key") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Ultra Key");
            if (!eff || !eff.name) return __error("Ultra Key effect not found");
            qeClip.addVideoEffect(eff);
          }

          // Configure
          var ultra = null;
          for (var j = 0; j < clip.components.numItems; j++) {
            if (clip.components[j].displayName === "Ultra Key") { ultra = clip.components[j]; break; }
          }
          if (!ultra) return __error("Ultra Key not found after apply");

          var changes = { applied: !already };
          for (var p = 0; p < ultra.properties.numItems; p++) {
            var prop = ultra.properties[p];
            if (prop.displayName === "Key Color") {
              prop.setColorValue(${r}, ${g}, ${b}, ${a});
              changes.key_color = [${r}, ${g}, ${b}, ${a}];
            }
            ${settingVal !== undefined ? `if (prop.displayName === "Setting") { prop.setValue(${settingVal}, true); changes.setting = "${escapeForExtendScript(args.setting!)}"; }` : ""}
            ${outputVal !== undefined ? `if (prop.displayName === "Output") { prop.setValue(${outputVal}, true); changes.output = "${escapeForExtendScript(args.output!)}"; }` : ""}
          }

          return __result({ clipName: clip.name, changes: changes });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_ultra_key_settings: {
      description:
        "Fine-tune Ultra Key matte generation, matte cleanup, spill suppression, and color correction parameters on a clip (effect must already be applied). " +
        "All parameters are optional; only specified ones are changed. " +
        "Note: Premiere 25.4 does NOT expose programmatic toggles for the section enable checkboxes (Matte Generation, Matte Cleanup, etc.) — those are UI-only. " +
        "However, individual numeric parameters take effect regardless of the visual section toggle.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the clip with Ultra Key applied" },

          transparency: { type: "number", description: "Matte transparency 0-100 (default 45)" },
          highlight: { type: "number", description: "Matte highlight 0-100 (default 10)" },
          shadow: { type: "number", description: "Matte shadow 0-100 (default 50)" },
          tolerance: { type: "number", description: "Matte tolerance 0-100 (default 50)" },
          pedestal: { type: "number", description: "Matte pedestal 0-100 (default 10)" },

          choke: { type: "number", description: "Matte choke 0-100" },
          soften: { type: "number", description: "Matte soften 0-100" },
          contrast: { type: "number", description: "Matte contrast 0-100" },
          mid_point: { type: "number", description: "Matte mid point 0-100 (default 50)" },

          desaturate: { type: "number", description: "Spill desaturate 0-100 (default 25)" },
          range: { type: "number", description: "Spill range 0-100 (default 50)" },
          spill: { type: "number", description: "Spill 0-100 (default 50)" },
          luma: { type: "number", description: "Spill luma 0-100 (default 50)" },

          saturation: { type: "number", description: "Saturation 0-200 (default 100)" },
          hue: { type: "number", description: "Hue -180 to 180 (default 0)" },
          luminance: { type: "number", description: "Luminance 0-200 (default 100)" },
        },
        required: ["node_id"],
      },
      handler: async (args: {
        node_id: string;
        transparency?: number; highlight?: number; shadow?: number; tolerance?: number; pedestal?: number;
        choke?: number; soften?: number; contrast?: number; mid_point?: number;
        desaturate?: number; range?: number; spill?: number; luma?: number;
        saturation?: number; hue?: number; luminance?: number;
      }) => {
        const numProps: Array<[string, number | undefined, string]> = [
          ["Transparency", args.transparency, "transparency"],
          ["Highlight", args.highlight, "highlight"],
          ["Shadow", args.shadow, "shadow"],
          ["Tolerance", args.tolerance, "tolerance"],
          ["Pedestal", args.pedestal, "pedestal"],
          ["Choke", args.choke, "choke"],
          ["Soften", args.soften, "soften"],
          ["Contrast", args.contrast, "contrast"],
          ["Mid Point", args.mid_point, "mid_point"],
          ["Desaturate", args.desaturate, "desaturate"],
          ["Range", args.range, "range"],
          ["Spill", args.spill, "spill"],
          ["Luma", args.luma, "luma"],
          ["Saturation", args.saturation, "saturation"],
          ["Hue", args.hue, "hue"],
          ["Luminance", args.luminance, "luminance"],
        ];

        const numLines = numProps
          .filter(([, v]) => v !== undefined)
          .map(([name, v, key]) => `if (prop.displayName === "${name}") { prop.setValue(${v}, true); changes.${key} = ${v}; }`);

        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          var clip = result.clip;

          var ultra = null;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Ultra Key") { ultra = clip.components[i]; break; }
          }
          if (!ultra) return __error("Ultra Key not applied. Call apply_ultra_key first.");

          var changes = {};
          for (var p = 0; p < ultra.properties.numItems; p++) {
            var prop = ultra.properties[p];
            ${numLines.join("\n            ")}
          }

          return __result({ clipName: clip.name, changes: changes });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    apply_crop_mask: {
      description:
        "Apply (or update) the Crop effect as a rectangular mask workaround. Premiere 25.4 ExtendScript has no real mask API (no addMask/addBezierMask), " +
        "so rectangular mask = Crop effect with L/T/R/B percentages. " +
        "All percentages are 0-100 (% of frame width/height to crop in from each edge). " +
        "Edge Feather softens the rectangular boundary; Zoom enabled scales the cropped area back to full frame.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          left: { type: "number", description: "Crop from left edge, 0-100% (default 0)" },
          top: { type: "number", description: "Crop from top edge, 0-100% (default 0)" },
          right: { type: "number", description: "Crop from right edge, 0-100% (default 0)" },
          bottom: { type: "number", description: "Crop from bottom edge, 0-100% (default 0)" },
          zoom: { type: "boolean", description: "Zoom cropped area back to full frame (default false)" },
          edge_feather: { type: "number", description: "Soften crop edges 0-100 (default 0)" },
        },
        required: ["node_id"],
      },
      handler: async (args: {
        node_id: string;
        left?: number;
        top?: number;
        right?: number;
        bottom?: number;
        zoom?: boolean;
        edge_feather?: number;
      }) => {
        const setLines: string[] = [];
        if (args.left !== undefined) setLines.push(`if (crop.properties[0] && crop.properties[0].displayName === "Left") { crop.properties[0].setValue(${args.left}, true); changes.left = ${args.left}; }`);
        if (args.top !== undefined) setLines.push(`if (crop.properties[1] && crop.properties[1].displayName === "Top") { crop.properties[1].setValue(${args.top}, true); changes.top = ${args.top}; }`);
        if (args.right !== undefined) setLines.push(`if (crop.properties[2] && crop.properties[2].displayName === "Right") { crop.properties[2].setValue(${args.right}, true); changes.right = ${args.right}; }`);
        if (args.bottom !== undefined) setLines.push(`if (crop.properties[3] && crop.properties[3].displayName === "Bottom") { crop.properties[3].setValue(${args.bottom}, true); changes.bottom = ${args.bottom}; }`);
        if (args.zoom !== undefined) setLines.push(`if (crop.properties[4] && crop.properties[4].displayName === "Zoom") { crop.properties[4].setValue(${args.zoom}, true); changes.zoom = ${args.zoom}; }`);
        if (args.edge_feather !== undefined) setLines.push(`if (crop.properties[5] && crop.properties[5].displayName === "Edge Feather") { crop.properties[5].setValue(${args.edge_feather}, true); changes.edge_feather = ${args.edge_feather}; }`);

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Crop requires a video clip");

          var qeTrack = qeSeq.getVideoTrackAt(result.trackIndex);
          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Crop") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Crop");
            if (!eff || !eff.name) return __error("Crop effect not found");
            qeClip.addVideoEffect(eff);
          }

          var crop = null;
          for (var j = 0; j < clip.components.numItems; j++) {
            if (clip.components[j].displayName === "Crop") { crop = clip.components[j]; break; }
          }
          if (!crop) return __error("Crop not found after apply");

          var changes = { applied: !already };
          ${setLines.join("\n          ")}

          return __result({ clipName: clip.name, changes: changes });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_lumetri_creative: {
      description:
        "Set Lumetri Color → Creative section parameters (Faded Film, Sharpen, Vibrance, Saturation, Tint Balance). " +
        "Effect must already be applied (use color_correct or apply_effect 'Lumetri Color' first). " +
        "Lumetri has duplicated property names across sections (e.g., 3 'Saturation' props), so this tool addresses Creative section by fixed indices verified in Premiere 25.4.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the clip with Lumetri Color applied" },
          faded_film: { type: "number", description: "Faded Film 0-100 (idx 40)" },
          sharpen: { type: "number", description: "Sharpen -100 to 100 (idx 41)" },
          vibrance: { type: "number", description: "Vibrance -100 to 100 (idx 42)" },
          saturation: { type: "number", description: "Saturation 0-200 (idx 43)" },
          tint_balance: { type: "number", description: "Tint Balance -100 to 100 (idx 45)" },
        },
        required: ["node_id"],
      },
      handler: async (args: {
        node_id: string;
        faded_film?: number;
        sharpen?: number;
        vibrance?: number;
        saturation?: number;
        tint_balance?: number;
      }) => {
        const setLines: string[] = [];
        const push = (idx: number, name: string, key: keyof typeof args) => {
          const v = args[key];
          if (v !== undefined) {
            setLines.push(`if (lumetri.properties[${idx}] && lumetri.properties[${idx}].displayName === "${name}") { lumetri.properties[${idx}].setValue(${v}, true); changes.${key} = ${v}; }`);
          }
        };
        push(40, "Faded Film", "faded_film");
        push(41, "Sharpen", "sharpen");
        push(42, "Vibrance", "vibrance");
        push(43, "Saturation", "saturation");
        push(45, "Tint Balance", "tint_balance");

        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          var clip = result.clip;

          var lumetri = null;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Lumetri Color") { lumetri = clip.components[i]; break; }
          }
          if (!lumetri) return __error("Lumetri Color not applied");

          var changes = {};
          ${setLines.join("\n          ")}

          return __result({ clipName: clip.name, changes: changes });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_lumetri_hsl_secondary: {
      description:
        "Set Lumetri Color → HSL Secondary section refinement parameters (Denoise, Blur, Temperature, Tint, Contrast, Sharpen, Saturation). " +
        "Use this for selective color correction after isolating a hue range in HSL Secondary. " +
        "Effect must already be applied. Color picker (Set/Add/Remove key colors) is not exposed here — use the UI for keying setup, then this tool for the refinement adjustments.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the clip with Lumetri Color applied" },
          denoise: { type: "number", description: "Denoise the keyed selection 0-100 (idx 95)" },
          blur: { type: "number", description: "Blur the keyed selection 0-100 (idx 96)" },
          temperature: { type: "number", description: "Temperature adjustment for the keyed range -100 to 100 (idx 101)" },
          tint: { type: "number", description: "Tint adjustment -100 to 100 (idx 102)" },
          contrast: { type: "number", description: "Contrast adjustment -100 to 100 (idx 103)" },
          sharpen: { type: "number", description: "Sharpen the keyed selection -100 to 100 (idx 104)" },
          saturation: { type: "number", description: "Saturation 0-200 (idx 105)" },
        },
        required: ["node_id"],
      },
      handler: async (args: {
        node_id: string;
        denoise?: number;
        blur?: number;
        temperature?: number;
        tint?: number;
        contrast?: number;
        sharpen?: number;
        saturation?: number;
      }) => {
        const setLines: string[] = [];
        const push = (idx: number, name: string, key: keyof typeof args) => {
          const v = args[key];
          if (v !== undefined) {
            setLines.push(`if (lumetri.properties[${idx}] && lumetri.properties[${idx}].displayName === "${name}") { lumetri.properties[${idx}].setValue(${v}, true); changes.${key} = ${v}; }`);
          }
        };
        push(95, "Denoise", "denoise");
        push(96, "Blur", "blur");
        push(101, "Temperature", "temperature");
        push(102, "Tint", "tint");
        push(103, "Contrast", "contrast");
        push(104, "Sharpen", "sharpen");
        push(105, "Saturation", "saturation");

        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          var clip = result.clip;

          var lumetri = null;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Lumetri Color") { lumetri = clip.components[i]; break; }
          }
          if (!lumetri) return __error("Lumetri Color not applied");

          var changes = {};
          ${setLines.join("\n          ")}

          return __result({ clipName: clip.name, changes: changes });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_lumetri_vignette: {
      description:
        "Set Lumetri Color → Vignette section parameters (Amount, Midpoint, Roundness, Feather). " +
        "Effect must already be applied. Negative Amount = darker corners (most common); positive = brighter corners.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the clip with Lumetri Color applied" },
          amount: { type: "number", description: "Vignette amount, typically -5 to 5 (Premiere clamps automatically). Negative = darker corners. Idx 110." },
          midpoint: { type: "number", description: "Midpoint 0-100 (default 50). Idx 111." },
          roundness: { type: "number", description: "Roundness -100 to 100 (default 0). Idx 112." },
          feather: { type: "number", description: "Feather 0-100 (default 50). Idx 113." },
        },
        required: ["node_id"],
      },
      handler: async (args: {
        node_id: string;
        amount?: number;
        midpoint?: number;
        roundness?: number;
        feather?: number;
      }) => {
        const setLines: string[] = [];
        const push = (idx: number, name: string, key: keyof typeof args) => {
          const v = args[key];
          if (v !== undefined) {
            setLines.push(`if (lumetri.properties[${idx}] && lumetri.properties[${idx}].displayName === "${name}") { lumetri.properties[${idx}].setValue(${v}, true); changes.${key} = ${v}; }`);
          }
        };
        push(110, "Amount", "amount");
        push(111, "Midpoint", "midpoint");
        push(112, "Roundness", "roundness");
        push(113, "Feather", "feather");

        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          var clip = result.clip;

          var lumetri = null;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Lumetri Color") { lumetri = clip.components[i]; break; }
          }
          if (!lumetri) return __error("Lumetri Color not applied");

          var changes = {};
          ${setLines.join("\n          ")}

          return __result({ clipName: clip.name, changes: changes });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_effect_enabled: {
      description:
        "Enable or disable an effect on a clip without removing it (toggle the eyeball)",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the clip" },
          effect_index: {
            type: "number",
            description: "Index of the effect/component on the clip (0-based)",
          },
          enabled: { type: "boolean", description: "true to enable, false to disable" },
        },
        required: ["node_id", "effect_index", "enabled"],
      },
      handler: async (args: {
        node_id: string;
        effect_index: number;
        enabled: boolean;
      }) => {
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          var clip = result.clip;

          if (${args.effect_index} >= clip.components.numItems) return __error("Effect index out of range");
          var effect = clip.components[${args.effect_index}];

          var found = false;
          for (var i = 0; i < effect.properties.numItems; i++) {
            var pname = effect.properties[i].displayName;
            if (pname === "enabled" || pname === "Enabled") {
              effect.properties[i].setValue(${args.enabled ? "true" : "false"}, true);
              found = true;
              break;
            }
          }
          return __result({ effectIndex: ${args.effect_index}, enabled: ${args.enabled}, toggled: found });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },
  };
}
