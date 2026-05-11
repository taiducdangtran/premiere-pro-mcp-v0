import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";

export function getKeyframeTools(bridgeOptions: BridgeOptions) {
  return {
    get_effect_properties: {
      description:
        "List all properties of a specific effect on a clip, including current values. " +
        "Bug #25 fix (v1.2.10): Lumetri Color exposes ~25 internal binary-blob properties (empty/whitespace/BOM displayNames + out-of-range numeric values). " +
        "Tool now filters these by default. Pass `include_internal: true` to see the raw unfiltered list.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          effect_name: {
            type: "string",
            description: "Display name of the effect (e.g., 'Motion', 'Opacity', 'Lumetri Color')",
          },
          include_internal: {
            type: "boolean",
            description: "Include internal/binary properties (empty names, BOM chars, ridiculous numbers). Default: false.",
          },
        },
        required: ["node_id", "effect_name"],
      },
      handler: async (args: { node_id: string; effect_name: string; include_internal?: boolean }) => {
        const includeInternal = args.include_internal === true;
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");

          var clip = result.clip;
          var effectName = "${escapeForExtendScript(args.effect_name)}";
          var includeInternal = ${includeInternal ? "true" : "false"};
          var comp = null;

          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === effectName || clip.components[i].matchName === effectName) {
              comp = clip.components[i];
              break;
            }
          }

          if (!comp) return __error("Effect not found: " + effectName);

          // Bug #25 v3 (v1.2.14): robust filter for Lumetri internal/binary props.
          // Tester confirmed BOM "﻾" still leaked in v1.2.13 — root cause is the
          // val may be a String wrapper (typeof "object") not a primitive, and
          // we also need to strip control chars + huge JSON blobs.
          function __sanitizeBlob(v) {
            // Returns a "clean" representation: null when value is just BOM/control
            // garbage, otherwise the stringified value (capped).
            if (v === null || v === undefined) return v;
            if (typeof v === "number" || typeof v === "boolean") return v;
            var s;
            try { s = String(v); } catch(e) { return null; }
            if (s.length === 0) return s;
            // strip BOM, zero-width, control chars (U+0000-U+001F)
            var stripped = s.replace(/^[\\s\\uFEFF\\u200B-\\u200D\\u0000-\\u001F]+|[\\s\\uFEFF\\u200B-\\u200D\\u0000-\\u001F]+$/g, "");
            if (stripped.length === 0) return null; // was all garbage
            return s;
          }
          function __isInternalProp(name, val) {
            // strip whitespace and BOM/zero-width chars from name
            var clean = String(name || "").replace(/^[\\s\\uFEFF\\u200B-\\u200D\\u0000-\\u001F]+|[\\s\\uFEFF\\u200B-\\u200D\\u0000-\\u001F]+$/g, "");
            if (!clean) return true;
            // pure non-printable garbage
            if (!/[A-Za-z0-9]/.test(clean)) return true;
            // pointer-style numbers (18+ digits)
            if (typeof val === "number" && (val > 1e15 || val < -1e15)) return true;
            // value sanitize → null means all-garbage (BOM/control)
            if (val !== null && val !== undefined && typeof val !== "number" && typeof val !== "boolean") {
              var cleanedVal = __sanitizeBlob(val);
              if (cleanedVal === null) return true;
              // also drop massive JSON blob strings (e.g. Lumetri "Auto Tone Analytics Data")
              if (typeof cleanedVal === "string" && cleanedVal.length > 500) {
                // keep visible name but filter out massive value? prefer to filter the whole prop
                return true;
              }
            }
            return false;
          }

          var props = [];
          var filteredCount = 0;
          for (var p = 0; p < comp.properties.numItems; p++) {
            var prop = comp.properties[p];
            var dn = "";
            try { dn = prop.displayName; } catch(eDN) {}
            var pv = null;
            try { pv = prop.getValue(0, 0); } catch(eGV) {}

            if (!includeInternal && __isInternalProp(dn, pv)) {
              filteredCount++;
              continue;
            }

            var info = {
              index: p,
              displayName: dn,
              isTimeVarying: false,
              keyframesSupported: false,
              value: pv
            };
            try { info.isTimeVarying = prop.isTimeVarying(); } catch(eTV) {}
            try { info.keyframesSupported = prop.areKeyframesSupported(); } catch(eKS) {}
            props.push(info);
          }

          return __result({
            effect: comp.displayName,
            matchName: comp.matchName,
            properties: props,
            filteredInternalCount: filteredCount,
            _note: filteredCount > 0 ? "Filtered " + filteredCount + " internal/binary properties. Pass include_internal=true to see them." : undefined
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_effect_property: {
      description:
        "Set the value of a specific effect property on a clip. " +
        "Bug #79 fix: when a component has duplicate property names (e.g., Opacity has 2x 'Blend Mode' in 25.4), pass `property_index` (from `list_clip_effects`) to target a specific occurrence. Without `property_index`, the first match by displayName is used (legacy behaviour). `match_name` is also accepted as a more reliable alternative to display name.",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          effect_name: {
            type: "string",
            description: "Display name of the effect (e.g., 'Motion', 'Opacity'). Optional if `match_name` is provided.",
          },
          property_name: {
            type: "string",
            description: "Display name of the property (e.g., 'Scale', 'Position', 'Opacity'). Optional if `property_index` is provided.",
          },
          property_index: {
            type: "number",
            description: "Exact 0-based index of the property within the component. Use to disambiguate when multiple properties share a displayName (Bug #79). Takes precedence over property_name.",
          },
          match_name: {
            type: "string",
            description: "Property matchName (internal ID, more stable than displayName). Tried after property_index but before property_name.",
          },
          value: {
            type: "number",
            description: "Value to set",
          },
        },
        required: ["node_id", "effect_name", "value"],
      },
      handler: async (args: { node_id: string; effect_name: string; property_name?: string; property_index?: number; match_name?: string; value: number }) => {
        if (args.property_index === undefined && !args.property_name && !args.match_name) {
          return Promise.resolve({ success: false, error: "Provide at least one of: property_index, property_name, match_name." });
        }
        const propIdxLiteral = args.property_index !== undefined ? String(args.property_index) : "null";
        const propNameLiteral = args.property_name !== undefined ? `"${escapeForExtendScript(args.property_name)}"` : "null";
        const matchNameLiteral = args.match_name !== undefined ? `"${escapeForExtendScript(args.match_name)}"` : "null";
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");

          var clip = result.clip;
          var comp = null;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "${escapeForExtendScript(args.effect_name)}" || clip.components[i].matchName === "${escapeForExtendScript(args.effect_name)}") {
              comp = clip.components[i];
              break;
            }
          }
          if (!comp) return __error("Effect not found: ${escapeForExtendScript(args.effect_name)}");

          var prop = null;
          var resolvedVia = null;
          var targetIdx = ${propIdxLiteral};
          var targetName = ${propNameLiteral};
          var targetMatch = ${matchNameLiteral};

          if (targetIdx !== null) {
            if (targetIdx < 0 || targetIdx >= comp.properties.numItems) {
              return __error("property_index " + targetIdx + " out of range (component has " + comp.properties.numItems + " properties)");
            }
            prop = comp.properties[targetIdx];
            resolvedVia = "property_index";
          } else if (targetMatch !== null) {
            for (var pm = 0; pm < comp.properties.numItems; pm++) {
              var mn = null;
              try { mn = comp.properties[pm].matchName; } catch(eMN) {}
              if (mn === targetMatch) { prop = comp.properties[pm]; resolvedVia = "match_name"; break; }
            }
          }
          if (!prop && targetName !== null) {
            for (var p = 0; p < comp.properties.numItems; p++) {
              if (comp.properties[p].displayName === targetName) { prop = comp.properties[p]; resolvedVia = "property_name"; break; }
            }
          }
          if (!prop) return __error("Property not found via index=" + targetIdx + " match_name=" + targetMatch + " name=" + targetName);

          prop.setValue(${args.value}, true);
          return __result({
            set: true,
            effect: "${escapeForExtendScript(args.effect_name)}",
            property: prop.displayName,
            propertyIndex: targetIdx !== null ? targetIdx : null,
            resolvedVia: resolvedVia,
            value: ${args.value}
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_keyframes: {
      description: "Get all keyframes for a specific effect property on a clip",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          effect_name: {
            type: "string",
            description: "Display name of the effect",
          },
          property_name: {
            type: "string",
            description: "Display name of the property",
          },
        },
        required: ["node_id", "effect_name", "property_name"],
      },
      handler: async (args: { node_id: string; effect_name: string; property_name: string }) => {
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          
          var clip = result.clip;
          var comp = null;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "${escapeForExtendScript(args.effect_name)}" || clip.components[i].matchName === "${escapeForExtendScript(args.effect_name)}") {
              comp = clip.components[i];
              break;
            }
          }
          if (!comp) return __error("Effect not found");
          
          var prop = null;
          for (var p = 0; p < comp.properties.numItems; p++) {
            if (comp.properties[p].displayName === "${escapeForExtendScript(args.property_name)}") {
              prop = comp.properties[p];
              break;
            }
          }
          if (!prop) return __error("Property not found");
          
          var isTimeVarying = false;
          try { isTimeVarying = prop.isTimeVarying(); } catch(e) {}
          
          if (!isTimeVarying) {
            return __result({ keyframes: [], isTimeVarying: false, message: "Property has no keyframes" });
          }
          
          var keys = prop.getKeys();
          var keyframes = [];
          if (keys) {
            for (var k = 0; k < keys.length; k++) {
              var time = keys[k];
              var val = null;
              try { val = prop.getValueAtKey(time); } catch(e) {}
              keyframes.push({
                time: __ticksToSeconds(time.ticks),
                value: val
              });
            }
          }
          
          return __result({
            effect: "${escapeForExtendScript(args.effect_name)}",
            property: "${escapeForExtendScript(args.property_name)}",
            isTimeVarying: true,
            keyframes: keyframes
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    add_keyframe: {
      description: "Add a keyframe to an effect property at a specific time",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          effect_name: {
            type: "string",
            description: "Display name of the effect",
          },
          property_name: {
            type: "string",
            description: "Display name of the property",
          },
          time_seconds: {
            type: "number",
            description: "Time in seconds relative to clip start where to add keyframe",
          },
          value: {
            type: "number",
            description: "Value at the keyframe",
          },
        },
        required: ["node_id", "effect_name", "property_name", "time_seconds", "value"],
      },
      handler: async (args: {
        node_id: string;
        effect_name: string;
        property_name: string;
        time_seconds: number;
        value: number;
      }) => {
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          
          var clip = result.clip;
          var comp = null;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "${escapeForExtendScript(args.effect_name)}" || clip.components[i].matchName === "${escapeForExtendScript(args.effect_name)}") {
              comp = clip.components[i];
              break;
            }
          }
          if (!comp) return __error("Effect not found");
          
          var prop = null;
          for (var p = 0; p < comp.properties.numItems; p++) {
            if (comp.properties[p].displayName === "${escapeForExtendScript(args.property_name)}") {
              prop = comp.properties[p];
              break;
            }
          }
          if (!prop) return __error("Property not found");
          
          // Enable keyframes if not already
          try {
            if (!prop.isTimeVarying()) {
              prop.setTimeVarying(true);
            }
          } catch(e) {}
          
          var time = new Time();
          time.ticks = __secondsToTicks(${args.time_seconds}).toString();
          prop.addKey(time);
          prop.setValueAtKey(time, ${args.value}, true);
          
          return __result({
            added: true,
            effect: "${escapeForExtendScript(args.effect_name)}",
            property: "${escapeForExtendScript(args.property_name)}",
            time: ${args.time_seconds},
            value: ${args.value}
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    remove_keyframe: {
      description: "Remove a keyframe at a specific time from an effect property",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          effect_name: {
            type: "string",
            description: "Display name of the effect",
          },
          property_name: {
            type: "string",
            description: "Display name of the property",
          },
          time_seconds: {
            type: "number",
            description: "Time in seconds of the keyframe to remove",
          },
        },
        required: ["node_id", "effect_name", "property_name", "time_seconds"],
      },
      handler: async (args: { node_id: string; effect_name: string; property_name: string; time_seconds: number }) => {
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          
          var clip = result.clip;
          var comp = null;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "${escapeForExtendScript(args.effect_name)}" || clip.components[i].matchName === "${escapeForExtendScript(args.effect_name)}") {
              comp = clip.components[i];
              break;
            }
          }
          if (!comp) return __error("Effect not found");
          
          var prop = null;
          for (var p = 0; p < comp.properties.numItems; p++) {
            if (comp.properties[p].displayName === "${escapeForExtendScript(args.property_name)}") {
              prop = comp.properties[p];
              break;
            }
          }
          if (!prop) return __error("Property not found");
          
          var time = new Time();
          time.ticks = __secondsToTicks(${args.time_seconds}).toString();
          prop.removeKey(time);
          
          return __result({
            removed: true,
            effect: "${escapeForExtendScript(args.effect_name)}",
            property: "${escapeForExtendScript(args.property_name)}",
            time: ${args.time_seconds}
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    remove_keyframe_range: {
      description: "Remove all keyframes in a time range from an effect property",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          effect_name: {
            type: "string",
            description: "Display name of the effect",
          },
          property_name: {
            type: "string",
            description: "Display name of the property",
          },
          start_seconds: {
            type: "number",
            description: "Start of the range in seconds",
          },
          end_seconds: {
            type: "number",
            description: "End of the range in seconds",
          },
        },
        required: ["node_id", "effect_name", "property_name", "start_seconds", "end_seconds"],
      },
      handler: async (args: {
        node_id: string;
        effect_name: string;
        property_name: string;
        start_seconds: number;
        end_seconds: number;
      }) => {
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          
          var clip = result.clip;
          var comp = null;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "${escapeForExtendScript(args.effect_name)}" || clip.components[i].matchName === "${escapeForExtendScript(args.effect_name)}") {
              comp = clip.components[i];
              break;
            }
          }
          if (!comp) return __error("Effect not found");
          
          var prop = null;
          for (var p = 0; p < comp.properties.numItems; p++) {
            if (comp.properties[p].displayName === "${escapeForExtendScript(args.property_name)}") {
              prop = comp.properties[p];
              break;
            }
          }
          if (!prop) return __error("Property not found");
          
          var startTime = new Time();
          startTime.ticks = __secondsToTicks(${args.start_seconds}).toString();
          var endTime = new Time();
          endTime.ticks = __secondsToTicks(${args.end_seconds}).toString();
          prop.removeKeyRange(startTime, endTime);
          
          return __result({
            removed: true,
            effect: "${escapeForExtendScript(args.effect_name)}",
            property: "${escapeForExtendScript(args.property_name)}",
            range: { start: ${args.start_seconds}, end: ${args.end_seconds} }
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_keyframe_interpolation: {
      description: "Set the interpolation type of a keyframe (Linear, Hold, or Bezier)",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          effect_name: {
            type: "string",
            description: "Display name of the effect",
          },
          property_name: {
            type: "string",
            description: "Display name of the property",
          },
          time_seconds: {
            type: "number",
            description: "Time in seconds of the keyframe",
          },
          interpolation: {
            type: "string",
            enum: ["linear", "hold", "bezier"],
            description: "Interpolation type",
          },
        },
        required: ["node_id", "effect_name", "property_name", "time_seconds", "interpolation"],
      },
      handler: async (args: {
        node_id: string;
        effect_name: string;
        property_name: string;
        time_seconds: number;
        interpolation: string;
      }) => {
        const interpMap: Record<string, number> = { linear: 0, hold: 4, bezier: 5 };
        const interpType = interpMap[args.interpolation] ?? 0;

        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          
          var clip = result.clip;
          var comp = null;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "${escapeForExtendScript(args.effect_name)}" || clip.components[i].matchName === "${escapeForExtendScript(args.effect_name)}") {
              comp = clip.components[i];
              break;
            }
          }
          if (!comp) return __error("Effect not found");
          
          var prop = null;
          for (var p = 0; p < comp.properties.numItems; p++) {
            if (comp.properties[p].displayName === "${escapeForExtendScript(args.property_name)}") {
              prop = comp.properties[p];
              break;
            }
          }
          if (!prop) return __error("Property not found");
          
          var time = new Time();
          time.ticks = __secondsToTicks(${args.time_seconds}).toString();
          prop.setInterpolationTypeAtKey(time, ${interpType}, true);
          
          return __result({
            set: true,
            interpolation: "${args.interpolation}",
            time: ${args.time_seconds}
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_value_at_time: {
      description: "Get the interpolated value of an effect property at a specific time",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Node ID of the clip",
          },
          effect_name: {
            type: "string",
            description: "Display name of the effect",
          },
          property_name: {
            type: "string",
            description: "Display name of the property",
          },
          time_seconds: {
            type: "number",
            description: "Time in seconds to query the value at",
          },
        },
        required: ["node_id", "effect_name", "property_name", "time_seconds"],
      },
      handler: async (args: { node_id: string; effect_name: string; property_name: string; time_seconds: number }) => {
        const script = buildToolScript(`
          var result = __findClip("${escapeForExtendScript(args.node_id)}");
          if (!result) return __error("Clip not found");
          
          var clip = result.clip;
          var comp = null;
          for (var i = 0; i < clip.components.numItems; i++) {
            if (clip.components[i].displayName === "${escapeForExtendScript(args.effect_name)}" || clip.components[i].matchName === "${escapeForExtendScript(args.effect_name)}") {
              comp = clip.components[i];
              break;
            }
          }
          if (!comp) return __error("Effect not found");
          
          var prop = null;
          for (var p = 0; p < comp.properties.numItems; p++) {
            if (comp.properties[p].displayName === "${escapeForExtendScript(args.property_name)}") {
              prop = comp.properties[p];
              break;
            }
          }
          if (!prop) return __error("Property not found");
          
          var time = new Time();
          time.ticks = __secondsToTicks(${args.time_seconds}).toString();
          var value = prop.getValueAtTime(time);
          
          return __result({
            effect: "${escapeForExtendScript(args.effect_name)}",
            property: "${escapeForExtendScript(args.property_name)}",
            time: ${args.time_seconds},
            value: value
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },
  };
}
