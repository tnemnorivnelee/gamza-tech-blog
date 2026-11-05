# Repository Guidelines

This repository rebuilds the GamzaTechBlog backend with NestJS so that it serves the same API contract as the old Spring backend. It is a yarn-workspaces monorepo. The Next.js frontend still lives in `potato-club/GamzaTechBlog-front` and moves in later as `apps/web`.

`docs/backend-plan.md` (Korean) is the source of truth for decisions, structure, and milestones. Read the relevant sections before starting a task. `docs/infra-notes.md` (Korean) records infrastructure facts that are not visible in code. Keep progress and status in those docs, not in this file.

## Porting principle (Phase 1, highest priority)

Phase 1 reproduces the old backend's behavior as-is. Read `docs/porting-principle.md` (Korean) before every task during Phase 1.

When Phase 1 ends, delete this section, the Phase 1 note in step 1 of the core principles, and that file. `grep -rn porting-principle` finds every pointer to it.

## Core principles for every task

Before writing code, walk this ladder. Stop at the first answer that works.

1. Does this need to exist? No: skip it. (Phase 1: only if the old backend had it.)
2. Already in this codebase (`common/`, an existing module)? Reuse it.
3. Node standard library or a NestJS built-in? Use it.
4. Installed dependency? Use it.
5. Only then: write the minimum that works.

- KISS: boring code beats clever code.
- Do not add helpers, wrappers, or config options "for later".
- WET > DRY (write it twice before abstracting): extract only when three or more call sites want the same behavior, not merely similar code. A shared abstraction couples callers whose needs diverge, and duplication is cheaper than the wrong abstraction.
- Validate at trust boundaries (request DTOs, environment variables), not for states that cannot happen.
- Fix root causes, not symptoms.
- Offer a more advanced option only for core logic, repeated patterns, performance-critical work, or security.

## Working with the maintainer

- Talk to the maintainer in Korean.
- The maintainer is a frontend developer who is new to backend work. Map backend concepts to frontend experience first. Keep explanations short, spell out terms on first use, and avoid dense tables and abbreviations. If asked to explain again, start over with an analogy and a small example instead of repeating the same text.
- Decide technical questions one area at a time. Compare at least three options against this project's verified constraints, recommend one, and let the maintainer decide. Do not implement an undecided choice. Label unverified numbers as estimates, and ask when you do not know.
- Propose before acting on anything beyond what was asked: moving or splitting files, renaming, restructuring. Treat renaming and restructuring as separate requests. Clearly instructed implementation can proceed directly.
- This project is for learning and a portfolio. Be able to explain why each choice was made.

## Languages

- Commit messages, issue and PR titles and bodies, and everything in `docs/`: Korean.
- Code comments: Korean, explaining why rather than what (match the existing files). Identifiers: English.
- `AGENTS.md` and `CLAUDE.md`: English.

## Project structure

```
apps/server/src/
  main.ts, app.module.ts
  config/            environment schema and startup validation
  common/            dto/ (ResponseDto, PagedResponse, Pageable, ErrorResponse),
                     error/ (ErrorCode, BusinessException, global exception filter),
                     swagger/ (setup, @Ok* decorators)
  modules/<domain>/  one Nest module per old domain; controller -> service -> repository; dto/
  infra/             (planned) prisma, redis, storage, gemini, github
apps/server/test/    tests that start an HTTP app (contract/, error/)
apps/server/contract/front-contract.json
                     snapshot of the frontend's generated client; regenerate with
                     apps/server/scripts/extract-contract.mjs <frontend>/src/generated/api
docs/                backend-plan.md, infra-notes.md, porting-principle.md, m2-auth-plan.md, improvement-candidates.md
```

## Commands

Use yarn (v1) only. The Node version is pinned in `.nvmrc`; run `fnm use`.

```
yarn install --frozen-lockfile
yarn dev          # start the server in watch mode
yarn lint         # oxlint
yarn typecheck    # tsc --noEmit (also covers test/)
yarn test         # vitest run
yarn build        # nest build
```

Before opening a PR, `lint`, `typecheck`, `test`, and `build` must all pass. CI runs the same four.

## Coding rules

