# ZCodex

GUI desktop untuk **Codex CLI**, desainnya mengikuti **Codex Desktop**. Engine-nya bukan fork:
app ini jadi *client* yang bicara ke `codex app-server` (JSON-RPC 2.0 lewat stdio), persis
arsitektur yang dipakai Codex Desktop sendiri.

Folder `codex/` = clone source OpenAI Codex (referensi protocol/enum saja). **Jangan diedit.**

## Cara jalanin

```bash
npm install
npm run setup        # cek versi CLI Codex + generate binding protocol
npm run dev          # vite (renderer) + electron (main), hot reload UI
npm run build        # compile main/preload/packages + build renderer
npm start            # build lalu jalankan Electron dari hasil build
```

Prasyarat: **Codex CLI >= 0.154.0** (`npm i -g @openai/codex@latest`) dan sudah login
(`codex login`, tersimpan di `~/.codex/auth.json`). CLI versi lama ditolak server dengan
`requires a newer version of Codex`, dan `model/list` gagal parse cache model baru.

## Struktur

```
packages/codex-protocol   tipe protocol app-server (generated dari CLI, gitignored)
packages/codex-client     spawn codex app-server + JSON-RPC + wrapper RPC bertipe
packages/contracts        kontrak IPC + view model + reducer thread (pure, browser-safe)
apps/desktop              Electron main + preload: window, menu, IPC, project store
apps/renderer             React UI (Codex Desktop look)
scripts/                  dev / build / start / setup launcher (spawn node.exe langsung)
```

Aturan yang dipegang:

1. **UI tidak tahu protocol mentah.** Renderer cuma menerima `ThreadState` / `ItemView`
   (`packages/contracts/src/view.ts`). Terjemahan dari notifikasi app-server terjadi di
   `packages/contracts/src/reducer.ts` — satu tempat, gampang di-test.
2. **Main process tipis.** `apps/desktop/src/ipc.ts` hanya menjembatani: ubah request UI jadi RPC,
   teruskan notifikasi ke window. Tidak ada state percakapan di main.
3. **Tidak ada fork repo upstream.** Protocol bisa berubah antar rilis, karena itu binding
   di-generate dari binary yang benar-benar di-spawn (`npm run gen:protocol`), bukan dari `codex/`.
4. **Thread = unit pilihan model/project.** Agency/project tidak pernah ditukar di tengah thread;
   pindah konteks = thread baru.

## Peta protocol yang sudah dipakai

| Kebutuhan | RPC / notifikasi |
|---|---|
| Handshake | `initialize` (+`initialized`), capability `experimentalApi` |
| Akun & kuota | `account/read`, `account/rateLimits/read` |
| Model | `model/list` |
| Sidebar | `thread/list` (`sortKey: updated_at`, `cwd`, `searchTerm`), `thread/read {includeTurns}` |
| Chat | `thread/start`, `thread/resume`, `turn/start`, `turn/interrupt`, `thread/name/set`, `thread/archive` |
| Streaming | `item/started`, `item/agentMessage/delta`, `item/reasoning/*`, `item/commandExecution/outputDelta`, `item/fileChange/patchUpdated`, `item/completed`, `turn/*`, `thread/status/changed`, `thread/tokenUsage/updated`, `error`, `warning` |
| Approval (server -> client) | `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, `item/tool/requestUserInput`, `mcpServer/elicitation/request` |

**Projects itu milik client, bukan server.** `Project` = folder lokal, id-nya
`local-<md5(path)>`, disimpan di `userData/zcodex-projects.json`. Thread dipetakan ke project
lewat kecocokan `cwd` (`projectIdForCwd`) plus hint manual untuk thread yang cwd-nya di luar root.

## Desain

Token di `apps/renderer/src/styles.css` diukur langsung dari screenshot Codex Desktop
(sampling pixel, bukan kira-kira):

| Elemen | Nilai |
|---|---|
| Title bar | tinggi 35px, `#20252d`, menu File/Edit/View/Help + 2 panah nav |
| Sidebar | lebar 262px, `#20252d`, border kanan `#3c424d` |
| Content | `#292f3a` |
| Composer | baris project `#343b47` (38px), area input `#474f5b`, radius 12px, lebar maks 734px |
| Teks | `#dfe5ee` / `#a6b1c5` / `#7b8496` |
| Accent | violet `#8550e6`, pill "Rejoin Plus" = `#37384a` + teks `#c49af0` |
| Empty state | logo hexagon `#5e6775` 48px, judul 32px semibold |

Title bar digambar sendiri (`titleBarStyle: "hidden"` + `titleBarOverlay`) supaya tombol
min/max/close tetap native Windows tapi menunya punya kita. Menu asli tetap dipasang lewat
`Menu.setApplicationMenu` (accelerator jalan), tapi bar-nya disembunyikan
(`setMenuBarVisibility(false)`) biar tidak dobel dengan title bar kita.

## Yang belum ada (kandidat lanjutan)

- Panel Plugins/Skills/MCP (`plugin/*`, `skills/list`, `mcpServerStatus/list` — sudah dibungkus di `codex-client`)
- Pull requests & Scheduled (butuh integrasi GitHub / cron terpisah)
- `review/start` (code review), `thread/fork`, `thread/archive` dari UI
- Approval "auto review" (`approvalsReviewer`), permission profile (`permissionProfile/list`)
- Packaging installer (`electron-builder`) + auto-update
- Multi-window / multi-thread paralel
