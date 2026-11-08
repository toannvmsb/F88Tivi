namespace F88TiviAudio;

static class Program
{
    [STAThread]
    static int Main(string[] args)
    {
        // Chế độ kiểm tra: F88TiviAudio.exe --probe <pid> <file>  → ghi mức âm của tiến trình đó trong 14 giây.
        if (args.Length == 3 && args[0] == "--probe") return Probe(uint.Parse(args[1]), args[2]);

        using var mutex = new Mutex(true, "F88TiviAudio.Single", out bool first);
        if (!first) return 0;
        ApplicationConfiguration.Initialize();
        Application.Run(new MainForm());
        return 0;
    }

    static int Probe(uint pid, string file)
    {
        try
        {
            using var cap = ProcessLoopbackCapture.StartAsync(pid).GetAwaiter().GetResult();
            long bytes = 0; cap.Data += b => Interlocked.Add(ref bytes, b.Length);
            using var w = new StreamWriter(file) { AutoFlush = true };
            for (int i = 0; i < 28; i++)
            {
                Thread.Sleep(500);
                w.WriteLine($"{i * 0.5:F1}s peak={cap.Peak:F4} bytes={Interlocked.Read(ref bytes)}");
            }
            return 0;
        }
        catch (Exception ex) { File.WriteAllText(file, "ERROR " + ex); return 1; }
    }
}
