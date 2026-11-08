using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;

namespace F88TiviAudio;

/// <summary>
/// Máy chủ WebSocket tối giản, chỉ nghe ở 127.0.0.1. Trang gửi (sender.html) kết nối vào để nhận âm thanh PCM.
/// Chỉ nhận Origin của trang F88Tivi hoặc mạng nội bộ, để trang web lạ không nghe lén được.
/// </summary>
sealed class WsServer : IDisposable
{
    public const int Port = 48221;
    readonly TcpListener _listener = new(IPAddress.Loopback, Port);
    readonly List<TcpClient> _clients = new();
    readonly object _lock = new();
    volatile bool _stop;

    public int ClientCount { get { lock (_lock) return _clients.Count; } }
    public event Action? ClientsChanged;

    public void Start()
    {
        _listener.Start();
        _ = Task.Run(AcceptLoop);
    }

    async Task AcceptLoop()
    {
        while (!_stop)
        {
            try
            {
                var c = await _listener.AcceptTcpClientAsync();
                _ = Task.Run(() => Handle(c));
            }
            catch { if (_stop) return; }
        }
    }

    static bool OriginOk(string? origin)
    {
        if (string.IsNullOrEmpty(origin) || !Uri.TryCreate(origin, UriKind.Absolute, out var u)) return false;
        var h = u.Host.ToLowerInvariant();
        if (h == "f88tivi.netlify.app" && u.Scheme == "https") return true;
        if (h == "localhost" || h == "127.0.0.1") return true;
        return IPAddress.TryParse(h, out var ip) && ip.AddressFamily == AddressFamily.InterNetwork &&
               (h.StartsWith("192.168.") || h.StartsWith("10.") || (h.StartsWith("172.") && int.TryParse(h.Split('.')[1], out int b) && b is >= 16 and <= 31));
    }

    void Handle(TcpClient c)
    {
        try
        {
            c.NoDelay = true; c.SendTimeout = 500;
            var s = c.GetStream();
            var head = ReadHeader(s);
            if (head == null) { c.Close(); return; }
            string? key = null, origin = null;
            foreach (var line in head.Split("\r\n"))
            {
                int i = line.IndexOf(':'); if (i < 0) continue;
                var name = line[..i].Trim().ToLowerInvariant(); var val = line[(i + 1)..].Trim();
                if (name == "sec-websocket-key") key = val;
                else if (name == "origin") origin = val;
            }
            if (key == null || !OriginOk(origin))
            {
                var bad = Encoding.ASCII.GetBytes("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                s.Write(bad); c.Close(); return;
            }
            var accept = Convert.ToBase64String(SHA1.HashData(Encoding.ASCII.GetBytes(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")));
            s.Write(Encoding.ASCII.GetBytes("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + "\r\n\r\n"));
            SendFrame(s, 1, Encoding.UTF8.GetBytes("{\"type\":\"hello\",\"sampleRate\":48000,\"channels\":2,\"format\":\"s16le\"}"));
            lock (_lock) _clients.Add(c);
            ClientsChanged?.Invoke();

            // Đọc và bỏ qua dữ liệu từ trình duyệt cho tới khi họ đóng kết nối.
            var buf = new byte[512];
            c.ReceiveTimeout = 0; c.SendTimeout = 500;
            while (!_stop && s.Read(buf, 0, buf.Length) > 0) { }
        }
        catch { }
        finally { Remove(c); }
    }

    static string? ReadHeader(NetworkStream s)
    {
        var sb = new StringBuilder(); var one = new byte[1];
        s.ReadTimeout = 3000;
        while (sb.Length < 8192)
        {
            if (s.Read(one, 0, 1) <= 0) return null;
            sb.Append((char)one[0]);
            if (sb.Length >= 4 && sb.ToString(sb.Length - 4, 4) == "\r\n\r\n") return sb.ToString();
        }
        return null;
    }

    static void SendFrame(NetworkStream s, byte opcode, byte[] payload)
    {
        var header = new List<byte> { (byte)(0x80 | opcode) };
        if (payload.Length < 126) header.Add((byte)payload.Length);
        else if (payload.Length <= 0xFFFF) { header.Add(126); header.Add((byte)(payload.Length >> 8)); header.Add((byte)payload.Length); }
        else { header.Add(127); for (int i = 7; i >= 0; i--) header.Add((byte)((long)payload.Length >> (8 * i))); }
        var all = new byte[header.Count + payload.Length];
        header.CopyTo(all); Buffer.BlockCopy(payload, 0, all, header.Count, payload.Length);
        s.Write(all, 0, all.Length);
    }

    public void Broadcast(byte[] pcm)
    {
        TcpClient[] list;
        lock (_lock) { if (_clients.Count == 0) return; list = _clients.ToArray(); }
        foreach (var c in list)
        {
            try { SendFrame(c.GetStream(), 2, pcm); }
            catch { Remove(c); }
        }
    }

    void Remove(TcpClient c)
    {
        bool removed;
        lock (_lock) removed = _clients.Remove(c);
        try { c.Close(); } catch { }
        if (removed) ClientsChanged?.Invoke();
    }

    public void Dispose()
    {
        _stop = true;
        try { _listener.Stop(); } catch { }
        lock (_lock) foreach (var c in _clients) try { c.Close(); } catch { }
    }
}
