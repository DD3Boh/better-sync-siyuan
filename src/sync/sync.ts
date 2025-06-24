import { SyncUtils } from "./sync-utils";

import {
    getRepoSnapshots,
    createSnapshot,
    getFileBlob,
    lsNotebooks,
    readDir,
    reloadFiletree,
    getUnusedAssets
} from "@/api";
import BetterSyncPlugin from "..";
import { Protyle, showMessage } from "siyuan";
import { ConflictHandler } from "@/sync";

export class SyncManager {
    private plugin: BetterSyncPlugin;
    private remotes: [RemoteInfo, RemoteInfo] = [
        { url: "", key: "SKIP", name: "local", lastSyncTime: undefined },
        { url: "", key: "", name: "remote", lastSyncTime: undefined }
    ];
    private loadedProtyles: Map<string, Protyle> = new Map();
    private activeProtyle: Protyle | null = null;
    private locallyUpdatedFiles: Set<string> = new Set();
    private originalFetch: typeof window.fetch;
    private conflictDetected: boolean = false;

    /**
     * Create a deep copy of RemoteInfo or RemoteFileInfo objects to prevent mutations
     */
    private copyRemotes<T extends RemoteInfo>(remotes: [T, T]): [T, T] {
        return [
            { ...remotes[0] },
            { ...remotes[1] }
        ];
    }

    private getUrl(): string {
        return this.plugin.settingsManager.getPref("siyuanUrl");
    }

    private getKey(): string {
        return this.plugin.settingsManager.getPref("siyuanAPIKey");
    }

    private getNickname(): string {
        return this.plugin.settingsManager.getPref("siyuanNickname");
    }

    private dismissMainSyncNotification() {
        showMessage("", 1, "info", "mainSyncNotification");
    }

    insertProtyle(protyle: Protyle) {
        const path = `data/${protyle.protyle.notebookId}${protyle.protyle.path}`;

        this.loadedProtyles.set(path, protyle);
    }

    removeProtyle(protyle: Protyle) {
        this.loadedProtyles.delete(`data/${protyle.protyle.notebookId}${protyle.protyle.path}`);

        if (this.activeProtyle === protyle)
            this.activeProtyle = null;
    }

    setActiveProtyle(protyle: Protyle | null) {
        this.activeProtyle = protyle;
    }

    private async acquireLock(remote: RemoteInfo): Promise<void> {
        const lockPath = "/data/.siyuan/sync/lock";
        const lockFile = await getFileBlob(lockPath, remote.url, SyncUtils.getHeaders(remote.key));

        const now = Date.now();

        if (lockFile) {
            const lockDir = await readDir("/data/.siyuan/sync", remote.url, SyncUtils.getHeaders(remote.key));
            const lockFileInfo = lockDir?.find(file => file.name === "lock");

            if (lockFileInfo) {
                const lockAge = now - (lockFileInfo.updated * 1000);
                const fiveMinutesInMs = 5 * 60 * 1000;

                if (lockAge > fiveMinutesInMs) {
                    console.log(`Lock file is ${Math.round(lockAge / 1000)} seconds old, ignoring stale lock for ${remote.name}`);
                } else {
                    throw new Error(this.plugin.i18n.syncLockAlreadyExists.replace("{{remoteName}}", remote.name));
                }
            }
        }

        const file = new File([], "lock", { type: "text/plain", lastModified: now });
        await SyncUtils.putFile(lockPath, file, remote.url, remote.key, now );
    }

    private async acquireAllLocks(remotes: [RemoteInfo, RemoteInfo] = this.copyRemotes(this.remotes)): Promise<void> {
        SyncUtils.checkRemotes(remotes);

        // Acquire the remote lock first
        await this.acquireLock(remotes[1]);

        // Acquire the local lock
        await this.acquireLock(remotes[0]);

        console.log("Acquired sync locks.");
    }

    private async releaseLock(remote: RemoteInfo): Promise<void> {
        const lockPath = "/data/.siyuan/sync/lock";
        try {
            const lockFileRes: IResReadDir = {
                name: "lock",
                isDir: false,
                updated: Date.now(),
                isSymlink: false
            }
            await SyncUtils.deleteFile(lockPath, lockFileRes, remote.url, remote.key);
        } catch (error) {
            this.dismissMainSyncNotification();

            console.error("Failed to release sync lock:", error);
            showMessage("Failed to release sync lock, please remove it manually.", 6000, "error");
        }
    }

    private async releaseAllLocks(remotes: [RemoteInfo, RemoteInfo] = this.copyRemotes(this.remotes)): Promise<void> {
        SyncUtils.checkRemotes(remotes);

        await Promise.all(remotes.map(remote => this.releaseLock(remote)));
    }

