namespace LiveDesk.Core;

/// <summary>Which programs words may never go into, and which may without saying where their cursor
/// is, known by the Windows class of their window.</summary>
public static class BoxRules
{
    private static readonly HashSet<string> Terminals = new(StringComparer.OrdinalIgnoreCase)
        { "ConsoleWindowClass", "CASCADIA_HOSTING_WINDOW_CLASS", "mintty", "PuTTY", "VirtualConsoleClass", "Alacritty", "org.wezfurlong.wezterm" };
    private static readonly HashSet<string> Shell = new(StringComparer.OrdinalIgnoreCase)
        { "Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd", "XamlExplorerHostIslandWindow" };
    private static readonly HashSet<string> Documents = new(StringComparer.OrdinalIgnoreCase)
        { "SALFRAME", "OpusApp" };

    /// <summary>Words here would be commands. Measured: Windows Terminal is
    /// CASCADIA_HOSTING_WINDOW_CLASS, and reports no cursor.</summary>
    public static bool IsTerminal(string windowClass) => Terminals.Contains(windowClass);

    /// <summary>The desktop and the taskbar: nothing to write in.</summary>
    public static bool IsShell(string windowClass) => Shell.Contains(windowClass);

    /// <summary>Document programs that tell Windows nothing about their cursor. Measured:
    /// LibreOffice is SALFRAME, and reports only its window.</summary>
    public static bool IsDocument(string windowClass) => Documents.Contains(windowClass);

    /// <summary>A member's words made safe to type anywhere: every control character (new lines,
    /// tabs, escapes) and line or paragraph separator becomes a space, one for one, so places in the
    /// text stay where they were. The words come from a member's page; a new line inside them must
    /// never press Enter in whatever program has the cursor (a terminal would run it as a command).
    /// The desk adds its own new lines, only between sentences and only in documents.</summary>
    public static string Clean(string text)
    {
        if (string.IsNullOrEmpty(text)) return text;
        var chars = text.ToCharArray();
        var changed = false;
        for (var i = 0; i < chars.Length; i++)
        {
            var c = chars[i];
            if (char.IsControl(c) || c is '\u2028' or '\u2029' or '\u0085')
            {
                chars[i] = ' ';
                changed = true;
            }
        }
        return changed ? new string(chars) : text;
    }
}
