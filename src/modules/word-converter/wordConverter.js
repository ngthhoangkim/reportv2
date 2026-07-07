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

  function Relax-RangeFrames($range, [double]$minHeight, [double]$minWidth, [double]$shiftLeft) {
    if ($null -eq $range) { return }
    try {
      $count = $range.Frames.Count
      for ($f = 1; $f -le $count; $f++) {
        $frame = $range.Frames.Item($f)
        $frame.HeightRule = 1
        if ($minHeight -gt 0 -and $frame.Height -lt $minHeight) {
          $frame.Height = $minHeight
        }
        if ($minWidth -gt 0 -and $frame.Width -lt $minWidth) {
          $frame.Width = $minWidth
        }
        if ($shiftLeft -gt 0) {
          $frame.HorizontalPosition = $frame.HorizontalPosition - $shiftLeft
        }
      }
    } catch {
      # Some converted .doc templates expose no Frame collection on this range.
    }
  }

  function Apply-CompactParagraphFormat($range, [double]$fontSize, [double]$lineSpacing, [double]$minFrameHeight, [double]$minFrameWidth, [double]$shiftLeft) {
    if ($null -eq $range) { return }
    $range.Font.Name = 'Times New Roman'
    $range.Font.Size = $fontSize
    $range.Font.Bold = $false
    $range.ParagraphFormat.Alignment = 0
    $range.ParagraphFormat.LeftIndent = 0
    $range.ParagraphFormat.FirstLineIndent = 0
    $range.ParagraphFormat.RightIndent = 0
    $range.ParagraphFormat.LineSpacingRule = 0
    $range.ParagraphFormat.LineSpacing = $lineSpacing
    $range.ParagraphFormat.SpaceBefore = 0
    $range.ParagraphFormat.SpaceAfter = 0
    Relax-RangeFrames $range $minFrameHeight $minFrameWidth $shiftLeft
  }

  function Replace-Token($document, [string]$findText, [string]$replaceText, [bool]$once) {
    $range = $document.Content
    $count = 0
    $wordText = Normalize-WordText $replaceText
    while ($range.Find.Execute($findText)) {
      $range.Text = $wordText
      if ($findText -match 'Conclusion|ChanDoan') {
        Apply-CompactParagraphFormat $range 10.5 11 0 0 0
      }
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
    return $text -match '<\\s*(#|SL|U|ItemName|Note|Q|F)\\s*>' -or
      $text -match '^\\s*\\d+\\s*/\\s*$' -or
      $text -match 'Ngày' -or
      $text -match 'mỗi lần'
  }

  function Replace-MedicationScaffold($document, [string]$replaceText) {
    if ([string]::IsNullOrWhiteSpace($replaceText)) { return }
    $paragraphs = $document.Paragraphs
    for ($i = 1; $i -le $paragraphs.Count; $i++) {
      $text = [string]$paragraphs.Item($i).Range.Text
      if ($text -notmatch '<\\s*(#|ItemName|SL|Q|F)\\s*>') { continue }

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

  function Set-ParagraphPlainText($document, $paragraph, [string]$text) {
    if ($null -eq $paragraph) { return }
    $start = $paragraph.Range.Start
    $end = [Math]::Max($start, $paragraph.Range.End - 1)
    $range = $document.Range($start, $end)
    $range.Text = Normalize-WordText $text
    $range.Font.Name = 'Times New Roman'
    $range.Font.Size = 11
    Relax-RangeFrames $range 18 0 0
  }

  function Set-ParagraphTextCompact($document, $paragraph, [string]$text, [double]$fontSize) {
    if ($null -eq $paragraph) { return }
    $start = $paragraph.Range.Start
    $end = [Math]::Max($start, $paragraph.Range.End - 1)
    $range = $document.Range($start, $end)
    $range.Text = Normalize-WordText $text
    $range.Font.Name = 'Times New Roman'
    $range.Font.Size = $fontSize
  }

  function Find-RxStartParagraphIndex($paragraphs) {
    for ($i = 1; $i -le $paragraphs.Count; $i++) {
      $text = [string]$paragraphs.Item($i).Range.Text
      if ($text -match '<\\s*#\\s*>') { return $i }
    }
    return 0
  }

  function Replace-PrescriptionRows($document, $rows) {
    if ($null -eq $rows) { return }
    $paragraphs = $document.Paragraphs
    $startIndex = Find-RxStartParagraphIndex $paragraphs
    if ($startIndex -le 0) { return }
    $rowCount = @($rows).Count
    if ($rowCount -le 0) {
      for ($offset = 0; $offset -le 7; $offset++) {
        if ($startIndex + $offset -le $paragraphs.Count) {
          Set-ParagraphPlainText $document $paragraphs.Item($startIndex + $offset) ''
        }
      }
      return
    }

    if ($rowCount -gt 1) {
      $endIndex = [Math]::Min($paragraphs.Count, $startIndex + 7)

      # The template lays the medication scaffold out as page-anchored frames
      # (dotted bottom borders draw the ..... ruling). Capture each scaffold
      # paragraph's frame Y so the copies can be shifted down per item.
      $frameY = @{}
      $minY = $null
      for ($o = 0; $o -le ($endIndex - $startIndex); $o++) {
        try {
          $r = $paragraphs.Item($startIndex + $o).Range
          if ($r.Frames.Count -gt 0) {
            $y = [double]$r.Frames.Item(1).VerticalPosition
            $frameY[$o] = $y
            if ($null -eq $minY -or $y -lt $minY) { $minY = $y }
          }
        } catch { }
      }
      if ($null -eq $minY) { $minY = 0 }

      $pageHeight = 842.0
      try { $pageHeight = [double]$document.PageSetup.PageHeight } catch { }
      $available = [Math]::Max(120.0, $pageHeight - $minY - 110)
      $step = [Math]::Floor($available / $rowCount)
      if ($step -gt 44) { $step = 44.0 }
      if ($step -lt 24) { $step = 24.0 }
      $fontSize = 10.5
      if ($step -lt 34) { $fontSize = 9.5 }
      # line 2 sits a fixed distance under line 1; whatever remains of the
      # step becomes the visible gap between consecutive items.
      $lineOffset = 14.0
      if ($fontSize -lt 10) { $lineOffset = 12.0 }

      $scafStart = $paragraphs.Item($startIndex).Range.Start
      $scafEnd = $paragraphs.Item($endIndex).Range.End
      $scaffold = $document.Range($scafStart, $scafEnd)
      $copyFrom = $scaffold.FormattedText
      for ($k = 1; $k -lt $rowCount; $k++) {
        $target = $document.Range($scafEnd, $scafEnd)
        $target.FormattedText = $copyFrom
      }

      $paragraphs = $document.Paragraphs
      for ($b = 0; $b -lt $rowCount; $b++) {
        $row = @($rows)[$b]
        $base = $startIndex + (8 * $b)
        $name = [string]$row.compactName
        if ([string]::IsNullOrWhiteSpace($name)) { $name = [string]$row.itemName }
        $values = @(
          ([string]$row.index),
          ([string]$row.quantity),
          $name,
          ([string]$row.note),
          'Ngày',
          ', mỗi lần',
          ([string]$row.dose),
          ([string]$row.frequency)
        )
        for ($o = 0; $o -le 7; $o++) {
          if (($base + $o) -gt $paragraphs.Count) { break }
          $para = $paragraphs.Item($base + $o)
          Set-ParagraphTextCompact $document $para $values[$o] $fontSize
          if ($frameY.ContainsKey($o)) {
            try {
              $frame = $para.Range.Frames.Item(1)
              $lineY = 0.0
              if (($frameY[$o] - $minY) -gt 2) { $lineY = $lineOffset }
              try { $frame.HeightRule = 0 } catch { }
              $frame.VerticalPosition = $minY + ($b * $step) + $lineY
            } catch { }
          }
        }
      }
      return
    }

    $first = @($rows)[0]
    Set-ParagraphPlainText $document $paragraphs.Item($startIndex) ([string]$first.index)
    Set-ParagraphPlainText $document $paragraphs.Item($startIndex + 1) ([string]$first.quantity)
    Set-ParagraphPlainText $document $paragraphs.Item($startIndex + 2) ([string]$first.itemName)
    Set-ParagraphPlainText $document $paragraphs.Item($startIndex + 3) ([string]$first.note)
    Set-ParagraphPlainText $document $paragraphs.Item($startIndex + 4) 'Ngày'
    Set-ParagraphPlainText $document $paragraphs.Item($startIndex + 5) ', mỗi lần'
    Set-ParagraphPlainText $document $paragraphs.Item($startIndex + 6) ([string]$first.dose)
    Set-ParagraphPlainText $document $paragraphs.Item($startIndex + 7) ([string]$first.frequency)
  }

  foreach ($item in $replacements) {
    if ([string]$item.kind -eq 'medicationRows') {
      Replace-PrescriptionRows $doc $item.rows
      continue
    }
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
