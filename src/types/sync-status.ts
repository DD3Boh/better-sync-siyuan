export enum SyncStatus {
    None,
    InProgress,
    Failed,
    DoneWithConflict,
    Done
}

export type SyncStatusCallback = (status: SyncStatus) => void;
