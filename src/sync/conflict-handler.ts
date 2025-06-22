import { createDocWithMd, getFileBlob, getHPathByID, getPathByID, renameDocByID } from "@/api";
import { SyncUtils } from "@/sync";
import { showMessage } from "siyuan";

export class ConflictHandler {
    /**
     * Formats a Date object into a string with the format "YYYY-MM-DD HH:mm:ss".
     *
     * @param date - The Date object to format.
     * @returns A string representing the formatted date.
     */
    static getFormattedDate(date: Date): string {
        // Using a locale that naturally produces YYYY-MM-DD format for the date part
        const datePart = date.toLocaleDateString('sv-SE', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        });
        const timePart = date.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
        });
        return `${datePart} ${timePart}`;
    }

    /**
     * Creates a conflict file in the specified notebook with the given parameters.
     *
     * @param notebookId - The ID of the notebook where the conflict file will be created.
     * @param humanReadablePath - The human-readable path for the conflict file.
     * @param blob - The Blob object containing the file data.
     * @param olderFileTimestamp - The timestamp of the older file in seconds.
     * @param remotes - An array of RemoteInfo objects containing remote server information.
     */
    static async createConflictFile(
        notebookId: string,
        humanReadablePath: string,
        blob: Blob,
        olderFileTimestamp: number,
        remotes: RemoteInfo[]
    ) {
        const timestamp = olderFileTimestamp * 1000; // Convert to milliseconds
        const originalNoteTitle = humanReadablePath.split("/").pop();
        const conflictNoteTitle = `${originalNoteTitle} - Conflict ${this.getFormattedDate(new Date(timestamp))}`;
        const conflictFilePath = humanReadablePath.replace(originalNoteTitle, conflictNoteTitle);

        console.log(`Conflict file will be saved as: ${conflictFilePath}`);

        const conflictDocId = await createDocWithMd(
            notebookId,
            conflictFilePath,
            ""
        );

        const conflictStoragePath = await getPathByID(conflictDocId);
        const conflictPathString = `data/${conflictStoragePath.notebook}${conflictStoragePath.path}`;

        console.log(`Created conflict document with ID: ${conflictDocId}`);

        let file = new File([blob], `${conflictDocId}.sy`, { lastModified: timestamp });

        async function createConflictFileInRemote(index: number) {
            await SyncUtils.putFile(conflictPathString, file, remotes[index].url, remotes[index].key, timestamp);
            await renameDocByID(conflictDocId, conflictNoteTitle, remotes[index].url, SyncUtils.getHeaders(remotes[index].key));
        }

        const promises = remotes.map((remote, index) => {
            return createConflictFileInRemote(index).catch((error) => {
                console.error(`Error creating conflict file`, error);
            });
        });

        await Promise.all(promises);
    }

    /**
     * Handles conflict detection between two files.
     *
     * @param path - The path of the file being synced.
     * @param dirName - The name of the directory where the files are located.
     * @param data - An array of RemoteFileInfo objects containing file metadata.
     * @param i18n - The internationalization object for localized messages.
     * @returns A Promise that resolves to a boolean indicating whether a conflict was detected.
     */
    static async handleConflictDetection(
        path: string,
        dirName: string,
        data: RemoteFileInfo[],
        i18n: any
    ): Promise<boolean> {
        if (data.length < 2) {
            console.log("Not enough file information to check for conflicts.");
            return false;
        }

        if (!data[0].file || !data[1].file) return false;

        const fileRes = data[0].file || data[1].file;

        if (data[0].lastSyncTime > 0 && data[1].lastSyncTime > 0 &&
            data[0].file.updated > data[0].lastSyncTime && data[1].file.updated > data[1].lastSyncTime &&
            data[0].file.updated !== data[1].file.updated) {

            console.log(`Conflict detected for file: ${path}`);

            // print timestamps and last sync times
            console.log(`File One Timestamp: ${data[0].file.updated}, Last Sync Time One: ${data[0].lastSyncTime}`);
            console.log(`File Two Timestamp: ${data[1].file.updated}, Last Sync Time Two: ${data[1].lastSyncTime}`);

            const notebookId = dirName;

            const olderFileIndex = data[0].file.updated > data[1].file.updated ? 1 : 0;
            const olderFileTimestamp = data[olderFileIndex].file.updated;

            // Get document id
            const docId = fileRes.name.replace(/\.sy$/, "");

            const humanReadablePath = await getHPathByID(docId, data[olderFileIndex].url, SyncUtils.getHeaders(data[olderFileIndex].key));
            console.log(`Human readable path for conflict file: ${humanReadablePath}`);

            showMessage(i18n.conflictDetectedForDocument.replace("{{documentName}}", humanReadablePath.split("/").pop()), 5000);

            const oldFileBlob = await getFileBlob(path, data[olderFileIndex].url, SyncUtils.getHeaders(data[olderFileIndex].key));
            if (!oldFileBlob) {
                console.log(`File ${path} not found in ${data[olderFileIndex].url}`);
                return true;
            }

            const remotes: RemoteInfo[] = data.map(({ file, ...rest }) => rest);

            await this.createConflictFile(
                notebookId,
                humanReadablePath,
                oldFileBlob,
                olderFileTimestamp,
                remotes
            );

            return true;
        }

        return false;
    }
}
