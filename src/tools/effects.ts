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

    apply_effect_with_properties: {
      description:
        "Apply a video effect AND set multiple properties in a single call — convenience over chaining apply_effect + set_effect_property. " +
        "Use when you know the effect name + property values upfront. For tuning later, use set_effect_property. " +
        "Properties are matched by displayName; if multiple properties share a name (e.g. 3 'Saturation' in Lumetri), only the FIRST occurrence is set — use set_effect_property with index for precise control.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the clip" },
          effect_name: { type: "string", description: "Effect display name (e.g. 'Lumetri Color', 'Lens Distortion')" },
          properties: {
            type: "object",
            description: "Object map of property name → value. e.g. { 'Curvature': -50, 'Vertical Decentering': 10 }",
            additionalProperties: true,
          },
          skip_if_already_applied: {
            type: "boolean",
            description: "If true and the effect is already on the clip, skip re-applying (just set properties on existing). Default true.",
          },
        },
        required: ["node_id", "effect_name", "properties"],
      },
      handler: async (args: {
        node_id: string;
        effect_name: string;
        properties: Record<string, unknown>;
        skip_if_already_applied?: boolean;
      }) => {
        const skipIfApplied = args.skip_if_already_applied !== false;
        const propsEntries = Object.entries(args.properties);
        const propsLines = propsEntries.map(([name, value]) => {
          let valExpr: string;
          if (typeof value === "boolean") valExpr = value ? "true" : "false";
          else if (typeof value === "number") valExpr = String(value);
          else if (typeof value === "string") valExpr = `"${escapeForExtendScript(value)}"`;
          else throw new Error(`Unsupported property value type for "${name}": ${typeof value}`);
          return `if (n === "${escapeForExtendScript(name)}") { prop.setValue(${valExpr}, true); applied[n] = true; }`;
        });

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var effectName = "${escapeForExtendScript(args.effect_name)}";
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === effectName) { already = true; break; }
          }
          var didApply = false;
          if (!already || !${skipIfApplied}) {
            var eff = qe.project.getVideoEffectByName(effectName);
            if (!eff || !eff.name) return __error("Effect not found in QE list: " + effectName);
            qeClip.addVideoEffect(eff);
            didApply = true;
          }

          // Find target component (last instance — typically the one we just added)
          var target = null;
          for (var k = clip.components.numItems - 1; k >= 0; k--) {
            if (clip.components[k].displayName === effectName) { target = clip.components[k]; break; }
          }
          if (!target) return __error("Effect component not found after apply");

          // Set properties (first matching displayName per name)
          var applied = {};
          var seen = {};
          for (var p = 0; p < target.properties.numItems; p++) {
            var prop = target.properties[p];
            var n = prop.displayName;
            if (seen[n]) continue;
            ${propsLines.join("\n            ")}
            seen[n] = true;
          }

          // Compute set vs unset
          var requested = ${JSON.stringify(propsEntries.map(([k]) => k))};
          var unset = [];
          for (var u = 0; u < requested.length; u++) {
            if (!applied[requested[u]]) unset.push(requested[u]);
          }

          return __result({
            clipName: clip.name,
            effect: effectName,
            applied: didApply,
            propertiesSet: applied,
            propertiesNotFound: unset
          });
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
        if (args.specular_highlight !== undefined) setLines.push(`if (n === "Show Specular Highlight") prop.setValue(${args.specular_highlight}, true);`);

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

    apply_directional_blur: {
      description:
        "Apply Directional Blur — motion-style blur in a specific direction. Use blur_length 5-30 for subtle motion feel, 50-100 for strong streaking.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          direction: { type: "number", description: "Direction in degrees 0-360 (default 0 = horizontal right-to-left motion)" },
          blur_length: { type: "number", description: "Blur length 0-1000 (default 10)" },
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string; direction?: number; blur_length?: number }) => {
        const setLines: string[] = [];
        if (args.direction !== undefined) setLines.push(`if (n === "Direction") prop.setValue(${args.direction}, true);`);
        if (args.blur_length !== undefined) setLines.push(`if (n === "Blur Length") prop.setValue(${args.blur_length}, true);`);

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Directional Blur is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Directional Blur") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Directional Blur");
            if (!eff || !eff.name) return __error("Directional Blur effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Directional Blur") {
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

    apply_black_white: {
      description:
        "Apply Black & White conversion to a clip. Simple toggle effect — desaturates the image to monochrome. " +
        "For tonal control over individual color channels, use Lumetri Color → HSL Secondary instead.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
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
          if (result.trackType !== "video") return __error("Black & White is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Black & White") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Black & White");
            if (!eff || !eff.name) return __error("Black & White effect not found");
            qeClip.addVideoEffect(eff);
          }

          return __result({ applied: !already, clipName: clip.name });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    apply_invert: {
      description:
        "Apply Invert effect — inverts color channels (negative image look). Channel selector controls which channels are inverted (RGB by default; can target individual R/G/B/A or alpha-only).",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          channel: {
            type: "string",
            enum: ["RGB", "Red", "Green", "Blue", "Alpha", "Hue", "Lightness", "Saturation", "Yellow", "Magenta", "Cyan"],
            description: "Channel to invert (default 'RGB' = all color channels)",
          },
          blend_with_original: { type: "number", description: "Blend with original 0-100 (0 = full inverted, 100 = unchanged). Default 0." },
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string; channel?: string; blend_with_original?: number }) => {
        // Premiere 25.4: Channel is enum int, not string. Mapping verified empirically.
        const channelMap: Record<string, number> = {
          "RGB": 0, "Red": 1, "Green": 2, "Blue": 3, "Alpha": 4,
          "Hue": 5, "Lightness": 6, "Saturation": 7,
          "Yellow": 8, "Magenta": 9, "Cyan": 10,
        };
        const setLines: string[] = [];
        if (args.channel !== undefined) {
          const v = channelMap[args.channel];
          if (v === undefined) throw new Error(`Invalid channel: ${args.channel}`);
          setLines.push(`if (n === "Channel") prop.setValue(${v}, true);`);
        }
        if (args.blend_with_original !== undefined) setLines.push(`if (n === "Blend With Original") prop.setValue(${args.blend_with_original}, true);`);

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Invert is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Invert") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Invert");
            if (!eff || !eff.name) return __error("Invert effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Invert") {
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

    apply_gaussian_blur: {
      description:
        "Apply Gaussian Blur — soft, even blur. Use blurriness 5-20 for subtle softening, 30-80 for strong defocus. " +
        "Direction: 'Horizontal and Vertical' (default), 'Horizontal', or 'Vertical' for motion-style blur.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          blurriness: { type: "number", description: "Blur amount 0-250 (default: leave Premiere default)" },
          blur_dimensions: {
            type: "string",
            enum: ["Horizontal and Vertical", "Horizontal", "Vertical"],
            description: "Blur direction (default: 'Horizontal and Vertical')",
          },
          repeat_edge_pixels: { type: "boolean", description: "Repeat edge pixels to avoid transparent edges (default: true)" },
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string; blurriness?: number; blur_dimensions?: string; repeat_edge_pixels?: boolean }) => {
        const dirMap: Record<string, number> = { "Horizontal and Vertical": 1, "Horizontal": 2, "Vertical": 3 };
        const setLines: string[] = [];
        if (args.blurriness !== undefined) setLines.push(`if (n === "Blurriness") prop.setValue(${args.blurriness}, true);`);
        if (args.blur_dimensions !== undefined) {
          const d = dirMap[args.blur_dimensions];
          if (d) setLines.push(`if (n === "Blur Dimensions") prop.setValue(${d}, true);`);
        }
        if (args.repeat_edge_pixels !== undefined) setLines.push(`if (n === "Repeat Edge Pixels") prop.setValue(${args.repeat_edge_pixels}, true);`);

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Gaussian Blur is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Gaussian Blur") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Gaussian Blur");
            if (!eff || !eff.name) return __error("Gaussian Blur effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Gaussian Blur") {
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

    apply_mosaic: {
      description:
        "Apply Mosaic (pixelate) effect — useful for blurring out faces, license plates, sensitive info, or for stylistic chunky-pixel look. " +
        "Higher block count = finer pixels (less obscured).",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          horizontal_blocks: { type: "number", description: "Horizontal block count 1-1000 (lower = chunkier; default 10)" },
          vertical_blocks: { type: "number", description: "Vertical block count 1-1000 (default 10)" },
          sharp_colors: { type: "boolean", description: "Sharp colors (no anti-aliasing between blocks) (default false)" },
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string; horizontal_blocks?: number; vertical_blocks?: number; sharp_colors?: boolean }) => {
        const setLines: string[] = [];
        if (args.horizontal_blocks !== undefined) setLines.push(`if (n === "Horizontal Blocks") prop.setValue(${args.horizontal_blocks}, true);`);
        if (args.vertical_blocks !== undefined) setLines.push(`if (n === "Vertical Blocks") prop.setValue(${args.vertical_blocks}, true);`);
        if (args.sharp_colors !== undefined) setLines.push(`if (n === "Sharp Colors") prop.setValue(${args.sharp_colors}, true);`);

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Mosaic is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Mosaic") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Mosaic");
            if (!eff || !eff.name) return __error("Mosaic effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Mosaic") {
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

    apply_lens_flare: {
      description:
        "Apply Lens Flare effect — bright sun/light spot with rays. Default position is center; flare_brightness controls intensity. " +
        "Lens type changes the optical character (50-300mm zoom = standard, 35mm prime = sharper).",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          flare_brightness: { type: "number", description: "Brightness 0-300 (default ~100)" },
          lens_type: {
            type: "string",
            enum: ["50-300mm Zoom", "35mm Prime", "105mm Prime"],
            description: "Lens optical type (default '50-300mm Zoom')",
          },
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string; flare_brightness?: number; lens_type?: string }) => {
        const lensMap: Record<string, number> = { "50-300mm Zoom": 1, "35mm Prime": 2, "105mm Prime": 3 };
        const setLines: string[] = [];
        if (args.flare_brightness !== undefined) setLines.push(`if (n === "Flare Brightness") prop.setValue(${args.flare_brightness}, true);`);
        if (args.lens_type !== undefined) {
          const v = lensMap[args.lens_type];
          if (v) setLines.push(`if (n === "Lens Type") prop.setValue(${v}, true);`);
        }

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Lens Flare is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Lens Flare") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Lens Flare");
            if (!eff || !eff.name) return __error("Lens Flare effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Lens Flare") {
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

    apply_skin_tone_smoothing: {
      description:
        "Apply skin tone smoothing — combines Camera Blur (light) with optional contrast preservation. " +
        "Subtle by default (intensity=20). For full beauty work, follow with Lumetri HSL Secondary keyed on skin tone.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          intensity: { type: "number", description: "Smoothing intensity 0-100 (default 20). Higher = more skin smoothing but loses detail." },
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string; intensity?: number }) => {
        const intensity = args.intensity ?? 20;
        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Skin tone smoothing is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Camera Blur") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Camera Blur");
            if (!eff || !eff.name) return __error("Camera Blur effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Camera Blur") {
              for (var p = 0; p < comp.properties.numItems; p++) {
                var prop = comp.properties[p];
                var n = prop.displayName;
                if (n === "Percent Blur" || n === "Blur Length" || n === "Blur") prop.setValue(${intensity}, true);
              }
              break;
            }
          }

          return __result({
            applied: !already,
            clipName: clip.name,
            intensity: ${intensity},
            note: "Mild smoothing via Camera Blur. For full beauty work, layer with Lumetri HSL Secondary keyed on skin tone."
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    apply_levels: {
      description:
        "Apply Levels effect — input/output black/white point control per channel. Use for fast contrast/exposure correction. " +
        "Channel: 'RGB' (default, all channels), 'Red', 'Green', 'Blue', or 'Alpha'.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          input_black: { type: "number", description: "Input black point 0-255 (default 0)" },
          input_white: { type: "number", description: "Input white point 0-255 (default 255)" },
          gamma: { type: "number", description: "Gamma 0.1-9.99 (default 1.0). Tool converts to Premiere's internal integer (1.0 → 100, 1.5 → 150)." },
          output_black: { type: "number", description: "Output black point 0-255 (default 0)" },
          output_white: { type: "number", description: "Output white point 0-255 (default 255)" },
        },
        required: ["node_id"],
      },
      handler: async (args: {
        node_id: string;
        input_black?: number;
        input_white?: number;
        gamma?: number;
        output_black?: number;
        output_white?: number;
      }) => {
        const setLines: string[] = [];
        // Premiere 25.4 prop names (verified via probe): "(RGB) Black Input Level", etc.
        if (args.input_black !== undefined) setLines.push(`if (n === "(RGB) Black Input Level") prop.setValue(${args.input_black}, true);`);
        if (args.input_white !== undefined) setLines.push(`if (n === "(RGB) White Input Level") prop.setValue(${args.input_white}, true);`);
        // Premiere stores Gamma as integer where 100 = 1.0. Convert user-facing float.
        if (args.gamma !== undefined) setLines.push(`if (n === "(RGB) Gamma") prop.setValue(${Math.round(args.gamma * 100)}, true);`);
        if (args.output_black !== undefined) setLines.push(`if (n === "(RGB) Black Output Level") prop.setValue(${args.output_black}, true);`);
        if (args.output_white !== undefined) setLines.push(`if (n === "(RGB) White Output Level") prop.setValue(${args.output_white}, true);`);

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Levels is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Levels") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Levels");
            if (!eff || !eff.name) return __error("Levels effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Levels") {
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

    apply_unsharp_mask: {
      description:
        "Apply Unsharp Mask sharpening to a clip. Higher amount = stronger edge enhancement; threshold prevents sharpening of flat areas (skin, sky). " +
        "Sensible defaults for video: amount=50-100, radius=1.0-2.0, threshold=2-10.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          amount: { type: "number", description: "Sharpening strength 0-500% (default: leave Premiere default)" },
          radius: { type: "number", description: "Pixel radius 0.1-300 (default: leave Premiere default)" },
          threshold: { type: "number", description: "Threshold 0-100 (default: leave Premiere default)" },
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string; amount?: number; radius?: number; threshold?: number }) => {
        const setLines: string[] = [];
        if (args.amount !== undefined) setLines.push(`if (n === "Amount") prop.setValue(${args.amount}, true);`);
        if (args.radius !== undefined) setLines.push(`if (n === "Radius") prop.setValue(${args.radius}, true);`);
        if (args.threshold !== undefined) setLines.push(`if (n === "Threshold") prop.setValue(${args.threshold}, true);`);

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Unsharp Mask is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Unsharp Mask") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Unsharp Mask");
            if (!eff || !eff.name) return __error("Unsharp Mask effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Unsharp Mask") {
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

    apply_brightness_contrast: {
      description:
        "Apply Brightness & Contrast effect for quick tonal adjustments. " +
        "For finer color control, prefer Lumetri Color (color_correct or set_lumetri_creative). " +
        "Both params optional; only set what's specified.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          brightness: { type: "number", description: "Brightness adjustment -100 to 100 (default 0)" },
          contrast: { type: "number", description: "Contrast adjustment -100 to 100 (default 0)" },
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string; brightness?: number; contrast?: number }) => {
        const setLines: string[] = [];
        if (args.brightness !== undefined) setLines.push(`if (n === "Brightness") prop.setValue(${args.brightness}, true);`);
        if (args.contrast !== undefined) setLines.push(`if (n === "Contrast") prop.setValue(${args.contrast}, true);`);

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Brightness & Contrast is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Brightness & Contrast") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Brightness & Contrast");
            if (!eff || !eff.name) return __error("Brightness & Contrast effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Brightness & Contrast") {
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

    apply_camera_blur: {
      description:
        "Apply Camera Blur effect for depth-of-field / soft-focus look. percent_blur 0-100 (default 50). " +
        "Use lower values (10-30) for subtle focus shift, higher (50+) for strong defocus.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          percent_blur: { type: "number", description: "Blur intensity 0-100 (default: leave Premiere default)" },
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string; percent_blur?: number }) => {
        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Camera Blur is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Camera Blur") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Camera Blur");
            if (!eff || !eff.name) return __error("Camera Blur effect not found");
            qeClip.addVideoEffect(eff);
          }

          ${args.percent_blur !== undefined ? `
          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Camera Blur") {
              for (var p = 0; p < comp.properties.numItems; p++) {
                var prop = comp.properties[p];
                var n = prop.displayName;
                if (n === "Percent Blur" || n === "Blur Length" || n === "Blur") prop.setValue(${args.percent_blur}, true);
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

    burn_in_metadata: {
      description:
        "Apply 'Metadata & Timecode Burn-in' effect — burns clip metadata (timecode, clip name, source TC, marker comments) onto the rendered video. " +
        "More flexible than burn_in_timecode for QC workflows where you also want clip name / source TC visible. " +
        "Configure detailed fields via set_effect_property after apply.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
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
          if (result.trackType !== "video") return __error("Metadata burn-in is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Metadata & Timecode Burn-in") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Metadata & Timecode Burn-in");
            if (!eff || !eff.name) return __error("Metadata & Timecode Burn-in effect not found");
            qeClip.addVideoEffect(eff);
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

    apply_tint: {
      description:
        "Apply Tint effect to remap shadows + highlights to two colors. " +
        "amount_to_tint 0-100 controls how much of the tint is applied (default 100 = full).",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          amount_to_tint: { type: "number", description: "Tint intensity 0-100 (default Premiere 100)" },
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string; amount_to_tint?: number }) => {
        const setLines: string[] = [];
        if (args.amount_to_tint !== undefined) setLines.push(`if (n === "Amount to Tint") prop.setValue(${args.amount_to_tint}, true);`);

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Tint is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Tint") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Tint");
            if (!eff || !eff.name) return __error("Tint effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Tint") {
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

    apply_alpha_glow: {
      description:
        "Apply Alpha Glow effect — adds a colored glow around alpha edges. " +
        "Common for titles, logos, and stylized text.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          glow: { type: "number", description: "Glow radius/spread (default Premiere 25)" },
          brightness: { type: "number", description: "Glow brightness 0-255 (default 255)" },
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string; glow?: number; brightness?: number }) => {
        const setLines: string[] = [];
        if (args.glow !== undefined) setLines.push(`if (n === "Glow") prop.setValue(${args.glow}, true);`);
        if (args.brightness !== undefined) setLines.push(`if (n === "Brightness") prop.setValue(${args.brightness}, true);`);

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Alpha Glow is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Alpha Glow") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Alpha Glow");
            if (!eff || !eff.name) return __error("Alpha Glow effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Alpha Glow") {
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

    apply_posterize: {
      description:
        "Apply Posterize effect to quantize colors into discrete levels. " +
        "Lower level (e.g. 2-4) gives strong stylized look; higher (10+) is subtle.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          level: { type: "number", description: "Number of color levels per channel (default Premiere 7, range 2-200)" },
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string; level?: number }) => {
        const setLines: string[] = [];
        if (args.level !== undefined) setLines.push(`if (n === "Level") prop.setValue(${args.level}, true);`);

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Posterize is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Posterize") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Posterize");
            if (!eff || !eff.name) return __error("Posterize effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Posterize") {
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

    apply_threshold: {
      description:
        "Apply Threshold effect to convert image to high-contrast black/white based on luminance cutoff. " +
        "Level 0-1 (default 0.5) — pixels brighter than level become white, darker become black.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          level: { type: "number", description: "Luminance cutoff 0.0-1.0 (default 0.5)" },
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string; level?: number }) => {
        const setLines: string[] = [];
        if (args.level !== undefined) setLines.push(`if (n === "Level") prop.setValue(${args.level}, true);`);

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Threshold is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Threshold") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Threshold");
            if (!eff || !eff.name) return __error("Threshold effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Threshold") {
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

    apply_find_edges: {
      description:
        "Apply Find Edges effect — detects and highlights edges in the image (sketch-like look). " +
        "Optional invert + blend with original.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          invert: { type: "boolean", description: "Invert edges (white-on-black vs black-on-white)" },
          blend_with_original: { type: "number", description: "Blend with original 0.0-1.0 (default 0 = pure edges, 1 = no effect). Note: normalized — not percent." },
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string; invert?: boolean; blend_with_original?: number }) => {
        const setLines: string[] = [];
        if (args.invert !== undefined) setLines.push(`if (n === "Invert") prop.setValue(${args.invert ? "true" : "false"}, true);`);
        if (args.blend_with_original !== undefined) setLines.push(`if (n === "Blend With Original") prop.setValue(${args.blend_with_original}, true);`);

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Find Edges is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Find Edges") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Find Edges");
            if (!eff || !eff.name) return __error("Find Edges effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Find Edges") {
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

    apply_mirror: {
      description:
        "Apply Mirror effect — reflects image around a configurable axis. " +
        "reflection_center [x,y] normalized 0-1 (default [1, 0.5]); reflection_angle in degrees.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          center_x: { type: "number", description: "Reflection center X normalized 0-1 (default 1.0)" },
          center_y: { type: "number", description: "Reflection center Y normalized 0-1 (default 0.5)" },
          reflection_angle: { type: "number", description: "Reflection axis angle in degrees (default 0)" },
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string; center_x?: number; center_y?: number; reflection_angle?: number }) => {
        const setLines: string[] = [];
        if (args.center_x !== undefined || args.center_y !== undefined) {
          // Mirror's "Reflection Center" is [x, y] array; need to read current then set both
          const cx = args.center_x !== undefined ? args.center_x : `prop.getValue()[0]`;
          const cy = args.center_y !== undefined ? args.center_y : `prop.getValue()[1]`;
          setLines.push(`if (n === "Reflection Center") prop.setValue([${cx}, ${cy}], true);`);
        }
        if (args.reflection_angle !== undefined) setLines.push(`if (n === "Reflection Angle") prop.setValue(${args.reflection_angle}, true);`);

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Mirror is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Mirror") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Mirror");
            if (!eff || !eff.name) return __error("Mirror effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Mirror") {
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

    apply_sharpen: {
      description:
        "Apply Sharpen effect (simple sharpening — different from Unsharp Mask which has finer controls). " +
        "Use Unsharp Mask for radius/threshold control. This one has just amount.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          sharpen_amount: { type: "number", description: "Sharpen intensity 0-100 (default 0)" },
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string; sharpen_amount?: number }) => {
        const setLines: string[] = [];
        if (args.sharpen_amount !== undefined) setLines.push(`if (n === "Sharpen Amount") prop.setValue(${args.sharpen_amount}, true);`);

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Sharpen is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Sharpen") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Sharpen");
            if (!eff || !eff.name) return __error("Sharpen effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Sharpen") {
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

    apply_proc_amp: {
      description:
        "Apply ProcAmp effect — broadcast-style brightness/contrast/hue/saturation in one wrapper. " +
        "Different from Lumetri (lighter, faster, broadcast convention). " +
        "Brightness default 0, Contrast/Saturation default 100, Hue default 0 degrees.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          brightness: { type: "number", description: "Brightness offset (default 0)" },
          contrast: { type: "number", description: "Contrast 0-200 (default 100)" },
          hue: { type: "number", description: "Hue rotation in degrees (default 0)" },
          saturation: { type: "number", description: "Saturation 0-200 (default 100)" },
          split_screen: { type: "boolean", description: "Show split-screen comparison (before/after)" },
          split_percent: { type: "number", description: "Split position percent 0-100 (default 50)" },
        },
        required: ["node_id"],
      },
      handler: async (args: {
        node_id: string;
        brightness?: number;
        contrast?: number;
        hue?: number;
        saturation?: number;
        split_screen?: boolean;
        split_percent?: number;
      }) => {
        const setLines: string[] = [];
        if (args.brightness !== undefined) setLines.push(`if (n === "Brightness") prop.setValue(${args.brightness}, true);`);
        if (args.contrast !== undefined) setLines.push(`if (n === "Contrast") prop.setValue(${args.contrast}, true);`);
        if (args.hue !== undefined) setLines.push(`if (n === "Hue") prop.setValue(${args.hue}, true);`);
        if (args.saturation !== undefined) setLines.push(`if (n === "Saturation") prop.setValue(${args.saturation}, true);`);
        if (args.split_screen !== undefined) setLines.push(`if (n === "Split Screen") prop.setValue(${args.split_screen ? "true" : "false"}, true);`);
        if (args.split_percent !== undefined) setLines.push(`if (n === "Split Percent") prop.setValue(${args.split_percent}, true);`);

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("ProcAmp is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "ProcAmp") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("ProcAmp");
            if (!eff || !eff.name) return __error("ProcAmp effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "ProcAmp") {
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

    apply_echo: {
      description:
        "Apply Echo effect — frame ghosting/trails. Negative echo_time creates trailing echoes (ghosts of past frames), positive creates upcoming.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          echo_time: { type: "number", description: "Time delay between echoes in seconds (default -1/30 for one-frame trail)" },
          number_of_echoes: { type: "number", description: "Number of ghost frames (default 1)" },
          starting_intensity: { type: "number", description: "Intensity of first echo 0-1 (default 1)" },
          decay: { type: "number", description: "Decay multiplier per echo 0-1 (default 1 = no decay)" },
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string; echo_time?: number; number_of_echoes?: number; starting_intensity?: number; decay?: number }) => {
        const setLines: string[] = [];
        if (args.echo_time !== undefined) setLines.push(`if (n === "Echo Time (seconds)") prop.setValue(${args.echo_time}, true);`);
        if (args.number_of_echoes !== undefined) setLines.push(`if (n === "Number Of Echoes") prop.setValue(${args.number_of_echoes}, true);`);
        if (args.starting_intensity !== undefined) setLines.push(`if (n === "Starting Intensity") prop.setValue(${args.starting_intensity}, true);`);
        if (args.decay !== undefined) setLines.push(`if (n === "Decay") prop.setValue(${args.decay}, true);`);

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Echo is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Echo") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Echo");
            if (!eff || !eff.name) return __error("Echo effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Echo") {
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

    apply_solarize: {
      description:
        "Apply Solarize effect — luminance values above threshold are inverted (creates psychedelic / overexposed look).",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          threshold: { type: "number", description: "Luminance threshold 0-255 (default 128 = midpoint)" },
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string; threshold?: number }) => {
        const setLines: string[] = [];
        if (args.threshold !== undefined) setLines.push(`if (n === "Threshold") prop.setValue(${args.threshold}, true);`);

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Solarize is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Solarize") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Solarize");
            if (!eff || !eff.name) return __error("Solarize effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Solarize") {
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

    apply_spherize: {
      description:
        "Apply Spherize effect — bulge (positive radius) or pinch (negative radius) image around a center point. Useful for fish-eye / lens caricature.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          radius: { type: "number", description: "Bulge radius (positive = bulge out, negative = pinch in, 0 = no effect)" },
          center_x: { type: "number", description: "Sphere center X normalized 0-1 (default 0.5)" },
          center_y: { type: "number", description: "Sphere center Y normalized 0-1 (default 0.5)" },
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string; radius?: number; center_x?: number; center_y?: number }) => {
        const setLines: string[] = [];
        if (args.radius !== undefined) setLines.push(`if (n === "Radius") prop.setValue(${args.radius}, true);`);
        if (args.center_x !== undefined || args.center_y !== undefined) {
          const cx = args.center_x !== undefined ? args.center_x : `prop.getValue()[0]`;
          const cy = args.center_y !== undefined ? args.center_y : `prop.getValue()[1]`;
          setLines.push(`if (n === "Center of Sphere") prop.setValue([${cx}, ${cy}], true);`);
        }

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Spherize is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Spherize") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Spherize");
            if (!eff || !eff.name) return __error("Spherize effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Spherize") {
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

    apply_twirl: {
      description:
        "Apply Twirl effect — swirls pixels around a center point. Useful for portal/vortex transitions and stylized distortions.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          angle: { type: "number", description: "Twirl angle in degrees (default 0). Positive = clockwise; large values = strong swirl." },
          twirl_radius: { type: "number", description: "Twirl effective radius 0-100 (default 30)" },
          center_x: { type: "number", description: "Twirl center X normalized 0-1 (default 0.5)" },
          center_y: { type: "number", description: "Twirl center Y normalized 0-1 (default 0.5)" },
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string; angle?: number; twirl_radius?: number; center_x?: number; center_y?: number }) => {
        const setLines: string[] = [];
        if (args.angle !== undefined) setLines.push(`if (n === "Angle") prop.setValue(${args.angle}, true);`);
        if (args.twirl_radius !== undefined) setLines.push(`if (n === "Twirl Radius") prop.setValue(${args.twirl_radius}, true);`);
        if (args.center_x !== undefined || args.center_y !== undefined) {
          const cx = args.center_x !== undefined ? args.center_x : `prop.getValue()[0]`;
          const cy = args.center_y !== undefined ? args.center_y : `prop.getValue()[1]`;
          setLines.push(`if (n === "Twirl Center") prop.setValue([${cx}, ${cy}], true);`);
        }

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Twirl is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Twirl") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Twirl");
            if (!eff || !eff.name) return __error("Twirl effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Twirl") {
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

    apply_wave_warp: {
      description:
        "Apply Wave Warp effect — sinusoidal/triangle/square wave distortion. Useful for water reflections, heat haze, animated stylization.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          wave_type: { type: "number", description: "Wave shape enum (0=Sine, 1=Triangle, 2=Square, 3=Saw, 4=Inverse Saw, 5=Noise, 6=Smooth Noise). Default 0." },
          wave_height: { type: "number", description: "Wave amplitude in pixels (default 10)" },
          wave_width: { type: "number", description: "Wavelength in pixels (default 40)" },
          direction: { type: "number", description: "Wave direction in degrees 0-360 (default 90)" },
          wave_speed: { type: "number", description: "Animation speed (default 1)" },
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string; wave_type?: number; wave_height?: number; wave_width?: number; direction?: number; wave_speed?: number }) => {
        const setLines: string[] = [];
        if (args.wave_type !== undefined) setLines.push(`if (n === "Wave Type") prop.setValue(${args.wave_type}, true);`);
        if (args.wave_height !== undefined) setLines.push(`if (n === "Wave Height") prop.setValue(${args.wave_height}, true);`);
        if (args.wave_width !== undefined) setLines.push(`if (n === "Wave Width") prop.setValue(${args.wave_width}, true);`);
        if (args.direction !== undefined) setLines.push(`if (n === "Direction") prop.setValue(${args.direction}, true);`);
        if (args.wave_speed !== undefined) setLines.push(`if (n === "Wave Speed") prop.setValue(${args.wave_speed}, true);`);

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Wave Warp is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Wave Warp") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Wave Warp");
            if (!eff || !eff.name) return __error("Wave Warp effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Wave Warp") {
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

    apply_bevel_alpha: {
      description:
        "Apply Bevel Alpha effect — adds 3D bevel based on the alpha channel (edges of opaque areas get raised look). Common for titles and logos.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          edge_thickness: { type: "number", description: "Edge thickness in pixels (default 2)" },
          light_angle: { type: "number", description: "Light direction in degrees (default -60)" },
          light_intensity: { type: "number", description: "Light intensity 0-1 (default ~0.4)" },
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string; edge_thickness?: number; light_angle?: number; light_intensity?: number }) => {
        const setLines: string[] = [];
        if (args.edge_thickness !== undefined) setLines.push(`if (n === "Edge Thickness") prop.setValue(${args.edge_thickness}, true);`);
        if (args.light_angle !== undefined) setLines.push(`if (n === "Light Angle") prop.setValue(${args.light_angle}, true);`);
        if (args.light_intensity !== undefined) setLines.push(`if (n === "Light Intensity") prop.setValue(${args.light_intensity}, true);`);

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Bevel Alpha is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Bevel Alpha") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Bevel Alpha");
            if (!eff || !eff.name) return __error("Bevel Alpha effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Bevel Alpha") {
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

    apply_noise: {
      description:
        "Apply Noise effect — add grain/noise to image. Useful for film look, masking compression artifacts, or stylized texture.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          amount_of_noise: { type: "number", description: "Noise amount 0-100 percent (default 0)" },
          use_color_noise: { type: "boolean", description: "Color noise vs monochrome (default true = color)" },
          clip_result_values: { type: "boolean", description: "Clip noise to legal values (default true)" },
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string; amount_of_noise?: number; use_color_noise?: boolean; clip_result_values?: boolean }) => {
        const setLines: string[] = [];
        if (args.amount_of_noise !== undefined) setLines.push(`if (n === "Amount of Noise") prop.setValue(${args.amount_of_noise}, true);`);
        if (args.use_color_noise !== undefined) setLines.push(`if (n === "Use Color Noise") prop.setValue(${args.use_color_noise ? "true" : "false"}, true);`);
        if (args.clip_result_values !== undefined) setLines.push(`if (n === "Clip Result Values") prop.setValue(${args.clip_result_values ? "true" : "false"}, true);`);

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Noise is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Noise") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Noise");
            if (!eff || !eff.name) return __error("Noise effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Noise") {
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

    apply_dust_and_scratches: {
      description:
        "Apply Dust & Scratches effect — reduces small dust/scratch artifacts in archival/scanned footage by smoothing pixels that differ strongly from neighbors.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          radius: { type: "number", description: "Search radius in pixels (default 1, larger = stronger but blurrier)" },
          threshold: { type: "number", description: "Threshold 0.0-1.0 normalized (default 0). Higher = preserve more detail (only smooth larger differences). Note: normalized — not 0-255 like Premiere UI may suggest." },
          operate_on_alpha: { type: "boolean", description: "Apply to alpha channel too (default false)" },
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string; radius?: number; threshold?: number; operate_on_alpha?: boolean }) => {
        const setLines: string[] = [];
        if (args.radius !== undefined) setLines.push(`if (n === "Radius") prop.setValue(${args.radius}, true);`);
        if (args.threshold !== undefined) setLines.push(`if (n === "Threshold") prop.setValue(${args.threshold}, true);`);
        if (args.operate_on_alpha !== undefined) setLines.push(`if (n === "Operate on Alpha channel") prop.setValue(${args.operate_on_alpha ? "true" : "false"}, true);`);

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Dust & Scratches is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Dust & Scratches") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Dust & Scratches");
            if (!eff || !eff.name) return __error("Dust & Scratches effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Dust & Scratches") {
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

    apply_replicate: {
      description:
        "Apply Replicate effect — divides screen into a grid and shows a scaled-down copy of the clip in each cell. Useful for warhol/multiplication looks.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          count: { type: "number", description: "Grid size NxN (default 2 → 2x2 = 4 copies). Integer 2-10. Higher = more cells, smaller copies." },
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string; count?: number }) => {
        const setLines: string[] = [];
        if (args.count !== undefined) setLines.push(`if (n === "Count") prop.setValue(${Math.round(args.count)}, true);`);

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Replicate is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Replicate") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Replicate");
            if (!eff || !eff.name) return __error("Replicate effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Replicate") {
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

    apply_roughen_edges: {
      description:
        "Apply Roughen Edges effect — distorts alpha edges with fractal noise for grungy/torn-paper looks. Multiple edge styles (rough/spiky/photocopy/rusty etc.).",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          edge_type: { type: "number", description: "Edge style 0-8: 0=Roughen, 1=Roughen Color, 2=Cut, 3=Spiky, 4=Stained Glass, 5=Photocopy, 6=Photocopy Color, 7=Rusty, 8=Rusty Color (default 0)" },
          border: { type: "number", description: "Border thickness in pixels (default 8)" },
          edge_sharpness: { type: "number", description: "Edge sharpness (default 1, higher = harder edges)" },
          fractal_influence: { type: "number", description: "Fractal noise contribution 0-2 (default 1)" },
          scale: { type: "number", description: "Fractal scale (default 100)" },
          complexity: { type: "number", description: "Noise complexity 1-10 integer (default 2)" },
          evolution: { type: "number", description: "Evolution angle in degrees (default 0). Animate to evolve fractal pattern." },
        },
        required: ["node_id"],
      },
      handler: async (args: {
        node_id: string;
        edge_type?: number;
        border?: number;
        edge_sharpness?: number;
        fractal_influence?: number;
        scale?: number;
        complexity?: number;
        evolution?: number;
      }) => {
        const setLines: string[] = [];
        if (args.edge_type !== undefined) setLines.push(`if (n === "Edge Type") prop.setValue(${Math.round(args.edge_type)}, true);`);
        if (args.border !== undefined) setLines.push(`if (n === "Border") prop.setValue(${args.border}, true);`);
        if (args.edge_sharpness !== undefined) setLines.push(`if (n === "Edge Sharpness") prop.setValue(${args.edge_sharpness}, true);`);
        if (args.fractal_influence !== undefined) setLines.push(`if (n === "Fractal Influence") prop.setValue(${args.fractal_influence}, true);`);
        if (args.scale !== undefined) setLines.push(`if (n === "Scale") prop.setValue(${args.scale}, true);`);
        if (args.complexity !== undefined) setLines.push(`if (n === "Complexity") prop.setValue(${Math.round(args.complexity)}, true);`);
        if (args.evolution !== undefined) setLines.push(`if (n === "Evolution") prop.setValue(${args.evolution}, true);`);

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Roughen Edges is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Roughen Edges") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Roughen Edges");
            if (!eff || !eff.name) return __error("Roughen Edges effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Roughen Edges") {
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

    apply_bevel_edges: {
      description:
        "Apply Bevel Edges effect — adds 3D-look bevel along the rectangular frame edges. For rounded/alpha-shaped bevels use apply_bevel_alpha instead.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          edge_thickness: { type: "number", description: "Edge thickness 0.0-1.0 normalized (default 0.1). Note: normalized, not pixels." },
          light_angle: { type: "number", description: "Light angle in degrees (default -60)" },
          light_intensity: { type: "number", description: "Light intensity 0.0-1.0 normalized (default 0.4)" },
        },
        required: ["node_id"],
      },
      handler: async (args: {
        node_id: string;
        edge_thickness?: number;
        light_angle?: number;
        light_intensity?: number;
      }) => {
        const setLines: string[] = [];
        if (args.edge_thickness !== undefined) setLines.push(`if (n === "Edge Thickness") prop.setValue(${args.edge_thickness}, true);`);
        if (args.light_angle !== undefined) setLines.push(`if (n === "Light Angle") prop.setValue(${args.light_angle}, true);`);
        if (args.light_intensity !== undefined) setLines.push(`if (n === "Light Intensity") prop.setValue(${args.light_intensity}, true);`);

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Bevel Edges is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Bevel Edges") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Bevel Edges");
            if (!eff || !eff.name) return __error("Bevel Edges effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Bevel Edges") {
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

    apply_reduce_interlace_flicker: {
      description:
        "Apply Reduce Interlace Flicker effect — softens horizontal lines that flicker on interlaced output (typical of fine high-contrast detail in 1080i/SD).",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          softness: { type: "number", description: "Softness amount (default 0). Higher = stronger vertical blur to suppress flicker. Typical range 0.0-2.0." },
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string; softness?: number }) => {
        const setLines: string[] = [];
        if (args.softness !== undefined) setLines.push(`if (n === "Softness") prop.setValue(${args.softness}, true);`);

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Reduce Interlace Flicker is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Reduce Interlace Flicker") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Reduce Interlace Flicker");
            if (!eff || !eff.name) return __error("Reduce Interlace Flicker effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Reduce Interlace Flicker") {
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

    apply_turbulent_displace: {
      description:
        "Apply Turbulent Displace effect — fractal-noise displacement for water/heat-haze/organic distortion. Use Twist mode for warp-zoom looks; animate Evolution for movement.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          displacement: { type: "number", description: "Mode enum: 0=Turbulent (default), 1=Turbulent Smoother, 2=Bulge, 3=Bulge Smoother, 4=Twist, 5=Twist Smoother, 6=Vertical, 7=Horizontal, 8=Cross" },
          amount: { type: "number", description: "Distortion amount (default 50)" },
          size: { type: "number", description: "Noise size (default 100)" },
          offset_x: { type: "number", description: "Offset X 0.0-1.0 (default 0.5)" },
          offset_y: { type: "number", description: "Offset Y 0.0-1.0 (default 0.5)" },
          complexity: { type: "number", description: "Noise complexity 1-10 (default 1)" },
          evolution: { type: "number", description: "Evolution angle in degrees (default 0). Animate for motion." },
          pinning: { type: "number", description: "Edge pinning enum (default 2)" },
          resize_layer: { type: "boolean", description: "Resize layer to fit displaced result (default false)" },
        },
        required: ["node_id"],
      },
      handler: async (args: any) => {
        const setLines: string[] = [];
        if (args.displacement !== undefined) setLines.push(`if (n === "Displacement") prop.setValue(${Math.round(args.displacement)}, true);`);
        if (args.amount !== undefined) setLines.push(`if (n === "Amount") prop.setValue(${args.amount}, true);`);
        if (args.size !== undefined) setLines.push(`if (n === "Size") prop.setValue(${args.size}, true);`);
        if (args.offset_x !== undefined || args.offset_y !== undefined) {
          const ox = args.offset_x ?? 0.5;
          const oy = args.offset_y ?? 0.5;
          setLines.push(`if (n === "Offset (Turbulence)") prop.setValue([${ox}, ${oy}], true);`);
        }
        if (args.complexity !== undefined) setLines.push(`if (n === "Complexity") prop.setValue(${args.complexity}, true);`);
        if (args.evolution !== undefined) setLines.push(`if (n === "Evolution") prop.setValue(${args.evolution}, true);`);
        if (args.pinning !== undefined) setLines.push(`if (n === "Pinning") prop.setValue(${Math.round(args.pinning)}, true);`);
        if (args.resize_layer !== undefined) setLines.push(`if (n === "Resize Layer") prop.setValue(${args.resize_layer ? "true" : "false"}, true);`);

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Turbulent Displace is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Turbulent Displace") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Turbulent Displace");
            if (!eff || !eff.name) return __error("Turbulent Displace effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Turbulent Displace") {
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

    apply_arithmetic: {
      description:
        "Apply Arithmetic effect — simple per-channel arithmetic between source and a constant RGB color. Lightweight alternative to Compound Arithmetic; no second-source layer needed.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          operator: { type: "number", description: "Operator enum (default 2). Common: 0=And, 1=Or, 2=Xor, 3=Add, 4=Subtract, 5=Multiply, 6=Difference, 7=Max, 8=Min." },
          red_value: { type: "number", description: "Red constant 0-255 (default 0)" },
          green_value: { type: "number", description: "Green constant 0-255 (default 0)" },
          blue_value: { type: "number", description: "Blue constant 0-255 (default 0)" },
          clip_result_values: { type: "boolean", description: "Clip result to valid 0-255 range (default true)" },
        },
        required: ["node_id"],
      },
      handler: async (args: {
        node_id: string;
        operator?: number;
        red_value?: number; green_value?: number; blue_value?: number;
        clip_result_values?: boolean;
      }) => {
        const setLines: string[] = [];
        if (args.operator !== undefined) setLines.push(`if (n === "Operator") prop.setValue(${Math.round(args.operator)}, true);`);
        if (args.red_value !== undefined) setLines.push(`if (n === "Red Value") prop.setValue(${args.red_value}, true);`);
        if (args.green_value !== undefined) setLines.push(`if (n === "Green Value") prop.setValue(${args.green_value}, true);`);
        if (args.blue_value !== undefined) setLines.push(`if (n === "Blue Value") prop.setValue(${args.blue_value}, true);`);
        if (args.clip_result_values !== undefined) setLines.push(`if (n === "Clip Result Values") prop.setValue(${args.clip_result_values ? "true" : "false"}, true);`);

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Arithmetic is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Arithmetic") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Arithmetic");
            if (!eff || !eff.name) return __error("Arithmetic effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Arithmetic") {
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

    apply_auto_reframe: {
      description:
        "Apply Auto Reframe effect — Adobe Sensei AI-driven reframing for aspect-ratio change (16:9 → 9:16 or square). Auto-tracks subject and generates Position/Scale keyframes. Wrapper exposes only user-controllable params; auto-generated keyframes managed by Premiere internally.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          motion_tracking: { type: "number", description: "Tracking quality enum: 0=Slower (More Precise), 1=Default, 2=Faster (Less Precise)" },
          overwrite_generated_path: { type: "boolean", description: "Overwrite auto-generated path with manual values (default false)" },
          reframe_offset_x: { type: "number", description: "Manual offset X (used when overwrite=true)" },
          reframe_offset_y: { type: "number", description: "Manual offset Y" },
          reframe_scale: { type: "number", description: "Manual scale percent" },
          reframe_rotation: { type: "number", description: "Manual rotation in degrees" },
        },
        required: ["node_id"],
      },
      handler: async (args: any) => {
        const setLines: string[] = [];
        if (args.motion_tracking !== undefined) setLines.push(`if (n === "Motion Tracking") prop.setValue(${Math.round(args.motion_tracking)}, true);`);
        if (args.overwrite_generated_path !== undefined) setLines.push(`if (n === "Overwrite generated path") prop.setValue(${args.overwrite_generated_path ? "true" : "false"}, true);`);
        if (args.reframe_offset_x !== undefined || args.reframe_offset_y !== undefined) {
          const ox = args.reframe_offset_x ?? 0;
          const oy = args.reframe_offset_y ?? 0;
          setLines.push(`if (n === "Reframe Offset") prop.setValue([${ox}, ${oy}], true);`);
        }
        if (args.reframe_scale !== undefined) setLines.push(`if (n === "Reframe Scale") prop.setValue(${args.reframe_scale}, true);`);
        if (args.reframe_rotation !== undefined) setLines.push(`if (n === "Reframe Rotation") prop.setValue(${args.reframe_rotation}, true);`);

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Auto Reframe is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Auto Reframe") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Auto Reframe");
            if (!eff || !eff.name) return __error("Auto Reframe effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Auto Reframe") {
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

    apply_radial_shadow: {
      description:
        "Apply Radial Shadow effect — drop shadow with a point light source (radial casting), unlike Drop Shadow's directional offset. Useful for stage spotlights, magnifying glass shadows.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          shadow_color: { type: "array", items: { type: "number" }, description: "Shadow color [R,G,B] 0-255 (optional 4th alpha). Default black." },
          opacity: { type: "number", description: "Shadow opacity 0.0-1.0 normalized (default 0.5). Note: NOT 0-100." },
          light_x: { type: "number", description: "Light source X 0.0-1.0 (default 0.25)" },
          light_y: { type: "number", description: "Light source Y 0.0-1.0 (default 0.25)" },
          projection_distance: { type: "number", description: "Shadow projection distance (default 10)" },
          softness: { type: "number", description: "Shadow softness in pixels (default 0)" },
          render: { type: "number", description: "Render mode: 0=Regular (default), 1=Glass Edge" },
          color_influence: { type: "number", description: "Color influence 0-1 (default 1)" },
          shadow_only: { type: "boolean", description: "Render only shadow (no source layer) (default false)" },
          resize_layer: { type: "boolean", description: "Resize layer for shadow extent (default false)" },
        },
        required: ["node_id"],
      },
      handler: async (args: any) => {
        const setLines: string[] = [];
        if (args.opacity !== undefined) setLines.push(`if (n === "Opacity") prop.setValue(${args.opacity}, true);`);
        if (args.light_x !== undefined || args.light_y !== undefined) {
          const lx = args.light_x ?? 0.25;
          const ly = args.light_y ?? 0.25;
          setLines.push(`if (n === "Light Source") prop.setValue([${lx}, ${ly}], true);`);
        }
        if (args.projection_distance !== undefined) setLines.push(`if (n === "Projection Distance") prop.setValue(${args.projection_distance}, true);`);
        if (args.softness !== undefined) setLines.push(`if (n === "Softness") prop.setValue(${args.softness}, true);`);
        if (args.render !== undefined) setLines.push(`if (n === "Render") prop.setValue(${Math.round(args.render)}, true);`);
        if (args.color_influence !== undefined) setLines.push(`if (n === "Color Influence") prop.setValue(${args.color_influence}, true);`);
        if (args.shadow_only !== undefined) setLines.push(`if (n === "Shadow Only") prop.setValue(${args.shadow_only ? "true" : "false"}, true);`);
        if (args.resize_layer !== undefined) setLines.push(`if (n === "Resize Layer") prop.setValue(${args.resize_layer ? "true" : "false"}, true);`);
        if (args.shadow_color && args.shadow_color.length >= 3) {
          const [r, g, b] = args.shadow_color;
          const a = args.shadow_color[3] ?? 255;
          setLines.push(`if (n === "Shadow Color") prop.setColorValue(${r}, ${g}, ${b}, ${a});`);
        }

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Radial Shadow is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Radial Shadow") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Radial Shadow");
            if (!eff || !eff.name) return __error("Radial Shadow effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Radial Shadow") {
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

    apply_paint_bucket: {
      description:
        "Apply Paint Bucket effect — flood-fills a contiguous color region with a chosen color. Useful for animated color replacement on solid-color cartoon/UI elements.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          fill_x: { type: "number", description: "Fill seed point X 0.0-1.0 (default 0.5)" },
          fill_y: { type: "number", description: "Fill seed point Y 0.0-1.0 (default 0.5)" },
          fill_selector: { type: "number", description: "Fill mode enum (default 0=Color & Alpha). Other: 1=Straight Color, 2=Transparency, 3=Opacity, 4=Alpha Channel." },
          tolerance: { type: "number", description: "Color match tolerance 0-255 (default 50). Higher = wider color range filled." },
          stroke: { type: "number", description: "Stroke style enum (default 0=Antialias)" },
          contextual_slider: { type: "number", description: "Stroke-specific value (default 3, meaning depends on stroke enum)" },
          invert_fill: { type: "boolean", description: "Invert fill region (default false)" },
          color: { type: "array", items: { type: "number" }, description: "Fill color [R,G,B] 0-255 (optional 4th alpha)" },
          opacity: { type: "number", description: "Fill opacity 0-100 (default 100)" },
          blending_mode: { type: "number", description: "Blend mode int (default 1)" },
        },
        required: ["node_id"],
      },
      handler: async (args: any) => {
        const setLines: string[] = [];
        if (args.fill_x !== undefined || args.fill_y !== undefined) {
          const fx = args.fill_x ?? 0.5;
          const fy = args.fill_y ?? 0.5;
          setLines.push(`if (n === "Fill Point") prop.setValue([${fx}, ${fy}], true);`);
        }
        if (args.fill_selector !== undefined) setLines.push(`if (n === "Fill Selector") prop.setValue(${Math.round(args.fill_selector)}, true);`);
        if (args.tolerance !== undefined) setLines.push(`if (n === "Tolerance") prop.setValue(${args.tolerance}, true);`);
        if (args.stroke !== undefined) setLines.push(`if (n === "Stroke") prop.setValue(${Math.round(args.stroke)}, true);`);
        if (args.contextual_slider !== undefined) setLines.push(`if (n === "Contextual Slider") prop.setValue(${args.contextual_slider}, true);`);
        if (args.invert_fill !== undefined) setLines.push(`if (n === "Invert Fill") prop.setValue(${args.invert_fill ? "true" : "false"}, true);`);
        if (args.opacity !== undefined) setLines.push(`if (n === "Opacity") prop.setValue(${args.opacity}, true);`);
        if (args.blending_mode !== undefined) setLines.push(`if (n === "Blending Mode") prop.setValue(${Math.round(args.blending_mode)}, true);`);
        if (args.color && args.color.length >= 3) {
          const [r, g, b] = args.color;
          const a = args.color[3] ?? 255;
          setLines.push(`if (n === "Color") prop.setColorValue(${r}, ${g}, ${b}, ${a});`);
        }

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Paint Bucket is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Paint Bucket") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Paint Bucket");
            if (!eff || !eff.name) return __error("Paint Bucket effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Paint Bucket") {
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

    apply_lightning: {
      description:
        "Apply Lightning effect — animated lightning generator with branching, jaggedness, and width. Common for sci-fi/storm scenes. 25 properties — wrapper exposes the most useful subset (start/end points, branching, color, width, speed, random_seed).",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          start_x: { type: "number", description: "Start point X 0.0-1.0 (default 0.25)" },
          start_y: { type: "number", description: "Start point Y 0.0-1.0 (default 0.5)" },
          end_x: { type: "number", description: "End point X 0.0-1.0 (default 0.75)" },
          end_y: { type: "number", description: "End point Y 0.0-1.0 (default 0.5)" },
          segments: { type: "number", description: "Main bolt segments (default 7). More = jaggier." },
          amplitude: { type: "number", description: "Main bolt amplitude/zigzag (default 10)" },
          detail_level: { type: "number", description: "Detail level (default 2)" },
          detail_amplitude: { type: "number", description: "Detail amplitude 0-1 (default 0.3)" },
          branching: { type: "number", description: "Branching probability 0-1 (default 0.2)" },
          rebranching: { type: "number", description: "Rebranching probability 0-1 (default 0.1)" },
          branch_angle: { type: "number", description: "Branch angle in degrees (default 20)" },
          branch_seg_length: { type: "number", description: "Branch segment length 0-1 (default 0.5)" },
          branch_segments: { type: "number", description: "Branch segments per branch (default 4)" },
          branch_width: { type: "number", description: "Branch width 0-1 (default 0.7)" },
          speed: { type: "number", description: "Animation speed (default 10)" },
          stability: { type: "number", description: "Stability 0-1 (default 0.3)" },
          fixed_endpoint: { type: "boolean", description: "Fix endpoint position (default true)" },
          width: { type: "number", description: "Bolt width in pixels (default 10)" },
          width_variation: { type: "number", description: "Width variation 0-1 (default 0)" },
          core_width: { type: "number", description: "Core (bright center) width 0-1 (default 0.4)" },
          outside_color: { type: "array", items: { type: "number" }, description: "Outer glow color [R,G,B] 0-255. Default green-blue." },
          inside_color: { type: "array", items: { type: "number" }, description: "Inside (core) color [R,G,B] 0-255. Default white." },
          random_seed: { type: "number", description: "Random seed (default 1)" },
          blending_mode: { type: "number", description: "Blend mode int (default 1=Add)" },
          rerun_at_each_frame: { type: "boolean", description: "Rerun simulation each frame (default false). True = animated lightning." },
        },
        required: ["node_id"],
      },
      handler: async (args: any) => {
        const setLines: string[] = [];
        if (args.start_x !== undefined || args.start_y !== undefined) {
          const sx = args.start_x ?? 0.25;
          const sy = args.start_y ?? 0.5;
          setLines.push(`if (n === "Start point") prop.setValue([${sx}, ${sy}], true);`);
        }
        if (args.end_x !== undefined || args.end_y !== undefined) {
          const ex = args.end_x ?? 0.75;
          const ey = args.end_y ?? 0.5;
          setLines.push(`if (n === "End point") prop.setValue([${ex}, ${ey}], true);`);
        }
        const numericMap: [string, number | undefined][] = [
          ["Segments", args.segments], ["Amplitude", args.amplitude],
          ["Detail Level", args.detail_level], ["Detail Amplitude", args.detail_amplitude],
          ["Branching", args.branching], ["Rebranching", args.rebranching],
          ["Branch Angle", args.branch_angle], ["Branch Seg. Length", args.branch_seg_length],
          ["Branch Segments", args.branch_segments], ["Branch Width", args.branch_width],
          ["Speed", args.speed], ["Stability", args.stability],
          ["Width", args.width], ["Width Variation", args.width_variation], ["Core Width", args.core_width],
          ["Random Seed", args.random_seed], ["Blending Mode", args.blending_mode],
        ];
        for (const [n, v] of numericMap) {
          if (v !== undefined) setLines.push(`if (n === "${n}") prop.setValue(${v}, true);`);
        }
        if (args.fixed_endpoint !== undefined) setLines.push(`if (n === "Fixed Endpoint") prop.setValue(${args.fixed_endpoint ? "true" : "false"}, true);`);
        if (args.rerun_at_each_frame !== undefined) setLines.push(`if (n === "Rerun At Each Frame") prop.setValue(${args.rerun_at_each_frame ? "true" : "false"}, true);`);
        if (args.outside_color && args.outside_color.length >= 3) {
          const [r, g, b] = args.outside_color;
          const a = args.outside_color[3] ?? 255;
          setLines.push(`if (n === "Outside Color") prop.setColorValue(${r}, ${g}, ${b}, ${a});`);
        }
        if (args.inside_color && args.inside_color.length >= 3) {
          const [r, g, b] = args.inside_color;
          const a = args.inside_color[3] ?? 255;
          setLines.push(`if (n === "Inside Color") prop.setColorValue(${r}, ${g}, ${b}, ${a});`);
        }

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Lightning is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Lightning") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Lightning");
            if (!eff || !eff.name) return __error("Lightning effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Lightning") {
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

    apply_vector_motion: {
      description:
        "Apply Vector Motion effect — secondary motion controls (position/scale/rotation/anchor) that stack with the intrinsic Motion. Useful when you want to keyframe two layers of transforms independently — for example, intrinsic Motion drives the camera move, Vector Motion drives a wobble.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          position_x: { type: "number", description: "Position X 0.0-1.0 normalized (default 0.5)" },
          position_y: { type: "number", description: "Position Y 0.0-1.0 normalized (default 0.5)" },
          scale: { type: "number", description: "Uniform scale percent (default 100)" },
          scale_width: { type: "number", description: "Width scale percent when uniform_scale=false (default 100)" },
          uniform_scale: { type: "boolean", description: "Lock scale_width to scale (default true)" },
          rotation: { type: "number", description: "Rotation in degrees (default 0)" },
          anchor_x: { type: "number", description: "Anchor X 0.0-1.0 (default 0.5)" },
          anchor_y: { type: "number", description: "Anchor Y 0.0-1.0 (default 0.5)" },
        },
        required: ["node_id"],
      },
      handler: async (args: {
        node_id: string;
        position_x?: number; position_y?: number;
        scale?: number; scale_width?: number; uniform_scale?: boolean;
        rotation?: number;
        anchor_x?: number; anchor_y?: number;
      }) => {
        const setLines: string[] = [];
        if (args.position_x !== undefined || args.position_y !== undefined) {
          const px = args.position_x ?? 0.5;
          const py = args.position_y ?? 0.5;
          setLines.push(`if (n === "Position") prop.setValue([${px}, ${py}], true);`);
        }
        if (args.scale !== undefined) setLines.push(`if (n === "Scale") prop.setValue(${args.scale}, true);`);
        if (args.scale_width !== undefined) setLines.push(`if (n === "Scale Width") prop.setValue(${args.scale_width}, true);`);
        if (args.uniform_scale !== undefined) setLines.push(`if (n === "Uniform Scale") prop.setValue(${args.uniform_scale ? "true" : "false"}, true);`);
        if (args.rotation !== undefined) setLines.push(`if (n === "Rotation") prop.setValue(${args.rotation}, true);`);
        if (args.anchor_x !== undefined || args.anchor_y !== undefined) {
          const ax = args.anchor_x ?? 0.5;
          const ay = args.anchor_y ?? 0.5;
          setLines.push(`if (n === "Anchor Point") prop.setValue([${ax}, ${ay}], true);`);
        }

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Vector Motion is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Vector Motion") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Vector Motion");
            if (!eff || !eff.name) return __error("Vector Motion effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Vector Motion") {
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

    apply_eyedropper_fill: {
      description:
        "Apply Eyedropper Fill effect — fills the entire clip with a color sampled from a single point (or averaged area) of the source. Animate `sample_point` to drive a clip's color from a moving feature in the source.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          sample_x: { type: "number", description: "Sample X 0.0-1.0 (default 0.5)" },
          sample_y: { type: "number", description: "Sample Y 0.0-1.0 (default 0.5)" },
          sample_radius: { type: "number", description: "Sample radius in pixels (default 10). Larger = averages more pixels around point." },
          average_pixel_colors: { type: "number", description: "Averaging mode enum (default 0=Skip Empty/Hidden Pixels)" },
          maintain_original_alpha: { type: "boolean", description: "Preserve source alpha (default false)" },
          blend_with_original: { type: "number", description: "Blend with original 0.0-1.0 (default 0)" },
        },
        required: ["node_id"],
      },
      handler: async (args: {
        node_id: string;
        sample_x?: number; sample_y?: number;
        sample_radius?: number;
        average_pixel_colors?: number;
        maintain_original_alpha?: boolean;
        blend_with_original?: number;
      }) => {
        const setLines: string[] = [];
        if (args.sample_x !== undefined || args.sample_y !== undefined) {
          const sx = args.sample_x ?? 0.5;
          const sy = args.sample_y ?? 0.5;
          setLines.push(`if (n === "Sample Point") prop.setValue([${sx}, ${sy}], true);`);
        }
        if (args.sample_radius !== undefined) setLines.push(`if (n === "Sample Radius") prop.setValue(${args.sample_radius}, true);`);
        if (args.average_pixel_colors !== undefined) setLines.push(`if (n === "Average Pixel Colors") prop.setValue(${Math.round(args.average_pixel_colors)}, true);`);
        if (args.maintain_original_alpha !== undefined) setLines.push(`if (n === "Maintain Original Alpha") prop.setValue(${args.maintain_original_alpha ? "true" : "false"}, true);`);
        if (args.blend_with_original !== undefined) setLines.push(`if (n === "Blend With Original") prop.setValue(${args.blend_with_original}, true);`);

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Eyedropper Fill is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Eyedropper Fill") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Eyedropper Fill");
            if (!eff || !eff.name) return __error("Eyedropper Fill effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Eyedropper Fill") {
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

    apply_calculations: {
      description:
        "Apply Calculations effect — channel math between input and a second source. Note: 'Second Layer' reference NOT settable from API; second-source numeric/enum/blend params still useful for adjusting an already-set layer.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          input_channel: { type: "number", description: "Input channel enum (default 0=RGBA, 1=RGB, 2=Alpha, 3=Gray, 4=Red/Green/Blue, 5=Hue, 6=Saturation, 7=Lightness)" },
          invert_input: { type: "boolean", description: "Invert input (default false)" },
          second_layer_channel: { type: "number", description: "Second layer channel enum int (default 0)" },
          second_layer_opacity: { type: "number", description: "Second layer opacity 0.0-1.0 normalized (default 0). Note: NOT 0-100 like UI suggests — 50 clamps to 1.0." },
          invert_second_layer: { type: "boolean", description: "Invert second layer (default false)" },
          stretch_second_layer_to_fit: { type: "boolean", description: "Stretch second layer (default true)" },
          blending_mode: { type: "number", description: "Blend mode int (default 0)" },
          preserve_transparency: { type: "boolean", description: "Preserve transparency (default true)" },
        },
        required: ["node_id"],
      },
      handler: async (args: {
        node_id: string;
        input_channel?: number; invert_input?: boolean;
        second_layer_channel?: number; second_layer_opacity?: number;
        invert_second_layer?: boolean; stretch_second_layer_to_fit?: boolean;
        blending_mode?: number; preserve_transparency?: boolean;
      }) => {
        const setLines: string[] = [];
        if (args.input_channel !== undefined) setLines.push(`if (n === "Input Channel") prop.setValue(${Math.round(args.input_channel)}, true);`);
        if (args.invert_input !== undefined) setLines.push(`if (n === "Invert Input") prop.setValue(${args.invert_input ? "true" : "false"}, true);`);
        if (args.second_layer_channel !== undefined) setLines.push(`if (n === "Second Layer Channel") prop.setValue(${Math.round(args.second_layer_channel)}, true);`);
        if (args.second_layer_opacity !== undefined) setLines.push(`if (n === "Second Layer Opacity") prop.setValue(${args.second_layer_opacity}, true);`);
        if (args.invert_second_layer !== undefined) setLines.push(`if (n === "Invert Second Layer") prop.setValue(${args.invert_second_layer ? "true" : "false"}, true);`);
        if (args.stretch_second_layer_to_fit !== undefined) setLines.push(`if (n === "Stretch Second Layer to Fit") prop.setValue(${args.stretch_second_layer_to_fit ? "true" : "false"}, true);`);
        if (args.blending_mode !== undefined) setLines.push(`if (n === "Blending Mode") prop.setValue(${Math.round(args.blending_mode)}, true);`);
        if (args.preserve_transparency !== undefined) setLines.push(`if (n === "Preserve Transparency") prop.setValue(${args.preserve_transparency ? "true" : "false"}, true);`);

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Calculations is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Calculations") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Calculations");
            if (!eff || !eff.name) return __error("Calculations effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Calculations") {
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

    apply_alpha_adjust: {
      description:
        "Apply Alpha Adjust effect — controls clip's alpha channel: opacity multiplier, ignore alpha, invert alpha, or output as luma matte (Mask Only). Useful when intrinsic Opacity is keyframed and you need a second alpha layer.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          opacity: { type: "number", description: "Alpha multiplier 0-100 (default 100)" },
          ignore_alpha: { type: "boolean", description: "Ignore source alpha — treat as fully opaque (default false)" },
          invert_alpha: { type: "boolean", description: "Invert alpha channel (default false)" },
          mask_only: { type: "boolean", description: "Output the alpha as a luma-only matte (default false)" },
        },
        required: ["node_id"],
      },
      handler: async (args: {
        node_id: string;
        opacity?: number; ignore_alpha?: boolean;
        invert_alpha?: boolean; mask_only?: boolean;
      }) => {
        const setLines: string[] = [];
        if (args.opacity !== undefined) setLines.push(`if (n === "Opacity") prop.setValue(${args.opacity}, true);`);
        if (args.ignore_alpha !== undefined) setLines.push(`if (n === "Ignore Alpha") prop.setValue(${args.ignore_alpha ? "true" : "false"}, true);`);
        if (args.invert_alpha !== undefined) setLines.push(`if (n === "Invert Alpha") prop.setValue(${args.invert_alpha ? "true" : "false"}, true);`);
        if (args.mask_only !== undefined) setLines.push(`if (n === "Mask Only") prop.setValue(${args.mask_only ? "true" : "false"}, true);`);

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Alpha Adjust is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Alpha Adjust") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Alpha Adjust");
            if (!eff || !eff.name) return __error("Alpha Adjust effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Alpha Adjust") {
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

    apply_color_key: {
      description:
        "Apply Color Key (legacy chroma key) — keys out a single solid color with tolerance. For better results use the existing apply_ultra_key. Color Key remains useful for simple solid-color removals.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          key_color: {
            type: "array",
            items: { type: "number" },
            description: "Color to key out [R, G, B] each 0-255 (optional 4th alpha). Default black.",
          },
          color_tolerance: { type: "number", description: "Tolerance 0-255 (default 0). Higher = wider color range keyed out." },
          edge_thin: { type: "number", description: "Edge thinning -5 to 5 (default 0). Negative grows, positive shrinks." },
          edge_feather: { type: "number", description: "Edge feather in pixels (default 0)" },
        },
        required: ["node_id"],
      },
      handler: async (args: {
        node_id: string;
        key_color?: number[]; color_tolerance?: number;
        edge_thin?: number; edge_feather?: number;
      }) => {
        const setLines: string[] = [];
        if (args.color_tolerance !== undefined) setLines.push(`if (n === "Color Tolerance") prop.setValue(${args.color_tolerance}, true);`);
        if (args.edge_thin !== undefined) setLines.push(`if (n === "Edge Thin") prop.setValue(${args.edge_thin}, true);`);
        if (args.edge_feather !== undefined) setLines.push(`if (n === "Edge Feather") prop.setValue(${args.edge_feather}, true);`);
        if (args.key_color && args.key_color.length >= 3) {
          const [r, g, b] = args.key_color;
          const a = args.key_color[3] ?? 255;
          setLines.push(`if (n === "Key Color") prop.setColorValue(${r}, ${g}, ${b}, ${a});`);
        }

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Color Key is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Color Key") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Color Key");
            if (!eff || !eff.name) return __error("Color Key effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Color Key") {
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

    apply_luma_key: {
      description:
        "Apply Luma Key (legacy luminance key) — keys out pixels based on brightness. Threshold sets the start of the key range, Cutoff softens the falloff. Useful for keying smoke/light effects against dark backgrounds.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          threshold: { type: "number", description: "Luminance threshold 0-100 (default 100)" },
          cutoff: { type: "number", description: "Cutoff 0-100 (default 0)" },
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string; threshold?: number; cutoff?: number }) => {
        const setLines: string[] = [];
        if (args.threshold !== undefined) setLines.push(`if (n === "Threshold") prop.setValue(${args.threshold}, true);`);
        if (args.cutoff !== undefined) setLines.push(`if (n === "Cutoff") prop.setValue(${args.cutoff}, true);`);

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Luma Key is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Luma Key") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Luma Key");
            if (!eff || !eff.name) return __error("Luma Key effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Luma Key") {
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

    apply_non_red_key: {
      description:
        "Apply Non Red Key (legacy chroma key) — early Adobe keyer optimized for blue/green screens by treating non-red channels. Use apply_ultra_key for modern workflows; this is for legacy project compatibility.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          threshold: { type: "number", description: "Threshold 0-100 (default 100)" },
          cutoff: { type: "number", description: "Cutoff 0-100 (default 0)" },
          defringing: { type: "number", description: "Defringing enum int (default 0=None)" },
          smoothing: { type: "number", description: "Smoothing enum int (default 0=None)" },
        },
        required: ["node_id"],
      },
      handler: async (args: {
        node_id: string;
        threshold?: number; cutoff?: number;
        defringing?: number; smoothing?: number;
      }) => {
        const setLines: string[] = [];
        if (args.threshold !== undefined) setLines.push(`if (n === "Threshold") prop.setValue(${args.threshold}, true);`);
        if (args.cutoff !== undefined) setLines.push(`if (n === "Cutoff") prop.setValue(${args.cutoff}, true);`);
        if (args.defringing !== undefined) setLines.push(`if (n === "Defringing") prop.setValue(${Math.round(args.defringing)}, true);`);
        if (args.smoothing !== undefined) setLines.push(`if (n === "Smoothing") prop.setValue(${Math.round(args.smoothing)}, true);`);

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Non Red Key is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Non Red Key") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Non Red Key");
            if (!eff || !eff.name) return __error("Non Red Key effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Non Red Key") {
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

    apply_circle: {
      description:
        "Apply Circle effect — generates a circle shape overlay. Useful for vignettes, masks, lower-thirds backgrounds. Note: 'Feather Inner Edge' has duplicate names — wrapper sets only first occurrence (the actual feather slider).",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          center_x: { type: "number", description: "Center X 0.0-1.0 (default 0.5)" },
          center_y: { type: "number", description: "Center Y 0.0-1.0 (default 0.5)" },
          radius: { type: "number", description: "Circle radius in pixels (default 75)" },
          edge: { type: "number", description: "Edge mode enum (default 0). Affects how Contextual Slider is interpreted." },
          contextual_slider: { type: "number", description: "Edge thickness/inner radius (default 10). Meaning depends on edge enum." },
          feather_outer_edge: { type: "number", description: "Outer edge feather in pixels (default 0)" },
          feather_inner_edge: { type: "number", description: "Inner edge feather in pixels (default 0)" },
          invert_circle: { type: "boolean", description: "Invert: solid outside, empty inside (default false)" },
          color: { type: "array", items: { type: "number" }, description: "Circle color [R,G,B] 0-255 (optional 4th alpha). Default white." },
          opacity: { type: "number", description: "Opacity 0-100 (default 100)" },
          blending_mode: { type: "number", description: "Blend mode int (default 0)" },
        },
        required: ["node_id"],
      },
      handler: async (args: {
        node_id: string;
        center_x?: number; center_y?: number;
        radius?: number; edge?: number; contextual_slider?: number;
        feather_outer_edge?: number; feather_inner_edge?: number;
        invert_circle?: boolean;
        color?: number[]; opacity?: number; blending_mode?: number;
      }) => {
        const setLines: string[] = [];
        if (args.center_x !== undefined || args.center_y !== undefined) {
          const cx = args.center_x ?? 0.5;
          const cy = args.center_y ?? 0.5;
          setLines.push(`if (n === "Center") prop.setValue([${cx}, ${cy}], true);`);
        }
        if (args.radius !== undefined) setLines.push(`if (n === "Radius") prop.setValue(${args.radius}, true);`);
        if (args.edge !== undefined) setLines.push(`if (n === "Edge") prop.setValue(${Math.round(args.edge)}, true);`);
        if (args.contextual_slider !== undefined) setLines.push(`if (n === "Contextual Slider") prop.setValue(${args.contextual_slider}, true);`);
        if (args.feather_outer_edge !== undefined) setLines.push(`if (n === "Feather Outer Edge") prop.setValue(${args.feather_outer_edge}, true);`);
        if (args.feather_inner_edge !== undefined) setLines.push(`if (n === "Feather Inner Edge" && !innerSeen) { prop.setValue(${args.feather_inner_edge}, true); innerSeen = true; }`);
        if (args.invert_circle !== undefined) setLines.push(`if (n === "Invert Circle") prop.setValue(${args.invert_circle ? "true" : "false"}, true);`);
        if (args.opacity !== undefined) setLines.push(`if (n === "Opacity") prop.setValue(${args.opacity}, true);`);
        if (args.blending_mode !== undefined) setLines.push(`if (n === "Blending Mode") prop.setValue(${Math.round(args.blending_mode)}, true);`);
        if (args.color && args.color.length >= 3) {
          const [r, g, b] = args.color;
          const a = args.color[3] ?? 255;
          setLines.push(`if (n === "Color") prop.setColorValue(${r}, ${g}, ${b}, ${a});`);
        }

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Circle is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Circle") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Circle");
            if (!eff || !eff.name) return __error("Circle effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Circle") {
              var innerSeen = false;
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

    apply_ellipse: {
      description:
        "Apply Ellipse effect — generates an outlined ellipse. Configurable inside/outside colors and softness. Useful for highlights, vignettes, target reticles.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          center_x: { type: "number", description: "Center X 0.0-1.0 (default 0.5)" },
          center_y: { type: "number", description: "Center Y 0.0-1.0 (default 0.5)" },
          width: { type: "number", description: "Ellipse width in pixels (default 50)" },
          height: { type: "number", description: "Ellipse height in pixels (default 50)" },
          thickness: { type: "number", description: "Outline thickness in pixels (default 8)" },
          softness: { type: "number", description: "Edge softness 0-1 (default 0.5)" },
          inside_color: { type: "array", items: { type: "number" }, description: "Inside color [R,G,B] 0-255" },
          outside_color: { type: "array", items: { type: "number" }, description: "Outside color [R,G,B] 0-255" },
          composite_on_original: { type: "boolean", description: "Composite over the source layer instead of replacing (default false)" },
        },
        required: ["node_id"],
      },
      handler: async (args: {
        node_id: string;
        center_x?: number; center_y?: number;
        width?: number; height?: number; thickness?: number; softness?: number;
        inside_color?: number[]; outside_color?: number[];
        composite_on_original?: boolean;
      }) => {
        const setLines: string[] = [];
        if (args.center_x !== undefined || args.center_y !== undefined) {
          const cx = args.center_x ?? 0.5;
          const cy = args.center_y ?? 0.5;
          setLines.push(`if (n === "Center") prop.setValue([${cx}, ${cy}], true);`);
        }
        if (args.width !== undefined) setLines.push(`if (n === "Width") prop.setValue(${args.width}, true);`);
        if (args.height !== undefined) setLines.push(`if (n === "Height") prop.setValue(${args.height}, true);`);
        if (args.thickness !== undefined) setLines.push(`if (n === "Thickness") prop.setValue(${args.thickness}, true);`);
        if (args.softness !== undefined) setLines.push(`if (n === "Softness") prop.setValue(${args.softness}, true);`);
        if (args.composite_on_original !== undefined) setLines.push(`if (n === "Composite On Original") prop.setValue(${args.composite_on_original ? "true" : "false"}, true);`);
        if (args.inside_color && args.inside_color.length >= 3) {
          const [r, g, b] = args.inside_color;
          const a = args.inside_color[3] ?? 255;
          setLines.push(`if (n === "Inside Color") prop.setColorValue(${r}, ${g}, ${b}, ${a});`);
        }
        if (args.outside_color && args.outside_color.length >= 3) {
          const [r, g, b] = args.outside_color;
          const a = args.outside_color[3] ?? 255;
          setLines.push(`if (n === "Outside Color") prop.setColorValue(${r}, ${g}, ${b}, ${a});`);
        }

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Ellipse is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Ellipse") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Ellipse");
            if (!eff || !eff.name) return __error("Ellipse effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Ellipse") {
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

    apply_venetian_blinds: {
      description:
        "Apply Venetian Blinds effect — louvre-style wipe revealing transparency in horizontal/vertical bands. Acts on a single clip; animate `transition_completion` for the actual blinds-opening motion.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          transition_completion: { type: "number", description: "Wipe progress 0-100 (default 0)" },
          direction: { type: "number", description: "Blinds direction in degrees (default 0 = horizontal slats)" },
          width: { type: "number", description: "Slat width in pixels (default 20)" },
          feather: { type: "number", description: "Edge softness (default 0)" },
        },
        required: ["node_id"],
      },
      handler: async (args: {
        node_id: string;
        transition_completion?: number; direction?: number; width?: number; feather?: number;
      }) => {
        const setLines: string[] = [];
        if (args.transition_completion !== undefined) setLines.push(`if (n === "Transition Completion") prop.setValue(${args.transition_completion}, true);`);
        if (args.direction !== undefined) setLines.push(`if (n === "Direction") prop.setValue(${args.direction}, true);`);
        if (args.width !== undefined) setLines.push(`if (n === "Width") prop.setValue(${args.width}, true);`);
        if (args.feather !== undefined) setLines.push(`if (n === "Feather") prop.setValue(${args.feather}, true);`);

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Venetian Blinds is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Venetian Blinds") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Venetian Blinds");
            if (!eff || !eff.name) return __error("Venetian Blinds effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Venetian Blinds") {
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

    apply_block_dissolve: {
      description:
        "Apply Block Dissolve effect — randomized block-style dissolve to transparency. Acts on a single clip; animate `transition_completion`.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          transition_completion: { type: "number", description: "Dissolve progress 0-100 (default 0)" },
          block_width: { type: "number", description: "Block width in pixels (default 1)" },
          block_height: { type: "number", description: "Block height in pixels (default 1)" },
          feather: { type: "number", description: "Edge softness (default 0)" },
          soft_edges: { type: "boolean", description: "Soft Edges (Best Quality) — default true. Slower but smoother." },
        },
        required: ["node_id"],
      },
      handler: async (args: {
        node_id: string;
        transition_completion?: number; block_width?: number; block_height?: number;
        feather?: number; soft_edges?: boolean;
      }) => {
        const setLines: string[] = [];
        if (args.transition_completion !== undefined) setLines.push(`if (n === "Transition Completion") prop.setValue(${args.transition_completion}, true);`);
        if (args.block_width !== undefined) setLines.push(`if (n === "Block Width") prop.setValue(${args.block_width}, true);`);
        if (args.block_height !== undefined) setLines.push(`if (n === "Block Height") prop.setValue(${args.block_height}, true);`);
        if (args.feather !== undefined) setLines.push(`if (n === "Feather") prop.setValue(${args.feather}, true);`);
        if (args.soft_edges !== undefined) setLines.push(`if (n === "Soft Edges (Best Quality)") prop.setValue(${args.soft_edges ? "true" : "false"}, true);`);

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Block Dissolve is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Block Dissolve") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Block Dissolve");
            if (!eff || !eff.name) return __error("Block Dissolve effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Block Dissolve") {
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

    apply_convolution_kernel: {
      description:
        "Apply Convolution Kernel effect — custom 3x3 matrix filter (sharpen, edge-detect, blur, emboss kernels). M11-M33 form the 3x3 kernel; output = (sum of kernel*neighbors + Offset) / Scale.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          m11: { type: "number", description: "Top-left kernel coefficient (default 0)" },
          m12: { type: "number", description: "Top-center (default 1)" },
          m13: { type: "number", description: "Top-right (default 0)" },
          m21: { type: "number", description: "Mid-left (default 1)" },
          m22: { type: "number", description: "Center (default 2)" },
          m23: { type: "number", description: "Mid-right (default 1)" },
          m31: { type: "number", description: "Bottom-left (default 0)" },
          m32: { type: "number", description: "Bottom-center (default 1)" },
          m33: { type: "number", description: "Bottom-right (default 0)" },
          offset: { type: "number", description: "Bias added to result before scaling (default 0)" },
          scale: { type: "number", description: "Divisor for normalization (default 6 = sum of default kernel)" },
          process_alpha: { type: "boolean", description: "Apply kernel to alpha channel (default true)" },
        },
        required: ["node_id"],
      },
      handler: async (args: {
        node_id: string;
        m11?: number; m12?: number; m13?: number;
        m21?: number; m22?: number; m23?: number;
        m31?: number; m32?: number; m33?: number;
        offset?: number; scale?: number; process_alpha?: boolean;
      }) => {
        const setLines: string[] = [];
        const matrix: [string, number | undefined][] = [
          ["M11", args.m11], ["M12", args.m12], ["M13", args.m13],
          ["M21", args.m21], ["M22", args.m22], ["M23", args.m23],
          ["M31", args.m31], ["M32", args.m32], ["M33", args.m33],
        ];
        for (const [label, val] of matrix) {
          if (val !== undefined) setLines.push(`if (n === "${label}") prop.setValue(${val}, true);`);
        }
        if (args.offset !== undefined) setLines.push(`if (n === "Offset") prop.setValue(${args.offset}, true);`);
        if (args.scale !== undefined) setLines.push(`if (n === "Scale") prop.setValue(${args.scale}, true);`);
        if (args.process_alpha !== undefined) setLines.push(`if (n === "Process Alpha") prop.setValue(${args.process_alpha ? "true" : "false"}, true);`);

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Convolution Kernel is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Convolution Kernel") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Convolution Kernel");
            if (!eff || !eff.name) return __error("Convolution Kernel effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Convolution Kernel") {
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

    apply_compound_arithmetic: {
      description:
        "Apply Compound Arithmetic effect — combines clip with another layer per-channel using arithmetic operator. Note: 'Second Source Layer' selects external layer reference — NOT settable from API in 25.4. Other params still useful.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          operator: { type: "number", description: "Arithmetic operator enum int (default 0). Common: 0=Add, 1=Subtract, 2=Multiply, 3=Divide, 4=Max, 5=Min." },
          operate_on_channels: { type: "number", description: "Channel selection enum int (default 0=RGBA). E.g. 1=ARGB, 2=R only, 3=G only, 4=B only." },
          overflow_behavior: { type: "number", description: "Overflow handling enum int (default 0=Clip)" },
          stretch_second_source_to_fit: { type: "boolean", description: "Stretch second source to layer bounds (default true)" },
          blend_with_original: { type: "number", description: "Blend with original 0.0-1.0 (default 0)" },
        },
        required: ["node_id"],
      },
      handler: async (args: {
        node_id: string;
        operator?: number; operate_on_channels?: number; overflow_behavior?: number;
        stretch_second_source_to_fit?: boolean; blend_with_original?: number;
      }) => {
        const setLines: string[] = [];
        if (args.operator !== undefined) setLines.push(`if (n === "Operator") prop.setValue(${Math.round(args.operator)}, true);`);
        if (args.operate_on_channels !== undefined) setLines.push(`if (n === "Operate on Channels") prop.setValue(${Math.round(args.operate_on_channels)}, true);`);
        if (args.overflow_behavior !== undefined) setLines.push(`if (n === "Overflow Behavior") prop.setValue(${Math.round(args.overflow_behavior)}, true);`);
        if (args.stretch_second_source_to_fit !== undefined) setLines.push(`if (n === "Stretch Second Source to Fit") prop.setValue(${args.stretch_second_source_to_fit ? "true" : "false"}, true);`);
        if (args.blend_with_original !== undefined) setLines.push(`if (n === "Blend With Original") prop.setValue(${args.blend_with_original}, true);`);

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Compound Arithmetic is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Compound Arithmetic") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Compound Arithmetic");
            if (!eff || !eff.name) return __error("Compound Arithmetic effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Compound Arithmetic") {
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

    apply_pixel_motion_blur: {
      description:
        "Apply Pixel Motion Blur effect — analyzes inter-frame pixel motion to add natural-looking motion blur in post. Better than synthesizing blur via animation; doesn't require keyframes.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          shutter_control: { type: "number", description: "0=Auto (default), 1=Manual" },
          shutter_angle: { type: "number", description: "Virtual shutter angle in degrees (default 180 = standard cinematic)" },
          shutter_samples: { type: "number", description: "Sample count (default 5). Higher = smoother but slower." },
          vector_detail: { type: "number", description: "Motion-vector detail percent (default 20). Higher = more accurate vectors but slower." },
        },
        required: ["node_id"],
      },
      handler: async (args: {
        node_id: string;
        shutter_control?: number; shutter_angle?: number;
        shutter_samples?: number; vector_detail?: number;
      }) => {
        const setLines: string[] = [];
        if (args.shutter_control !== undefined) setLines.push(`if (n === "Shutter Control") prop.setValue(${Math.round(args.shutter_control)}, true);`);
        if (args.shutter_angle !== undefined) setLines.push(`if (n === "Shutter Angle") prop.setValue(${args.shutter_angle}, true);`);
        if (args.shutter_samples !== undefined) setLines.push(`if (n === "Shutter Samples") prop.setValue(${Math.round(args.shutter_samples)}, true);`);
        if (args.vector_detail !== undefined) setLines.push(`if (n === "Vector Detail") prop.setValue(${args.vector_detail}, true);`);

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Pixel Motion Blur is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Pixel Motion Blur") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Pixel Motion Blur");
            if (!eff || !eff.name) return __error("Pixel Motion Blur effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Pixel Motion Blur") {
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

    apply_ramp: {
      description:
        "Apply Ramp effect — generates a linear or radial gradient from start_color to end_color. Useful for masks, sky replacement, color overlay sources.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          start_x: { type: "number", description: "Start X 0.0-1.0 normalized (default 0.5)" },
          start_y: { type: "number", description: "Start Y 0.0-1.0 normalized (default 0.0 = top)" },
          start_color: { type: "array", items: { type: "number" }, description: "Start color [R,G,B] 0-255 (optional 4th alpha). Default black." },
          end_x: { type: "number", description: "End X 0.0-1.0 normalized (default 0.5)" },
          end_y: { type: "number", description: "End Y 0.0-1.0 normalized (default 1.0 = bottom)" },
          end_color: { type: "array", items: { type: "number" }, description: "End color [R,G,B] 0-255 (optional 4th alpha). Default white." },
          ramp_shape: { type: "number", description: "0=Linear (default), 1=Radial" },
          ramp_scatter: { type: "number", description: "Dithering 0-100 (default 0)" },
          blend_with_original: { type: "number", description: "Blend with original 0.0-1.0 (default 0)" },
        },
        required: ["node_id"],
      },
      handler: async (args: {
        node_id: string;
        start_x?: number; start_y?: number; start_color?: number[];
        end_x?: number; end_y?: number; end_color?: number[];
        ramp_shape?: number; ramp_scatter?: number; blend_with_original?: number;
      }) => {
        const setLines: string[] = [];
        if (args.start_x !== undefined || args.start_y !== undefined) {
          const sx = args.start_x ?? 0.5;
          const sy = args.start_y ?? 0;
          setLines.push(`if (n === "Start of Ramp") prop.setValue([${sx}, ${sy}], true);`);
        }
        if (args.end_x !== undefined || args.end_y !== undefined) {
          const ex = args.end_x ?? 0.5;
          const ey = args.end_y ?? 1;
          setLines.push(`if (n === "End of Ramp") prop.setValue([${ex}, ${ey}], true);`);
        }
        if (args.start_color && args.start_color.length >= 3) {
          const [r, g, b] = args.start_color;
          const a = args.start_color[3] ?? 255;
          setLines.push(`if (n === "Start Color") prop.setColorValue(${r}, ${g}, ${b}, ${a});`);
        }
        if (args.end_color && args.end_color.length >= 3) {
          const [r, g, b] = args.end_color;
          const a = args.end_color[3] ?? 255;
          setLines.push(`if (n === "End Color") prop.setColorValue(${r}, ${g}, ${b}, ${a});`);
        }
        if (args.ramp_shape !== undefined) setLines.push(`if (n === "Ramp Shape") prop.setValue(${Math.round(args.ramp_shape)}, true);`);
        if (args.ramp_scatter !== undefined) setLines.push(`if (n === "Ramp Scatter") prop.setValue(${args.ramp_scatter}, true);`);
        if (args.blend_with_original !== undefined) setLines.push(`if (n === "Blend With Original") prop.setValue(${args.blend_with_original}, true);`);

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Ramp is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Ramp") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Ramp");
            if (!eff || !eff.name) return __error("Ramp effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Ramp") {
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

    apply_grid: {
      description:
        "Apply Grid effect — overlay a grid pattern. Useful for layout guides, technical references, or stylistic looks. Width/Height require size_from=2 (Width & Height Sliders); ignored when size_from=0 (Corner Point).",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          anchor_x: { type: "number", description: "Grid anchor X 0.0-1.0 (default 0.5)" },
          anchor_y: { type: "number", description: "Grid anchor Y 0.0-1.0 (default 0.5)" },
          size_from: { type: "number", description: "0=Corner Point (default), 1=Width Slider, 2=Width & Height Sliders" },
          width: { type: "number", description: "Cell width in pixels (default 32). Used when size_from is 1 or 2." },
          height: { type: "number", description: "Cell height in pixels (default 24). Used when size_from is 2." },
          border: { type: "number", description: "Border thickness in pixels (default 5)" },
          invert_grid: { type: "boolean", description: "Invert: filled cells (default false)" },
          color: { type: "array", items: { type: "number" }, description: "Grid color [R,G,B] 0-255 (optional 4th alpha). Default white." },
          opacity: { type: "number", description: "Grid opacity 0-100 (default 100)" },
          blending_mode: { type: "number", description: "Blend mode int (default 0)" },
        },
        required: ["node_id"],
      },
      handler: async (args: {
        node_id: string;
        anchor_x?: number; anchor_y?: number; size_from?: number;
        width?: number; height?: number; border?: number;
        invert_grid?: boolean; color?: number[]; opacity?: number; blending_mode?: number;
      }) => {
        const setLines: string[] = [];
        if (args.anchor_x !== undefined || args.anchor_y !== undefined) {
          const ax = args.anchor_x ?? 0.5;
          const ay = args.anchor_y ?? 0.5;
          setLines.push(`if (n === "Anchor") prop.setValue([${ax}, ${ay}], true);`);
        }
        if (args.size_from !== undefined) setLines.push(`if (n === "Size From") prop.setValue(${Math.round(args.size_from)}, true);`);
        if (args.width !== undefined) setLines.push(`if (n === "Width" && !widthSeen) { prop.setValue(${args.width}, true); widthSeen = true; }`);
        if (args.height !== undefined) setLines.push(`if (n === "Height" && !heightSeen) { prop.setValue(${args.height}, true); heightSeen = true; }`);
        if (args.border !== undefined) setLines.push(`if (n === "Border") prop.setValue(${args.border}, true);`);
        if (args.invert_grid !== undefined) setLines.push(`if (n === "Invert Grid") prop.setValue(${args.invert_grid ? "true" : "false"}, true);`);
        if (args.opacity !== undefined) setLines.push(`if (n === "Opacity") prop.setValue(${args.opacity}, true);`);
        if (args.blending_mode !== undefined) setLines.push(`if (n === "Blending Mode") prop.setValue(${Math.round(args.blending_mode)}, true);`);
        if (args.color && args.color.length >= 3) {
          const [r, g, b] = args.color;
          const a = args.color[3] ?? 255;
          setLines.push(`if (n === "Color") prop.setColorValue(${r}, ${g}, ${b}, ${a});`);
        }

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Grid is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Grid") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Grid");
            if (!eff || !eff.name) return __error("Grid effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Grid") {
              var widthSeen = false;
              var heightSeen = false;
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

    apply_checkerboard: {
      description:
        "Apply Checkerboard effect — overlay a checker pattern. Useful for transparent-area indicators, technical references, or stylistic backgrounds.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          anchor_x: { type: "number", description: "Anchor X 0.0-1.0 (default 0.5)" },
          anchor_y: { type: "number", description: "Anchor Y 0.0-1.0 (default 0.5)" },
          size_from: { type: "number", description: "0=Corner Point, 1=Width Slider (default), 2=Width & Height Sliders" },
          width: { type: "number", description: "Cell width in pixels (default 16). Used when size_from is 1 or 2." },
          height: { type: "number", description: "Cell height in pixels (default 8). Used when size_from is 2." },
          color: { type: "array", items: { type: "number" }, description: "Square color [R,G,B,A] 0-255. Default white." },
          opacity: { type: "number", description: "Opacity 0-100 (default 100)" },
          blending_mode: { type: "number", description: "Blend mode int (default 0)" },
        },
        required: ["node_id"],
      },
      handler: async (args: {
        node_id: string;
        anchor_x?: number; anchor_y?: number; size_from?: number;
        width?: number; height?: number;
        color?: number[]; opacity?: number; blending_mode?: number;
      }) => {
        const setLines: string[] = [];
        if (args.anchor_x !== undefined || args.anchor_y !== undefined) {
          const ax = args.anchor_x ?? 0.5;
          const ay = args.anchor_y ?? 0.5;
          setLines.push(`if (n === "Anchor") prop.setValue([${ax}, ${ay}], true);`);
        }
        if (args.size_from !== undefined) setLines.push(`if (n === "Size From") prop.setValue(${Math.round(args.size_from)}, true);`);
        if (args.width !== undefined) setLines.push(`if (n === "Width" && !widthSeen) { prop.setValue(${args.width}, true); widthSeen = true; }`);
        if (args.height !== undefined) setLines.push(`if (n === "Height" && !heightSeen) { prop.setValue(${args.height}, true); heightSeen = true; }`);
        if (args.opacity !== undefined) setLines.push(`if (n === "Opacity") prop.setValue(${args.opacity}, true);`);
        if (args.blending_mode !== undefined) setLines.push(`if (n === "Blending Mode") prop.setValue(${Math.round(args.blending_mode)}, true);`);
        if (args.color && args.color.length >= 3) {
          const [r, g, b] = args.color;
          const a = args.color[3] ?? 255;
          setLines.push(`if (n === "Color") prop.setColorValue(${r}, ${g}, ${b}, ${a});`);
        }

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Checkerboard is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Checkerboard") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Checkerboard");
            if (!eff || !eff.name) return __error("Checkerboard effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Checkerboard") {
              var widthSeen = false;
              var heightSeen = false;
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

    apply_4color_gradient: {
      description:
        "Apply 4-Color Gradient effect — blend 4 colors anchored at 4 points. Default points are corners; great for color washes, mood overlays, or stylized backgrounds.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          point1_x: { type: "number", description: "Point 1 X 0.0-1.0 (default 0.1)" },
          point1_y: { type: "number", description: "Point 1 Y 0.0-1.0 (default 0.1)" },
          color1: { type: "array", items: { type: "number" }, description: "Color 1 [R,G,B,A] 0-255" },
          point2_x: { type: "number", description: "Point 2 X (default 0.9)" },
          point2_y: { type: "number", description: "Point 2 Y (default 0.1)" },
          color2: { type: "array", items: { type: "number" }, description: "Color 2 [R,G,B,A]" },
          point3_x: { type: "number", description: "Point 3 X (default 0.1)" },
          point3_y: { type: "number", description: "Point 3 Y (default 0.9)" },
          color3: { type: "array", items: { type: "number" }, description: "Color 3 [R,G,B,A]" },
          point4_x: { type: "number", description: "Point 4 X (default 0.9)" },
          point4_y: { type: "number", description: "Point 4 Y (default 0.9)" },
          color4: { type: "array", items: { type: "number" }, description: "Color 4 [R,G,B,A]" },
          blend: { type: "number", description: "Blend amount 0-100 (default 100)" },
          jitter: { type: "number", description: "Jitter 0-100 (default 0)" },
          opacity: { type: "number", description: "Opacity 0-100 (default 100)" },
          blending_mode: { type: "number", description: "Blend mode int (default 0)" },
        },
        required: ["node_id"],
      },
      handler: async (args: {
        node_id: string;
        point1_x?: number; point1_y?: number; color1?: number[];
        point2_x?: number; point2_y?: number; color2?: number[];
        point3_x?: number; point3_y?: number; color3?: number[];
        point4_x?: number; point4_y?: number; color4?: number[];
        blend?: number; jitter?: number; opacity?: number; blending_mode?: number;
      }) => {
        const setLines: string[] = [];
        const pts: [string, number | undefined, number | undefined, number, number][] = [
          ["Point 1", args.point1_x, args.point1_y, 0.1, 0.1],
          ["Point 2", args.point2_x, args.point2_y, 0.9, 0.1],
          ["Point 3", args.point3_x, args.point3_y, 0.1, 0.9],
          ["Point 4", args.point4_x, args.point4_y, 0.9, 0.9],
        ];
        for (const [label, x, y, dx, dy] of pts) {
          if (x !== undefined || y !== undefined) {
            const px = x ?? dx;
            const py = y ?? dy;
            setLines.push(`if (n === "${label}") prop.setValue([${px}, ${py}], true);`);
          }
        }
        const cols: [string, number[] | undefined][] = [
          ["Color 1", args.color1],
          ["Color 2", args.color2],
          ["Color 3", args.color3],
        ];
        for (const [label, c] of cols) {
          if (c && c.length >= 3) {
            const [r, g, b] = c;
            const a = c[3] ?? 255;
            setLines.push(`if (n === "${label}") prop.setColorValue(${r}, ${g}, ${b}, ${a});`);
          }
        }
        // Color 4 has a duplicate — guard with flag
        if (args.color4 && args.color4.length >= 3) {
          const [r, g, b] = args.color4;
          const a = args.color4[3] ?? 255;
          setLines.push(`if (n === "Color 4" && !color4Seen) { prop.setColorValue(${r}, ${g}, ${b}, ${a}); color4Seen = true; }`);
        }
        if (args.blend !== undefined) setLines.push(`if (n === "Blend") prop.setValue(${args.blend}, true);`);
        if (args.jitter !== undefined) setLines.push(`if (n === "Jitter") prop.setValue(${args.jitter}, true);`);
        if (args.opacity !== undefined) setLines.push(`if (n === "Opacity") prop.setValue(${args.opacity}, true);`);
        if (args.blending_mode !== undefined) setLines.push(`if (n === "Blending Mode") prop.setValue(${Math.round(args.blending_mode)}, true);`);

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("4-Color Gradient is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "4-Color Gradient") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("4-Color Gradient");
            if (!eff || !eff.name) return __error("4-Color Gradient effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "4-Color Gradient") {
              var color4Seen = false;
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

    apply_cell_pattern: {
      description:
        "Apply Cell Pattern effect — procedural cell/voronoi noise generator. Use for organic textures, water caustics, animated backgrounds. 'Cells Vertical' has a duplicate property name — only first match is set.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          cell_pattern: { type: "number", description: "Pattern type enum int 0-11 (default 0=Bubbles). Try 1-11 for crystals/plates/static plates etc." },
          invert: { type: "boolean", description: "Invert pattern (default false)" },
          contextual_slider: { type: "number", description: "Contextual slider 0-100 (default 100). Meaning depends on cell_pattern." },
          disperse: { type: "number", description: "Disperse 0-1 (default 1)" },
          size: { type: "number", description: "Cell size in pixels (default 60)" },
          offset_x: { type: "number", description: "Offset X 0.0-1.0 (default 0.5)" },
          offset_y: { type: "number", description: "Offset Y 0.0-1.0 (default 0.5)" },
          enable_tiling: { type: "boolean", description: "Enable tiling (default false)" },
          cells_horizontal: { type: "number", description: "Horizontal tile count (default 4). Used when enable_tiling=true." },
          cells_vertical: { type: "number", description: "Vertical tile count (default 4). Used when enable_tiling=true." },
          evolution: { type: "number", description: "Evolution angle in degrees (default 0). Animate to evolve pattern." },
          random_seed: { type: "number", description: "Random seed (default 0)" },
        },
        required: ["node_id"],
      },
      handler: async (args: {
        node_id: string;
        cell_pattern?: number; invert?: boolean; contextual_slider?: number;
        disperse?: number; size?: number;
        offset_x?: number; offset_y?: number;
        enable_tiling?: boolean; cells_horizontal?: number; cells_vertical?: number;
        evolution?: number; random_seed?: number;
      }) => {
        const setLines: string[] = [];
        if (args.cell_pattern !== undefined) setLines.push(`if (n === "Cell Pattern") prop.setValue(${Math.round(args.cell_pattern)}, true);`);
        if (args.invert !== undefined) setLines.push(`if (n === "Invert") prop.setValue(${args.invert ? "true" : "false"}, true);`);
        if (args.contextual_slider !== undefined) setLines.push(`if (n === "Contextual Slider") prop.setValue(${args.contextual_slider}, true);`);
        if (args.disperse !== undefined) setLines.push(`if (n === "Disperse") prop.setValue(${args.disperse}, true);`);
        if (args.size !== undefined) setLines.push(`if (n === "Size") prop.setValue(${args.size}, true);`);
        if (args.offset_x !== undefined || args.offset_y !== undefined) {
          const ox = args.offset_x ?? 0.5;
          const oy = args.offset_y ?? 0.5;
          setLines.push(`if (n === "Offset") prop.setValue([${ox}, ${oy}], true);`);
        }
        if (args.enable_tiling !== undefined) setLines.push(`if (n === "Enable Tiling") prop.setValue(${args.enable_tiling ? "true" : "false"}, true);`);
        if (args.cells_horizontal !== undefined) setLines.push(`if (n === "Cells Horizontal") prop.setValue(${args.cells_horizontal}, true);`);
        if (args.cells_vertical !== undefined) setLines.push(`if (n === "Cells Vertical" && !cellsVerticalSeen) { prop.setValue(${args.cells_vertical}, true); cellsVerticalSeen = true; }`);
        if (args.evolution !== undefined) setLines.push(`if (n === "Evolution") prop.setValue(${args.evolution}, true);`);
        if (args.random_seed !== undefined) setLines.push(`if (n === "Random Seed") prop.setValue(${args.random_seed}, true);`);

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Cell Pattern is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Cell Pattern") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Cell Pattern");
            if (!eff || !eff.name) return __error("Cell Pattern effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Cell Pattern") {
              var cellsVerticalSeen = false;
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

    apply_asc_cdl: {
      description:
        "Apply ASC CDL effect — industry-standard Color Decision List (Slope/Offset/Power per RGB + Saturation). Used in DI/finishing pipelines for portable color grades that round-trip across DaVinci/Avid/Nuke. All 10 numeric params default to identity (Slope=1, Offset=0, Power=1, Saturation=1).",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          red_slope: { type: "number", description: "Red slope (gain), default 1.0. >1 brightens highlights." },
          red_offset: { type: "number", description: "Red offset (lift), default 0. Adds to all values." },
          red_power: { type: "number", description: "Red power (gamma), default 1.0. Lower = brighter midtones." },
          green_slope: { type: "number", description: "Green slope, default 1.0" },
          green_offset: { type: "number", description: "Green offset, default 0" },
          green_power: { type: "number", description: "Green power, default 1.0" },
          blue_slope: { type: "number", description: "Blue slope, default 1.0" },
          blue_offset: { type: "number", description: "Blue offset, default 0" },
          blue_power: { type: "number", description: "Blue power, default 1.0" },
          saturation: { type: "number", description: "Overall saturation, default 1.0 (0=B&W, 2=oversaturated)" },
        },
        required: ["node_id"],
      },
      handler: async (args: {
        node_id: string;
        red_slope?: number; red_offset?: number; red_power?: number;
        green_slope?: number; green_offset?: number; green_power?: number;
        blue_slope?: number; blue_offset?: number; blue_power?: number;
        saturation?: number;
      }) => {
        const setLines: string[] = [];
        const map: [string, number | undefined][] = [
          ["Red Slope", args.red_slope], ["Red Offset", args.red_offset], ["Red Power", args.red_power],
          ["Green Slope", args.green_slope], ["Green Offset", args.green_offset], ["Green Power", args.green_power],
          ["Blue Slope", args.blue_slope], ["Blue Offset", args.blue_offset], ["Blue Power", args.blue_power],
          ["Saturation", args.saturation],
        ];
        for (const [n, v] of map) {
          if (v !== undefined) setLines.push(`if (n === "${n}") prop.setValue(${v}, true);`);
        }

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("ASC CDL is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "ASC CDL") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("ASC CDL");
            if (!eff || !eff.name) return __error("ASC CDL effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "ASC CDL") {
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

    apply_color_space_transform: {
      description:
        "Apply Color Space Transform effect — explicit color space conversion (e.g. Rec.709 → Rec.2020). Note: SCS/TCS are integer enums whose mapping is internal to Premiere; probe via execute_extendscript before relying on specific values. Tone-mapping params (Gain/Desaturation/Knee) work standalone.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          scs: { type: "number", description: "Source Color Space integer enum (default 0). Mapping is internal — verify via execute_extendscript. Most uses keep this default." },
          tcs: { type: "number", description: "Target Color Space integer enum (default 0). Same caveat as scs." },
          tone_map_method: { type: "number", description: "Tone-map method enum int (default 0)" },
          gain: { type: "number", description: "Output gain multiplier (default 1.0)" },
          desaturation: { type: "number", description: "Desaturation factor (default 1.0)" },
          knee: { type: "number", description: "Knee for tone-map curve (default 0)" },
          gc_methods: { type: "number", description: "Gamut compression method enum int (default 0)" },
        },
        required: ["node_id"],
      },
      handler: async (args: {
        node_id: string;
        scs?: number; tcs?: number; tone_map_method?: number;
        gain?: number; desaturation?: number; knee?: number; gc_methods?: number;
      }) => {
        const setLines: string[] = [];
        if (args.scs !== undefined) setLines.push(`if (n === "SCS") prop.setValue(${Math.round(args.scs)}, true);`);
        if (args.tcs !== undefined) setLines.push(`if (n === "TCS") prop.setValue(${Math.round(args.tcs)}, true);`);
        if (args.tone_map_method !== undefined) setLines.push(`if (n === "Tone Map Method") prop.setValue(${Math.round(args.tone_map_method)}, true);`);
        if (args.gain !== undefined) setLines.push(`if (n === "Gain") prop.setValue(${args.gain}, true);`);
        if (args.desaturation !== undefined) setLines.push(`if (n === "Desaturation") prop.setValue(${args.desaturation}, true);`);
        if (args.knee !== undefined) setLines.push(`if (n === "Knee") prop.setValue(${args.knee}, true);`);
        if (args.gc_methods !== undefined) setLines.push(`if (n === "GC Methods") prop.setValue(${Math.round(args.gc_methods)}, true);`);

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Color Space Transform is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Color Space Transform") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Color Space Transform");
            if (!eff || !eff.name) return __error("Color Space Transform effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Color Space Transform") {
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

    apply_cineon_converter: {
      description:
        "Apply Cineon Converter effect — convert between Cineon log and linear color spaces. Standard for film scan workflows. Default config is Lin→Log conversion with 10-bit black=95, white=685 (Cineon spec).",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          conversion_type: { type: "number", description: "0=Log to Linear, 1=Linear to Log (default), 2=Log to Log" },
          ten_bit_black_point: { type: "number", description: "10-bit black point in code values (default 95)" },
          internal_black_point: { type: "number", description: "Internal (linear) black point 0-1 (default 0)" },
          ten_bit_white_point: { type: "number", description: "10-bit white point in code values (default 685)" },
          internal_white_point: { type: "number", description: "Internal (linear) white point 0-1 (default 1)" },
          gamma: { type: "number", description: "Gamma correction (default 1.7 — Cineon film density)" },
          highlight_rolloff: { type: "number", description: "Highlight rolloff (default 20). Compresses values above white point." },
        },
        required: ["node_id"],
      },
      handler: async (args: {
        node_id: string;
        conversion_type?: number;
        ten_bit_black_point?: number; internal_black_point?: number;
        ten_bit_white_point?: number; internal_white_point?: number;
        gamma?: number; highlight_rolloff?: number;
      }) => {
        const setLines: string[] = [];
        if (args.conversion_type !== undefined) setLines.push(`if (n === "Conversion Type") prop.setValue(${Math.round(args.conversion_type)}, true);`);
        if (args.ten_bit_black_point !== undefined) setLines.push(`if (n === "10 Bit Black Point") prop.setValue(${args.ten_bit_black_point}, true);`);
        if (args.internal_black_point !== undefined) setLines.push(`if (n === "Internal Black Point") prop.setValue(${args.internal_black_point}, true);`);
        if (args.ten_bit_white_point !== undefined) setLines.push(`if (n === "10 Bit White Point") prop.setValue(${args.ten_bit_white_point}, true);`);
        if (args.internal_white_point !== undefined) setLines.push(`if (n === "Internal White Point") prop.setValue(${args.internal_white_point}, true);`);
        if (args.gamma !== undefined) setLines.push(`if (n === "Gamma") prop.setValue(${args.gamma}, true);`);
        if (args.highlight_rolloff !== undefined) setLines.push(`if (n === "Highlight Rolloff") prop.setValue(${args.highlight_rolloff}, true);`);

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Cineon Converter is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Cineon Converter") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Cineon Converter");
            if (!eff || !eff.name) return __error("Cineon Converter effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Cineon Converter") {
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

    apply_solid_composite: {
      description:
        "Apply Solid Composite effect — composites a solid color over the clip with configurable blend mode + opacities. Useful for tints, color washes, or quick lookahead overlays.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          source_opacity: { type: "number", description: "Source layer opacity 0-100 (default 100)" },
          color: {
            type: "array",
            items: { type: "number" },
            description: "Solid color [R, G, B] each 0-255 (optional 4th alpha 0-255). Default white.",
          },
          opacity: { type: "number", description: "Solid color opacity 0-100 (default 100)" },
          blending_mode: { type: "number", description: "Blend mode integer enum (default 0=Normal). Common: 1=Multiply, 5=Screen, 9=Overlay." },
        },
        required: ["node_id"],
      },
      handler: async (args: {
        node_id: string;
        source_opacity?: number;
        color?: number[];
        opacity?: number;
        blending_mode?: number;
      }) => {
        const setLines: string[] = [];
        if (args.source_opacity !== undefined) setLines.push(`if (n === "Source Opacity") prop.setValue(${args.source_opacity}, true);`);
        if (args.opacity !== undefined) setLines.push(`if (n === "Opacity") prop.setValue(${args.opacity}, true);`);
        if (args.blending_mode !== undefined) setLines.push(`if (n === "Blending Mode") prop.setValue(${Math.round(args.blending_mode)}, true);`);
        if (args.color && args.color.length >= 3) {
          const [r, g, b] = args.color;
          const a = args.color[3] ?? 255;
          setLines.push(`if (n === "Color") prop.setColorValue(${r}, ${g}, ${b}, ${a});`);
        }

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Solid Composite is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Solid Composite") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Solid Composite");
            if (!eff || !eff.name) return __error("Solid Composite effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Solid Composite") {
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

    apply_texturize: {
      description:
        "Apply Texturize effect — applies a texture from an external layer with light direction and contrast. Note: 'Texture Layer' parameter selects the source layer and is NOT settable from API in 25.4 (layer reference). Other params still useful for adjusting an already-set texture.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          light_direction: { type: "number", description: "Light direction in degrees (default 135)" },
          texture_contrast: { type: "number", description: "Texture intensity (default 1.0)" },
          texture_placement: { type: "number", description: "0=Tile (default), 1=Center, 2=Stretch" },
        },
        required: ["node_id"],
      },
      handler: async (args: {
        node_id: string;
        light_direction?: number;
        texture_contrast?: number;
        texture_placement?: number;
      }) => {
        const setLines: string[] = [];
        if (args.light_direction !== undefined) setLines.push(`if (n === "Light Direction") prop.setValue(${args.light_direction}, true);`);
        if (args.texture_contrast !== undefined) setLines.push(`if (n === "Texture Contrast") prop.setValue(${args.texture_contrast}, true);`);
        if (args.texture_placement !== undefined) setLines.push(`if (n === "Texture Placement") prop.setValue(${Math.round(args.texture_placement)}, true);`);

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Texturize is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Texturize") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Texturize");
            if (!eff || !eff.name) return __error("Texturize effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Texturize") {
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

    apply_brush_strokes: {
      description:
        "Apply Brush Strokes effect — painterly look with configurable angle/size/density. Common stylization for art-style transitions or watercolor look.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          stroke_angle: { type: "number", description: "Brush stroke angle in degrees (default 135)" },
          brush_size: { type: "number", description: "Brush size 0-10 (default 2). Larger = chunkier strokes." },
          stroke_length: { type: "number", description: "Stroke length (default 5)" },
          stroke_density: { type: "number", description: "Stroke density 0-1 (default 1)" },
          stroke_randomness: { type: "number", description: "Randomness 0-1 (default 1)" },
          paint_surface: { type: "number", description: "Background: 0=Paint On Original (default), 1=On Transparent, 2=On White, 3=On Black" },
          blend_with_original: { type: "number", description: "Blend with original 0.0-1.0 (default 0)" },
        },
        required: ["node_id"],
      },
      handler: async (args: {
        node_id: string;
        stroke_angle?: number;
        brush_size?: number;
        stroke_length?: number;
        stroke_density?: number;
        stroke_randomness?: number;
        paint_surface?: number;
        blend_with_original?: number;
      }) => {
        const setLines: string[] = [];
        if (args.stroke_angle !== undefined) setLines.push(`if (n === "Stroke Angle") prop.setValue(${args.stroke_angle}, true);`);
        if (args.brush_size !== undefined) setLines.push(`if (n === "Brush Size") prop.setValue(${args.brush_size}, true);`);
        if (args.stroke_length !== undefined) setLines.push(`if (n === "Stroke Length") prop.setValue(${args.stroke_length}, true);`);
        if (args.stroke_density !== undefined) setLines.push(`if (n === "Stroke Density") prop.setValue(${args.stroke_density}, true);`);
        if (args.stroke_randomness !== undefined) setLines.push(`if (n === "Stroke Randomness") prop.setValue(${args.stroke_randomness}, true);`);
        if (args.paint_surface !== undefined) setLines.push(`if (n === "Paint Surface") prop.setValue(${Math.round(args.paint_surface)}, true);`);
        if (args.blend_with_original !== undefined) setLines.push(`if (n === "Blend With Original") prop.setValue(${args.blend_with_original}, true);`);

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Brush Strokes is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Brush Strokes") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Brush Strokes");
            if (!eff || !eff.name) return __error("Brush Strokes effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Brush Strokes") {
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

    apply_emboss: {
      description:
        "Apply Emboss effect — grayscale embossed look (highlights edges as raised relief on a neutral gray). For colored embossing, use apply_color_emboss.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          direction: { type: "number", description: "Light direction in degrees (default 45)" },
          relief: { type: "number", description: "Relief depth 0-50 (default 1). Larger = more pronounced 3D look." },
          contrast: { type: "number", description: "Contrast 0-1000 (default 100)" },
          blend_with_original: { type: "number", description: "Blend with original 0.0-1.0 (default 0)" },
        },
        required: ["node_id"],
      },
      handler: async (args: {
        node_id: string;
        direction?: number;
        relief?: number;
        contrast?: number;
        blend_with_original?: number;
      }) => {
        const setLines: string[] = [];
        if (args.direction !== undefined) setLines.push(`if (n === "Direction") prop.setValue(${args.direction}, true);`);
        if (args.relief !== undefined) setLines.push(`if (n === "Relief") prop.setValue(${args.relief}, true);`);
        if (args.contrast !== undefined) setLines.push(`if (n === "Contrast") prop.setValue(${args.contrast}, true);`);
        if (args.blend_with_original !== undefined) setLines.push(`if (n === "Blend With Original") prop.setValue(${args.blend_with_original}, true);`);

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Emboss is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Emboss") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Emboss");
            if (!eff || !eff.name) return __error("Emboss effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Emboss") {
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

    apply_color_emboss: {
      description:
        "Apply Color Emboss effect — preserves original colors while adding embossed edge relief. For grayscale embossing use apply_emboss.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          direction: { type: "number", description: "Light direction in degrees (default 45)" },
          relief: { type: "number", description: "Relief depth (default 1)" },
          contrast: { type: "number", description: "Contrast (default 100)" },
          blend_with_original: { type: "number", description: "Blend with original 0.0-1.0 (default 0)" },
        },
        required: ["node_id"],
      },
      handler: async (args: {
        node_id: string;
        direction?: number;
        relief?: number;
        contrast?: number;
        blend_with_original?: number;
      }) => {
        const setLines: string[] = [];
        if (args.direction !== undefined) setLines.push(`if (n === "Direction") prop.setValue(${args.direction}, true);`);
        if (args.relief !== undefined) setLines.push(`if (n === "Relief") prop.setValue(${args.relief}, true);`);
        if (args.contrast !== undefined) setLines.push(`if (n === "Contrast") prop.setValue(${args.contrast}, true);`);
        if (args.blend_with_original !== undefined) setLines.push(`if (n === "Blend With Original") prop.setValue(${args.blend_with_original}, true);`);

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Color Emboss is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Color Emboss") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Color Emboss");
            if (!eff || !eff.name) return __error("Color Emboss effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Color Emboss") {
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

    apply_linear_wipe: {
      description:
        "Apply Linear Wipe effect — directional wipe revealing transparency from one edge. Animate `transition_completion` over time for a wipe-on/wipe-off transition. Acts on the layer (not as a transition between two clips).",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          transition_completion: { type: "number", description: "Wipe progress 0-100 (default 0 = fully visible, 100 = fully wiped to transparent). Animate this for the actual wipe." },
          wipe_angle: { type: "number", description: "Wipe direction in degrees (default 90 = wipe from left). 0=top, 90=left, 180=bottom, 270=right." },
          feather: { type: "number", description: "Wipe edge softness in pixels (default 0)" },
        },
        required: ["node_id"],
      },
      handler: async (args: {
        node_id: string;
        transition_completion?: number;
        wipe_angle?: number;
        feather?: number;
      }) => {
        const setLines: string[] = [];
        if (args.transition_completion !== undefined) setLines.push(`if (n === "Transition Completion") prop.setValue(${args.transition_completion}, true);`);
        if (args.wipe_angle !== undefined) setLines.push(`if (n === "Wipe Angle") prop.setValue(${args.wipe_angle}, true);`);
        if (args.feather !== undefined) setLines.push(`if (n === "Feather") prop.setValue(${args.feather}, true);`);

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Linear Wipe is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Linear Wipe") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Linear Wipe");
            if (!eff || !eff.name) return __error("Linear Wipe effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Linear Wipe") {
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

    apply_radial_wipe: {
      description:
        "Apply Radial Wipe effect — clock-style wipe revealing transparency around a center point. Acts on the layer (not as a transition between two clips). Animate `transition_completion` over time.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          transition_completion: { type: "number", description: "Wipe progress 0-100 (default 0)" },
          start_angle: { type: "number", description: "Start angle in degrees (default 0 = top, clockwise)" },
          center_x: { type: "number", description: "Pivot X 0.0-1.0 normalized (default 0.5 = center)" },
          center_y: { type: "number", description: "Pivot Y 0.0-1.0 normalized (default 0.5)" },
          wipe: { type: "number", description: "Direction: 0=Clockwise (default), 1=Counterclockwise, 2=Both (sweeping outward)" },
          feather: { type: "number", description: "Edge softness in pixels (default 0)" },
        },
        required: ["node_id"],
      },
      handler: async (args: {
        node_id: string;
        transition_completion?: number;
        start_angle?: number;
        center_x?: number;
        center_y?: number;
        wipe?: number;
        feather?: number;
      }) => {
        const setLines: string[] = [];
        if (args.transition_completion !== undefined) setLines.push(`if (n === "Transition Completion") prop.setValue(${args.transition_completion}, true);`);
        if (args.start_angle !== undefined) setLines.push(`if (n === "Start Angle") prop.setValue(${args.start_angle}, true);`);
        if (args.center_x !== undefined || args.center_y !== undefined) {
          const cx = args.center_x ?? 0.5;
          const cy = args.center_y ?? 0.5;
          setLines.push(`if (n === "Wipe Center") prop.setValue([${cx}, ${cy}], true);`);
        }
        if (args.wipe !== undefined) setLines.push(`if (n === "Wipe") prop.setValue(${Math.round(args.wipe)}, true);`);
        if (args.feather !== undefined) setLines.push(`if (n === "Feather") prop.setValue(${args.feather}, true);`);

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Radial Wipe is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Radial Wipe") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Radial Wipe");
            if (!eff || !eff.name) return __error("Radial Wipe effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Radial Wipe") {
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

    apply_lens_distortion: {
      description:
        "Apply Lens Distortion effect — simulate or correct lens curvature/decentering/prism aberration. Different from existing apply_lens_distortion_correction (which uses Lens Correction effect).",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          curvature: { type: "number", description: "Barrel/pincushion -100 to 100 (default 0). Negative = pincushion, positive = barrel." },
          vertical_decentering: { type: "number", description: "Vertical lens shift (default 0)" },
          horizontal_decentering: { type: "number", description: "Horizontal lens shift (default 0)" },
          vertical_prism_fx: { type: "number", description: "Vertical chromatic prism (default 0)" },
          horizontal_prism_fx: { type: "number", description: "Horizontal chromatic prism (default 0)" },
          fill_alpha: { type: "boolean", description: "Fill empty edges with alpha transparency (default true). False = use fill_color." },
          fill_color: {
            type: "array",
            items: { type: "number" },
            description: "Edge fill color [R, G, B] each 0-255 (optional 4th alpha) — only used when fill_alpha=false. Default white.",
          },
        },
        required: ["node_id"],
      },
      handler: async (args: {
        node_id: string;
        curvature?: number;
        vertical_decentering?: number;
        horizontal_decentering?: number;
        vertical_prism_fx?: number;
        horizontal_prism_fx?: number;
        fill_alpha?: boolean;
        fill_color?: number[];
      }) => {
        const setLines: string[] = [];
        if (args.curvature !== undefined) setLines.push(`if (n === "Curvature") prop.setValue(${args.curvature}, true);`);
        if (args.vertical_decentering !== undefined) setLines.push(`if (n === "Vertical Decentering") prop.setValue(${args.vertical_decentering}, true);`);
        if (args.horizontal_decentering !== undefined) setLines.push(`if (n === "Horizontal Decentering") prop.setValue(${args.horizontal_decentering}, true);`);
        if (args.vertical_prism_fx !== undefined) setLines.push(`if (n === "Vertical Prism FX") prop.setValue(${args.vertical_prism_fx}, true);`);
        if (args.horizontal_prism_fx !== undefined) setLines.push(`if (n === "Horizontal Prism FX") prop.setValue(${args.horizontal_prism_fx}, true);`);
        if (args.fill_alpha !== undefined) setLines.push(`if (n === "Fill Alpha") prop.setValue(${args.fill_alpha ? "true" : "false"}, true);`);
        if (args.fill_color && args.fill_color.length >= 3) {
          const [r, g, b] = args.fill_color;
          const a = args.fill_color[3] ?? 255;
          setLines.push(`if (n === "Fill Color") prop.setColorValue(${r}, ${g}, ${b}, ${a});`);
        }

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

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Lens Distortion") {
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

    apply_posterize_time: {
      description:
        "Apply Posterize Time effect — locks playback to a fixed frame rate, freezing N frames into 1 (creates stop-motion / stutter look). Common for music-video / animation styles.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          frame_rate: { type: "number", description: "Posterized frame rate fps (default 24). Lower = more pronounced stutter (e.g. 12 = anime, 8 = strong stop-motion)." },
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string; frame_rate?: number }) => {
        const setLines: string[] = [];
        if (args.frame_rate !== undefined) setLines.push(`if (n === "Frame Rate") prop.setValue(${args.frame_rate}, true);`);

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Posterize Time is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Posterize Time") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Posterize Time");
            if (!eff || !eff.name) return __error("Posterize Time effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Posterize Time") {
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

    apply_edge_feather: {
      description:
        "Apply Edge Feather effect — softly fades the rectangular frame edges to transparent. Single Amount parameter (pixels).",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          amount: { type: "number", description: "Feather amount in pixels (default 4). 0 = no feather, higher = wider soft edge." },
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string; amount?: number }) => {
        const setLines: string[] = [];
        if (args.amount !== undefined) setLines.push(`if (n === "Amount") prop.setValue(${args.amount}, true);`);

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Edge Feather is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Edge Feather") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Edge Feather");
            if (!eff || !eff.name) return __error("Edge Feather effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Edge Feather") {
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

    apply_magnify: {
      description:
        "Apply Magnify effect — circular/rectangular magnifying-glass overlay zooming a region. Useful for emphasizing UI elements, text, or details.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          shape: { type: "number", description: "0=Circle (default), 1=Square" },
          center_x: { type: "number", description: "Center X 0.0-1.0 normalized (default 0.5)" },
          center_y: { type: "number", description: "Center Y 0.0-1.0 normalized (default 0.5)" },
          magnification: { type: "number", description: "Zoom percent (default 150). 100 = no zoom, 200 = 2x." },
          link: { type: "number", description: "Link mode: 0=None (default), 1=Size to Magnification, 2=Size & Feather to Magnification" },
          size: { type: "number", description: "Magnifier size in pixels (default 100). Ignored if link != 0." },
          feather: { type: "number", description: "Edge softness in pixels (default 0)" },
          opacity: { type: "number", description: "Magnifier opacity 0-100 (default 100)" },
          scaling: { type: "number", description: "0=Standard (default), 1=Soft, 2=Scatter" },
          resize_layer: { type: "boolean", description: "Resize layer (default false)" },
        },
        required: ["node_id"],
      },
      handler: async (args: {
        node_id: string;
        shape?: number;
        center_x?: number;
        center_y?: number;
        magnification?: number;
        link?: number;
        size?: number;
        feather?: number;
        opacity?: number;
        scaling?: number;
        resize_layer?: boolean;
      }) => {
        const setLines: string[] = [];
        if (args.shape !== undefined) setLines.push(`if (n === "Shape") prop.setValue(${Math.round(args.shape)}, true);`);
        if (args.center_x !== undefined || args.center_y !== undefined) {
          const cx = args.center_x ?? 0.5;
          const cy = args.center_y ?? 0.5;
          setLines.push(`if (n === "Center") prop.setValue([${cx}, ${cy}], true);`);
        }
        if (args.magnification !== undefined) setLines.push(`if (n === "Magnification") prop.setValue(${args.magnification}, true);`);
        if (args.link !== undefined) setLines.push(`if (n === "Link") prop.setValue(${Math.round(args.link)}, true);`);
        if (args.size !== undefined) setLines.push(`if (n === "Size") prop.setValue(${args.size}, true);`);
        if (args.feather !== undefined) setLines.push(`if (n === "Feather") prop.setValue(${args.feather}, true);`);
        if (args.opacity !== undefined) setLines.push(`if (n === "Opacity") prop.setValue(${args.opacity}, true);`);
        if (args.scaling !== undefined) setLines.push(`if (n === "Scaling") prop.setValue(${Math.round(args.scaling)}, true);`);
        if (args.resize_layer !== undefined) setLines.push(`if (n === "Resize Layer") prop.setValue(${args.resize_layer ? "true" : "false"}, true);`);

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Magnify is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Magnify") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Magnify");
            if (!eff || !eff.name) return __error("Magnify effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Magnify") {
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

    apply_compound_blur: {
      description:
        "Apply Compound Blur effect — variable blur amount based on luminance map (the layer's own luminance acts as the map). Bright pixels = strong blur, dark = sharp. Note: 'Blur Layer' parameter selects external layer reference and is not settable from API in 25.4.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          maximum_blur: { type: "number", description: "Maximum blur radius at brightest map pixels (default 20)" },
          stretch_map_to_fit: { type: "boolean", description: "Stretch luminance map to fit layer bounds (default true)" },
          invert_blur: { type: "boolean", description: "Invert: dark=blur, bright=sharp (default false)" },
        },
        required: ["node_id"],
      },
      handler: async (args: {
        node_id: string;
        maximum_blur?: number;
        stretch_map_to_fit?: boolean;
        invert_blur?: boolean;
      }) => {
        const setLines: string[] = [];
        if (args.maximum_blur !== undefined) setLines.push(`if (n === "Maximum Blur") prop.setValue(${args.maximum_blur}, true);`);
        if (args.stretch_map_to_fit !== undefined) setLines.push(`if (n === "Stretch Map to Fit") prop.setValue(${args.stretch_map_to_fit ? "true" : "false"}, true);`);
        if (args.invert_blur !== undefined) setLines.push(`if (n === "Invert Blur") prop.setValue(${args.invert_blur ? "true" : "false"}, true);`);

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Compound Blur is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Compound Blur") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Compound Blur");
            if (!eff || !eff.name) return __error("Compound Blur effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Compound Blur") {
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

    apply_color_replace: {
      description:
        "Apply Color Replace effect — swaps a target color with a replacement color. Useful for changing the color of an object/wall/garment without rotoscoping.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          target_color: {
            type: "array",
            items: { type: "number" },
            description: "Color to replace as [R, G, B] each 0-255 (optional 4th alpha 0-255).",
          },
          replace_color: {
            type: "array",
            items: { type: "number" },
            description: "Replacement color as [R, G, B] each 0-255 (optional 4th alpha 0-255).",
          },
          similarity: { type: "number", description: "Similarity threshold 0-100 (default 10). Higher = wider color range matched." },
          solid_colors: { type: "boolean", description: "Replace as solid color instead of preserving luminance (default false)" },
        },
        required: ["node_id"],
      },
      handler: async (args: {
        node_id: string;
        target_color?: number[];
        replace_color?: number[];
        similarity?: number;
        solid_colors?: boolean;
      }) => {
        const setLines: string[] = [];
        if (args.similarity !== undefined) setLines.push(`if (n === "Similarity") prop.setValue(${args.similarity}, true);`);
        if (args.solid_colors !== undefined) setLines.push(`if (n === "Solid Colors") prop.setValue(${args.solid_colors ? "true" : "false"}, true);`);
        if (args.target_color && args.target_color.length >= 3) {
          const [tr, tg, tb] = args.target_color;
          const ta = args.target_color[3] ?? 255;
          setLines.push(`if (n === "Target Color") prop.setColorValue(${tr}, ${tg}, ${tb}, ${ta});`);
        }
        if (args.replace_color && args.replace_color.length >= 3) {
          const [rr, rg, rb] = args.replace_color;
          const ra = args.replace_color[3] ?? 255;
          setLines.push(`if (n === "Replace Color") prop.setColorValue(${rr}, ${rg}, ${rb}, ${ra});`);
        }

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Color Replace is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Color Replace") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Color Replace");
            if (!eff || !eff.name) return __error("Color Replace effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Color Replace") {
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

    apply_color_pass: {
      description:
        "Apply Color Pass effect — preserves only one color (or its inverse), desaturates everything else. Classic Schindler's-List-style selective color look.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          color: {
            type: "array",
            items: { type: "number" },
            description: "Color to preserve as [R, G, B] each 0-255 (optional 4th alpha 0-255). Default red.",
          },
          similarity: { type: "number", description: "Similarity threshold 0-100 (default 10). Higher = wider color range preserved." },
          reverse: { type: "boolean", description: "Reverse: desaturate the chosen color, preserve the rest (default false)" },
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string; color?: number[]; similarity?: number; reverse?: boolean }) => {
        const setLines: string[] = [];
        if (args.similarity !== undefined) setLines.push(`if (n === "Similarity") prop.setValue(${args.similarity}, true);`);
        if (args.reverse !== undefined) setLines.push(`if (n === "Reverse") prop.setValue(${args.reverse ? "true" : "false"}, true);`);
        if (args.color && args.color.length >= 3) {
          const [r, g, b] = args.color;
          const a = args.color[3] ?? 255;
          setLines.push(`if (n === "Color") prop.setColorValue(${r}, ${g}, ${b}, ${a});`);
        }

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Color Pass is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Color Pass") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Color Pass");
            if (!eff || !eff.name) return __error("Color Pass effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Color Pass") {
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

    apply_gamma_correction: {
      description:
        "Apply Gamma Correction effect — adjusts midtones without affecting black/white points. Default stored value is 10 (= linear/no change). Higher = brighter midtones, lower = darker midtones. Premiere UI typical range 1-28.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          gamma: { type: "number", description: "Gamma value, integer 1-28 (default 10 = no change). 28=brightest midtones, 1=darkest. Note: this is the raw slider value, not the 0.1-2.8 gamma curve." },
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string; gamma?: number }) => {
        const setLines: string[] = [];
        if (args.gamma !== undefined) setLines.push(`if (n === "Gamma") prop.setValue(${Math.round(args.gamma)}, true);`);

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Gamma Correction is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Gamma Correction") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Gamma Correction");
            if (!eff || !eff.name) return __error("Gamma Correction effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Gamma Correction") {
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

    apply_channel_blur: {
      description:
        "Apply Channel Blur effect — blurs each RGBA channel independently. Useful for chromatic-aberration looks (different blur per RGB) or selective alpha softening.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          red_blurriness: { type: "number", description: "Red channel blur radius (default 0)" },
          green_blurriness: { type: "number", description: "Green channel blur radius (default 0)" },
          blue_blurriness: { type: "number", description: "Blue channel blur radius (default 0)" },
          alpha_blurriness: { type: "number", description: "Alpha channel blur radius (default 0)" },
          repeat_edge_pixels: { type: "boolean", description: "Repeat edge pixels to avoid darkening edges (default true)" },
          blur_dimensions: { type: "number", description: "0=Both (default), 1=Horizontal only, 2=Vertical only" },
        },
        required: ["node_id"],
      },
      handler: async (args: {
        node_id: string;
        red_blurriness?: number;
        green_blurriness?: number;
        blue_blurriness?: number;
        alpha_blurriness?: number;
        repeat_edge_pixels?: boolean;
        blur_dimensions?: number;
      }) => {
        const setLines: string[] = [];
        if (args.red_blurriness !== undefined) setLines.push(`if (n === "Red Blurriness") prop.setValue(${args.red_blurriness}, true);`);
        if (args.green_blurriness !== undefined) setLines.push(`if (n === "Green Blurriness") prop.setValue(${args.green_blurriness}, true);`);
        if (args.blue_blurriness !== undefined) setLines.push(`if (n === "Blue Blurriness") prop.setValue(${args.blue_blurriness}, true);`);
        if (args.alpha_blurriness !== undefined) setLines.push(`if (n === "Alpha Blurriness") prop.setValue(${args.alpha_blurriness}, true);`);
        if (args.repeat_edge_pixels !== undefined) setLines.push(`if (n === "Repeat Edge Pixels") prop.setValue(${args.repeat_edge_pixels ? "true" : "false"}, true);`);
        if (args.blur_dimensions !== undefined) setLines.push(`if (n === "Blur Dimensions") prop.setValue(${Math.round(args.blur_dimensions)}, true);`);

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Channel Blur is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Channel Blur") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Channel Blur");
            if (!eff || !eff.name) return __error("Channel Blur effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Channel Blur") {
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

    apply_strobe_light: {
      description:
        "Apply Strobe Light effect — adds rhythmic flashes/strobing. Configure flash duration, period (frequency), color, and operator (how the strobe combines with the source).",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          strobe_color: {
            type: "array",
            items: { type: "number" },
            description: "Strobe flash color [R, G, B] each 0-255 (optional 4th alpha). Default white.",
          },
          blend_with_original: { type: "number", description: "Blend with original 0.0-1.0 normalized (default 0 = full strobe color)" },
          strobe_duration: { type: "number", description: "Duration of each flash in seconds (default 0.5)" },
          strobe_period: { type: "number", description: "Period between flash starts in seconds (default 1.0). Must be > strobe_duration." },
          random_strobe_probability: { type: "number", description: "Probability of random strobe events 0.0-1.0 (default 0)" },
          strobe: { type: "number", description: "0=Operates on Color Only (default), 1=Makes Layer Transparent" },
          strobe_operator: { type: "number", description: "Combine operator: 0=Copy (default), 1=Add, 2=Subtract, 3=Multiply, 4=Difference, 5=Or, 6=And, 7=Xor" },
        },
        required: ["node_id"],
      },
      handler: async (args: {
        node_id: string;
        strobe_color?: number[];
        blend_with_original?: number;
        strobe_duration?: number;
        strobe_period?: number;
        random_strobe_probability?: number;
        strobe?: number;
        strobe_operator?: number;
      }) => {
        const setLines: string[] = [];
        if (args.blend_with_original !== undefined) setLines.push(`if (n === "Blend With Original") prop.setValue(${args.blend_with_original}, true);`);
        if (args.strobe_duration !== undefined) setLines.push(`if (n === "Strobe Duration (secs)") prop.setValue(${args.strobe_duration}, true);`);
        if (args.strobe_period !== undefined) setLines.push(`if (n === "Strobe Period (secs)") prop.setValue(${args.strobe_period}, true);`);
        if (args.random_strobe_probability !== undefined) setLines.push(`if (n === "Random Strobe Probablity") prop.setValue(${args.random_strobe_probability}, true);`);
        if (args.strobe !== undefined) setLines.push(`if (n === "Strobe") prop.setValue(${Math.round(args.strobe)}, true);`);
        if (args.strobe_operator !== undefined) setLines.push(`if (n === "Strobe Operator") prop.setValue(${Math.round(args.strobe_operator)}, true);`);
        if (args.strobe_color && args.strobe_color.length >= 3) {
          const [r, g, b] = args.strobe_color;
          const a = args.strobe_color[3] ?? 255;
          setLines.push(`if (n === "Strobe Color") prop.setColorValue(${r}, ${g}, ${b}, ${a});`);
        }

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Strobe Light is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Strobe Light") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Strobe Light");
            if (!eff || !eff.name) return __error("Strobe Light effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Strobe Light") {
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

    apply_median_legacy: {
      description:
        "Apply Median (Legacy) effect — replaces each pixel with the median of neighboring pixels. Removes salt-and-pepper noise; creates a painterly look at higher radii.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: { type: "string", description: "Node ID of the video clip" },
          radius: { type: "number", description: "Neighborhood radius in pixels (default 0 = no effect, typical 1-5). Larger = stronger smoothing/painterly look but heavier compute." },
          operate_on_alpha: { type: "boolean", description: "Apply median to alpha channel too (default false)" },
        },
        required: ["node_id"],
      },
      handler: async (args: { node_id: string; radius?: number; operate_on_alpha?: boolean }) => {
        const setLines: string[] = [];
        if (args.radius !== undefined) setLines.push(`if (n === "Radius") prop.setValue(${args.radius}, true);`);
        if (args.operate_on_alpha !== undefined) setLines.push(`if (n === "Operate On Alpha Channel") prop.setValue(${args.operate_on_alpha ? "true" : "false"}, true);`);

        const script = buildToolScript(`
          app.enableQE();
          var qeSeq = qe.project.getActiveSequence();
          if (!qeSeq) return __error("No active sequence (QE)");
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          if (result.trackType !== "video") return __error("Median (Legacy) is video-only");

          var qeClip = __getQEClip(result);
          if (!qeClip) return __error("QE clip not found");

          var clip = result.clip;
          var already = false;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "Median (Legacy)") { already = true; break; }
          }
          if (!already) {
            var eff = qe.project.getVideoEffectByName("Median (Legacy)");
            if (!eff || !eff.name) return __error("Median (Legacy) effect not found");
            qeClip.addVideoEffect(eff);
          }

          for (var j = 0; j < clip.components.numItems; j++) {
            var comp = clip.components[j];
            if (comp.displayName === "Median (Legacy)") {
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
  };
}
