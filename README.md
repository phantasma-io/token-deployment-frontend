# Token Deployment Frontend

Frontend workspace for deploying and inspecting Carbon tokens on Phantasma.  
Built with **Next.js (App Router)** and **@phantasma/connect-react** so dApps can connect to Phantasma Link, assemble Carbon create-token transactions, and broadcast them end‑to‑end without a backend.

## Stack Overview

| Area                | Choice                                  | Notes |
|---------------------|------------------------------------------|-------|
| Framework           | Next.js 15 (App Router, TypeScript)      | Turbopack dev/build; deployment is SSR-friendly. |
| UI Toolkit          | Tailwind utility classes + custom cards  | Minimal, no CSS-in-JS. |
| Wallet Integration  | `@phantasma/connect-react`               | Provides `PhaConnectState`, `PhaAccountWidgetV1`, and Link/socket handling. |
| Phantasma SDK       | `phantasma-sdk-ts` (local `file:` dependency) | We copy the SDK into `node_modules/phantasma-sdk-ts` so the frontend uses the latest Carbon helpers. |
| Toasts/Alerts       | `sonner`                                 | Non-blocking notification stack. |

## Project Layout

```
src/
  app/
    deploy/page.tsx     // main deployment UI
  components/
    DebugLogger.tsx     // structured log viewer with copy/reset
    PhantasmaProvider.tsx // wraps app with PhaConnectState
  lib/
    phantasmaClient.ts  // RPC + Link integration (tokens + create flow)
```

### Key Components

- **Deploy page (`deploy/page.tsx`)**
  - Connects to the wallet with `PhaAccountWidgetV1`.
  - Displays paginated list of currently owned tokens with expandable detail view.
  - Provides full create-token form (symbol, decimals, metadata, fee parameters).
  - Shows transaction confirmation status (pending → success/failure) with copyable hash.
  - Includes structured debug log viewer at the bottom for troubleshooting.

- **`phantasmaClient.ts`**
  - Wraps `phantasma-sdk-ts` Carbon helpers for frontend use.
  - Builds metadata using `TokenMetadataBuilder`, applies `CreateTokenFeeOptions`.
  - Sends the Carbon transaction via Link (`signCarbonTransaction`), waits for on-chain confirmation by polling `getTransaction`.
  - Returns rich result object with `tokenId` / failure diagnostics.
  - Exposes `getTokens(owner)` to fetch token inventory for the current wallet address.

## Prerequisites

1. **Node.js 18+** (ES2022 features + `BigInt` usage).

2. **Phantasma Link (v4+) wallet**  
   Required for `signCarbonTransaction` capability.

## Getting Started

```bash
npm install
npm run dev        # starts Next dev server with Turbopack
```

Environment variables (`.env.local`):

```env
NEXT_PUBLIC_API_URL=http://localhost:5172/rpc
NEXT_PUBLIC_PHANTASMA_NEXUS=testnet
```

## Deployment Flow (UI)

1. **Connect wallet** via top-right `PhaAccountWidgetV1`.
2. **Review existing tokens**:
   - List is paginated (10 entries per page).
   - Click chevron on a token to inspect metadata and raw JSON.
   - Refresh button refetches complete list from RPC.
3. **configure new token**:
   - Type toggle (fungible vs NFT). NFT forces decimals to 0.
   - Symbol (uppercase enforced), optional name, max supply.
   - Metadata tools: upload logo (Data URI) and add arbitrary key/value entries.
   - Fees & limits: editable gas parameters with sane defaults (matches current Carbon expected values).
4. **Deploy**:
   - Submits Carbon create token request via Link.
   - UI shows `pending` status until RPC confirms success/failure (polling with `getTransaction`).
   - On success, hash + optional tokenId are shown with a copy button; tokens list auto-refreshes and new token detail is expanded.
   - On failure, the failure reason from RPC (`debugComment` or `result`) is surfaced.

Debug logs capture each step (fee parsing, metadata payload, RPC responses) for easier troubleshooting.

## phantasmaClient specifics

- **Wait for confirmation**: `waitForTransactionConfirmation` polls `getTransaction` up to 30 times (1s interval), returning:
  - `success` with `tx` data,
  - `failure` with debug message,
  - or `timeout`. UI renders the result accordingly.
- **Public key derivation**: addresses are decoded via `Address.FromText(...).GetPublicKey()`.

## Debugging Tips

- **Link endpoint mismatch**: Ensure Phantasma Link is updated to a Carbon-capable release (v4+). The official `@phantasma/connect-react` handles messaging; inspect the browser console if Link reports errors.
- **Metadata issues**: Structured form builds metadata JSON automatically. Inspect compiled metadata payload in debug logs before submission.
- **RPC confirmation**: When transactions seem “stuck”, check Link console output and `Debug Logs`. The confirmation loop stops at 30 seconds; failures include `debugComment` if available.

## Scripts

| Command             | Description |
|---------------------|-------------|
| `npm run dev`       | Start Next.js dev server (Turbopack). |
| `npm run build`     | Production build. |
| `npm run start`     | Serve production build. |
| `npm run lint`      | ESLint (ignores structured logs but enforces TS rules for repo sources). |

## Roadmap

- Integrate token-series creation & NFT minting.
