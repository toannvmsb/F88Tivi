using System.Runtime.InteropServices;

namespace F88TiviAudio;

/// <summary>
/// Bắt âm thanh của RIÊNG một ứng dụng (kèm tiến trình con) bằng WASAPI "process loopback" (Windows 10 2004+).
/// Đầu ra: PCM 16-bit, 48 kHz, 2 kênh.
/// </summary>
sealed class ProcessLoopbackCapture : IDisposable
{
    public const int SampleRate = 48000;
    public const int Channels = 2;

    public event Action<byte[]>? Data;
    public event Action<string>? Failed;
    public volatile float Peak;               // 0..1, để vẽ thanh mức âm

    IAudioClient? _client;
    IAudioCaptureClient? _capture;
    EventWaitHandle? _event;
    Thread? _thread;
    volatile bool _stop;

    public static async Task<ProcessLoopbackCapture> StartAsync(uint pid)
    {
        var c = new ProcessLoopbackCapture();
        await c.InitAsync(pid);
        return c;
    }

    async Task InitAsync(uint pid)
    {
        var p = new ActivationParams { ActivationType = 1, TargetProcessId = pid, ProcessLoopbackMode = 0 }; // 0 = gồm cả tiến trình con
        int size = Marshal.SizeOf<ActivationParams>();
        IntPtr pParams = Marshal.AllocHGlobal(size);
        IntPtr pVar = Marshal.AllocHGlobal(Marshal.SizeOf<PropVariant>());
        try
        {
            Marshal.StructureToPtr(p, pParams, false);
            Marshal.StructureToPtr(new PropVariant { vt = 65 /*VT_BLOB*/, cbSize = (uint)size, pBlobData = pParams }, pVar, false);

            var handler = new Handler();
            var iid = typeof(IAudioClient).GUID;
            NativeMethods.ActivateAudioInterfaceAsync("VAD\\Process_Loopback", ref iid, pVar, handler, out _);
            _client = await handler.Task.WaitAsync(TimeSpan.FromSeconds(5));
        }
        finally { Marshal.FreeHGlobal(pParams); Marshal.FreeHGlobal(pVar); }

        var fmt = new WaveFormatEx
        {
            wFormatTag = 1, nChannels = Channels, nSamplesPerSec = SampleRate,
            wBitsPerSample = 16, nBlockAlign = Channels * 2, nAvgBytesPerSec = SampleRate * Channels * 2, cbSize = 0
        };
        IntPtr pFmt = Marshal.AllocHGlobal(Marshal.SizeOf<WaveFormatEx>());
        try
        {
            Marshal.StructureToPtr(fmt, pFmt, false);
            const uint LOOPBACK = 0x00020000, EVENTCB = 0x00040000, AUTOCONV = 0x80000000, SRCQ = 0x08000000;
            var session = Guid.Empty;
            _client.Initialize(0 /*SHARED*/, LOOPBACK | EVENTCB | AUTOCONV | SRCQ, 200000, 0, pFmt, ref session);
        }
        finally { Marshal.FreeHGlobal(pFmt); }

        _event = new EventWaitHandle(false, EventResetMode.AutoReset);
        _client.SetEventHandle(_event.SafeWaitHandle.DangerousGetHandle());
        var capIid = typeof(IAudioCaptureClient).GUID;
        _client.GetService(ref capIid, out object cap);
        _capture = (IAudioCaptureClient)cap;
        _client.Start();

        _thread = new Thread(Loop) { IsBackground = true, Name = "F88 audio capture" };
        _thread.Start();
    }

    void Loop()
    {
        try
        {
            while (!_stop)
            {
                _event!.WaitOne(100);
                while (!_stop)
                {
                    _capture!.GetNextPacketSize(out uint frames);
                    if (frames == 0) break;
                    _capture.GetBuffer(out IntPtr data, out uint n, out uint flags, out _, out _);
                    int bytes = (int)n * Channels * 2;
                    var buf = new byte[bytes];
                    float peak = 0;
                    if ((flags & 2) == 0) // 2 = AUDCLNT_BUFFERFLAGS_SILENT
                    {
                        Marshal.Copy(data, buf, 0, bytes);
                        for (int i = 0; i < bytes; i += 2)
                        {
                            float v = Math.Abs(BitConverter.ToInt16(buf, i)) / 32768f;
                            if (v > peak) peak = v;
                        }
                    }
                    _capture.ReleaseBuffer(n);
                    Peak = peak;
                    Data?.Invoke(buf);
                }
            }
        }
        catch (Exception ex) { if (!_stop) Failed?.Invoke(ex.Message); }
    }

