# Part D — Site Content & Images 🖼️

> The page text on the site (the About-Me statement, qualifications, journey,
> contact details) is **not hardcoded in the frontend**. It lives in a
> `site_content` table in RDS. Images live in an **S3 bucket** and are served
> through **CloudFront**. This part covers the one-time AWS/database setup and
> the day-to-day routine for changing either.

## How it works

```text
Browser
   │
   │ GET /api/site-content
   ▼
FastAPI ──► RDS  (site_content: one JSONB row per section version)
        ├─► RDS  (site_image:   one row per image-slot version)
        └─► RDS  (site_journey: one JSONB row per journey-block detail version)
   │
   │ returns { "content": { "personal_statement": {...}, "journey": [...], ... },
   │           "images":  { "personal_statement": [ {"description":"hero","path":"about/hero.jpg"} ], ... },
   │           "journeyDetails": { "2024-master-ai": { "body": "...", ... }, ... } }
   ▼
Frontend renders the page
   │
   │ for each image path (e.g. "about/hero.jpg")
   ▼
<img src = "<cloudfront-domain>/about/hero.jpg">
                     │
                     ▼
              CloudFront ──► S3 bucket  (private; readable only via CloudFront)
```

- **Text** — the frontend calls `GET /api/site-content` on page load and renders whatever it gets. Changing text is a database-only operation; **no redeploy**.
- **Images** — text and images are stored **separately**: text in `site_content`, images in `site_image`. `site_image` stores only the object **key** (e.g. `about/hero.jpg`), never a full URL and never the image itself. The frontend prepends the CloudFront base URL, which is hardcoded once in `persona_stand_frontend/src/lib/assetUrl.ts`.
- **Versioning** — you never `UPDATE` a `site_content` or `site_image` row. To change something you `INSERT` a new row (same `section` for text, same `section` + `description` for an image); the newest `created_at` wins, and the old rows stay as history.

---

## D.1 First-Time Setup — S3 + CloudFront

> Only the person provisioning a *new* environment needs this section. Do it once.

### Create the S3 bucket

1. **S3 Console** → **Create bucket**.
2. Name: globally unique, e.g. `persona-stand-assets` — this becomes `<bucket-name>`.
3. Region: **`ap-southeast-2`** (match the rest of the stack).
4. **Block Public Access: leave ALL boxes checked.** The bucket stays private; CloudFront reads it on the browser's behalf.
5. Leave the rest default → **Create bucket**.

### Create the CloudFront distribution

1. **CloudFront Console** → **Create distribution**.
2. **Origin domain**: select your bucket from the list (`<bucket-name>.s3.ap-southeast-2.amazonaws.com`). ⚠️ Pick the bucket's REST endpoint, **not** an "S3 website endpoint" — the website endpoint does not work with the next step.
3. **Origin access**: choose **Origin access control settings (recommended)** → **Create new OAC** → accept the defaults → **Create**.
4. **Viewer protocol policy**: **Redirect HTTP to HTTPS**.
5. **Cache policy**: **CachingOptimized**.
6. Leave everything else default → **Create distribution**.
7. After it is created, CloudFront shows a banner: **"The S3 bucket policy needs to be updated" → Copy policy**. Click **Copy policy**, then go to **S3 Console → `<bucket-name>` → Permissions → Bucket policy → Edit**, paste, **Save**.
8. Wait for the distribution **Status** to change from *Deploying* to *Enabled* (~5–15 min).
9. On the distribution's **General** tab, note the **Distribution domain name** (e.g. `d5ydhntfck9s8.cloudfront.net`) — this is `<cloudfront-domain>`.

### Test

Open in a browser (there is nothing uploaded yet, so a 404 is fine — an **AccessDenied** XML is not):

```text
https://<cloudfront-domain>/
```

### Point the frontend at CloudFront

Edit `persona_stand_frontend/src/lib/assetUrl.ts` **— Where: your local machine, in the frontend repo** — and set the hardcoded base to your `<cloudfront-domain>`:

```ts
const CDN_BASE = (import.meta.env.VITE_CDN_BASE ?? 'https://<cloudfront-domain>').replace(/\/$/, '');
```

Commit and push. The frontend GitHub Actions workflow builds a new image and pushes it to ECR; redeploy it onto EC2 with the **Part C.2** steps.

⚠️ Because Vite inlines this value at build time, the CloudFront domain is baked into the frontend image. Changing it later means editing this line and redeploying the frontend.

