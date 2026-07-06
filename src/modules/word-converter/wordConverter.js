const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { config } = require('../../config/env');
const { ensureDir } = require('../../config/paths');
const logger = require('../logging/logger');

let queue = Promise.resolve();

function psEscape(value) {
  return String(value).replace(/'/g, "''");
}

function runPowerShell(script, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Word COM timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`PowerShell exited ${code}: ${stderr || stdout}`));
    });
  });
}

async function convertWithWord(inputPath, outputPath, format) {
  if (process.platform !== 'win32') {
    throw new Error('Word COM conversion requires Windows with Microsoft Word installed');
  }
  ensureDir(path.dirname(outputPath));
  const wdFormat = format === 'pdf' ? 17 : 16;
  const script = `
$ErrorActionPreference = 'Stop'
$word = $null
$doc = $null
try {
  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $word.DisplayAlerts = 0
  $fileName = '${psEscape(inputPath)}'
  $confirmConversions = $false
  $readOnly = $true
  $addToRecentFiles = $false
  $passwordDocument = ''
  $passwordTemplate = ''
  $revert = $false
  $writePasswordDocument = ''
  $writePasswordTemplate = ''
  $format = 0
  $encoding = [System.Type]::Missing
  $visible = $false
  $openAndRepair = $false
  $documentDirection = 0
  $noEncodingDialog = $true
  try {
    $doc = $word.Documents.Open([ref]$fileName, [ref]$confirmConversions, [ref]$readOnly)
  } catch {
    $openAndRepair = $true
    $doc = $word.Documents.Open(
      [ref]$fileName,
      [ref]$confirmConversions,
      [ref]$readOnly,
      [ref]$addToRecentFiles,
      [ref]$passwordDocument,
      [ref]$passwordTemplate,
      [ref]$revert,
      [ref]$writePasswordDocument,
      [ref]$writePasswordTemplate,
      [ref]$format,
      [ref]$encoding,
      [ref]$visible,
      [ref]$openAndRepair,
      [ref]$documentDirection,
      [ref]$noEncodingDialog
    )
  }
  $doc.SaveAs([ref]'${psEscape(outputPath)}', [ref]${wdFormat})
} finally {
  if ($doc -ne $null) { $doc.Close([ref]$false) | Out-Null }
  if ($word -ne $null) { $word.Quit() | Out-Null }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
`;
  await runPowerShell(script, config.word.timeoutMs);
  return outputPath;
}

