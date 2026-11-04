using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Net.Http;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows;

namespace Potalker;

/// <summary>
/// GitHub のリリースを見て、新しい版があれば知らせる。「更新して再起動」を選ぶと、新しい版をダウンロードして、
/// いまの Potalker.exe と入れ替え、開き直す。取りにいくのは、このリポジトリ（riryo3/potalk）の
/// 「win-v数字」のリリースにある Potalker-win-x64.zip だけ。
/// </summary>
public static class Updater
{
    const string Repo = "riryo3/potalk";
    static readonly HttpClient Http = MakeClient();
    static readonly HashSet<string> Asked = new();
    static bool busy;

    static HttpClient MakeClient()
    {
        var c = new HttpClient { Timeout = TimeSpan.FromMinutes(5) };
        c.DefaultRequestHeaders.UserAgent.ParseAdd("Potalker-updater");
        c.DefaultRequestHeaders.Accept.ParseAdd("application/vnd.github+json");
        return c;
    }

    public static string Current
    {
        get { var v = typeof(Program).Assembly.GetName().Version; return v == null ? "" : $"{v.Major}.{v.Minor}.{v.Build}"; }
    }

    static string ExePath => Environment.ProcessPath ?? "";
    /// <summary>Potalker.exe として開いているときだけ、入れ替えができる（dotnet run などの開発中は、しない）</summary>
    static bool CanSelfUpdate => ExePath.EndsWith("Potalker.exe", StringComparison.OrdinalIgnoreCase);

