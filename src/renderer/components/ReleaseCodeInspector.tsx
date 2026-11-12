/**
 * @file src/renderer/components/ReleaseCodeInspector.tsx
 * @description Центр подготовки публичного релиза на GitHub (Early Stage / Alpha v0.1.0-alpha.1)
 *              и инспектор всех исходных файлов репозитория в палитре Variation 7 (#111113 / #1a1a1e / #5e6ad2).
 */

import React, { useState, useEffect } from 'react';
import {
  AlertTriangle,
  FileCode2,
  Copy,
  Check,
  Download,
  GitBranch,
  Terminal,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { SourceFileNode } from '../../shared/types.ts';
import { orchestratorClient } from '../bridge.ts';

const GIT_PUBLISH_SCRIPT = `git init
git add .
git commit -m "release: AutoApp-Builder v0.1.0-alpha.1 (Early Stage Public Alpha)"
git branch -M main
git remote add origin https://github.com/<ваш-аккаунт>/autoapp-builder.git
git push -u origin main
git tag v0.1.0-alpha.1
git push origin v0.1.0-alpha.1`;

export const ReleaseCodeInspector: React.FC = () => {
  const [files, setFiles] = useState<SourceFileNode[]>([]);
  const [selectedPath, setSelectedPath] = useState<string>('README.md');
  const [fileContent, setFileContent] = useState<string>('');
  const [loadingFile, setLoadingFile] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [copiedGitCmd, setCopiedGitCmd] = useState<boolean>(false);
  const [showPublishGuide, setShowPublishGuide] = useState<boolean>(true);

  useEffect(() => {
    orchestratorClient
      .getReleaseFiles()
      .then((list) => {
        setFiles(list);
        if (list.length > 0 && !list.some((f) => f.path === selectedPath)) {
          setSelectedPath(list[0].path);
        }
      })
      .catch((err) => console.error(err));
  }, []);

  useEffect(() => {
    if (!selectedPath) return;
    setLoadingFile(true);
    orchestratorClient
      .getReleaseFileContent(selectedPath)
      .then((res) => setFileContent(res.content))
      .catch((err) => setFileContent(`Ошибка чтения файла: ${err.message}`))
      .finally(() => setLoadingFile(false));
  }, [selectedPath]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(fileContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleCopyGitCommands = async () => {
    await navigator.clipboard.writeText(GIT_PUBLISH_SCRIPT);
    setCopiedGitCmd(true);
    setTimeout(() => setCopiedGitCmd(false), 1800);
  };

  const activeNode = files.find((f) => f.path === selectedPath);

  return (
    <div className="flex flex-col h-full min-h-0 bg-[#1a1a1e] border border-white/10 rounded-[2px] overflow-hidden">
      {/* Верхняя панель публичного релиза и уведомления о ранней стадии разработки */}
      <div className="px-6 py-4 border-b border-white/10 flex flex-wrap items-center justify-between gap-4 shrink-0 bg-black/40">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="font-display font-extrabold text-base tracking-tight text-[#f0f0f0] uppercase">
              PUBLIC GITHUB RELEASE · v0.1.0-alpha.1
            </h2>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-amber-500/15 border border-amber-500/45 text-amber-300 font-mono text-[10px] font-bold uppercase tracking-wider">
              <AlertTriangle className="h-3 w-3" />
              <span>EARLY STAGE / РАННЯЯ СТАДИЯ (PRE-RELEASE)</span>
            </span>
          </div>
          <p className="text-xs text-white/60 truncate">
            Публичный репозиторий с матричной автосборкой GitHub Actions (Windows / macOS / Linux) и автопубликацией в GitHub Releases
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setShowPublishGuide((prev) => !prev)}
            className="flex items-center gap-1.5 px-3 py-2 border border-white/15 hover:border-[#5e6ad2] text-white/85 font-mono text-[10px] uppercase tracking-wider transition-colors cursor-pointer"
          >
            {showPublishGuide ? (
              <ChevronDown className="h-3.5 w-3.5 text-[#5e6ad2]" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-[#5e6ad2]" />
            )}
            <GitBranch className="h-3.5 w-3.5 text-[#5e6ad2]" />
            <span>КОМАНДЫ ПУБЛИКАЦИИ GIT</span>
          </button>

          <button
            type="button"
            onClick={() => orchestratorClient.downloadReleaseZip()}
            className="flex items-center gap-2 px-4 py-2 bg-[#5e6ad2] hover:bg-[#6e7ae2] text-white font-mono text-xs font-bold uppercase tracking-wider transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="h-3.5 w-3.5" />
            <span>СКАЧАТЬ ПУБЛИЧНЫЙ РЕЛИЗ (.ZIP)</span>
          </button>
        </div>
      </div>

      {/* Сворачиваемый блок быстрой публикации в публичный репозиторий GitHub с авто-релизом */}
      {showPublishGuide && (
        <div className="px-6 py-3.5 bg-[#111113] border-b border-white/10 flex flex-col lg:flex-row lg:items-center justify-between gap-4 shrink-0">
          <div className="space-y-1.5 max-w-2xl">
            <div className="font-mono text-[10px] uppercase tracking-wider text-amber-300 flex items-center gap-2">
              <span>• ПОМЕТКА EARLY STAGE ВКЛЮЧЕНА В README.md, CHANGELOG.md И GITHUB RELEASES (prerelease: true)</span>
            </div>
            <p className="text-xs text-white/70 leading-relaxed">
              При пуше в ветку <code className="text-white font-mono">main</code> или отправке тега{' '}
              <code className="text-white font-mono">v0.1.0-alpha.1</code> воркфлоу{' '}
              <code className="text-[#8b95f2] font-mono">.github/workflows/build.yml</code> автоматически соберет{' '}
              <code className="text-white font-mono">.exe</code>, <code className="text-white font-mono">.dmg</code>,{' '}
              <code className="text-white font-mono">.AppImage</code>, <code className="text-white font-mono">.deb</code> и опубликует их в публичном разделе GitHub Releases.
            </p>
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              {[
                'README.md',
                '.github/workflows/build.yml',
                'CHANGELOG.md',
                'electron-builder.yml',
                'package.json',
                'LICENSE',
              ].map((quickFile) => (
                <button
                  key={quickFile}
                  type="button"
                  onClick={() => setSelectedPath(quickFile)}
                  className={`px-2 py-1 font-mono text-[10px] border transition-colors cursor-pointer ${
                    selectedPath === quickFile
                      ? 'bg-[#5e6ad2] border-[#5e6ad2] text-white font-bold'
                      : 'bg-black/50 border-white/15 text-white/70 hover:text-white'
                  }`}
                >
                  {quickFile}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-black border border-white/15 p-3 flex items-start justify-between gap-3 min-w-[320px] max-w-xl">
            <pre className="font-mono text-[10px] text-emerald-300 leading-relaxed overflow-x-auto">
              {GIT_PUBLISH_SCRIPT}
            </pre>
            <button
              type="button"
              onClick={handleCopyGitCommands}
              className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 bg-white/5 hover:bg-[#5e6ad2] border border-white/15 text-white font-mono text-[10px] uppercase tracking-wider transition-colors cursor-pointer"
            >
              {copiedGitCmd ? (
                <>
                  <Check className="h-3 w-3 text-emerald-300" />
                  <span>СКОПИРОВАНО</span>
                </>
              ) : (
                <>
                  <Terminal className="h-3 w-3" />
                  <span>КОПИРОВАТЬ GIT</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Двухколоночная область проводника файлов и просмотра кода */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 overflow-hidden">
        {/* Левая колонка: список всех модулей публичного репозитория */}
        <div className="lg:col-span-4 border-r border-white/10 overflow-y-auto divide-y divide-white/10">
          {files.map((node) => {
            const active = node.path === selectedPath;
            return (
              <button
                key={node.path}
                type="button"
                onClick={() => setSelectedPath(node.path)}
                className={`w-full text-left px-4 py-3 transition-colors flex flex-col gap-1 cursor-pointer ${
                  active
                    ? 'bg-[#5e6ad2]/20 text-white border-r-2 border-[#5e6ad2]'
                    : 'hover:bg-white/[0.04] text-[#f0f0f0]/80'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-mono font-bold truncate">
                    {node.path}
                  </span>
                  <span className="text-[10px] font-mono tabular-nums text-white/45 shrink-0">
                    {(node.sizeBytes / 1024).toFixed(1)} KB
                  </span>
                </div>
                <span className="text-[11px] text-white/50 line-clamp-1">
                  {node.description}
                </span>
              </button>
            );
          })}
        </div>

        {/* Правая колонка: полный текст выбранного файла */}
        <div className="lg:col-span-8 flex flex-col min-h-0 bg-black overflow-hidden">
          <div className="px-5 py-2.5 border-b border-white/10 flex items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <FileCode2 className="h-3.5 w-3.5 text-[#8b95f2] shrink-0" />
              <span className="text-xs font-mono text-white truncate">
                {selectedPath}
              </span>
              {activeNode && (
                <span className="text-[11px] text-white/45 truncate hidden sm:inline">
                  — {activeNode.description}
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-1 border border-white/15 hover:bg-white/10 text-white font-mono text-[11px] uppercase tracking-wider transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                  <span>COPIED</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  <span>COPY FILE</span>
                </>
              )}
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-auto p-5 font-mono text-xs text-[#f0f0f0]/90 leading-relaxed">
            {loadingFile ? (
              <p className="text-white/50">LOADING SOURCE FILE...</p>
            ) : (
              <pre className="whitespace-pre">{fileContent}</pre>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
