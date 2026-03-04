# BNI SYNERGY — Guest Management System

Node.js/Express app for registering, tracking, and managing BNI SYNERGY chapter guests.

---

## Quick start

```bash
git clone <repo>
cd bni-synergy
npm install          # also downloads NotoSans fonts via postinstall
cp .env.example .env
# fill in .env (see below)
npm start
```

Open:
- Guest form → `http://localhost:3000/guest`
- Admin panel → `http://localhost:3000/admin`
- API test   → `http://localhost:3000/api/test`

---

## Step 1 — Google Service Account

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or use existing)
3. Enable **Google Sheets API**: APIs & Services → Library → search "Sheets" → Enable
4. Create credentials: APIs & Services → Credentials → **Create Credentials → Service Account**
   - Name it anything (e.g. `bni-synergy`)
   - Click **Done**
5. Click the service account → **Keys** tab → **Add Key → Create new key → JSON**
6. Download the JSON file — it looks like:
   ```json
   {
     "type": "service_account",
     "client_email": "bni-synergy@your-project.iam.gserviceaccount.com",
     "private_key": "-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----\n",
     ...
   }
   ```
7. Copy `client_email` → set as `GOOGLE_SERVICE_ACCOUNT_EMAIL` in `.env`
8. Copy `private_key` (the whole string including `-----BEGIN...-----END...`) → set as `GOOGLE_PRIVATE_KEY` in `.env`

> **Tip:** Wrap the private key in double quotes in `.env` and keep the literal `\n` characters as-is — the app handles unescaping automatically.

---

## Step 2 — Share Google Sheet

1. Open your Google Sheet: `https://docs.google.com/spreadsheets/d/1QIDMcAeMupan0oGjsQwMgi4vB5oeTgfOV-ovrxd5C6s`
2. Click **Share** (top-right)
3. Paste the service account email (from step 1)
4. Set role: **Editor**
5. Click **Send**

The app will automatically create tabs named `DD/MM` (e.g. `09/03`) and copy headers from the most recent existing tab.

**Sheet column structure (do not change):**

| Col | Name | Content |
|-----|------|---------|
| A | ВСТРЕЧА | Left empty (filled manually) |
| B | Способ оплаты | `онлайн` on registration; `опл,DD/MM` on payment |
| C | № | Auto-incremented per tab |
| D | Имя и Фамилия | `firstName lastName` |
| E | Профессия/вид деятельности | Specialty |
| F | Телефон | Phone |
| G | Кто пригласил | Invited by |
| H | Заметки | Left empty |

---

## Step 3 — WAHA (WhatsApp API)

Run WAHA with Docker:

```bash
docker run -d \
  --name waha \
  -p 3001:3000 \
  devlikeapro/waha
```

Then connect your WhatsApp account:
1. Open `http://localhost:3001` (WAHA dashboard)
2. Start a session named **`bni-synergy`**
3. Scan the QR code with WhatsApp on your phone

Set in `.env`:
```
WAHA_URL=http://localhost:3001
WAHA_SESSION=bni-synergy
```

> **On a remote server:** use the server's IP/hostname instead of `localhost`.

---

## Step 4 — Deploy to Railway

1. Push code to GitHub
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Add a **SQLite volume** (or use Railway's persistent disk):
   - Set `DB_PATH=/data/guests.db`
4. Set all environment variables in Railway's Variables tab (copy from `.env`)
5. Add a custom domain or use the Railway-generated URL
6. Set `PORT` to `3000` (Railway injects `$PORT` automatically — use `process.env.PORT || 3000`)

> **Fonts on Railway:** The `postinstall` script downloads fonts automatically on deploy. If Railway's build environment blocks outbound HTTP, download `NotoSans-Regular.ttf` and `NotoSans-Bold.ttf` manually and commit them to `fonts/`.

---

## Environment variables

| Variable | Description |
|---|---|
| `PORT` | Server port (default: `3000`) |
| `NEXT_MEETING_DATE` | Current meeting date in `DD/MM` format (e.g. `09/03`) |
| `GOOGLE_SHEET_ID` | Google Sheets document ID |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Service account email |
| `GOOGLE_PRIVATE_KEY` | Private key from service account JSON |
| `WAHA_URL` | WAHA server URL (default: `http://localhost:3001`) |
| `WAHA_SESSION` | WAHA session name (default: `bni-synergy`) |
| `PAYBOX_SECRET` | Optional PayBox webhook secret |
| `DB_PATH` | SQLite file path (default: `./data/guests.db`) |

---

## API reference

### Public

| Method | Path | Description |
|---|---|---|
| `GET` | `/guest?ref=Name` | Guest registration form |
| `POST` | `/api/register` | Register a guest |
| `POST/GET` | `/api/paybox-webhook` | PayBox payment callback |
| `GET` | `/api/test` | Health check |

### Admin

| Method | Path | Description |
|---|---|---|
| `GET` | `/admin` | Admin panel |
| `GET` | `/api/guests?date=DD/MM` | List guests (filter by date) |
| `GET` | `/api/meetings` | List meeting dates |
| `PUT` | `/api/guests/:id/paid` | Mark guest as paid |
| `GET` | `/api/pdf/list?date=DD/MM` | Download guest list PDF |
| `GET` | `/api/pdf/badges?date=DD/MM` | Download badges PDF |
| `POST` | `/api/send-voting` | Voting link broadcast |
| `POST` | `/api/send-contacts` | Contacts list broadcast |

### POST /api/register

```json
{
  "firstName":  "Иван",
  "lastName":   "Иванов",
  "phone":      "052-123-4567",
  "specialty":  "Программист",
  "invitedBy":  "Петр Петров"
}
```

### POST /api/send-voting

```json
{ "date": "09/03", "votingLink": "https://vote.example.com/abc" }
```

### POST /api/send-contacts

```json
{ "date": "09/03", "contactsText": "1. Иван — Программист | 052-000-0000\n2. …" }
```

---

## Referral links

Generate a registration link with the inviter pre-filled:

```
https://yoursite.com/guest?ref=Иван%20Иванов
```

The "Кто пригласил" field is auto-filled and locked.

---

## PDF badges

- **Page:** A4 portrait
- **Layout:** 2 columns × 5 rows = 10 badges per page
- **Badge size:** 90 × 50 mm
- **Content:** BNI SYNERGY header bar (red), full name (large), specialty, meeting date

Requires NotoSans fonts in `fonts/` for Cyrillic text (auto-downloaded on `npm install`).

---

## Phone number format

WhatsApp chatId is computed as:

```
strip non-digits → if starts with 0, replace with 972 → append @c.us

"054-776-1466" → "0547761466" → "9720547761466"@c.us
```
