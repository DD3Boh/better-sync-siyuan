interface RemoteInfo {
    url: string;
    key: string;
    lastSyncTime: number;
}

interface RemoteFileInfo extends RemoteInfo {
    file?: IResReadDir;
}
