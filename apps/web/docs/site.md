# KIASA company site: plan and first design

All paths below are relative to `apps/web`.

This is the first full design of the company site: the homepage and every
page it links to, 77 in all, each modelled on the matching page of the model
site and filled with sample content.

## The model

The structure follows the homepage of Accenture, the largest IT consulting
company, section for section. The content, the visual language and every
drawing are KIASA's own.

| Accenture's homepage | KIASA's homepage | Notes |
| --- | --- | --- |
| Header: logo, four items (three open a panel of links), search, country | Header: leaf and name, **What we do**, **What we think**, **Who we are**, **Careers**, **Sign up**, search, region | Same layout and the same panel structure: a title, then groups of links. On phones the navigation becomes one menu. Sign up is KIASA's own: a small leaf-green button just before Search, on phones too, opening the sign-up page (a request for an account, which a person at KIASA approves; each sign-in is then a link sent by email, with no password). Signed in, the button gives way to the person's initials, a link to their account. |
| Hero: a two-line headline in capitals with the second line set in; a short statement and one link beside it; behind them a plant drawn in points of light, turning slowly, and a pause button | **Where change takes root**; "Grown, not bolted on"; **See what we do**; the KIASA plant in points of light, turning slowly on a low mound of soil, seen from a little above. The headline and its statement sit below the plant, so no text covers it. | The full stop of the headline is a drop of dew. The logo shows the plant from straight above, so the plant is built that way: the drawing laid flat, with only height added (each leaf rises from the heart, arches and dips toward its tip; the bud stands up as a sprout, curled a little like a young leaf). The camera looks down on it as it turns, like a plant on a turntable, so it is always the leaves' upper faces that show and the drawing never has to show a back; from straight above, the points are exactly the drawing. The leaves are filled with a deep emerald that glows toward luminous jade at their borders, and a slow glow passes out from the heart along them; their lines stay in the pale ink. The sprout is the brightest thing, in a fresh green with a soft glow. Each dew drop holds still where the logo has it, as dew does, sitting on top of its leaf, flat where it rests and a little smaller than the ring the logo draws: it is drawn first into depth, so nothing behind it shows through. It has no light or colour of its own: through it the leaf's glow shows; toward its soft edge, where the leaf still shows faintly through, it gives back a slight blue of sky; and it gives back the sun, a small warm-white glint on the side toward the light. The sun holds still while the plant turns, so the glints travel over the drops. `hero.background` in `site.ts` brings back the earlier background: the veins of a leaf, shaded like a curved blade and rippling in a light wind, with small green lights travelling along them. |
| Eight cards in two rows: announcement, perspectives, research reports | Eight cards: one announcement, two perspectives, four research reports, one case study | A card opens a panel with its summary and a link, as Accenture's cards expand. |
| A quotation from the chief executive beside a portrait | A quotation from the managing partner beside a photograph | A photograph of a leaf stands in until there is a portrait. |
| Client spotlight: a film, and four client stories with "Explore" | Client spotlight: the film series "Grown with KIASA", and four client stories | |
| Global recognition and awards: a large heading that stays in place while three coloured cards pass over it | Recognition and awards: the same movement, in leaf green, dew blue and forest green | Done with CSS only. On phones the cards are a simple list. |
| Careers: a photograph to the edge of the window, a heading, a line in a serif face, "Join us" | The same | |
| News: a row of large dated headlines that moves on, with pause and arrows | KIASA news: the same | It waits while pointed at, focused, off screen, or when reduced motion is asked for. |
| Footer: the tagline over the name, a row of links, the legal line | "Where change takes root" over KIASA, the same ten links, the legal line | Plus one line saying the content is sample content. |

## What makes it KIASA's

