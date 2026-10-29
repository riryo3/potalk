using System;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Reflection;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Interop;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace Potalker;

/// <summary>通話の仕組み（potalk.app のページ）を動かす、画面に出ない WebView2。</summary>
public sealed class Engine
{
    public static readonly Uri Home = new("https://potalk.app/");

    public JsonElement Lobby = J.Empty, Profile = J.Empty, Room = J.Empty, Cards = J.Empty;
    public string Eq = "";
    public bool Ready, Patched;

    public event Action OnLobby, OnProfile, OnRoom, OnEq, OnReady, OnCards, OnReloading;
    public event Action<JsonElement> OnChat, OnReact;
    public Action<string> Log = _ => { };

    Window host;
    WebView2 wv;
    readonly HttpClient http = new() { Timeout = TimeSpan.FromSeconds(15) };

    public bool Joined => Room.B("joined");

    static string Res(string name)
    {
        using var s = Assembly.GetExecutingAssembly().GetManifestResourceStream("Potalker.Assets." + name);
        using var r = new StreamReader(s, Encoding.UTF8);
        return r.ReadToEnd();
    }

    public async Task StartAsync()
    {
        wv = new WebView2();
        host = new Window
        {
            Width = 900, Height = 700, Left = -20000, Top = -20000,
            WindowStyle = WindowStyle.None, ShowInTaskbar = false, ShowActivated = false, Content = wv,
        };
        host.SourceInitialized += (_, _) =>
        {   // Alt+Tab に出さない・前面に出ない
            var h = new WindowInteropHelper(host).Handle;
            SetWindowLong(h, -20, GetWindowLong(h, -20) | 0x80 | 0x08000000);
        };
        host.Show();

        var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Potalker", "WebView2");
        var opts = new CoreWebView2EnvironmentOptions("--disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows --autoplay-policy=no-user-gesture-required");
        var env = await CoreWebView2Environment.CreateAsync(null, dir, opts);
        await wv.EnsureCoreWebView2Async(env);
        var c = wv.CoreWebView2;
        await c.AddScriptToExecuteOnDocumentCreatedAsync(Res("mic.js"));
        await c.AddScriptToExecuteOnDocumentCreatedAsync(Res("bridge.js"));
        c.AddWebResourceRequestedFilter("https://potalk.app/*", CoreWebView2WebResourceContext.Document);
        c.WebResourceRequested += OnRequest;
        c.WebMessageReceived += OnMessage;
        c.PermissionRequested += (_, e) =>
        {
            var okKind = e.PermissionKind is CoreWebView2PermissionKind.Microphone or CoreWebView2PermissionKind.Camera or CoreWebView2PermissionKind.ClipboardRead;
            e.State = okKind && new Uri(e.Uri).Host == "potalk.app" ? CoreWebView2PermissionState.Allow : CoreWebView2PermissionState.Deny;
        };
        c.NewWindowRequested += (_, e) => { e.Handled = true; OpenExternal(e.Uri); };
        c.NavigationStarting += (_, e) =>
        {
            if (Uri.TryCreate(e.Uri, UriKind.Absolute, out var u) && (u.Scheme == "http" || u.Scheme == "https") && u.Host != "potalk.app" && e.IsUserInitiated)
            { e.Cancel = true; OpenExternal(e.Uri); }
        };
        c.ScriptDialogOpening += (_, e) => e.Accept();
        c.ProcessFailed += (_, e) =>
        {
            Log("ページの描画プロセスが落ちました: " + e.ProcessFailedKind);
            if (e.ProcessFailedKind is CoreWebView2ProcessFailedKind.RenderProcessExited or CoreWebView2ProcessFailedKind.RenderProcessUnresponsive)
            { Ready = false; OnReloading?.Invoke(); c.Reload(); }
        };
        c.Navigate(Home.ToString());
    }

    public static void OpenExternal(string url)
    {
        if (Uri.TryCreate(url, UriKind.Absolute, out var u) && (u.Scheme == "http" || u.Scheme == "https"))
            Process.Start(new ProcessStartInfo(u.AbsoluteUri) { UseShellExecute = true });
    }

