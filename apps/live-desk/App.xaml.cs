using System.Windows;

namespace LiveDesk;

public partial class App : Application
{
    private static Mutex? _one;

    protected override void OnStartup(StartupEventArgs e)
    {
        // One at a time: two would type the same words twice.
        _one = new Mutex(true, "KIASA.LiveDesk.One", out var first);
        if (!first)
        {
            Shutdown();
            return;
        }
        base.OnStartup(e);
    }
}
