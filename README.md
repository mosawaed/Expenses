# Expenses

A simple, good-looking expense tracker for iPhone, in shekels (₪). It runs in Safari,
installs on your Home Screen like a real app, works with no internet, and keeps your
data only on your phone.

**Your app's address (once GitHub Pages is on):** https://mosawaed.github.io/Expenses/

## What it does

- **Add income or expenses**: the amount in ₪, cash or card, an optional note, and the date.
  Tap the big **+** button at any time.
- **Balances**: your total balance, plus a separate cash balance and card balance.
- **Monthly summary**: how much came in, how much you spent, and how much is left.
- **All transactions**: grouped by day. Tap one to edit it. Swipe left to delete it, with
  **Undo** in case you slip.
- **Categories**: every expense (including installment plans) gets a category: Food, Study,
  Impulse buys, Essentials or Other. Add, rename or delete your own, each with its own color
  and icon, in **Settings → Categories**. Older expenses without a category count as Other
  until you edit them.
- **Filters**: choose a month (or all months), All / Cash / Card, and a category.
- **Installments**: when adding an expense, turn on **Pay in installments** and enter the
  total, the number of monthly payments, the first payment date, and cash or card. Each
  payment counts as an expense in its own month, and the balance only drops when a payment
  is due. Under **Installments** on the Overview screen you'll see what's left to pay, what's
  due this month and next month, and every active plan. Tap a plan (or one of its payments)
  to edit or delete it.
- **Charts**: income vs expenses per month, spending over time, and cash vs card.
  Tap or drag on a chart to see exact numbers; the table button lists every value.
  **Spending by category** shows each category's amount and share for the month. Tap one to
  see its expenses.
- **Backup**: export all your data to a file, and import it again to restore.
- **Light and dark mode**: follows your iPhone, or pick one in Settings.

---

## Put the app online (one-time setup, about 5 minutes)

GitHub Pages hosts the app for free. Everything is already prepared. You only need to
switch Pages on and move the code to the `main` branch. Do the steps in this order.

### Step 1: Turn on GitHub Pages

1. Open your repository: https://github.com/mosawaed/Expenses
2. Click **Settings** (the gear icon in the top menu of the repository).
   On a phone, the menu may be hidden behind a **…** button.
3. In the left sidebar, under **Code and automation**, click **Pages**.
4. Under **Build and deployment**, find **Source** and choose **GitHub Actions**.

That's it. There is no Save button; the choice is saved right away.

### Step 2: Move the app into the `main` branch

The app was written on a separate branch called `claude/upbeat-wright-l7fo27`.
GitHub Pages publishes from `main`, so merge it in with a pull request:

1. Go back to the repository's main page (click **Code** at the top).
2. If you see a yellow banner that says *claude/upbeat-wright-l7fo27 had recent pushes*,
   click the green **Compare & pull request** button.
   No banner? Click the **Pull requests** tab → **New pull request**. Leave *base* as
   `main` and set *compare* to `claude/upbeat-wright-l7fo27`.
3. Click **Create pull request**.
4. Click **Merge pull request**, then **Confirm merge**.

### Step 3: Wait for the deploy

1. Click the **Actions** tab. You'll see a run called **Deploy to GitHub Pages**.
2. Wait until it has a green check mark (usually 1–2 minutes).
3. Open https://mosawaed.github.io/Expenses/. The app is online.

The address is also shown under **Settings → Pages** once the first deploy has finished.

### Step 4: Install it on your iPhone

1. On your iPhone, open **Safari** and go to https://mosawaed.github.io/Expenses/
2. Tap the **Share** button (a square with an arrow pointing up).
   On newer iPhones, tap **•••** first and then **Share**.
3. Scroll down and tap **Add to Home Screen**.
4. If you see **Open as Web App**, keep it switched on. Tap **Add**.
5. Open **Expenses** from your Home Screen. It opens full screen, like a regular app.

> **Use the Home Screen app, not the Safari tab.** The installed app keeps its own data,
> separate from Safari. If you already added transactions in Safari, export a backup there
> (Settings → Export backup) and import it in the installed app.

---

## Your data and backups

- Your transactions, installment plans and categories are saved **only on your phone**, inside the app's storage. Nothing is
  uploaded anywhere. The GitHub repository contains only the app's code, never your numbers,
  so it's fine that it's public.
- **Make a backup now and then.** If you remove the app from your Home Screen, its data is
  removed too. The app reminds you once a month.
  - **Export:** Settings → **Export backup** → **Save to Files** (iCloud Drive is a good place).
  - **Restore:** Settings → **Import backup** → choose the `.json` file → **Replace** or **Merge**.
- **New phone?** Export on the old phone, install the app on the new one, and import the file.

## Updating the app later

Any change that lands on the `main` branch is published automatically by the workflow in
`.github/workflows/deploy.yml`. Next time you open the app, it shows
*"A new version of Expenses is ready"*. Tap **Update**. Your data is not affected.

## If something goes wrong

| Problem | What to do |
| --- | --- |
| The **Actions** run failed at **Set up GitHub Pages** | Pages wasn't switched on yet. Do Step 1, then open the failed run and click **Re-run all jobs**. |
| The run failed with *"Deployment failed, try again later"* | A temporary GitHub problem. Click **Re-run all jobs**. |
| No run appears in **Actions** | Open **Actions** → **Deploy to GitHub Pages** → **Run workflow**. |
| The address shows a 404 page | Wait a minute after the green check mark, then refresh. |
| The iPhone still shows the old version | Close the app completely (swipe it away) and open it again, then tap **Update**. |

Free GitHub Pages needs the repository to be **public** (it is). Making it private turns
Pages off unless you have a paid GitHub plan.

---

## For the curious

**Run it on a computer:** in this folder, run `python3 -m http.server 8000` and open
http://localhost:8000. Offline mode only works on `localhost` or on an `https://` address.

**How it's built:** plain HTML, CSS and JavaScript with no frameworks or build step, so the
files in this repository are exactly what gets published.

| File | What it is |
| --- | --- |
| `index.html` | The page and the iPhone home-screen settings |
| `css/app.css` | All styling, including light and dark mode |
| `js/app.js` | The screens: overview, activity, insights, settings, add/edit |
| `js/store.js` | Saving, loading, backup and restore |
| `js/charts.js` | The interactive charts |
| `js/ui.js`, `js/swipe.js`, `js/dom.js`, `js/format.js` | Sheets, dialogs, swipe-to-delete, shekel and date formatting |
| `sw.js` | The service worker that makes the app work offline |
| `manifest.webmanifest`, `icons/` | App name and icons for the Home Screen |
| `.github/workflows/deploy.yml` | Publishes the app to GitHub Pages |
