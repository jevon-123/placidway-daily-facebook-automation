# n8n setup, step by step

Everything that can be scripted is in `setup/`. This covers the rest — the
parts that need you to be logged into your own accounts.

Work through it in order. Each step produces a value the next one needs. You do
not have to finish in one sitting: n8n starts fine with blanks, and the
workflow runs in `simulate` mode without Facebook at all.

```
1. Install and start n8n          ~10 min   (scripted)
2. Gemini key -> credential        ~5 min
3. Google Sheet -> credential     ~15 min
4. Telegram bot -> credential     ~10 min
5. Facebook Page -> credential    ~25 min   (the fiddly one)
6. Attach credentials, test run   ~15 min
```

Steps 2–4 are enough for a complete run in `simulate` mode. Step 5 is only
needed to publish for real.

---

## 1. Install and start n8n

```powershell
& 'C:\Users\jevon\tools\node-v26.13.0-win-x64\npm.cmd' install -g n8n
cd C:\Users\jevon\placidway-automation
.\setup\make-local-env.ps1
.\setup\import-workflows.ps1
.\setup\start-n8n.ps1
```

Open <http://localhost:5678> and create the owner account. It is local only —
the email and password are stored on your machine, not sent anywhere.

`import-workflows.ps1` prints the workflow IDs. Copy the ID of
**PlacidWay — Error Handler** into `setup/local.env.ps1` as
`PW_ERROR_WORKFLOW_ID`.

> Keep the terminal running n8n open. Closing it stops n8n. Use a second
> terminal for everything else.

---

## 2. Gemini key

1. Go to <https://aistudio.google.com> → **Get API key** → **Create API key**.
2. Copy it.

In n8n: **Credentials → Add credential → Header Auth**

| Field | Value |
|---|---|
| Name | `Gemini API key` |
| Header Name | `Authorization` |
| Header Value | `Bearer AIza...` (your key, with `Bearer ` in front) |

The space after `Bearer` matters.

**Free-tier notes.** Quota is per model, so a 429 on one model does not mean a
429 on another. `gemini-3.1-flash-lite` has been the most forgiving.
`gemini-2.5-flash` returns 404 for new keys. To see what your key can reach:

```powershell
curl -H "x-goog-api-key: YOUR_KEY" https://generativelanguage.googleapis.com/v1beta/models
```

---

## 3. Google Sheet

### 3a. Create the spreadsheet

1. New spreadsheet at <https://sheets.new>. Name it `PlacidWay automation`.
2. Rename the first tab to **`runs`** (double-click the tab name).
3. Add a second tab named **`errors`**.
4. Paste the headers. They must match exactly — the workflow maps by column
   name, and a typo means a silently empty column.

   **`runs`** — paste into cell A1, then **Data → Split text to columns**:

   ```
   run_id,run_at,content_type,url,title,image,extracted_by,post_text,attempts,rule_status,rule_violations,validator_status,validator_violations,review_mode,approval_outcome,publish_mode,fb_post_id,status,error
   ```

   **`errors`** — same method:

   ```
   kind,severity,nodeName,status,message,hint,executionUrl,workflowName,alertText,failedAt
   ```

   Both lines are also in `docs/sheet-templates/` if you would rather import
   the CSVs. They are generated from the workflow code, so they cannot drift
   from what it writes.

5. From the URL `docs.google.com/spreadsheets/d/`**`1AbC...xyz`**`/edit`, copy
   the middle part into `setup/local.env.ps1` as `PW_SHEET_ID`.

### 3b. Service account

A service account is a robot Google account. It is less work than OAuth here —
no consent screen, no redirect URI, no re-authorising every week.

1. <https://console.cloud.google.com> → create a project, name it `placidway`.
2. **APIs & Services → Library** → enable **Google Sheets API**.
3. **APIs & Services → Credentials → Create credentials → Service account**.
   Name it `n8n-sheets`, then **Create and continue → Done**.
4. Click the service account → **Keys → Add key → Create new key → JSON**.
   A `.json` file downloads. Open it in Notepad.
5. **Go back to your spreadsheet → Share.** Paste the `client_email` from that
   JSON (it looks like `n8n-sheets@placidway-xxxx.iam.gserviceaccount.com`),
   give it **Editor**, and untick "Notify people".

   *Skipping this is the single most common mistake.* The service account can
   only see spreadsheets that have been shared with it, exactly like a person.

In n8n: **Credentials → Add credential → Google Sheets API**, set
**Authentication** to **Service Account**:

| Field | From the JSON file |
|---|---|
| Name | `PlacidWay Google Sheets` |
| Service Account Email | `client_email` |
| Private Key | `private_key` — the whole thing, including `-----BEGIN PRIVATE KEY-----` and the `\n` sequences |

---

## 4. Telegram

Used for approval drafts and failure alerts.

