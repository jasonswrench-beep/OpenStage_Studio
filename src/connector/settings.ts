// Whether the connector (MCP) is on, and the one folder an assistant may use. Off until a person turns it on with
// "Set Up Connector.bat". Kept on this computer only, in %APPDATA%\org.openstage.studio\connector.json.

import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

export interface ConnectorSettings {
  on: boolean;
  /** The only folder an assistant may read and write in. */
  folder?: string;
}

/** The settings file. OPENSTAGE_CONNECTOR_SETTINGS names another one (the acceptance test uses its own). */
export function connectorFile(env: NodeJS.ProcessEnv = process.env): string {
  return env.OPENSTAGE_CONNECTOR_SETTINGS || join(env.APPDATA ?? env.HOME ?? ".", "org.openstage.studio", "connector.json");
}

export function readConnector(file = connectorFile()): ConnectorSettings {
  try {
    const s = JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, "")) as ConnectorSettings;
    return { on: s.on === true, ...(typeof s.folder === "string" ? { folder: s.folder } : {}) };
  } catch {
    return { on: false };
  }
}

export function writeConnector(s: ConnectorSettings, file = connectorFile()): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(s, null, 2) + "\n");
}

/** Why the connector cannot be used, in words, or null if it can. */
export function connectorProblem(s: ConnectorSettings): string | null {
  if (!s.on) return "OpenStage Studio's connector is off. Turn it on in OpenStage Studio, on its Connector page (or with \"Set Up Connector.bat\" in a copy built from the repository), which also names the folder an assistant may use.";
  if (!s.folder || !existsSync(s.folder) || !statSync(s.folder).isDirectory()) return "The connector's folder does not exist. Choose it again on Studio's Connector page.";
  return null;
}

/** A file in the connector's folder, by plain name only, and only if it really is inside the folder (links and
 * junctions followed). Throws, in words, otherwise. */
export function fileIn(folder: string, name: string, kinds: string[]): string {
  if (typeof name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9 _.()-]{0,120}$/.test(name) || name.includes("..")) {
    throw new Error(`"${name}" is not a plain file name in the connector's folder.`);
  }
  if (!kinds.some((k) => name.toLowerCase().endsWith(k))) throw new Error(`"${name}" must end in ${kinds.join(" or ")}.`);
  const root = realpathSync(folder);
  const path = resolve(root, name);
  if (!path.startsWith(root + sep)) throw new Error(`"${name}" is outside the connector's folder.`);
  if (existsSync(path)) {
    const real = realpathSync(path);
    if (!real.startsWith(root + sep)) throw new Error(`"${name}" leads outside the connector's folder.`);
  }
  return path;
}
