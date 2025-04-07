import { Plugin } from "siyuan";
import { getFileBlob, getNotebookConf, getNotebookInfo, listDocsByPath, lsNotebooks, putFile, readDir, setNotebookConf } from "./api";

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

        let lastSyncLocal = await this.getLastSyncTime();

        // Sync notebook configurations
        // Combine notebooks for easier processing (using a Map to automatically handle duplicates)
        const allNotebooks = new Map<string, Notebook>();

        // Add all local and remote notebooks to the map (using ID as the key to avoid duplicates)
        [...localNotebooks, ...remoteNotebooks].forEach(notebook => {
            allNotebooks.set(notebook.id, notebook);
        });

        // Convert back to array for processing if needed
        const combinedNotebooks = Array.from(allNotebooks.values());

        // Now we can iterate through all notebooks for configuration sync
        for (const notebook of combinedNotebooks) {
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
        }

        for (const notebook of combinedNotebooks) {
            let remoteFiles = await this.getDocsRecursively(notebook.id, "/", url, key);
            console.log("remoteFiles: ", remoteFiles);

            let localFiles = await this.getDocsRecursively(notebook.id, "/");
            console.log("localFiles: ", localFiles);

            // Compare localFiles and remoteFiles
            for (const [id, documentFile] of remoteFiles.entries()) {
                if (!localFiles.has(id)) {
                    console.log(`File ${documentFile.name} (${id}) is missing locally.`);

                    let filePath = `/data/${notebook.id}${documentFile.path}`
                    let syFile = await getFileBlob(filePath, url, this.getHeaders(key))

                    let file = new File([syFile], documentFile.name)
                    putFile(filePath, false, file, null, null, documentFile.mtime)

                    console.log(`File ${documentFile.name} (${id}) downloaded successfully.`);
                }
            }

            for (const [id, documentFile] of localFiles.entries()) {
                if (!remoteFiles.has(id)) {
                    console.log(`File ${documentFile.name} (${id}) is missing remotely.`);

                    let filePath = `/data/${notebook.id}${documentFile.path}`
                    let syFile = await getFileBlob(filePath)

                    let file = new File([syFile], documentFile.name)
                    putFile(filePath, false, file, url, this.getHeaders(key), documentFile.mtime)

                    console.log(`File ${documentFile.name} (${id}) uploaded successfully.`);
                }
            }

            // Compare file timestamps
            for (const [id, remoteFile] of remoteFiles.entries()) {
                const localFile = localFiles.get(id);
                if (localFile && remoteFile.mtime !== localFile.mtime) {
                    console.log(`File ${remoteFile.name} (${id}) has different timestamps.`);
                    console.log(`remote: ${remoteFile.mtime}, local ${localFile.mtime}`)

                    const filePath = `/data/${notebook.id}${localFile.path}`

                    if (localFile.mtime > remoteFile.mtime) {
                        console.log(`Local file is newer. Updating remote.`)
                        let syFile = await getFileBlob(filePath)
                        let file = new File([syFile], localFile.name)

                        putFile(filePath, false, file, url, this.getHeaders(key), localFile.mtime)
                    } else {
                        console.log(`Remote file is newer. Updating local.`)
                        let syFile = await getFileBlob(filePath, url, this.getHeaders(key))
                        let file = new File([syFile], localFile.name)

                        putFile(filePath, false, file, null, null, remoteFile.mtime)
                    }
                }
            }
        }

        this.setSyncStatus();
        console.log("Sync completed.");
    }

    // Utils
    getHeaders(key: string = null): Record<string, string> {
        if (!key) return {}

        return { "Authorization": `Token ${key}` }
    }
}
