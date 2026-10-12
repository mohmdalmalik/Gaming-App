# Hotel Escape: plan for going online and onto the app stores

*Written 12 Oct 2026. This is research and recommendations only. Nothing in the game has been changed.
Store rules changed a lot in 2024–2026 and some are still in court, so each policy point below gives its
date and source. Check them again before each launch.*

---

## The short version

1. **Keep one game everywhere.** The same web game code runs in the browser, inside an iOS/Android app
   (using **Capacitor**) and as a Steam app (using **Electron**). There's no rewrite.
2. **Add one small server, and add it only when it's needed (step 3).** It's a single Node.js program
   that runs the existing rules engine (`src/game/*`) and the bots (`src/bots/*`) for every table. It sends
   each player only **their own view**, much like `src/bots/view.js` already does for bots. It acts as the
   referee: the phones and browsers only *ask* to do things, and the server decides what happens.
3. **Hosting:** start on **Render** (one "Starter" service, about **$7–8 a month**) with a small database
   file. **Fly.io** (about $2–6 a month) works just as well. A home-made VPS, Nakama, PlayFab or Firebase
   would all add work or cost that this game doesn't need yet.
4. **Accounts:** start with **guest accounts**, which need no sign-up. Add **Sign in with Apple**,
   **Google** and **Steam** later as ways to *link* that account. Ask players to link an account **before
   their first purchase**, so purchases can never be lost with a phone.
5. **Money:** sell **cosmetics directly, at fixed prices**: no paid random boxes and no "gem" currency at
   first. Each store's own payment system is used inside its app (Apple, Google, Steam), and **Stripe or a
   "merchant of record"** handles the web. A single **inventory on the server** means a skin bought
   anywhere works everywhere.
6. **Fees you'll actually pay at this size:** Apple **15%** (small-business rate), Google **15%** (10%
   service + 5% billing in the US/UK/EU since 30 Jun 2026), Steam **30%**, web about **3–6%**.
7. **Rule gaps to settle before online play.** These are your decisions, because `docs/GAME_RULES.md` is
   yours:
   - the clock pauses during meetings, so a player could stall a match forever;
   - there is no rule for a player who disconnects or leaves;
   - you need to decide whether bots in online matches are shown as bots.
8. **The very next step after the current work:** make the game's screens read **only one player's view**
   (step 2). It changes nothing you can see, but it is the foundation that everything online is built on.

---

## Where the game stands today

**What already helps:**
- **The rules can already run on a server.** They are pure code with no graphics, so a server could run
  them unchanged.
- **There is already a privacy model.** `botView()` (`src/bots/view.js`) defines exactly what one seat may
  know: the public board and its own hand, role and private events, and never anyone else's hand, card
  count or role. A test already checks this.
- **There are already event lists.** `state.events` holds the public events and `player.inbox` holds each
  player's private ones, which is the natural thing for a server to send.
- **Quick chat is a set of fixed phrases**, so there is no free text to moderate.

**What has to change before going online.** These are technical, not rules:
- **The screens read the whole game state.** About 80 places in 19 files under `src/`
  (`main.js`, `hud.js`, `ui/*`…) read the full state, including everyone's hands. They are polite about
  only *showing* your own, but online a device must never *receive* anyone else's secrets.
- **The match "seed" gives everything away.** Today the seed decides the hotel, the deck and who is
  possessed. Online, the seed must stay on the server and be truly random.
- **The client builds the hotel itself.** The public "door opened" event says which room appeared, but not
  which tile or which way it is turned. The server will need to send that, and the room deck's order must
  never leave the server.
- **Two small engine details** matter for a server running many tables at once:
  - The shared `rules` object is changed by `applyMode()`. That's fine if every online table is a normal
    match.
  - The random-number generator lives inside a function, so a table can't yet be saved and restored after
    a server restart.

**Rule questions only you can answer.** `CLAUDE.md` says no rule changes without your approval of a
before/after list:
- **Meetings:** today the 45-second clock *pauses* during a meeting and while a private screen is open.
  Online, one player could freeze the table. Should a meeting choice have its own time limit, and if so,
  what happens when it runs out?
- **Disconnects and leavers:** should a bot take over the seat after N seconds? Can the player come back?
  Does leaving count as a loss?
- **Bots in online matches:** should bot seats be labelled as bots? Today the game deliberately never
  reveals which seats are people.
- **Same look twice:** with custom avatars two people may wear the same look; usernames, colours and
  seat colours tell them apart (bots never repeat a look at one table).

---

## 1. Accounts

### Now (no server): a profile on the device
- You choose a **username and avatar look**. These are saved on the iPad through the game's own storage
  code, the same way Settings and Your record are saved today.
- The name **can't be checked for uniqueness yet**. When online play arrives, the server claims it, and if
  someone else already has it, the player is asked to pick another.