---

## D.2 First-Time Setup — Content Table

### The tables create themselves

The backend calls `Base.metadata.create_all(...)` on startup, so the `site_content`, `site_image` **and** `site_journey` tables are created automatically the first time the backend container runs against the database. **No migration or manual `CREATE TABLE` is needed.**

`site_content` — the page **text**, one JSONB row per section version:

| column | type | notes |
|---|---|---|
| `id` | `serial` PK | auto |
| `section` | `text` | slug the frontend expects: `personal_statement`, `qualifications`, `certifications`, `projects`, `journey`, `contact` |
| `content` | `jsonb` | shape depends on the section — see **D.5** |
| `created_at` | `timestamptz` | defaults to `now()`; newest row per `section` wins |

`site_image` — the page **images**, one row per version of each image slot. Text and images are separate now: a section's picture is not a key inside its JSON, it is a `site_image` row.

| column | type | notes |
|---|---|---|
| `id` | `serial` PK | auto |
| `section` | `text` | which section the image belongs to — same slug set as above |
| `description` | `text` | slot label within the section (e.g. `hero`), also used as the `<img alt>`. `(section, description)` identifies one slot |
| `image_path` | `text` | S3 object **key** only, e.g. `about_me/main_img.png` — never a URL, never bytes |
| `created_at` | `timestamptz` | defaults to `now()`; newest row per `(section, description)` wins |

`site_journey` — the **expanded story** behind a Journey card, shown in a bottom pop-up when the card is clicked. The card's summary still comes from the `journey` row in `site_content`; this table is the long-form detail, one JSONB row per version.

| column | type | notes |
|---|---|---|
| `id` | `serial` PK | auto |
| `journey_id` | `text` | the `id` of the block in the `site_content` `journey` array this detail belongs to, e.g. `2024-master-ai`. Not a DB foreign key (the journey array is JSONB) — keep the two in sync by hand |
| `content` | `jsonb` | `body` (req), `heading`, `subtitle`, `highlights:[…]`, `links:[{label,href}]` — see **D.5** |
| `created_at` | `timestamptz` | defaults to `now()`; newest row per `journey_id` wins |

A journey block with **no** `site_journey` row simply has a non-clickable card — the detail sheet is optional per block.

### Connect to the database

Reuse the SSH tunnel from **Part B.2** (needs the `psql` client from **Part 0.7**).

Run in Local machine terminal — keep this running in its own window (same as B.2)
```bash
ssh -i /path/to/your-key.pem -L 5433:<rds-endpoint>:5432 ubuntu@<ec2-public-ip> -N
```

Run in Local machine terminal — a second window
```bash
psql "postgresql://<master-username>:<master-password>@localhost:5433/<db-name>"
```

### Seed one row per section

Paste into the `psql` prompt. Fill every `<...>`. `$j$ ... $j$` is dollar-quoting so you do not have to escape apostrophes inside the JSON. Keep the JSON valid — double quotes, no trailing commas.

