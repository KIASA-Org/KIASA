using System.Text.Json;
using LiveDesk.Core;
using LiveDesk.Net;

// The app's logic, on its own: `dotnet run --project apps/live-desk/tests`.
var failed = 0;
var passed = 0;
void Check(string what, bool ok, string? detail = null)
{
    if (ok) { passed++; return; }
    failed++;
    Console.WriteLine($"FAIL {what}{(detail == null ? "" : $": {detail}")}");
}
void Same(string what, object? want, object? got) => Check(what, Equals(want, got), $"wanted [{want}] got [{got}]");
void SameList(string what, IEnumerable<string> want, IEnumerable<string> got) => Same(what, string.Join("|", want), string.Join("|", got));
static JsonElement J(string json) => JsonDocument.Parse(json).RootElement;

// ── Sentences: the same cut as the site's /[^.!?]*[.!?]+|[^.!?]+$/g, trimmed.
SameList("sentences", ["One.", "Two?", "Three"], Sentences.Split("One. Two? Three").Select(s => s.Text));
SameList("sentences, runs of marks", ["Wait...", "What?!"], Sentences.Split("  Wait... What?! ").Select(s => s.Text));
Same("sentences, only spaces", 0, Sentences.Split("   ").Count);
var cut = Sentences.Split("Hello there. Next one");
Same("sentence position", "Next one", "Hello there. Next one"[cut[1].Start..cut[1].End]);

// ── Places words may never go. Tested here, not by opening one: a test that closed a real terminal
// once closed every terminal on the computer (2026-11-04).
Check("Windows Terminal is a terminal", BoxRules.IsTerminal("CASCADIA_HOSTING_WINDOW_CLASS"));
Check("the old console is a terminal", BoxRules.IsTerminal("ConsoleWindowClass"));
Check("Notepad is not a terminal", !BoxRules.IsTerminal("Notepad"));
Check("Chrome is not a terminal", !BoxRules.IsTerminal("Chrome_WidgetWin_1"));
Check("the desktop is nowhere to write", BoxRules.IsShell("Progman") && BoxRules.IsShell("Shell_TrayWnd"));
Check("LibreOffice is known as a document", BoxRules.IsDocument("SALFRAME"));
Check("a terminal is never taken for a document", !BoxRules.IsDocument("CASCADIA_HOSTING_WINDOW_CLASS"));