### With the server: guest accounts first
- **A guest account** is a random ID plus a long secret key. The server creates it on first launch and the
  device keeps it. There's no email and no password.
- **The weakness:** if the app is deleted or the phone is lost, the account is gone. That's why you
  **link a sign-in before the first purchase**. This is the recommended product rule, and it's your call.
- **Linking options later:**
  - **iPhone/iPad:** Sign in with Apple.
  - **Android:** Google.
  - **Steam:** automatic. The Steam app proves who the player is with a ticket, which the server checks
    with Valve, so there's no login screen at all.
  - **Web:** Google and Apple. Sign in with Apple works on the web and on Android through Apple's
    JavaScript sign-in.

### Apple's rule about Sign in with Apple (guideline 4.8, current text)
- The rule applies if an app uses a third-party or social login, such as Google, "to set up or
  authenticate the user's primary account". The app must then "also offer as an equivalent option
  another login service" that:
  - limits data to name and email,
  - lets users keep their email private, and
  - doesn't collect app activity for advertising without consent.
- **Sign in with Apple meets this.**
- **Exempt:** apps that "exclusively use your company's own account setup and sign-in systems".
  Guest-only accounts are therefore fine.
- **In practice:** if the iOS app ever shows "Sign in with Google", it must also show "Sign in with Apple".
- Apple users can hide their email (they get a relay address), so never depend on email.

### Account deletion (required)
**Apple (5.1.1(v)):** any app that creates accounts must let people **delete them from inside the app**.
- This includes **automatically created guest accounts**.
- Turning an account off (deactivating it) is not enough.
- You may link to a web page to finish the deletion, but you can't require an email or a support chat.
- If you use Sign in with Apple, the server must **revoke Apple's tokens** on deletion.

**Google Play:** requires an **in-app delete path *and* a web link** where people can request deletion.
That link goes in the Data safety form.

**For the game:** add a "Delete account" button in Settings and a simple web page. Deleting removes the
profile, the inventory and the match history. Warn the player first that their cosmetics will be lost.

### Usernames: uniqueness, filtering, reporting
- **Rules:** 3–16 characters (letters, numbers and `_`), unique regardless of capitals, and checked by the
  server.
- **A word filter**, including l33t-speak spellings.
- **Reserved names:** staff and "admin" names, the hotel's characters, and **the bot usernames**, so a
  person can't pose as a bot or the other way round.
