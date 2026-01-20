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
