import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";
import { existsSync } from "node:fs";

export function getProjectTools(bridgeOptions: BridgeOptions) {
  return {
    save_project: {
      description: "Save the current Premiere Pro project",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          var project = app.project;
          if (!project) return __error("No project is open");
          project.save();
          return __result({ saved: true, name: project.name, path: project.path });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    save_project_as: {
      description: "Save the current project to a new location",
      parameters: {
        type: "object" as const,
        properties: {
          path: {
            type: "string",
            description: "Full file path to save the project to (e.g., '/Users/me/projects/MyProject.prproj')",
          },
        },
        required: ["path"],
      },
      handler: async (args: { path: string }) => {
        const script = buildToolScript(`
          var project = app.project;
          if (!project) return __error("No project is open");
          project.saveAs("${escapeForExtendScript(args.path)}");
          return __result({ saved: true, path: "${escapeForExtendScript(args.path)}" });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    open_project: {
      description: "Open a Premiere Pro project file",
      parameters: {
        type: "object" as const,
        properties: {
          path: {
            type: "string",
            description: "Full file path to the .prproj file",
          },
        },
        required: ["path"],
      },
      handler: async (args: { path: string }) => {
        const script = buildToolScript(`
          app.openDocument("${escapeForExtendScript(args.path)}");
          var project = app.project;
          return __result({ opened: true, name: project.name, path: project.path });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_active_sequence: {
      description: "Set the active sequence by name or ID",
      parameters: {
        type: "object" as const,
        properties: {
          sequence_id: {
            type: "string",
            description: "Sequence name or ID to make active",
          },
        },
        required: ["sequence_id"],
      },
      handler: async (args: { sequence_id: string }) => {
        const script = buildToolScript(`
          var seq = __findSequence("${escapeForExtendScript(args.sequence_id)}");
          if (!seq) return __error("Sequence not found: ${escapeForExtendScript(args.sequence_id)}");
          app.project.activeSequence = seq;
          return __result({ active: true, name: seq.name, id: seq.sequenceID });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    undo: {
      description: "Undo the last action in Premiere Pro",
      parameters: {
        type: "object" as const,
        properties: {
          count: {
            type: "number",
            description: "Number of times to undo (default: 1)",
          },
        },
      },
      handler: async (args: { count?: number }) => {
        const count = args.count || 1;
        const script = buildToolScript(`
          // 25.4 (Bug #54): app.project.undo removed. Try executeCommand by menu ID.
          // Premiere "Undo" menu command ID is 14 on macOS, 16 on Windows in some builds —
          // use findMenuCommandId if available (also commonly removed). Fall back gracefully.
          var undone = 0;
          var note = null;
          if (typeof app.project.undo === "function") {
            for (var i = 0; i < ${count}; i++) {
              try { app.project.undo(); undone++; } catch(e) { break; }
            }
            return __result({ undone: undone });
          }
          if (typeof app.executeCommand === "function" && typeof app.findMenuCommandId === "function") {
            try {
              var cmdId = app.findMenuCommandId("Undo");
              if (cmdId) {
                for (var j = 0; j < ${count}; j++) {
                  try { app.executeCommand(cmdId); undone++; } catch(e) { break; }
                }
                return __result({ undone: undone, method: "executeCommand" });
              }
            } catch(e2) {}
          }
          return __result({
            undone: 0,
            available: false,
            note: "undo API removed in 25.4 — app.project.undo and app.executeCommand both undefined. Workaround: press Cmd/Ctrl+Z in the Premiere UI."
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    consolidate_duplicates: {
      description: "Consolidate duplicate project items",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          app.project.consolidateDuplicates();
          return __result({ consolidated: true });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    create_project: {
      description: "Create a new Premiere Pro project at the specified path",
      parameters: {
        type: "object" as const,
        properties: {
          path: {
            type: "string",
            description: "Full file path for the new .prproj file",
          },
        },
        required: ["path"],
      },
      handler: async (args: { path: string }) => {
        const script = buildToolScript(`
          app.newProject("${escapeForExtendScript(args.path)}");
          var project = app.project;
          if (!project) return __error("Failed to create project");
          return __result({ created: true, name: project.name, path: project.path });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    close_project: {
      description: "Close the current Premiere Pro project",
      parameters: {
        type: "object" as const,
        properties: {
          save_first: {
            type: "boolean",
            description: "Whether to save before closing (default: true)",
          },
        },
      },
      handler: async (args: { save_first?: boolean }) => {
        const save = args.save_first !== false;
        const script = buildToolScript(`
          var project = app.project;
          if (!project) return __error("No project is open");
          var name = project.name;
          // Suppress "Save before closing?" dialog (Bug #70). When save_first=false we
          // explicitly tell closeDocument to discard; the dialog suppression also covers
          // any "Are you sure?" follow-up prompt 25.4 may bring up.
          return __withDialogsSuppressed(function() {
            project.closeDocument(${save ? "1" : "0"}, ${save ? "0" : "0"});
            return __result({ closed: true, name: name, saved: ${save} });
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    import_ae_comps: {
      description: "Import After Effects compositions from an .aep file",
      parameters: {
        type: "object" as const,
        properties: {
          ae_project_path: {
            type: "string",
            description: "Full path to the .aep file",
          },
          comp_names: {
            type: "array",
            description: "Array of composition names to import. If omitted, imports all comps.",
          },
          target_bin: {
            type: "string",
            description: "Target bin name or node ID (optional)",
          },
        },
        required: ["ae_project_path"],
      },
      handler: async (args: { ae_project_path: string; comp_names?: string[]; target_bin?: string }) => {
        const binLookup = args.target_bin
          ? `var targetBin = __findProjectItem("${escapeForExtendScript(args.target_bin)}"); if (!targetBin) return __error("Bin not found");`
          : `var targetBin = app.project.rootItem;`;

        if (args.comp_names && args.comp_names.length > 0) {
          const comps = args.comp_names.map(c => `"${escapeForExtendScript(c)}"`).join(", ");
          const script = buildToolScript(`
            ${binLookup}
            app.project.importAEComps("${escapeForExtendScript(args.ae_project_path)}", [${comps}], targetBin);
            return __result({ imported: true, comps: [${comps}] });
          `);
          return sendCommand(script, bridgeOptions);
        } else {
          const script = buildToolScript(`
            ${binLookup}
            app.project.importAllAEComps("${escapeForExtendScript(args.ae_project_path)}", targetBin);
            return __result({ imported: true, allComps: true });
          `);
          return sendCommand(script, bridgeOptions);
        }
      },
    },

    delete_bin: {
      description: "Delete a bin (folder) from the project panel",
      parameters: {
        type: "object" as const,
        properties: {
          bin_id: {
            type: "string",
            description: "Name or node ID of the bin to delete",
          },
        },
        required: ["bin_id"],
      },
      handler: async (args: { bin_id: string }) => {
        const script = buildToolScript(`
          var bin = __findProjectItem("${escapeForExtendScript(args.bin_id)}");
          if (!bin) return __error("Bin not found: ${escapeForExtendScript(args.bin_id)}");
          if (bin.type !== 2) return __error("Item is not a bin");
          var name = bin.name;
          bin.deleteBin();
          return __result({ deleted: true, name: name });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    rename_bin: {
      description: "Rename a bin (folder) in the project panel",
      parameters: {
        type: "object" as const,
        properties: {
          bin_id: {
            type: "string",
            description: "Name or node ID of the bin to rename",
          },
          new_name: {
            type: "string",
            description: "New name for the bin",
          },
        },
        required: ["bin_id", "new_name"],
      },
      handler: async (args: { bin_id: string; new_name: string }) => {
        const script = buildToolScript(`
          var bin = __findProjectItem("${escapeForExtendScript(args.bin_id)}");
          if (!bin) return __error("Bin not found: ${escapeForExtendScript(args.bin_id)}");
          if (bin.type !== 2) return __error("Item is not a bin");
          var oldName = bin.name;
          bin.renameBin("${escapeForExtendScript(args.new_name)}");
          return __result({ renamed: true, oldName: oldName, newName: "${escapeForExtendScript(args.new_name)}" });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    create_smart_bin: {
      description: "Create a smart bin (search bin) in the project panel",
      parameters: {
        type: "object" as const,
        properties: {
          name: {
            type: "string",
            description: "Name for the smart bin",
          },
          query: {
            type: "string",
            description: "Search query for the smart bin",
          },
        },
        required: ["name", "query"],
      },
      handler: async (args: { name: string; query: string }) => {
        const script = buildToolScript(`
          app.project.rootItem.createSmartBin("${escapeForExtendScript(args.name)}", "${escapeForExtendScript(args.query)}");
          return __result({ created: true, name: "${escapeForExtendScript(args.name)}", query: "${escapeForExtendScript(args.query)}" });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    find_items_by_media_path: {
      description: "Find project items whose media path contains the given search string",
      parameters: {
        type: "object" as const,
        properties: {
          path_search: {
            type: "string",
            description: "Partial file path to search for",
          },
        },
        required: ["path_search"],
      },
      handler: async (args: { path_search: string }) => {
        const script = buildToolScript(`
          var root = app.project.rootItem;
          var matches = root.findItemsMatchingMediaPath("${escapeForExtendScript(args.path_search)}");
          var items = [];
          if (matches) {
            for (var i = 0; i < matches.length; i++) {
              items.push({
                nodeId: matches[i].nodeId,
                name: matches[i].name,
                type: __projectItemType(matches[i])
              });
            }
          }
          return __result({ count: items.length, items: items });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    start_batch_encode: {
      description: "Start encoding all items in the Adobe Media Encoder render queue",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          app.encoder.startBatch();
          return __result({ started: true });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    add_custom_metadata_field: {
      description: "Add a custom metadata field to the project's metadata schema",
      parameters: {
        type: "object" as const,
        properties: {
          field_name: {
            type: "string",
            description: "Internal name for the metadata field",
          },
          field_label: {
            type: "string",
            description: "Display label for the field",
          },
          field_type: {
            type: "number",
            description: "Type of the field: 0 = Integer, 1 = Real, 2 = String, 3 = Boolean",
          },
        },
        required: ["field_name", "field_label", "field_type"],
      },
      handler: async (args: { field_name: string; field_label: string; field_type: number }) => {
        const script = buildToolScript(`
          app.project.addPropertyToProjectMetadataSchema("${escapeForExtendScript(args.field_name)}", "${escapeForExtendScript(args.field_label)}", ${args.field_type});
          return __result({ added: true, name: "${escapeForExtendScript(args.field_name)}", label: "${escapeForExtendScript(args.field_label)}" });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },
    import_sequences: {
      description: "Import sequences from another Premiere Pro project file",
      parameters: {
        type: "object" as const,
        properties: {
          project_path: {
            type: "string",
            description: "Full path to the source .prproj file",
          },
          sequence_ids: {
            type: "array",
            description: "Array of sequence IDs to import from the source project. If omitted, all sequences are imported.",
          },
        },
        required: ["project_path"],
      },
      handler: async (args: { project_path: string; sequence_ids?: string[] }) => {
        if (args.sequence_ids && args.sequence_ids.length > 0) {
          const ids = args.sequence_ids.map(id => `"${escapeForExtendScript(id)}"`).join(", ");
          const script = buildToolScript(`
            app.project.importSequences("${escapeForExtendScript(args.project_path)}", [${ids}]);
            return __result({ imported: true, sequenceIds: [${ids}] });
          `);
          return sendCommand(script, bridgeOptions);
        } else {
          const script = buildToolScript(`
            app.project.importSequences("${escapeForExtendScript(args.project_path)}");
            return __result({ imported: true, allSequences: true });
          `);
          return sendCommand(script, bridgeOptions);
        }
      },
    },

    create_bars_and_tone: {
      description: "Create a Bars and Tone synthetic media item in the project (useful for leader/calibration)",
      parameters: {
        type: "object" as const,
        properties: {
          width: {
            type: "number",
            description: "Frame width in pixels (default: 1920)",
          },
          height: {
            type: "number",
            description: "Frame height in pixels (default: 1080)",
          },
          timebase: {
            type: "string",
            description: "Timebase as ticks-per-second string (default uses sequence timebase)",
          },
          name: {
            type: "string",
            description: "Name for the bars and tone item (default: 'Bars and Tone')",
          },
        },
      },
      handler: async (args: { width?: number; height?: number; timebase?: string; name?: string }) => {
        const w = args.width ?? 1920;
        const h = args.height ?? 1080;
        const name = args.name ?? "Bars and Tone";
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          var timebase = ${args.timebase ? `"${escapeForExtendScript(args.timebase)}"` : `seq ? seq.timebase : "254016000000"`};
          app.project.newBarsAndTone(${w}, ${h}, timebase, "${escapeForExtendScript(name)}");
          return __result({ created: true, name: "${escapeForExtendScript(name)}", width: ${w}, height: ${h} });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    import_fcp_xml: {
      description:
        "Import a Final Cut Pro XML file into the current project. " +
        "Bug #60 fix: pre-validates the file path exists before invoking openFCPXML (previously threw a generic 'Not Enough Parameters' when path was wrong).",
      parameters: {
        type: "object" as const,
        properties: {
          path: {
            type: "string",
            description: "Full path to the FCP XML file (.xml / .fcpxml)",
          },
        },
        required: ["path"],
      },
      handler: async (args: { path: string }) => {
        const script = buildToolScript(`
          var f = new File("${escapeForExtendScript(args.path)}");
          if (!f.exists) return __error("FCP XML file not found at: ${escapeForExtendScript(args.path)}");

          var ok = false;
          try { ok = !!app.openFCPXML("${escapeForExtendScript(args.path)}"); }
          catch(e) { return __error("openFCPXML threw: " + e.toString()); }

          return __result({ imported: ok, path: "${escapeForExtendScript(args.path)}" });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_transcode_on_ingest: {
      description: "Enable or disable transcoding on ingest for the project",
      parameters: {
        type: "object" as const,
        properties: {
          enabled: {
            type: "boolean",
            description: "True to enable transcode on ingest, false to disable",
          },
        },
        required: ["enabled"],
      },
      handler: async (args: { enabled: boolean }) => {
        const script = buildToolScript(`
          app.project.setEnableTranscodeOnIngest(${args.enabled ? 1 : 0});
          return __result({ set: true, transcodeOnIngest: ${args.enabled} });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_insertion_bin: {
      description: "Get the current target bin for new imports (the bin that is currently focused in the Project panel)",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          var bin = app.project.getInsertionBin();
          if (!bin) return __error("No insertion bin found");
          return __result({ name: bin.name, nodeId: bin.nodeId, treePath: bin.treePath });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_project_panel_metadata: {
      description:
        "Get the current project panel metadata/column configuration as XML. " +
        "Bug #22 fix (v1.2.10): raw XML can be 130KB+ on large projects and overflow context. " +
        "Default mode `summary` returns size + a count of `<MetadataEntry>` rows + a 2KB head/tail preview. " +
        "Pass `format: 'raw'` to get the full XML (use only when you really need to set_project_panel_metadata back).",
      parameters: {
        type: "object" as const,
        properties: {
          format: {
            type: "string",
            enum: ["summary", "raw"],
            description: "'summary' (default): compact size + preview; 'raw': full XML.",
          },
        },
      },
      handler: async (args: { format?: string }) => {
        const fmt = args.format === "raw" ? "raw" : "summary";
        const script = buildToolScript(`
          var meta = app.project.getProjectPanelMetadata();
          if (!meta) return __error("Could not retrieve project panel metadata");

          var fmt = "${fmt}";
          if (fmt === "raw") {
            return __result({ metadata: meta, format: "raw", byteSize: meta.length });
          }

          // summary mode
          var entryCount = 0;
          try {
            var re = /<MetadataEntry/g;
            var match;
            while ((match = re.exec(meta)) !== null) entryCount++;
          } catch(eRE) {}

          var headLen = 1024;
          var tailLen = 1024;
          var head = meta.length > headLen ? meta.substring(0, headLen) : meta;
          var tail = meta.length > headLen + tailLen ? meta.substring(meta.length - tailLen) : "";

          return __result({
            format: "summary",
            byteSize: meta.length,
            metadataEntryCount: entryCount,
            headPreview: head,
            tailPreview: tail,
            _note: "Pass format='raw' to get full XML. Default summary avoids 130KB+ context overflow."
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_project_panel_metadata: {
      description: "Set the project panel metadata/column configuration from XML",
      parameters: {
        type: "object" as const,
        properties: {
          metadata_xml: {
            type: "string",
            description: "XML string containing the project panel metadata configuration",
          },
        },
        required: ["metadata_xml"],
      },
      handler: async (args: { metadata_xml: string }) => {
        const script = buildToolScript(`
          app.project.setProjectPanelMetadata("${escapeForExtendScript(args.metadata_xml)}");
          return __result({ set: true });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_graphics_white_luminance: {
      description: "Get the graphics white luminance value (HDR setting) for the project",
      parameters: {},
      handler: async () => {
        const script = buildToolScript(`
          var val = app.project.getGraphicsWhiteLuminance();
          return __result({ graphicsWhiteLuminance: val });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_graphics_white_luminance: {
      description: "Set the graphics white luminance value (HDR setting) for the project",
      parameters: {
        type: "object" as const,
        properties: {
          luminance: {
            type: "number",
            description: "White luminance value in nits",
          },
        },
        required: ["luminance"],
      },
      handler: async (args: { luminance: number }) => {
        const script = buildToolScript(`
          app.project.setGraphicsWhiteLuminance(${args.luminance});
          return __result({ set: true, graphicsWhiteLuminance: ${args.luminance} });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_scratch_disk_path: {
      description: "Set the scratch disk path for a specific media type",
      parameters: {
        type: "object" as const,
        properties: {
          scratch_disk_type: {
            type: "string",
            description: "Type: 'capturedVideo', 'capturedAudio', 'videoPreview', 'audioPreview', 'autoSave', 'ccLibraries'",
          },
          path: {
            type: "string",
            description: "Full directory path for the scratch disk",
          },
        },
        required: ["scratch_disk_type", "path"],
      },
      handler: async (args: { scratch_disk_type: string; path: string }) => {
        const script = buildToolScript(`
          app.setScratchDiskPath("${escapeForExtendScript(args.path)}", "${escapeForExtendScript(args.scratch_disk_type)}");
          return __result({ set: true, type: "${escapeForExtendScript(args.scratch_disk_type)}", path: "${escapeForExtendScript(args.path)}" });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    import_sequences_from_project: {
      description:
        "Import one or more sequences from another Premiere Pro project (.prproj) file into the current project.",
      parameters: {
        type: "object" as const,
        properties: {
          project_path: {
            type: "string",
            description: "Absolute path to the source .prproj file",
          },
          sequence_ids: {
            type: "array",
            description:
              "Array of sequence IDs (or names) to import from the source project. Pass empty array to import all sequences.",
          },
        },
        required: ["project_path"],
      },
      handler: async (args: { project_path: string; sequence_ids?: string[] }) => {
        if (typeof args.project_path === "string" && args.project_path.length > 0 && !existsSync(args.project_path)) {
          return {
            success: false,
            error: `import_sequences_from_project: project_path does not exist: ${args.project_path}`,
          };
        }
        const ids = JSON.stringify(args.sequence_ids ?? []);
        const script = buildToolScript(`
          var path = "${escapeForExtendScript(args.project_path)}";
          var ids = ${ids};
          var rootBefore = app.project.rootItem.children.numItems;
          try {
            var ok = app.project.importSequences
              ? app.project.importSequences(path, ids)
              : null;
            if (ok === null) {
              app.openDocument(path);
              return __result({ imported: false, note: "importSequences API not available; opened source project instead." });
            }
            var rootAfter = app.project.rootItem.children.numItems;
            if (rootAfter === rootBefore) {
              return __error({
                reason: "import_sequences_from_project: API returned without error but no new project items were added. " +
                        "Likely sequence_ids did not match any sequence in the source project, or the source file is empty/invalid. " +
                        "Pass an empty sequence_ids array to import all sequences.",
                _probe: {
                  projectPath: path,
                  sequenceIds: ids,
                  rootItemsBefore: rootBefore,
                  rootItemsAfter: rootAfter
                }
              });
            }
            return __result({
              imported: true,
              count: ids.length || "all",
              rootItemsBefore: rootBefore,
              rootItemsAfter: rootAfter,
              rootItemsAdded: rootAfter - rootBefore
            });
          } catch (ex) {
            return __error("Failed to import sequences: " + ex.toString());
          }
        `);
        return sendCommand(script, bridgeOptions);
      },
    },
  };
}
