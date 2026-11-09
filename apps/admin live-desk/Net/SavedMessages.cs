using System.Collections.ObjectModel;
using System.IO;
using System.Security.Cryptography;
using System.Text.Json;

namespace LiveDesk.Net;

/// <summary>One saved message; Short is what its chip shows.</summary>
public sealed record SavedMessage(string Text)
{
    public string Short => Text.ReplaceLineEndings(" ").Trim();
}

/// <summary>Messages the admin sends often, kept on this computer and sealed to this Windows user
/// (saved-messages.bin, DPAPI), like the sign-in. Newest first.</summary>
public sealed class SavedMessages
{
    private const int Most = 60;
    private readonly string _file;

    public ObservableCollection<SavedMessage> Items { get; } = [];

    public SavedMessages(string folder)
    {
        _file = Path.Combine(folder, "saved-messages.bin");
        try
        {
            var plain = ProtectedData.Unprotect(File.ReadAllBytes(_file), null, DataProtectionScope.CurrentUser);
            foreach (var text in JsonSerializer.Deserialize<List<string>>(plain) ?? []) Items.Add(new SavedMessage(text));
        }
        catch (Exception) { /* none yet, or from another Windows user */ }
    }

    /// <summary>Adds a message at the front (moving it there if it is already saved).</summary>
    public void Add(string text)
    {
        text = text.Trim();
        if (text.Length == 0) return;
        var same = Items.FirstOrDefault(m => m.Text == text);
        if (same != null) Items.Remove(same);
        Items.Insert(0, new SavedMessage(text));
        while (Items.Count > Most) Items.RemoveAt(Items.Count - 1);
        Save();
    }

    public void Remove(SavedMessage message)
    {
        Items.Remove(message);
        Save();
    }

    private void Save()
    {
        try
        {
            var plain = JsonSerializer.SerializeToUtf8Bytes(Items.Select(m => m.Text).ToList());
            File.WriteAllBytes(_file, ProtectedData.Protect(plain, null, DataProtectionScope.CurrentUser));
        }
        catch (Exception) { /* not kept this time; the list still works until the app closes */ }
    }
}
