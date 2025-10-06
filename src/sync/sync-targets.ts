export interface SyncTarget {
    path: string;
    excludedItems?: string[];
    options?: {
        deleteFoldersOnly?: boolean;
        onlyIfMissing?: boolean;
        avoidDeletions?: boolean;
        trackConflicts?: boolean;
        trackUpdatedFiles?: boolean;
    };
}

export interface SyncTargetsConfig {
    notebooks: Notebook[];
    trackConflicts: boolean;
}

export function getSyncTargets(config: SyncTargetsConfig): SyncTarget[] {
    const { notebooks, trackConflicts } = config;

    return [
        // Notebook directories
        ...notebooks.map(notebook => ({
            path: `data/${notebook.id}`,
            excludedItems: [".siyuan"],
            options: {
                trackConflicts: trackConflicts,
                trackUpdatedFiles: true
            }
        })),

        // Notebook configs
        ...notebooks.map(notebook => ({
            path: `data/${notebook.id}/.siyuan`,
        })),

        // Regular directories with folder-only deletions
        { path: "data/plugins", options: { deleteFoldersOnly: true } },
        { path: "data/templates", options: { deleteFoldersOnly: true } },
        { path: "data/widgets", options: { deleteFoldersOnly: true } },
        { path: "data/emojis", options: { deleteFoldersOnly: true } },

        // Storage/av directory with file tracking
        { path: "data/storage/av", options: { trackUpdatedFiles: true } },

        // Directories without deletions
        {
            path: "conf/appearance/themes",
            excludedItems: ["daylight", "midnight"],
            options: { avoidDeletions: true }
        },
        {
            path: "conf/appearance/icons",
            excludedItems: ["ant", "material", "index.html"],
            options: { avoidDeletions: true }
        },

        // Directories only if missing
        {
            path: "data/storage/petal",
            options: { onlyIfMissing: true, avoidDeletions: true }
        },
        {
            path: "data/snippets",
            options: { onlyIfMissing: true, avoidDeletions: true }
        },
    ];
}
