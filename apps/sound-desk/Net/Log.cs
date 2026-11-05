using System.IO;

namespace SoundDesk.Net;

internal static class Log
{
    private static readonly string Path = System.IO.Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "KIASA", "SoundDesk", "log.txt");
    private static readonly object Gate = new();

    internal static void Write(string line)
    {
        lock (Gate)
        {
            try
            {
                Directory.CreateDirectory(System.IO.Path.GetDirectoryName(Path)!);
                File.AppendAllText(Path, $"[{DateTime.Now:HH:mm:ss.fff}] {line}\n");
            }
            catch { }
        }
    }
}