// ── Following: a sentence goes once settled, and never twice.
{
    var f = new Follower();
    f.Update("Before this. I went home", 0, 0);
    f.Begin(13);
    Same("nothing yet, the sentence is open", 0, f.TakeSettled(10_000).Count);
    Same("the bubble has the open words", "I went home", f.Pending());

    f.Update("Before this. I went home. And then", 0, 20_000);
    Same("closed but not settled", 0, f.TakeSettled(20_100).Count);
    SameList("settled goes", ["I went home."], f.TakeSettled(20_000 + Follower.SettleMs));
    Same("the bubble moved on", "And then", f.Pending());
    Same("not twice", 0, f.TakeSettled(40_000).Count);
    Same("an open last sentence never goes by itself", "And then", f.Pending());
}
{
    // The last sentence, closed, with quiet after it.
    var f = new Follower();
    f.Begin(0);
    f.Update("All done.", 0, 1_000);
    Same("closed, but just now", 0, f.TakeSettled(1_100).Count);
    SameList("closed and quiet", ["All done."], f.TakeSettled(1_000 + Follower.QuietMs));
    Same("the bubble is empty", "", f.Pending());
}
{
    // A sentence changing is not settled: its clock starts again.
    var f = new Follower();
    f.Begin(0);
    f.Update("I red it. Next", 0, 0);
    Same("first wording waits", 0, f.TakeSettled(300).Count);
    f.Update("I read it. Next", 0, 400);
    Same("changed: starts again", 0, f.TakeSettled(700).Count);
    SameList("the corrected words go", ["I read it."], f.TakeSettled(400 + Follower.SettleMs));
}
{
    // A correction joining two sentences after the first was written: only the new words follow.
    var f = new Follower();
    f.Begin(0);
    f.Update("I went home. And I ate", 0, 0);
    SameList("first sentence", ["I went home."], f.TakeSettled(1_000));
    f.Update("I went home and I ate lunch. Then", 0, 2_000);
    Same("no words repeated", "and I ate lunch. Then", f.Pending());
    SameList("the rest of it", ["and I ate lunch."], f.TakeSettled(2_000 + Follower.SettleMs));
}
{
    // A correction adding a word to what was written: the new word is not lost.
    var f = new Follower();
    f.Begin(0);
    f.Update("We use react. Next thing", 0, 0);
    SameList("written", ["We use react."], f.TakeSettled(1_000));
    f.Update("We use React Native. Next thing", 0, 2_000);
    Same("a new word is not lost", "Native. Next thing", f.Pending());
}
{
    // A correction shorter than the words before the place.
    var f = new Follower();
    f.Begin(0);
    f.Update("We are going to go now. Next thing", 0, 0);
    SameList("written", ["We are going to go now."], f.TakeSettled(1_000));
    f.Update("We gonna go now. Next thing", 0, 2_000);
    Same("the place moved back", "Next thing", f.Pending());
}
{
    // A correction after the place touches nothing written.
    var f = new Follower();
    f.Begin(0);
    f.Update("Done here. Next wurd", 0, 0);
    SameList("written", ["Done here."], f.TakeSettled(1_000));
    var place = f.WrittenTo;
    f.Update("Done here. Next word", 0, 2_000);
    Same("same place", place, f.WrittenTo);
    Same("the corrected words show", "Next word", f.Pending());
}
{
    // Older words arriving above what is here change no place.
    var f = new Follower();
    f.Update("Third one. Fourth", 23, 0);
    f.Begin(34);
    f.Update("First one. Second two. Third one. Fourth", 0, 100);
    Same("older words: same place", 34, f.WrittenTo);
    Same("older words: same bubble", "Fourth", f.Pending());
}
{
    // The script shrinking below the place: never past the end.
    var f = new Follower();
    f.Update("Some words here. And more", 0, 0);
    f.Begin(25);
    f.Update("Some words", 0, 100);
    Check("place stays inside the words", f.WrittenTo <= 10, $"got {f.WrittenTo}");
    Same("nothing pending", "", f.Pending());
}
{
    // By hand: everything now.
    var f = new Follower();
    f.Begin(0);
    f.Update("Still talking about", 0, 0);
    Same("take all", "Still talking about", f.TakeAll());
    Same("taken", "", f.Pending());
    f.Update("Still talking about this. Next", 0, 100);
    Same("after taking all, only what is new", "this. Next", f.Pending());
}
{
    // A burst: several finished at once go in order.
    var f = new Follower();
    f.Begin(0);
    f.Update("One. Two. Three. Four", 0, 0);
    SameList("in order", ["One.", "Two.", "Three."], f.TakeSettled(Follower.SettleMs));
    f.Stop();
    Same("stopped: nothing", 0, f.TakeSettled(99_999).Count);
    Same("stopped: nothing pending", "", f.Pending());
}
{
    // The same words twice are two sentences.
    var f = new Follower();
    f.Begin(0);
    f.Update("Yeah. Yeah. Right", 0, 0);
    SameList("repeats kept", ["Yeah.", "Yeah."], f.TakeSettled(Follower.SettleMs));
}

