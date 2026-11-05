namespace LiveDesk.Core;

/// <summary>Following the sentence being written: which words have gone into the box, and which
/// are ready to go. Words can still change as the person keeps talking, so a sentence goes only
/// once it has settled, and what is not yet written shows in the bubble instead.
///
/// Positions count from the start of the whole script, so older words arriving above what is here
/// (a long script opens newest first) change nothing. Words already written are never taken back;
/// if a correction reaches them, the place is found again in the corrected words, so that nothing
/// is written twice or left out.</summary>
public sealed class Follower
{
    /// <summary>A sentence with another after it goes after this long unchanged.</summary>
    public const long SettleMs = 600;
    /// <summary>The last sentence, closed but with nothing after it, goes after this long of quiet.</summary>
    public const long QuietMs = 1500;
    private const int LookBack = 2400;   // how far back words can still be corrected: about 300 words

    private string _text = "";
    private int _start;
    private long _lastChange;
    private readonly Dictionary<string, long> _closedSince = new();

    public bool On { get; private set; }
    /// <summary>Everything before this, in the whole script, has been written.</summary>
    public int WrittenTo { get; private set; }

    public void Begin(int from)
    {
        On = true;
        WrittenTo = from;
        _closedSince.Clear();
    }

    public void Stop()
    {
        On = false;
        _closedSince.Clear();
    }

    /// <summary>The script as it stands now, starting at <paramref name="start"/> in the whole.</summary>
    public void Update(string text, int start, long now)
    {
        if (text == _text && start == _start) return;
        if (On) WrittenTo = PlaceAfterChange(_text, _start, text, start, WrittenTo);
        _text = text;
        _start = start;
        _lastChange = now;
        if (!On) return;
        // A sentence's clock starts when its words arrive, and again if they change.
        var rest = Rest();
        var closed = new HashSet<string>();
        for (var i = 0; i < rest.Count - 1; i++)
        {
            closed.Add(rest[i].Text);
            _closedSince.TryAdd(rest[i].Text, now);
        }
        Forget(closed);
    }

    /// <summary>The sentences ready to write now, in order.</summary>
    public List<string> TakeSettled(long now)
    {
        var ready = new List<string>();
        if (!On) return ready;
        var rest = Rest();
        var waiting = new HashSet<string>();
        var taking = true;
        for (var i = 0; i < rest.Count; i++)
        {
            var sentence = rest[i];
            var last = i == rest.Count - 1;
            if (last && !Sentences.IsClosed(sentence.Text)) break;
            var settled = last
                ? now - _lastChange >= QuietMs
                : _closedSince.TryGetValue(sentence.Text, out var since) && now - since >= SettleMs;
            if (taking && settled)
            {
                ready.Add(sentence.Text);
                WrittenTo = _start + sentence.End;
                continue;
            }
            taking = false;
            if (last) break;
            waiting.Add(sentence.Text);
            _closedSince.TryAdd(sentence.Text, now);
        }
        Forget(waiting);
        return ready;
    }

    private List<Sentence> Rest() => Sentences.Split(_text, Math.Clamp(WrittenTo - _start, 0, _text.Length));

    private void Forget(HashSet<string> keep)
    {
        foreach (var gone in _closedSince.Keys.Where(key => !keep.Contains(key)).ToList()) _closedSince.Remove(gone);
    }

    /// <summary>The words not written yet: what the bubble shows.</summary>
    public string Pending()
    {
        if (!On) return "";
        var from = Math.Clamp(WrittenTo - _start, 0, _text.Length);
        return _text[from..].Trim();
    }

    /// <summary>Asked for by hand: everything not written yet, now, as it stands.</summary>
    public string TakeAll()
    {
        var all = Pending();
        if (On) WrittenTo = _start + _text.Length;
        _closedSince.Clear();
        return all;
    }

    /// <summary>Where a place in the old words is in the new ones.</summary>
    public static int PlaceAfterChange(string oldText, int oldStart, string newText, int newStart, int place)
    {
        // Compared only where both have words; older words arriving above do not count as a change.
        var from = Math.Max(oldStart, newStart);
        var oldEnd = oldStart + oldText.Length;
        var newEnd = newStart + newText.Length;
        var upTo = Math.Min(place, Math.Min(oldEnd, newEnd));
        var same = from;
        while (same < upTo && oldText[same - oldStart] == newText[same - newStart]) same++;
        if (same >= place && place <= newEnd) return place;   // Nothing before the place changed.
        if (place <= from) return Math.Min(place, newEnd);

        // Words matched either side of the change, ignoring punctuation and capitals, which is
        // mostly what changes: "home. And I" becoming "home and I". Everything before the first
        // difference is the same, so only the words from there on need matching.
        var windowStart = Math.Max(from, Math.Max(place - LookBack, same));
        while (windowStart > from && !char.IsWhiteSpace(oldText[windowStart - 1 - oldStart])) windowStart--;
        var placeInOld = Math.Min(place, oldEnd);
        var oldWords = Words(oldText, windowStart - oldStart, placeInOld - oldStart);
        var reach = windowStart + (placeInOld - windowStart) * 2 + 200;
        var newWords = Words(newText, windowStart - newStart, Math.Min(newEnd, reach) - newStart);
        if (oldWords.Count == 0 || newWords.Count == 0) return Math.Min(windowStart, newEnd);

        // The longest run of matching words, keeping their order.
        var best = new int[oldWords.Count + 1, newWords.Count + 1];
        for (var i = oldWords.Count - 1; i >= 0; i--)
            for (var j = newWords.Count - 1; j >= 0; j--)
                best[i, j] = oldWords[i].Key == newWords[j].Key ? best[i + 1, j + 1] + 1 : Math.Max(best[i + 1, j], best[i, j + 1]);

        int lastOld = -1, lastNew = -1;
        for (int i = 0, j = 0; i < oldWords.Count && j < newWords.Count;)
        {
            if (oldWords[i].Key == newWords[j].Key) { lastOld = i; lastNew = j; i++; j++; }
            else if (best[i + 1, j] >= best[i, j + 1]) i++;
            else j++;
        }
        // Nothing matched: as many words as were written.
        if (lastNew < 0) return newStart + newWords[Math.Min(oldWords.Count, newWords.Count) - 1].End;
        // Words written after the last that matched were changed, not removed: as many as there were.
        var after = Math.Min(oldWords.Count - 1 - lastOld, newWords.Count - 1 - lastNew);
        return newStart + newWords[lastNew + after].End;
    }

    private readonly record struct Word(string Key, int End);

    private static List<Word> Words(string text, int from, int to)
    {
        var list = new List<Word>();
        to = Math.Min(to, text.Length);
        var i = Math.Max(0, from);
        while (i < to)
        {
            while (i < to && char.IsWhiteSpace(text[i])) i++;
            var a = i;
            while (i < to && !char.IsWhiteSpace(text[i])) i++;
            if (i > a)
            {
                var key = new string(text[a..i].Where(char.IsLetterOrDigit).Select(char.ToLowerInvariant).ToArray());
                list.Add(new Word(key, i));
            }
        }
        return list;
    }
}
