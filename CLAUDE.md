# ZCodex - Daily Coding Harness
Harness coding harian pribadi (bukan "codex ber-GUI"). Pakai banyak subscription: codex/chatgpt, claude, opencode.ai, commandcode.ai. Bahasa: Inggris.

## Fokus
Ini harness milikku, bukan milik OpenAI. Codex hanya SATU engine. Subscription vendor terkunci ke CLI-nya; SPAWN engine itu, jangan maksa.

## Arsitektur
engine codex (Rust, tak disentuh) + GUI React+TS (generate-ts) + connectors (spawn engine, map ke event netral). UI tak boleh tahu soal codex/claude/opencode. Engine baru = 1 connector.

## Event netral
text.delta | tool.call | approval.request(exec/apply_patch/user_input) | diff | turn.end | error

## Engine (non-TUI)
- codex: `codex app-server --listen stdio://`
- claude: `claude -p --output-format stream-json`
- opencode: `opencode serve` / acp
- gemini: `gemini -p -o stream-json`
Codex cuma wire_api=responses; lain butuh proxy.

## Pekerjaan
- init git + Rust+MSVC + cargo build + generate-ts + probe RPC
- GUI render event codex
- connector claude
- connector opencode.ai
- connector commandcode.ai
- thread list, diff viewer, approval
- fan-out/compare antar engine