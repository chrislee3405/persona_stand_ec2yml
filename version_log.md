
---
# version 0.7.3

## Frontend

- buffered chat messages stay recoverable when leaving the chatroom or refreshing
    - queued bubbles show "Waiting to send" until the request is dispatched
    - leaving before dispatch marks the buffered messages "Not sent"; refresh recovers stored queued messages the same way
    - "Edit and resend" restores the message to the composer and focuses it for review before sending
- fragment batching respects the backend's 750-character limit
    - checks combined text using Unicode code points
    - flushes the valid batch before a new fragment would exceed the limit, then starts another batch
    - reaching the pending-message cap preserves the draft and the existing batch
- 5 new regression cases, 77 frontend tests total
    - navigation recovery, stored queued-message recovery, oversized batching, exact boundary and pending-cap behavior

## Backend

- session work coordinated through PostgreSQL advisory locks
    - chat publication, rejected-message cleanup and invitation rotation share the same session lock across workers
    - a concurrent rejected request cannot retag the question an active turn is answering
    - invitation verification waits for an active turn before transferring ownership and consent
    - separate bounded coordination pool; contended lock attempts release their connection before retrying
    - cancellation or connection loss releases the transaction-scoped lock
- consent checked again after a queued request acquires the session lock
    - expired cached policy rows reload asynchronously after rollback, including on continue requests
- reply publication is one transaction
    - ownership and ordering rechecked under the conversation row lock
    - reply insertion, fallback-message retagging and handled-cursor advancement commit together
    - a failed publication rolls back the whole outcome; success is returned only after commit
    - repeated publication of the same evaluated group returns superseded without another reply
    - wait preserves the pending cursor; no_reply consumes the evaluated group
- handled cursor cannot move backwards through stale ORM state
    - atomic SQL GREATEST update, with locked conversation reads refreshing retained objects
    - rejected held-group retagging and cursor advancement also commit together
- final reply splitting cannot change approved wording
    - joined bubbles must match the approved response after whitespace normalization
    - added, omitted, duplicated or reordered words fall back to the original single reply
- exception logging excludes private exception content
    - retain exception type and stack function / line locations, omit raw values, chains, SQL parameters and source text
    - applies before log handlers, including handlers registered later
    - database engines hide parameters; failure review rows keep an incident ID and exception type instead of raw provider / database errors
    - CHAT_TRACE remains the explicit switch for content tracing; source settings do not establish live configuration

## Database

- required schema checked at startup and through GET /api/health/ready
    - an existing conversation table without the required non-null last_handled_index fails startup with migration instructions
    - unreadable or incompatible required schema returns 503 instead of reporting readiness
    - fresh databases still create the current schema at startup
- no new migration or historical cursor reset in this update
    - the accepted risk for legacy conversations already left at last_handled_index = -1 is unchanged
    - existing databases still need the applicable media / cursor migrations before starting the new backend

## Infrastructure

- private seed JSON, exports, backups and audit output excluded from backend image inputs
    - public consent_policy.json remains distributable
    - explicit runtime COPY paths replace copying the whole repository
    - export utility retained; approved private seed JSON is supplied through individual read-only mounts for operator loading
    - previously built images are not retroactively repaired
- backend Docker healthcheck uses /api/health/ready instead of /docs
- migration and deployment guidance updated
    - stop the old backend before applicable migrations and cursor backfill
    - require schema readiness plus new guest / invite conversation checks after deployment
    - keep the accepted off-hours deployment plan and legacy cursor behavior
- 2 new Chromium journeys: navigate away during the send hold and recover; deliver fragments exceeding the combined limit as separate valid requests

## Verification

- all 10 High / Medium findings from the September working-tree audit addressed in source
- 148 backend tests, 77 frontend tests and 8 Chromium browser tests passed
- frontend lint, TypeScript checks and production build passed
- infrastructure: 15 Node tests and 8 Python deployment tests passed; backend and frontend publication scripts each passed 3 tests
- exception failure-path canaries checked; successful browser canary reached the disposable database and stayed out of backend logs
- local verification used fictional data, disposable PostgreSQL and fake AI; no production database or live AI calls
- Docker Desktop startup failure prevented a fresh image build / inspection and the exact Compose / nginx browser run
    - browser checks used the built frontend with a loopback preview proxy and the real API test entrypoint
    - image contents, container behavior and intended live configuration still require release verification
