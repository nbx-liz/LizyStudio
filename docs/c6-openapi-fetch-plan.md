# C-6: openapi-fetch 導入計画

**作成日**: 2026-04-21
**Related**: [docs/coupling-analysis.md §C-6](./coupling-analysis.md#c-6-url-パスが完全手書きprefix-変更追跡なし) / HISTORY.md H-0080
**Status**: ✅ shipped 2026-04-22 — Phase 1〜5 すべてマージ済（PRs #224〜#228）。**本ドキュメントはアーカイブ**（履歴参照のみ）。最新の関連バックログは [docs/ROADMAP.md](./ROADMAP.md) を参照。
**Change-gate**: 不要（FE 内部 refactor、wire format / BackendAdapter / storage 不変）

---

## 1. 背景

`frontend/src/api/{jobs,inference,workspace,files}.ts` の 46 箇所の fetch 呼び出しは、URL パス・クエリ文字列・リクエスト body 構築を手書きで行っている。

```ts
// 現状: jobs.ts
export function fetchJobImportance(jobId: string, kind = "default"): Promise<ImportanceResponse> {
  return apiFetch(
    `/jobs/${encodeURIComponent(jobId)}/importance?kind=${encodeURIComponent(kind)}`,
  );
}
```

問題点:

1. **URL パス drift が型で検出されない**。`server.py` の prefix (`/api/jobs`) を変えても TS は silent、ランタイム 404 で初めて気づく。
2. **response 型が手書き契約**。C-1/C-2/C-3/C-4/C-5 で Pydantic `response_model` と generated `schema.d.ts` は整備済みだが、**consumer 側は `apiFetch<T>(url)` の型パラメータ `T` を手で指定**しており、generated 型と consumer 側 `Promise<T>` が乖離しても検出されない。
3. **クエリ文字列の組み立てが ad-hoc**。`jobs.ts:fetchJobPlot` は `URLSearchParams`、`inference.ts:fetchInferencePlot` は `${encodeURIComponent(...)}` を手書き、`files.ts:fetchDirectory` は `?path=${encodeURIComponent(path)}` と3通り混在。
4. **backend が増えた時の追跡コストが高い**。path 命名規則の統一や deprecation を type 駆動で強制できない。

## 2. 採用する技術

### `openapi-fetch` (Drew Powers / openapi-ts)

既に採用済みの `openapi-typescript@^7.13.0` と同じエコシステム。`schema.d.ts` の `export interface paths` を型パラメータに渡すだけでフェッチ関数が得られる。

```ts
// After: jobs.ts
import createClient from "openapi-fetch";
import type { paths } from "./generated/schema";

// NOTE (Phase 1 correction, 2026-04-22): generated ``paths`` keys in
// ``schema.d.ts`` already include the ``/api`` prefix (``"/api/files"``,
// ``"/api/jobs/{job_id}/importance"`` etc.), so ``baseUrl`` must be the
// empty string — NOT ``"/api"`` — otherwise URLs double up to
// ``/api/api/...``.
const client = createClient<paths>({ baseUrl: "" });

export async function fetchJobImportance(jobId: string, kind = "default") {
  const { data, error } = await client.GET(
    "/api/jobs/{job_id}/importance",
    { params: { path: { job_id: jobId }, query: { kind } } },
  );
  if (error) throw new ApiError(500, error);
  return data;  // type inferred as components["schemas"]["ImportanceResponse"]
}
```

### なぜ `openapi-fetch` か

| 候補 | 判定 | 理由 |
|---|---|---|
| **openapi-fetch** | ✅ 採用 | `openapi-typescript` と同一作者、path/params/response を同じ `schema.d.ts` から推論。4.7 KB (min+gzip)。`fetch` ベースなので MSW とシームレス |
| openapi-typescript-fetch | ❌ | メンテ停止、`openapi-fetch` の前身 |
| Zodios / oRPC / tRPC | ❌ | FastAPI 生成 OpenAPI と連携するには middleware 必要、依存増大 |
| 手書きの builder 関数 | ❌ | C-6 の前提そのもの、型推論の恩恵が限定的 |
| ky / axios | ❌ | path 型推論なし、URL 結合は手書きのまま |

### Runtime cost

- Bundle size: +4.7 KB gzipped (既存 `apiFetch` 40行を置換、差し引き +3 KB 程度)
- Runtime: 薄い wrapper、既存 `apiFetch` と同等
- SSR / worker: fetch API 互換のみ要求、現行 Vite + Vitest + MSW 環境と問題なし

## 3. スコープと分割

全 46 call site を 1 PR で置換すると diff が大きすぎるため、**5 段階** に分割する。

### Phase 0 (this PR): plan doc のみ
- `docs/c6-openapi-fetch-plan.md` (本文書)
- HISTORY.md H-0080 entry (proposal スタイル)
- 着手合意を取る

### Phase 1: deps 追加 + client 併設 + files.ts 移行
- `pnpm add openapi-fetch` (+4.7 KB)
- `src/api/client.ts` に `apiClient` を**追加** (既存 `apiFetch` は残す)
- `files.ts` の 2 call site を `apiClient` に切り替え
- `apiClient` のユニットテスト、MSW handler の型が `paths` ベースで通ることを確認
- **理由**: 最小スコープで migration pattern を確立、rollback 可能

### Phase 2: inference.ts (10 call sites)
- 全 10 関数を `apiClient` に移行
- `fetchInferencePlot` / `fetchInferenceShapPlot` の plot_type path param の型推論を検証
- `getInferenceDownloadUrl` は URL を返す純関数なので `apiClient` 不使用 (generated `paths` の型で URL 構築に限定する helper に切り替え)

### Phase 3: workspace.ts (17 call sites)
- FormData アップロード 3 箇所 (`uploadData` / `uploadConfig` / `uploadInferenceData`) が特殊、`bodySerializer` override で対応
- `fetchConfig` / `updateConfig` の `AbortSignal` 伝播を維持

### Phase 4: jobs.ts (16 call sites)
- `fetchJobPlot` の可変クエリ (`metrics` / `kind`) が `query` パラメータに綺麗にマップされることを確認
- 最大の call site 数、同時に consumer (`src/hooks/use*.ts`) へのインパクトを測る

### Phase 5: cleanup
- `apiFetch` / `ApiError` を `apiClient` ベースで再定義し、旧 `apiFetch` を削除
- `client.ts` を 40行 → 80行程度にリライト (新 error handling + typed client 提供)
- CHANGELOG / BLUEPRINT に generated-types-first policy を明記

合計 **6 PR**（Phase 0 含む）。各 PR 独立にマージ可能、途中で中断しても既存コードは動作する。

## 4. 契約とエラー処理の方針

### 既存 ApiError の保持

```ts
// client.ts (Phase 1 併設)
import createClient, { type Middleware } from "openapi-fetch";
import type { paths } from "./generated/schema";

// See §2 correction note: baseUrl is empty because generated paths
// keys include the /api prefix.
const rawClient = createClient<paths>({ baseUrl: "" });

const errorMiddleware: Middleware = {
  async onResponse({ response }) {
    if (!response.ok) {
      const body = await response.clone().json().catch(() => null);
      throw new ApiError(response.status, body);
    }
    return response;
  },
};

rawClient.use(errorMiddleware);

export const apiClient = rawClient;
```

`ApiError` は既存 51 箇所の consumer が catch しているので**互換保持**。`openapi-fetch` のデフォルト `{ data, error }` パターンは使わず、middleware で `throw` に寄せる。consumer 側は `await apiClient.GET(...)` の `data` が non-null になる (Promise reject path のみを使う)。

### Response 型の推論

```ts
const { data } = await apiClient.GET("/jobs/{job_id}", {
  params: { path: { job_id: jobId } },
});
// data: components["schemas"]["JobDetail"] | undefined
// non-null assertion is safe after error middleware throws on !ok.
```

### Union 型のリクエスト (e.g. path variant)

`openapi-fetch` は `operationId` 単位で overload するので、consumer 側で `// @ts-expect-error` は原則不要。1 つの endpoint が union response を返す場合 (e.g. `/inference/{inf_id}/plot/{plot_type}`) は backend 側で `response_model` を union にする必要あり (C-2 で整備済み)。

## 5. テスト戦略

### 既存テスト (3064 行) の保持

- `api-contract.test.ts` (478行): 既存は `apiFetch` の契約テスト。Phase 5 で `apiClient` 版に書き換える。途中の Phase では **両方の client が同じ MSW handler に対して動く**ことで contract parity を担保。
- `jobs.test.ts` / `inference.test.ts` / `workspace.test.ts` / `files.test.ts`: Phase ごとに assertion を更新、`expect(fetchJobs()).resolves.toEqual(...)` の shape は不変。

### 新規追加

- Phase 1 で `client.test.ts` に `apiClient` 専用テストを追加
  - `ApiError` が status/body 正しく throw される
  - `signal: AbortSignal` 伝播
  - 成功パスで `data` が schema 型どおり

### MSW handler の typing

`handlers.ts` は現状 39 行と小さい。**既存 handler は `http.get("/api/...")` で OK**（MSW は path を string で受けるため）。ただし response shape の型付けを `components["schemas"]["JobDetail"]` に揃えると drift を防げる。これは Phase 5 の cleanup で一括対応。

## 6. 破綻リスクと緩和

| リスク | 緩和策 |
|---|---|
| generated `schema.d.ts` が out-of-date だと全 Phase でビルド失敗 | 既存 `api-types-drift` CI job (C-1) が PR ブロックするため、迷惑がかかる前に検出 |
| middleware throw のパターンが openapi-fetch 内部実装と相性悪い | Phase 1 で unit test で担保、問題あれば `{ data, error }` の on-site 分岐に revert (差分小) |
| File upload が特殊 (multipart) | `bodySerializer` override で `FormData` を pass-through、Phase 3 で検証 |
| 既存 `apiFetch` 51 consumer を 6 PR で移行中に mixed state | 各 Phase で `apiFetch` も `apiClient` も並行して稼働、どちらも同じ `ApiError` を throw |
| Phase 5 で削除する `apiFetch` に残り consumer が見つかる | `grep -rn 'apiFetch' src/` を CI の最終 gate に加える (Phase 5 PR で script 追加) |

## 7. Acceptance criteria (全 Phase 完了時)

- (a) `grep -rn 'apiFetch(' frontend/src/` が 0 件、`client.ts` にも `apiFetch` export が残っていない。
- (b) `grep -rn '\`/[a-z]' frontend/src/api/*.ts` がゼロ (URL の直書きが消えた)。
- (c) `generated/schema.d.ts` の `paths` interface キーと実際の fetch 呼び出し endpoint が 1:1 対応。
- (d) `pnpm check` / `tsc --noEmit` / `pnpm build` / `pnpm vitest run` / `pnpm test:e2e` 全 clean。
- (e) Bundle size の増加が gzip で +5 KB 以内。
- (f) CI 既存 gate (`api-types-drift`, `raw-color-guard`, `e2e-chromium`) すべて green。

## 8. 非目標 (Out of scope)

- **WebSocket client の置換**: `src/api/websocket.ts` (101行) は OpenAPI には乗らないので openapi-fetch スコープ外。C-3 で Pydantic discriminated union 化済み。
- **React Query との統合層の書き換え**: `src/api/queries/*.ts` と `src/hooks/*.ts` の fetcher を call する部分は同じ signature を維持。query hooks は変更不要。
- **Backend OpenAPI の書き換え**: `response_model` は C-2 で整備済み、本計画では現状スキーマを消費するだけ。
- **非 API fetch (static assets, websocket)**: 対象外。
