import { consoleError, consoleWarn } from "@/logging";

export class Payload {
    public type: string;
    public data: any;

    constructor(type: string, data: any) {
        this.type = type;
        this.data = data;
    }

    /**
     * Encodes the payload into a string.
     * The format is `b-sync-payload:<type>:<json-data>`
     */
    public toString(): string {
        try {
            const jsonData = JSON.stringify(this.data);
            return `b-sync-payload:${this.type}:${jsonData}`;
        } catch (e) {
            consoleError("Failed to encode Payload", e);
            throw new Error("Failed to encode Payload");
        }
    }

    /**
     * Parses a string to create a Payload instance.
     * @param str The string to parse.
     * @returns A Payload instance, or null if parsing fails.
     */
    public static fromString(str: string): Payload | null {
        const prefix = 'b-sync-payload:';
        if (!str.startsWith(prefix)) {
            consoleWarn("String does not start with expected prefix:", prefix);
            return null;
        }

        const rest = str.substring(prefix.length);
        const typeEndIndex = rest.indexOf(':');

        if (typeEndIndex === -1) {
            return null;
        }

        try {
            const type = rest.substring(0, typeEndIndex);
            const jsonData = rest.substring(typeEndIndex + 1);
            const data = JSON.parse(jsonData);
            return new Payload(type, data);
        } catch (e) {
            consoleError("Failed to parse Payload string", e);
            return null;
        }
    }
}
