using System;
using System.Windows;

namespace Potalker;

public static class Program
{
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
        Shortcuts.Install(model);
        Scaling.Install(model);
        app.SessionEnding += (_, _) => model.Quitting = true;     // Windows のサインアウト・シャットダウンでは、確認しない
        app.Run(main);
    }
}