```sql
-- 1. personal_statement  → About-Me / main page.  shape: OBJECT
--    (no image key here — the hero picture is a site_image row, seeded below)
INSERT INTO site_content (section, content) VALUES (
  'personal_statement',
  $j${
    "heading": "<short heading, e.g. About Me>",
    "body": "<1-3 sentence bio paragraph>",
    "cta": { "label": "<button text>", "href": "/chatroom" }
  }$j$::jsonb
);

-- 2. qualifications  → Qualifications & Awards section.  shape: ARRAY (array order = display order; degrees first, then awards)
INSERT INTO site_content (section, content) VALUES (
  'qualifications',
  $j$[
    {
      "id": "<slug, e.g. mit-qut>",
      "title": "<qualification or award, e.g. Master of Information Technology>",
      "institution": "<e.g. Queensland University of Technology>",
      "year": "<e.g. 2024>",
      "detail": "<optional extra line — or omit>"
    }
  ]$j$::jsonb
);

-- 3. certifications  → Certifications section.  shape: ARRAY (array order = display order)
INSERT INTO site_content (section, content) VALUES (
  'certifications',
  $j$[
    {
      "id": "<slug, e.g. ielts-band-7>",
      "title": "<certification, e.g. IELTS Academic – Band 7>",
      "issuer": "<awarding body / exam board — or omit>",
      "year": "<e.g. 2023 — or omit>",
      "detail": "<optional extra line — or omit>"
    }
  ]$j$::jsonb
);

-- 4. projects  → Projects banner (between Certifications and Journey) AND
--    the navbar "Projects" dropdown.  shape: ARRAY (array order = left-to-
--    right in the scroller / top-to-bottom in the dropdown).
--    `id` is BOTH the key and the route slug: the thumbnail and the dropdown
--    link to /projects/<id>, so it must match a project page route
--    (persona-stand, ransom-simulator, ...).
--    No image path here: `image_tag` names a site_image row (section
--    "projects", description == image_tag, or `id` when omitted) and the
--    thumbnail URL is built from that row's image_path — seeded under
--    "Seed the images" below.
INSERT INTO site_content (section, content) VALUES (
  'projects',
  $j$[
    { "id": "persona-stand",    "label": "<caption / alt text>", "image_tag": "<site_image description — or omit to use id>" },
    { "id": "ransom-simulator", "label": "<caption / alt text>" }
  ]$j$::jsonb
);

-- 5. journey  → Journey page.  shape: ARRAY of blocks (array order = top-to-bottom order)
--    `image_tag` (optional) names a site_image row (section "journey",
--    description == the tag). The click-through detail is a site_journey
--    row (seeded further below), matched by the block's `id`.
INSERT INTO site_content (section, content) VALUES (
  'journey',
  $j$[
    { "id": "<slug, e.g. 2018-teaching>", "year": "<e.g. 2018>", "title": "<block heading>", "body": "<paragraph text>" },
    { "id": "<slug, e.g. 2024-scholarship>", "year": "<e.g. 2024>", "title": "<block heading>", "body": "<paragraph text>" }
  ]$j$::jsonb
);

-- 6. contact  → Contact section (below Journey on the main page) + the footer social icons.  shape: OBJECT
INSERT INTO site_content (section, content) VALUES (
  'contact',
  $j${
    "email": "<your email>",
    "intro": "<optional short line — or omit>",
    "location": "<e.g. Brisbane, Australia — or omit>",
    "links": [
      { "label": "LinkedIn", "href": "https://www.linkedin.com/in/<handle>" },
      { "label": "GitHub",   "href": "https://github.com/<handle>" }
    ]
  }$j$::jsonb
);
```

⚠️ The footer's LinkedIn/GitHub icons are picked out of `contact.links` by matching the **label** (case-insensitive, must contain the word `linkedin` / `github`). Keep those labels.

### Seed the journey detail sheets

Optional, one row per journey block that should open a pop-up when clicked. `journey_id` must equal the block's `id` in the `journey` array above. `body` is required; `heading` / `subtitle` / `highlights` / `links` are optional. Blank lines in `body` become paragraphs.

```sql
INSERT INTO site_journey (journey_id, content) VALUES (
  '<block id, e.g. 2024-master-ai>',
  $j${
    "heading": "<optional — defaults to the block title>",
    "subtitle": "<optional italic line, e.g. Brisbane, Australia>",
    "body": "<the full story.\n\nBlank lines split paragraphs.>",
    "highlights": [
      "<optional bullet>",
      "<optional bullet>"
    ],
    "links": [
      { "label": "<e.g. Project write-up>", "href": "<https://… or /route>" }
    ]
  }$j$::jsonb
);
```

### Seed the images

Separate table, one row per image slot. The frontend reads slot `hero` for the About-Me picture; add more slots (any `description`) as sections start using images. Upload the file to S3 first (**D.4**).

```sql
-- About-Me hero picture. section + description identify the slot;
-- image_path is the S3 object KEY only.
INSERT INTO site_image (section, description, image_path) VALUES (
  'personal_statement', 'hero', '<S3 object key, e.g. about_me/main_img.png>'
);

-- Projects banner thumbnails. `description` MUST equal the project's
-- `image_tag` in the `projects` site_content array above (or its `id` when
-- `image_tag` is omitted). image_path is the S3 KEY only.
INSERT INTO site_image (section, description, image_path) VALUES
  ('projects', 'persona-stand', '<S3 key, e.g. projects/persona_stand_thumbnail.jpg>'),
  ('projects', 'ransom-sim',    '<S3 key, e.g. projects/ransom_sim_thumbnail.jpg>');
```

### Verify

