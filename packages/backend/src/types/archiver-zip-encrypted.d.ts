declare module 'archiver' {
    interface ArchiverOptions {
        encryptionMethod?: 'aes256' | 'zip20';
        password?: string;
        zlib?: { level: number };
    }

    function registerFormat(format: string, module: any): void;
    function create(format: string, options: ArchiverOptions): Archiver;

    interface Archiver extends NodeJS.EventEmitter {
        on(event: 'data', listener: (data: Buffer) => void): this;
        on(event: 'error', listener: (err: Error) => void): this;
        append(data: any, options: { name: string }): void;
        finalize(): Promise<void>;
    }
}