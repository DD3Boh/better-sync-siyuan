import { createDocWithMd, getFileBlob, getHPathByID, getPathByID, renameDocByID } from "@/api";
import { SyncUtils } from "./sync";
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
     * @param urlToKeyMap - An array of tuples containing URLs and API keys for storage.
     */
    static async createConflictFile(
        notebookId: string,
        humanReadablePath: string,
        blob: Blob,
        olderFileTimestamp: number,
        urlToKeyMap: [string, string][]
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
        await SyncUtils.putFile(conflictPathString, file, urlToKeyMap[0][0], urlToKeyMap[0][1], timestamp);
        await SyncUtils.putFile(conflictPathString, file, urlToKeyMap[1][0], urlToKeyMap[1][1], timestamp);
        await renameDocByID(conflictDocId, conflictNoteTitle, urlToKeyMap[0][0], SyncUtils.getHeaders(urlToKeyMap[0][1]));
        await renameDocByID(conflictDocId, conflictNoteTitle, urlToKeyMap[1][0], SyncUtils.getHeaders(urlToKeyMap[1][1]));
    }

    /**
     * Handles conflict detection between two files.
     *
     * @param path - The path of the file being synced.
     * @param fileRes - The file resource information.
     * @param fileOne - The first file to compare.
     * @param fileTwo - The second file to compare.
     * @param dirName - The name of the directory containing the files.
     * @param urlToKeyMap - An array of tuples containing URLs and API keys for storage.
     * @param lastSyncTimeOne - The last sync time for the first file.
     * @param lastSyncTimeTwo - The last sync time for the second file.
     * @param i18n - The internationalization object.
     * @returns A promise that resolves to a boolean indicating whether a conflict was detected.
     */
    static async handleConflictDetection(
        path: string,
        fileRes: IResReadDir,
        fileOne: IResReadDir | undefined,
        fileTwo: IResReadDir | undefined,
        dirName: string,
        urlToKeyMap: [string, string][],
        lastSyncTimeOne: number,
        lastSyncTimeTwo: number,
        i18n: any
    ): Promise<boolean> {
        if (!fileOne || !fileTwo) return false;

        const timestampOne = fileOne.updated;
        const timestampTwo = fileTwo.updated;

        if (lastSyncTimeOne > 0 && lastSyncTimeTwo > 0 &&
            timestampOne > lastSyncTimeOne && timestampTwo > lastSyncTimeTwo &&
            timestampOne !== timestampTwo) {

            console.log(`Conflict detected for file: ${path}`);

            // print timestamps and last sync times
            console.log(`File One Timestamp: ${timestampOne}, Last Sync Time One: ${lastSyncTimeOne}`);
            console.log(`File Two Timestamp: ${timestampTwo}, Last Sync Time Two: ${lastSyncTimeTwo}`);

            const notebookId = dirName;

            const olderFileIndex = timestampOne > timestampTwo ? 1 : 0;
            const olderFileTimestamp = olderFileIndex === 0 ? timestampOne : timestampTwo;

            // Get document id
            const fileResName = fileRes.name.endsWith(".sy") ? fileRes.name.slice(0, -3) : fileRes.name;

            const humanReadablePath = await getHPathByID(fileResName, urlToKeyMap[olderFileIndex][0], SyncUtils.getHeaders(urlToKeyMap[olderFileIndex][1]));
            console.log(`Human readable path for conflict file: ${humanReadablePath}`);

            showMessage(i18n.conflictDetectedForDocument.replace("{{documentName}}", humanReadablePath.split("/").pop()), 5000);

            const oldFileBlob = await getFileBlob(path, urlToKeyMap[olderFileIndex][0], SyncUtils.getHeaders(urlToKeyMap[olderFileIndex][1]));
            if (!oldFileBlob) {
                console.log(`File ${path} not found in ${urlToKeyMap[olderFileIndex][0]}`);
                return true;
            }

            await this.createConflictFile(
                notebookId,
                humanReadablePath,
                oldFileBlob,
                olderFileTimestamp,
                urlToKeyMap
            );

            return true;
        }

        return false;
    }
}
