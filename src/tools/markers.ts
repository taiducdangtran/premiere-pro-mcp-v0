import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";

export function getMarkerTools(bridgeOptions: BridgeOptions) {
  return {
    add_marker: {
      description: "Add a marker to the active sequence or a clip",
      parameters: {
        type: "object" as const,
        properties: {
          time_seconds: {
            type: "number",
            description: "Time position in seconds for the marker",
          },
          name: {
            type: "string",
            description: "Name/label for the marker",
          },
          comments: {
            type: "string",
            description: "Comments for the marker",
          },
          color: {
            type: "number",
            description: "Marker color index (0=Green, 1=Red, 2=Purple, 3=Orange, 4=Yellow, 5=White, 6=Blue, 7=Cyan)",
          },
          duration_seconds: {
            type: "number",
            description: "Duration of the marker in seconds (0 for point marker)",
          },
          node_id: {
            type: "string",
            description: "Optional clip node ID to add marker to clip instead of sequence",
          },
        },
        required: ["time_seconds"],
      },
      handler: async (args: {
        time_seconds: number;
        name?: string;
        comments?: string;
        color?: number;
        duration_seconds?: number;
        node_id?: string;
      }) => {
        // Bug #42 / #43: 25.4 expects time as Number (seconds), and clip-level markers
        // require getMarkers() rather than .markers property in some builds. Probe both.
        const markerTarget = args.node_id
          ? `var clipResult = __findClip("${escapeForExtendScript(args.node_id)}");
             if (!clipResult) return __error("Clip not found");
             // 25.4: clip.markers may be undefined; try clip.getMarkers() first.
             var markers = null;
             if (typeof clipResult.clip.getMarkers === "function") {
               try { markers = clipResult.clip.getMarkers(); } catch(eGM) {}
             }
             if (!markers) markers = clipResult.clip.markers;
             if (!markers) {
               return __result({
                 added: false,
                 available: false,
                 note: "Clip-level markers API unavailable in 25.4 — clip.getMarkers and clip.markers both undefined."
               });
             }`
          : `var seq = app.project.activeSequence;
             if (!seq) return __error("No active sequence");
             var markers = seq.markers;`;

        const script = buildToolScript(`
          ${markerTarget}

          // 25.4: createMarker takes Number (seconds), not ticks.
          var marker = null;
          try {
            marker = markers.createMarker(${args.time_seconds});
          } catch(e1) {
            // Older builds: try ticks-as-number
            try {
              marker = markers.createMarker(parseFloat(__secondsToTicks(${args.time_seconds}).toString()));
            } catch(e2) {
              return __error("createMarker failed: " + e1.toString() + " / fallback: " + e2.toString());
            }
          }
          if (!marker) return __error("createMarker returned null");

          try { ${args.name ? `marker.name = "${escapeForExtendScript(args.name)}";` : "/* no name */"} } catch(e) {}
          try { ${args.comments ? `marker.comments = "${escapeForExtendScript(args.comments)}";` : "/* no comments */"} } catch(e) {}
          try { ${args.color !== undefined ? `marker.setColorByIndex(${args.color});` : "/* no color */"} } catch(e) {}
          ${args.duration_seconds
            ? `try {
                 // marker.end expects same type as createMarker accepts (seconds).
                 marker.end = ${args.time_seconds + args.duration_seconds};
               } catch(eDur) {
                 try { marker.end = __secondsToTicks(${args.time_seconds + args.duration_seconds}).toString(); } catch(eDur2) {}
               }`
            : ""}

          return __result({
            added: true,
            timeSeconds: ${args.time_seconds},
            name: marker.name,
            comments: marker.comments
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    delete_marker: {
      description: "Delete a marker at a specific time position",
      parameters: {
        type: "object" as const,
        properties: {
          time_seconds: {
            type: "number",
            description: "Time position of the marker to delete",
          },
          node_id: {
            type: "string",
            description: "Optional clip node ID (deletes from sequence if omitted)",
          },
        },
        required: ["time_seconds"],
      },
      handler: async (args: { time_seconds: number; node_id?: string }) => {
        const markerTarget = args.node_id
          ? `var clipResult = __findClip("${escapeForExtendScript(args.node_id)}");
             if (!clipResult) return __error("Clip not found");
             var markers = clipResult.clip.markers;`
          : `var seq = app.project.activeSequence;
             if (!seq) return __error("No active sequence");
             var markers = seq.markers;`;

        const script = buildToolScript(`
          ${markerTarget}
          
          var targetTicks = __secondsToTicks(${args.time_seconds});
          var marker = markers.getFirstMarker();
          var deleted = false;
          
          while (marker) {
            var markerTicks = parseFloat(marker.start.ticks);
            if (Math.abs(markerTicks - targetTicks) < TICKS_PER_SECOND * 0.01) {
              markers.deleteMarker(marker);
              deleted = true;
              break;
            }
            marker = markers.getNextMarker(marker);
          }
          
          if (!deleted) return __error("No marker found at " + ${args.time_seconds} + "s");
          return __result({ deleted: true, timeSeconds: ${args.time_seconds} });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    update_marker: {
      description: "Update an existing marker's properties",
      parameters: {
        type: "object" as const,
        properties: {
          time_seconds: {
            type: "number",
            description: "Time position of the marker to update",
          },
          name: { type: "string", description: "New name" },
          comments: { type: "string", description: "New comments" },
          color: { type: "number", description: "New color index" },
        },
        required: ["time_seconds"],
      },
      handler: async (args: { time_seconds: number; name?: string; comments?: string; color?: number }) => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          
          var targetTicks = __secondsToTicks(${args.time_seconds});
          var marker = seq.markers.getFirstMarker();
          var found = false;
          
          while (marker) {
            var markerTicks = parseFloat(marker.start.ticks);
            if (Math.abs(markerTicks - targetTicks) < TICKS_PER_SECOND * 0.01) {
              ${args.name ? `marker.name = "${escapeForExtendScript(args.name)}";` : ""}
              ${args.comments ? `marker.comments = "${escapeForExtendScript(args.comments)}";` : ""}
              ${args.color !== undefined ? `marker.setColorByIndex(${args.color});` : ""}
              found = true;
              break;
            }
            marker = seq.markers.getNextMarker(marker);
          }
          
          if (!found) return __error("No marker found at " + ${args.time_seconds} + "s");
          return __result({ updated: true, timeSeconds: ${args.time_seconds} });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    list_markers: {
      description: "List all markers on the active sequence or a specific clip",
      parameters: {
        type: "object" as const,
        properties: {
          node_id: {
            type: "string",
            description: "Optional clip node ID to list clip markers instead of sequence markers",
          },
        },
      },
      handler: async (args: { node_id?: string }) => {
        const markerTarget = args.node_id
          ? `var clipResult = __findClip("${escapeForExtendScript(args.node_id)}");
             if (!clipResult) return __error("Clip not found");
             var markers = clipResult.clip.markers;`
          : `var seq = app.project.activeSequence;
             if (!seq) return __error("No active sequence");
             var markers = seq.markers;`;

        const script = buildToolScript(`
          ${markerTarget}
          
          var list = [];
          var marker = markers.getFirstMarker();
          while (marker) {
            list.push({
              name: marker.name,
              comments: marker.comments,
              startSeconds: __ticksToSeconds(marker.start.ticks),
              endSeconds: __ticksToSeconds(marker.end.ticks),
              type: marker.type
            });
            marker = markers.getNextMarker(marker);
          }
          
          return __result(list);
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    clear_all_markers: {
      description: "Remove all markers from the active sequence",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          var markers = seq.markers;
          var marker = markers.getFirstMarker();
          var count = 0;
          while (marker) {
            var next = markers.getNextMarker(marker);
            markers.deleteMarker(marker);
            count++;
            marker = next;
          }
          return __result({ removed: count });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },
  };
}