- Low findings on consent wording / version drift and ambiguous delivery labels remain outside this remediation
- detailed evidence: audit/persona-stand-high-medium-remediation-2026-09-24.md in the workspace

---
# version 0.7.2

## Frontend

- bug fix
    - chatbot tutorial bubble misplaced above the owner name on narrow screens (< 430px)
        - About-section chat icon hidden below 430px, floating bottom-right chat button shown from the start instead
    - Journey pop-up stayed open and blocked the screen after clicking "See my projects"
        - in-site links in the Journey pop-up now close it first, then jump to the linked section
- chat turn handles a reply-less response
    - reads the turn status from the backend: respond / wait / no_reply / superseded
    - only the new message is sent, held text is never resubmitted
    - waiting or ignored turns show nothing and leave the message bubble unmarked
    - existing fragment batching, request timeout, cancellation and error fallbacks unchanged
- a quiet visitor is never left without an answer
    - after wait, 12s of an empty, untouched input answers the held message as it stands (continue request, no text resent)
    - after no_reply, 10s of quiet shows "Seen. <name> didn't think that one needed a reply. Ask another question anytime."
    - every keystroke restarts the quiet period, a send or leaving the chat cancels it, text left in the box means no continue
    - a refused or failed continue leaves the held bubble as it is; the server answers it with the next message
    - WAIT_CONTINUE_IDLE_MS / NO_REPLY_NOTICE_IDLE_MS in lib/knobs.ts
    - 10 new test cases, 72 total
- chatroom header icon served from S3
    - read from the site_media ("chatroom", "chatroom-icon") slot, swappable without a frontend redeploy
    - no row or a broken image falls back to the monogram, blank while site content loads
- optional playback bar on project demo videos
    - site_project video field playback_bar ("true" / true) shows the browser's playback bar, absent means hidden
    - play / pause button stops above the bar so the seek bar stays clickable
    - pausing from the bar is respected like the play / pause button, scrolling back does not restart the clip
    - clips with a bar are reachable by keyboard and screen reader
    - 4 new test cases, 62 total

## Backend

- response readiness gate before reply generation
    - one structured check per turn returns respond, wait or no_reply
    - wait holds the messages and answers them together with the next one
    - no_reply marks them handled without generating a reply
    - grounding, generation, verification and turn splitting run only on respond
    - a failed or malformed check replies anyway, so a broken gate is never silence
- conversation-level pending message tracking
    - pending messages are the user rows above the conversation cursor
    - a reply answers the whole pending group, which is excluded from prompt history
    - cursor advances only through the messages a run actually evaluated, and only forwards
    - failed and timed-out turns stay out of the pending group
- POST /api/guestchat/continue and /api/invitechat/continue answer the held messages without a new one
    - body is conversationId only; the held rows are read from the database
    - skips the readiness check (it would say wait again), the length / privacy gates (no new text) and the daily quota (each held message already paid)
    - keeps consent, ownership (missing or foreign id -> 404), the in-flight cap, the turn lock and deadline
    - nothing held -> no_reply with no model call, so repeating it costs nothing
    - a refused continue leaves the group pending; a failed generation releases it like any failed turn
- stale run protection
    - each run is tied to the newest message it evaluated
    - a reply overtaken by newer input is discarded instead of published, and the group is answered by the newer turn
- readiness, topic selection and example reranking now run concurrently
    - database reads stay sequential on the shared session, before and after the concurrent phase
    - the added check costs a model call but not a round trip
- per-stage latency and token usage recorded and logged once per turn
    - measured against fakes at 700ms per model call: replied turn +0.4% latency and +11% tokens, held or ignored turn 72% faster and 72% fewer tokens
- AI answers greetings and small talk instead of declining
    - grounding adds a conversational question type for greetings, thanks and social turns
    - such turns are answered from personality with no fact list and never decline
    - scenario and behavioural questions unchanged, no new room to state unverified facts
- test coverage for pending message handling, concurrency, stale results and readiness failure
- continue coverage: held group answered, nothing held, foreign / missing conversation, refused and failed continues, invite verification, invalid bodies
- migration test for last_handled_index: existing conversations backfilled, reruns never move a live cursor
- content validator accepts playback_bar on site_project videos (true / false / "true" / "false"), other values rejected at seed time
- seed loader ignores whole-line // comments in seed JSON files