// ── Word by word: the box reads like the script, with the smallest change each time.
{
    string doc = "";
    var w = new WordWriter();
    long clock = 0;
    bool Step(string between = "\n")
    {
        var edit = w.Next(between, clock);
        if (edit == null) return false;
        Check("only what is really there is taken back", doc.EndsWith(edit.TakeBack, StringComparison.Ordinal), $"[{edit.TakeBack}] from [{doc}]");
        doc = doc[..^edit.Delete] + edit.Insert;
        w.Applied(edit);
        return true;
    }
    void Settle() { clock += WordWriter.LastWordQuietMs; while (Step()) { } }

    w.Update("Before this. We are test", 0, clock);
    w.Begin(13);
    clock += 10;
    Step();
    Same("the word being said waits", "We are", doc);
    Same("the bubble shows it", "test", w.Held());
    w.Update("Before this. We are testing", 0, clock);
    Step();
    Same("still growing, it still waits", "We are", doc);
    Settle();
    Same("quiet, it goes in", "We are testing", doc);
    w.Update("Before this. We are testing word", 0, clock);
    clock += 10;
    Step();
    Same("nothing taken back while the next word waits", "We are testing", doc);
    w.Update("Before this. We are testing word by", 0, clock);
    clock += 10;
    Step();
    Same("each word goes in when the next begins", "We are testing word", doc);

    // A correction puts the word right.
    w.Update("Before this. We are testing ward by", 0, clock);
    clock += 10;
    Step();
    Same("a word put right", "We are testing ward", doc);
    w.Update("Before this. We are testing ward by word", 0, clock);
    clock += 10;
    Step();
    Same("the next word follows", "We are testing ward by", doc);

    // A word waiting that changes takes nothing back.
    Settle();
    Same("all in", "We are testing ward by word", doc);
    w.Update("Before this. We are testing ward by words", 0, clock);
    clock += 10;
    Check("a word that only grows takes nothing back", w.Next("\n", clock)?.Delete is null or 0);
    Settle();
    Same("and just grows", "We are testing ward by words", doc);

    // The end of a sentence, and a new line for the next.
    w.Update("Before this. We are testing ward by words. And", 0, clock);
    clock += 10;
    Step();
    Same("the mark goes on, the next word waits", "We are testing ward by words.", doc);
    Settle();
    Same("a new line for the next sentence", "We are testing ward by words.\nAnd", doc);

    // A correction joining them takes the new line back.
    w.Update("Before this. We are testing ward by words and", 0, clock);
    Settle();
    Same("sentences joined", "We are testing ward by words and", doc);

    // By hand.
    w.Update("Before this. We are testing ward by words and more", 0, clock);
    clock += 10;
    w.WriteHeldNow();
    Step();
    Same("the key writes the held word", "We are testing ward by words and more", doc);

    // Moved away: what is written stays, nothing is put right, writing goes on.
    w.Freeze();
    var kept = doc;
    w.Update("Before this. We are testing WARD by words and more words", 0, clock);
    Settle();
    Same("after freezing, nothing is taken back", kept + " words", doc);
    Same("the place is right", "", w.Held());
}
{
    // A correction too far back is left alone, and nothing is doubled or lost after it.
    string doc = "";
    var w = new WordWriter();
    long clock = 0;
    var words = string.Join(" ", Enumerable.Range(0, 80).Select(i => $"word{i}"));
    w.Update(words, 0, clock);
    w.Begin(0);
    clock += WordWriter.LastWordQuietMs;
    for (Edit? e; (e = w.Next("\n", clock)) != null; w.Applied(e)) doc = doc[..^e.Delete] + e.Insert;
    Same("all in", words, doc);
    var changed = "CHANGED" + words[5..] + " more";
    w.Update(changed, 0, clock);
    clock += WordWriter.LastWordQuietMs;
    for (Edit? e; (e = w.Next("\n", clock)) != null; w.Applied(e))
    {
        Check("far back is not taken back", e.Delete == 0, e.Delete.ToString());
        doc = doc[..^e.Delete] + e.Insert;
    }
    Same("only the new word is added", words + " more", doc);
}
{
    // Finishing: the rest goes in with what follows it, and it ends.
    string doc = "";
    var w = new WordWriter();
    w.Update("One two thr", 0, 0);
    w.Begin(0);
    w.Finish();
    Check("finishing counts as work", w.HasWork(1));
    var e = w.Next("\n", 1)!;
    doc += e.Insert;
    w.Applied(e);
    Same("an open sentence ends with a space", "One two thr ", doc);
    Check("and it has ended", !w.On);
    Same("the place is at the end, for sentences to carry on", 11, w.Place);

    w = new WordWriter();
    w.Update("One two.", 0, 0);
    w.Begin(0);
    w.Finish();
    e = w.Next("\n", 1)!;
    w.Applied(e);
    Same("a closed one ends with a new line", "One two.\n", e.Insert);
    w = new WordWriter();
    w.Update("", 0, 0);
    w.Begin(0);
    w.Finish();
    Check("nothing to write: it just ends", w.Next("\n", 1) == null && !w.On);
    w = new WordWriter();
    w.Update("One two three", 0, 0);
    w.Begin(0);
    w.Stop();
    Check("stopped: nothing", w.Next("\n", 99_999) == null && !w.HasWork(99_999) && w.Held() == "");
}
{
    // Older words arriving above, and a box that uses spaces between sentences.
    string doc = "";
    var w = new WordWriter();
    long clock = 0;
    w.Update("Third one. Fourth is", 23, clock);
    w.Begin(34);
    clock += WordWriter.LastWordQuietMs;
    for (Edit? e; (e = w.Next(" ", clock)) != null; w.Applied(e)) doc += e.Insert;
    Same("started at the live sentence", "Fourth is", doc);
    w.Update("First one. Second two. Third one. Fourth is", 0, clock);
    clock += WordWriter.LastWordQuietMs;
    Check("older words change nothing", w.Next(" ", clock) == null);
    w.Update("First one. Second two. Third one. Fourth is here. Fifth", 0, clock);
    clock += WordWriter.LastWordQuietMs;
    for (Edit? e; (e = w.Next(" ", clock)) != null; w.Applied(e)) doc += e.Insert;
    Same("a space between sentences here", "Fourth is here. Fifth", doc);
}
{
    // A long take-back in parts: nothing is lost, and the box still ends up reading like the script.
    string doc = "";
    var w = new WordWriter();
    long clock = WordWriter.LastWordQuietMs;
    var words = "One two three four five six seven eight nine ten";
    w.Update(words, 0, 0);
    w.Begin(0);
    for (Edit? e; (e = w.Next("\n", clock)) != null; w.Applied(e)) doc = doc[..^e.Delete] + e.Insert;
    var changed = words.Replace("three", "THREE");
    w.Update(changed, 0, clock);
    clock += WordWriter.LastWordQuietMs;
    var first = w.Next("\n", clock)!;
    doc = doc[..^10];
    w.TookBack(10);
    var second = w.Next("\n", clock)!;
    Same("what is left is taken back next", first.Delete - 10, second.Delete);
    doc = doc[..^second.Delete] + second.Insert;
    w.Applied(second);
    Same("in parts, it reads like the script", changed, doc);

    // The same, but writing freezes part way: it carries on from what the box really holds.
    doc = words;
    w = new WordWriter();
    clock = WordWriter.LastWordQuietMs;
    w.Update(words, 0, 0);
    w.Begin(0);
    w.Applied(w.Next("\n", clock)!);
    w.Update(changed, 0, clock);
    clock += WordWriter.LastWordQuietMs;
    w.Next("\n", clock);
    doc = doc[..^25];
    w.TookBack(25);
    w.Freeze();
    for (Edit? e; (e = w.Next("\n", clock)) != null; w.Applied(e)) doc = doc[..^e.Delete] + e.Insert;
    Same("frozen part way, no word is lost", words, doc);

    // A word being changed is taken back, then writing freezes before the new one goes in.
    doc = "One two three";
    w = new WordWriter();
    clock = WordWriter.LastWordQuietMs;
    w.Update(doc, 0, 0);
    w.Begin(0);
    w.Applied(w.Next("\n", clock)!);
    w.Update("One two thrXX", 0, clock);
    clock += 10;
    var only = w.Next("\n", clock)!;
    doc = doc[..^only.Delete] + only.Insert;
    w.Applied(only);
    w.Freeze();
    clock += WordWriter.LastWordQuietMs;
    for (Edit? e; (e = w.Next("\n", clock)) != null; w.Applied(e)) doc = doc[..^e.Delete] + e.Insert;
    Same("the new word still goes in", "One two thrXX", doc);

    // Carrying on from exactly the start of a word, or of a sentence.
    w = new WordWriter();
    w.Update("Editing the video workflow", 0, 0);
    w.Begin(12, carryingOn: true);
    Same("the space before the word is kept", " video workflow", w.Next("\n", WordWriter.LastWordQuietMs)!.Insert);
    w = new WordWriter();
    w.Update("All done. Next one", 0, 0);
    w.Begin(10, carryingOn: true);
    Same("a new sentence takes its new line", "\nNext one", w.Next("\n", WordWriter.LastWordQuietMs)!.Insert);
}
{
    // Many updates with corrections: however they fall, the box ends up reading like the script.
    var random = new Random(7);
    for (var round = 0; round < 40; round++)
    {
        string doc = "";
        var w = new WordWriter();
        long clock = 0;
        var said = new List<string>();
        string Script() => string.Join(" ", said);
        var wrong = false;
        w.Update("", 0, clock);
        w.Begin(0);
        for (var i = 0; i < 400; i++)
        {
            said.Add((i % 9 == 8 ? "End" : "w") + i + (i % 9 == 8 ? "." : ""));
            if (random.Next(4) == 0 && said.Count > 6)
            {
                var at = said.Count - 1 - random.Next(5);
                said[at] = said[at].EndsWith('.') ? said[at] : said[at] + "x";
            }
            w.Update(Script(), 0, clock);
            clock += random.Next(5) == 0 ? 500 : 60;
            if (random.Next(3) == 0) continue;   // A slow box: it asks less often than words come.
            var edit = w.Next("\n", clock);
            if (edit == null) continue;
            if (!doc.EndsWith(edit.TakeBack, StringComparison.Ordinal)) wrong = true;
            doc = doc[..^edit.Delete] + edit.Insert;
            w.Applied(edit);
        }
        clock += 1000;
        for (Edit? e; (e = w.Next("\n", clock)) != null; w.Applied(e))
        {
            if (!doc.EndsWith(e.TakeBack, StringComparison.Ordinal)) wrong = true;
            doc = doc[..^e.Delete] + e.Insert;
        }
        var want = string.Join("\n", Sentences.Split(Script()).Select(part => part.Text));
        Check($"round {round}: never took back what was not there", !wrong);
        Same($"round {round}: the box reads like the script", want, doc);
    }
}

