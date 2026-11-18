// Ambient module declarations for external libraries without bundled typings
declare module 'dotenv';
declare module 'morgan';
declare module 'swagger-ui-express';
declare module 'helmet';

/**
 * node:sqlite is part of the Node runtime (>= 22.5) but is not declared by
 * @types/node 20, which this build pins. Only the read-only surface
 * src/sourcePriors.ts uses is declared here; drop this block once the
 * @types/node pin reaches 22.
 */
declare module 'node:sqlite' {
  export interface StatementSync {
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
    run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  }
  export class DatabaseSync {
    constructor(path: string, options?: { readOnly?: boolean });
    prepare(sql: string): StatementSync;
    exec(sql: string): void;
    close(): void;
  }
}