- **Apple's guideline 1.2** applies to anything players create that others see, and a username counts. It
  requires:
  - a filter,
  - a **report** button with timely responses,
  - a way to **block** abusive users, and
  - **published contact information**.

  For this game that means:
  - "Report player" and "Block" (don't seat me with this person again) on the end screen;
  - a contact email;
  - a small admin page for us to rename or ban accounts.
- **Keep chat preset-only.** Free-typed chat would greatly increase moderation work, the age rating and
  legal duties.

### Age: a decision you need to make
- **Choose a minimum age.** 13+ is the usual choice for a game like this.
- **Texas:** the app-store age law (SB 2420) has been **in force since the appeals court lifted its block
  on 28 May 2026**. Apple and Google pass age signals to apps, and similar laws exist in Utah and
  Louisiana.
- **Brazil:** the ECA Digital law (in force 17 Mar 2026) restricts loot boxes and online interaction for
  minors.
- These laws mostly put duties on the stores, but the game should read the store's age signal later.

---

## 2. The server

### What it does
- **Runs every table in memory**, using the same `src/game/*` rules and `src/bots/*` bots. One Node.js
  program, kept as a `server/` folder in the same GitHub repo, imports those files directly.
- **Talks over WebSockets**, which are live two-way connections. Players send short **requests**, such as
  "move to room 12", "search", "trade card 31" or "end turn". The rules engine accepts or refuses them;
  it already refuses illegal moves, for example ending a turn over the hand limit. The server then sends
  each seat its **own view** plus the new public events and its own private events.
- **Owns the clock.** The 45-second turn timer runs on the server, not on the device, so a slow or
  cheating phone can't stop it.
- **Handles reconnection.** If a phone drops, its seat is held. On return, the device gets its full view
  again and catches up on the events it missed. What happens *while* the player is away is a rule decision
  (see above).
- **Private tables (step 3):** "Create table" gives a 5-letter code that friends type in, and bots fill
  any empty seats.
- **Matchmaking (step 4):** one simple waiting line. If the table isn't full after about 20–40 seconds
  (you choose), bots fill the empty seats. No skill rating is needed at first.
- **Bots cost almost nothing to run.** Their "thinking pauses" are just timers; the actual computing is
  tiny. The test suite plays 450 bot matches in about 5 seconds.
- **Capacity:** one small server can run hundreds of tables at once. Turn-based games send small messages
  only a few times a second.

### Security: in proportion, but never trust the device
- The server checks every request with the rules engine.
- Devices **never receive** other players' hands or roles, the seed, the draw pile or the room deck.
- Secret keys stay on the server only, as hosting "environment secrets", **never in the repo**. That
  covers the Stripe, Apple, Google and Steam publisher keys.
- The server also accepts the app addresses (`capacitor://localhost`, `https://localhost`) and your web
  domain.

### Hosting options (rough prices at small scale, October 2026)

| Option | How well it fits this game | Rough monthly cost | Verdict |
|---|---|---|---|
| **Render** (web service + disk) | Runs our Node server as-is; deploys automatically from GitHub; easy dashboard from an iPad | Starter **$7**/mo (always on); disk $0.25/GB; Postgres from about $6/mo. The free tier sleeps after 15 min, so it's unusable for live games | **Recommended** |
| **Fly.io** | Same idea, cheaper, more regions; deploys from GitHub Actions | Small machine from **about $2–6**/mo (256 MB about $1.94) | Equally good alternative |
| **Railway** | Same idea | $5/mo Hobby, which includes $5 of usage | Fine |
| **VPS** (e.g. Hetzner) | Cheapest raw server, but we'd manage updates, security and certificates ourselves | About €5–6/mo after the 2026 price rises | Not worth the upkeep yet |
| **Cloudflare Durable Objects** | Elegant: one "object" per table, with timers and sleeping WebSockets | About $5/mo base plus usage | Good *later*. It needs the game state saved and restored, which the engine can't do yet |
| **Colyseus** (framework) | Rooms, matchmaking and reconnection come built in, but its automatic state-sharing doesn't suit secret hands | Free if self-hosted; Colyseus Cloud from $15/mo | Not needed for 4–6-player turn-based play |
| **Nakama** (full game backend) | Accounts, social features, store-receipt checks… but it needs its own database and runtime, and our ES-module engine won't drop straight in | Free if self-hosted; managed Heroic Cloud is priced for studios (hundreds of $/mo) | Overkill |
| **PlayFab** (Microsoft) | Strong on economy and receipts, but game logic would need its container servers | Free dev tier cut to 1,000 lifetime players per title (2026); Standard $99/mo | Overkill |
| **Firebase** | No long-running referee process, so secret hands and timers are awkward | Free tier, then usage | Poor fit for the game server |

**Recommendation:**
- **Hosting:** **Render, one Starter service**.
- **Database:** an **SQLite** database file on a 1 GB disk for accounts, names and match records.
- **Before real money (step 5):** move to **managed Postgres with automatic backups** (about $6–20/mo),
  because purchase records must never be lost.
- **Domain:** buy a domain name (about $10–15/yr). It's needed for the web store, Sign in with Apple on
  the web, the privacy policy and the store listings.
- **One known catch:** updating the server restarts it and ends matches in progress. Early on, deploy at
  quiet hours. Later, let tables finish before switching over.

---

## 3. The cosmetics economy

### What to sell, and how
- **Catalog as data.** All items go in a data file (e.g. `src/data/cosmetics.js`), used by both game and
  server. Each item has:
  - an id,
  - a slot (outfit colour, hat or hair accessory, gloves, card backs, lantern style, end-screen emote,
    name-plate frame…),
  - how it's unlocked: default, earned by playing, or bought;
  - a price tier.
- **Cosmetics never change the rules** and must **never hint at a role**. For example, keep **red eyes**
  out of the shop, because they are the possessed look and the "known ally" signal.
- **Direct purchase at a fixed price, shown in real money.** Use no paid random boxes.
  - Apple and Google allow paid random items only with published odds.
  - Belgium and the Netherlands treat them as gambling.
  - Brazil bans them for minors (since Mar 2026).
  - Australia rates games with them M or higher (since Sep 2024).
- **No "gem" currency at first.** The EU consumer authorities' March 2025 principles expect real-money
  prices to be shown even when you use a virtual currency. Currency also makes refunds and moving between
  platforms harder.
- **Avatar (decided 12 Oct 2026):** the six guests' models are the six looks, recoloured (skin, hair,
  eyes, outfit, accent, jewellery) with glasses added in the game. New looks, hats and other gear come
  later from the same Blender pipeline, on the same rig, as items in `src/data/wardrobe.js`.

### The inventory lives on the server
- The server keeps a ledger with one row per item owned: account, item, how it was obtained (earned /
  Apple / Google / Steam / web / gift), the store's transaction ID, the date, and whether it was refunded.
- The device only *displays* what the server says you own and are wearing. Other players see your
  cosmetics because the server tells them.
- **Purchase checks ("receipt validation")** confirm with the store that a purchase is real before the
  item is granted:
  - **Apple:** the app sends Apple's signed purchase record; the server verifies it with Apple's App Store
    Server Library. Apple's refund notices remove the item again. The old `verifyReceipt` is deprecated.
  - **Google:** the server checks the purchase token with Google's Play Developer API and then
    **acknowledges it within 3 days**, or Google refunds it automatically.
  - **Steam:** the server starts the purchase (`InitTxn`), Steam shows the approval box to the player,
    and the server completes it (`FinalizeTxn`). Only the server talks to Steam.
  - **Web:** a Stripe (or merchant of record) checkout page, and a "payment succeeded" message to the
    server grants the item.

