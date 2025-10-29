enum LogLevel {
    INFO = "INFO",
    WARN = "WARN",
    ERROR = "ERROR"
}

let logs: string[] = [];

export class SessionLog {
    static log(message: string, level: LogLevel = LogLevel.INFO) {
        logs.push(`[${level}]: ${message}`);
    }

    static getLogs() {
        return logs;
    }

    static getLogsAsString() {
        return logs.join('\n');
    }

    static clear() {
        logs = [];
    }
}

function convertArgsToString(args: any[]): string {
    return args.map(arg => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ');
}

export function consoleLog(...args: any[]) {
    console.log(...args);
    SessionLog.log(convertArgsToString(args), LogLevel.INFO);
}

export function consoleError(...args: any[]) {
    console.error(...args);
    SessionLog.log(convertArgsToString(args), LogLevel.ERROR);
}

export function consoleWarn(...args: any[]) {
    console.warn(...args);
    SessionLog.log(convertArgsToString(args), LogLevel.WARN);
}