{
    // A box that cannot be read back: what would be taken back stays, and only new words are added.
    string doc = "";
    var w = new WordWriter();
    long clock = 0;
    void Pass()
    {
        for (var i = 0; i < 6; i++)
        {
            var e = w.Next("\n", clock);
            if (e == null) return;
            if (e.Delete > 0) { w.Freeze(); continue; }
            doc += e.Insert;
            w.Applied(e);
        }
    }
    var script = "Before this one. LibreOffice words";
    w.Update(script, 0, clock);
    w.Begin(17);
    foreach (var more in new[] { " come", " one", " at", " a", " time.", " Then", " another", " line", " begins", " here.", " Last" })
    {
        clock += 500;
        Pass();
        script += more;
        w.Update(script, 0, clock);
        clock += 10;
        Pass();
    }
    clock += 500;
    Pass();
    Same("no reading back, no changes: reads right", "LibreOffice words come one at a time.\nThen another line begins here.\nLast", doc);

    // A word changes after it went in: it stays, and nothing is doubled or lost after it.
    script = script.Replace("another", "other");
    w.Update(script, 0, clock);
    clock += 500;
    Pass();
    Same("a changed word stays as it went in", "LibreOffice words come one at a time.\nThen another line begins here.\nLast", doc);
    script += " words";
    w.Update(script, 0, clock);
    clock += 500;
    Pass();
    Same("and the next words follow on", "LibreOffice words come one at a time.\nThen another line begins here.\nLast words", doc);
    script += ". Next one";
    w.Update(script, 0, clock);
    clock += 500;
    Pass();
    Same("and new lines still come", "LibreOffice words come one at a time.\nThen another line begins here.\nLast words.\nNext one", doc);
}

