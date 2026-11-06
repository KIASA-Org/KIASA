namespace LiveDesk.Core;

/// <summary>A change to make at the cursor: take back the last characters, then add these.</summary>
public sealed record Edit(int Delete, string TakeBack, string Insert, int Place);

/// <summary>Word by word: the box follows the script as it is spoken, instead of waiting for each
/// sentence to finish. What has gone in is remembered exactly, so each change is the smallest one
/// that makes the box read like the script: usually a word added, sometimes a word put right.
///
/// The person doing the writing asks for the next change only when ready, and always gets it from the
/// script as it stands now. So a slow box gets fewer, bigger changes, and never falls behind.
///
/// Whoever applies a change must first see that the words to take back are really what is before the
/// cursor. If they are not (the person moved it, or typed), they call <see cref="Freeze"/>: what is
/// written stays exactly as it is, and writing goes on from there, adding only. The same happens for a
/// correction too far back, and in a box that cannot be read back at all.
///
/// Positions count from the start of the whole script, as in <see cref="Follower"/>.</summary>
public sealed class WordWriter
{
    /// <summary>The word being said waits this long unchanged: it is usually still growing.</summary>
    public const long LastWordQuietMs = 200;
    /// <summary>A correction reaching further back than this many characters is left alone.</summary>
    public const int MostToFix = 480;
    private const int KeepWritten = 600;    // beyond this, whole older sentences are no longer looked at

    private readonly object _gate = new();
    private string _text = "";
    private int _start;
    private long _lastChange;
    private bool _on;
    private bool _noHold;
    private bool _finishing;
    private int _from;                      // where in the script the words remembered start
    private bool _continuing;               // those words follow on from text no longer remembered
    private string _written = "";           // exactly what has gone in since then, as the box holds it
    private string _between = "\n";
    private int _place;                     // how far through the script the box has got
    private int? _placeOnTheWay;
    private bool _wrote;

    public bool On { get { lock (_gate) return _on; } }
    public int Place { get { lock (_gate) return _place; } }

    /// <summary>Where writing got to, if it has written in this script: it carries on from here.</summary>
    public int? WroteUpTo { get { lock (_gate) return _wrote ? _place : null; } }

    /// <param name="from">Where in the script to start.</param>
    /// <param name="carryingOn">The box already has the words before this place.</param>
    public void Begin(int from, bool carryingOn = false)
    {
        lock (_gate)
        {
            _on = true;
            _noHold = false;
            _finishing = false;
            _from = from;
            _place = from;
            _placeOnTheWay = null;
            _continuing = carryingOn;
            _written = "";
        }
    }

    /// <summary>Another script: nothing has been written from this one.</summary>
    public void Forget()
    {
        lock (_gate)
        {
            _on = false;
            _wrote = false;
            _written = "";
        }
    }

    /// <summary>Ends at once: nothing more goes in.</summary>
    public void Stop()
    {
        lock (_gate)
        {
            _on = false;
            _finishing = false;
            _written = "";
        }
    }

    /// <summary>Everything not written goes in now, with what should follow it, and then it ends.</summary>
    public void Finish()
    {
        lock (_gate) if (_on) _finishing = true;
    }

    /// <summary>A finish is called off: back to following.</summary>
    public void KeepGoing()
    {
        lock (_gate) _finishing = false;
    }

    /// <summary>The word being held goes in now.</summary>
    public void WriteHeldNow()
    {
        lock (_gate) _noHold = true;
    }

    public void Update(string text, int start, long now)
    {
        lock (_gate)
        {
            if (text == _text && start == _start) return;
            if (_on || _wrote) _place = Follower.PlaceAfterChange(_text, _start, text, start, _place);
            if (_on)
            {
                _from = Follower.PlaceAfterChange(_text, _start, text, start, _from);
                if (_placeOnTheWay is { } going) _placeOnTheWay = Follower.PlaceAfterChange(_text, _start, text, start, going);
            }
            _text = text;
            _start = start;
            _lastChange = now;
            _noHold = false;
        }
    }

    /// <summary>The words not written yet: what the bubble shows.</summary>
    public string Held()
    {
        lock (_gate)
        {
            if (!_on) return "";
            return _text[Math.Clamp(_place - _start, 0, _text.Length)..].Trim();
        }
    }

    public bool HasWork(long now)
    {
        lock (_gate) return _on && (_finishing || Plan(_between, now) != null);
    }

    /// <summary>The next change, from the script as it stands now; null if the box is up to date.</summary>
    public Edit? Next(string between, long now)
    {
        lock (_gate)
        {
            if (!_on) return null;
            _between = between;
            var edit = Plan(between, now);
            if (edit is { } tooFar && tooFar.Delete > MostToFix)
            {
                FreezeHere();
                edit = Plan(between, now);
            }
            if (edit == null && _finishing) _on = false;
            _placeOnTheWay = edit?.Place;
            return edit;
        }
    }

