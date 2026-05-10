import { buildToolScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";

export function getHealthTools(bridgeOptions: BridgeOptions) {
  return {
    ping: {
      description:
        "Health check — verify the CEP plugin is running and connected to Premiere Pro. Call this before other tools to confirm connectivity.",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          var version = app.version;
          var projectName = app.project && app.project.name ? app.project.name : "No project open";
          var activeSeq = app.project && app.project.activeSequence ? app.project.activeSequence.name : "None";
          return __result({
            connected: true,
            premiereVersion: version,
            projectName: projectName,
            activeSequence: activeSeq
          });
        `);
        return sendCommand(script, { ...bridgeOptions, timeoutMs: 5000 });
      },
    },

    run_diagnostics: {
      description:
        "Run a comprehensive diagnostic check: ExtendScript, project state, active sequence, QE DOM availability, and Premiere version.",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          var diag = {
            extendscript: true,
            projectOpen: !!app.project,
            activeSequence: false,
            qeDomAvailable: false,
            sequenceCount: 0,
            version: app.version || "unknown",
            os: $.os || "unknown",
            locale: $.locale || "unknown"
          };

          if (app.project) {
            diag.sequenceCount = app.project.sequences.numSequences;
            diag.activeSequence = !!app.project.activeSequence;
            if (diag.activeSequence) {
              diag.activeSequenceName = app.project.activeSequence.name;
            }
            diag.projectName = app.project.name;
            diag.projectPath = app.project.path;
          }

          try {
            app.enableQE();
            if (qe && qe.project) {
              diag.qeDomAvailable = true;
            }
          } catch (ex) {
            diag.qeDomAvailable = false;
            diag.qeError = ex.toString();
          }

          return __result(diag);
        `);
        return sendCommand(script, { ...bridgeOptions, timeoutMs: 10000 });
      },
    },

    flush_cache: {
      description:
        "Flush Premiere Pro's media cache. Useful after making cache-affecting changes externally or for troubleshooting playback issues.",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          try {
            if (app.flushCache) {
              app.flushCache();
              return __result({ flushed: true });
            }
            if (app.project && app.project.flushCache) {
              app.project.flushCache();
              return __result({ flushed: true, scope: "project" });
            }
            return __result({ flushed: false, note: "flushCache API not available in this Premiere Pro version" });
          } catch (ex) {
            return __error("Flush cache failed: " + ex.toString());
          }
        `);
        return sendCommand(script, bridgeOptions);
      },
    },
  };
}