{
    // Stopped, then started again in the same sentence: carries on, with nothing repeated.
    string doc = "";
    var w = new WordWriter();
    long clock = 0;
    void Pass() { for (Edit? e; (e = w.Next("\n", clock)) != null; w.Applied(e)) doc = doc[..^e.Delete] + e.Insert; }
    w.Update("Earlier one. And goes on now", 0, clock);
    w.Begin(13);
    clock += 500;
    Pass();
    Same("written", "And goes on now", doc);
    w.Stop();
    Same("it knows where it got to", 28, w.WroteUpTo);
    w.Update("Earlier one. And goes on now not written", 0, clock);
    clock += 500;
    Same("still knows, as words come", 28, w.WroteUpTo);
    w.Begin(w.WroteUpTo!.Value, carryingOn: true);
    clock += 500;
    Pass();
    Same("carries on with a space, nothing repeated", "And goes on now not written", doc);
    w.Forget();
    Check("another script: starts fresh", w.WroteUpTo == null);
    w.Begin(0);
    Check("and before anything is written there, it has written nothing", w.WroteUpTo == null);
}

{
    // A paste that did not go in, as the person moved away: nothing is counted as written.
    string doc = "";
    var w = new WordWriter();
    long clock = 0;
    w.Update("We are here now", 0, clock);
    w.Begin(0);
    clock += 500;
    var missed = w.Next("\n", clock)!;
    Same("the words to write", "We are here now", missed.Insert);
    w.TookBackOnly(missed);
    Check("still to write", w.HasWork(clock));
    Same("still in the bubble", "We are here now", w.Held());
    var next = w.Next("\n", clock)!;
    Same("offered again, whole", "We are here now", next.Insert);
    doc += next.Insert;
    w.Applied(next);
    Check("then up to date", !w.HasWork(clock));

    // The taking back happened, the words to add did not.
    w.Update("We are there now", 0, clock);
    clock += 500;
    var fix = w.Next("\n", clock)!;
    doc = doc[..^fix.Delete];
    w.TookBackOnly(fix);
    var again = w.Next("\n", clock)!;
    Same("nothing more to take back", 0, again.Delete);
    doc += again.Insert;
    w.Applied(again);
    Same("and it reads right", "We are there now", doc);
}

