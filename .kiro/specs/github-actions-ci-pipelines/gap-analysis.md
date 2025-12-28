# Gap Analysis: github-actions-ci-pipelines

## 1. Current State Investigation

### Codebase Structure & Conventions
- **Stack**: Bun (>=1.2.19), TypeScript, Hono.
- **Project Root**: Contains `package.json`, `bun.lock`, `tsconfig.json`.
- **Existing Scripts**:
  - `test`: `bun test` (Matches Req 2.1)
  - `build`: `bun build src/main.ts --outdir dist` (Matches Req 2.2)
- **Missing Scripts**:
  - Type checking script is missing (though `tsc` and `tsconfig.json` exist).
  - Linting script is missing.
- **Tooling Gaps**:
  - **Linter**: No linter (ESLint or Biome) is currently installed or configured in `package.json`.
- **CI/CD**:
  - No `.github/workflows` directory exists.

### Integration Surfaces
- **GitHub Actions**: Will integrate via `.github/workflows/ci.yml`.
- **Bun**: Used for runtime and package management.

## 2. Requirements Feasibility Analysis

| ID | Requirement | Status | Gap / Notes |
|----|-------------|--------|-------------|
| 1.1 | PR Trigger | ✅ Feasible | Standard GH Actions `on: pull_request`. |
| 1.2 | Push Trigger | ✅ Feasible | Standard GH Actions `on: push`. |
| 2.1 | Unit Tests | ✅ Ready | `npm run test` (wraps `bun test`) exists. |
| 2.2 | Build | ✅ Ready | `npm run build` exists. |
| 2.3 | Type Check | ⚠️ Minor Gap | `tsconfig.json` is strict, but no `npm run check-types` script exists. |
| 2.4 | Linting | ❌ **Missing** | No linter installed. Requirement mandates lint execution. |
| 3.1 | Bun Environment | ✅ Feasible | Use `oven-sh/setup-bun` with version from `package.json`. |
| 3.2 | Lockfile | ✅ Feasible | `bun install --frozen-lockfile`. |
| 5.1 | Cancellation | ✅ Feasible | Use `concurrency` with `cancel-in-progress: true`. |
| 6.1 | min permissions | ✅ Feasible | Configure `permissions: contents: read`. |

## 3. Implementation Approach Options

### Option A: Complete Setup with Biome (Recommended)
Adopt [Biome](https://biomejs.dev/) for linting and formatting. It aligns with the "Bun-First" high-performance philosophy and replaces both Prettier and ESLint with single fast tool.

- **Changes**:
  - Install `biome` as devDependency.
  - Create `biome.json` config.
  - Add scripts: `"lint": "biome check src tests"`, `"check-types": "tsc --noEmit"`.
  - Create `.github/workflows/ci.yml`.

- **Trade-offs**:
  - ✅ Fast execution (perfect for CI).
  - ✅ Simple configuration.
  - ❌ Deviates slightly from `tech.md` mentioning "Prettier" explicitly (though Biome is compatible).

### Option B: Standard ESLint + Prettier
Stick to the traditional stack mentioned in `tech.md`.

- **Changes**:
  - Install `eslint`, `prettier`, `typescript-eslint`, etc.
  - Create `.eslintrc` and `.prettierrc`.
  - Add scripts: `"lint": "eslint src tests"`, `"format": "prettier --check ."` , `"check-types": "tsc --noEmit"`.
  - Create `.github/workflows/ci.yml`.

- **Trade-offs**:
  - ✅ Exact alignment with "Prettier" mention in specs.
  - ❌ Slower than Biome.
  - ❌ More complex dependency tree.

### Recommendation
**Proceed with Option A (Biome)** or **Option B** depending on strict adherence to "Prettier" vs "High Performance". Given the project uses Bun, Biome is a natural fit. **However**, without explicit deviation approval, Option B is safer if `tech.md` is treated as law. **BUT**, `tech.md` also says "Prettier (or standard JS formatting)", which leaves room.
*Self-correction*: Since `tech.md` lists "Prettier" under "Standards", checking if user prefers Biome would be an "Implementation Detail" in the design phase. For now, we identify the **Need for a Linter** as the key gap.

## 4. Effort & Risk

- **Effort**: **S (1-3 days)**
  - Setting up CI and adding basic scripts is straightforward.
- **Risk**: **Low**
  - Standard CI setup. Main risk is deciding on the linter and ensuring it doesn't flag too much existing code (though codebase seems small).

## 5. Next Steps for Design Phase
1. **Select Linter**: Decide between Biome and ESLint.
2. **Define Workflow**: specific steps for `ci.yml`.
3. **Script Additions**: Define exact `scripts` to add to `package.json`.
