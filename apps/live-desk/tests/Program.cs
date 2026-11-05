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