    updateUrlKey() {
        let url = this.getUrl()
        let key = this.getKey()

        const lastSyncTimes = this.remotes.map(remote => remote.lastSyncTime);

        this.remotes = [
            {
                url: "",
                key: "SKIP",
                name: "local",
                lastSyncTime: lastSyncTimes[0] || undefined
            },
            {
                url: url || "",
                key: key || "",
                name: this.getNickname() || "remote",
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

    async syncHandler(remotes: [RemoteInfo, RemoteInfo] = this.copyRemotes(this.remotes)) {
        const startTime = Date.now();
        let locked = false;
        let savedError: Error | null = null;
        try {
            SyncUtils.checkRemotes(remotes);

            showMessage(this.plugin.i18n.syncingWithRemote.replace("{{remoteName}}", remotes[1].name), 0, "info", "mainSyncNotification");
            console.log(`Syncing with remote server ${remotes[1].name}...`);

            await this.acquireAllLocks(remotes);
            locked = true;

            await this.syncWithRemote(remotes);
        } catch (error) {
            savedError = error;
        } finally {
            if (locked) {
                await this.releaseAllLocks(remotes);
                console.log("Released all sync locks.");
            }

            const duration = startTime ? ((Date.now() - startTime) / 1000).toFixed(1) : "0.0";

            // Remove the main sync message
            this.dismissMainSyncNotification();

            if (savedError !== null) {
                console.error("Error during sync:", savedError);

                showMessage(
                    this.plugin.i18n.syncWithRemoteFailed.replace("{{remoteName}}", remotes[1].name).replace("{{error}}", savedError.message).replace("{{duration}}", duration),
                    6000,
                    "error"
                );
            } else if (this.conflictDetected) {
                showMessage(this.plugin.i18n.syncCompletedWithConflicts.replace("{{duration}}", duration), 6000);
                console.warn(`Sync completed with conflicts in ${duration} seconds.`);
            } else {
                showMessage(this.plugin.i18n.syncCompletedSuccessfully.replace("{{duration}}", duration), 6000);
                console.log(`Sync completed successfully in ${duration} seconds!`);
            }

            this.conflictDetected = false;
            this.locallyUpdatedFiles.clear();
        }
    }

    /**
     * Create a data snapshot for both local and remote devices.
     */
    private async createDataSnapshots(remotes: [RemoteInfo, RemoteInfo] = this.copyRemotes(this.remotes)) {
        SyncUtils.checkRemotes(remotes);

        console.log("Creating data snapshots for both local and remote devices...");

        const minHours = this.plugin.settingsManager.getPref("minHoursBetweenSnapshots");
        const minMilliseconds = minHours * 3600 * 1000;

        const snapshots = await Promise.all([
            getRepoSnapshots(1, remotes[0].url, SyncUtils.getHeaders(remotes[0].key)),
            getRepoSnapshots(1, remotes[1].url, SyncUtils.getHeaders(remotes[1].key))
        ]);

        const promises: Promise<void>[] = [];

        for (let i = 0; i < snapshots.length; i++) {
            if (!snapshots[i] || snapshots[i].snapshots.length <= 0) {
                showMessage(this.plugin.i18n.initializeDataRepo.replace(/{{remoteName}}/g, remotes[i].name), 6000);
                console.warn(`Failed to fetch snapshots for ${remotes[i].name}, skipping snapshot creation.`);
                return;
            }

            if (Date.now() - snapshots[i].snapshots[0].created > minMilliseconds)
                promises.push(createSnapshot("[better-sync] Cloud sync", remotes[i].url, SyncUtils.getHeaders(remotes[i].key)));
            else
                console.log(`Skipping snapshot for ${remotes[i].name}, last one was less than ${minHours} hours ago.`);
        }

        await Promise.all(promises);
    }

    private async syncWithRemote(remotes: [RemoteInfo, RemoteInfo] = this.copyRemotes(this.remotes)) {
        SyncUtils.checkRemotes(remotes);

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

        console.log(`Last sync times: ${remotes[0].lastSyncTime} (${remotes[0].name}), ${remotes[1].lastSyncTime} (${remotes[1].name})`);

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

        const trackConflicts = this.plugin.settingsManager.getPref("trackConflicts");

        const notebookSyncPromises = combinedNotebooks.map(notebook =>
            this.syncDirectory(
                "data",
                notebook.id,
                remotes,
                [".siyuan"],
                {
                    deleteFoldersOnly: false,
                    onlyIfMissing: false,
                    avoidDeletions: false,
                    trackConflicts: trackConflicts
                }
            )
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
            this.syncDirectory(path, dir, remotes, [], {
                deleteFoldersOnly: true,
                onlyIfMissing: false,
                avoidDeletions: false,
                trackConflicts: false
            })
        );

        // Sync without deletions
        const syncWithoutDeletions: [string, string, string[]][] = [
            ["conf/appearance", "themes", ["daylight", "midnight"]],
            ["conf/appearance", "icons", ["ant", "material", "index.html"]],
        ];

        const syncWithoutDeletionsPromises = syncWithoutDeletions.map(([path, dir, excludedItems]) =>
            this.syncDirectory(path, dir, remotes, excludedItems, {
                deleteFoldersOnly: false,
                onlyIfMissing: false,
                avoidDeletions: true,
                trackConflicts: false
            })
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
                avoidDeletions: true,
                trackConflicts: false
            })
        );

        const syncNotebookConfigPromises = combinedNotebooks.map(notebook =>
            this.syncNotebookConfig(notebook.id, remotes)
        );

        const promises = [
            ...notebookSyncPromises,
            ...syncDirPromises,
            ...syncIfMissingPromises,
            ...syncNotebookConfigPromises,
            ...syncWithoutDeletionsPromises,
            this.syncPetalsListIfEmpty(remotes),
        ];

        // Execute all sync operations concurrently
        console.log(`Starting sync operations for ${combinedNotebooks.length} notebooks and ${directoriesToSync.length} directories...`);

        await Promise.all(promises);

        // Handle missing assets
        await this.syncDirectory(
            "data",
            "assets",
            remotes,
            await this.getUnusedAssetsNames(remotes),
            {
                deleteFoldersOnly: false,
                onlyIfMissing: false,
                avoidDeletions: true,
                trackConflicts: false
            }
        );

        reloadFiletree(remotes[0].url, SyncUtils.getHeaders(remotes[0].key));
        reloadFiletree(remotes[1].url, SyncUtils.getHeaders(remotes[1].key));

        for (const [path, protyle] of this.loadedProtyles) {
            if (this.locallyUpdatedFiles.has(path)) {
                console.log(`Locally updated file ${path} is currently loaded in protyle ${protyle.protyle.id}`);

                protyle.reload(this.activeProtyle === protyle);
            }
        }

        SyncUtils.setSyncStatus(remotes);
    }

    async syncFile(
        filePath: string,
        dirName: string,
        options: {
            deleteFoldersOnly: boolean,
            onlyIfMissing: boolean,
            avoidDeletions: boolean,
            trackConflicts: boolean
        },
        remotes: [RemoteFileInfo, RemoteFileInfo] = this.remotes,
    ) {
        const copyRemotes = this.copyRemotes(remotes);
        const parentPath = filePath.replace(/\/[^/]+$/, "");
        const fileName = filePath.replace(/^.*\//, "");

        await Promise.all(copyRemotes.map(async (remote) => {
            if (!remote.file) {
                const dir = await readDir(parentPath, remote.url, SyncUtils.getHeaders(remote.key));
                remote.file = dir?.find(it => it.name === fileName);
            }
        }));

        const fileRes = copyRemotes[0].file || copyRemotes[1].file;

        if (!fileRes) {
            console.log(`File ${filePath} not found in either remote.`);
            return;
        }

        const updated: [number, number] = [
            copyRemotes[0].file?.updated || 0,
            copyRemotes[1].file?.updated || 0
        ];

        // Conflict detection
        if (!options.onlyIfMissing && !fileRes.isDir && options.trackConflicts) {
            const conflictDetected = await ConflictHandler.handleConflictDetection(
                filePath,
                dirName,
                copyRemotes,
                this.plugin.i18n
            );

            if (conflictDetected) this.conflictDetected = true;
        }

        // Multiply by 1000 because `putFile` makes the conversion automatically
        const timestamp: number = Math.max(updated[0], updated[1]) * 1000;

        const lastSyncTime = Math.min(copyRemotes[0].lastSyncTime, copyRemotes[1].lastSyncTime);

        if (copyRemotes[0].file && copyRemotes[1].file && (updated[0] === updated[1] || options.onlyIfMissing)) return;

        // Remove deleted files
        if ((!copyRemotes[0].file && lastSyncTime > updated[1]) || (!copyRemotes[1].file && lastSyncTime > updated[0])) {
            if ((fileRes.isDir || !options.deleteFoldersOnly) && !options.avoidDeletions) {
                const targetIndex = !copyRemotes[0].file ? 1 : 0;
                await SyncUtils.deleteFile(filePath, fileRes, copyRemotes[targetIndex].url, copyRemotes[targetIndex].key);
                return;
            }
        }

        // Avoid writing directories
        if (fileRes.isDir) return;

        const iIn = updated[0] > updated[1] ? 0 : 1;
        const iOut = updated[0] > updated[1] ? 1 : 0;

        console.log(`Syncing file from ${copyRemotes[iIn].name} to ${copyRemotes[iOut].name}: ${fileRes.name} (${filePath}), timestamps: ${updated[0]} vs ${updated[1]}`);

        const syFile = await getFileBlob(filePath, copyRemotes[iIn].url, SyncUtils.getHeaders(copyRemotes[iIn].key));
        if (!syFile) {
            console.log(`File ${filePath} not found in source: ${copyRemotes[iIn].name}`);
            return;
        }

        const file = new File([syFile], fileRes.name, { lastModified: timestamp });
        await SyncUtils.putFile(filePath, file, copyRemotes[iOut].url, copyRemotes[iOut].key, timestamp);

        if (iOut === 0) this.locallyUpdatedFiles.add(filePath);
    }

    private async syncDirectory(
        path: string,
        dirName: string,
        remotes: [RemoteInfo, RemoteInfo],
        excludedItems: string[] = [],
        options: {
            deleteFoldersOnly: boolean,
            onlyIfMissing: boolean,
            avoidDeletions: boolean,
            trackConflicts: boolean
        } = {
            deleteFoldersOnly: false,
            onlyIfMissing: false,
            avoidDeletions: false,
            trackConflicts: false
        }
    ) {
        console.log(`Syncing directory ${path}/${dirName}. Excluding items: ${excludedItems.join(", ")}`);

        const [filesOne, filesTwo] = await Promise.all([
            SyncUtils.getDirFilesRecursively(path, dirName, remotes[0].url, remotes[0].key, true, excludedItems),
            SyncUtils.getDirFilesRecursively(path, dirName, remotes[1].url, remotes[1].key, true, excludedItems)
        ]);

        // Create a combined map of all files
        const allFiles = new Map<string, IResReadDir>();

        [...filesOne, ...filesTwo].forEach(pair => {
            allFiles.set(pair[0], pair[1]);
        });

        const promises: Promise<void>[] = [];

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

            promises.push(this.syncFile(
                filePath,
                dirName,
                options,
                remoteFileInfos
            ));
        }

        await Promise.all(promises);
    }

    private async getUnusedAssetsNames(remotes: [RemoteInfo, RemoteInfo] = this.copyRemotes(this.remotes)): Promise<string[]> {
        SyncUtils.checkRemotes(remotes);

        const [unusedAssetsOne, unusedAssetsTwo] = await Promise.all([
            getUnusedAssets(remotes[0].url, SyncUtils.getHeaders(remotes[0].key)),
            getUnusedAssets(remotes[1].url, SyncUtils.getHeaders(remotes[1].key))
        ]);

        // Get the assets filenames by replacing anything before the last slash
        const unusedAssetsNames = [...unusedAssetsOne.unusedAssets, ...unusedAssetsTwo.unusedAssets].map(asset => {
            return asset.replace(/.*\//, "");
        });

        return unusedAssetsNames;
    }

    private async syncPetalsListIfEmpty(remotes: [RemoteInfo, RemoteInfo] = this.copyRemotes(this.remotes)) {
        SyncUtils.checkRemotes(remotes);

        const petalsList = await Promise.all([
            getFileBlob("/data/storage/petal/petals.json", remotes[0].url, SyncUtils.getHeaders(remotes[0].key)),
            getFileBlob("/data/storage/petal/petals.json", remotes[1].url, SyncUtils.getHeaders(remotes[1].key))
        ]);

        for (let index = 0; index < petalsList.length; index++) {
            if (!petalsList[index] || await petalsList[index].text() === "[]") {
                const otherIndex = index === 0 ? 1 : 0;
                console.log(`Syncing petals list from ${remotes[otherIndex].name} to ${remotes[index].name}`);
                let file = new File([petalsList[otherIndex]], "petals.json");
                SyncUtils.putFile("/data/storage/petal/petals.json", file, remotes[index].url, remotes[index].key);
                break;
            }
        }
    }

    async syncNotebookConfig(notebookId: string, remotes: [RemoteInfo, RemoteInfo] = this.copyRemotes(this.remotes)) {
        SyncUtils.checkRemotes(remotes);

        const files: string[] = [
            "conf.json",
            "sort.json",
        ];

        console.log(`Syncing notebook config for notebook ${notebookId}`);

        await Promise.all(files.map(file => {
            const filePath = `/data/${notebookId}/.siyuan/${file}`;
            return this.syncFile(
                filePath,
                notebookId,
                {
                    deleteFoldersOnly: false,
                    onlyIfMissing: false,
                    avoidDeletions: false,
                    trackConflicts: false
                },
                remotes
            );
        }));
    }
}