### Store rules and fees

| Where | Must use | Can you link out to your website? | Fee for a small developer |
|---|---|---|---|
| **Apple App Store** | Apple In-App Purchase for digital items (3.1.1) | **US:** yes, buttons and links are allowed without permission, and Apple currently takes **0%** on those web sales. But the Ninth Circuit (Dec 2025) said Apple may charge a cost-based fee to be set later, and the Supreme Court agreed on 30 Jun 2026 to review the case. **Unsettled.** **EU:** yes, from 1 Oct 2026, with a 15% store-services fee (10% reduced rate) on sales within 7 days of the tap. **Elsewhere:** no links | **15%** with the Small Business Program (under $1M a year), otherwise 30%. EU from 1 Oct 2026: 26%, or 15% reduced |
| **Google Play** | Play Billing, *or* (US/UK/EEA) Google's alternative-billing or web-link programs | US/UK/EEA: yes, through the programs | Since 30 Jun 2026 in US/UK/EEA: **10% service fee** on the first $1M, plus a **5% billing fee** only if you use Play Billing, so **15% total**. A web link means 10% to Google plus about 3% to Stripe. Other countries follow from Sep 2026 to Sep 2027; until then the old 15% applies on the first $1M. The court fight with Epic is still moving |
| **Steam** | **Steam Wallet** through Steam's purchase system for every in-game purchase | **No.** The game can't link to stores that don't take Steam Wallet | **30%** (25% after $10M, 20% after $50M). $100 per app, which is paid back after $1,000 in sales |
| **Web** (your site) | Your own payments | n/a | **Stripe** about 2.9% + 30¢ for US cards, more for international cards. **Plus you must handle VAT and sales tax yourself.** A **merchant of record** (Paddle, Lemon Squeezy, Stripe Managed Payments) handles tax for about 5% + 50¢, or Stripe +3.5% |

**Recommendations:**
- **Inside each app, use that store's own payment system.** Link-outs save only a few percent and add
  legal and technical work. Revisit them if revenue grows.
- **On the web, use a merchant of record.** The stores already handle tax for you, but on the web you'd
  otherwise owe VAT in many countries from the first sale.
- **Before selling on the web, move the web version off GitHub Pages.** GitHub Pages "is not intended
  for or allowed to be used... to run your online business, e-commerce site". Moving to your own domain on
  Render's static hosting or Cloudflare Pages is free or cheap.

### Buying on one platform and using on another
- **Apple (3.1.3(b))** allows people to use items they "acquired… on other platforms or your web site",
  **provided those items are also available as in-app purchases** in the iOS app. So every cosmetic for
  sale must also be sold through Apple IAP.
- **Google** allows it too. In the app, though, you can only point people to other ways to pay through
  Google's programs.
- **Steam:** inside the Steam version, sell only through Steam Wallet and only promote Steam. Many
  cross-platform games do let owned items carry over through a linked account, but **confirm this with
  Valve** before relying on it. Valve's rule for keys sold elsewhere is "don't give Steam customers a
  worse deal".
- **Keep prices the same everywhere.** It's the simplest approach and it keeps every store happy.

---

## 4. Packaging the same game for each platform

### iPhone, iPad and Android: Capacitor (recommended)
- **Capacitor 8** puts our files inside a real app.
  - **On iOS** it runs them in **WKWebView**, the same WebKit engine as Safari. WebGL and Three.js behave
    as they do on iPad Safari today.
  - **On Android** it uses Chrome's WebView.
  - Small plugins add the native pieces: in-app purchase, Sign in with Apple/Google, secure storage for
    the account key, and haptics.
- **The alternatives are worse here:**
  - Cordova is the older version of the same idea.
  - A home-screen web app can't be listed in the stores and can't use in-app purchase.
  - React Native or Flutter would mean rewriting the game.
- **Changes the apps need:**
  - Copy Three.js into the app instead of loading it from a CDN (already planned in `docs/DECISIONS.md`).
  - Keep textures small. iOS ends the web process if memory gets too high, so the app must reload
    gracefully if that happens.
  - Test on the oldest device you want to support.
  - **Decision for you: phones.** The game is designed for iPad landscape. Supporting phones means a
    smaller-screen layout pass. Android is mostly phones; the iOS app could be iPad-only at first.
- **App review risks for a game wrapped from web code:**
  - Apple 4.2 rejects apps that are just "a repackaged website". A full game with native in-app purchase
    and sign-in normally passes, but there must be no links out to the browser.
  - The game code must ship inside the app, not be downloaded from the web.
  - The rules on sign-in (4.8), account deletion (5.1.1(v)), user content (1.2) and in-app purchase
    (3.1.1) all apply.
