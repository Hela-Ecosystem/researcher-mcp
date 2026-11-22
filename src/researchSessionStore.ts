import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import lockfile from 'proper-lockfile';
import { z } from 'zod';

export const SESSION_NAME_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const MAX_SESSIONS = 100;
const MAX_STORE_BYTES = 8 * 1024 * 1024;
const storedSessionsSchema = z.array(z.tuple([z.string().regex(SESSION_NAME_PATTERN), z.string().min(1)]));

function resolveStorePath(): string {
  const xdgDataHome = process.env.XDG_DATA_HOME;
  const dataHome = xdgDataHome && isAbsolute(xdgDataHome) ? xdgDataHome : join(homedir(), '.local', 'share');
  const directory = process.env.HELA_RESEARCH_SESSION_DIR || join(dataHome, 'hela', 'researcher-mcp');
  return resolve(directory, 'sessions.json');
}

export class ResearchSessionStore {
  private readonly path = resolveStorePath();
  private snapshot?: { serialized: string; sessions: ReadonlyMap<string, string> };
  readonly ready = this.read().then(
    () => undefined,
    error => console.error('Could not load research sessions:', error.message),
  );

  async read(): Promise<ReadonlyMap<string, string>> {
    let serialized: string;
    try {
      serialized = await readFile(this.path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.snapshot = undefined;
        return new Map();
      }
      throw error;
    }

    if (this.snapshot?.serialized === serialized) return this.snapshot.sessions;

    let parsed: unknown;
    try {
      parsed = JSON.parse(serialized);
    } catch {
      throw new Error('Invalid research session store: expected valid JSON.');
    }
    const entries = storedSessionsSchema.safeParse(parsed);
    if (!entries.success) {
      throw new Error('Invalid research session store: expected session names and content.');
    }
    const sessions = new Map(entries.data);
    if (sessions.size !== entries.data.length) {
      throw new Error('Invalid research session store: duplicate session names.');
    }
    this.snapshot = { serialized, sessions };
    return sessions;
  }

  async update(change: (sessions: Map<string, string>) => void): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    let compromised: Error | undefined;
    const release = await lockfile.lock(this.path, {
      realpath: false,
      retries: { retries: 25, minTimeout: 25, maxTimeout: 500 },
      onCompromised: (error: Error) => { compromised = error; },
    });

    try {
      const sessions = new Map(await this.read());
      change(sessions);
      if (sessions.size > MAX_SESSIONS) {
        throw new Error(`Research session store is limited to ${MAX_SESSIONS} sessions. Delete a session and retry.`);
      }
      const serialized = JSON.stringify([...sessions]);
      if (Buffer.byteLength(serialized) > MAX_STORE_BYTES) {
        throw new Error('Research session store is limited to 8 MiB. Reduce the saved content and retry.');
      }

      const temporaryPath = `${this.path}.tmp`;
      await rm(temporaryPath, { force: true });
      try {
        const file = await open(temporaryPath, 'wx', 0o600);
        try {
          await file.writeFile(serialized, 'utf8');
          await file.sync();
        } finally {
          await file.close();
        }
        if (compromised) throw compromised;
        await rename(temporaryPath, this.path);
      } catch (error) {
        if (!compromised) await rm(temporaryPath, { force: true }).catch(() => undefined);
        throw error;
      }
      this.snapshot = { serialized, sessions };
    } finally {
      await release().catch((error: unknown) => console.error('Could not release research session store lock:', error instanceof Error ? error.message : String(error)));
    }
  }
}
