import { getFileBlob, getMissingAssets, getNotebookConf, listDocsByPath, lsNotebooks, putFile, readDir, removeFile } from "./api";
import BetterSyncPlugin from ".";
import { showMessage } from "siyuan";

export class SyncManager {
    private plugin: BetterSyncPlugin;
    private localWorkspaceDir: string;
    private urlToKeyMap: [string, string][] = []

    getUrl(): string {
        return this.plugin.settingsManager.getPref("siyuanUrl");
    }

    getKey(): string {
        return this.plugin.settingsManager.getPref("siyuanAPIKey");
    }

    updateUrlKey() {
        let url = this.plugin.settingsManager.getPref("siyuanUrl");
        let key = this.plugin.settingsManager.getPref("siyuanAPIKey");

        if (this.urlToKeyMap.length > 1)
            this.urlToKeyMap[1] = [url, key];
        else
            this.urlToKeyMap.push([url, key]);
    }

    constructor(plugin: BetterSyncPlugin, workspaceDir: string) {
        this.plugin = plugin;
        this.localWorkspaceDir = workspaceDir;
        this.urlToKeyMap.push(["http://localhost:6806", null]);
        this.urlToKeyMap.push([this.getUrl(), this.getKey()]);
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

    async setSyncStatus() {
        let url = this.urlToKeyMap[1][0];
        let key = this.urlToKeyMap[1][1];

        if (!url || !key) {
            console.error("Siyuan URL or API Key is not set.");
            return;
        }

        let filePath = `/data/.siyuan/sync/.syncstatus`

        let file = new File([], ".syncstatus");
        putFile(filePath, false, file, url, this.getHeaders(key));
        putFile(filePath, false, file);
    }

    async getLastSyncTime(url: string = "", key: string = null): Promise<number> {
        let dir = await readDir(`/data/.siyuan/sync/`, url, this.getHeaders(key));

        if (!dir || dir.length === 0) {
            console.log("No sync directory found.");
            return 0;
        }

        return dir[0].updated;
    }

    async syncWithRemote() {
        // TODO: Add support for multiple remotes
        let url = this.urlToKeyMap[1][0];
        let key = this.urlToKeyMap[1][1];

        if (!url || !key) {
            console.error("Siyuan URL or API Key is not set.");
            showMessage("Cannot sync: Siyuan URL or API Key is not set.");
            return;
        }

        showMessage(`Syncing with remote server ${url}...`);

        let remoteNotebooks = await this.getNotebooks(url, key);
        let localNotebooks = await this.getNotebooks();
        let lastLocalSyncTime = await this.getLastSyncTime();
        let lastRemoteSyncTime = await this.getLastSyncTime(url, key);

        // Get the least recent sync time
        let lastSyncTime = Math.min(lastLocalSyncTime, lastRemoteSyncTime);

        // Combine notebooks for easier processing (using a Map to automatically handle duplicates)
        const allNotebooks = new Map<string, Notebook>();

        // Add all local and remote notebooks to the map (using ID as the key to avoid duplicates)
        [...localNotebooks, ...remoteNotebooks].forEach(notebook => {
            allNotebooks.set(notebook.id, notebook);
        });

        // Convert back to array for processing if needed
        const combinedNotebooks = Array.from(allNotebooks.values());

        const syncPromises = combinedNotebooks.map(notebook =>
            this.syncDirectory("data", notebook.id, url, key, lastSyncTime, false)
        );

        // Sync other directories
        let directoriesToSync = [
            "plugins",
            "templates",
            "widgets",
            "emojis",
        ];

        // Sync directories concurrently
        const syncDirPromises = directoriesToSync.map(dir =>
            this.syncDirectory("data", dir, url, key, lastSyncTime)
        );

        await Promise.all(syncPromises);
        await Promise.all(syncDirPromises);

        // Handle missing assets
        await this.syncMissingAssets(url, key);

        this.setSyncStatus();

        showMessage("Sync completed.");
        console.log("Sync completed.");
    }

    async syncDirectory(path: string, dirName: string, url: string = "", key: string = "", lastSyncTime: number = 0, deleteFoldersOnly: boolean = true) {
        let localFiles = await this.getDirFilesRecursively(path, dirName);
        let remoteFiles = await this.getDirFilesRecursively(path, dirName, url, key);

        console.log(`Syncing directory ${path}/${dirName}`);

        // Create a combined map of all files
        const allFiles = new Map<string, IResReadDir>();

        [...remoteFiles, ...localFiles].forEach(pair => {
            allFiles.set(pair[0], pair[1]);
        });

        // Synchronize files
        for (const [path, fileRes] of allFiles.entries()) {
            const remoteFile = remoteFiles.get(path);
            const localFile = localFiles.get(path);

            let localTimestamp = localFile ? localFile.updated : 0;
            let remoteTimestamp = remoteFile ? remoteFile.updated : 0;

            // Multiply by 1000 because `putFile` makes the conversion automatically
            let fileTimeStamp = fileRes.updated * 1000;

            let inputUrl: string;
            let inputKey: string;
            let outputUrl: string;
            let outputKey: string;

            // Remove deleted files
            if (fileRes.isDir || !deleteFoldersOnly) {
                if (!localFile) {
                    if (lastSyncTime > remoteTimestamp) {
                        console.log(`Deleting remote ${fileRes.isDir ? 'directory' : 'file'} ${fileRes.name} (${path})`);
                        removeFile(path, url, this.getHeaders(key));
                        continue;
                    }
                } else if (!remoteFile) {
                    if (lastSyncTime > localTimestamp) {
                        console.log(`Deleting local ${fileRes.isDir ? 'directory' : 'file'} ${fileRes.name} (${path})`);
                        removeFile(path);
                        continue;
                    }
                }
            }

            // Avoid writing directories
            if (fileRes.isDir) continue;

            if (!localFile || remoteTimestamp > localTimestamp) {
                inputUrl = url;
                inputKey = key;
                outputUrl = "";
                outputKey = null;
            } else if (!remoteFile || localTimestamp > remoteTimestamp) {
                inputUrl = "";
                inputKey = null;
                outputUrl = url;
                outputKey = key;
            } else {
                continue;
            }

            console.log(`Syncing file from ${inputUrl} to ${outputUrl}: ${fileRes.name} (${path})`);
            console.log(`localTimestamp: ${localTimestamp}, remoteTimestamp: ${remoteTimestamp}`);

            let syFile = await getFileBlob(path, inputUrl, this.getHeaders(inputKey));
            let file = new File([syFile], fileRes.name, { lastModified: fileTimeStamp });

            putFile(path, false, file, outputUrl, this.getHeaders(outputKey), fileTimeStamp);

            console.log(`File ${fileRes.name} (${path}) synced successfully.`);
        }
    }

    async syncMissingAssets(url: string, key: string) {
        console.log(`Syncing missing assets`);

        let localMissingAssets = (await getMissingAssets()).missingAssets;

        for (let asset of localMissingAssets) {
            console.log(`Syncing local missing asset ${asset}`);
            let filePath = `/data/${asset}`;
            let blob = await getFileBlob(filePath, url, this.getHeaders(key));

            let file = new File([blob], asset.split("/").pop());
            putFile(filePath, false, file);
        }

        let remoteMissingAssets = (await getMissingAssets(url, this.getHeaders(key))).missingAssets;
        for (let asset of remoteMissingAssets) {
            console.log(`Syncing remote missing asset ${asset}`);
            let filePath = `/data/${asset}`;
            let blob = await getFileBlob(filePath);

            let file = new File([blob], asset.split("/").pop());
            putFile(filePath, false, file, url, this.getHeaders(key));
        }
    }

    // Utils
    getHeaders(key: string = null): Record<string, string> {
        if (!key) return {}

        return { "Authorization": `Token ${key}` }
    }
}
