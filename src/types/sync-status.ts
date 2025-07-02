export enum SyncStatus {
    None,
    InProgress,
    Failed,
    Done
}

export type SyncStatusCallback = (status: SyncStatus) => void;
