import { Remote } from "@/sync";

export enum SyncStatus {
    None,
    InProgress,
    Failed,
    DoneWithConflict,
    Done
}

export type SyncStatusCallback = (status: SyncStatus) => void;

export enum SyncFileResult {
    Success,
    NotFound,
    Deleted,
    DirectoryDeleted,
    DirectoryMoved,
    Skipped
}

export enum SyncFileOperationType {
    Sync,
    Delete,
    HandleConflictAndSync,
    MoveDocsDir,
}

export interface SyncFileOperation {
    operationType: SyncFileOperationType;
    source?: Remote;
    destination?: Remote;
    options?: {
        deleteFoldersOnly?: boolean,
        onlyIfMissing?: boolean,
        avoidDeletions?: boolean,
        trackConflicts?: boolean,
        trackUpdatedFiles?: boolean
    };
}
