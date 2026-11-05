namespace LiveDesk.Win;

/// <summary>The place words would go right now, as far as Windows can say.</summary>
public sealed record Target(
    IntPtr Window,
    IntPtr Focus,
    string Title,
    /// <summary>A box words may go in. Anything else (a terminal, a button, a plain page, a
    /// password box) is never typed into: there, keys could do something other than write.</summary>
    bool Writable,
    /// <summary>A document, where a new line is safe. In other boxes Enter may send the message.</summary>
    bool NewLines,
    /// <summary>Why it is not a place to write, in a few words.</summary>
    string Why,
    /// <summary>The cursor on screen, in pixels. Without an exact one, the nearest known place.</summary>
    int X, int Y, int Height,
    bool HasPlace)
{
    public static readonly Target None = new(IntPtr.Zero, IntPtr.Zero, "", false, false, "", 0, 0, 0, false);
}
