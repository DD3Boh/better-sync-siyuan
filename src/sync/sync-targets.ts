export interface SyncTarget {
    path: string;
    dirName: string;
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
            path: "data",
            dirName: notebook.id,
            excludedItems: [".siyuan"],
            options: {
                trackConflicts: trackConflicts,
                trackUpdatedFiles: true
            }
        })),

        // Notebook configs
        ...notebooks.map(notebook => ({
            path: `data/${notebook.id}`,
            dirName: ".siyuan"
        })),

        // Regular directories with folder-only deletions
        { path: "data", dirName: "plugins", options: { deleteFoldersOnly: true } },
        { path: "data", dirName: "templates", options: { deleteFoldersOnly: true } },
        { path: "data", dirName: "widgets", options: { deleteFoldersOnly: true } },
        { path: "data", dirName: "emojis", options: { deleteFoldersOnly: true } },

        // Storage/av directory with file tracking
        { path: "data/storage", dirName: "av", options: { trackUpdatedFiles: true } },

        // Directories without deletions
        {
            path: "conf/appearance",
            dirName: "themes",
            excludedItems: ["daylight", "midnight"],
            options: { avoidDeletions: true }
        },
        {
            path: "conf/appearance",
            dirName: "icons",
            excludedItems: ["ant", "material", "index.html"],
            options: { avoidDeletions: true }
        },

        // Directories only if missing
        {
            path: "data/storage",
            dirName: "petal",
            options: { onlyIfMissing: true, avoidDeletions: true }
        },
        {
            path: "data",
            dirName: "snippets",
            options: { onlyIfMissing: true, avoidDeletions: true }
        },
    ];
}