async function renderWordTemplateToPdf(templatePath, pdfPath, replacements = []) {
  if (process.platform !== 'win32') {
    throw new Error('Word COM template rendering requires Windows with Microsoft Word installed');
  }
  ensureDir(path.dirname(pdfPath));
  const dataDir = path.join(config.paths.tmpDir, 'word-template-data');
  ensureDir(dataDir);
  const replacementsPath = path.join(dataDir, `${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  await fs.promises.writeFile(replacementsPath, JSON.stringify(replacements), 'utf8');

  const script = `
$ErrorActionPreference = 'Stop'
$word = $null
$doc = $null
try {
  $templatePath = '${psEscape(templatePath)}'
  $pdfPath = '${psEscape(pdfPath)}'
  $replacementsPath = '${psEscape(replacementsPath)}'
  $replacements = Get-Content -LiteralPath $replacementsPath -Raw -Encoding UTF8 | ConvertFrom-Json

  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $word.DisplayAlerts = 0
  $confirmConversions = $false
  $readOnly = $true
  $doc = $word.Documents.Open([ref]$templatePath, [ref]$confirmConversions, [ref]$readOnly)

  function Normalize-WordText([string]$text) {
    if ($null -eq $text) { return '' }
    $cr = [string][char]13
    $lf = [string][char]10
    return (($text -replace ($cr + $lf), $cr) -replace $lf, $cr)
  }

  function Replace-Token($document, [string]$findText, [string]$replaceText, [bool]$once) {
    $range = $document.Content
    $count = 0
    $wordText = Normalize-WordText $replaceText
    while ($range.Find.Execute($findText)) {
      $range.Text = $wordText
      $count += 1
      if ($once) { return $count }
      $start = $range.End
      $range = $document.Range($start, $document.Content.End)
    }
    return $count
  }

  function Find-Texts($item) {
    $texts = @()
    if ($null -ne $item.finds) {
      foreach ($findText in @($item.finds)) {
        if (-not [string]::IsNullOrWhiteSpace([string]$findText)) {
          $texts += [string]$findText
        }
      }
    } elseif ($null -ne $item.find) {
      $texts += [string]$item.find
    }
    return $texts
  }

  function Replace-AnyToken($document, $findTexts, [string]$replaceText, [bool]$once) {
    foreach ($findText in $findTexts) {
      $count = Replace-Token $document ([string]$findText) $replaceText $once
      if ($once -and $count -gt 0) { return }
    }
  }

  function Is-MedicationScaffold([string]$text) {
    if ($null -eq $text) { return $false }
    return $text -match '<\s*(#|SL|U|ItemName|Note|Q|F)\s*>' -or
      $text -match '^\s*\d+\s*/\s*$' -or
      $text -match 'Ngày' -or
      $text -match 'mỗi lần'
  }

  function Replace-MedicationScaffold($document, [string]$replaceText) {
    if ([string]::IsNullOrWhiteSpace($replaceText)) { return }
    $paragraphs = $document.Paragraphs
    for ($i = 1; $i -le $paragraphs.Count; $i++) {
      $text = [string]$paragraphs.Item($i).Range.Text
      if ($text -notmatch '<\s*(#|ItemName|SL|Q|F)\s*>') { continue }

      $startIndex = $i
      while ($startIndex -gt 1) {
        $previous = [string]$paragraphs.Item($startIndex - 1).Range.Text
        if (Is-MedicationScaffold $previous) { $startIndex -= 1 } else { break }
      }

      $endIndex = $i
      $maxEnd = [Math]::Min($paragraphs.Count, $i + 8)
      while ($endIndex -lt $maxEnd) {
        $next = [string]$paragraphs.Item($endIndex + 1).Range.Text
        if (Is-MedicationScaffold $next) { $endIndex += 1 } else { break }
      }

      $rangeStart = $paragraphs.Item($startIndex).Range.Start
      $range = $document.Range($rangeStart, $paragraphs.Item($endIndex).Range.End)
      $wordText = (Normalize-WordText $replaceText) + ([string][char]13)
      $range.Text = $wordText
      $insertedEnd = [Math]::Min($document.Content.End, $rangeStart + $wordText.Length)
      $inserted = $document.Range($rangeStart, $insertedEnd)
      $inserted.Font.Name = 'Times New Roman'
      $inserted.Font.Size = 11
      $inserted.Font.Bold = $false
      $inserted.ParagraphFormat.LineSpacingRule = 0
      $inserted.ParagraphFormat.LineSpacing = 12
      $inserted.ParagraphFormat.SpaceBefore = 0
      $inserted.ParagraphFormat.SpaceAfter = 0
      return
    }
  }

  foreach ($item in $replacements) {
    if ([string]$item.kind -eq 'medicationScaffold') {
      Replace-MedicationScaffold $doc ([string]$item.replace)
      continue
    }
    Replace-AnyToken $doc (Find-Texts $item) ([string]$item.replace) ([bool]$item.once)
  }

  $doc.SaveAs([ref]$pdfPath, [ref]17)
} finally {
  if ($doc -ne $null) { $doc.Close([ref]$false) | Out-Null }
  if ($word -ne $null) { $word.Quit() | Out-Null }
  if (Test-Path -LiteralPath '${psEscape(replacementsPath)}') { Remove-Item -LiteralPath '${psEscape(replacementsPath)}' -Force }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
`;
  await runPowerShell(script, config.word.timeoutMs);
  return pdfPath;
}

function enqueue(task) {
  const run = queue.then(task, task);
  queue = run.catch(() => {});
  return run;
}

async function convertDocxToPdf(docxPath, pdfPath) {
  return enqueue(async () => {
    const engine = 'word';
    logger.job('info', 'document convert docx to pdf started', { docxPath, pdfPath, engine });
    const result = await convertWithWord(docxPath, pdfPath, 'pdf');
    logger.job('info', 'document convert docx to pdf completed', { docxPath, pdfPath, engine });
    return result;
  });
}

async function convertDocToDocxCached(docPath) {
  const cacheDir = path.join(config.paths.tmpDir, 'template-cache');
  ensureDir(cacheDir);
  const stat = fs.statSync(docPath);
  const key = `${path.basename(docPath, path.extname(docPath))}-${stat.size}-${Math.floor(stat.mtimeMs)}.docx`;
  const cached = path.join(cacheDir, key);
  if (fs.existsSync(cached)) return cached;

  return enqueue(async () => {
    const engine = 'word';
    logger.job('info', 'document convert doc to docx started', { docPath, cached, engine });
    const result = await convertWithWord(docPath, cached, 'docx');
    logger.job('info', 'document convert doc to docx completed', { docPath, cached, engine });
    return result;
  });
}

module.exports = {
  convertDocxToPdf,
  convertDocToDocxCached,
  renderWordTemplateToPdf,
  enqueue,
};