- **Google Play extras:**
  - **New personal developer accounts must run a closed test with 12 testers for 14 days in a row**
    before publishing. Organisation accounts are exempt.
  - The app must target a recent Android version (Google raises this every year).
  - You must fill in the Data safety form.

### Steam and desktop: Electron (recommended)
- **Electron** bundles its own Chrome, so WebGL looks and performs the same on Windows, Mac, Linux and
  Steam Deck. **steamworks.js** connects it to Steam: login tickets, the overlay (which purchases need),
  and later achievements and cloud saves.
- **Tauri** makes much smaller downloads, but it uses each system's own web engine. On Linux and Steam
  Deck that's WebKitGTK, which has weaker WebGL. It also has no built-in Steamworks support and has known
  overlay problems. The roughly 150 MB Electron download is normal on Steam.
- **Steam also expects** mouse, keyboard and ideally controller support, especially for Steam Deck.
- **Valve's process:** a store page marked "Coming soon" before release, and a review of the build.

### Age ratings, privacy policy and data forms
- **Age ratings:**
  - **Apple's new questionnaire** (ratings 4+, 9+, 13+, 16+, 18+; required since 31 Jan 2026).
  - **Google: the IARC questionnaire**, which produces ratings such as PEGI, ESRB and USK.
  - **Steam: a content survey.**
  - **What will affect the rating:** knives and a revolver, the possession theme, the spooky mood, the
    fact that **players interact**, and **in-app purchases**. Expect a teen rating; the questionnaires
    decide.
- **Privacy:**
  - **A privacy policy page is needed** for every store and for the web.
  - **Apple's "App Privacy" labels and Google's "Data safety" form** must match what we actually
    collect.
  - **Collect very little:** an account ID, the username, linked sign-in IDs, purchases, match records
    and basic server logs. Collect no email unless the player chooses to give one. With **no ads and no
    tracking**, Apple's tracking-permission prompt isn't needed.
- **EU "trader" details:** if you earn money from the app, Apple and Google show your **address, phone
  and email** on the EU store page (EU Digital Services Act).
  - **Decision for you:** publish as an individual (your legal name is the seller name) or set up a small
    company or business address. Apple requires a D-U-N-S number for organisations.

---

## 5. The plan, step by step

Each step is something you can see and test before the next one starts.

### Step 1: Local profile and avatar (now)
- **What it does:** a username sign-up ("Sign the register") and a wardrobe for your avatar: Male / Female,
  six looks, skin tone, hair, eyes, glasses, outfit colours. Everything is saved on the device, with no
  server and no money. The item list is a data file (`src/data/wardrobe.js`), ready for the store later; a
  few items already show as locked, "Coming soon". Bots appear as players: usernames and random looks.
- **Being built (12 Oct 2026)** with the owner's choices: bots look like players, a few locked items shown,
  chat lines that name a guest, bots that talk and listen.
- **Still to decide later:** which items are earned by playing (and how), and which are sold.
- **Cost:** $0.

### Step 2: Per-player view inside the game (the foundation)
- **What it does:** a "table connection" sits between the screens and the rules. Today it runs the rules
  and bots on the iPad ("local table"); later the same connection talks to the server ("online table").
  - The screens read **only your view**: the public board, your hand and role, and your private events.
  - Taps are sent as requests.
  - The seed is hidden.
  - "Door opened" events carry the tile and how it's turned.
  - A test proves your screen receives nothing secret, like the existing bot honesty test.
- **What you'll notice:** nothing should change. You check that matches play exactly as before.
- **Cost:** $0.

### Step 3: Server, guest accounts and private tables with friends
- **What it does:**
  - the `server/` program on Render;
  - guest accounts with names claimed on the server;
  - "Create table" and "Join with code";
  - the turn clock on the server;
  - reconnection;
  - bots in empty seats.
- **Your decisions:**
  - **approve the rule additions** (meeting time limit, disconnects, leavers);
  - buy a domain;
  - open a Render account and add a card.
- **Cost:** about **$8/mo** plus about $12/yr for the domain.

### Step 4: Matchmaking with bots filling seats, plus basic safety
- **What it does:**
  - "Play online": a waiting line, then bots fill the seats after X seconds;
  - report and block;
  - the username filter and reserved names;
  - a small admin page;
  - the in-app "Delete account" button.
- **Your decisions:**
  - the wait time;
  - whether bots are labelled;
  - whether online results count in Your record;
  - the minimum age.
- **Cost:** about **$8–15/mo**.

### Step 5: Store and cosmetics on the web
- **What it does:**
  - linking a Google or Apple sign-in, required before buying;
  - the shop screen;
  - checkout through a merchant of record;
  - the server inventory;
  - a managed database with backups;
  - the web version moved to your own domain (off GitHub Pages);
  - a privacy policy and terms page.
