# Bookmark grouping — design notes

Status: **proposed, not implemented.** Written 2026-08-16, against v2.3.0.

## The question

How should ScrollStamp categorize bookmarks by default?

Rejected: **group by application** (all ChatGPT stamps under one "ChatGPT" tab).
It's too coarse — a user with bookmarks across five different ChatGPT
conversations can't tell which stamp belonged to which conversation.

## Recommendation: group by page, not by app

**One group = one page.** For an AI chat that's one conversation; on the web
it's one article/doc.

```
▾ Explain transformers to me          [ChatGPT]  3
    "attention is all you need…"
    "the softmax over keys…"
▾ Debugging the auth flow             [Claude]   2
▾ Designing Data-Intensive Apps ch.4  [oreilly]  5
```

- **Group header** = page title. On AI chats `document.title` *is* the
  conversation title — exactly the label the user needs.
- **App/site** = a chip plus the platform logo already rendered at
  `popup.js:208`, right-aligned. The app becomes a *filter*, not a folder.
- Collapsed by default past a handful of groups.

Zero user effort, which is the bar for a *default* categorization. It also
matches how people recall bookmarks — "that conversation about transformers,"
not "something in ChatGPT."

## Ordering

- **Groups**: by most-recent stamp in the group, descending.
- **Stamps within a group**: **document order, not time.** Re-reading an
  article adds stamps out of sequence; time-ordering inside a group reads as
  scrambled. Sort on scroll position / message index.

## Grouping key

`hostname + pathname`, tracking params stripped, remaining query kept.

That rule pays for itself: YouTube's `?v=` survives (correctly splitting
videos) while `?utm_source=…` doesn't fragment one article into three groups.
No per-host special cases to maintain.

## Prerequisites — fix before building this

### 1. `getStorageKey()` omits the hostname

`content.js:613`

```js
return `scrollstamp_${btoa(window.location.pathname).substring(0, 20)}`;
```

`btoa("/")` → `"Lw=="`, so **every site's homepage shares one bucket**. Same
for `/about`, `/blog`, `/docs`.

Today this is mostly invisible:

- the popup aggregates across all `scrollstamp_*` keys anyway (`popup.js:162`),
- jumps use each stamp's own `url`,
- `checkPendingScroll` guards on origin *and* pathname before restoring
  (`content.js:1033`), so nothing scrolls to the wrong page,
- popup delete/rename use the stamp's own `storageKey` (`popup.js:327,366`),
  not a recomputed one.

But the moment grouping keys off the storage key, `siteA.com/about` and
`siteB.com/about` merge into one visible group. Fix the key **before**
building on top of it.

Needs a migration path: existing users' stamps live under the old keys and
would go dark otherwise.

Secondary: `.substring(0, 20)` keeps only 15 bytes of pathname (20 base64
chars), so `/c/<uuid>` retains ~12 uuid chars. Distinct in practice, but
there's no reason to keep truncating once the key is being rewritten.

### 2. `pageTitle` is missing on most stamp types

Only saved on `scroll` / `pdf` stamps (`content.js:580`). Not on `message`
(`content.js:324`) or `selection` (`content.js:373`).

So AI-chat groups — the exact case this design solves — would arrive
unlabeled and fall back to `chatgpt.com`, reproducing the ambiguity. Add
`pageTitle` to all four stamp types.

Refresh it on every save (last write wins): ChatGPT only names a conversation
after the first exchange, so a stamp saved early captures the title
"ChatGPT" and the group would stay badly labeled forever otherwise.

## Later, not now

Manual tags/folders layered on top of the auto-grouping, for cross-page
collections like "thesis research." An addition to a good default, not a
replacement for one.

## Unrelated nit spotted

`content.js:1` still reads `// ScrollStamp v2.2` in its header comment.
