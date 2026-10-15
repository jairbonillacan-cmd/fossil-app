# Captures ONLY the Fossil window (not the full screen or the IDE) as PNG.
# It brings the window to the front and copies its on-screen bounds (DWM
# extended frame), so the Mica backdrop looks exactly as the user sees it.
# The process owns helper windows too (e.g. the 22x22 single-instance window
# in dev), so it picks the LARGEST visible top-level window of the process.
# Usage: powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/capture-window.ps1 -Out docs/screenshots/26-light.png [-ProcessName fossil-desktop]
param(
    [Parameter(Mandatory = $true)]
    [string]$Out,
    [string]$ProcessName = "fossil-desktop",
    # The PO keeps a live preview of main open; never capture it.
    [string]$ExcludeTitle = "Vista previa",
    [int]$DelayMs = 600
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class FossilCapture {
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    public delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int max);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
    [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT r, int size);

    // DWMWA_EXTENDED_FRAME_BOUNDS (9): visible bounds without the invisible resize border.
    public static bool Bounds(IntPtr h, out RECT r) { return DwmGetWindowAttribute(h, 9, out r, 16) == 0; }

    // Largest visible top-level window owned by any of the given processes.
    public static string Title(IntPtr h) { var s = new System.Text.StringBuilder(512); GetWindowText(h, s, 512); return s.ToString(); }

    public static IntPtr Largest(HashSet<uint> pids, string exclude) {
        IntPtr best = IntPtr.Zero; long bestArea = 0;
        EnumWindows((h, l) => {
            uint pid; GetWindowThreadProcessId(h, out pid);
            RECT r;
            if (pids.Contains(pid) && IsWindowVisible(h) && !(exclude.Length > 0 && Title(h).Contains(exclude)) && Bounds(h, out r)) {
                long area = (long)(r.Right - r.Left) * (r.Bottom - r.Top);
                if (area > bestArea) { bestArea = area; best = h; }
            }
            return true;
        }, IntPtr.Zero);
        return best;
    }
}
"@

[FossilCapture]::SetProcessDPIAware() | Out-Null
$pids = New-Object 'System.Collections.Generic.HashSet[uint32]'
Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | ForEach-Object { [void]$pids.Add([uint32]$_.Id) }
if ($pids.Count -eq 0) { Write-Output "capture: no hay procesos '$ProcessName' (ejecuta pnpm.cmd dev primero)"; exit 1 }

$h = [FossilCapture]::Largest($pids, $ExcludeTitle)
if ($h -eq [IntPtr]::Zero) { Write-Output "capture: '$ProcessName' no tiene ventanas visibles"; exit 1 }
if ([FossilCapture]::IsIconic($h)) { [FossilCapture]::ShowWindow($h, 9) | Out-Null }  # SW_RESTORE
[FossilCapture]::SetForegroundWindow($h) | Out-Null
Start-Sleep -Milliseconds $DelayMs

$r = New-Object FossilCapture+RECT
if (-not [FossilCapture]::Bounds($h, [ref]$r)) { Write-Output "capture: DwmGetWindowAttribute fallo"; exit 1 }
$w = $r.Right - $r.Left
$hgt = $r.Bottom - $r.Top
# Anything this small is a helper window, never the app (e.g. 22x22 single-instance).
if ($w -lt 200 -or $hgt -lt 150) { Write-Output "capture: la ventana mas grande mide ${w}x${hgt}; no parece la de Fossil"; exit 1 }

$bmp = New-Object System.Drawing.Bitmap $w, $hgt
$g = [System.Drawing.Graphics]::FromImage($bmp)
try {
    $g.CopyFromScreen($r.Left, $r.Top, 0, 0, $bmp.Size)
    $dir = Split-Path -Parent $Out
    if ($dir) { New-Item -ItemType Directory -Force $dir | Out-Null }
    $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
    $g.Dispose()
    $bmp.Dispose()
}
Write-Output "capture: $Out (${w}x${hgt})"
exit 0