- **Your decisions:**
  - prices;
  - which merchant of record;
  - individual or company;
  - the wording of the policy and terms (a lawyer review is worth it once money is involved).
- **Cost:**
  - **Apple Developer Program, $99/yr** (needed for Sign in with Apple on the web);
  - database about $6–20/mo;
  - about 5% + 50¢ per web sale.

### Step 6: iOS and Android apps with in-app purchase
- **What it does:**
  - the Capacitor apps;
  - Apple and Google purchases, checked by the server;
  - Sign in with Apple and Google;
  - store listings, age ratings, privacy labels and the Data safety form;
  - TestFlight on your iPad, and Google's 12-tester, 14-day closed test.
- **Your decisions:**
  - phone support or tablet-only at first;
  - the store texts and screenshots;
  - joining Apple's **Small Business Program** (15%);
  - signing the paid-apps agreements and filling in the tax and bank forms.
- **Cost:**
  - Apple **$99/yr** (already paid in step 5);
  - Google **$25 once**;
  - optionally a cloud build service.
- **No Mac needed:** the iOS app can be built on cloud Macs (for example GitHub Actions macOS runners or
  Codemagic), so you can stay on the iPad.

### Step 7: Steam
- **What it does:**
  - the Electron app with steamworks.js;
  - automatic Steam login;
  - Steam Wallet purchases;
  - the store page ("Coming soon" first);
  - Steam Deck controls.
- **Your decisions:**
  - the store page art and text;
  - the release date;
  - whether to buy a **Windows PC or Steam Deck for testing**. An iPad can't run Steam games. That's the
    one step where a device is truly needed; development itself returns to the iPad afterwards.
- **Cost:** Steam **$100 per app** (paid back after $1,000 in sales), plus a test device if you don't
  have one.

### Summary

| Step | You get | You decide | Money | Rough effort* |
|---|---|---|---|---|
| 1. Profile and avatar | Name, look, earnable items on the device | Avatar system, first items, name rules | $0 | 1–2 weeks |
| 2. Per-player view | No visible change; ready for online | — (just test that play is unchanged) | $0 | 2–3 weeks |
| 3. Server + private tables | Play with friends by code; bots fill seats | Rule additions (meetings, disconnects), domain | about $8/mo + about $12/yr | 3–5 weeks |
| 4. Matchmaking + safety | "Play online" with strangers; report, block, delete account | Wait time, bot labels, minimum age | about $8–15/mo | 1–2 weeks |
| 5. Web store | Buy cosmetics on the web; owned everywhere | Prices, payment company, company or individual | Apple $99/yr; database $6–20/mo; about 5% per sale | 3–4 weeks |
| 6. iOS + Android | Apps in the stores with in-app purchase | Phones or tablets, store texts, Small Business Program | Google $25 once | 4–6 weeks + review waits |
| 7. Steam | Steam app with Steam purchases | Store page, test device | $100 + device | 3–4 weeks + Valve review |

*Rough calendar time with Claude doing the building and you testing on the iPad between rounds. Reviews
and your testing can stretch it. **Running cost once everything is live, at small scale:** about
$15–35/mo for hosting, plus $99/yr for Apple and a domain. Store and payment fees are taken only from
sales.

---

## The first concrete next step after the current work

**Start step 2.** First, a new file, `src/net/playerView.js`. It takes the bots' `botView()` and adds what
a person's screen needs: guest names and looks, your seat, and tile placements. A test runs real matches
with all hidden information scrambled and proves your view stays identical. Then, one screen at a time
(the hand first, then the HUD, the map, meetings and trades), the screens switch to reading that view
instead of the whole game state. You re-test on the iPad after each switch.

**At the same time, and on your side only:** we write up the rule additions online play needs (the
meeting time limit, disconnects and leavers, whether bots are labelled) as a before/after list for your
approval. That way step 3 doesn't wait on decisions.

---

## Sources

All checked on 12 Oct 2026. The date in brackets is when each source was published or last changed,
where known.

**Apple**
- App Store Review Guidelines: 1.2, 3.1.1, 3.1.1(a), 3.1.3(b), 4.2, 4.8, 5.1.1(v). Current text read on
  12 Oct 2026. https://developer.apple.com/app-store/review/guidelines/
- Offering account deletion in your app (guest accounts included; revoking Sign in with Apple tokens).
  https://developer.apple.com/support/offering-account-deletion-in-your-app/
- Changes for apps in the European Union: terms effective 1 Oct 2026, with the 26%/15%, 20%/10%,
  15%/10% and 5% Core Technology Commission rates.
  https://developer.apple.com/support/apps-in-the-eu
- Apple Newsroom, "Apple announces changes for apps in the European Union" (18 Aug 2026).
  https://www.apple.com/newsroom/2026/08/apple-announces-changes-for-apps-in-the-european-union/
