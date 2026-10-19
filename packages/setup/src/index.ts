/** Programmatic API of the `clayver` setup CLI (used by tests and tooling). */
export { runInit, type InitOptions, type InitResult } from "./commands/init.js";
export { runStatus, type StatusOptions, type StatusReport } from "./commands/status.js";
export { runUpdate, type UpdateOptions } from "./commands/update.js";
export { runRemove, applyReversal, type RemoveOptions, type RemoveResult } from "./commands/remove.js";
export { runAdmin, grantRole, revokeRole, nextClaims, type AdminBackend, type AdminOptions, type AgentRecord } from "./commands/admin.js";
export { detectApps, type DetectedApp } from "./detect/platform.js";
export { mergeDatabaseRules, removeDatabaseRules } from "./backend/database-rules.js";
export { mergeStorageRules, removeStorageRules } from "./backend/storage-rules.js";
export { planFirebaseJson, revertFirebaseJson } from "./backend/firebase-json.js";
export { parseManifest, serializeManifest, type ClayverManifest, type FileRecord } from "./core/manifest.js";
export type { Runner, CommandSpec, CommandResult } from "./core/runner.js";
export type { Prompter } from "./core/prompter.js";
export type { Deps } from "./core/context.js";
