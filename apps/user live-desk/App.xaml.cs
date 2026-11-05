using System.Windows;

namespace UserDesk;

public partial class App : Application
{
    private static Mutex? _one;

    protected override void OnStartup(StartupEventArgs e)
    {
        _one = new Mutex(true, "KIASA.UserDesk.One", out var first);
        if (!first)
        {
            Shutdown();
            return;
        }
        base.OnStartup(e);
    }
}