```sql
SELECT DISTINCT ON (section) section, content, created_at
FROM site_content
ORDER BY section, created_at DESC, id DESC;

SELECT DISTINCT ON (section, description) section, description, image_path, created_at
FROM site_image
ORDER BY section, description, created_at DESC, id DESC;

SELECT DISTINCT ON (journey_id) journey_id, content, created_at
FROM site_journey
ORDER BY journey_id, created_at DESC, id DESC;
```

Then open `http://<ec2-public-ip>` in a browser — the pages should show your text and images.

### Migrating an existing environment

Every image the site shows now comes **only** from `site_image` — nothing reads an image path out of `site_content` (or `site_journey`) any more. If this database has a `personal_statement` row with an old inline `heroImage` key, that key is now **ignored**; run the one-liner below once so the hero still shows. (The old key can stay in the row; it just does nothing.)

```sql
INSERT INTO site_image (section, description, image_path)
SELECT 'personal_statement', 'hero', content->>'heroImage'
FROM site_content
WHERE section = 'personal_statement' AND content ? 'heroImage'
ORDER BY created_at DESC, id DESC
LIMIT 1;
```

---

## D.3 Every Content Update 🔁

> Changing any page's wording. Database only — no image, no redeploy.

1. Open the SSH tunnel and `psql` (D.2, *Connect to the database*).
2. `INSERT` a **new** row for the section — **never `UPDATE`**. Copy the section's shape from **D.5** or from the current row:

   ```sql
   -- Example: new About-Me text, keeping the existing image key
   INSERT INTO site_content (section, content)
   SELECT 'personal_statement',
          jsonb_set(content, '{body}', '"<new paragraph text>"')
   FROM site_content
   WHERE section = 'personal_statement'
   ORDER BY created_at DESC, id DESC
   LIMIT 1;
   ```

   or just write a full fresh object/array like in D.2.

   The same rule covers a **journey detail sheet** — `INSERT` a new `site_journey` row with the same `journey_id` (shape in D.2, *Seed the journey detail sheets*); the newest row per `journey_id` wins.
3. Reload the page in the browser. The frontend fetches live from `GET /api/site-content`, so the change is visible immediately.
4. Rollback, if needed: `INSERT` the old version again (it is still in the table — `SELECT ... ORDER BY created_at` to find it).

---

## D.4 Every Image Update 🔁

> Adding a new image, or replacing one.

### 1. Upload to S3

**S3 Console** → `<bucket-name>` → open (or **Create folder** for) the prefix you want, e.g. `about/` → **Upload** → add the file.

- Before finishing, expand **Properties → Metadata → Add metadata** and set
  `Cache-Control` = `public, max-age=31536000, immutable`.
- The object **key** is the folder + filename, e.g. `about/hero.jpg`.

⚠️ **Replacing an image:** because of the long cache, either
- upload under a **new versioned filename** (`about/hero-v2.jpg`) and point the `site_image` slot at the new key (preferred), **or**
- keep the same key and create a CloudFront invalidation: **CloudFront Console → your distribution → Invalidations → Create invalidation → object paths: `/about/hero.jpg`** (or `/*`).

CLI alternative (run in **AWS CloudShell**, browser):
```bash
aws s3 cp ./hero.jpg s3://<bucket-name>/about/hero.jpg \
  --cache-control "public, max-age=31536000, immutable" \
  --content-type image/jpeg
```

### 2. Confirm it serves

```text
https://<cloudfront-domain>/about/hero.jpg
```
This must show the image. If it shows an **AccessDenied** XML, see **D.6**.

### 3. Put the key in `site_image`

The image is only shown once a `site_image` row points a slot at its key. Open `psql` (D.2) and `INSERT` a **new** row for the `(section, description)` slot — never `UPDATE`; the newest row per slot wins, older rows stay as history:

```sql
-- Point the About-Me hero slot at the uploaded key
INSERT INTO site_image (section, description, image_path)
VALUES ('personal_statement', 'hero', 'about/hero.jpg');
```

4. Reload the browser. No redeploy.

---

## D.5 Content Shapes Reference

### `site_content` (text)

