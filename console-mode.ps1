param([int]$TargetPid = 0, [string]$ResultFile)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class UoocConsoleMode {
 [DllImport("kernel32.dll")] public static extern bool AttachConsole(uint pid);
 [DllImport("kernel32.dll")] public static extern bool FreeConsole();
 [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int id);
 [DllImport("kernel32.dll")] static extern IntPtr GetConsoleWindow();
 [DllImport("user32.dll")] static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);
 [DllImport("kernel32.dll")] static extern bool GetConsoleMode(IntPtr h, out uint mode);
 [DllImport("kernel32.dll")] static extern bool SetConsoleMode(IntPtr h, uint mode);
 [StructLayout(LayoutKind.Sequential)] public struct Selection { public uint Flags; public short X,Y,Left,Top,Right,Bottom; }
 [DllImport("kernel32.dll")] static extern bool GetConsoleSelectionInfo(out Selection info);
 [StructLayout(LayoutKind.Explicit, Size=20)] struct Input {
  [FieldOffset(0)] public ushort Type;
  [FieldOffset(4)] public int Down;
  [FieldOffset(8)] public ushort Repeat;
  [FieldOffset(10)] public ushort VirtualKey;
  [FieldOffset(14)] public ushort Character;
 }
 [DllImport("kernel32.dll")] static extern bool WriteConsoleInputW(IntPtr h, Input[] input, uint count, out uint written);
 public static string Apply() {
  var h=GetStdHandle(-10); uint mode; Selection selection;
  bool selected=GetConsoleSelectionInfo(out selection) && (selection.Flags & 1)!=0;
  bool read=GetConsoleMode(h,out mode);
  bool changed=read && SetConsoleMode(h,(mode | 0x80u) & ~0x40u);
  bool released=false;
  if(selected) { released=PostMessage(GetConsoleWindow(),0x100,new IntPtr(27),IntPtr.Zero); PostMessage(GetConsoleWindow(),0x101,new IntPtr(27),IntPtr.Zero); }
  return "modeReadable="+read+";quickEditDisabled="+changed+";selectionActive="+selected+";escapeSent="+released;
 }
}
'@
if ($TargetPid) {
    [UoocConsoleMode]::FreeConsole() | Out-Null
    if (-not [UoocConsoleMode]::AttachConsole([uint32]$TargetPid)) { throw 'Cannot attach to UOOC console' }
}
try {
    $result = [UoocConsoleMode]::Apply()
    if ($ResultFile) { Set-Content -LiteralPath $ResultFile -Value $result -Encoding UTF8 }
    elseif ($TargetPid) { Write-Host $result }
} finally { if ($TargetPid) { [UoocConsoleMode]::FreeConsole() | Out-Null } }
