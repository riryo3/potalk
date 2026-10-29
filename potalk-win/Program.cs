using System;
using System.Windows;

namespace Potalker;

public static class Program
{
    static void LogError(Exception ex)
    {
        try
        {
            var dir = System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Potalker");
            System.IO.Directory.CreateDirectory(dir);
            System.IO.File.AppendAllText(System.IO.Path.Combine(dir, "error.log"), $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] {ex}\n\n");
        }
        catch { }
    }

    [STAThread]
    public static void Main()
    {
        var app = new Application { ShutdownMode = ShutdownMode.OnMainWindowClose };
        var model = new AppModel();
        var main = new MainWindow(model);
        model.Main = main;
        main.Loaded += async (_, _) =>
        {
            model.Start();
            try { await model.E.StartAsync(); }
            catch (Exception ex)
            {
                MessageBox.Show(main, "通話の部品（WebView2）を起動できませんでした。\n\nMicrosoft Edge WebView2 ランタイムが必要です。\n\n" + ex.Message,
                    "Potalker", MessageBoxButton.OK, MessageBoxImage.Error);
            }
            HelpWindows.ShowThanksIfFirst(model);
        };
        // 画面の操作中の思わぬエラーで、通話ごと落ちないようにする（内容は記録に残す）
        app.DispatcherUnhandledException += (_, e) => { LogError(e.Exception); e.Handled = true; };
        Shortcuts.Install(model);
        Scaling.Install(model);
        app.SessionEnding += (_, _) => model.Quitting = true;     // Windows のサインアウト・シャットダウンでは、確認しない
        app.Run(main);
    }
}
