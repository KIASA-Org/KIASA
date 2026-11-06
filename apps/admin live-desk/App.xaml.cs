using System.Windows;

namespace LiveDesk;

public partial class App : Application
{
    private static Mutex? _one;

    protected override void OnStartup(StartupEventArgs e)
    {
        // One at a time: two would type the same words twice.
#if DESK_TEST
        const string name = "KIASA.LiveDesk.Test";   // A test must not be stopped by the real app being open.
#else
        const string name = "KIASA.LiveDesk.One";
#endif
        _one = new Mutex(true, name, out var first);
        if (!first)
        {
            Shutdown();
            return;
        }
        base.OnStartup(e);
    }
}
