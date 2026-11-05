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
}
