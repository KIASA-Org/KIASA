using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
using SoundDesk.Net;
using KeyEventArgs = System.Windows.Input.KeyEventArgs;
using Key = System.Windows.Input.Key;

namespace SoundDesk;

public partial class SignInWindow : Window
{
    private readonly Account _account;

    public SignInWindow(Account account)
    {
        _account = account;
        InitializeComponent();
        SourceInitialized += (_, _) =>
        {
            var dark = 1;
            DwmSetWindowAttribute(new WindowInteropHelper(this).Handle, 20, ref dark, sizeof(int));
        };
        Loaded += (_, _) => EmailBox.Focus();
    }

    private async void SignIn_Click(object sender, RoutedEventArgs e) => await TrySignIn();
    private async void Field_KeyDown(object sender, KeyEventArgs e) { if (e.Key == Key.Return) await TrySignIn(); }

    private async Task TrySignIn()
    {
        var email = EmailBox.Text.Trim();
        var password = PasswordInput.Password;
        if (string.IsNullOrEmpty(email) || string.IsNullOrEmpty(password))
        {
            ShowError("Please enter your email and password.");
            return;
        }
        SignInButton.IsEnabled = false;
        SignInSaid.Visibility = Visibility.Collapsed;
        var error = await _account.SignIn(email, password);
        SignInButton.IsEnabled = true;
        if (error != null) { ShowError(error); return; }
        PasswordInput.Clear();
        DialogResult = true;
        Close();
    }

    public void ShowError(string text)
    {
        SignInSaid.Text = text;
        SignInSaid.Visibility = Visibility.Visible;
    }

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);
}