    public void Dispose()
    {
        _stop = true;
        try { _client?.Stop(); } catch { }
        _thread?.Join(500);
        if (_capture != null) Marshal.ReleaseComObject(_capture);
        if (_client != null) Marshal.ReleaseComObject(_client);
        _event?.Dispose();
        _capture = null; _client = null;
    }

    // ---------- COM interop ----------
    sealed class Handler : IActivateAudioInterfaceCompletionHandler, IAgileObject
    {
        readonly TaskCompletionSource<IAudioClient> _tcs = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public Task<IAudioClient> Task => _tcs.Task;
        public void ActivateCompleted(IActivateAudioInterfaceAsyncOperation op)
        {
            try
            {
                op.GetActivateResult(out int hr, out object iface);
                if (hr != 0) _tcs.TrySetException(new COMException("Không bắt được âm thanh của ứng dụng này", hr));
                else _tcs.TrySetResult((IAudioClient)iface);
            }
            catch (Exception e) { _tcs.TrySetException(e); }
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    struct ActivationParams { public int ActivationType; public uint TargetProcessId; public int ProcessLoopbackMode; }

    [StructLayout(LayoutKind.Sequential)]
    struct PropVariant { public ushort vt, r1, r2, r3; public uint cbSize; public IntPtr pBlobData; }

    [StructLayout(LayoutKind.Sequential, Pack = 1)]
    struct WaveFormatEx
    {
        public ushort wFormatTag, nChannels; public uint nSamplesPerSec, nAvgBytesPerSec;
        public ushort nBlockAlign, wBitsPerSample, cbSize;
    }

    static class NativeMethods
    {
        [DllImport("Mmdevapi.dll", ExactSpelling = true, PreserveSig = false)]
        public static extern void ActivateAudioInterfaceAsync(
            [MarshalAs(UnmanagedType.LPWStr)] string deviceInterfacePath, ref Guid riid, IntPtr activationParams,
            IActivateAudioInterfaceCompletionHandler handler, out IActivateAudioInterfaceAsyncOperation op);
    }

    [ComImport, Guid("94ea2b94-e9cc-49e0-c0ff-ee64ca8f5b90"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAgileObject { }

    [ComImport, Guid("41D949AB-9862-444A-80F6-C261334DA5EB"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IActivateAudioInterfaceCompletionHandler { void ActivateCompleted(IActivateAudioInterfaceAsyncOperation op); }

    [ComImport, Guid("72A22D78-CDE4-431D-B8CC-843A71199B6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IActivateAudioInterfaceAsyncOperation
    {
        void GetActivateResult(out int activateResult, [MarshalAs(UnmanagedType.IUnknown)] out object activatedInterface);
    }

    [ComImport, Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioClient
    {
        void Initialize(int shareMode, uint streamFlags, long bufferDuration, long periodicity, IntPtr format, ref Guid sessionGuid);
        void GetBufferSize(out uint frames);
        void GetStreamLatency(out long latency);
        void GetCurrentPadding(out uint padding);
        void IsFormatSupported(int shareMode, IntPtr format, out IntPtr closest);
        void GetMixFormat(out IntPtr format);
        void GetDevicePeriod(out long defaultPeriod, out long minPeriod);
        void Start();
        void Stop();
        void Reset();
        void SetEventHandle(IntPtr eventHandle);
        void GetService(ref Guid riid, [MarshalAs(UnmanagedType.IUnknown)] out object service);
    }

    [ComImport, Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioCaptureClient
    {
        void GetBuffer(out IntPtr data, out uint frames, out uint flags, out ulong devicePosition, out ulong qpcPosition);
        void ReleaseBuffer(uint frames);
        void GetNextPacketSize(out uint frames);
    }
}
