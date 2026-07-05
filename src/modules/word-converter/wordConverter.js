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

function runProcess(command, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${path.basename(command)} timeout after ${timeoutMs}ms`));
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
      else reject(new Error(`${path.basename(command)} exited ${code}: ${stderr || stdout}`));
    });
  });
}

function libreOfficeCandidates() {
  return [
    process.env.SOFFICE_PATH,
    process.env.LIBREOFFICE_PATH,
    'soffice',
    'libreoffice',
    '/Applications/LibreOffice.app/Contents/MacOS/soffice',
  ].filter(Boolean);
}

async function findLibreOffice() {
  for (const candidate of libreOfficeCandidates()) {
    if (path.isAbsolute(candidate) && !fs.existsSync(candidate)) continue;
    try {
      await runProcess(candidate, ['--version'], 10000);
      return candidate;
    } catch {
      // try next candidate
    }
  }
  return null;
}

async function convertWithLibreOffice(inputPath, outputPath, format) {
  const soffice = await findLibreOffice();
  if (!soffice) {
    throw new Error('LibreOffice soffice was not found for local document conversion');
  }
  ensureDir(path.dirname(outputPath));
  const outDir = path.join(config.paths.tmpDir, 'libreoffice-output', `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const profileDir = path.join(config.paths.tmpDir, 'libreoffice-profile', `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  ensureDir(outDir);
  ensureDir(profileDir);
  const args = [
    `-env:UserInstallation=file://${profileDir}`,
    '--headless',
    '--convert-to',
    format,
    '--outdir',
    outDir,
    inputPath,
  ];
  await runProcess(soffice, args, config.word.timeoutMs);
  const produced = path.join(outDir, `${path.basename(inputPath, path.extname(inputPath))}.${format === 'docx' ? 'docx' : 'pdf'}`);
  if (!fs.existsSync(produced)) {
    throw new Error(`LibreOffice did not produce expected output: ${produced}`);
  }
  await fs.promises.rename(produced, outputPath);
  await fs.promises.rm(outDir, { recursive: true, force: true });
  await fs.promises.rm(profileDir, { recursive: true, force: true });
  return outputPath;
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
  $doc = $word.Documents.Open('${psEscape(inputPath)}', $false, $true)
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

function enqueue(task) {
  const run = queue.then(task, task);
  queue = run.catch(() => {});
  return run;
}

async function convertDocxToPdf(docxPath, pdfPath) {
  return enqueue(async () => {
    const engine = process.platform === 'win32' && config.word.useWord ? 'word' : 'libreoffice';
    logger.job('info', 'document convert docx to pdf started', { docxPath, pdfPath, engine });
    const result = engine === 'word'
      ? await convertWithWord(docxPath, pdfPath, 'pdf')
      : await convertWithLibreOffice(docxPath, pdfPath, 'pdf');
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
    const engine = process.platform === 'win32' && config.word.useWord ? 'word' : 'libreoffice';
    logger.job('info', 'document convert doc to docx started', { docPath, cached, engine });
    const result = engine === 'word'
      ? await convertWithWord(docPath, cached, 'docx')
      : await convertWithLibreOffice(docPath, cached, 'docx');
    logger.job('info', 'document convert doc to docx completed', { docPath, cached, engine });
    return result;
  });
}

module.exports = {
  convertDocxToPdf,
  convertDocToDocxCached,
  enqueue,
};