    /// <summary>potalk.app の本体ページだけを取りに行って、小さな差し込みを当てて返す（ほかの通信はそのまま）。</summary>
    async void OnRequest(object sender, CoreWebView2WebResourceRequestedEventArgs e)
    {
        if (e.Request.Method != "GET") return;
        var path = new Uri(e.Request.Uri).AbsolutePath;
        if (path != "/" && path != "/index.html") return;
        var d = e.GetDeferral();
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Get, Home);
            req.Headers.CacheControl = new System.Net.Http.Headers.CacheControlHeaderValue { NoCache = true };
            using var res = await http.SendAsync(req);
            // エラーのページ（5xx など）を、200 の本物のページとして差し込まない。ページ本来の読み込みに任せる
            if (!res.IsSuccessStatusCode) { Log("ページの取得に失敗: " + (int)res.StatusCode); return; }
            var html = await res.Content.ReadAsStringAsync();
            var (outHtml, ok, missing) = PagePatcher.Apply(html);
            Patched = ok;
            if (!ok) Log("差し込み位置が見つかりません。元のページを使います: " + missing);
            var bytes = Encoding.UTF8.GetBytes(outHtml);
            e.Response = wv.CoreWebView2.Environment.CreateWebResourceResponse(new MemoryStream(bytes), 200, "OK",
                "Content-Type: text/html; charset=utf-8\r\nCache-Control: no-store");
        }
        catch (Exception ex) { Log("ページの取得に失敗: " + ex.Message); }
        finally { d.Complete(); }
    }

    static JsonDocument ParseOrNull(string json) { try { return JsonDocument.Parse(json); } catch { return null; } }

    // ---- ページからの知らせ ----
    void OnMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        JsonElement msg;
        using var doc = ParseOrNull(e.WebMessageAsJson);
        if (doc == null) return;
        msg = doc.RootElement;
        var d = msg.P("d").Clone();
        switch (msg.S("t"))
        {
            case "lobby": Lobby = d; OnLobby?.Invoke(); break;
            case "profile": Profile = d; OnProfile?.Invoke(); break;
            case "room": Room = d; OnRoom?.Invoke(); break;
            case "cards": Cards = d; OnCards?.Invoke(); break;
            case "eq": Eq = d.ValueKind == JsonValueKind.String ? d.GetString() : ""; OnEq?.Invoke(); break;
            case "chat": OnChat?.Invoke(d); break;
            case "react": OnReact?.Invoke(d); break;
            case "ready": Ready = true; OnReady?.Invoke(); break;
        }
    }

    // ---- 指示 ----
    public void Cmd(object dict)
    {
        if (wv?.CoreWebView2 == null) return;
        _ = wv.CoreWebView2.ExecuteScriptAsync("window.__pm && window.__pm.cmd(" + JsonSerializer.Serialize(dict) + ")");
    }

    public enum LinkResult { Joined, Asleep, Choose, Invalid, Timeout }

    /// <summary>
    /// 部屋のリンクで入る：そのリンクでページを読み込み直し、入口の案内が「いま開いています」になって
    /// 部屋の名前が入ったら、参加を押す（名前なしのリンクでも、開いている部屋なら、名前は自動で入る）。
    /// </summary>
    public async void OpenLink(string text, Action<LinkResult> done)
    {
        var i = text.IndexOf("#room=", StringComparison.Ordinal);
        if (i < 0) return;
        var hash = text[i..].Split(' ', '\n', '\r')[0];
        Ready = false; OnReloading?.Invoke();
        wv.CoreWebView2.Navigate(Home + hash);
        // 「#」以降だけが変わる移動は、読み込み直しにならない。必ず読み込み直して、差し込み済みのページで始める
        await Task.Delay(150);
        wv.CoreWebView2.Reload();
        const string probe = "JSON.stringify({t: (document.getElementById('entryText')||{}).textContent||'', n: !!(document.getElementById('entryNote')&&!document.getElementById('entryNote').hidden), name: (document.getElementById('room')||{}).value||''})";
        int asleep = 0, idle = 0;
        for (int n = 0; n < 80; n++)   // 最大 40 秒
        {
            await Task.Delay(500);
            if (Joined) { done(LinkResult.Joined); return; }
            if (!Ready) continue;
            string t, name; bool shown;
            try
            {
                var raw = await wv.CoreWebView2.ExecuteScriptAsync(probe);      // 文字列の JSON が、さらに文字列として返る
                var o = JsonDocument.Parse(JsonSerializer.Deserialize<string>(raw)).RootElement;
                t = o.S("t"); name = o.S("name"); shown = o.B("n");
            }
            catch { continue; }
            if (t.Contains("いま開いています") && name.Length > 0)
            {
                Cmd(new { type = "entryJoin" });
                for (int k = 0; k < 40; k++) { await Task.Delay(500); if (Joined) { done(LinkResult.Joined); return; } }
                done(LinkResult.Timeout); return;
            }
            if (t.Contains("同じ名前の部屋")) { done(LinkResult.Choose); return; }
            // ページが入口の案内を出さない（部屋のIDとして読み取れない）リンクは、待たずに知らせる
            if (!shown && t.Length == 0 && name.Length == 0) { if (++idle > 10) { done(LinkResult.Invalid); return; } } else idle = 0;
            if (t.Contains("😴")) { if (++asleep > 2) { done(LinkResult.Asleep); return; } } else asleep = 0;
        }
        done(LinkResult.Timeout);
    }

    [System.Runtime.InteropServices.DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
    [System.Runtime.InteropServices.DllImport("user32.dll")] static extern int SetWindowLong(IntPtr h, int i, int v);
}
