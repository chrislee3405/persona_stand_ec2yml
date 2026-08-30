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
FastAPI ──► RDS  (site_content table, one JSONB row per section version)
   │
   │ returns { "content": { "personal_statement": {...}, "journey": [...], ... } }
   ▼
Frontend renders the page
   │
   │ for each image key in the content (e.g. "about/hero.jpg")
   ▼
<img src = "<cloudfront-domain>/about/hero.jpg">
                     │
                     ▼
              CloudFront ──► S3 bucket  (private; readable only via CloudFront)
```

- **Text** — the frontend calls `GET /api/site-content` on page load and renders whatever it gets. Changing text is a database-only operation; **no redeploy**.
- **Images** — the database stores only the object **key** (e.g. `about/hero.jpg`), never a full URL and never the image itself. The frontend prepends the CloudFront base URL, which is hardcoded once in `persona_stand_frontend/src/lib/assetUrl.ts`.
- **Versioning** — you never `UPDATE` a `site_content` row. To change a section you `INSERT` a new row with the same `section` value; the row with the newest `created_at` wins, and the old rows stay as history.

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

### The table creates itself

The backend calls `Base.metadata.create_all(...)` on startup, so the `site_content` table is created automatically the first time the backend container runs against the database. **No migration or manual `CREATE TABLE` is needed.**

Column shape (for reference):

| column | type | notes |
|---|---|---|
| `id` | `serial` PK | auto |
| `section` | `text` | slug the frontend expects: `personal_statement`, `qualifications`, `journey`, `contact` |
| `content` | `jsonb` | shape depends on the section — see **D.5** |
| `created_at` | `timestamptz` | defaults to `now()`; newest row per `section` wins |

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
INSERT INTO site_content (section, content) VALUES (
  'personal_statement',
  $j${
    "heading": "<short heading, e.g. About Me>",
    "body": "<1-3 sentence bio paragraph>",
    "cta": { "label": "<button text>", "href": "/chatroom" },
    "heroImage": "<S3 object key, e.g. about/hero.jpg — or omit this line for no image>"
  }$j$::jsonb
);

-- 2. qualifications  → Qualifications page.  shape: ARRAY (array order = display order)
INSERT INTO site_content (section, content) VALUES (
  'qualifications',
  $j$[
    {
      "id": "<slug, e.g. mit-qut>",
      "title": "<qualification, e.g. Master of Information Technology>",
      "institution": "<e.g. Queensland University of Technology>",
      "year": "<e.g. 2024>",
      "detail": "<optional extra line — or omit>"
    }
  ]$j$::jsonb
);

-- 3. journey  → Journey page.  shape: ARRAY of blocks (array order = top-to-bottom order)
INSERT INTO site_content (section, content) VALUES (
  'journey',
  $j$[
    { "id": "<slug, e.g. 2018-teaching>", "year": "<e.g. 2018>", "title": "<block heading>", "body": "<paragraph text>" },
    { "id": "<slug, e.g. 2024-scholarship>", "year": "<e.g. 2024>", "title": "<block heading>", "body": "<paragraph text>" }
  ]$j$::jsonb
);

-- 4. contact  → Contact page + the footer social icons.  shape: OBJECT
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

### Verify

```sql
SELECT DISTINCT ON (section) section, content, created_at
FROM site_content
ORDER BY section, created_at DESC, id DESC;
```

Then open `http://<ec2-public-ip>` in a browser — the pages should show your text.

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
- upload under a **new versioned filename** (`about/hero-v2.jpg`) and point the content row at the new key (preferred), **or**
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

### 3. Put the key in the content

The image is only shown once a `site_content` row references its key. Open `psql` (D.2) and `INSERT` a new row for the section that uses it:

```sql
-- Point the About-Me hero at the uploaded key
INSERT INTO site_content (section, content)
SELECT 'personal_statement',
       jsonb_set(content, '{heroImage}', '"about/hero.jpg"')
FROM site_content
WHERE section = 'personal_statement'
ORDER BY created_at DESC, id DESC
LIMIT 1;
```

4. Reload the browser. No redeploy.

---

## D.5 Content Shapes Reference

| `section` | JSON type | Fields | Shown on |
|---|---|---|---|
| `personal_statement` | object | `body` (req), `heading`, `cta:{label,href}`, `heroImage` (S3 key) | About-Me / main page |
| `qualifications` | array | per item: `id`,`title` (req), `institution`, `year`, `detail` | Qualifications page |
| `journey` | array | per block: `id`,`year`,`title`,`body` (all req); array order = page order | Journey page |
| `contact` | object | `email` (req), `intro`, `location`, `links:[{label,href}]` | Contact page + footer icons |

Rules:
- `section` is a fixed slug — the frontend looks for these exact strings.
- Image fields (`heroImage`, and any future `media`) hold the **S3 key only**, e.g. `about/hero.jpg` — never a full URL.
- Optional fields can be omitted entirely rather than set to `null`.

---

## D.6 Troubleshooting Reference

*(SQL is run from the **local machine** via the Part B.2 tunnel + `psql`. URLs are checked in the **local machine's browser**. AWS settings are checked in the **AWS Console**.)*

| Symptom | Likely cause |
|---|---|
| Page text is blank / shows "No … content yet." | No row for that `section`, or the newest row's JSON is the wrong shape — check with the D.2 verify query |
| Edited the DB but the page didn't change | Used `UPDATE` on an old row — its `created_at` didn't move, so a different row is still newest. Always `INSERT` a new row |
| `<img>` renders but is broken; `src` starts with `/` and has no host | `CDN_BASE` empty — the frontend image was built before `assetUrl.ts` had `<cloudfront-domain>`; fix the line and redeploy the frontend (Part C.2) |
| `<img>` `src` looks doubled (`https://…cloudfront.net/https://…`) | The full URL was stored in the content instead of the bare key — store `about/hero.jpg`, not the CloudFront URL |
| Opening the image URL shows `AccessDenied` XML | Hitting the **S3** URL directly (expected — use the `<cloudfront-domain>` URL), or the CloudFront bucket policy / OAC step (D.1 step 7) wasn't completed |
| Image URL 404s on CloudFront | Key mismatch — the S3 object key must exactly equal the string in the content JSON (folder, case, extension) |
| Replaced an image, same key, still see the old one | CloudFront cache — create an invalidation, or use a new versioned filename (D.4) |
| `GET /api/site-content` returns `{"content": {}}` | `site_content` table is empty — seed it (D.2) |
| `GET /api/site-content` 404 / 500 | Backend not running or can't reach RDS — see Part C.4 |
| Footer LinkedIn/GitHub icons missing | `contact.links` has no entry whose `label` contains `linkedin` / `github` (case-insensitive) |

---
