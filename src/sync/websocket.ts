import { newBroadcastWebSocket, postBroadcastMessage } from "@/api";
import { SyncUtils } from "@/sync";

const broadcastChannel = "better-sync";

export class WebSocketManager {
    private socket: WebSocket | null = null;
    private remote: RemoteInfo | null = null;

    constructor(remote: RemoteInfo | null) {
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
            this.socket = newBroadcastWebSocket(broadcastChannel, this.remote?.url, this.remote?.key);

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
            broadcastChannel,
            message,
            this.remote?.url,
            SyncUtils.getHeaders(this.remote?.key)
        );
    }

    /**
     * Connect to the onmessage event of the WebSocket.
     * @param callback The callback function to handle incoming messages.
     */
    connectOnMessage(callback: (message: string) => void): void {
        if (this.socket)
            this.socket.onmessage = (event) => callback(event.data);
    }
}