import { broadcastPublish, getChannelInfo, newBroadcastWebSocket, postBroadcastMessage } from "@/api";
import { SyncUtils } from "@/sync";

export class WebSocketManager {
    private socket: WebSocket | null = null;
    private remote: RemoteInfo | null = null;
    private broadcastChannel: string;

    // WebSocket connection status
    private connected: boolean = false;

    constructor(channel: string, remote: RemoteInfo | null) {
        this.broadcastChannel = channel;
        this.remote = remote;
    }

    /**
     * Initialize the WebSocket connection.
     */
    async initWebSocket(): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                this.socket = newBroadcastWebSocket(this.broadcastChannel, this.remote?.url, this.remote?.key);

                this.socket.onopen = () => {
                    console.log("WebSocket connection established.");
                    this.connected = true;
                    resolve();
                };

                this.socket.onerror = (error) => {
                    console.error("WebSocket error:", error);
                    this.connected = false;
                    reject(error);
                };

                this.socket.onclose = () => {
                    console.log("WebSocket connection closed.");
                    this.socket = null;
                    this.connected = false;
                };
            } catch (error) {
                console.error("Failed to initialize WebSocket:", error);
                reject(error);
            }
        });
    }

    /**
     * Close the WebSocket connection.
     */
    closeWebSocket() {
        if (this.socket)
            this.socket.close();
        else
            console.warn("WebSocket connection is already closed or not initialized.");
    }

    /**
     * Send a message through the WebSocket connection.
     * @param message The message to send.
     */
    async sendMessage(message: string): Promise<void> {
        await postBroadcastMessage(
            this.broadcastChannel,
            message,
            this.remote?.url,
            SyncUtils.getHeaders(this.remote?.key)
        );
    }

    /**
     * Connect to the onmessage event of the WebSocket.
     * @param callback The callback function to handle incoming messages.
     */
    connectOnMessage(callback: (data: any) => void): void {
        if (this.socket)
            this.socket.onmessage = (event) => callback(event.data);
    }

    /**
     * Connect to the onerror event of the WebSocket.
     * @param callback The callback function to handle errors.
     */
    connectOnError(callback: (error: any) => void): void {
        if (this.socket)
            this.socket.onerror = (error) => callback(error);
    }

    /**
     * Publish a message to the broadcast channel.
     * This can include strings and binary files.
     *
     * @param data The data to broadcast, which can include strings and binary files.
     */
    async broadcastContent(
        data: { strings?: string[], binaries?: { file: Blob, filename: string }[] },
    ) {
        await broadcastPublish(
            this.broadcastChannel,
            data,
            this.remote?.url,
            SyncUtils.getHeaders(this.remote?.key)
        );
    }

    /**
     * Method to check if the WebSocket is being listened to.
     * @returns true if the WebSocket is open and listening, false otherwise.
     */
    async isListening(): Promise<boolean> {
        const channelInfo = await getChannelInfo(
            this.broadcastChannel, this.remote?.url, SyncUtils.getHeaders(this.remote?.key)
        );

        // Ignore the connection from this websocket instance itself
        const totalConnections = (channelInfo?.channel?.count || 0) - (this.connected ? 1 : 0);
        return totalConnections > 0;
    }

    /**
     * Get the current status of the WebSocket connection.
     *
     * @returns The current status, as a boolean indicating if the WebSocket is connected.
     */
    isConnected(): boolean {
        return this.connected;
    }
}
