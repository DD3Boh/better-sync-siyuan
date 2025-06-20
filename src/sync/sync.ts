import { SyncUtils } from "./sync-utils";

import {
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
    private urlToKeyMap: [string, string][] = [];
    private originalFetch: typeof window.fetch;
    private conflictDetected: boolean = false;

    getUrl(): string {
        return this.plugin.settingsManager.getPref("siyuanUrl");
    }

    getKey(): string {
        return this.plugin.settingsManager.getPref("siyuanAPIKey");
    }

    getNickname(): string {
        return this.plugin.settingsManager.getPref("siyuanNickname");
    }

    updateUrlKey() {
        let url = this.getUrl()
        let key = this.getKey()

        this.urlToKeyMap = []
        this.urlToKeyMap.push(["", "SKIP"]);
        if (url && key)
            this.urlToKeyMap.push([url, key]);
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

    async getNotebooks(url: string = "", key: string = null): Promise<Notebook[]> {
        let notebooks = await lsNotebooks(url, SyncUtils.getHeaders(key))

        return notebooks.notebooks;
    }

    async syncHandler(urlToKeyMap: [string, string][] = this.urlToKeyMap) {
        const startTime = Date.now();
        try {
            await this.syncWithRemote(urlToKeyMap, startTime);
        } catch (error) {
            console.error("Error during sync:", error);
            const nickname = this.getNickname();
            const remoteName = nickname || urlToKeyMap[1][0];
            const duration = ((Date.now() - startTime) / 1000).toFixed(1);
            showMessage(
                this.plugin.i18n.syncWithRemoteFailed.replace("{{remoteName}}", remoteName).replace("{{error}}", error.message).replace("{{duration}}", duration),
                6000,
                "error"
            );
        }
    }

    async syncWithRemote(urlToKeyMap: [string, string][] = this.urlToKeyMap, startTime?: number) {
        SyncUtils.checkUrlToKeyMap(urlToKeyMap);

        const nickname = this.getNickname();
        const remoteName = nickname || urlToKeyMap[1][0];

        showMessage(this.plugin.i18n.syncingWithRemote.replace("{{remoteName}}", remoteName), 2000);
        console.log(`Syncing with remote server ${remoteName}...`);

        let notebooksOne = await this.getNotebooks(urlToKeyMap[0][0], urlToKeyMap[0][1]);
        let notebooksTwo = await this.getNotebooks(urlToKeyMap[1][0], urlToKeyMap[1][1]);
        let lastSyncTimeOne = await SyncUtils.getLastSyncTime(urlToKeyMap[0][0], urlToKeyMap[0][1]);
        let lastSyncTimeTwo = await SyncUtils.getLastSyncTime(urlToKeyMap[1][0], urlToKeyMap[1][1]);

        // Combine notebooks for easier processing (using a Map to automatically handle duplicates)
        const allNotebooks = new Map<string, Notebook>();

        // Add all local and remote notebooks to the map (using ID as the key to avoid duplicates)
        [...notebooksOne, ...notebooksTwo].forEach(notebook => {
            allNotebooks.set(notebook.id, notebook);
        });

        // Convert back to array for processing if needed
        const combinedNotebooks = Array.from(allNotebooks.values());

        const syncPromises = combinedNotebooks.map(notebook =>
            this.syncDirectory("data", notebook.id, urlToKeyMap, lastSyncTimeOne, lastSyncTimeTwo, [".siyuan"])
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
            this.syncDirectory(path, dir, urlToKeyMap, lastSyncTimeOne, lastSyncTimeTwo)
        );

        // Sync some files only if missing
        const syncIfMissing: [string, string][] = [
            ["data/storage", "petal"],
            ["data", "snippets"],
        ];

        const syncIfMissingPromises = syncIfMissing.map(([path, dir]) =>
            this.syncDirectory(path, dir, urlToKeyMap, lastSyncTimeOne, lastSyncTimeTwo, [], {
                deleteFoldersOnly: false,
                onlyIfMissing: true,
                avoidDeletions: true
            })
        );

        const promises = [
            ...syncPromises,
            ...syncDirPromises,
            ...syncIfMissingPromises,
            this.syncPetalsListIfEmpty(urlToKeyMap),
        ];

        // Execute all sync operations concurrently
        console.log(`Starting sync operations for ${combinedNotebooks.length} notebooks and ${directoriesToSync.length} directories...`);

        await Promise.all(promises);

        // Handle missing assets
        await this.syncMissingAssets(urlToKeyMap);

        reloadFiletree(urlToKeyMap[0][0], SyncUtils.getHeaders(urlToKeyMap[0][1]));
        reloadFiletree(urlToKeyMap[1][0], SyncUtils.getHeaders(urlToKeyMap[1][1]));

        SyncUtils.setSyncStatus(urlToKeyMap);

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

    async syncDirectory(
        path: string,
        dirName: string,
        urlToKeyMap: [string, string][] = this.urlToKeyMap,
        lastSyncTimeOne: number,
        lastSyncTimeTwo: number,
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
        SyncUtils.checkUrlToKeyMap(urlToKeyMap);

        const notebooksOne = await this.getNotebooks(urlToKeyMap[0][0], urlToKeyMap[0][1]);
        const notebooksTwo = await this.getNotebooks(urlToKeyMap[1][0], urlToKeyMap[1][1]);

        const allNotebookIds = new Set([...notebooksOne.map(n => n.id), ...notebooksTwo.map(n => n.id)]);
        const isNotebook = allNotebookIds.has(dirName);

        console.log(`Syncing directory ${path}/${dirName}. Is notebook: ${isNotebook}`);

        let filesOne = await SyncUtils.getDirFilesRecursively(path, dirName, urlToKeyMap[0][0], urlToKeyMap[0][1], true, excludedSubdirs);
        let filesTwo = await SyncUtils.getDirFilesRecursively(path, dirName, urlToKeyMap[1][0], urlToKeyMap[1][1], true, excludedSubdirs);

        // Create a combined map of all files
        const allFiles = new Map<string, IResReadDir>();

        [...filesOne, ...filesTwo].forEach(pair => {
            allFiles.set(pair[0], pair[1]);
        });

        // Synchronize files
        for (const [filePath, fileRes] of allFiles.entries()) {
            const fileOne = filesOne.get(filePath);
            const fileTwo = filesTwo.get(filePath);

            const timestampOne = fileOne?.updated || 0;
            const timestampTwo = fileTwo?.updated || 0;

            // Conflict detection
            const trackConflicts = this.plugin.settingsManager.getPref("trackConflicts");
            if (!options.onlyIfMissing && isNotebook && !fileRes.isDir && trackConflicts) {
                const conflictDetected = await ConflictHandler.handleConflictDetection(
                    filePath, fileRes, fileOne, fileTwo, dirName, urlToKeyMap, lastSyncTimeOne, lastSyncTimeTwo, this.plugin.i18n
                );

                if (conflictDetected) this.conflictDetected = true;
            }

            // Multiply by 1000 because `putFile` makes the conversion automatically
            const timestamp: number = Math.max(timestampOne, timestampTwo) * 1000;

            const lastSyncTime = Math.min(lastSyncTimeOne, lastSyncTimeTwo);

            if (fileOne && fileTwo && (timestampOne === timestampTwo || options.onlyIfMissing)) continue;

            // Remove deleted files
            if ((!fileOne && lastSyncTime > timestampTwo) || (!fileTwo && lastSyncTime > timestampOne)) {
                if ((fileRes.isDir || !options.deleteFoldersOnly) && !options.avoidDeletions) {
                    const targetIndex = !fileOne ? 1 : 0;
                    SyncUtils.deleteFile(filePath, fileRes, urlToKeyMap[targetIndex][0], urlToKeyMap[targetIndex][1]);
                    continue;
                }
            }

            // Avoid writing directories
            if (fileRes.isDir) continue;

            const iIn = timestampOne > timestampTwo ? 0 : 1;
            const iOut = timestampOne > timestampTwo ? 1 : 0;
            const sourceName = iIn === 0 ? 'local' : 'remote';
            const targetName = iOut === 0 ? 'local' : 'remote';

            console.log(`Syncing file from ${sourceName} to ${targetName}: ${fileRes.name} (${filePath})`);
            console.log(`timestampOne: ${timestampOne}, timestampTwo: ${timestampTwo}`);

            const syFile = await getFileBlob(filePath, urlToKeyMap[iIn][0], SyncUtils.getHeaders(urlToKeyMap[iIn][1]));
            if (!syFile) {
                console.log(`File ${filePath} not found in source: ${sourceName}`);
                continue;
            }

            const file = new File([syFile], fileRes.name, { lastModified: timestamp });
            SyncUtils.putFile(filePath, file, urlToKeyMap[iOut][0], urlToKeyMap[iOut][1], timestamp);

            console.log(`File ${fileRes.name} (${filePath}) synced successfully.`);
        }
    }

    async syncFileIfMissing(path: string, urlToKeyMap: [string, string][] = this.urlToKeyMap) {
        SyncUtils.checkUrlToKeyMap(urlToKeyMap);

        let fileOne = await getFileBlob(path, urlToKeyMap[0][0], SyncUtils.getHeaders(urlToKeyMap[0][1]));
        let fileTwo = await getFileBlob(path, urlToKeyMap[1][0], SyncUtils.getHeaders(urlToKeyMap[1][1]));

        if (!fileOne) {
            console.log(`Syncing file ${path} from ${urlToKeyMap[1][0]} to ${urlToKeyMap[0][0]}`);
            let file = new File([fileTwo], path.split("/").pop());
            SyncUtils.putFile(path, file, urlToKeyMap[0][0], urlToKeyMap[0][1]);
        } else if (!fileTwo) {
            console.log(`Syncing file ${path} from ${urlToKeyMap[0][0]} to ${urlToKeyMap[1][0]}`);
            let file = new File([fileOne], path.split("/").pop());
            SyncUtils.putFile(path, file, urlToKeyMap[1][0], urlToKeyMap[1][1]);
        }
    }

    async syncMissingAssets(urlToKeyMap: [string, string][] = this.urlToKeyMap) {
        SyncUtils.checkUrlToKeyMap(urlToKeyMap);

        console.log(`Syncing missing assets`);

        const [localMissing, remoteMissing] = await Promise.all([
            getMissingAssets(urlToKeyMap[0][0], SyncUtils.getHeaders(urlToKeyMap[0][1])),
            getMissingAssets(urlToKeyMap[1][0], SyncUtils.getHeaders(urlToKeyMap[1][1]))
        ]);

        const allMissingAssets = [...localMissing.missingAssets, ...remoteMissing.missingAssets];

        const assetsPromises = allMissingAssets.map(asset =>
            this.syncFileIfMissing(`/data/${asset}`, urlToKeyMap)
        );

        await Promise.all(assetsPromises);
    }

    async syncPetalsListIfEmpty(urlToKeyMap: [string, string][] = this.urlToKeyMap) {
        SyncUtils.checkUrlToKeyMap(urlToKeyMap);

        let petalsListOne = await getFileBlob("/data/storage/petal/petals.json", urlToKeyMap[0][0], SyncUtils.getHeaders(urlToKeyMap[0][1]));
        let petalsListTwo = await getFileBlob("/data/storage/petal/petals.json", urlToKeyMap[1][0], SyncUtils.getHeaders(urlToKeyMap[1][1]));

        if (!petalsListOne || await petalsListOne.text() === "[]") {
            console.log(`Syncing petals list from ${urlToKeyMap[1][0]} to ${urlToKeyMap[0][0]}`);
            let file = new File([petalsListTwo], "petals.json");
            SyncUtils.putFile("/data/storage/petal/petals.json", file, urlToKeyMap[0][0], urlToKeyMap[0][1]);
        } else if (!petalsListTwo || await petalsListTwo.text() === "[]") {
            console.log(`Syncing petals list from ${urlToKeyMap[0][0]} to ${urlToKeyMap[1][0]}`);
            let file = new File([petalsListOne], "petals.json");
            SyncUtils.putFile("/data/storage/petal/petals.json", file, urlToKeyMap[1][0], urlToKeyMap[1][1]);
        }
    }

    async pushFile(path: string, urlToKeyMap: [string, string][] = this.urlToKeyMap) {
        SyncUtils.checkUrlToKeyMap(urlToKeyMap);
        let fileOne = await getFileBlob(path, urlToKeyMap[0][0], SyncUtils.getHeaders(urlToKeyMap[0][1]));

        if (fileOne) {
            console.log(`Pushing file ${path} from ${urlToKeyMap[0][0]} to ${urlToKeyMap[1][0]}`);
            let file = new File([fileOne], path.split("/").pop());
            SyncUtils.putFile(path, file, urlToKeyMap[1][0], urlToKeyMap[1][1]);
        } else {
            console.log(`File ${path} not found in ${urlToKeyMap[0][0]}`);
        }
    }

    async syncNotebookConfig(notebookId: string, urlToKeyMap: [string, string][] = this.urlToKeyMap) {
        SyncUtils.checkUrlToKeyMap(urlToKeyMap);

        let files: string[] = [
            "conf.json",
            "sort.json",
        ]

        let dirOne = await readDir(`/data/${notebookId}/.siyuan/`, urlToKeyMap[0][0], SyncUtils.getHeaders(urlToKeyMap[0][1]));
        let dirTwo = await readDir(`/data/${notebookId}/.siyuan/`, urlToKeyMap[1][0], SyncUtils.getHeaders(urlToKeyMap[1][1]));

        for (let file of files) {
            let path = `/data/${notebookId}/.siyuan/${file}`;

            const fileOne = dirOne.find(it => it.name === file);
            const fileTwo = dirTwo.find(it => it.name === file);

            if (!fileOne && !fileTwo) {
                console.log(`File ${path} not found in either location.`);
                continue;
            }

            const timestampOne = fileOne?.updated || 0;
            const timestampTwo = fileTwo?.updated || 0;

            if (timestampOne === timestampTwo) {
                console.log(`File ${path} is up to date in both locations.`);
                continue;
            }

            const iIn = timestampOne > timestampTwo ? 0 : 1;
            const iOut = timestampOne > timestampTwo ? 1 : 0;
            const sourceName = iIn === 0 ? 'local' : 'remote';
            const targetName = iOut === 0 ? 'local' : 'remote';

            const fileBlob = await getFileBlob(path, urlToKeyMap[iIn][0], SyncUtils.getHeaders(urlToKeyMap[iIn][1]));
            if (fileBlob) {
                console.log(`Pushing notebook config ${path} from ${sourceName} to ${targetName}`);
                const fileObj = new File([fileBlob], file);
                SyncUtils.putFile(path, fileObj, urlToKeyMap[iOut][0], urlToKeyMap[iOut][1]);
            }
        }
    }
}
