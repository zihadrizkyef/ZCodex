/**
 * Public type surface of the Codex app-server protocol.
 *
 * `src/generated/` is produced by `npm run gen:protocol` from the installed Codex CLI and is
 * intentionally not committed — regenerate it whenever the CLI is upgraded, otherwise these
 * types drift from the binary the app spawns.
 */
export type {
  ApplyPatchApprovalParams,
  ApplyPatchApprovalResponse,
  ClientInfo,
  ClientNotification,
  ClientRequest,
  ExecCommandApprovalParams,
  ExecCommandApprovalResponse,
  FuzzyFileSearchParams,
  FuzzyFileSearchResponse,
  FuzzyFileSearchResult,
  GetAuthStatusParams,
  GetAuthStatusResponse,
  InitializeCapabilities,
  InitializeParams,
  InitializeResponse,
  Personality,
  ReasoningEffort,
  ReasoningSummary,
  RequestId,
  ServerNotification,
  ServerNotificationEnvelope,
  ServerRequest,
  SessionSource,
  ThreadId,
} from "./generated/index";

export type * from "./generated/v2/index";