## Database

- conversation gains last_handled_index, the readiness cursor
    - fresh databases create it automatically, existing databases run the backend migration once
    - existing conversations are backfilled to their last message, so no earlier message is read again as pending
    - run the migration with the old backend stopped, right before starting the new one
- site_media: new chatroom-icon row (chatroom section)
- site_project: persona-stand pipeline videos 1 and 2 show the playback bar

## Infrastructure

- HTTPS with Let's Encrypt, terminated in the frontend container's nginx
    - frontend image picks its mode at start: plain HTTP by default, HTTPS on 8443 when TLS_DOMAIN is set
    - HTTPS mode: 8080 only redirects to https://TLS_DOMAIN, serves certbot challenges and /healthz
    - TLS 1.2 / 1.3, HTTP/2, HSTS from HSTS_MAX_AGE (default 300s; raise to a year once stable), never sent over HTTP
    - refuses to start with TLS_DOMAIN set and no certificate, a non-hostname TLS_DOMAIN, or a non-numeric HSTS_MAX_AGE
    - the HTTPS config is rendered and nginx -t checked against a throwaway certificate at image build
    - nginx.conf is now the shared site body; nginx/ holds common.conf, http.conf, https.conf.template and select-mode.sh
    - healthcheck moved to /healthz, which does not redirect
- ops/certbot-deploy-hook.sh copies the certificate for the container (uid 101, key 0600) and reloads nginx on every renewal
- docker-compose.ec2.yml publishes 443:8443 and mounts ./certs and ./certbot-www read-only
- ENV split into LOG_LEVEL and SESSION_COOKIE_SECURE
    - production compose sets LOG_LEVEL=INFO now, so prompts are no longer logged, independent of TLS
    - SESSION_COOKIE_SECURE stays false until HTTPS works, then true in .env
    - unset, both follow ENV as before; an unrecognised value stops the backend at startup
    - 11 new backend test cases
- conversation content kept out of the logs, three layers deep
    - backend: prompts, replies, and model-written notes about a message (readiness reason, grounding missing/facts, response-gate quotes, malformed model output) moved to one app.chat_trace logger
    - that logger is silent unless CHAT_TRACE=true, even at DEBUG; the INFO / WARNING lines keep the decision, counts and categories without the text
    - the backend warns at startup when CHAT_TRACE is on
    - deploy_release.py renders the real compose config (.env included) and refuses LOG_LEVEL below INFO or CHAT_TRACE on, before pulling anything
    - combined browser tests: the backend runs with the logging read from docker-compose.ec2.yml; a chat message with a random canary word goes through the real UI and pipeline; the run fails unless the canary is in the database and in no container log
    - checked in both directions locally: passes as committed, and detects the leak with CHAT_TRACE forced on
    - 6 new backend, 5 new release-tooling (node) and 4 new deployment (python) test cases; 1 new browser test
- combined browser test for model failure expects "✕ Not sent" (frontend 0.7.2 merged "Not answered" into it)
- Part A "HTTPS with Let's Encrypt": buying a domain in Route 53, Elastic IP, DNS for Route 53 or another registrar, port 443, certbot issue / switch / Secure cookie / renewal check / HSTS ramp
- Part C: .env lines, troubleshooting for certificate, redirect and Secure-cookie problems

---
# version 0.7.1

## Frontend

- independent automated tests with Vitest, React Testing Library and jsdom
    - 37 cases, controlled API responses, no backend or cloud credentials needed
    - consent agreement / withdrawal, unavailable terms and changed policy
    - session initialisation, invite verification and revoked-invite guest fallback
    - rapid message grouping, queued conversationId reuse and recovery after a failed request
    - rejected / withheld message status, chat persistence and corrupt / unavailable storage
    - site content loading, empty / error states and retry
- npm test / test:watch / test:ci added, CI writes a JUnit report
- test configuration included in TypeScript checks, test files and reports excluded from the Docker build context
- Docker build Node 20 -> Node 22, matches the CI and test dependency requirements

## Backend

- pytest unit and API integration tests
    - 51 cases, real FastAPI, PostgreSQL and Presidio, only Gemini replaced with predictable test replies
    - consent enforcement / withdrawal / policy changes, conversation ownership and invite verification / revocation
    - message length / privacy gates, daily limits and pending-slot cleanup
    - generation deadlines, failed-turn history exclusion and recovery on the next message
    - ordered conversation storage, content revision selection and validation
