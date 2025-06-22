import { SyncUtils } from "./sync-utils";

import {
    getRepoSnapshots,
    createSnapshot,
    getFileBlob,
    getMissingAssets,
    lsNotebooks,
    readDir,
    reloadFiletree
} from "@/api";
import BetterSyncPlugin from "..";
import { showMessage } from "siyuan";
import { ConflictHandler } from "@/sync";

export class SyncManager {
    private plugin: BetterSyncPlugin;
    private remotes: [RemoteInfo, RemoteInfo] = [
        { url: "", key: "SKIP", lastSyncTime: undefined },
        { url: "", key: "", lastSyncTime: undefined }
    ];
    private originalFetch: typeof window.fetch;
    private conflictDetected: boolean = false;

    private getUrl(): string {
        return this.plugin.settingsManager.getPref("siyuanUrl");
    }

    private getKey(): string {
        return this.plugin.settingsManager.getPref("siyuanAPIKey");
    }

    private getNickname(): string {
        return this.plugin.settingsManager.getPref("siyuanNickname");
    }

    private async acquireLock(url: string, key: string): Promise<void> {
        const lockPath = "/data/.siyuan/sync/lock";
        const lockFile = await getFileBlob(lockPath, url, SyncUtils.getHeaders(key));
        if (lockFile)
            throw new Error("Another sync is already in progress. If this is an error, please remove the lock file `/data/.siyuan/sync/lock`.");

        const file = new File([], "lock", { type: "text/plain" });
        await SyncUtils.putFile(lockPath, file, url, key);
    }

    private async acquireAllLocks(remotes: [RemoteInfo, RemoteInfo] = this.remotes): Promise<void> {
        SyncUtils.checkRemotes(remotes);

        await Promise.all(remotes.map(remote => this.acquireLock(remote.url, remote.key)));

        console.log("Acquired sync locks.");
    }

    private async releaseLock(url: string, key: string): Promise<void> {
        const lockPath = "/data/.siyuan/sync/lock";
        try {
            const lockFileRes: IResReadDir = {
                name: "lock",
                isDir: false,
                updated: Date.now(),
                isSymlink: false
            }
            await SyncUtils.deleteFile(lockPath, lockFileRes, url, key);
        } catch (error) {
            console.error("Failed to release sync lock:", error);
            showMessage("Failed to release sync lock, please remove it manually.", 6000, "error");
        }
    }

    private async releaseAllLocks(remotes: [RemoteInfo, RemoteInfo] = this.remotes): Promise<void> {
        SyncUtils.checkRemotes(remotes);

        await Promise.all(remotes.map(remote => this.releaseLock(remote.url, remote.key)));
    }

    updateUrlKey() {
        let url = this.getUrl()
        let key = this.getKey()

        const lastSyncTimes = this.remotes.map(remote => remote.lastSyncTime);

        this.remotes = [
            {
                url: "",
                key: "SKIP",
                lastSyncTime: lastSyncTimes[0] || undefined
            },
            {
                url: url || "",
                key: key || "",
                lastSyncTime: lastSyncTimes[1] || undefined
            }
        ];
    }

    constructor(plugin: BetterSyncPlugin) {
        this.plugin = plugin;
        this.updateUrlKey();

        this.originalFetch = window.fetch.bind(window);
        window.fetch = this.customFetch.bind(this);
    }

    async customFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

        if (url.includes("/api/system/exit")) {
            // Sync before closing if enabled
            if (this.plugin.settingsManager.getPref("syncOnClose")) {
                showMessage(this.plugin.i18n.syncingBeforeClosing);
                await this.syncHandler();
            }
        }

