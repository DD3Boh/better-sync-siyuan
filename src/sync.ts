import { Plugin } from "siyuan";
import { getFileBlob, getNotebookConf, listDocsByPath, lsNotebooks, putFile, readDir, removeFile } from "./api";

export class SyncManager {
    private plugin: Plugin;
    private localWorkspaceDir: string;
    private urlToKeyPairs: [string, string][];

    constructor(plugin: Plugin, workspaceDir: string, urlToKeyPairs: [string, string][] = []) {
        this.plugin = plugin;
        this.localWorkspaceDir = workspaceDir;
        this.urlToKeyPairs = urlToKeyPairs;
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

    async setSyncStatus() {
        let url = this.urlToKeyPairs[0][0];
        let key = this.urlToKeyPairs[0][1];

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
        let url = this.urlToKeyPairs[0][0];
        let key = this.urlToKeyPairs[0][1];

        if (!url || !key) {
            console.error("Siyuan URL or API Key is not set.");
            return;
        }

        let remoteNotebooks = await this.getNotebooks(url, key);
        let localNotebooks = await this.getNotebooks();
        let lastSyncTime = await this.getLastSyncTime();

        // Combine notebooks for easier processing (using a Map to automatically handle duplicates)
        const allNotebooks = new Map<string, Notebook>();

        // Add all local and remote notebooks to the map (using ID as the key to avoid duplicates)
        [...localNotebooks, ...remoteNotebooks].forEach(notebook => {
            allNotebooks.set(notebook.id, notebook);
        });

        // Convert back to array for processing if needed
        const combinedNotebooks = Array.from(allNotebooks.values());

        // Create an array of promises for concurrent syncing
        const syncPromises = combinedNotebooks.map(notebook =>
            this.syncNotebook(notebook, url, key, lastSyncTime)
        );

        // Wait for all notebook syncs to complete
        await Promise.all(syncPromises);

        this.setSyncStatus();
        console.log("Sync completed.");
    }

    async syncNotebook(notebook: Notebook, url: string, key: string, lastSyncTime: number) {
        console.log(`Syncing notebook ${notebook.name} (${notebook.id})`);

        // Sync notebook configuration
        await this.syncNotebookConfiguration(notebook, url, key, lastSyncTime);

        // Sync notebook content/files
        await this.syncNotebookFiles(notebook, url, key, lastSyncTime);
    }

    async syncNotebookConfiguration(notebook: Notebook, url: string, key: string, lastSyncTime: number) {
        console.log(`Syncing configuration for notebook ${notebook.name} (${notebook.id})`);

        const localConf = await getNotebookConf(notebook.id);
        const remoteConf = await getNotebookConf(notebook.id, url, this.getHeaders(key));

        let localDir = await readDir(`/data/${notebook.id}`);
        let remoteDir = await readDir(`/data/${notebook.id}`, url, this.getHeaders(key));

        let localTimestamp = localDir && localDir.length > 0 ? localDir[0].updated : 0;
        let remoteTimestamp = remoteDir && remoteDir.length > 0 ? remoteDir[0].updated : 0;

        // Synchronize configurations
        if (JSON.stringify(remoteConf) !== JSON.stringify(localConf)) {
            console.log(`Configuration for notebook ${notebook.name} (${notebook.id}) differs. Syncing...`);

            if (!localConf) {
                if (lastSyncTime > remoteTimestamp) {
                    console.log(`Deleting remote notebook ${notebook.name} (${notebook.id})`);
                    removeFile(`/data/${notebook.id}/`, url, this.getHeaders(key));
                    return;
                }
            } else if (!remoteConf) {
                if (lastSyncTime > localTimestamp) {
                    console.log(`Deleting local notebook ${notebook.name} (${notebook.id})`);
                    removeFile(`/data/${notebook.id}/`);
                    return;
                }
            }

            if (!localConf || remoteTimestamp > localTimestamp) {
                console.log(`Remote configuration is newer for notebook ${notebook.name} (${notebook.id}). Syncing...`);

                let file = new File([JSON.stringify(remoteConf.conf, null, 2)], "conf.json");
                putFile(`/data/${notebook.id}/.siyuan/conf.json`, false, file);
            } else if (!remoteConf || localTimestamp > remoteTimestamp) {
                console.log(`Local configuration is newer for notebook ${notebook.name} (${notebook.id}). Syncing...`);

                let file = new File([JSON.stringify(localConf.conf, null, 2)], "conf.json");
                putFile(`/data/${notebook.id}/.siyuan/conf.json`, false, file, url, this.getHeaders(key));
            }

            console.log(`Configuration for notebook ${notebook.name} (${notebook.id}) synced successfully.`);
        }

        return;
    }

    async syncNotebookFiles(notebook: Notebook, url: string, key: string, lastSyncTime: number) {
        let remoteFiles = await this.getDocsRecursively(notebook.id, "/", url, key);
        console.log("remoteFiles: ", remoteFiles);

        let localFiles = await this.getDocsRecursively(notebook.id, "/");
        console.log("localFiles: ", localFiles);

        // Create a combined map of all files
        const allFiles = new Map<string, DocumentFiles>();

        [...remoteFiles, ...localFiles].forEach(pair => {
            allFiles.set(pair[0], pair[1]);
        });

        // Synchronize files
        for (const [id, documentFile] of allFiles.entries()) {
            const remoteFile = remoteFiles.get(id);
            const localFile = localFiles.get(id);

            let filePath = `/data/${notebook.id}${documentFile.path}`;

            let localTimestamp = localFile ? localFile.mtime : 0;
            let remoteTimestamp = remoteFile ? remoteFile.mtime : 0;

            // Multiply by 1000 because `putFile` makes the conversion automatically
            let docTimeStamp = documentFile.mtime * 1000;

            let inputUrl: string;
            let inputKey: string;
            let outputUrl: string;
            let outputKey: string;

            // Remove deleted files
            if (!localFile) {
                if (lastSyncTime > remoteTimestamp) {
                    console.log(`Deleting remote file ${documentFile.name} (${id})`);
                    removeFile(filePath, url, this.getHeaders(key));
                    continue;
                }
            } else if (!remoteFile) {
                if (lastSyncTime > localTimestamp) {
                    console.log(`Deleting local file ${documentFile.name} (${id})`);
                    removeFile(filePath);
                    continue;
                }
            }

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

            console.log(`Syncing file from ${inputUrl} to ${outputUrl}: ${documentFile.name} (${id})`);

            let syFile = await getFileBlob(filePath, inputUrl, this.getHeaders(inputKey));
            let file = new File([syFile], documentFile.name, { lastModified: docTimeStamp });

            putFile(filePath, false, file, outputUrl, this.getHeaders(outputKey), docTimeStamp);

            console.log(`File ${documentFile.name} (${id}) synced successfully.`);
        }
    }

    // Utils
    getHeaders(key: string = null): Record<string, string> {
        if (!key) return {}

        return { "Authorization": `Token ${key}` }
    }
}