- Gemini client created lazily on the first real model call
    - importing the application no longer needs Google credentials, the production client is still reused
    - tests reject attempts to create a real Gemini client
- fictional seed data and a test-only browser-test entrypoint
    - mounts into the selected backend image, runs the real API with fake Gemini
    - tests and the entrypoint excluded from production images, no production fake-model flag
- requirements-dev.txt / pytest.ini added, CI saves a JUnit report

## Database

- tests use a separate disposable PostgreSQL database named persona_test
    - reset guard checks the database name and allowed local / test-container host before clearing data
    - test bootstrap ignores the normal DATABASE_URL and local .env
    - each API integration test resets and reloads fictional content, no owner seed data used
- combined browser tests start their own unexposed database in temporary memory
    - each run owns a separate Compose project, containers and temporary data cleaned up afterwards

## Infrastructure

- frontend and backend workflows test every branch push and pull request
    - frontend lint / tests / TypeScript / build, backend unit and PostgreSQL API tests
    - every passing branch push publishes a commit-specific GHCR image, including dev
    - PR events test only, existing commit images reused on reruns instead of rebuilding
    - image.json records immutable digest, full source SHA, repository and publication run
- combined browser tests owned by persona_stand_ec2yml
    - release-versions.json selects independent frontend / backend GHCR digests and full commit SHAs
    - source / revision labels verified, backend test support checked out at the matching commit
    - one workflow for minor and major updates; repositories can be pushed in either order
    - 5 Playwright Chromium journeys through real nginx / React / FastAPI / PostgreSQL
    - portfolio navigation, consent, guest / invite chat, privacy rejection and model-failure recovery
    - temporary database, fake Gemini and blocked external media; no running EC2 or ECR needed
    - result records pair, source SHAs, coordinator commit, GitHub run ID / attempt, reports and logs
- major release promotion separated from testing
    - minor updates remain in GHCR; no automatic ECR publishing from application branches
    - manual approval selects a successful combined-test run from protected ec2yml main
    - checks exact workflow / run attempt / receipt before obtaining AWS credentials
    - skopeo copies the tested GHCR manifests and layers into ECR without rebuilding
    - verifies unchanged digests, saves promotion.json and ECR release-images.env
    - immutable ECR release tags, restricted production-environment IAM role and optional environment reviewers
- production deployment uses only promoted ECR digests
    - deploy_release.py validates source / GHCR / test / ECR evidence, starts the selected pair
    - verifies running container image references, saves deployment-records with the full release chain
    - production Compose constructs ECR-only references; rollback uses a previous promotion receipt
    - no automatic EC2 deployment from build, test or promotion workflows
- permissions and documentation
    - GHCR packages-write for publishers, packages-read for combined tests / promotion
    - old combined-test ECR role removed from workflows, BACKEND_READ_TOKEN retained for private source
    - IAM copy policy / trust templates, Part_A first-time infrastructure setup; recurring test / promotion steps in Part_C
    - Part_C promotion / deployment / rollback steps, TESTING guides and README architecture updated
    - file execution sequence and coordinated API-change example, settings lookup with each value source / destination
    - local development builds distinguished from immutable CI release candidates
    - Part_A / Part_C name the buttons, fields and confirmation controls for setup, promotion and artifact download
    - browser actions separated from local / EC2 terminal commands, release file transfer included
    - Part_B local checks, Part_C shared minor / major test sequence and explicit minor-update stopping point
    - GHCR migration cleanup removed from owner-facing guides; selection file versus generated result explained
- release validation and promotion tests cover immutable selections, trusted evidence, failed / substituted receipts, digest-preserving copy and retry / tag-conflict handling
    - 25 checks passed locally for this update: release / promotion 10, deployment validation 4, publisher safeguards 6, browser journeys 5
    - browser checks reused existing local images; cloud GHCR / ECR publication and EC2 deployment still require the documented account setup

---
# version 0.7.0

## All update from 0.6.1 to 0.6.4

---
# version 0.6.4

## Frontend

