export class Payload {
    public type: string;
    public data: Record<string, any>;

    constructor(type: string, data: Record<string, any>) {
        this.type = type;
        this.data = data;
    }

    /**
     * Encodes the payload into a string.
     * The format is `b-sync-payload:<type>:<base64-encoded-json-data>`
     */
    public toString(): string {
        const encodedData = btoa(JSON.stringify(this.data));
        return `b-sync-payload:${this.type}:${encodedData}`;
    }

    /**
     * Parses a string to create a Payload instance.
     * @param str The string to parse.
     * @returns A Payload instance, or null if parsing fails.
     */
    public static fromString(str: string): Payload | null {
        const parts = str.split(':');
        if (parts.length !== 3 || parts[0] !== 'b-sync-payload') {
            return null;
        }

        try {
            const [, type, encodedData] = parts;
            const data = JSON.parse(atob(encodedData));
            return new Payload(type, data);
        } catch (e) {
            console.error("Failed to parse Payload string", e);
            return null;
        }
    }
}