    /// <summary>That change has gone in.</summary>
    public void Applied(Edit edit)
    {
        lock (_gate)
        {
            if (!_on) return;
            _written = _written[..^edit.Delete] + edit.Insert;
            _place = _placeOnTheWay ?? edit.Place;
            _wrote = true;
            _placeOnTheWay = null;
            if (_finishing)
            {
                _on = false;
                return;
            }
            ForgetOldSentences();
        }
    }

    /// <summary>Only the taking back of that change happened: the words to add did not go in (the person
    /// moved to another window just then). They are still to be written.</summary>
    public void TookBackOnly(Edit edit) => TookBack(edit.Delete);

    /// <summary>This many characters at the end have gone from the box, and nothing has been added.
    /// What was taken is still to be written: the place moves back with it, so nothing is skipped,
    /// even if writing then freezes here.</summary>
    public void TookBack(int chars)
    {
        lock (_gate)
        {
            _placeOnTheWay = null;
            if (!_on || chars <= 0) return;
            _written = _written[..^Math.Min(chars, _written.Length)];
            _place = Math.Min(_place, PlaceOf(_written.Length));
        }
    }

    /// <summary>What is written stays as it is, and is no longer put right. Goes on from there.</summary>
    public void Freeze()
    {
        lock (_gate) FreezeHere();
    }

    private void FreezeHere()
    {
        _placeOnTheWay = null;
        if (_written.Length == 0) return;   // Nothing written since the last time: nothing to hold on to.
        _from = _place;
        _written = "";
        _continuing = true;
        _placeOnTheWay = null;
    }

    private Edit? Plan(string between, long now)
    {
        var from = Math.Clamp(_from - _start, 0, _text.Length);
        var full = Form(from, _text.Length, between, out var fullEnd);
        var wanted = full;
        var end = fullEnd;

        // The word being said waits, unless it has gone quiet or the writing is ending.
        if (!_finishing && !_noHold && now - _lastChange < LastWordQuietMs)
        {
            var wordAt = _text.Length;
            while (wordAt > from && !char.IsWhiteSpace(_text[wordAt - 1])) wordAt--;
            if (wordAt < _text.Length) wanted = Form(from, wordAt, between, out end);
        }

        var same = 0;
        var most = Math.Min(_written.Length, full.Length);
        while (same < most && _written[same] == full[same]) same++;
        var delete = _written.Length - same;

        // Waiting on a word never takes back what is there: only a change in the words does.
        var insert = wanted.Length > same ? wanted[same..] : "";
        var place = insert.Length > 0 ? end : delete > 0 ? Math.Min(_place, PlaceOf(same)) : _place;

        if (_finishing)
        {
            // What follows the words, for whatever is written next. With nothing new since writing
            // froze, those words are the ones before this place in the script.
            var last = full.Length > 0 ? full : _continuing ? _text[..from].TrimEnd() : "";
            if (last.Length > 0)
            {
                insert += Sentences.IsClosed(last) ? between : " ";
                place = fullEnd;
            }
        }
        if (delete == 0 && insert.Length == 0) return null;
        return new Edit(delete, _written[same..], insert, place);
    }

    /// <summary>The script between two places, the way it goes in a box: a sentence, what goes between
    /// sentences, the next sentence.</summary>
    private string Form(int from, int to, string between, out int end)
    {
        var parts = Sentences.Split(to == _text.Length ? _text : _text[..to], from);
        end = _start + from;
        if (parts.Count == 0) return "";
        var form = new System.Text.StringBuilder(Lead(from, between));
        for (var i = 0; i < parts.Count; i++)
        {
            if (i > 0) form.Append(between);
            form.Append(parts[i].Text);
        }
        end = _start + parts[^1].End;
        return form.ToString();
    }

    /// <summary>What separates these words from those before them, when those are no longer remembered.</summary>
    private string Lead(int from, string between)
    {
        if (!_continuing || from >= _text.Length) return "";
        var before = from;
        while (before > 0 && char.IsWhiteSpace(_text[before - 1])) before--;
        if (before > 0 && Sentences.IsClosed(_text[before - 1].ToString())) return between;
        // Starting exactly at a word still needs the space that came before it.
        return before < from || char.IsWhiteSpace(_text[from]) ? " " : "";
    }

    /// <summary>Where in the script the box has got to, with this many characters written.</summary>
    private int PlaceOf(int length)
    {
        var from = Math.Clamp(_from - _start, 0, _text.Length);
        var at = Lead(from, _between).Length;
        foreach (var part in Sentences.Split(_text, from))
        {
            if (length <= at + part.Text.Length) return _start + part.Start + Math.Max(0, length - at);
            at += part.Text.Length + _between.Length;
        }
        return _start + _text.Length;
    }

    private void ForgetOldSentences()
    {
        if (_written.Length <= KeepWritten) return;
        var from = Math.Clamp(_from - _start, 0, _text.Length);
        var parts = Sentences.Split(_text, from);
        if (parts.Count < 3) return;
        var first = Lead(from, _between) + parts[0].Text + _between;
        if (!_written.StartsWith(first, StringComparison.Ordinal)) return;
        _written = _written[first.Length..];
        _from = _start + parts[1].Start;
        _continuing = false;
    }
}