- 9to5Mac, "Apple overhauls App Store fees in the EU with new unified terms" (18 Aug 2026).
  https://9to5mac.com/2026/08/18/apple-overhauls-app-store-fees-in-the-eu-with-new-unified-terms/
- Apple, App Store Small Business Program announcement (18 Nov 2020; 15% under $1M).
  https://www.businesswire.com/news/home/20201118005376/en/Apple-Announces-App-Store-Small-Business-Program
- Apple Developer Program enrolment ($99/yr; D-U-N-S for organisations).
  https://developer.apple.com/programs/enroll/
- Sign in with Apple on the web and Android (Sign in with Apple JS).
  https://developer.apple.com/documentation/signinwithapple/incorporating-sign-in-with-apple-into-other-platforms
- WWDC23, "What's new in App Store server APIs" (Jun 2023; `verifyReceipt` deprecated).
  https://developer.apple.com/videos/play/wwdc2023/10141/
- Apple's new age ratings, 13+/16+/18+ (Business Today, 28 Jul 2025).
  https://www.businesstoday.in/amp/technology/news/story/apple-overhauls-app-store-age-ratings-adds-new-13-16-and-18-categories-486587-2025-07-28
- Apple questionnaire deadline of 31 Jan 2026 (iGeeksBlog).
  https://www.igeeksblog.com/apple-app-store-age-ratings/
- EU trader status shown on the App Store (SD Times, 2024; enforced from 17 Feb 2025).
  https://sdtimes.com/mobile/apple-adds-new-requirements-for-apps-distributed-through-the-app-store-in-the-eu/

**Epic v. Apple (US link-outs)**
- Fenwick, "Ninth Circuit Largely Upholds Ruling in Epic v. Apple" (Dec 2025).
  https://www.fenwick.com/insights/publications/ninth-circuit-largely-upholds-ruling-in-epic-v-apple
- 9to5Mac, Apple asks the Supreme Court to review (21 May 2026).
  https://9to5mac.com/2026/05/21/apple-seeks-supreme-court-review-of-contempt-finding-and-injunction-scope-in-epic-games-case/
- Daring Fireball, Supreme Court agrees to review (30 Jun 2026).
  https://daringfireball.net/linked/2026/06/30/scotus-apple-epic
- The Next Web, the Supreme Court will hear Apple's appeal (Jun 2026).
  https://thenextweb.com/news/supreme-court-apple-epic-contempt-app-store-commission
- Beancount, US link-outs at 0% commission pending a court-set rate (11 Jul 2026).
  https://beancount.io/blog/2026/07/11/apple-app-store-external-purchase-links-accounting-guide

**Google Play**
- Android Developers Blog, "Expanded billing choice and lower fees on Google Play" (24 Jun 2026; 10%
  service fee on the first $1M, 5% billing fee, from 30 Jun 2026 in US/UK/EEA).
  https://developer.android.com/blog/posts/expanded-billing-choice-and-lower-fees-on-google-play
- Outlook Respawn, program rate cards and regional rollout dates (Jun 2026).
  https://respawn.outlookindia.com/gaming/gaming-news/google-play-revamps-billing-with-lower-developer-fees
- Play Console Help, US policies update (notes the 4 Mar 2026 revised Epic settlement).
  https://support.google.com/googleplay/android-developer/answer/15582165
- Stash, Epic v. Google January 2026 hearing and injunction status (Jan 2026).
  https://www.stash.gg/blog/epic-v-google-january-hearing-injunction-android-developers
- Play Console Help, account deletion requirements (in-app plus a web link; Data safety form).
  https://support.google.com/googleplay/android-developer/answer/13327111
- One-time purchase lifecycle (acknowledge within 3 days or it is auto-refunded).
  https://developer.android.com/google/play/billing/lifecycle/one-time
- Android developer verification ($25 registration fee).
  https://developer.android.com/developer-verification/guides/early-access
- Testers Community, the 12-testers-for-14-days rule for new personal accounts (2026; third-party
  summary).
  https://www.testerscommunity.com/guides/how-many-testers-do-you-need-google-play
- Fenwick, Google Play requires loot box odds to be disclosed (May 2019).
  https://www.fenwick.com/insights/publications/google-play-now-requires-disclosure-of-loot-box-odds

**Steam (Valve)**
- Microtransactions: in-game purchases go through Steam Wallet.
  https://partner.steamgames.com/doc/features/microtransactions
- Microtransactions implementation guide (`InitTxn` / `FinalizeTxn`).
  https://partner.steamgames.com/doc/features/microtransactions/implementation
- Free To Play games: "Both purchase paths must use Steam Wallet".
  https://partner.steamgames.com/doc/store/freetoplay
- Review process: "cannot link to other store pages that does not offer Steam Wallet".
  https://partner.steamgames.com/doc/store/review_process
- Steam Direct fee ($100 per product, paid back after $1,000).
  https://partner.steamgames.com/doc/gettingstarted/appfee
