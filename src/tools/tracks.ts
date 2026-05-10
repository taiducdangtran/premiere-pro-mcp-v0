import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";

export function getTrackTools(bridgeOptions: BridgeOptions) {
  return {
    add_track: {
      description: "Add a new video or audio track to the active sequence",
      parameters: {
        type: "object" as const,
        properties: {
          track_type: {
            type: "string",
            enum: ["video", "audio"],
            description: "Type of track to add",
          },
          count: {
            type: "number",
            description: "Number of tracks to add (default: 1)",
          },
        },
        required: ["track_type"],
      },
      handler: async (args: { track_type: string; count?: number }) => {
        const count = args.count ?? 1;
        const isVideo = args.track_type === "video";
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          var before = ${isVideo ? "seq.videoTracks.numTracks" : "seq.audioTracks.numTracks"};

          // 25.4 (Bug #49): seq.insertVideoTrackAt/insertAudioTrackAt removed.
          // Try DOM first, then add_tracks-style call (addTracks(numVideo, vIdx, numAudio, aIdx, type, numSubs, sIdx)).
          var inserted = false;
          var insertFn = ${isVideo ? "seq.insertVideoTrackAt" : "seq.insertAudioTrackAt"};
          if (typeof insertFn === "function") {
            try {
              ${isVideo ? `seq.insertVideoTrackAt(before, ${count});` : `seq.insertAudioTrackAt(before, ${count});`}
              inserted = true;
            } catch(e1) {}
          }
          if (!inserted && typeof seq.addTracks === "function") {
            try {
              ${isVideo
                ? `seq.addTracks(${count}, before, 0, 0, 1, 0, 0);`
                : `seq.addTracks(0, 0, ${count}, before, 1, 0, 0);`}
              inserted = true;
            } catch(e2) {}
          }

          var after = ${isVideo ? "seq.videoTracks.numTracks" : "seq.audioTracks.numTracks"};
          if (!inserted && after === before) {
            return __result({
              available: false,
              added: 0,
              trackType: "${args.track_type}",
              totalTracks: after,
              note: "add_track API removed in 25.4 — both insertVideoTrackAt/insertAudioTrackAt and seq.addTracks unavailable. Workaround: use the add_tracks tool (variant) or right-click the track header in UI."
            });
          }

          return __result({
            added: after - before,
            trackType: "${args.track_type}",
            totalTracks: after
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    delete_track: {
      description: "Delete a video or audio track from the active sequence",
      parameters: {
        type: "object" as const,
        properties: {
          track_type: {
            type: "string",
            enum: ["video", "audio"],
            description: "Type of track to delete",
          },
          track_index: {
            type: "number",
            description: "Index of the track to delete (0-based)",
          },
        },
        required: ["track_type", "track_index"],
      },
      handler: async (args: { track_type: string; track_index: number }) => {
        const isVideo = args.track_type === "video";
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          var numTracks = ${isVideo ? "seq.videoTracks.numTracks" : "seq.audioTracks.numTracks"};
          if (${args.track_index} >= numTracks) return __error("Track index out of range");

          // 25.4 (Bug #50): seq.deleteVideoTrackAt/deleteAudioTrackAt removed.
          var deleteFn = ${isVideo ? "seq.deleteVideoTrackAt" : "seq.deleteAudioTrackAt"};
          if (typeof deleteFn === "function") {
            try {
              ${isVideo ? `seq.deleteVideoTrackAt(${args.track_index});` : `seq.deleteAudioTrackAt(${args.track_index});`}
              return __result({ deleted: true, trackType: "${args.track_type}", trackIndex: ${args.track_index} });
            } catch(e1) {}
          }
          // QE fallback
          try {
            app.enableQE();
            var qeSeq = qe.project.getActiveSequence();
            var qeDeleteFn = ${isVideo ? "qeSeq.deleteVideoTrack" : "qeSeq.deleteAudioTrack"};
            if (typeof qeDeleteFn === "function") {
              ${isVideo ? `qeSeq.deleteVideoTrack(${args.track_index});` : `qeSeq.deleteAudioTrack(${args.track_index});`}
              return __result({ deleted: true, trackType: "${args.track_type}", trackIndex: ${args.track_index}, method: "QE" });
            }
          } catch(e2) {}

          return __result({
            available: false,
            deleted: false,
            note: "delete_track API removed in 25.4 — seq.deleteVideoTrackAt/deleteAudioTrackAt and QE qeSeq.deleteVideoTrack/deleteAudioTrack all undefined. Workaround: right-click track header in UI > Delete Track."
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    lock_track: {
      description: "Lock or unlock a video track",
      parameters: {
        type: "object" as const,
        properties: {
          track_index: {
            type: "number",
            description: "Video track index (0-based)",
          },
          locked: {
            type: "boolean",
            description: "True to lock, false to unlock",
          },
        },
        required: ["track_index", "locked"],
      },
      handler: async (args: { track_index: number; locked: boolean }) => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          
          if (${args.track_index} >= seq.videoTracks.numTracks) return __error("Track index out of range");
          
          var track = seq.videoTracks[${args.track_index}];
          track.setLocked(${args.locked ? 1 : 0});
          
          return __result({ trackIndex: ${args.track_index}, locked: ${args.locked}, trackName: track.name });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    toggle_track_visibility: {
      description: "Toggle a video track's visibility (eye icon)",
      parameters: {
        type: "object" as const,
        properties: {
          track_index: {
            type: "number",
            description: "Video track index (0-based)",
          },
          visible: {
            type: "boolean",
            description: "True to show, false to hide",
          },
        },
        required: ["track_index", "visible"],
      },
      handler: async (args: { track_index: number; visible: boolean }) => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");
          
          if (${args.track_index} >= seq.videoTracks.numTracks) return __error("Track index out of range");
          
          var track = seq.videoTracks[${args.track_index}];
          track.setMute(${args.visible ? 0 : 1});
          
          return __result({ trackIndex: ${args.track_index}, visible: ${args.visible}, trackName: track.name });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },
  };
}
