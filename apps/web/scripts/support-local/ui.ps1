# Drives the KIASA Sound Desk's windows through Windows UI Automation, for the support e2e test.
# ui.ps1 -Window "<title>" -Id <AutomationId> -Do click|toggle|select0|exists|text|wait
param([string]$Window, [string]$Id = "", [string]$Do = "click", [int]$Seconds = 20, [int]$ProcessId = 0)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$ae = [System.Windows.Automation.AutomationElement]
$deadline = (Get-Date).AddSeconds($Seconds)
function Find-Window {
  $cond = New-Object System.Windows.Automation.PropertyCondition($ae::NameProperty, $Window)
  if ($ProcessId -gt 0) {
    $byPid = New-Object System.Windows.Automation.PropertyCondition($ae::ProcessIdProperty, $ProcessId)
    $cond = New-Object System.Windows.Automation.AndCondition($cond, $byPid)
  }
  return $ae::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
}
$win = $null
while (-not $win -and (Get-Date) -lt $deadline) { $win = Find-Window; if (-not $win) { Start-Sleep -Milliseconds 300 } }
if ($Do -eq "gone") {
  while ($win -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 300; $win = Find-Window }
  if ($win) { "STILL"; exit 1 } else { "GONE"; exit 0 }
}
if (-not $win) { "NOWINDOW"; exit 2 }
if ($Do -eq "exists") { "OK"; exit 0 }
$el = $win.FindFirst([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition($ae::AutomationIdProperty, $Id)))
if (-not $el) { "NOELEMENT"; exit 3 }
switch ($Do) {
  "click" { $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke(); "OK" }
  "toggle" {
    $p = $null
    if ($el.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$p)) { $p.Toggle(); "OK" }
    else { $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke(); "OK" }
  }
  "check" {
    $p = $el.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
    if ($p.Current.ToggleState -ne [System.Windows.Automation.ToggleState]::On) { $p.Toggle() }
    "OK"
  }
  "select0" {
    $item = $el.FindFirst([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
    $item.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select(); "OK"
  }
  "text" { $el.Current.Name }
}