1. In Telegram, message [@BotFather](https://t.me/botfather) → `/newbot`.
   Pick any name. He replies with a token like `8123456:AAH...`.
2. Send any message to your new bot (search its username, press Start).
3. Open this in a browser, replacing the token:
   `https://api.telegram.org/bot<TOKEN>/getUpdates`
4. Find `"chat":{"id":123456789` — that number is your chat ID. Put it in
   `setup/local.env.ps1` as `PW_TELEGRAM_CHAT_ID`.

In n8n: **Credentials → Add credential → Telegram API**, name it
`PlacidWay alert bot`, paste the token.

> Step 2 is not optional. A bot cannot message someone who has never messaged
> it first, and `getUpdates` returns an empty list until you do.

---

## 5. Facebook test Page

Only needed to publish for real. Skip it if you are demoing in `simulate` mode.

**Never point this at a PlacidWay Page.** Create your own.

1. <https://facebook.com/pages/create> — any name, e.g. `PW Automation Test`.
2. <https://developers.facebook.com/apps> → **Create app** → type **Business**.
3. In the app, add the **Facebook Login** product (it does not need
   configuring; it just has to exist so the Graph Explorer can issue tokens).
4. Open the <https://developers.facebook.com/tools/explorer>:
   - **Meta App**: your app
   - **User or Page**: *User Token*
   - **Permissions**: add `pages_manage_posts`, `pages_read_engagement`,
     `pages_show_list`
   - **Generate Access Token**, approve the dialog
5. That token lasts about an hour. Exchange it for a long-lived one. In the
   Explorer address bar, run:

   ```
   GET /oauth/access_token?grant_type=fb_exchange_token
       &client_id=<APP_ID>&client_secret=<APP_SECRET>
       &fb_exchange_token=<THE_TOKEN_FROM_STEP_4>
   ```

   App ID and secret are under **App settings → Basic**.
6. Paste the long-lived token into the Explorer's token box, then run:

   ```
   GET /me/accounts
   ```

   The response lists your Pages. Take `access_token` (the **Page** token, not
   the user one) and `id`.
7. Put the `id` into `setup/local.env.ps1` as `PW_FB_PAGE_ID`.

In n8n: **Credentials → Add credential → Header Auth**

| Field | Value |
|---|---|
| Name | `Facebook Page token` |
| Header Name | `Authorization` |
| Header Value | `Bearer <PAGE_ACCESS_TOKEN>` |

Page tokens derived this way do not expire while the app and its permissions
stay in place. If one does get invalidated — a password change will do it — the
error handler reports it as `AUTH` and tells you to redo this step, rather than
surfacing a bare `HTTP 400`.

---

## 6. Attach the credentials and run

Restart n8n so it picks up the new `local.env.ps1` values:

```powershell
# Ctrl+C in the n8n terminal, then
.\setup\start-n8n.ps1
```

The banner it prints shows which settings are filled in. Anything marked
`(not set)` is still missing.

Open **PlacidWay — Daily Facebook Post**, then for each node below click it and
pick the credential from the dropdown:

| Node | Credential |
|---|---|
| Generate Post | Gemini API key |
| Validate Post | Gemini API key |
| Load Posted Log | PlacidWay Google Sheets |
| Append To Run Log | PlacidWay Google Sheets |
| Send Draft To Reviewer | PlacidWay alert bot |
| Post To Facebook | Facebook Page token |

**Then do this, because nothing else checks it.** Open **Load Posted Log** and
**Append To Run Log** and re-pick the document and sheet from their dropdowns.
The export carries the right values, but n8n resolves those pickers against
*your* credential. `scripts/validate-workflow.mjs` verifies everything else
about the workflow; this is the one thing it cannot.

Do the same in **PlacidWay — Error Handler** for its Telegram and Sheets nodes,
then open **Settings → Error workflow** on the main workflow and confirm it
points at the error handler.

### First run

Click **Execute Workflow**. With the defaults (`simulate` + `approval`) it
will:

1. fetch the sitemap and pick an unposted page
2. extract the content and generate a post
3. run both guardrail layers
4. send you the draft on Telegram with Approve / Reject links
5. on approve, write a row to the sheet with `status = simulated`

Nothing reaches Facebook. When you are happy, set `PW_PUBLISH_MODE=publish` in
`local.env.ps1` and restart.

> **For the recording:** start n8n with `.\setup\start-n8n.ps1 -Tunnel`. The
> approval link in Telegram is built from n8n's own URL, and a link to
> `localhost` does not work on a phone. The tunnel exposes your local n8n to
> the internet, so stop it when you are done.

---

## When something breaks

| Symptom | Cause |
|---|---|
| Sheets node: "requested entity was not found" | The spreadsheet was never shared with the service account email (step 3b.5) |
| Sheets node: empty columns | Header spelling does not match |
| Telegram: "chat not found" | You never messaged the bot first (step 4.2) |
| Facebook: `OAuthException` code 190 | Token expired — redo step 5.5 |
| Generated post unparseable | Output budget consumed by reasoning. `PW_MAX_OUTPUT_TOKENS=4000`, `PW_LLM_REASONING_EFFORT=none` |
| LLM: HTTP 429 | Free-tier quota. Quota is per model — try `gemini-3.1-flash-lite` |
| Config node ignores your settings | `N8N_BLOCK_ENV_ACCESS_IN_NODE` is not `false`. `start-n8n.ps1` sets it; starting n8n any other way does not |