{
    // Turned off just after writing froze, with nothing new: what follows the words still goes in.
    string doc = "";
    var w = new WordWriter();
    long clock = 0;
    w.Update("We wrote this", 0, clock);
    w.Begin(0);
    clock += 500;
    var first = w.Next("\n", clock)!;
    doc += first.Insert;
    w.Applied(first);
    w.Freeze();
    w.Finish();
    var ending = w.Next("\n", clock)!;
    doc += ending.Insert;
    w.Applied(ending);
    Same("a space after an open sentence", "We wrote this ", doc);
    Check("and it has ended", !w.On);
    Same("the place stays at the end of the words", 13, w.Place);
}

// ── The reader, against what the site's live-link.ts sends. The fingerprint must agree with the
// site's, or a reader would ask again for ever: these values come from running the site's function.
Same("fingerprint, empty", 2166136261u, ScriptReader.Fingerprint(""));
Same("fingerprint, words", 3855426610u, ScriptReader.Fingerprint("Hello there, KIASA."));
Same("fingerprint, not plain letters", 695248037u, ScriptReader.Fingerprint("Café 🌿"));

{
    var link = new FakeLink();
    string text = ""; int start = -1; string? older = null; var shows = 0;
    var states = new List<ReadingState>();
    long now = 1_000;
    var reader = new ScriptReader(link, (t, s, o) => { text = t; start = s; older = o; shows++; }, states.Add, () => now);
    reader.Begin();
    Same("opens", 1, link.Opened);
    link.Joined = true;
    reader.Joined();
    Same("asks when joined", "want", link.Sent[^1].Name);
    Check("asks with nothing held", link.Sent[^1].Json.Contains("\"start\":0") && link.Sent[^1].Json.Contains("\"end\":0"), link.Sent[^1].Json);
    var id = J(link.Sent[^1].Json).GetProperty("id").GetString();

    // A long script: the newest first.
    reader.Heard("resync", J($$"""{"to":"{{id}}","s":"abc","n":10,"at":100,"tail":"newest words","reset":true}"""));
    Same("resync words", "newest words", text);
    Same("resync place", 100, start);
    Same("live now", ReadingState.Live, states[^1]);
    // Someone else's answer is not for this reader.
    reader.Heard("resync", J("""{"to":"other","s":"abc","n":11,"at":0,"tail":"not mine","reset":true}"""));
    Same("not mine", "newest words", text);

    reader.Heard("change", J("""{"s":"abc","n":11,"at":106,"tail":" words now"}"""));
    Same("change applied", "newest words now", text);
    reader.Heard("change", J("""{"s":"abc","n":11,"at":106,"tail":" stale"}"""));
    Same("an old change is ignored", "newest words now", text);

    // Older words arrive above, in pieces that must join exactly.
    reader.Heard("older", J($$"""{"to":"{{id}}","at":90,"text":"older one "}"""));
    Same("older joined", "older one newest words now", text);
    Same("older place", 90, start);
    Same("older told apart", "older one ", older);
    reader.Heard("older", J($$"""{"to":"{{id}}","at":10,"text":"does not reach"}"""));
    Same("older with a gap is dropped", "older one newest words now", text);

    // A change that leaves a gap is not put in; the reader asks.
    var asked = link.Sent.Count;
    reader.Heard("change", J("""{"s":"abc","n":12,"at":500,"tail":"after a gap"}"""));
    Same("a gap is not filled in", "older one newest words now", text);
    Same("a gap asks", "want", link.Sent[^1].Name);
    Check("a gap sent one request", link.Sent.Count == asked + 1);
    reader.Heard("resync", J($$"""{"to":"{{id}}","s":"abc","n":12,"at":100,"tail":"newest words fixed"}"""));
    Same("resync fills it", "older one newest words fixed", text);

    // The writer's tick agrees: nothing asked.
    asked = link.Sent.Count;
    reader.Heard("tick", J($$"""{"s":"abc","n":12,"l":{{90 + text.Length}},"h":{{ScriptReader.Fingerprint(text)}}}"""));
    Same("agreeing tick asks nothing", asked, link.Sent.Count);
    // It does not agree: asks.
    reader.Heard("tick", J("""{"s":"abc","n":12,"l":5000,"h":1}"""));
    Same("disagreeing tick asks", asked + 1, link.Sent.Count);
    reader.Heard("resync", J($$"""{"to":"{{id}}","s":"abc","n":12,"at":100,"tail":"newest words fixed"}"""));

    // How far it has got, said once a second.
    now += 2_000;
    reader.Tick();
    Same("says how far", "seen", link.Sent[^1].Name);

    // Silence: waiting, then a new connection.
    now += 8_000;
    reader.Tick();
    Same("quiet: waiting", ReadingState.Waiting, states[^1]);
    Check("quiet: a new connection", link.Opened >= 2, $"opened {link.Opened}");
    reader.Heard("tick", J($$"""{"s":"abc","n":12,"l":{{90 + text.Length}},"h":{{ScriptReader.Fingerprint(text)}}}"""));
    Same("words again: live", ReadingState.Live, states[^1]);
    reader.End();
    var before = shows;
    reader.Heard("whole", J("""{"n":1,"text":"after the end"}"""));
    Same("ended: hears nothing", before, shows);
}
{
    // A member's page from before: `change` with no session, and `whole` as the answer.
    var link = new FakeLink { Joined = true };
    string text = ""; int start = -1;
    var reader = new ScriptReader(link, (t, s, _) => { text = t; start = s; }, _ => { });
    reader.Begin();
    reader.Joined();
    reader.Heard("whole", J("""{"n":3,"text":"The whole script."}"""));
    Same("whole", "The whole script.", text);
    Same("whole place", 0, start);
    reader.Heard("change", J("""{"n":4,"at":16,"tail":" and more"}"""));
    Same("older change", "The whole script and more", text);
    reader.Heard("change", J("""{"n":2,"at":0,"tail":"older still"}"""));
    Same("older change, late", "The whole script and more", text);
}

Console.WriteLine($"{passed} passed, {failed} failed");
return failed == 0 ? 0 : 1;

sealed class FakeLink : ILink
{
    public bool Joined { get; set; }
    public int Opened;
    public List<(string Name, string Json)> Sent = [];
    public void Open() { Opened++; }
    public void Close() { }
    public void Send(string name, object payload) => Sent.Add((name, JsonSerializer.Serialize(payload)));
    public void Refresh() { }
}
