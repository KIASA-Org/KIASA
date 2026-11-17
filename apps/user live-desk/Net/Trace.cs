using System.IO;

namespace UserDesk.Net;

/// <summary>A timing trace for finding where the admin's words are held up on the way in. Off unless
/// KIASA_USERDESK_TRACE names a file. It records times and sizes only, never the words themselves.</summary>
internal static class Trace
{
    private static readonly object Gate = new();
    private static readonly StreamWriter? Out = Open();

    public static bool On => Out != null;

    private static StreamWriter? Open()
    {
        var path = Environment.GetEnvironmentVariable("KIASA_USERDESK_TRACE");
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
