$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Resolve-Path (Join-Path $scriptDir '..')

$literalFiles = @(
  'index.html',
  'dashboard.css',
  'chart.umd.min.js',
  'xlsx.full.min.js',
  'readme.md'
)

$files = @()
foreach ($name in $literalFiles) {
  $path = Join-Path $root $name
  if (Test-Path -LiteralPath $path -PathType Leaf) {
    $files += Get-Item -LiteralPath $path
  } else {
    Write-Warning "Source file missing: $name"
  }
}

$files += Get-ChildItem -LiteralPath $root -File -Filter 'dashboard-*.js' | Sort-Object Name
$templateSuffix = -join ([char[]](0x5BFC, 0x5165, 0x6A21, 0x677F))
$files += Get-ChildItem -LiteralPath $root -File -Filter '*.xlsx' |
  Where-Object { $_.BaseName.EndsWith($templateSuffix) } |
  Sort-Object Name
$files = $files | Sort-Object Name -Unique

$targets = @()
$deployDir = Join-Path $root 'deploy'
if (!(Test-Path -LiteralPath $deployDir)) {
  New-Item -ItemType Directory -Path $deployDir | Out-Null
}
$targets += Get-Item -LiteralPath $deployDir

$ghPagesDir = Join-Path $root 'gh-pages'
if (Test-Path -LiteralPath $ghPagesDir -PathType Container) {
  $targets += Get-Item -LiteralPath $ghPagesDir
}

$results = @()
foreach ($target in $targets) {
  foreach ($file in $files) {
    $dest = Join-Path $target.FullName $file.Name
    Copy-Item -LiteralPath $file.FullName -Destination $dest -Force
    $copied = Get-Item -LiteralPath $dest
    $hash = Get-FileHash -LiteralPath $dest -Algorithm SHA256
    $results += [PSCustomObject]@{
      Target = $target.Name
      File = $copied.Name
      Bytes = $copied.Length
      SHA256 = $hash.Hash
    }
  }
}

$results | Sort-Object Target, File | Format-Table -AutoSize
