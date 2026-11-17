using System.IO;
using System.Text.Json;

namespace UserDesk;

/// <summary>The window's own choices, kept next to the sign-in (settings.json). Ghost is never kept:
/// starting a window nobody can click would look broken.</summary>
public sealed class Settings
{
    public double Opacity { get; set; } = 1;
    public bool HideFromShare { get; set; }
    public double FontSize { get; set; } = 18;
    // Where the window was last, in WPF units; null until it has been closed once.
    public double? Left { get; set; }
    public double? Top { get; set; }
    public double? Width { get; set; }
    public double? Height { get; set; }

    public const double SmallestFont = 12, LargestFont = 40;

    private string? _file;

    public static Settings Load(string folder)
    {
        var file = Path.Combine(folder, "settings.json");
        Settings s;
        try { s = File.Exists(file) ? JsonSerializer.Deserialize<Settings>(File.ReadAllText(file)) ?? new() : new(); }
        catch { s = new(); }
        s.Opacity = Math.Clamp(s.Opacity, 0.25, 1);
        s.FontSize = Math.Clamp(s.FontSize, SmallestFont, LargestFont);
        s._file = file;
        return s;
    }

    public void Save()
    {
        if (_file == null) return;
        try { File.WriteAllText(_file, JsonSerializer.Serialize(this)); }
        catch { /* a setting not kept is not worth stopping the desk for */ }
    }
}
