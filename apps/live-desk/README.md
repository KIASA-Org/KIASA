# KIASA Live Desk

The admin's Live scripts as a small Windows app. It shows the same people and the same cards as
`/admin/live`, and what you pick goes straight in where your cursor is, in whatever program that is.

- **Click in a box**, in any program. A small leaf icon stays beside your cursor.
- **Click a card**: it goes in. Drag across several, or hold Ctrl to add one more. Only the card you
  just added goes in, never the ones already there.
- **Pick the sentence being written**: each sentence goes in by itself once it has finished, and the
  words still being spoken show in a bubble beside the icon, because they can still change.
- **Ctrl+Alt+Space** writes the bubble's words now. **Stop writing** ends it.

The window never takes the keyboard, so clicking a card leaves your cursor in your document. It stays
on top of other windows unless you turn off the pin.

The member's own page still tells them, the whole time, that an admin can read their script. Nothing
is kept: words stay in memory while the app is open, and they stay out of Windows' clipboard history.

## Where words will and won't go

| Place | What happens |
| --- | --- |
| Documents (Notepad, Word's kind) | Goes in, a line for each sentence |
| LibreOffice | Goes in, a line for each sentence. It can't report its cursor, so the icon sits where you last clicked, and text selected there can't be seen, so it would be replaced |
| Chrome boxes (one-line, text area, rich text) | Goes in, with a space between sentences, because Enter can send a message |
| Password boxes, read-only boxes, buttons, plain pages | Never. The words wait until you click a box |
| Terminals | Never: words there would be commands |
| Programs running as administrator | Never: Windows does not allow it |

If text is selected, the words wait rather than replace it.

## Build and run

```powershell
./build.ps1      # dist\KIASA Live Desk.exe, one file, nothing else to install
```

The first sign-in on a computer asks to be approved, like any new device: approve **KIASA Live Desk**
under Admin > Your devices, then sign in again. It needs `/desk/sign-in` live on the site.

## How it writes, and why

Measured on Windows 11. Details are in `Win/Typer.cs`.

- **Not typed key by key.** At any useful speed Notepad turned the characters into nonsense
  ("hhhhhere,hhhh"), and it saved that way.
- **Pasted, in one piece.** But Remote Desktop, HelpWire and Windows itself open the clipboard the moment
  it changes, and a paste that meets one of them silently does nothing: up to 29 of 40 sentences were
  lost that way. Those programs also ask for the text, so being asked proves nothing.
- **So:** wait for the clipboard to go quiet, paste, read back the words before the cursor, and paste
  again only if they did not change. That lost and doubled nothing in 150 sentences.
- **The new line is its own key press**, because LibreOffice drops one at the end of a paste, and never
  on a selection, because Enter would replace it.
- **Your clipboard goes back** the way it was, unless you have copied something since. Pictures come
  back from their plain form; anything held in a way that can't be copied is left out.

`Net/ScriptReader.cs` must stay in step with `ScriptReader` in the site's `live-link.ts`.

## Tests

```powershell
dotnet run --project tests -c Release     # the logic: nothing opens
```

The others need the local Supabase copy, a built site on this computer (`DESK_SITE`, `DESK_MEMBER_SITE`),
and a test build: `dotnet build KiasaLiveDesk.csproj -c Debug -p:DefineConstants=DESK_TEST -o bin/test`.

```powershell
node tests/e2e.cjs       # the real channel, typing into a real Notepad
node tests/boxes.cjs     # Chrome boxes, places that must refuse, LibreOffice
node tests/devices.cjs   # the approved-devices rule, with the app as a device
```

They bring windows to the front and move the mouse for a moment, so run them when no one is using the
computer. The test build writes and reads only in windows with `kiasa-desk-test` in their title.
**Tests never close anything by program name or title**: one that did closed every open terminal on
the computer (2026-11-04). Test windows save and close themselves, and terminals are tested as logic.
Use a member no other test is using: two people writing one script mix their words.
