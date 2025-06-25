import { broadcastPublish, newBroadcastWebSocket, postBroadcastMessage } from "@/api";
import { SyncUtils } from "@/sync";

const inputChannel = "better-sync-input";
const outputChannel = "better-sync-output";

export class WebSocketManager {
    private socket: WebSocket | null = null;
    private remote: RemoteInfo | null = null;
    private broadcastChannel: string;

    constructor(channel: "input" | "output", remote: RemoteInfo | null) {
        this.broadcastChannel = channel === "input" ? inputChannel : outputChannel;
        this.remote = remote;
    }

    /**
     * Initialize the WebSocket connection.
     */
    async initWebSocket(): Promise<void> {
        if (this.socket) {
            this.socket.close();
            this.socket = null;
        }

        try {
            this.socket = newBroadcastWebSocket(this.broadcastChannel, this.remote?.url, this.remote?.key);

            this.socket.onopen = () => {
                console.log("WebSocket connection established.");
            };

            this.socket.onerror = (error) => {
                console.error("WebSocket error:", error);
            };

            this.socket.onclose = () => {
                console.log("WebSocket connection closed.");
                this.socket = null;
            };
        } catch (error) {
            console.error("Failed to initialize WebSocket:", error);
        }
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
}