- **One visual language.** The site uses the loading mark's language: a
  near-black green ground, pale ink, line drawings, a soft green
  (`#B8EC93`, the loading bar's colour) for actions, and the blue of the dew
  (`#45C8FF`) as a rare second accent.
- **The leaf is never redrawn.** The header and footer use the same full line
  drawing as the loading mark (`LeafMark` in `src/components/site/brand.tsx`),
  with heavier lines at small sizes so every vein still reads.
- **Type.** Schibsted Grotesk for headings and text, Newsreader (a serif) for
  the few quieter lines. Both are self-hosted by `next/font`; the browser makes
  no request to Google.
- **Drawings instead of stock illustration.** The pictures on the light and dark
  cards are generated line drawings (`src/components/site/plates.tsx`): a
  seedling whose roots run through layers of ground, the rings of a tree, a
  field of readings, a signal. Each carries a drop of dew, drawn as the logo
  draws it.
- **Square corners, no shadows, no gradients on type.** Colour is used in large
  flat areas, as on the model.

## The pages

Every page the site links to is designed, 76 of them plus the homepage, each
in the form of the model's page of the same kind and filled with sample
content.

**Pages are data.** A page is a `PageDoc` (`src/content/blocks.ts`): its
address, title, section, one-line summary, and a list of blocks, the first of
them a hero. One renderer (`src/components/site/blocks/`) draws every block in
the model's section patterns and KIASA's visual language, so a page is written,
not built. The contract lists 22 blocks: four heroes (photo, split, plain,
article), intro, stats, features, the homepage's cards, media cards, accordion,
split, quote, closing call, prose (with an "In brief" panel), people, links,
open roles with search and filters, forms (contact, preferences, cookies, sign-up),
wordmarks, steps, studios, news rows, contacts, facts and film. Light tones
(`paper`, `leaf`) break the night as the model's white sections do.

The content is in `src/content/docs/`, one file per area. The catch-all route
`src/app/[...slug]/page.tsx` draws a page from its record and pre-renders all
of them; any address not in the plan is a 404 (`src/app/not-found.tsx`).
`src/content/pages.ts` still collects every address the site links to, for
search and the link checks.

**KIASA Canopy** (`/canopy`) is a practice page like Accenture Construct: its
own header (the leaf, a rule, "KIASA Canopy", then Home, Who we are, Contact
us) and the model's eight sections, from the bridge across the first screen to
"Get a clear view of what's next". The homepage's announcement card opens it.

**Photo heroes arrive as dew.** Like the glyph reveal on the model's practice
pages, a full-width hero's photograph first appears as a field of dew drops read
from the photograph itself (a speck in its shadows, a ring in its mid-tones, a
full drop with its glint where it is brightest; a few catch green and one the
dew's blue), then the drops clear, the brightest first, in about two seconds
(`src/components/site/blocks/reveal.tsx`). A night cover keeps the photograph
hidden until the drops take over; without script it simply fades, and for
reduced motion there is no reveal.

**Cards** behave as on the model: the whole card is a link to its page;
pointed at or focused it grows a little, its picture gives way, and its summary
and "Expand" come up in its place.

| Section | Pages |
| --- | --- |
| What we do (27) | Its own page, 14 capabilities, 12 industries |
| What we think (7) | The insights listing and the six pieces linked from the cards |
| Who we are (8) | Its own page, how we work, leadership, locations, partners, sustainability report, awards, analyst recognition |
| Newsroom (9) | The newsroom, media relations, seven news items |
| Careers (10) | Its own page, search for jobs, career areas, early careers, working here, benefits, learning and growth, careers blog, hiring journey, interview tips |
| Client stories (6) | The listing, the film series and four case studies |
| Footer (7) | Contact, sitemap, privacy, terms, cookies, accessibility, preferences |
| Header (1) | Sign up |
| Practice (1) | KIASA Canopy |

**Accounts** are real, on Supabase, once it is connected (see [Connecting
accounts](#connecting-accounts)). Sign up is a request: a visitor asks on
`/sign-up`, choosing a password, and lands, signed in, on their request page
(`/account`), which shows its status from the database, so a refresh never loses
it. A person at KIASA approves or declines it on `/admin`. The request page
watches for that decision: the moment it is approved, the page becomes the
person's account, with a welcome. If they pressed "Alert me on this computer",
their computer also tells them, through the browser's own alert service, even
with no KIASA page open (`public/sw.js`, `src/lib/accounts/push.ts`; kept for a
week if the computer is off; never in a private window, which blocks alerts). Anyone who has left signs in later at
`/sign-in` and is welcomed on their first visit since the approval. The private pages are not linked from the public site's navigation or
listed in search or the sitemap, and they ask search engines not to index them.

- **`/admin`** is for KIASA's admins only: the emails in the `admins` table,
  chrislim@kiasa.tech first. It has its own bar (KIASA Admin, who is signed in,
  back to the site, sign out). It counts the requests waiting, approved and
  declined; lists the requests waiting, newest first, with Approve and Decline;
  and lists everyone who has asked, with a search by name, email or
  organization, a filter by status, and Delete (which asks first; it removes the
  sign-in and the request together, and never an admin's own). It is live: a
  new request, a decision or a deletion made elsewhere appears without
  reloading. A marker says whether live updates are flowing; when they are not,
  the page checks every 30 seconds, and whenever the admin returns to the tab.
- **`/account`** shows the signed-in person's details, the monthly research
  digest as a switch, Sign out, and Delete (which asks first, then removes the
  sign-in and the request together). What will gather there later (reports for
  clients, saved reading, events) is said plainly. An approved member changes
  their own details there: **Edit details** (name, organization, why they
  joined; a new name reaches their chats, the leaderboard and the header's badge
  at once) and **Change password** (their current one first, then the new one
  twice). The email is how they sign in: to change it, they ask a person at KIASA.
- In the header, anyone signed in sees their initials where Sign up was, a link
  to their account (or, for an admin, the admin page).
- Until Supabase is connected, the private pages show their sample design with
  a "Preview" note: the sample people are in `src/content/accounts.ts`, with
  addresses on the reserved `.example` domain, and nothing is kept.

Security, in short: passwords are kept by Supabase, scrambled, never by the
site. The site's secret key stays on the server. Every action checks who is
asking (an admin, or the person themselves), not just the page. The database's
own rules let a browser read only its owner's request, or every request for an
admin. Without an email service, an address is not proved to belong to whoever
gives it; the admin's approval is the check. A hidden field turns away simple
robots.

Company facts the pages share, so they agree: founded in London in 2012, owned
through an employee ownership trust, 420 people in eight studios (Lisbon,
Amsterdam, London and Nairobi; Toronto and Austin; Singapore and Melbourne).
Lisbon is the first engineering studio and Melbourne, opened July 2026, the
second. Emissions in 2025: 1,840 tonnes CO2e, 4.4 tonnes per person.

## Sample content

The homepage's words are in `src/content/site.ts`: the
navigation, the hero, the eight cards, the quotation, the client stories, the
recognition cards, the careers text, the news and the footer.

**All of it is placeholder content.** The clients (Halden Mutual, Osprey
Freight, Tessera Health, Varda Energy), the people (Elena Marsh, Daniel
Okafor), the product name Canopy, the figures, the awards and the dates are
invented so the design can be judged with realistic copy. None of it is a
statement about KIASA. Before the site is public:

1. Replace the content in `src/content/site.ts` and `src/content/docs/`.
2. Replace the photographs (see below).
3. Set `SAMPLE_CONTENT` to `false` in that file. This removes the line in the
   footer that says the content is sample content.

## Photographs

The portrait beside the quotation, `portrait.jpg`, and the bridge on the
Canopy page, `stock/canopy-bridge.jpg`, were supplied by KIASA. The other five
photographs in `src/assets/media/` are placeholders from Unsplash,
free to use under the Unsplash License.

The inner pages use 68 more photographs in `src/assets/stock/`, chosen from the
Lorem Picsum collection: every one is an Unsplash photograph, free to use under
the Unsplash License. `src/content/photos.ts` is their registry: a key, a
description used as the alternative text, the photographer and the Unsplash
source of each. Pages name a photograph by its key. People in them are not KIASA
staff, and no invented person is ever shown with a photograph. Replace them with KIASA's own
photography when there is some; the people in `studio.jpg` are not KIASA staff.

| File | Used for | Photographer | Unsplash photo |
| --- | --- | --- | --- |
| `portrait.jpg` | Beside the quotation | Supplied by KIASA | — |
| `stock/canopy-bridge.jpg` | KIASA Canopy hero | Supplied by KIASA | — |
| `river-road.jpg` | The film in Client spotlight | Ben den Engelsen | `photo-1596779845727-d88eb78a1b08` |
| `studio.jpg` | Careers | Drew Dempsey | `photo-1678282931256-370578a0d036` |
| `blue-leaf.jpg` | Card: The maintenance dividend | Amin Alizadeh | `photo-1673554227888-f33f40a90055` |
| `forest-road.jpg` | Card: Halden Mutual | Giordano Rossoni | `photo-1637058468176-30aa8c88bb6b` |
| `leaf-tip.jpg` | Card: Security debt | Alexandra | `photo-1695551527664-585082953b87` |

## How it is built

| File | What it is |
| --- | --- |
| `src/app/page.tsx` | The homepage, wrapped in `StartupBoundary` so the loading mark stands in front of it on every load. |
| `src/app/[...slug]/page.tsx`, `src/app/not-found.tsx` | Every inner page, drawn from its record, and the 404 page. |
| `src/content/blocks.ts`, `src/content/docs/*.ts` | The page contract, and every page's content, one file per area. |
| `src/content/photos.ts`, `src/assets/stock/` | The stock photographs and their credits. |
| `src/components/site/blocks/*.tsx`, `src/styles/site-blocks.css` | The renderer: one component per block, the practice header, and their styles. |
| `src/content/site.ts`, `src/content/pages.ts` | The sample content, and the list of pages built from it (also what Search looks through). |
| `src/components/site/shell.tsx` | Header, content, footer: what every page shares. |
| `src/components/site/header.tsx` | The header and its panels: navigation, the Sign up button, search, region, and the menu on phones. |
| `src/components/site/hero.tsx`, `hero-plant.tsx`, `plant-cloud.ts`, `hero-field.tsx`, `motion-toggle.tsx` | The hero; its turning plant (the points built from the logo's drawing, laid flat and given height, in `plant-cloud.ts`; drawn with WebGL in two passes a frame, the drops first into depth so they hide what is behind them, one turn in 40 seconds, after the loading mark has gone; without WebGL the hero is simply dark); the earlier background of veins and lights (plain SVG), shown instead when `hero.background` is `"veins"`; and the pause button. |
| `src/components/site/featured.tsx`, `story-grid.tsx`, `plates.tsx` | The eight cards (each a link to its page), and the nine line drawings used as patterns. |
| `src/components/site/voice.tsx`, `spotlight.tsx`, `recognition.tsx`, `careers.tsx`, `news.tsx`, `news-rail.tsx`, `footer.tsx` | The remaining sections. |
| `src/components/site/brand.tsx`, `icons.tsx`, `cta.tsx` | The leaf and the lockup, the icons, the arrow link. |
| `src/app/sign-in/page.tsx`, `src/app/account/page.tsx`, `src/app/admin/page.tsx`, `src/components/site/sign-in-form.tsx`, `account.tsx`, `account-details.tsx`, `account-actions.tsx`, `admin.tsx`, `admin-desk.tsx`, `avatar.tsx`, `your-photo.tsx`, `src/styles/site-account.css` | Signing in, a person's account, where KIASA approves who may sign in, and each person's photo (`avatar.tsx` draws a square, photo over initials; `your-photo.tsx` sets it). |
| `src/lib/accounts/` | Accounts on Supabase: `server.ts` (who is signed in, the site's own access, server only), `actions.ts` (request, sign in and out, approve or decline, a member's details and password, the digest, delete), `browser.ts` (hearing about changes live), `viewer.ts` (the header's badge cookie, with the photo's address). `src/proxy.ts` keeps sessions fresh on the private pages. |
| `supabase/migrations/*.sql`, `supabase/config.toml`, `.env.example`, `src/content/accounts.ts` | The database's tables and rules, in order (accounts, chat, chat speed, photos, then chat more); the local copy's settings; the settings the site needs; and the sample people shown until it is connected. |
| `src/app/chat/page.tsx`, `src/components/chat/*`, `src/lib/chat/*`, `src/styles/chat.css`, `scripts/chat-local/*` | KIASA Chat: the page, its parts, its server side (who may chat, groups, direct chats, account notices), its look, and its end-to-end test against a local copy of Supabase. |
| `src/components/site/route-progress.tsx`, `page-loading.tsx`, `src/app/*/loading.tsx`, `src/styles/site-loading.css` | Moving between pages: the leaf line along the top of the window from the click until the next page is there, and each private page's loading screen in the shape of the page (see "Speed between pages"). |
| `src/styles/site*.css` | The site's styles, one file per part. Colours and typefaces are variables in `src/app/globals.css`. |

Most of the page is rendered on the server and needs no script. Script is used
only where something has to respond: the header's panels and search, the news
row, the hero's turning plant and its pause button, the open roles' search and
filters, the forms (which, except sign-up and sign-in, are not connected yet,
and say so when sent), and the admin page's decisions, search and filter.
Without JavaScript the whole page is still readable.

### Speed between pages

A click on a link to another page starts a thin leaf line along the top of the
window at once (`route-progress.tsx`, in the root layout); it runs until the
next page is there, through its loading screen, as one line, then fills and
fades. The private pages (`/account`, `/sign-in`, `/admin`, `/chat`,
`/jobs`) are made on the server for each visit, so each has a `loading.tsx`:
the screen shows the moment the page is asked for, in the page's shape (the
site's own header for the account and sign-in; the desk's bar, then the jobs
tiles, the chat list or the admin's heading). Links fetch ahead in a production
build (`next build` and `next start`, or Vercel): the site's own pages whole,
the private pages' loading screens.

The server asks Supabase for what a page needs in as few trips as it can: the
jobs desk asks for who is looking, the day's jobs, the board, plans, résumés,
the team and the reports waiting all together (the team's time zone is kept a
minute, so the day's jobs need not wait for it); the admin page asks for who is
looking and the requests together. Its calls go over connections kept open a
minute (`undici`, in `src/lib/accounts/server.ts`): Node lets one go after
four idle seconds, and far from Supabase a new one costs more than the call.
Measured from the office computer: a call takes about 0.35 s on a kept
connection and 0.8 to 2 s on a new one; twelve calls at once after eight
seconds of reading took a median 0.71 s kept against 2.0 s.

`npm run dev` is slower than the site will be: it builds each page the first
time it is opened (and again after a change), and it does not fetch ahead. To
judge speed, use a production build.

Motion follows three rules. It stops for visitors who ask for reduced motion.
Anything that moves by itself for more than a moment can be paused. Nothing
moves the layout: the measured layout shift is zero.

## What comes next

1. Decide the real content: what KIASA offers, for whom, with which proof, and
   replace the sample pages area by area in `src/content/docs/`.
2. Replace the photographs with KIASA's own.
3. Before going public: connect the forms to someone who reads them, a cookie
   notice if analytics are added, social sharing images, and checks in Safari,
   Firefox and on real phones.
4. For accounts: an email service (for example Resend, with DNS records on
   kiasa.tech), so people can be told when they are approved, reset a forgotten
   password themselves, and prove their address; and a real privacy statement
   before real people's details are collected on the public site.

## KIASA Chat

The team's own chat, at `/chat`, for approved people and KIASA's admins,
working as Telegram does (still to come: mentions, link previews, folders,
polls, stickers, voice messages, calls, channels, stories, translation).

- **Fast.** A message goes by two routes at once: straight from the writer's
  browser to the others' over the chat's private live channel (about 0.16 s on
  the real Supabase, 0.04 s on the local test copy), and into the database,
  whose copy, checked by its rules, follows and takes the straight copy's
  place; a straight copy the database never confirms is taken away again
  within a few seconds. What you send shows at once, marked as sending, and can
  be sent again if it fails. The newest chats' latest messages are loaded ahead,
  so they open at once; the chat list comes in one answer, a direct chat that
  exists opens without asking the database, and a new chat or group is made in
  one trip. Opening the page asks the database once (sign-ins are checked on the
  site's own server against Supabase's published key). Edits, deletions, read
  marks and a new chat's first message go by the database's route (about 0.6 s).
- **Chats.** Direct messages between any two people who may chat; groups made
  by admins, who can add people later; and KIASA's notices: new account
  requests arrive in the admins' "Account requests" chat as cards they can
  approve or decline right there, and an approved person is welcomed in their
  own chat with KIASA.
- **Messages.** Replies with a quote, edits (marked "edited"), pictures shown
  in place and files up to 20 MB, kept private to the chat's members. A file
  (from the paperclip, pasted, or dropped on the conversation) is shown first,
  as in Telegram, to add a caption and send; its message then shows at once,
  with a ring that fills as it goes up and how much has gone ("448 KB /
  1.2 MB"), × to stop it, and "Send again" if it fails. A file's card
  downloads it under its own name (↓ in its round mark, which fills as it
  comes down; × stops it); a picture opens in a new tab, and downloads from ↓
  beside Reply. A
  message's menu (a right-click, a long press on a phone, or its ⋯) has
  reactions (one each, from twelve), Reply, Copy, Download and Open (for files
  and pictures), Edit, Pin, Forward, Select and Delete. Deleting asks first: for oneself, or for everyone, which is
  allowed for one's own messages, for anyone's in a one-to-one chat (as in
  Telegram) and for anyone's in a group one runs (its owner, or a KIASA admin).
  Select chooses several to copy, forward or delete together. Forwarded
  messages say whose they first were; a pinned message shows above the
  conversation; Search finds words in a chat and jumps to them.
- **A chat's menu** (a right-click or long press on it in the list, or ⋮ in
  the conversation): Open in new tab, Mark as read or unread, Pin (to the top),
  Mute (no alerts, a grey count), Archive (into "Archived chats"), Clear
  history (for oneself, or for both or everyone) and Delete chat (gone from
  one's list, its history cleared, until a newer message or until one opens it
  again; for both, if asked) or, for a group, Leave or Delete. Each person's
  pins, mutes and archive are theirs alone. Searching the list finds people
  too, under "People", so someone whose chat was deleted is found again.
- **The ☰ menu**: Saved Messages (one's own chat, to keep messages and notes),
  Contacts, Archived chats and Settings: one's photo, name, status, username
  (by which people can be found) and bio, alerts on this computer, and Edit
  profile. A chat's name opens its info: the person (status, username, bio,
  who they are) or the group's members. "Last seen" shows when someone not
  online was last here.
- **Look.** Drawn as Telegram is, in KIASA's colours. The conversation sits on
  KIASA's leaves (`src/assets/media/chat-wallpaper.webp`, 71 KB, from KIASA's
  own picture), darkened a little, with the whole picture shown when no chat is
  open; bubbles are solid so the words always read first. One person's messages
  in a row (within five minutes) form a run: tight corners where they meet, a
  tail on the last, and in a group the writer's name in their own colour on the
  first and their face beside the last. The time and the ticks (drawn: ✓ sent,
  ✓✓ read) follow the last words. Reactions are soft pills with the faces of
  who gave them (a count past three). A few emoji alone show large, without a
  bubble. A message's Reply and ⋯ float beside it while it is pointed at (above
  it, once tapped, on a phone), so nothing around it moves. Writing is one
  rounded field, with the paperclip inside, and a round send button. A new chat
  starts from the round pencil at the foot of the list (for admins, a choice of
  a message or a group); the list speaks of the connection only while it is not
  live ("Connecting…", "Reconnecting…").
- **Photos.** Each person sets their own from their square at the top of the
  chat, account or admin page: choose a picture, drag and zoom it in a square,
  save. It is made small in the browser (320×320, WebP where it can) and shows
  in the site's header, the chat list, conversations and the people picker,
  changing live for everyone. Photos are public by their address, which is
  random and never reused, so they load at once and browsers keep them; only
  their owner can write them, and they go with the account.
- **Live status.** Unread counts, ✓ sent and ✓✓ read, "…is typing", and who
  is online.
- **Alerts and the tab's count.** Every KIASA desk tab (the chat, the jobs
  desk, the admin and account pages) carries the unread count, muted chats
  aside: a red badge with the number on the leaf (`tab-badge.ts`, so a pinned
  tab shows it) and "(3)" before the title. A new message from someone else, in
  a chat not muted, is an alert on the computer (Windows' own notification):
  each open desk hears it (the chat by its own live route, the others through
  `chat-watch.tsx`) and hands it to the service worker (`public/sw.js`),
  which shows it once, titled with the person or the group, unless KIASA Chat is
  the window in front. A click brings KIASA forward with that chat open, in
  place. A message that comes while the person is in another window stays
  unread until they are back. The chat asks once, above its list ("Turn on";
  "Not now" puts the question away for two weeks); Settings turns alerts on,
  sends a test alert once on, and says how to allow them again if the browser
  blocks them. Alerts come while a KIASA desk is open in the browser; with none
  open, nothing shows.
- **Private by the database.** Every rule is in the chat migrations: a person
  reads and writes only in chats they belong to (and sees nothing they cleared
  or deleted for themselves); notices come only from KIASA;
  times are the database's; the live channels are private to each chat's
  members. A straight copy is shown only if it claims a writer who is in the
  chat, and stands only until the database confirms it or not.

To test it end to end on this computer (Docker needed): `npx supabase start`
(it applies the migrations), `npm run chat:local:seed` (made-up people, local
only), then build and serve the site against the local copy on port 3002, with
its address and keys from `npx supabase status -o env` given as
`SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and
`SUPABASE_SECRET_KEY`, and run `npm run chat:local:e2e`. Each run starts by
clearing the local copy's chats and the visitors earlier runs made, so it can be
run again and again. `npx supabase stop` when done.

## KIASA Jobs

`/jobs` is the team's job desk (`src/app/jobs/`, `src/components/jobs/`,
`src/lib/jobs/`, `src/styles/jobs.css`), for approved members and admins, in
the chat's look. Anyone else signed in is sent to their account. Days, weeks
and months follow the team's time zone (set on an admin's first visit to their
own, changeable under Plans).

- **Admins post the day's links with the jobs bot** (Jobs tab,
  `src/components/jobs/jobs-bot.tsx`): paste them, as many as there are, in
  any text (bare links, `Title | Company | link` lines, a newsletter); there is
  no button: the bot saves every link at once (tracking parts taken off,
  LinkedIn and Indeed links reduced to the job's own address, a link already
  posted left out, so each job is posted once), says so with an Undo, then
  reads each posting, twelve at a time on the server (`readJobs` in
  `src/lib/jobs/actions.ts`: admins only, public addresses only, six seconds
  each), for its title, the company hiring and where: first from what the page
  tells search engines (schema.org JobPosting), then from its title; a hiring
  site's own name is never taken for the company, and what an admin typed is
  kept. It reports each job as it goes, and those whose page would not say, to
  be named with ✎. The day's list below shows, for each job, how many on the
  team have applied, its interviews, offers and hires, and who is where.
- **Members work through the day** (Today): their plan at the top (each target
  with its progress, and the admins' notes), then the day's jobs, newest first.
  Open ↗ opens the posting; ✓ Applied marks it at once, with the résumé chosen
  above the list, and the dropdown beside it (▾) gives any other status. From
  then on the status itself is a dropdown (Applied, Interview, Offer, Hired,
  Rejected, Skipped), led by "Not applied: back to To do" for a click made by
  mistake; a job marked stays in sight in the list it was marked in until the
  list changes, so the mistake can be put right at once. Interview asks for
  the time and puts it on the calendar; Hired asks for the monthly salary.
  Earlier days are a click back. My jobs gathers every application across
  days, interviews and offers first.
- **Calendars.** A week of interviews, live: a member's own; for admins,
  everyone's or one member's. Each opens to its details and outcome.
- **The leaderboard**, for everyone on the team: each member's jobs held,
  estimated monthly salary, pay this month and in all, applications today and
  this month, interviews, and when they last applied, ranked by any of them.
  Jobs and pay count once an admin confirms them (Confirm tab, with the figure
  correctable first); a member's own Earnings tab lists theirs.
- **Live, for admins**: today's applications member by member against their
  goal, when each last applied, their last 14 days, and the team's last 30
  days (with the team's goal for a day, dashed) and today hour by hour; then a
  card for each member, with their day against their goal, their last 30 days
  (their goal dashed) and today hour by hour, every card on the same scales so
  they compare. It moves as members apply.
- **The day's goal.** Every member's goal is 100 applications a day
  (`DAILY_GOAL` in `jobs-format.ts`), unless an admin's plan for them sets
  another; it shows above their list, on Live and in Plans.
- **Plans, for admins**: each member's targets (applications, interviews,
  offers) and a note, for a day, a week or a month. Targets carry on until
  changed; a note is for its own period.
- **Résumés.** Each member keeps versions (PDF or Word, up to 10 MB) in a
  private store only they and admins can open; each shows its applications,
  interviews and offers, so the one that gets interviews is plain.
- **By the database** (`supabase/migrations/20261026235000_jobs.sql`): members
  write only their own rows; the database stamps the times; what members
  report waits for an admin, and changing it asks again; the leaderboard comes
  from functions that give totals only. Changes reach the pages live, and a
  word on the team's private channel tells every page when the leaderboard has
  moved.

### Top managers and badges

On the admin page, each approved person has a **Role**: Member or Top manager.
A top manager wears KIASA's leaf (the logo's own, `public/brand/kiasa-leaf-badge.png`)
at the bottom right of their photo, like a verified mark, wherever it appears (the chat, Jobs, the admin page, the site's header);
KIASA's admins wear the leaf and a crown. A badge given or taken away reaches
every open page at once. Jobs' Live view leaves top managers out: no card, no
row, no part of the team's goal. Only the site's server changes the list
(`setTopManager`, after checking the admin); everyone who may chat can read it
(`supabase/migrations/20261027090000_top_managers.sql`). The header of the
public pages reads the badge from the sign-in cookie, which each private page
brings up to date.

To test it on this computer, after the chat's steps above: run the jobs file on
the local copy (`npx supabase migration up --local`), `npm run jobs:local:seed`
(a made-up month: four more members beside Ana and Ben, thirty days of links
and applications, interviews, jobs won, pay, plans, résumés), serve the site
against the local copy on port 3002, and run `npm run jobs:local:e2e`.

## Connecting accounts

Once, in this order:

1. **Create the database.** In Vercel: the KIASA project → Storage → Create →
   Supabase (Vercel then holds its keys for kiasa.tech). Or at supabase.com,
   then copy the keys into Vercel's Environment Variables yourself.
2. **Give the keys to your computer.** Copy `.env.example` to `.env.local` and
   fill it in from Supabase → Project Settings → API Keys (or run `vercel env
   pull .env.local`). `.env.local` is never committed.
3. **Make the tables.** Supabase → SQL Editor → New query → paste
   `supabase/migrations/20261026120000_accounts.sql` → Run; then the same for
   `supabase/migrations/20261026180000_chat.sql` (KIASA Chat), then
   `supabase/migrations/20261026210000_chat_speed.sql` (its speed),
   `supabase/migrations/20261026230000_avatars.sql` (photos), then
   `supabase/migrations/20261026233000_chat_more.sql` (deleting, clearing,
   pinning, muting and archiving, reactions, forwarding, Saved Messages,
   profiles, last seen), then
   `supabase/migrations/20261026234500_chat_reopen.sql` (a deleted chat back
   in the list when opened again), then
   `supabase/migrations/20261026235000_jobs.sql` (KIASA Jobs), then
   `supabase/migrations/20261027090000_top_managers.sql` (top managers).
   Each file is safe to run again.
4. **Make the admin.** Supabase → Authentication → Users → Add user → Create
   new user: chrislim@kiasa.tech, a password of your choosing, and tick "Auto
   Confirm User". Only you know that password; the site never sees it.
5. **Close the side door.** Supabase → Authentication → Sign In / Providers:
   turn off "Allow new users to sign up". The site still creates accounts (it
   uses its secret key); this only stops anyone making one around the approval.
6. **Restart** `npm run dev`, then try it: ask for an account at `/sign-up`,
   sign in at `/sign-in` as chrislim@kiasa.tech, approve it on `/admin`, and
   sign in as the new person. For kiasa.tech, deploy once the keys are in
   Vercel.

7. **Alerts on people's computers.** The accounts migration also makes the
   table that remembers where to send them (run it, or just its last part).
   The site's push keys are in `.env.local` (`VAPID_PUBLIC_KEY`,
   `VAPID_PRIVATE_KEY`); for kiasa.tech, copy both into Vercel → Settings →
   Environment Variables yourself, then deploy. Without them, the "Alert me"
   button does not appear.

To add an admin: add a user in Supabase as in step 4, then, in the SQL Editor,
`insert into public.admins (email, name) values ('name@kiasa.tech', 'Their Name');`.

The test suite checks the sample pages and must never reach the real database
(its sign-up test sends the form). Once the keys are on your computer, blank
them for both the build and the server it tests, e.g. in Git Bash:
`SUPABASE_URL= NEXT_PUBLIC_SUPABASE_URL= NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY= SUPABASE_SECRET_KEY= npm run build`,
then start the server with the same blank values. Values set this way win over
`.env.local`.