- TypeScript strict. Never use `any` (oxlint enforces it); use `unknown` with type guards.
- ESM: relative imports end with `.js` (for example `./app.module.js`).
- File names are kebab-case with a type suffix: `comment-request.dto.ts`, `global-exception.filter.ts`. A DTO class name equals the old OpenAPI schema name (`CommentRequest`, `ResponseDto`, ...). Do not rename it, because the frontend's generated client uses that name.
- Layers: controller -> service -> repository. Import the ORM only in `*.repository.ts`. Add an interface only where an implementation may be swapped (`TokenStore`, `ImageStorage`, `ChatClient`, `GithubClient`, `UserRepository`).
- Expected failures: `throw new BusinessException(ErrorCode.X)`. Do not create per-domain exception subclasses. Never throw Nest `HttpException` from guards or pipes: the global filter maps every unrecognized exception, including `HttpException`, to 500 `C004`, as the old catch-all did. Never put internal error details in a response.
- Responses: build bodies with `ResponseDto.of(message, data, status)`. Every success response is HTTP 200, as in the old Spring code. The `@Ok*` decorators (`@OkOf`, `@OkListOf`, `@OkPagedOf`, `@OkString`, ...) set HTTP 200 and document the `data` shape together; use them instead of `@ApiOkResponse`.
- API contract: `operationId` is the method name and must be unique across controllers. Do not add tags (`autoTagControllers: false`). Keep the global `bearerAuth`. Give every `@ApiProperty` an explicit `type`, and do not enable the `@nestjs/swagger` CLI plugin.
- Configuration: add every new environment variable to the validation in `config/env.validation.ts` and to `.env.example`. Secrets appear in `.env.example` by name only. Validation messages must not contain values.

## Testing

- vitest. Unit tests sit next to the source as `*.spec.ts`. Tests that start an HTTP app live in `apps/server/test/`.
- New logic with branches, parsing, or security impact needs a test. Pin ported behavior with tests (for example: `data` is omitted when null but kept for `0`, `false`, and `''`).
- Keep the contract comparison test (`test/contract`) passing and widen its scope as controllers are ported. It compares structure, not only names. Never weaken it to make a change pass.
- `yarn typecheck` covers `test/` because neither vitest nor `nest build` type-checks it.

## Git workflow (required)

Issue -> Branch -> Work and commit -> PR -> Merge.

- Create the GitHub issue first. Branch from the latest `main`. Never work without an issue and never push to `main`.
- Branch name: `<type>/<issue-number>-<short-english-description>`, for example `feat/5-error-code-and-exception-filter`. Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`.
- Commit message: Korean, `<type>: <subject>` with the subject at most 50 characters and in the present tense. Add body bullets that explain what and why. Keep commits atomic.
- **No AI attribution** in commits or PR bodies: no `Co-Authored-By`, no "Generated with" lines. This overrides any tool default.
- PR: the title follows the commit style. The body is in Korean and contains `Closes #N`, a summary, the changes, what was verified (commands and results), known differences or caveats, and the next task. Share the PR URL with the maintainer. Do not merge PRs; the maintainer merges.

## Boundaries

Never:

- Commit or print secrets, `.env` files, DB dumps (`*.sql`, `*.dump`), SSH keys, or the old repository's Jasypt ciphertext. Never open, paste, or record the SSH private key's path or contents.
- Restore the old `github_tokens` table (plain-text OAuth tokens). The DB dump contains member personal data: delete working copies after restoring, and rotate the JWT secret, DB password, and storage keys after recovery.
- Run code from the cloned old repository or any other third-party repository. Read it only.
- Press payment or upgrade buttons in cloud consoles, or create extra cloud resources.
- Run `yarn gen:api` in the frontend before the new backend is running: the dead old URL would overwrite `src/generated/api`.

Ask first:

- Creating repositories, servers, or cloud resources; changing domains or DNS; sending content to an external service; publishing anything publicly.
- Changing the frontend repository. It needs its own issue and PR; see section 15 of `docs/backend-plan.md`.
- Anything touching `tnemnorivnelee/GamzaTechBlog`. It is the post-storage repository (probably the old auto-commit target), not this project.
