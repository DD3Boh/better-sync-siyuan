import { Plugin } from "siyuan";
import { getFileBlob, getNotebookConf, listDocsByPath, lsNotebooks, putFile } from "./api";

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

        // Create the notebook if it doesn't exist locally
        for (const notebook of remoteNotebooks) {
            if (!localNotebooks.some(localNotebook => localNotebook.id === notebook.id)) {
                console.log(`Creating local notebook ${notebook.name} (${notebook.id})`);

                let notebookConf = await getNotebookConf(notebook.id, url, this.getHeaders(key));
                let file = new File([JSON.stringify(notebookConf, null, 2)], "conf.json");

                putFile(`/data/${notebook.id}/.siyuan/conf.json`, false, file);
            }
        }

        // Create the notebook if it doesn't exist remotely
        for (const notebook of localNotebooks) {
            if (!remoteNotebooks.some(remoteNotebook => remoteNotebook.id === notebook.id)) {
                console.log(`Creating remote notebook ${notebook.name} (${notebook.id})`);

                let notebookConf = await getNotebookConf(notebook.id);
                let file = new File([JSON.stringify(notebookConf, null, 2)], "conf.json");

                putFile(`/data/${notebook.id}/.siyuan/conf.json`, false, file, url, this.getHeaders(key));
            }
        }

        for (const notebook of remoteNotebooks) {
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
                    putFile(filePath, false, file)

                    console.log(`File ${documentFile.name} (${id}) downloaded successfully.`);
                }
            }

            for (const [id, documentFile] of localFiles.entries()) {
                if (!remoteFiles.has(id)) {
                    console.log(`File ${documentFile.name} (${id}) is missing remotely.`);

                    let filePath = `/data/${notebook.id}${documentFile.path}`
                    let syFile = await getFileBlob(filePath)

                    let file = new File([syFile], documentFile.name)
                    putFile(filePath, false, file, url, this.getHeaders(key))

                    console.log(`File ${documentFile.name} (${id}) uploaded successfully.`);
                }
            }

            // Compare file timestamps
            for (const [id, remoteFile] of remoteFiles.entries()) {
                const localFile = localFiles.get(id);
                if (localFile && remoteFile.mtime !== localFile.mtime) {
                    console.log(`File ${remoteFile.name} (${id}) has different timestamps.`);
                }
            }
        }
    }

    // Utils
    getHeaders(key: string = null): Record<string, string> {
        if (!key) return {}

        return { "Authorization": `Token ${key}` }
    }
}