- chatroom initialisation moved to GET /api/chatroom_initialize
    - one call returns the consent terms and whether the session is verified
    - a second tab of a verified session keeps invite tier, it used to be sent as guest
    - verified is its own flag in ChatContext, no longer derived from the stored code
- "Disagree with consent" under the chatroom
    - withdraws consent on the server, the consent card comes back until agreed again
    - local state flips only after the server confirms, a failure says why
- conversation reference shown under the chatroom, quoted when asking the owner to delete a conversation
- welcome notice explains the chat is an AI version of Chris, replaces "System connected."
- user message bubble light blue -> brand orange tint (--brand-accent-line)
- wrapped message bubbles shrink to their longest line
    - a two-line bubble used to stretch to max-width with an empty strip beside the text
    - bubble white-space pre-wrap -> pre-line, the space at a wrap is no longer measured
- education in About shown as cards, same as Certification & Award
    - "Education Qualification" heading removed, the list keeps an aria-label
    - bullet list variant of CredentialList removed
- safeHref rejects /\evil.com and a leading backslash, browsers resolved them off-site
- assetUrl rejects keys with quotes, brackets, backslash, whitespace or control characters before they reach a CSS url()
- navbar Cmd / Ctrl / Shift / middle click opens a new tab again
- small fixes
    - duplicate React keys on skill pills
    - cleared conversationId removed from sessionStorage instead of kept
    - stored chat history capped at 200 messages
    - turning on reduced motion mid-visit now stops the section reveal
    - hold timer reads verification from a ref, a turn held while verifying no longer goes to guestchat
    - focus returns to the opener when the consent dialog unmounts
    - drag-scroll listeners attached only during a drag
    - chat and active-section context values memoised
- dead code removed: CERT_HERO_DEFAULTS, scrimStart / scrimEnd and colour types, void activeIndex
- npm run dev proxies /api to :8000, the dev server no longer 404s every API call
- package.json version 0.0.0 -> 0.6.4, .env.example added

## Backend

- invite code no longer readable in the session cookie
    - cookie holds the code's database id, POST /api/code no longer echoes the code
    - deleting a code row revokes it, the session's next invite message gets 401 and falls back to guest
    - sessions holding the old key verify once more
- consent withdrawal
    - POST /api/consent/withdraw stamps withdrawn_at, the record is kept as proof
    - agreeing again inserts a new row, chat returns 403 until then
- GET /api/consent replaced by GET /api/chatroom_initialize (chatroom_router.py), 503 keeps the same body shape
- BM25 with fewer than 3 question_bank rows no longer scores every candidate 0
    - flat IDF floor when no term has a positive IDF, with a warning
- content services read the highest id as the current version, created_at is metadata only
- naming
    - model_collarborate -> model_collaborate (package and service)
    - Sender.NOT_SAVED_USER -> UNANSWERED_USER, stored value "not_saved_user" unchanged
    - ablation_test.py / naturalness_test.py -> probe_*.py so pytest will not collect them
- dead code removed: unused ORM relationships, unused min_score parameter
- stale comments corrected
    - gemini per-call timeout vs TURN_DEADLINE_SECONDS
    - rate limiter pacing applies to concurrent messages only
    - CORS note now covers the vite dev proxy
- app/dependencies/__init__.py and .env.example added

## Database

- consent_record.withdrawn_at
    - unique (session_id, policy_version) constraint replaced by a partial unique index over active records
- site_content / site_media / site_journey / site_project indexes (key, created_at) -> (key, id DESC)
- personality_reference column cluture_background -> culture_background
- index=True dropped from 12 primary keys, it created a duplicate ix_<table>_id next to the primary key index
- message.selected_scenario / selected_document documented as owner review metadata
- seed: 2026-current journey detail rewritten for the current status and side project
- existing databases need one-off DDL for all of the above, see Part_C steps 6-9

## Infrastructure

- nginx
    - per-IP rate limit on /api/ (10 r/s, burst 20), 429 past it
    - client_max_body_size 32k on /api/, server_tokens off
    - CSP connect-src includes the CDN, the project media prefetch was blocked since 0.6.2
    - hidden file deny moved before the asset rule, ACME challenge path allowed for future TLS
    - long-cache extensions add webp, avif, mp4, webm, map, mjs
    - resolver and upstream keepalive limits documented
- update Part_C with one-off steps 5-9 and rollback notes
    - deploy both images together, withdrawn_at + partial index, column rename right before up -d, index swap, duplicate primary key index drop