    /// <summary>起動の少しあとと、そのあと6時間ごとに、自動で確かめる</summary>
    public static void Start(AppModel m)
    {
        if (!CanSelfUpdate) return;
        try { var old = ExePath + ".old"; if (File.Exists(old)) File.Delete(old); } catch { }   // 前回の更新で残った古い版を片づける
        var t = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromHours(6) };
        t.Tick += async (_, _) => await CheckAsync(m, false);
        t.Start();
        var first = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromSeconds(8) };
        first.Tick += async (_, _) => { first.Stop(); await CheckAsync(m, false); };
        first.Start();
    }

    static int[] Parts(string v) => v.Split('.').Select(x => int.TryParse(x, out var n) ? n : 0).ToArray();
    static bool IsNewer(string a, string b)
    {
        var x = Parts(a); var y = Parts(b);
        for (int i = 0; i < Math.Max(x.Length, y.Length); i++)
        {
            int p = i < x.Length ? x[i] : 0, q = i < y.Length ? y[i] : 0;
            if (p != q) return p > q;
        }
        return false;
    }

    sealed record Found(string Version, string Zip, string Page);

    static async Task<Found> LatestAsync()
    {
        using var doc = JsonDocument.Parse(await Http.GetStringAsync($"https://api.github.com/repos/{Repo}/releases?per_page=40"));
        Found best = null;
        foreach (var r in doc.RootElement.EnumerateArray())
        {
            if (r.GetProperty("draft").GetBoolean() || r.GetProperty("prerelease").GetBoolean()) continue;
            // Windows 版のタグは「win-v0.3.13」の形（v… や android-v… は、別のアプリ）
            var mt = Regex.Match(r.GetProperty("tag_name").GetString() ?? "", @"^win-v(\d+\.\d+\.\d+)$");
            if (!mt.Success) continue;
            var ver = mt.Groups[1].Value;
            foreach (var a in r.GetProperty("assets").EnumerateArray())
            {
                var url = a.GetProperty("browser_download_url").GetString() ?? "";
                if (a.GetProperty("name").GetString() != "Potalker-win-x64.zip" || !url.StartsWith($"https://github.com/{Repo}/releases/download/")) continue;
                if (best == null || IsNewer(ver, best.Version)) best = new Found(ver, url, r.GetProperty("html_url").GetString());
            }
        }
        return best;
    }

    public static async Task CheckAsync(AppModel m, bool manual)
    {
        if (busy) return;
        if (!CanSelfUpdate)
        {
            if (manual) MessageBox.Show(m.Main, "Potalker.exe として開いているときだけ、更新できます。", "Potalker");
            return;
        }
        busy = true;
        try
        {
            Found f;
            try { f = await LatestAsync(); }
            catch (Exception ex)
            {
                AppModel.CallLog("更新の確認に失敗しました（" + ex.Message + "）");
                if (manual) MessageBox.Show(m.Main, "更新を確認できませんでした。\nネットワークにつながっているか、確かめてください。", "Potalker");
                return;
            }
            if (f == null || !IsNewer(f.Version, Current))
            {
                if (manual) MessageBox.Show(m.Main, $"最新の版です。\nいまの版は {Current} です。", "Potalker");
                return;
            }
            if (!manual && !Asked.Add(f.Version)) return;   // 同じ版は、起動中に何度も聞かない
            Asked.Add(f.Version);
            if (!Ui.Ask(m.Main, $"新しい版（{f.Version}）があります",
                $"いまの版は {Current} です。更新すると、アプリがいったん終了して、新しい版で開き直します。通話中のときは、部屋から退出します。",
                "更新して再起動", "あとで")) return;
            await InstallAsync(m, f);
        }
        finally { busy = false; }
    }

    static async Task InstallAsync(AppModel m, Found f)
    {
        var exe = ExePath;
        var staged = exe + ".new";
        var title = m.Main.Title;
        try
        {
            m.Main.Title = title + "　（更新をダウンロード中…）";
            // 1) ダウンロード
            var zipPath = Path.Combine(Path.GetTempPath(), "potalker-update-" + Guid.NewGuid().ToString("N") + ".zip");
            using (var resp = await Http.GetAsync(f.Zip, HttpCompletionOption.ResponseHeadersRead))
            {
                resp.EnsureSuccessStatusCode();
                using var fs = File.Create(zipPath);
                await resp.Content.CopyToAsync(fs);
            }
            // 2) 中の Potalker.exe を、いまの exe の隣に取り出して、確かめる（実行ファイルか・版が合うか）
            if (File.Exists(staged)) File.Delete(staged);
            using (var zip = ZipFile.OpenRead(zipPath))
            {
                var entry = zip.Entries.FirstOrDefault(e => e.Name == "Potalker.exe") ?? throw new InvalidDataException("ダウンロードしたファイルに、Potalker.exe がありません");
                entry.ExtractToFile(staged, true);
            }
            try { File.Delete(zipPath); } catch { }
            var len = new FileInfo(staged).Length;
            var head = new byte[2]; using (var fs = File.OpenRead(staged)) fs.ReadExactly(head, 0, 2);
            var fv = FileVersionInfo.GetVersionInfo(staged).FileVersion ?? "";
            if (len < 10_000_000 || head[0] != (byte)'M' || head[1] != (byte)'Z' || !fv.StartsWith(f.Version + "."))
                throw new InvalidDataException("ダウンロードしたアプリの中身が、想定と違います");
            // 3) 動いている exe は、名前を変えることはできる。変えたあとに、新しい版を同じ名前で置く
            var old = exe + ".old";
            if (File.Exists(old)) File.Delete(old);
            File.Move(exe, old);
            try { File.Move(staged, exe); }
            catch { File.Move(old, exe); throw; }
            AppModel.CallLog($"更新します：{Current} → {f.Version}");
            // 4) 部屋から抜けて閉じる。閉じたあとに、新しい版を開く（少し待ってから開く手順を、切り離して走らせる）
            Process.Start(new ProcessStartInfo("cmd.exe", $"/c timeout /t 3 /nobreak >nul & start \"\" \"{exe}\"") { CreateNoWindow = true, UseShellExecute = false });
            m.Quitting = true;
            if (m.E.Joined) { m.E.Cmd(new { type = "leave" }); await Task.Delay(700); }
            m.Main.Close();
        }
        catch (Exception ex)
        {
            m.Main.Title = title;
            try { if (File.Exists(staged)) File.Delete(staged); } catch { }
            AppModel.CallLog("更新に失敗しました（" + ex.Message + "）");
            if (Ui.Ask(m.Main, "更新できませんでした", ex.Message + "\nリリースのページから、手で入れ替えてください。", "リリースのページを開く", "閉じる"))
                Process.Start(new ProcessStartInfo(f.Page) { UseShellExecute = true });
        }
    }
}