- Steam Keys rules (only promote Steam; don't give Steam customers a worse deal).
  https://partner.steamgames.com/doc/features/keys
- User authentication (`GetAuthTicketForWebApi`, `AuthenticateUserTicket`).
  https://partner.steamgames.com/doc/features/auth
- Revenue share tiers 30/25/20% (presskit.gg, 2026; third-party summary of Valve's tiers).
  https://presskit.gg/field-guides/how-much-does-steam-take

**Packaging**
- Capacitor environment setup (Capacitor 8; Xcode 26 and Node 22).
  https://capacitorjs.com/docs/getting-started/environment-setup
- Capawesome, upgrading to Capacitor 8.
  https://capawesome.io/docs/blog/how-to-upgrade-your-capacitor-app-to-capacitor-8/
- "The Struggle of Packaging a JavaScript Game for PC" (Electron vs Tauri; rendering differs by engine).
  https://jslegenddev.substack.com/p/the-struggle-of-wrapping-a-javascript
- Electron and Steam notes (steamworks.js, overlay). https://github.com/JamesMoulang/electron-steam-notes
- steamworks.js. https://github.com/ceifa/steamworks.js
- WebView2 feedback thread on Tauri and Steam overlay problems.
  https://github.com/MicrosoftEdge/WebView2Feedback/discussions/4019

**Hosting and payments** (prices change often; check before buying)
- Fly.io pricing (shared-cpu-1x 256 MB at $1.94/mo). https://fly.io/pricing/
- Render pricing (Starter $7/mo; free tier sleeps after 15 min). https://render.com/pricing
- BudgetForge, Render pricing summary (disk $0.25/GB; Postgres from $6) (2026).
  https://www.budgetforge.dev/tools/render-pricing-2026
- Livemy.app, Railway pricing explained (2026). https://livemy.app/blog/railway-pricing
- PrivateDevOps, Hetzner June 2026 price increase.
  https://privatedevops.com/news/hetzner-june-2026-cloud-price-increase-what-to-do
- Cloudflare Durable Objects pricing (WebSocket hibernation).
  https://developers.cloudflare.com/durable-objects/platform/pricing
- Colyseus pricing (Cloud from $15/mo). https://www.colyseus.io/pricing
- Heroic Labs (Nakama / Heroic Cloud) pricing. https://heroiclabs.com/pricing
- PlayFab pricing (development tier; Standard $99/mo).
  https://developer.microsoft.com/en-us/games/products/playfab/pricing/
- AccelByte, the PlayFab free tier cut (2026).
  https://accelbyte.io/blog/playfab-just-cut-its-free-tier-by-99.-heres-what-that-means-for-your-game
- Stripe pricing. https://stripe.com/pricing
- Dodo Payments, Stripe Managed Payments fees (May 2026; competitor's analysis).
  https://dodopayments.com/blogs/stripe-managed-payments-fees-explained
- DevToolLab, merchant-of-record comparison (Paddle and Lemon Squeezy 5% + 50¢; checked Sep 2026).
  https://devtoollab.com/blog/best-merchant-of-record-platforms
- GitHub Pages limits ("not intended… to run your online business, e-commerce site").
  https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits

**Loot boxes, virtual currency, age and child-safety laws**
- Mattos Filho, Brazil's ECA Digital in practice (Law 15.211/2025; in force 17 Mar 2026).
  https://www.mattosfilho.com.br/en/unico/brazils-eca-digital/
- MediaLaws, "The ECA Digital, a game-changer for online gaming in Brazil".
  https://www.medialaws.eu/the-eca-digital-a-game-changer-for-online-gaming-in-brazil/
- Checkpoint Gaming, Australia's new classification rules for games with paid random items (Sep 2024).
  https://checkpointgaming.net/news/2024/09/australia-implements-new-regulations-classifying-new-games-with-gambling-like-content-as-adults-only
- Programming Insider, loot box regulation in 2026 (Belgium and the Netherlands).
  https://programminginsider.com/loot-boxes-regulation-and-where-the-line-sits-in-2026/
- Bird & Bird, the EU CPC key principles on in-game virtual currencies (21 Mar 2025).
  https://www.twobirds.com/en/insights/2025/european-move-towards-protecting-users-from-harmful-practices-in-video-games-eu-consumer-protection
- CCIA, the appeals court pauses the injunction on the Texas App Store law (May 2026).
  https://ccianet.org/news/2026/05/appeals-court-pauses-injunction-on-texas-app-store-law-that-likely-violates-first-amendment/
- Future of Privacy Forum, "Comparing Enacted App Store Accountability Acts" (Texas, Utah, Louisiana).
  https://fpf.org/blog/comparing-enacted-app-store-accountability-acts/

*Where only a third-party summary was available (some Google, Steam and hosting figures), it is marked
above. Treat those numbers as close but not final, and confirm them on the official page before paying or
launching.*
