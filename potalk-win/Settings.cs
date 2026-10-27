using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using System.Windows;

namespace Potalker;

public sealed class Settings
{
    public bool NotifyRooms { get; set; } = true;
    public string MicLabel { get; set; } = "";
    public bool MuteOnCreate { get; set; } = true;
    public bool MuteOnJoin { get; set; } = true;
    /// <summary>部屋のURLをコピーするとき、「&amp;name=…」を省く（ひとこと欄の60文字に収まりやすい）</summary>
    public bool ShortLinks { get; set; } = true;
    /// <summary>初回のごあいさつ（作者への謝辞）を、もう出さない</summary>
    public bool ThanksHidden { get; set; }
    /// <summary>ウィンドウごとの前回の位置と大きさ（左・上・幅・高さ）</summary>
    public Dictionary<string, double[]> Windows { get; set; } = new();

    static string PathName => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Potalker", "settings.json");

    public static Settings Load()
    {
        try { return JsonSerializer.Deserialize<Settings>(File.ReadAllText(PathName)) ?? new Settings(); } catch { return new Settings(); }
    }
    public void Save()
    {
        try { Directory.CreateDirectory(Path.GetDirectoryName(PathName)); File.WriteAllText(PathName, JsonSerializer.Serialize(this)); } catch { }
    }

    /// <summary>1つの窓にまとめて使う（シングルペイン）</summary>
    public bool SinglePane { get; set; }
    /// <summary>シングルペインの窓を、ほかの窓の上に浮かせておく</summary>
    public bool PinSingle { get; set; } = true;
    /// <summary>シングルペインの窓の幅。入室前（縦長の一覧）と、入室中（部屋の小窓くらい）で、別々に覚える</summary>
    public double SingleLobbyW { get; set; }      // 0 のあいだは、いまの幅のまま（切り替えただけで、窓を広げない）
    public double SingleRoomW { get; set; } = 400;

    /// <summary>前回の位置と大きさがあれば戻す。閉じるときに覚える。画面の外に出てしまう位置は使わない。</summary>
    public void Remember(Window w, string key)
    {
        Restore(w, key);
        // 一度も表示していない窓（シングルペインの部品として使うだけの窓）は、覚えない
        w.Closed += (_, _) => { if (w.IsLoaded || w.IsVisible) Store(w, key); };
    }

    public void Restore(Window w, string key)
    {
        if (Windows.TryGetValue(key, out var p) && p.Length == 4 && OnScreen(p))
        {
            w.WindowStartupLocation = WindowStartupLocation.Manual;
            w.Left = p[0]; w.Top = p[1];
            if (w.ResizeMode != ResizeMode.NoResize) { w.Width = Math.Max(p[2], w.MinWidth); w.Height = Math.Max(p[3], w.MinHeight); }
        }
    }

    public void Store(Window w, string key)
    {
        var b = w.WindowState == WindowState.Normal ? new Rect(w.Left, w.Top, w.Width, w.Height) : w.RestoreBounds;
        if (double.IsNaN(b.Left) || double.IsNaN(b.Width)) return;
        Windows[key] = new[] { b.Left, b.Top, b.Width, b.Height }; Save();
    }

    static bool OnScreen(double[] p)
    {
        var v = new Rect(SystemParameters.VirtualScreenLeft, SystemParameters.VirtualScreenTop, SystemParameters.VirtualScreenWidth, SystemParameters.VirtualScreenHeight);
        var r = new Rect(p[0], p[1], Math.Max(p[2], 80), Math.Max(p[3], 60));
        r.Intersect(v);
        return !r.IsEmpty && r.Width > 60 && r.Height > 40;
    }
}
