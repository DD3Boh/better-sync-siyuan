import {
    createDocWithMd,
    exportMdContent,
    getFileBlob,
    getHPathByID,
    getHPathByPath,
    getMissingAssets,
    listDocsByPath,
    lsNotebooks,
    putFile,
    readDir,
    removeFile,
    removeIndexes,
    renameDocByID,
    upsertIndexes
} from "./api";
import BetterSyncPlugin from ".";
import { showMessage } from "siyuan";

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

        this.originalFetch = window.fetch.bind(this);
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
        let notebooks = await lsNotebooks(url, this.getHeaders(key))

        return notebooks.notebooks;
    }

    async getDocsRecursively(notebookId: string, path: string, url: string = "", key: string = ""): Promise<Map<string, DocumentFiles>> {
        let docs = await listDocsByPath(notebookId, path, url, this.getHeaders(key))
        let filesMap = new Map<string, DocumentFiles>();

        if (!docs || !docs.files) {
            console.log("No files found or invalid response:", docs);
            return filesMap;
        }

        // Add current level files to the map
        docs.files.forEach(file => {
            filesMap.set(file.id, file);
        });

        // Collect all promises
        const promises = docs.files
            .filter(doc => doc.subFileCount > 0)
            .map(doc => this.getDocsRecursively(notebookId, path + "/" + doc.id, url, key));

        // Wait for all promises to resolve
        const results = await Promise.all(promises);

        // Merge all result maps into the main map
        results.forEach(resultMap => {
            for (const [id, file] of resultMap.entries()) {
                filesMap.set(id, file);
            }
        });

        return filesMap;
    }

    async getDirFilesRecursively(path: string, dirName: string, url: string = "", key: string = "", skipSymlinks: boolean = true): Promise<Map<string, IResReadDir>> {
        let filesMap = new Map<string, IResReadDir>();

        let fullPath = `${path}/${dirName}`;

        // Read the path itself and add it to the map
        let mainDirResponse = await readDir(path, url, this.getHeaders(key));

        // Retrieve the main directory only
        if (!mainDirResponse || !Array.isArray(mainDirResponse)) {
            console.log(`No files found or invalid response for path ${path}:`, mainDirResponse);
            return filesMap;
        }

        let mainDir = mainDirResponse.find(file => file.name === dirName);
        if (!mainDir) {
            console.log(`Directory ${dirName} not found in path ${path}`);
            return filesMap;
        }
        filesMap.set(`${path}/${mainDir.name}`, mainDir);

        let dirResponse = await readDir(fullPath, url, this.getHeaders(key));

        if (!dirResponse || !Array.isArray(dirResponse)) {
            console.log(`No files found or invalid response for path ${fullPath}:`, dirResponse);
            return filesMap;
        }

        let dir = dirResponse.filter(file => !(skipSymlinks && file.isSymlink));
        if (!dir || dir.length === 0) {
            console.log("No files found or invalid response:", dir);
            return filesMap;
        }

        // Add current level files to the map
        dir.forEach(file => {
            filesMap.set(`${fullPath}/${file.name}`, file);
        });

        // Collect all promises
        const promises = dir
            .filter(file => file.isDir)
            .map(file => this.getDirFilesRecursively(fullPath, file.name, url, key, skipSymlinks));

        // Wait for all promises to resolve
        const results = await Promise.all(promises);

        // Merge all result maps into the main map
        results.forEach(resultMap => {
            for (const [filePath, file] of resultMap.entries()) {
                filesMap.set(filePath, file);
            }
        });

        return filesMap;
    }

    async setSyncStatus(urlToKeyMap: [string, string][] = this.urlToKeyMap) {
        this.checkUrlToKeyMap(urlToKeyMap);

        let filePath = `/data/.siyuan/sync/status`

        let file = new File([], "status");
        putFile(filePath, false, file, urlToKeyMap[0][0], this.getHeaders(urlToKeyMap[0][1]));
        putFile(filePath, false, file, urlToKeyMap[1][0], this.getHeaders(urlToKeyMap[1][1]));
    }

    async getLastSyncTime(url: string = "", key: string = null): Promise<number> {
        let dir = await readDir(`/data/.siyuan/sync/`, url, this.getHeaders(key));

        if (!dir || dir.length === 0) {
            console.log("No sync directory found.");
            return 0;
        }

        let file = dir.find(file => file.name === "status");
        if (!file) {
            console.log("No status file found.");
            return 0;
        }

        return file.updated;
    }

    async syncHandler(urlToKeyMap: [string, string][] = this.urlToKeyMap) {
        try {
            await this.syncWithRemote(urlToKeyMap);
        } catch (error) {
            console.error("Error during sync:", error);
            const nickname = this.getNickname();
            const remoteName = nickname || urlToKeyMap[1][0];
            showMessage(
                this.plugin.i18n.syncWithRemoteFailed.replace("{{remoteName}}", remoteName).replace("{{error}}", error.message),
                6000,
                "error"
            );
        }
    }

    async syncWithRemote(urlToKeyMap: [string, string][] = this.urlToKeyMap) {
        this.checkUrlToKeyMap(urlToKeyMap);

        const nickname = this.getNickname();
        const remoteName = nickname || urlToKeyMap[1][0];

        showMessage(this.plugin.i18n.syncingWithRemote.replace("{{remoteName}}", remoteName), 2000);
        console.log(`Syncing with remote server ${remoteName}...`);

        let notebooksOne = await this.getNotebooks(urlToKeyMap[0][0], urlToKeyMap[0][1]);
        let notebooksTwo = await this.getNotebooks(urlToKeyMap[1][0], urlToKeyMap[1][1]);
        let lastSyncTimeOne = await this.getLastSyncTime(urlToKeyMap[0][0], urlToKeyMap[0][1]);
        let lastSyncTimeTwo = await this.getLastSyncTime(urlToKeyMap[1][0], urlToKeyMap[1][1]);

        // Get the least recent sync time
        let lastSyncTime = Math.min(lastSyncTimeOne, lastSyncTimeTwo);

        // Combine notebooks for easier processing (using a Map to automatically handle duplicates)
        const allNotebooks = new Map<string, Notebook>();

        // Add all local and remote notebooks to the map (using ID as the key to avoid duplicates)
        [...notebooksOne, ...notebooksTwo].forEach(notebook => {
            allNotebooks.set(notebook.id, notebook);
        });

        // Convert back to array for processing if needed
        const combinedNotebooks = Array.from(allNotebooks.values());

        const syncPromises = combinedNotebooks.map(notebook =>
            this.syncDirectory("data", notebook.id, urlToKeyMap, lastSyncTimeOne, lastSyncTimeTwo, false)
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

        const syncifMissingPromises = syncIfMissing.map(([path, dir]) =>
            this.syncMissingFiles(path, dir, urlToKeyMap, lastSyncTime, true)
        );

        await Promise.all(syncPromises);
        await Promise.all(syncDirPromises);
        await Promise.all(syncifMissingPromises);

        // Sync petals list if empty
        await this.syncPetalsListIfEmpty(urlToKeyMap);

        // Handle missing assets
        await this.syncMissingAssets(urlToKeyMap);

        this.setSyncStatus();

        if (this.conflictDetected) {
            showMessage(this.plugin.i18n.syncCompletedWithConflicts, 2000);
            console.warn("Sync completed with conflicts.");
        } else {
            showMessage(this.plugin.i18n.syncCompletedSuccessfully, 2000);
            console.log("Sync completed successfully!");
        }

        this.conflictDetected = false; // Reset conflict detection flag after sync
    }

    async syncDirectory(path: string, dirName: string, urlToKeyMap: [string, string][] = this.urlToKeyMap, lastSyncTimeOne: number, lastSyncTimeTwo: number, deleteFoldersOnly: boolean = true) {
        this.checkUrlToKeyMap(urlToKeyMap);

        const notebooksOne = await this.getNotebooks(urlToKeyMap[0][0], urlToKeyMap[0][1]);
        const notebooksTwo = await this.getNotebooks(urlToKeyMap[1][0], urlToKeyMap[1][1]);

        const allNotebookIds = new Set([...notebooksOne.map(n => n.id), ...notebooksTwo.map(n => n.id)]);
        const isNotebook = allNotebookIds.has(dirName);

        let filesOne = await this.getDirFilesRecursively(path, dirName, urlToKeyMap[0][0], urlToKeyMap[0][1]);
        let filesTwo = await this.getDirFilesRecursively(path, dirName, urlToKeyMap[1][0], urlToKeyMap[1][1]);

        console.log(`Syncing directory ${path}/${dirName}. Is notebook: ${isNotebook}`);

        // Create a combined map of all files
        const allFiles = new Map<string, IResReadDir>();

        [...filesOne, ...filesTwo].forEach(pair => {
            allFiles.set(pair[0], pair[1]);
        });

        // Synchronize files
        for (const [path, fileRes] of allFiles.entries()) {
            const fileOne = filesOne.get(path);
            const fileTwo = filesTwo.get(path);

            let timestampOne = fileOne ? fileOne.updated : 0;
            let timestampTwo = fileTwo ? fileTwo.updated : 0;

            console.log(`Processing file: ${fileRes.name} (${path})`);

            // Conflict detection
            if (isNotebook && !fileRes.isDir) {
                const conflictDetected = await this.handleConflictDetection(
                    path,
                    fileRes,
                    fileOne,
                    fileTwo,
                    dirName,
                    urlToKeyMap,
                    lastSyncTimeOne,
                    lastSyncTimeTwo
                );

                if (conflictDetected) this.conflictDetected = true;
            }

            // Multiply by 1000 because `putFile` makes the conversion automatically
            let timestamp: number = Math.max(timestampOne, timestampTwo) * 1000;

            let iOut: number;
            let iIn: number;

            const lastSyncTime = Math.min(lastSyncTimeOne, lastSyncTimeTwo);

            // Remove deleted files
            if (fileRes.isDir || !deleteFoldersOnly) {
                if (!fileOne) {
                    if (lastSyncTime > timestampTwo) {
                        console.log(`Deleting remote ${fileRes.isDir ? 'directory' : 'file'} ${fileRes.name} (${path})`);
                        removeFile(path, urlToKeyMap[1][0], this.getHeaders(urlToKeyMap[1][1]));
                        removeIndexes([path.replace("data/", "")], urlToKeyMap[1][0], this.getHeaders(urlToKeyMap[1][1]));
                        continue;
                    }
                } else if (!fileTwo) {
                    if (lastSyncTime > timestampOne) {
                        console.log(`Deleting local ${fileRes.isDir ? 'directory' : 'file'} ${fileRes.name} (${path})`);
                        removeFile(path, urlToKeyMap[0][0], this.getHeaders(urlToKeyMap[0][1]));
                        removeIndexes([path.replace("data/", "")], urlToKeyMap[0][0], this.getHeaders(urlToKeyMap[0][1]));
                        continue;
                    }
                }
            }

            // Avoid writing directories
            if (fileRes.isDir) continue;

            if (!fileOne || timestampTwo > timestampOne) {
                iIn = 1;
                iOut = 0;
            } else if (!fileTwo || timestampOne > timestampTwo) {
                iIn = 0;
                iOut = 1;
            } else {
                continue;
            }

            console.log(`Syncing file from ${urlToKeyMap[iIn][0]} to ${urlToKeyMap[iOut][0]}: ${fileRes.name} (${path})`);
            console.log(`timestampOne: ${timestampOne}, timestampTwo: ${timestampTwo}`);

            let syFile = await getFileBlob(path, urlToKeyMap[iIn][0], this.getHeaders(urlToKeyMap[iIn][1]));
            if (!syFile) {
                console.log(`File ${path} not found in ${urlToKeyMap[iIn][0]}`);
                continue;
            }

            let file = new File([syFile], fileRes.name, { lastModified: timestamp });

            putFile(path, false, file, urlToKeyMap[iOut][0], this.getHeaders(urlToKeyMap[iOut][1]), timestamp);
            upsertIndexes([path.replace("data/", "")], urlToKeyMap[iOut][0], this.getHeaders(urlToKeyMap[iOut][1]));

            console.log(`File ${fileRes.name} (${path}) synced successfully.`);
        }
    }

    async syncMissingFiles(path: string, dirName: string, urlToKeyMap: [string, string][] = this.urlToKeyMap, lastSyncTime: number, avoidDeletions: boolean = false) {
        this.checkUrlToKeyMap(urlToKeyMap);

        console.log(`Syncing missing files in directory ${path}/${dirName}`);

        let filesOne = await this.getDirFilesRecursively(path, dirName, urlToKeyMap[0][0], urlToKeyMap[0][1]);
        let filesTwo = await this.getDirFilesRecursively(path, dirName, urlToKeyMap[1][0], urlToKeyMap[1][1]);

        // Create a combined map of all files
        const allFiles = new Map<string, IResReadDir>();

        [...filesOne, ...filesTwo].forEach(pair => {
            allFiles.set(pair[0], pair[1]);
        });

        // Synchronize files
        for (const [path, fileRes] of allFiles.entries()) {
            const fileOne = filesOne.get(path);
            const fileTwo = filesTwo.get(path);

            let timestampOne = fileOne ? fileOne.updated : 0;
            let timestampTwo = fileTwo ? fileTwo.updated : 0;

            // Multiply by 1000 because `putFile` makes the conversion automatically
            let timestamp: number = Math.max(timestampOne, timestampTwo) * 1000;

            // Remove deleted files
            if (!fileOne) {
                if (lastSyncTime > timestampTwo && !avoidDeletions) {
                    console.log(`Deleting remote ${fileRes.isDir ? 'directory' : 'file'} ${fileRes.name} (${path})`);
                    removeFile(path, urlToKeyMap[1][0], this.getHeaders(urlToKeyMap[1][1]));
                    removeIndexes([path.replace("data/", "")], urlToKeyMap[1][0], this.getHeaders(urlToKeyMap[1][1]));
                } else {
                    if (fileRes.isDir) continue;
                    console.log(`Syncing file ${path} from ${urlToKeyMap[1][0]} to ${urlToKeyMap[0][0]}`);
                    let syFile = await getFileBlob(path, urlToKeyMap[1][0], this.getHeaders(urlToKeyMap[1][1]));

                    let file = new File([syFile], path, { lastModified: timestamp });
                    putFile(path, false, file, urlToKeyMap[0][0], this.getHeaders(urlToKeyMap[0][1]), timestamp);
                    upsertIndexes([path.replace("data/", "")], urlToKeyMap[0][0], this.getHeaders(urlToKeyMap[0][1]));
                }
            } else if (!fileTwo) {
                if (lastSyncTime > timestampOne && !avoidDeletions) {
                    console.log(`Deleting local ${fileRes.isDir ? 'directory' : 'file'} ${fileRes.name} (${path})`);
                    removeFile(path, urlToKeyMap[0][0], this.getHeaders(urlToKeyMap[0][1]));
                    removeIndexes([path.replace("data/", "")], urlToKeyMap[0][0], this.getHeaders(urlToKeyMap[0][1]));
                } else {
                    if (fileRes.isDir) continue;
                    console.log(`Syncing file ${path} from ${urlToKeyMap[0][0]} to ${urlToKeyMap[1][0]}`);
                    let syFile = await getFileBlob(path, urlToKeyMap[0][0], this.getHeaders(urlToKeyMap[0][1]));

                    let file = new File([syFile], path, { lastModified: timestamp });
                    putFile(path, false, file, urlToKeyMap[1][0], this.getHeaders(urlToKeyMap[1][1]), timestamp);
                    upsertIndexes([path.replace("data/", "")], urlToKeyMap[1][0], this.getHeaders(urlToKeyMap[1][1]));
                }
            }
        }
    }

    async syncFileIfMissing(path: string, urlToKeyMap: [string, string][] = this.urlToKeyMap) {
        this.checkUrlToKeyMap(urlToKeyMap);

        let fileOne = await getFileBlob(path, urlToKeyMap[0][0], this.getHeaders(urlToKeyMap[0][1]));
        let fileTwo = await getFileBlob(path, urlToKeyMap[1][0], this.getHeaders(urlToKeyMap[1][1]));

        if (!fileOne) {
            console.log(`Syncing file ${path} from ${urlToKeyMap[1][0]} to ${urlToKeyMap[0][0]}`);
            let file = new File([fileTwo], path.split("/").pop());
            putFile(path, false, file, urlToKeyMap[0][0], this.getHeaders(urlToKeyMap[0][1]));
        } else if (!fileTwo) {
            console.log(`Syncing file ${path} from ${urlToKeyMap[0][0]} to ${urlToKeyMap[1][0]}`);
            let file = new File([fileOne], path.split("/").pop());
            putFile(path, false, file, urlToKeyMap[1][0], this.getHeaders(urlToKeyMap[1][1]));
        }
    }

    async syncMissingAssets(urlToKeyMap: [string, string][] = this.urlToKeyMap) {
        this.checkUrlToKeyMap(urlToKeyMap);

        console.log(`Syncing missing assets`);

        const [localMissing, remoteMissing] = await Promise.all([
            getMissingAssets(urlToKeyMap[0][0], this.getHeaders(urlToKeyMap[0][1])),
            getMissingAssets(urlToKeyMap[1][0], this.getHeaders(urlToKeyMap[1][1]))
        ]);

        const allMissingAssets = [...localMissing.missingAssets, ...remoteMissing.missingAssets];

        const assetsPromises = allMissingAssets.map(asset =>
            this.syncFileIfMissing(`/data/${asset}`, urlToKeyMap)
        );

        await Promise.all(assetsPromises);
    }

    async syncPetalsListIfEmpty(urlToKeyMap: [string, string][] = this.urlToKeyMap) {
        this.checkUrlToKeyMap(urlToKeyMap);

        let petalsListOne = await getFileBlob("/data/storage/petal/petals.json", urlToKeyMap[0][0], this.getHeaders(urlToKeyMap[0][1]));
        let petalsListTwo = await getFileBlob("/data/storage/petal/petals.json", urlToKeyMap[1][0], this.getHeaders(urlToKeyMap[1][1]));

        if (!petalsListOne || await petalsListOne.text() === "[]") {
            console.log(`Syncing petals list from ${urlToKeyMap[1][0]} to ${urlToKeyMap[0][0]}`);
            let file = new File([petalsListTwo], "petals.json");
            putFile("/data/storage/petal/petals.json", false, file, urlToKeyMap[0][0], this.getHeaders(urlToKeyMap[0][1]));
        } else if (!petalsListTwo || await petalsListTwo.text() === "[]") {
            console.log(`Syncing petals list from ${urlToKeyMap[0][0]} to ${urlToKeyMap[1][0]}`);
            let file = new File([petalsListOne], "petals.json");
            putFile("/data/storage/petal/petals.json", false, file, urlToKeyMap[1][0], this.getHeaders(urlToKeyMap[1][1]));
        }
    }

    async pushFile(path: string, urlToKeyMap: [string, string][] = this.urlToKeyMap) {
        this.checkUrlToKeyMap(urlToKeyMap);
        let fileOne = await getFileBlob(path, urlToKeyMap[0][0], this.getHeaders(urlToKeyMap[0][1]));

        if (fileOne) {
            console.log(`Pushing file ${path} from ${urlToKeyMap[0][0]} to ${urlToKeyMap[1][0]}`);
            let file = new File([fileOne], path.split("/").pop());
            putFile(path, false, file, urlToKeyMap[1][0], this.getHeaders(urlToKeyMap[1][1]));
            upsertIndexes([path.replace("data/", "")], urlToKeyMap[1][0], this.getHeaders(urlToKeyMap[1][1]));
        } else {
            console.log(`File ${path} not found in ${urlToKeyMap[0][0]}`);
        }
    }

    async syncNotebookConfig(notebookId: string, urlToKeyMap: [string, string][] = this.urlToKeyMap) {
        this.checkUrlToKeyMap(urlToKeyMap);

        let files: string[] = [
            "conf.json",
            "sort.json",
        ]

        let dirOne = await readDir(`/data/${notebookId}/.siyuan/`, urlToKeyMap[0][0], this.getHeaders(urlToKeyMap[0][1]));
        let dirTwo = await readDir(`/data/${notebookId}/.siyuan/`, urlToKeyMap[1][0], this.getHeaders(urlToKeyMap[1][1]));

        for (let file of files) {
            let path = `/data/${notebookId}/.siyuan/${file}`;

            const fileOne = dirOne.find(it => it.name === file);
            const fileTwo = dirTwo.find(it => it.name === file);

            if (!fileOne && !fileTwo) {
                console.log(`File ${path} not found in both ${urlToKeyMap[0][0]} and ${urlToKeyMap[1][0]}`);
                continue;
            }

            let timestampOne = fileOne ? fileOne.updated : 0;
            let timestampTwo = fileTwo ? fileTwo.updated : 0;

            if (timestampOne > timestampTwo) {
                let fileBlob = await getFileBlob(path, urlToKeyMap[0][0], this.getHeaders(urlToKeyMap[0][1]));
                if (fileBlob) {
                    console.log(`Pushing notebook config ${path} from ${urlToKeyMap[0][0]} to ${urlToKeyMap[1][0]}`);
                    let fileObj = new File([fileBlob], file);
                    putFile(path, false, fileObj, urlToKeyMap[1][0], this.getHeaders(urlToKeyMap[1][1]));
                }
            } else if (timestampTwo > timestampOne) {
                let fileBlob = await getFileBlob(path, urlToKeyMap[1][0], this.getHeaders(urlToKeyMap[1][1]));
                if (fileBlob) {
                    console.log(`Pushing notebook config ${path} from ${urlToKeyMap[1][0]} to ${urlToKeyMap[0][0]}`);
                    let fileObj = new File([fileBlob], file);
                    putFile(path, false, fileObj, urlToKeyMap[0][0], this.getHeaders(urlToKeyMap[0][1]));
                }
            } else {
                console.log(`File ${path} is up to date in both ${urlToKeyMap[0][0]} and ${urlToKeyMap[1][0]}`);
            }
        }
    }

    // Utils
    getHeaders(key: string = null): Record<string, string> {
        if (!key || key.trim() === "SKIP") return {}

        return { "Authorization": `Token ${key}` }
    }

    checkUrlToKeyMap(urlToKeyMap: [string, string][] = this.urlToKeyMap) {
        if (!urlToKeyMap || !Array.isArray(urlToKeyMap))
            throw new Error("urlToKeyMap is not properly initialized");

        if (urlToKeyMap.length !== 2)
            throw new Error(`Expected urlToKeyMap to have exactly 2 entries, but found ${urlToKeyMap.length}`);

        for (let i = 0; i < urlToKeyMap.length; i++) {
            if ((!urlToKeyMap[i][0] && i != 0) || !urlToKeyMap[i][1])
                throw new Error(`Siyuan URL or API Key is not set for entry ${i + 1}.`);
        }
    }

    private async handleConflictDetection(
        path: string,
        fileRes: IResReadDir,
        fileOne: IResReadDir | undefined,
        fileTwo: IResReadDir | undefined,
        dirName: string,
        urlToKeyMap: [string, string][],
        lastSyncTimeOne: number,
        lastSyncTimeTwo: number
    ): Promise<boolean> {
        if (!fileOne || !fileTwo) {
            return false;
        }

        const trackConflicts = this.plugin.settingsManager.getPref("trackConflicts");
        if (!trackConflicts) {
            return false;
        }

        const timestampOne = fileOne.updated;
        const timestampTwo = fileTwo.updated;

        if (lastSyncTimeOne > 0 && lastSyncTimeTwo > 0 &&
            timestampOne > lastSyncTimeOne && timestampTwo > lastSyncTimeTwo && 
            timestampOne !== timestampTwo) {

            console.log(`Conflict detected for file: ${path}`);

            const notebookId = dirName;

            const newerFileIndex = timestampOne > timestampTwo ? 0 : 1;
            const olderFileIndex = 1 - newerFileIndex;
            const olderFileTimestamp = olderFileIndex === 0 ? timestampOne : timestampTwo;

            const date = new Date(olderFileTimestamp * 1000);
            const pad = (n: number) => String(n).padStart(2, '0');

            const datePart = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
            const timePart = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;

            console.log(`Conflict file timestamp: ${datePart} ${timePart}`);
            const formattedTimestamp = `${datePart} ${timePart}`;

            // Get document id
            const fileResName = fileRes.name.endsWith(".sy") ? fileRes.name.slice(0, -3) : fileRes.name;

            const humanReadablePath = await getHPathByID(fileResName, urlToKeyMap[olderFileIndex][0], this.getHeaders(urlToKeyMap[olderFileIndex][1]));
            console.log(`Human readable path for conflict file: ${humanReadablePath}`);

            showMessage(this.plugin.i18n.conflictDetectedForDocument.replace("{{documentName}}", humanReadablePath.split("/").pop()), 5000);

            const conflictFilePath = `${humanReadablePath} - Conflict ${formattedTimestamp}`;
            console.log(`Conflict file will be saved as: ${conflictFilePath}`);

            const conflictFileTitle = conflictFilePath.split("/").pop();
            console.log(`Conflict file title: ${conflictFileTitle}`);

            const oldFileBlob = await getFileBlob(path, urlToKeyMap[olderFileIndex][0], this.getHeaders(urlToKeyMap[olderFileIndex][1]));
            if (!oldFileBlob) {
                console.log(`File ${path} not found in ${urlToKeyMap[olderFileIndex][0]}`);
                return true;
            }

            const conflictDocId = await createDocWithMd(
                notebookId,
                conflictFilePath,
                ""
            );

            console.log(`Created conflict document with ID: ${conflictDocId}`);

            let file = new File([oldFileBlob], `${conflictDocId}.sy`, { lastModified: olderFileTimestamp * 1000 });

            let conflictPath = path.replace(fileRes.name, `${conflictDocId}.sy`);

            await putFile(conflictPath, false, file, urlToKeyMap[0][0], this.getHeaders(urlToKeyMap[0][1]), olderFileTimestamp * 1000);
            await putFile(conflictPath, false, file, urlToKeyMap[1][0], this.getHeaders(urlToKeyMap[1][1]), olderFileTimestamp * 1000);
            await upsertIndexes([conflictPath.replace("data/", "")], urlToKeyMap[0][0], this.getHeaders(urlToKeyMap[0][1]));
            await upsertIndexes([conflictPath.replace("data/", "")], urlToKeyMap[1][0], this.getHeaders(urlToKeyMap[1][1]));
            await renameDocByID(conflictDocId, conflictFileTitle, urlToKeyMap[0][0], this.getHeaders(urlToKeyMap[0][1]));
            await renameDocByID(conflictDocId, conflictFileTitle, urlToKeyMap[1][0], this.getHeaders(urlToKeyMap[1][1]));

            return true;
        }

        return false;
    }
}
