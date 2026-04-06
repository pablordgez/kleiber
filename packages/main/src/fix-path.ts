import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import log from "electron-log/main";

/**
 * Resolves the active nvm node bin directory by reading ~/.nvm/alias/default.
 * The alias file may contain an indirect reference (e.g. "lts/iron") which
 * itself points to another alias file, so we follow the chain up to a limit.
 */
function resolveNvmBin(): string | null {
  const nvmDir = process.env.NVM_DIR ?? path.join(os.homedir(), ".nvm");
  if (!existsSync(nvmDir)) return null;

  let alias: string | null = null;
  try {
    alias = readFileSync(path.join(nvmDir, "alias", "default"), "utf8").trim();
  } catch {
    return null;
  }

  for (let depth = 0; depth < 5 && alias !== null && !alias.startsWith("v"); depth++) {
    try {
      alias = readFileSync(path.join(nvmDir, "alias", alias), "utf8").trim();
    } catch {
      alias = null;
    }
  }

  if (!alias?.startsWith("v")) return null;
  const binDir = path.join(nvmDir, "versions", "node", alias, "bin");
  return existsSync(binDir) ? binDir : null;
}

/**
 * Returns well-known node/npm binary directories that exist on disk.
 * Covers nvm, volta, fnm, and common npm global prefix locations.
 */
function probeKnownNodeBinPaths(): string[] {
  const home = os.homedir();
  const candidates: Array<string | null> = [
    resolveNvmBin(),
    path.join(home, ".volta", "bin"),
    // fnm: uses a per-version bin dir pointed to by a "current" symlink
    path.join(home, ".local", "share", "fnm"),
    // npm global prefix — varies by distro/user config
    path.join(home, ".local", "share", "npm", "bin"),
    path.join(home, ".npm-global", "bin"),
    // pnpm global bin
    path.join(home, ".local", "share", "pnpm"),
    // yarn global bin
    path.join(home, ".yarn", "bin"),
  ];

  return candidates.filter((p): p is string => {
    if (!p) return false;
    try {
      return statSync(p).isDirectory();
    } catch {
      return false;
    }
  });
}

/**
 * Augments process.env.PATH so that binary detection works when Electron is
 * launched from a desktop environment (where it inherits only the minimal
 * system PATH, not the user's shell-configured one).
 *
 * Strategy:
 *   1. Spawn a login+interactive shell to obtain the user's full PATH.
 *      The -i flag ensures ~/.bashrc / ~/.zshrc are sourced in addition to
 *      the login files (~/.bash_profile / ~/.profile), which is where most
 *      node version managers (nvm, volta, fnm) register themselves.
 *   2. After the shell spawn, directly probe well-known node/npm bin paths
 *      and prepend any that are not already present. This covers setups where
 *      the shell spawn timed out, the shell guards PATH setup behind [ -t 1 ],
 *      or $SHELL points to a different shell than the one used for node tools.
 */
export function fixPath(): void {
  const shell = process.env.SHELL ?? "/bin/bash";
  log.info(`[path-fix] shell=${shell} inherited PATH=${process.env.PATH ?? "(unset)"}`);

  try {
    const result = spawnSync(shell, ["-l", "-i", "-c", "printf '%s' \"$PATH\""], {
      encoding: "utf8",
      timeout: 3000,
      // TERM=dumb + PS1 suppress interactive prompts that could block the shell
      env: { ...process.env, TERM: "dumb", PS1: "$ " },
    });
    log.info(
      `[path-fix] spawn status=${String(result.status)} error=${String(result.error)} stderr=${result.stderr?.trim()}`,
    );
    const shellPath = result.stdout?.trim();
    if (shellPath) {
      process.env.PATH = shellPath;
      log.info(`[path-fix] shell PATH applied`);
    } else {
      log.warn("[path-fix] login shell returned empty PATH, will rely on probed paths");
    }
  } catch (err) {
    log.warn(`[path-fix] failed to spawn login shell: ${String(err)}`);
  }

  // Second pass: add any well-known paths that the shell spawn may have missed
  // (e.g. [ -t 1 ] guards, wrong $SHELL, timeout).
  const currentEntries = new Set((process.env.PATH ?? "").split(path.delimiter).filter(Boolean));
  const missing = probeKnownNodeBinPaths().filter((p) => !currentEntries.has(p));
  if (missing.length > 0) {
    process.env.PATH = [...missing, process.env.PATH ?? ""].join(path.delimiter);
    log.info(`[path-fix] probed and prepended: ${missing.join(":")}`);
  }

  log.info(`[path-fix] final PATH=${process.env.PATH ?? "(unset)"}`);
}