- Part_A ECR tag immutability excludes main / trial, not latest
- Part_B and README repo name persona_stand_frontend -> persona_stand_front
- Part_D CDN setup uses the VITE_CDN_BASE variable, skills "colour" key marked ignored
- backend README: conversation deletion steps, highest-id content query

---
# version 0.6.3

## Frontend

- project thumbnail tech chips show at most 8 named chips then "+N"
    - replaces the measured two-row trim, which fought its own ResizeObserver and re-rendered forever
- chat request has a 150s AbortSignal
    - a stalled socket used to leave the pending count, typing bubble and send queue wedged for the tab
- consent card handles the unavailable state properly
    - res.ok checked before parsing, so a 5xx no longer reads as "online"
    - a failed "I Agree" says why instead of leaving the card untouched
- CDN base is one value
    - VITE_CDN_BASE reaches the bundle, index.html and the nginx CSP
    - build fails when it is unset, instead of shipping a literal %VITE_CDN_BASE% in the favicon / og:image

## Backend

- startup work moved out of import time
    - create_all runs in a lifespan handler, an unreachable db is a startup error not an import crash loop
    - no placeholder consent policy seeded by the app, it is seed data now
- whole turn deadline
    - TURN_DEADLINE_SECONDS 100s < nginx proxy_read_timeout 120s < client AbortSignal 150s
    - a timed out turn writes no backend message, so it cannot reach the next prompt's history
- failed turns no longer store a traceback
    - error row keeps an incident id + bounded message, the full traceback goes to the log only
    - recovery path rolls back first and guards each write
- gemini empty response raises GeminiEmptyResponseError instead of returning None
- privacy gate (Presidio) offloaded to a threadpool, no longer blocks the event loop
- summarization opens its own session, no transaction held across the model call
- invite code brute force protection
    - global daily failed-attempt cap + per-IP cap, MAX_DAILY_INVITE_CODE_FAILURES in constants.py
    - only failed verifications count, 429 with the same generic message for both layers
- POST /api/consent rate limited per IP per day, was unauthenticated unbounded row insertion
- session id rotated on invite code verification
    - conversation ownership and consent records moved to the new id in one transaction
- consent terms unavailable state
    - no policy -> 200 with nulls, database unreachable -> 503 with nulls, same inert card either way
- BM25 corpus cache checks the corpus_cache row id each turn, DELETE FROM corpus_cache now takes effect
- request bounds: conversationId and consent body length capped, stale conversationId now logged

## Database

- async database layer
    - SQLAlchemy create_async_engine + AsyncSession + asyncpg, every service converted
    - DATABASE_URL rewritten to +asyncpg at startup, sslmode passed through unchanged
    - expire_on_commit=False, a regen commit no longer re-fetches the loaded history row by row
    - get_recent_messages reads unlocked, no row lock held across the 6-11 model calls
- daily rate limit counters moved to postgres
    - new rate_limit_counter table, one row per (key, day)
    - atomic INSERT ... ON CONFLICT DO UPDATE, survives restart, correct across workers
    - 90 day retention, swept once per process per day
    - in-memory state is concurrency only (in-flight counts, locks, pacing), all dropped when a session goes idle
- consent_policy / consent_record condition_text is jsonb {header, condition}
    - a bare string still reads as the legacy form, so existing rows keep working
    - needs a one-off ALTER on an existing database, create_all never alters columns
- content validator (app/validators/content_validator.py)
    - shape check for every site_content section, journey / project detail, image and consent policy
    - run by the seed loader and as a CLI before pasting into psql
- seed data (app/models/seed/)
    - every table's starting content as json + loader, skips anything already present

## Infrastructure

- containers run non-root
    - backend uid 10001, frontend nginx uid 101 on port 8080, compose publishes 80:8080
- --reload dropped from the backend image, kept as a compose command override for local dev
- local db service added to docker-compose.yml, local work no longer tunnels to production
- docker log rotation on every service (10m x 3)
- ENV added to docker-compose.ec2.yml, defaults to development until TLS is in front
- update Part_C with the one-off steps for this deploy
    - pull the compose file before the images, WIF file mode, condition_text -> jsonb, VITE_CDN_BASE

---
# version 0.6.2