| `section` | JSON type | Fields | Shown on |
|---|---|---|---|
| `personal_statement` | object | `body` (req), `heading`, `cta:{label,href}` | About-Me / main page |
| `qualifications` | array | per item: `id`,`title` (req), `institution`, `year`, `detail` | Qualifications & Awards section |
| `certifications` | array | per item: `id`,`title` (req), `issuer`, `year`, `detail` | Certifications section |
| `projects` | array | per item: `id` (key + `/projects/<id>` route slug), `label` (req), `image_tag`; array order = scroller + dropdown order. No image path in the row — the thumbnail comes from a `site_image` row | Projects banner (between Certifications and Journey) + navbar "Projects" dropdown |
| `journey` | array | per block: `id`,`year`,`title`,`body` (all req), `image_tag`; array order = page order | Journey section |
| `contact` | object | `email` (req), `intro`, `location`, `links:[{label,href}]` | Contact section (below Journey) + footer icons |

### `site_journey` (journey click-through detail)

| column | Meaning |
|---|---|
| `journey_id` | the `id` of a block in the `site_content` `journey` array; one detail sheet per block, newest row wins |
| `content` | `body` (req), `heading`, `subtitle`, `highlights:[string]`, `links:[{label,href}]`. Blank lines in `body` → paragraphs |

Optional per block — a block with no row just has a non-clickable card. Served in `GET /api/site-content` as `journeyDetails: { "<journey_id>": <content> }`.

### `site_image` (pictures)

| column | Meaning |
|---|---|
| `section` | which section the image belongs to — same slug set as above |
| `description` | slot label within the section + `<img alt>` text; `(section, description)` = one slot |
| `image_path` | S3 object **key** only, e.g. `about_me/main_img.png` |

Known slots the frontend reads today:

| `section` | `description` | Used for |
|---|---|---|
| `personal_statement` | `hero` | the About-Me portrait |
| `qualifications` | `banner` | the Qualifications & Awards band image (optional) |
| `certifications` | `banner` | the Certifications band image (optional) |
| `projects` | *(each project's `image_tag` / `id`)* | that project's thumbnail in the Projects banner |
| `journey` | *(each block's `image_tag`)* | the image beside that Journey block (optional) |

Rules:
- `section` is a fixed slug — the frontend looks for these exact strings.
- `image_path` holds the **S3 key only**, e.g. `about/hero.jpg` — never a full URL, never the bytes.
- Optional `site_content` fields can be omitted entirely rather than set to `null`.
- Every image on the site is a `site_image` row — hero, section banners, project thumbnails, journey pictures. No image path is ever stored in `site_content` or `site_journey`.
- Legacy: an old `personal_statement` row may still carry a `heroImage` key. It is **ignored** — migrate it to a `site_image` (`personal_statement`, `hero`) row (see *Migrating an existing environment*).

---

## D.6 Troubleshooting Reference

*(SQL is run from the **local machine** via the Part B.2 tunnel + `psql`. URLs are checked in the **local machine's browser**. AWS settings are checked in the **AWS Console**.)*

| Symptom | Likely cause |
|---|---|
| Page text is blank / shows "No … content yet." | No row for that `section`, or the newest row's JSON is the wrong shape — check with the D.2 verify query |
| Edited the DB but the page didn't change | Used `UPDATE` on an old row — its `created_at` didn't move, so a different row is still newest. Always `INSERT` a new row |
| `<img>` renders but is broken; `src` starts with `/` and has no host | `CDN_BASE` empty — the frontend image was built before `assetUrl.ts` had `<cloudfront-domain>`; fix the line and redeploy the frontend (Part C.2) |
| `<img>` `src` looks doubled (`https://…cloudfront.net/https://…`) | The full URL was stored in `site_image.image_path` instead of the bare key — store `about/hero.jpg`, not the CloudFront URL |
| Opening the image URL shows `AccessDenied` XML | Hitting the **S3** URL directly (expected — use the `<cloudfront-domain>` URL), or the CloudFront bucket policy / OAC step (D.1 step 7) wasn't completed |
| Image URL 404s on CloudFront | Key mismatch — the S3 object key must exactly equal `site_image.image_path` (folder, case, extension) |
| Hero image missing though `site_content` is fine | No `site_image` row for `(section='personal_statement', description='hero')` — seed it (D.2) or run the D.4 step 3 insert |
| Replaced an image, same key, still see the old one | CloudFront cache — create an invalidation, or use a new versioned filename (D.4) |
| `GET /api/site-content` returns `{"content": {}}` | `site_content` table is empty — seed it (D.2) |
| `GET /api/site-content` 404 / 500 | Backend not running or can't reach RDS — see Part C.4 |
| Footer LinkedIn/GitHub icons missing | `contact.links` has no entry whose `label` contains `linkedin` / `github` (case-insensitive) |

---