        return this.originalFetch(input, init)
    }

    private async getNotebooks(url: string = "", key: string = null): Promise<Notebook[]> {
        let notebooks = await lsNotebooks(url, SyncUtils.getHeaders(key))

        return notebooks.notebooks;
    }

    async syncHandler(remotes: [RemoteInfo, RemoteInfo] = this.remotes) {
        const startTime = Date.now();
        let locked = false;
        try {
            SyncUtils.checkRemotes(remotes);

            await this.acquireAllLocks(remotes);
            locked = true;

            await this.syncWithRemote(remotes, startTime);
        } catch (error) {
            console.error("Error during sync:", error);
            const nickname = this.getNickname();
            const remoteName = nickname || remotes[1].url;
            const duration = ((Date.now() - startTime) / 1000).toFixed(1);
            showMessage(
                this.plugin.i18n.syncWithRemoteFailed.replace("{{remoteName}}", remoteName).replace("{{error}}", error.message).replace("{{duration}}", duration),
                6000,
                "error"
            );
        } finally {
            if (locked) {
                await this.releaseAllLocks(remotes);
                console.log("Released all sync locks.");
            }
        }
    }

    /**
     * Create a data snapshot for both local and remote devices.
     */
    private async createDataSnapshots(remotes: [RemoteInfo, RemoteInfo] = this.remotes) {
        SyncUtils.checkRemotes(remotes);

        console.log("Creating data snapshots for both local and remote devices...");

        const now = Date.now();
        const minHours = this.plugin.settingsManager.getPref("minHoursBetweenSnapshots");
        const minMilliseconds = minHours * 3600 * 1000;

        const localSnapshots = await getRepoSnapshots(1, remotes[0].url, SyncUtils.getHeaders(remotes[0].key));
        const remoteSnapshots = await getRepoSnapshots(1, remotes[1].url, SyncUtils.getHeaders(remotes[1].key));

        if (!localSnapshots) {
            showMessage(this.plugin.i18n.initializeDataRepo.replace(/{{remoteName}}/g, "local"), 6000);
            console.warn("Local data repo is not initialized");
        } else {
            if (localSnapshots.snapshots.length > 0) {
                if (now - localSnapshots.snapshots[0].created < minMilliseconds)
                    console.log(`Skipping local snapshot, last one was less than ${minHours} hours ago.`);
                else
                    await createSnapshot("[better-sync] Cloud sync", remotes[0].url, SyncUtils.getHeaders(remotes[0].key));
            } else {
                await createSnapshot("[better-sync] Cloud sync", remotes[0].url, SyncUtils.getHeaders(remotes[0].key));
            }
        }

        if (!remoteSnapshots) {
            showMessage(this.plugin.i18n.initializeDataRepo.replace(/{{remoteName}}/g, "remote"), 6000);
            console.warn("Remote data repo is not initialized");
        } else {
            if (remoteSnapshots.snapshots.length > 0) {
                if (now - remoteSnapshots.snapshots[0].created < minMilliseconds)
                    console.log(`Skipping remote snapshot, last one was less than ${minHours} hours ago.`);
                else
                    await createSnapshot("[better-sync] Cloud sync", remotes[1].url, SyncUtils.getHeaders(remotes[1].key));
            } else {
                await createSnapshot("[better-sync] Cloud sync", remotes[1].url, SyncUtils.getHeaders(remotes[1].key));
            }
        }
    }

    private async syncWithRemote(remotes: [RemoteInfo, RemoteInfo] = this.remotes, startTime?: number) {
        SyncUtils.checkRemotes(remotes);

        const nickname = this.getNickname();
        const remoteName = nickname || remotes[1].url;

        showMessage(this.plugin.i18n.syncingWithRemote.replace("{{remoteName}}", remoteName), 2000);
        console.log(`Syncing with remote server ${remoteName}...`);

        // Create data snapshots if enabled
        if (this.plugin.settingsManager.getPref("createDataSnapshots")) {
            await this.createDataSnapshots(remotes);
        }

        // Update last sync times for both remotes
        await Promise.all([
            SyncUtils.getLastSyncTime(remotes[0].url, remotes[0].key).then(lastSyncTime => {
                remotes[0].lastSyncTime = lastSyncTime;
            }),
            SyncUtils.getLastSyncTime(remotes[1].url, remotes[1].key).then(lastSyncTime => {
                remotes[1].lastSyncTime = lastSyncTime;
            })
        ]);

        const [notebooksOne, notebooksTwo] = await Promise.all([
            this.getNotebooks(remotes[0].url, remotes[0].key),
            this.getNotebooks(remotes[1].url, remotes[1].key)
        ]);

        // Combine notebooks for easier processing (using a Map to automatically handle duplicates)
        const allNotebooks = new Map<string, Notebook>();

        // Add all local and remote notebooks to the map (using ID as the key to avoid duplicates)
        [...notebooksOne, ...notebooksTwo].forEach(notebook => {
            allNotebooks.set(notebook.id, notebook);
        });

        // Convert back to array for processing if needed
        const combinedNotebooks = Array.from(allNotebooks.values());

        const syncPromises = combinedNotebooks.map(notebook =>
            this.syncDirectory("data", notebook.id, remotes, [".siyuan"])
        );

        // Sync other directories
        let directoriesToSync: [string, string][] = [
            ["data", "plugins"],
            ["data", "templates"],
            ["data", "widgets"],
            ["data", "emojis"],
            ["data/storage", "av"],
        ];

        // Sync directories concurrently
        const syncDirPromises = directoriesToSync.map(([path, dir]) =>
            this.syncDirectory(path, dir, remotes)
        );

        // Sync some files only if missing
        const syncIfMissing: [string, string][] = [
            ["data/storage", "petal"],
            ["data", "snippets"],
        ];

        const syncIfMissingPromises = syncIfMissing.map(([path, dir]) =>
            this.syncDirectory(path, dir, remotes, [], {
                deleteFoldersOnly: false,
                onlyIfMissing: true,
                avoidDeletions: true
            })
        );

        const syncNotebookConfigPromises = combinedNotebooks.map(notebook =>
            this.syncNotebookConfig(notebook.id, remotes)
        );

        const promises = [
            ...syncPromises,
            ...syncDirPromises,
            ...syncIfMissingPromises,
            ...syncNotebookConfigPromises,
            this.syncPetalsListIfEmpty(remotes),
        ];

        // Execute all sync operations concurrently
        console.log(`Starting sync operations for ${combinedNotebooks.length} notebooks and ${directoriesToSync.length} directories...`);

        await Promise.all(promises);

        // Handle missing assets
        await this.syncMissingAssets(remotes);

        reloadFiletree(remotes[0].url, SyncUtils.getHeaders(remotes[0].key));
        reloadFiletree(remotes[1].url, SyncUtils.getHeaders(remotes[1].key));

        SyncUtils.setSyncStatus(remotes);

        const duration = startTime ? ((Date.now() - startTime) / 1000).toFixed(1) : "0.0";

        if (this.conflictDetected) {
            showMessage(this.plugin.i18n.syncCompletedWithConflicts.replace("{{duration}}", duration), 2000);
            console.warn(`Sync completed with conflicts in ${duration} seconds.`);
        } else {
            showMessage(this.plugin.i18n.syncCompletedSuccessfully.replace("{{duration}}", duration), 2000);
            console.log(`Sync completed successfully in ${duration} seconds!`);
        }

        this.conflictDetected = false; // Reset conflict detection flag after sync
    }

    private async syncFile(
        filePath: string,
        dirName: string,
        isNotebook: boolean,
        options: {
            deleteFoldersOnly: boolean,
            onlyIfMissing: boolean,
            avoidDeletions: boolean
        },
        remotes: [RemoteFileInfo, RemoteFileInfo] = this.remotes,
    ) {
        const parentPath = filePath.replace(/\/[^/]+$/, "");
        const fileName = filePath.replace(/^.*\//, "");

        await Promise.all(remotes.map(async (remote) => {
            if (!remote.file) {
                const dir = await readDir(parentPath, remote.url, SyncUtils.getHeaders(remote.key));
                remote.file = dir?.find(it => it.name === fileName);
            }
        }));

        const fileRes = remotes[0].file || remotes[1].file;

        const updated: [number, number] = [
            remotes[0].file?.updated || 0,
            remotes[1].file?.updated || 0
        ];

        // Conflict detection
        const trackConflicts = this.plugin.settingsManager.getPref("trackConflicts");
        if (!options.onlyIfMissing && isNotebook && !fileRes.isDir && trackConflicts) {
            const conflictDetected = await ConflictHandler.handleConflictDetection(
                filePath,
                dirName,
                remotes,
                this.plugin.i18n
            );

            if (conflictDetected) this.conflictDetected = true;
        }

        // Multiply by 1000 because `putFile` makes the conversion automatically
        const timestamp: number = Math.max(updated[0], updated[1]) * 1000;

        const lastSyncTime = Math.min(remotes[0].lastSyncTime, remotes[1].lastSyncTime);

        if (remotes[0].file && remotes[1].file && (updated[0] === updated[1] || options.onlyIfMissing)) return;

        // Remove deleted files
        if ((!remotes[0].file && lastSyncTime > updated[1]) || (!remotes[1].file && lastSyncTime > updated[0])) {
            if ((fileRes.isDir || !options.deleteFoldersOnly) && !options.avoidDeletions) {
                const targetIndex = !remotes[0].file ? 1 : 0;
                SyncUtils.deleteFile(filePath, fileRes, remotes[targetIndex].url, remotes[targetIndex].key);
                return;
            }
        }

        // Avoid writing directories
        if (fileRes.isDir) return;

        const iIn = updated[0] > updated[1] ? 0 : 1;
        const iOut = updated[0] > updated[1] ? 1 : 0;
        const sourceName = iIn === 0 ? 'local' : 'remote';
        const targetName = iOut === 0 ? 'local' : 'remote';

        console.log(`Syncing file from ${sourceName} to ${targetName}: ${fileRes.name} (${filePath}), timestamps: ${updated[0]} vs ${updated[1]}`);

        const syFile = await getFileBlob(filePath, remotes[iIn].url, SyncUtils.getHeaders(remotes[iIn].key));
        if (!syFile) {
            console.log(`File ${filePath} not found in source: ${sourceName}`);
            return;
        }

        const file = new File([syFile], fileRes.name, { lastModified: timestamp });
        SyncUtils.putFile(filePath, file, remotes[iOut].url, remotes[iOut].key, timestamp);
    }

    private async syncDirectory(
        path: string,
        dirName: string,
        remotes: [RemoteInfo, RemoteInfo],
        excludedSubdirs: string[] = [],
        options: {
            deleteFoldersOnly: boolean,
            onlyIfMissing: boolean,
            avoidDeletions: boolean
        } = {
            deleteFoldersOnly: false,
            onlyIfMissing: false,
            avoidDeletions: false
        }
    ) {
        const [notebooksOne, notebooksTwo] = await Promise.all([
            this.getNotebooks(remotes[0].url, remotes[0].key),
            this.getNotebooks(remotes[1].url, remotes[1].key)
        ]);

        const allNotebookIds = new Set([...notebooksOne.map(n => n.id), ...notebooksTwo.map(n => n.id)]);
        const isNotebook = allNotebookIds.has(dirName);

        console.log(`Syncing directory ${path}/${dirName}. Is notebook: ${isNotebook}`);

        const [filesOne, filesTwo] = await Promise.all([
            SyncUtils.getDirFilesRecursively(path, dirName, remotes[0].url, remotes[0].key, true, excludedSubdirs),
            SyncUtils.getDirFilesRecursively(path, dirName, remotes[1].url, remotes[1].key, true, excludedSubdirs)
        ]);

        // Create a combined map of all files
        const allFiles = new Map<string, IResReadDir>();

        [...filesOne, ...filesTwo].forEach(pair => {
            allFiles.set(pair[0], pair[1]);
        });

        // Synchronize files
        for (const [filePath] of allFiles.entries()) {
            const remoteFileInfos: [RemoteFileInfo, RemoteFileInfo] = [
                {
                    ...remotes[0],
                    file: filesOne.get(filePath)
                },
                {
                    ...remotes[1],
                    file: filesTwo.get(filePath)
                }
            ];

            await this.syncFile(
                filePath,
                dirName,
                isNotebook,
                options,
                remoteFileInfos
            );
        }
    }

    private async syncFileIfMissing(path: string, remotes: [RemoteInfo, RemoteInfo] = this.remotes) {
        SyncUtils.checkRemotes(remotes);

        let fileOne = await getFileBlob(path, remotes[0].url, SyncUtils.getHeaders(remotes[0].key));
        let fileTwo = await getFileBlob(path, remotes[1].url, SyncUtils.getHeaders(remotes[1].key));

        if (!fileOne) {
            console.log(`Syncing file ${path} from remote to local`);
            let file = new File([fileTwo], path.split("/").pop());
            SyncUtils.putFile(path, file, remotes[0].url, remotes[0].key);
        } else if (!fileTwo) {
            console.log(`Syncing file ${path} from local to remote`);
            let file = new File([fileOne], path.split("/").pop());
            SyncUtils.putFile(path, file, remotes[1].url, remotes[1].key);
        }
    }

    private async syncMissingAssets(remotes: [RemoteInfo, RemoteInfo] = this.remotes) {
        SyncUtils.checkRemotes(remotes);

        console.log(`Syncing missing assets`);

        const [localMissing, remoteMissing] = await Promise.all([
            getMissingAssets(remotes[0].url, SyncUtils.getHeaders(remotes[0].key)),
            getMissingAssets(remotes[1].url, SyncUtils.getHeaders(remotes[1].key))
        ]);

        const allMissingAssets = [...localMissing.missingAssets, ...remoteMissing.missingAssets];

        const assetsPromises = allMissingAssets.map(asset =>
            this.syncFileIfMissing(`/data/${asset}`, remotes)
        );

        await Promise.all(assetsPromises);
    }

    private async syncPetalsListIfEmpty(remotes: [RemoteInfo, RemoteInfo] = this.remotes) {
        SyncUtils.checkRemotes(remotes);

        const [petalsListOne, petalsListTwo] = await Promise.all([
            getFileBlob("/data/storage/petal/petals.json", remotes[0].url, SyncUtils.getHeaders(remotes[0].key)),
            getFileBlob("/data/storage/petal/petals.json", remotes[1].url, SyncUtils.getHeaders(remotes[1].key))
        ]);

        if (!petalsListOne || await petalsListOne.text() === "[]") {
            console.log(`Syncing petals list from remote to local`);
            let file = new File([petalsListTwo], "petals.json");
            SyncUtils.putFile("/data/storage/petal/petals.json", file, remotes[0].url, remotes[0].key);
        } else if (!petalsListTwo || await petalsListTwo.text() === "[]") {
            console.log(`Syncing petals list from local to remote`);
            let file = new File([petalsListOne], "petals.json");
            SyncUtils.putFile("/data/storage/petal/petals.json", file, remotes[1].url, remotes[1].key);
        }
    }

    async pushFile(path: string, remotes: [RemoteInfo, RemoteInfo] = this.remotes) {
        SyncUtils.checkRemotes(remotes);
        let fileOne = await getFileBlob(path, remotes[0].url, SyncUtils.getHeaders(remotes[0].key));

        if (fileOne) {
            console.log(`Pushing file ${path} from local to remote`);
            let file = new File([fileOne], path.split("/").pop());
            SyncUtils.putFile(path, file, remotes[1].url, remotes[1].key);
        } else {
            console.log(`File ${path} not found in local`);
        }
    }

    async syncNotebookConfig(notebookId: string, remotes: [RemoteInfo, RemoteInfo] = this.remotes) {
        SyncUtils.checkRemotes(remotes);

        const files: string[] = [
            "conf.json",
            "sort.json",
        ];

        const dirs = await Promise.all([
            readDir(`/data/${notebookId}/.siyuan/`, remotes[0].url, SyncUtils.getHeaders(remotes[0].key)),
            readDir(`/data/${notebookId}/.siyuan/`, remotes[1].url, SyncUtils.getHeaders(remotes[1].key))
        ]);

        for (const file of files) {
            const path = `/data/${notebookId}/.siyuan/${file}`;

            const fileInfos = [
                dirs[0]?.find(it => it.name === file),
                dirs[1]?.find(it => it.name === file)
            ];

            if (!fileInfos[0] && !fileInfos[1]) {
                console.log(`File ${path} not found in either location.`);
                continue;
            }

            const timestamps = fileInfos.map(f => f?.updated || 0);

            if (timestamps[0] === timestamps[1]) {
                console.log(`File ${path} is up to date in both locations.`);
                continue;
            }

            const iIn = timestamps[0] > timestamps[1] ? 0 : 1;
            const iOut = 1 - iIn;
            const sourceName = iIn === 0 ? 'local' : 'remote';
            const targetName = iOut === 0 ? 'local' : 'remote';

            const fileBlob = await getFileBlob(path, remotes[iIn].url, SyncUtils.getHeaders(remotes[iIn].key));
            if (fileBlob) {
                console.log(`Pushing notebook config ${path} from ${sourceName} to ${targetName}`);
                const fileObj = new File([fileBlob], file, { lastModified: timestamps[iIn] * 1000 });
                SyncUtils.putFile(path, fileObj, remotes[iOut].url, remotes[iOut].key, timestamps[iIn] * 1000);
            }
        }
    }
}
