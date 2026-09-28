// STL Viewer
// Copyright (c) 2026 Steve Rowley. All rights reserved.
// Proprietary and confidential. See LICENSE.

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.IO.Pipes;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace StlViewer
{
    internal static class Program
    {
        // Per-user names: two different accounts on one machine each get their
        // own instance, and neither can hijack the other's pipe.
        private static readonly string Key =
            "StlViewer.SingleInstance." + Environment.UserName;
        private static readonly string PipeName = Key + ".pipe";

        [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr hWnd);
        [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
        [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr hWnd);
        private const int SW_RESTORE = 9;

        [STAThread]
        private static void Main(string[] args)
        {
            var files = (args ?? Array.Empty<string>())
                .Where(a => !a.StartsWith("-") && File.Exists(a))
                .Select(Path.GetFullPath)
                .ToArray();

            // createdNew == false means another instance already owns the name.
            using var mutex = new Mutex(true, Key, out bool createdNew);

            if (!createdNew)
            {
                // Hand our files to the running instance and exit quietly.
                // If the handoff fails (instance is closing), fall through and
                // start normally rather than losing the user's double-click.
                if (SendToRunningInstance(files)) return;
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            var form = new MainForm(files);
            StartPipeServer(form);
            Application.Run(form);

            GC.KeepAlive(mutex);
        }

        /// <summary>Forwards file paths to the already-running instance.</summary>
        private static bool SendToRunningInstance(string[] files)
        {
            try
            {
                using var client = new NamedPipeClientStream(
                    ".", PipeName, PipeDirection.Out, PipeOptions.None);
                client.Connect(3000);
                var payload = string.Join("\n", files);
                var bytes = Encoding.UTF8.GetBytes(payload);
                client.Write(bytes, 0, bytes.Length);
                client.Flush();
                return true;
            }
            catch
            {
                return false;   // no listener, or it died mid-handshake
            }
        }

        /// <summary>
        /// Listens for later launches. One connection per launch; loops forever
        /// on a background thread so it never blocks the UI.
        /// </summary>
        private static void StartPipeServer(MainForm form)
        {
            var thread = new Thread(() =>
            {
                while (true)
                {
                    try
                    {
                        using var server = new NamedPipeServerStream(
                            PipeName, PipeDirection.In, 1,
                            PipeTransmissionMode.Byte, PipeOptions.None);
                        server.WaitForConnection();

                        using var reader = new StreamReader(server, Encoding.UTF8);
                        var payload = reader.ReadToEnd();

                        var files = payload
                            .Split('\n', StringSplitOptions.RemoveEmptyEntries)
                            .Select(p => p.Trim())
                            .Where(p => p.Length > 0)
                            .ToArray();

                        // Marshal onto the UI thread before touching the form.
                        if (!form.IsDisposed)
                        {
                            try
                            {
                                form.BeginInvoke(new Action(async () =>
                                {
                                    form.BringToFrontAggressively();
                                    if (files.Length > 0) await form.OpenFilesPublicAsync(files);
                                }));
                            }
                            catch (InvalidOperationException) { /* form closing */ }
                        }
                    }
                    catch
                    {
                        // A broken connection must not kill the listener.
                        Thread.Sleep(200);
                    }
                }
            })
            { IsBackground = true, Name = "StlViewer.SingleInstanceListener" };

            thread.SetApartmentState(ApartmentState.MTA);
            thread.Start();
        }

        internal static void Restore(IntPtr handle)
        {
            if (handle == IntPtr.Zero) return;
            if (IsIconic(handle)) ShowWindow(handle, SW_RESTORE);
            SetForegroundWindow(handle);
        }
    }

    public class MainForm : Form
    {
        // Everything is served from inside the exe over this virtual origin.
        private const string Host = "stlviewer.local";
        private const string Origin = "https://" + Host;
        private const string FilePrefix = "/__open/";

        private readonly WebView2 _web = new WebView2 { Dock = DockStyle.Fill };
        private readonly string[] _startupArgs;

        // token -> absolute path, for files the user opened this session
        private readonly ConcurrentDictionary<string, string> _openFiles = new();
        private int _token;
        private bool _loadedStartup;

        public MainForm(string[] args)
        {
            _startupArgs = args ?? Array.Empty<string>();

            Text = "STL Viewer";
            BackColor = Color.FromArgb(21, 23, 28);   // no white flash before first paint
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(1280, 820);
            MinimumSize = new Size(880, 560);
            AllowDrop = true;

            try
            {
                Icon = Icon.ExtractAssociatedIcon(Environment.ProcessPath ?? "") ?? Icon;
            }
            catch { /* icon is cosmetic */ }

            Controls.Add(_web);
            Load += async (_, __) => await InitAsync();

            // Fallback for Explorer drops that land on the frame rather than the page.
            DragEnter += (_, e) =>
            {
                if (e.Data != null && e.Data.GetDataPresent(DataFormats.FileDrop))
                    e.Effect = DragDropEffects.Copy;
            };
            DragDrop += async (_, e) =>
            {
                if (e.Data?.GetData(DataFormats.FileDrop) is string[] files)
                    await OpenFilesAsync(files);
            };
        }

        // ---- embedded UI -----------------------------------------------------

        private static Stream? Resource(string name)
        {
            var asm = Assembly.GetExecutingAssembly();
            // resources are named like "StlViewer.wwwroot.index.html"
            var full = asm.GetManifestResourceNames()
                          .FirstOrDefault(n => n.EndsWith(name, StringComparison.OrdinalIgnoreCase));
            return full == null ? null : asm.GetManifestResourceStream(full);
        }

        private static string MimeFor(string path) => Path.GetExtension(path).ToLowerInvariant() switch
        {
            ".html" => "text/html; charset=utf-8",
            ".js"   => "text/javascript; charset=utf-8",
            ".css"  => "text/css; charset=utf-8",
            ".svg"  => "image/svg+xml",
            ".ico"  => "image/x-icon",
            _       => "application/octet-stream",
        };

        private async Task InitAsync()
        {
            try
            {
                var userData = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "StlViewer", "WebView2");
                Directory.CreateDirectory(userData);

                var env = await CoreWebView2Environment.CreateAsync(null, userData);
                await _web.EnsureCoreWebView2Async(env);
                var core = _web.CoreWebView2;

                var s = core.Settings;
                s.AreDefaultContextMenusEnabled = false;
                s.IsStatusBarEnabled = false;
                s.AreBrowserAcceleratorKeysEnabled = false;
                s.IsZoomControlEnabled = false;
                s.IsSwipeNavigationEnabled = false;

                _web.DefaultBackgroundColor = Color.FromArgb(21, 23, 28);
                try { _web.AllowExternalDrop = true; } catch { /* older runtime */ }

                // Serve the whole app (and any opened STL) from inside the exe.
                core.AddWebResourceRequestedFilter(Origin + "/*", CoreWebView2WebResourceContext.All);
                core.WebResourceRequested += OnWebResourceRequested;

                core.NewWindowRequested += (_, e) =>
                {
                    e.Handled = true;
                    try
                    {
                        System.Diagnostics.Process.Start(
                            new System.Diagnostics.ProcessStartInfo(e.Uri) { UseShellExecute = true });
                    }
                    catch { }
                };

                core.WebMessageReceived += async (_, e) =>
                {
                    string msg;
                    try { msg = e.TryGetWebMessageAsString(); } catch { return; }
                    if (msg == "pickFiles") await PickFilesAsync();
                };

                core.NavigationCompleted += async (_, e) =>
                {
                    if (_loadedStartup || !e.IsSuccess) return;
                    _loadedStartup = true;
                    var files = _startupArgs.Where(a => !a.StartsWith("-") && File.Exists(a)).ToArray();
                    if (files.Length > 0) await OpenFilesAsync(files);
                };

                core.Navigate(Origin + "/index.html");
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "STL Viewer could not start its display component.\n\n" + ex.Message +
                    "\n\nThe Microsoft Edge WebView2 Runtime may be missing. Install it from:\n" +
                    "https://developer.microsoft.com/microsoft-edge/webview2/",
                    "STL Viewer", MessageBoxButtons.OK, MessageBoxIcon.Error);
                Close();
            }
        }

        private void OnWebResourceRequested(object? sender, CoreWebView2WebResourceRequestedEventArgs e)
        {
            try
            {
                var uri = new Uri(e.Request.Uri);
                var path = Uri.UnescapeDataString(uri.AbsolutePath);
                var env = _web.CoreWebView2.Environment;

                // An STL the user opened: stream it straight off disk.
                if (path.StartsWith(FilePrefix, StringComparison.Ordinal))
                {
                    var token = path.Substring(FilePrefix.Length);
                    if (_openFiles.TryGetValue(token, out var full) && File.Exists(full))
                    {
                        var fs = new FileStream(full, FileMode.Open, FileAccess.Read,
                                                FileShare.ReadWrite | FileShare.Delete);
                        e.Response = env.CreateWebResourceResponse(
                            fs, 200, "OK",
                            "Content-Type: application/octet-stream\r\nCache-Control: no-store");
                    }
                    else
                    {
                        e.Response = env.CreateWebResourceResponse(null, 404, "Not Found", "");
                    }
                    return;
                }

                // Otherwise serve the embedded UI.
                if (path == "/" || path.Length == 0) path = "/index.html";
                var res = Resource(path.Replace('/', '.'));
                e.Response = res != null
                    ? env.CreateWebResourceResponse(res, 200, "OK", "Content-Type: " + MimeFor(path))
                    : env.CreateWebResourceResponse(null, 404, "Not Found", "");
            }
            catch
            {
                try
                {
                    e.Response = _web.CoreWebView2.Environment
                        .CreateWebResourceResponse(null, 500, "Error", "");
                }
                catch { }
            }
        }

        // ---- single-instance entry points ------------------------------------

        /// <summary>
        /// Called when a second launch hands us its files. Restores the window
        /// if minimised and pulls it to the front.
        /// </summary>
        public void BringToFrontAggressively()
        {
            try
            {
                if (WindowState == FormWindowState.Minimized)
                    WindowState = FormWindowState.Normal;
                Show();
                Activate();
                // TopMost flip is the reliable way to steal focus from another
                // foreground app without leaving the window permanently on top.
                var wasTop = TopMost;
                TopMost = true;
                TopMost = wasTop;
                Program.Restore(Handle);
            }
            catch { /* focus stealing is best-effort */ }
        }

        /// <summary>Entry point for files forwarded by a second launch.</summary>
        public Task OpenFilesPublicAsync(IEnumerable<string> paths) => OpenFilesAsync(paths);

        // ---- opening files ---------------------------------------------------

        private async Task PickFilesAsync()
        {
            using var dlg = new OpenFileDialog
            {
                Title = "Open STL files",
                Filter = "STL models (*.stl)|*.stl|All files (*.*)|*.*",
                Multiselect = true
            };
            if (dlg.ShowDialog(this) == DialogResult.OK)
                await OpenFilesAsync(dlg.FileNames);
        }

        private async Task OpenFilesAsync(IEnumerable<string> paths)
        {
            if (_web.CoreWebView2 == null) return;

            var list = paths
                .Where(p => !string.IsNullOrWhiteSpace(p) && File.Exists(p) &&
                            Path.GetExtension(p).Equals(".stl", StringComparison.OrdinalIgnoreCase))
                .ToList();
            if (list.Count == 0) return;

            foreach (var file in list)
            {
                var token = System.Threading.Interlocked.Increment(ref _token).ToString();
                _openFiles[token] = Path.GetFullPath(file);

                var url = Origin + FilePrefix + token;
                var name = Path.GetFileName(file);
                var script = "window.__loadFromHost && window.__loadFromHost(" +
                             JsonSerializer.Serialize(url) + "," +
                             JsonSerializer.Serialize(name) + ")";
                await _web.CoreWebView2.ExecuteScriptAsync(script);
            }
        }
    }
}