- point form in body text
    - "- " / "* " lines in an overview / journey body render as a bullet list
    - shared <Prose>, so every body field supports it
    - one paragraph and one list can mix in the same field
- project overview split into two
    - thumbnail overview: point form, from the site_content "projects" row (new "overview" key)
    - detail popup overview: paragraph, from the site_project row
- project detail popup
    - left-aligned bold header above each video (from "caption"), no caption below
    - remove "Technologies used" heading, chips read on their own
    - GitHub / Live demo buttons moved next to the title
    - smaller overview and main features text
- project thumbnail tech chips
    - show every chip that fits two rows, "+N" bubble only on a 3rd row
    - align left (was centred)
- thumbnail hover overview centred, points spread evenly, each point left-aligned with a dot
- title, description and og tags now fetched from database
    - new <DocumentHead>, set from personal_statement on load
    - index.html keeps only generic fallbacks, no personal content in the codebase
    - og:image moved to a fixed S3 key (tools_icon/og_img.jpg)
- chatroom send button hover / pressed colour blue -> brand orange
- update model docstrings and Part_D for the bullet syntax and the split overview

---
# version 0.6.1

- Sections fade in as they're scrolled to
- Per-item reveal on the journey timeline
- Journey card hover animation
- add favicon, title and description
- Palette colour theme
- adjust Type scale
- add name on about me
- Chatroom Invite-code field collapsed behind a link 
- consent window exit button only when terms fetching fail
- Floating chatroom bottom on bottom right
    - Handover + morph effect when scroll out
- Chatroom name now fetch from database
    - name load and stored in React state

---
# version 0.6.0 (all updates from 0.5.1 to 0.5.3)
# UI Design

- model orchestrate architecture improve
- chatroom UI implementation
- Codebase audit
- UI improvement
- bug fix

---
# version 0.5.3

- model orchestrate architecture improve
    - split reply generation into fact grounding and reply generating
    - combine scenario fetcher and doc fetcher
- Codebase audit
    - align pending cap between backend and frontend
    - make _REJECT_RULES, SECTIONS list in knobs.ts, constants.py the single source
    - Both inline history formatters now call prepare_history()
    - update_conversation_code calls assert_ownership() instead of an inlined copy
    - New <BottomSheet>; shared panel CSS hoisted
    - Exception handlers registered once in main.py; both chat routes now have zero try/except
    - Removed unused self.db, sass dep, df_dict storage, stale footer docstring.
    - summarize_if_needed inlined.
    - Memo reuses derived lists; projectItems memoized.
    - New <SectionState> replaces five copies.
    - Both alert() calls → in-strip error message.
    - New lib/api.ts (postJson/getJson/errorDetail).

---
# version 0.5.2

- chatroom real online offline status
- chatroom icon
- UI improvement
    - adaptable longer contact me section
    - Journey timeline fade in at beginning
    - consistent close button in detail popup window
    - reloacte image of about me and qualification in small screen
    - adjust text size, customize to different screen size
    - unify colour code in home page to chatroom to blue
- bug fix
    - Project Details and Journey Details open at the top
    - Journey section dot alignment in small screen
    - eluminate navbar to image gap
    - Chatroom header cut off on small screen when scrolled on home page before

---
# version 0.5.1

- Chatroom UI implementation
    - basic UI
    - wallpaper
    - dialogue bubbles
    - system message
    - warp text in textbox
    - send button animation
- Typing indicator behaviour
    - delay knob
    - appear in between fragment reply
- show Error reason
    - red dialogue for rejected message
    - able to show:
        - long message
        - reject by reject gate with reason
        - reaching client cap
- improve retrieve similiar question
    - BM25 shortlist 5 questions from database
    - new AI model to rank the shortlisted questions
- UI improvement
    - consent button
    - Message spacing based in sender
- system prompt update


---
# version 0.5.0 (all updates from 0.4.1 to 0.4.4)
# Multimedia

- database to store static content
- S3 and CloudFront for owner image and other resources
- Certifications section
- journey section
    - journey image
    - detail popup window
- project section
    - thumbnial banner
    - detail popup window
    - auto video (one video play at a time)
- UX improvement
    - preload first hero image
    - preload first video for all projects
    - "poster_tag" for initial one frame
- UI improvement
- bug fix
- clean code
    - exclusive knob file for adjustment


---
# version 0.4.4

