import { createDocWithMd, getFileBlob, getHPathByID, getPathByID, renameDocByID } from "@/api";
import { Remote, SyncUtils } from "@/sync";
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
     * @param remotes - An array of exactly two Remote objects containing remote server information.
     */
    static async createConflictFile(
        notebookId: string,
        humanReadablePath: string,
        blob: Blob,
        olderFileTimestamp: number,
        remotes: [Remote, Remote]
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

        /*
        * Function to create the conflict file in each remote server.
        * It uploads the file as is, which means that the title would not be changed.
        * The file gets renamed later to include the conflict title.
        * After that, the file is updated again to ensure the correct timestamp.
        */
        async function createConflictFileInRemote(index: number) {
            await SyncUtils.putFile(conflictPathString, file, remotes[index].url, remotes[index].key, timestamp);
            await renameDocByID(conflictDocId, conflictNoteTitle, remotes[index].url, SyncUtils.getHeaders(remotes[index].key));

            file = new File(
                [await getFileBlob(conflictPathString, remotes[index].url, SyncUtils.getHeaders(remotes[index].key))],
                `${conflictDocId}.sy`,
                { lastModified: timestamp }
            );
            await SyncUtils.putFile(conflictPathString, file, remotes[index].url, remotes[index].key, timestamp);
        }

        const promises = remotes.map((_, index) => {
            return createConflictFileInRemote(index).catch((error) => {
                console.error(`Error creating conflict file`, error);
            });
        });

        await Promise.all(promises);
    }

    /**
     * Compares two Blob objects as text.
     * @param blob1 The first Blob object.
     * @param blob2 The second Blob object.
     * @returns True if the blobs are equal as text, false otherwise.
     */
    static async compareBlobsAsText(blob1: Blob, blob2: Blob): Promise<boolean> {
        if (!blob1 || !blob2) return false;
        if (blob1.size !== blob2.size) return false;

        const text1 = await blob1.text();
        const text2 = await blob2.text();

        return text1 === text2;
    }

    /**
     * Handles conflict detection between two files.
     *
     * @param path - The path of the file being synced.
     * @param remotes - An array of exactly two Remote objects containing remote server information.
     * @param i18n - The internationalization object for localized messages.
     * @returns A Promise that resolves to a boolean indicating whether a conflict was detected.
     */
    static async handleConflictDetection(
        path: string,
        remotes: [Remote, Remote],
        i18n: any
    ): Promise<boolean> {
        if (!remotes[0].file || !remotes[1].file) return false;

        const fileRes = remotes[0].file || remotes[1].file;

        if (remotes[0].lastSyncTime > 0 && remotes[1].lastSyncTime > 0 &&
            remotes[0].file.updated > remotes[0].lastSyncTime && remotes[1].file.updated > remotes[1].lastSyncTime &&
            remotes[0].file.updated !== remotes[1].file.updated) {

            console.log(`Conflict detected for file: ${path}`);

            // print timestamps and last sync times
            console.log(`File One Timestamp: ${remotes[0].file.updated}, Last Sync Time One: ${remotes[0].lastSyncTime}`);
            console.log(`File Two Timestamp: ${remotes[1].file.updated}, Last Sync Time Two: ${remotes[1].lastSyncTime}`);

            // Check if the two files are actually different
            const [fileOne, fileTwo] = await Promise.all([
                getFileBlob(path, remotes[0].url, SyncUtils.getHeaders(remotes[0].key)),
                getFileBlob(path, remotes[1].url, SyncUtils.getHeaders(remotes[1].key))
            ]);

            if (await this.compareBlobsAsText(fileOne, fileTwo)) {
                console.log(`Files are identical, no conflict created.`);
                return false;
            }

            // Extract notebook ID from path like "data/notebookId/..." or "/data/notebookId/..."
            const pathParts = path.split('/').filter(part => part !== '');
            const notebookId = pathParts[1];

            const olderFileIndex = remotes[0].file.updated > remotes[1].file.updated ? 1 : 0;
            const olderFileTimestamp = remotes[olderFileIndex].file.updated;

            // Get document id
            const docId = fileRes.name.replace(/\.sy$/, "");

            const humanReadablePath = await getHPathByID(docId, remotes[olderFileIndex].url, SyncUtils.getHeaders(remotes[olderFileIndex].key));
            console.log(`Human readable path for conflict file: ${humanReadablePath}`);

            showMessage(i18n.conflictDetectedForDocument.replace("{{documentName}}", humanReadablePath.split("/").pop()), 5000);

            const oldFileBlob = await getFileBlob(path, remotes[olderFileIndex].url, SyncUtils.getHeaders(remotes[olderFileIndex].key));
            if (!oldFileBlob) {
                console.log(`File ${path} not found in ${remotes[olderFileIndex].url}`);
                return true;
            }

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
