using System.IO;

namespace LiveDesk.Core;

/// <summary>A timing trace for finding where words are held up. Off unless KIASA_DESK_TRACE names a
/// file. It records times and sizes only, never the words of a script.</summary>
internal static class Timing
{
    private static readonly object Gate = new();
    private static readonly StreamWriter? Out = Open();

    public static bool On => Out != null;

    private static StreamWriter? Open()
    {
        var path = Environment.GetEnvironmentVariable("KIASA_DESK_TRACE");
        if (string.IsNullOrWhiteSpace(path)) return null;
        try { return new StreamWriter(path, false) { AutoFlush = true }; }
        catch (Exception) { return null; }
    }

    public static void Line(string text)
    {
        if (Out == null) return;
        lock (Gate) Out.WriteLine($"{Environment.TickCount64} {text}");
    }
}
