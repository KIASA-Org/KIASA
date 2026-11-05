namespace LiveDesk.Core;

/// <summary>One sentence of a script, with where it sits in the text it came from.</summary>
public readonly record struct Sentence(int Start, int End, string Text);

/// <summary>The script as sentences: each finished one, then whatever is being spoken now as the
/// last. The same cut as the site's Live scripts page, so the cards read the same in both.</summary>
public static class Sentences
{
    private static bool Ends(char c) => c is '.' or '!' or '?';

    public static List<Sentence> Split(string text, int from = 0)
    {
        var list = new List<Sentence>();
        int i = from, n = text.Length;
        while (i < n)
        {
            int j = i;
            while (j < n && !Ends(text[j])) j++;
            while (j < n && Ends(text[j])) j++;
            int a = i, b = j;
            while (a < b && char.IsWhiteSpace(text[a])) a++;
            while (b > a && char.IsWhiteSpace(text[b - 1])) b--;
            if (b > a) list.Add(new Sentence(a, b, text[a..b]));
            i = j;
        }
        return list;
    }

    public static bool IsClosed(string sentence) => sentence.Length > 0 && Ends(sentence[^1]);
}
