
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