- project detail popup window
- auto video in project detail
    - only one video play at a time based on user scroll
- preload first video for all projects
- "poster_tag" for initial one frame before video loaded in browser
- minor UI improvement
    - popup window exit button to circled "X"
    - adjust popup window width

---
# version 0.4.3

- project thumbnial banner
- journey object image
- clickable journey object in popup window
- extract all knobs to one knobs.ts file
- minor UI improvement
    - Journey redesigned as a vertical timeline
    - Projects botton on navbar show a dropdown and bring to the project position in home page

---
# version 0.4.2

- faster preload of first image
- add Certifications section
- minor UI improvement
    - Full-bleed hero image band on About
    - 4K monitor support
    - Fixed a layout jump and Collapsed navbar below 992 px
    - update Scroll-spy to support both scroll directions


---
# version 0.4.1

- estabulish database to store static content
- estabulish S3 and CloudFront for owner image and other resources
- improve UI
    - combine about me, qualification and journey into one page
    - sustain nav bar on top
    - follow user scroll to highlight button in nav bar
- fix bug
    - incorrect highlighting in nav bar

---
# version 0.4.0 (all updates from 0.3.1 to 0.3.3)
# Security

- user consent function for data collection
- privacy gate
- Rate control
- Message length gate
- differentiate capacity of different user tier
- consent acceptance criteria
- Combine fragment messages before sending to backend
- split bukly chatroom code 
- fix bug of 2 close messages

---
# version 0.3.3

- Combine fragment messages before sending to backend
    - frontend logic
    - typing detect
- split bukly chatroom code 

---
# version 0.3.2

- differentiate capacity of different user tier
    - rate control
    - regenerate appempt
- consent acceptance criteria
    - compulsory consent terms in consent http request 
- fix bug of 2 close messages
    - add a linked list chain of messages in frontend

---
# version 0.3.1

- user consent function for data collection
    - consent popup window
        - pull agreement condition from database
    - consent record
    - consent blocker for message handling
        - both backend and frontend
- privacy gate
    - block privay containing message before entering database and third party LLM
        - spacy nlp engine
- Rate control
    - cap of 3 in-flight messages per session
    - cap of 5 concurrent session per IP
- Message length gate

---
# version 0.3.0 (all updates from 0.2.1 to 0.2.3)
# Full Chatbot Architecture

- improve BM25 workflow
- check gate
- response parser
- prompt construction architecture
- improve workflow of logging error model message
- change behaviour of unanthentication conversation id and invite code

---
# version 0.2.3

- improve BM25 workflow
    - new table to store computed corpus
    - put corpus in cache memory at the beginning

---
# version 0.2.2

- check gate
    - check AI response consistency before sending back
    - few turns retry
        - minor retry with original response and reject reason only
        - major retry with complete background and reject reason
    - log retry attempt message in message table
        - sender: regen
- response parser
    - parse paragraph into sentence list
    - frontend delay response display for mimic human typing

---
# version 0.2.1

- prompt construction architecture
    - system prompt
        - unchange status information orientated
    - user prompt
        - dynamic and situtional information orientated
- improve workflow of logging error model message
    - log error model message in message table
        - sender: error
    - isolate error model message from functional feature
- change behaviour of unanthentication conversation id and invite code
    - treat as starting a new conversation instead of failure loop

---
# version 0.2.0
# Core Chatbot Backbone

- model orchestration
    - workflow to gather material for natural language generation
        - categorize topic of the user message
        - retrieve reference document of that topic
        - BM25 algorithm to retrieve similiar past Q&A pair as reference
        - fetch summary and few recent message after summary
- summerization
    - a running summary is add in db conversation table
    - update a running summary every x turns of conversation

---
# version 0.1.1

- change authentication to cookie session signature
    - prevent conversation id tempering attack

---
# version 0.1.0 
# App Backbone

- Fundemential Architecture Estbulished(Github, Github Action, EC2, ECR, RDS, GCP etc.)
- Basic functionality
    - Basic UI page
    - database for conversation, dialogue, invite code
    - store conversation and dialogue in database
    - match invite code in database
    - connection to Vertex AI model
    - UX functionality
        - sustain conversation and inputed invite code after switching tab

---
# version format x.y.z
- x is the major version
- y is the major function update
- z is the minor bug fix or minor function update(toward the major function update)
---
